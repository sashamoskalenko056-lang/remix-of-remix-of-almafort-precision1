/**
 * Интеграция с 1С:Предприятие (OData / REST, Push-модель).
 * Сайт — инициатор передачи: заказ уходит в 1С сразу, а при недоступности базы
 * ложится в очередь erp_sync_jobs и повторяется по Retry Pattern каждые 15 минут.
 * Клиент задержки не видит — заказ для него оформлен мгновенно.
 */
import { secretValues } from "@/lib/vault.server";

export type ErpOrderPayload = {
  orderNumber: string;
  orderId?: string | null;
  inn: string | null;
  kpp: string | null;
  companyName: string | null;
  customer: { name: string; phone: string; email?: string };
  city: string;
  carrier: string;
  deliveryPrice: number;
  goodsPrice: number;
  total: number;
  status: string;
  items: Array<{ sku: string; name: string; quantity: number; unit: number; sum: number }>;
};

const MAX_ATTEMPTS = 96; // сутки повторов с шагом 15 минут
const RETRY_MS = 15 * 60 * 1000;

async function admin() {
  const { db: store } = await import("@/lib/db.server");
  return store;
}

async function credentials() {
  const c = await secretValues(["ERP_1C_URL", "ERP_1C_LOGIN", "ERP_1C_PASSWORD"] as const);
  if (!c.ERP_1C_URL || !c.ERP_1C_LOGIN || !c.ERP_1C_PASSWORD) return null;
  return { url: c.ERP_1C_URL.replace(/\/+$/, ""), login: c.ERP_1C_LOGIN, password: c.ERP_1C_PASSWORD };
}

/**
 * Отправка пакета в 1С. Мэтчинг контрагента делает 1С по ИНН:
 * найдёт — привяжет заказ, не найдёт — создаст карточку и привяжет.
 */
async function pushOrder(payload: ErpOrderPayload): Promise<{ ok: boolean; detail: string }> {
  const cred = await credentials();
  if (!cred) return { ok: false, detail: "1С не сконфигурирована" };

  const auth = btoa(`${cred.login}:${cred.password}`);
  try {
    const res = await fetch(`${cred.url}/Document_ЗаказПокупателя?$format=json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        СайтНомерЗаказа: payload.orderNumber,
        ИНН: payload.inn,
        КПП: payload.kpp,
        Контрагент: payload.companyName ?? payload.customer.name,
        Контакт: payload.customer,
        Город: payload.city,
        СпособДоставки: payload.carrier,
        СуммаДоставки: payload.deliveryPrice,
        СуммаТоваров: payload.goodsPrice,
        СуммаДокумента: payload.total,
        Статус: payload.status,
        Товары: payload.items.map((i) => ({
          Артикул: i.sku,
          Номенклатура: i.name,
          Количество: i.quantity,
          Цена: i.unit,
          Сумма: i.sum,
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.error(`[1c] push failed [${res.status}]: ${text.slice(0, 500)}`);
      return { ok: false, detail: `1С ответила ${res.status}: ${text.slice(0, 300)}` };
    }
    return { ok: true, detail: "Заказ покупателя создан в 1С" };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "сеть недоступна";
    console.error("[1c] push error", detail);
    return { ok: false, detail };
  }
}

/**
 * Ставим заказ в очередь и пробуем отправить сразу.
 * Любая ошибка 1С не влияет на успешность чекаута — статус Sync_Failed и ретраи.
 */
export async function enqueueOrder(payload: ErpOrderPayload) {
  const db = await admin();
  const { data: job } = await db
    .from("erp_sync_jobs")
    .insert({
      order_number: payload.orderNumber,
      order_id: payload.orderId ?? null,
      direction: "push",
      payload: payload as never,
      status: "pending",
    } as never)
    .select("id")
    .maybeSingle();

  const jobId = (job as { id?: string } | null)?.id ?? null;
  const result = await pushOrder(payload);
  if (jobId) await finishJob(jobId, 0, result);
  return result;
}

async function finishJob(id: string, attempts: number, result: { ok: boolean; detail: string }) {
  const db = await admin();
  const next = attempts + 1;
  await db
    .from("erp_sync_jobs")
    .update({
      status: result.ok ? "synced" : next >= MAX_ATTEMPTS ? "failed" : "sync_failed",
      attempts: next,
      last_error: result.ok ? null : result.detail.slice(0, 1000),
      next_attempt_at: new Date(Date.now() + RETRY_MS).toISOString(),
      synced_at: result.ok ? new Date().toISOString() : null,
    } as never)
    .eq("id", id);
}

/** Retry Pattern: вызывается кроном каждые 15 минут. */
export async function retryPendingOrders(limit = 25) {
  const db = await admin();
  const { data } = await db
    .from("erp_sync_jobs")
    .select("id, attempts, payload")
    .in("status", ["pending", "sync_failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  const rows = (data ?? []) as Array<{ id: string; attempts: number; payload: ErpOrderPayload }>;
  let synced = 0;
  for (const row of rows) {
    const result = await pushOrder(row.payload);
    if (result.ok) synced++;
    await finishJob(row.id, row.attempts, result);
  }
  return { processed: rows.length, synced };
}

/** 1С → сайт: остатки и цены (ночная выгрузка). */
export async function applyStockFeed(
  rows: Array<{
    sku: string;
    stock?: number | undefined;
    base_price?: number | undefined;
    opt1_price?: number | undefined;
    opt2_price?: number | undefined;
  }>,
) {
  const db = await admin();
  let updated = 0;
  for (const r of rows) {
    if (!r.sku) continue;
    const patch: Record<string, unknown> = { sku: r.sku };
    if (typeof r.stock === "number") patch["stock"] = Math.max(0, Math.round(r.stock));
    if (typeof r.base_price === "number") patch["base_price"] = r.base_price;
    if (typeof r.opt1_price === "number") patch["opt1_price"] = r.opt1_price;
    if (typeof r.opt2_price === "number") patch["opt2_price"] = r.opt2_price;
    const { error } = await db
      .from("product_overrides")
      .upsert(patch as never, { onConflict: "sku" });
    if (!error) updated++;
  }
  return { received: rows.length, updated };
}

/** Карта статусов 1С → статусы заказа на сайте. */
export const ERP_STATUS_MAP: Record<string, string> = {
  Оплачен: "paid",
  ОжидаетОплаты: "new",
  ВПроизводстве: "production",
  Комплектуется: "packing",
  Отгружен: "shipped",
  Доставлен: "arrived",
  Закрыт: "closed",
  paid: "paid",
  production: "production",
  packing: "packing",
  shipped: "shipped",
  arrived: "arrived",
  closed: "closed",
};
