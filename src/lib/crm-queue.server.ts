/**
 * Dead Letter Queue для CRM: если Битрикс24/amoCRM на профилактике,
 * лид не исчезает — он ложится в очередь и переотправляется кроном.
 * Хранилище — та же таблица erp_sync_jobs (direction = 'crm').
 */
import type { CrmOrder } from "@/lib/crm.server";
import { maskPii } from "@/lib/log-sanitize";

const MAX_ATTEMPTS = 8;
const RETRY_MS = 15 * 60_000;

async function admin() {
  const { db: store } = await import("@/lib/db.server");
  return store;
}

/** Кладём неотправленный лид в резервную очередь. */
export async function enqueueCrmLead(orderNumber: string, order: CrmOrder, detail: string) {
  try {
    const db = await admin();
    await db.from("erp_sync_jobs").insert({
      order_number: orderNumber,
      direction: "crm",
      payload: order as never,
      status: "sync_failed",
      last_error: maskPii(detail).slice(0, 1000),
      next_attempt_at: new Date(Date.now() + RETRY_MS).toISOString(),
    } as never);
  } catch (e) {
    console.error("[crm-dlq] очередь недоступна", maskPii(String(e)));
  }
}

/** Переотправка накопленных лидов: вызывается кроном вместе с ретраем 1С. */
export async function retryPendingCrmLeads(limit = 25) {
  const db = await admin();
  const { data } = await db
    .from("erp_sync_jobs")
    .select("id, attempts, payload")
    .eq("direction", "crm")
    .in("status", ["pending", "sync_failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  const rows = (data ?? []) as Array<{ id: string; attempts: number; payload: CrmOrder }>;
  const { pushToCrm } = await import("@/lib/crm.server");
  let sent = 0;

  for (const row of rows) {
    let ok = false;
    let detail = "";
    try {
      const res = await pushToCrm(row.payload);
      ok = res.ok;
      detail = res.detail ?? "";
    } catch (e) {
      detail = String(e);
    }
    const attempts = row.attempts + 1;
    if (ok) sent++;
    await db
      .from("erp_sync_jobs")
      .update({
        status: ok ? "synced" : attempts >= MAX_ATTEMPTS ? "failed" : "sync_failed",
        attempts,
        last_error: ok ? null : maskPii(detail).slice(0, 1000),
        next_attempt_at: new Date(Date.now() + RETRY_MS).toISOString(),
        synced_at: ok ? new Date().toISOString() : null,
      } as never)
      .eq("id", row.id);
  }
  return { processed: rows.length, sent };
}
