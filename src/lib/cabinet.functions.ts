/**
 * Server-функции B2B-кабинета. Каждая работает от имени клиента (RLS),
 * поэтому чужие заказы физически недоступны даже при подмене id.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import { EMPTY_LOYALTY, type LoyaltySummary } from "@/lib/loyalty";

const uuid = z.string().uuid();

export const getCabinet = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { db, userId } = context;

    const [profileRes, companiesRes, ordersRes, loyaltyRes] = await Promise.all([
      db.from("profiles").select("*").eq("id", userId).maybeSingle(),
      db.from("companies").select("*").order("created_at", { ascending: true }),
      supabase
        .from("orders")
        .select("id, number, status, total, carrier, city, created_at, tracking_number")
        .order("created_at", { ascending: false })
        .limit(50),
      db.rpc("my_loyalty"),
    ]);

    const loyalty = (loyaltyRes.data as LoyaltySummary | null) ?? EMPTY_LOYALTY;
    return {
      profile: profileRes.data ?? null,
      companies: companiesRes.data ?? [],
      orders: ordersRes.data ?? [],
      loyalty: {
        total_spent: Number(loyalty.total_spent ?? 0),
        tier: (loyalty.tier ?? 1) as 1 | 2 | 3,
        next_threshold: loyalty.next_threshold ?? null,
      },
    };
  });

export const getOrderDetail = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: { orderId: string }) => ({ orderId: uuid.parse(input.orderId) }))
  .handler(async ({ data, context }) => {
    const { db } = context;
    const { data: order, error } = await supabase
      .from("orders")
      .select("*")
      .eq("id", data.orderId)
      // Явная привязка к владельцу поверх RLS: подмена id в URL не отдаёт чужой заказ.
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Заказ не найден");

    const [events, docs] = await Promise.all([
      supabase
        .from("order_events")
        .select("*")
        .eq("order_id", data.orderId)
        .order("created_at", { ascending: true }),
      db.from("order_documents").select("*").eq("order_id", data.orderId),
    ]);
    return { order, events: events.data ?? [], documents: docs.data ?? [] };
  });

export const updateProfile = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { full_name: string; phone: string }) =>
    z
      .object({
        full_name: z.string().trim().max(120),
        phone: z.string().trim().max(32),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.db
      .from("profiles")
      .update({ full_name: data.full_name, phone: data.phone })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addCompanyByInn = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { inn: string }) => ({
    inn: z
      .string()
      .trim()
      .regex(/^\d{10}(\d{2})?$/, "ИНН содержит 10 цифр (юрлицо) или 12 цифр (ИП)")
      .parse(input.inn),
  }))
  .handler(async ({ data, context }) => {
    const { findPartyByInn } = await import("@/lib/dadata.server");
    const party = await findPartyByInn(data.inn);

    // Реестр недоступен или ИНН свежий — карточку всё равно создаём,
    // менеджер и клиент дозаполнят реквизиты вручную, воронка не рвётся.
    const { data: row, error } = await context.db
      .from("companies")
      .upsert(
        {
          user_id: context.userId,
          inn: party.inn,
          kpp: party.kpp,
          name: party.name || `Контрагент ИНН ${data.inn}`,
          legal_address: party.legalAddress,
          ogrn: party.ogrn,
          director: party.director,
          registry_status: party.status,
          requisites_source: party.source,
        },
        { onConflict: "user_id,inn" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { ...row, resolved: Boolean(party.name), blocked: party.blocked };
  });


export const removeCompany = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { id: string }) => ({ id: uuid.parse(input.id) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.db.from("companies").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const itemSchema = z.object({
  sku: z.string().max(64),
  name: z.string().max(240),
  quantity: z.number().int().min(1).max(1_000_000),
  unit: z.number().min(0),
  sum: z.number().min(0),
});

/** Сохраняет оформленный заказ в кабинет: карточка + первый этап + счёт. */
export const saveOrderToCabinet = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        number: z.string().max(64),
        items: z.array(itemSchema).min(1).max(500),
        goodsPrice: z.number().min(0),
        deliveryPrice: z.number().min(0),
        total: z.number().min(0),
        carrier: z.enum(["cdek", "dl", "pickup"]),
        city: z.string().max(160).default(""),
        companyId: z.string().uuid().nullish(),
        deferred: z.boolean().default(false),
        invoiceUrl: z.string().url().max(1000).nullish(),
        /** Ключ идемпотентности: 5 кликов «Оформить» дают ровно один заказ. */
        idempotencyKey: z.string().trim().min(8).max(80).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const emailVerified =
      (claims as { email_verified?: boolean; user_metadata?: { email_verified?: boolean } })
        ?.email_verified ??
      (claims as { user_metadata?: { email_verified?: boolean } })?.user_metadata?.email_verified ??
      false;
    if (!emailVerified) {
      throw new Error(
        "Почта не подтверждена. Откройте письмо ALMAFORT и перейдите по ссылке — после этого оформление заказов в кабинете разблокируется.",
      );
    }
    // Идемпотентность: повторный клик с тем же ключом возвращает уже созданный заказ.
    if (data.idempotencyKey) {
      const { data: dup } = await supabase
        .from("orders")
        .select("id, number")
        .eq("user_id", userId)
        .eq("idempotency_key", data.idempotencyKey)
        .maybeSingle();
      if (dup) return dup;
    }

    // Защита от подмены payload в DevTools: цены и суммы пересчитываем на сервере.
    const { PRODUCTS, tierOf, unitPrice } = await import("@/data/catalog");
    const { data: loyaltyRaw } = await db.rpc("my_loyalty");
    const grade = Number((loyaltyRaw as { tier?: number } | null)?.tier ?? 1);
    const minColumn = Math.min(2, Math.max(0, grade - 1)) as 0 | 1 | 2;

    let goodsServer = 0;
    for (const item of data.items) {
      const product = PRODUCTS.find((p) => p.sku === item.sku);
      if (!product) throw new Error(`Позиция ${item.sku} больше не поставляется — обновите корзину`);
      const column = Math.max(tierOf(item.quantity, product), minColumn) as 0 | 1 | 2;
      const unit =
        column === 2
          ? product.price5000
          : column === 1
            ? product.price1000
            : unitPrice(product, item.quantity);
      goodsServer += unit * item.quantity;
    }
    goodsServer = Math.round(goodsServer);

    if (Math.abs(goodsServer - Math.round(data.goodsPrice)) > 1) {
      throw new Error("Сумма заказа не совпадает с актуальным прайсом. Обновите корзину.");
    }
    const totalServer = goodsServer + Math.round(data.deliveryPrice);
    if (Math.abs(totalServer - Math.round(data.total)) > 1) {
      throw new Error("Итог заказа пересчитан сервером. Обновите корзину и повторите оформление.");
    }

    // Версия оферты фиксируется на момент сделки и не меняется задним числом.
    const { data: offerRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "offer_version")
      .maybeSingle();
    const offerVersion =
      (offerRow?.value as { version?: string } | null)?.version ?? "v1";

    const { data: order, error } = await supabase
      .from("orders")
      .insert({
        user_id: userId,
        company_id: data.companyId ?? null,
        number: data.number,
        status: data.deferred ? "paid" : "awaiting_payment",
        items: data.items,
        delivery_price: data.deliveryPrice,
        carrier: data.carrier,
        city: data.city,
        deferred_payment: data.deferred,
        offer_version: offerVersion,
        idempotency_key: data.idempotencyKey ?? null,
        goods_price: goodsServer,
        total: totalServer,
      })
      .select("id, number")
      .single();
    if (error) {
      // Гонка параллельных кликов: уникальный индекс отдаёт уже созданный заказ.
      if (error.code === "23505" && data.idempotencyKey) {
        const { data: dup } = await supabase
          .from("orders")
          .select("id, number")
          .eq("user_id", userId)
          .eq("idempotency_key", data.idempotencyKey)
          .maybeSingle();
        if (dup) return dup;
      }
      throw new Error(error.message);
    }

    await db.from("order_events").insert({
      order_id: order.id,
      stage: data.deferred ? "paid" : "awaiting_payment",
      title: data.deferred
        ? "Отгрузка с отсрочкой платежа: заказ принят в работу"
        : "Счёт сформирован, ожидаем оплату",
    });

    if (data.invoiceUrl) {
      await db.from("order_documents").insert({
        order_id: order.id,
        kind: "invoice",
        title: `Счёт на оплату № ${order.number}`,
        url: data.invoiceUrl,
      });
    }
    return order;
  });

/** «Повторить заказ»: отдаёт состав прошлой сделки для пересбора корзины. */
export const repeatOrder = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { orderId: string }) => ({ orderId: uuid.parse(input.orderId) }))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.db
      .from("orders")
      .select("items")
      .eq("id", data.orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Заказ не найден");
    const items = z
      .array(
        z
          .object({ sku: z.string(), quantity: z.number(), unit: z.number().optional() })
          .passthrough(),
      )
      .catch([])
      .parse(order.items);

    // Свежие цены и актуальное наличие берём из текущего каталога, а не из старой сделки.
    const { PRODUCTS } = await import("@/data/catalog");
    const { unitPriceOf } = await import("@/lib/pricing");
    const lines = items.map((i) => {
      const qty = Math.max(1, Math.round(i.quantity));
      const product = PRODUCTS.find((p) => p.sku === i.sku);
      const unit = product ? unitPriceOf(product, qty) : 0;
      return {
        sku: i.sku,
        quantity: qty,
        oldUnit: typeof i.unit === "number" ? i.unit : null,
        priceChanged: typeof i.unit === "number" && Math.round(i.unit) !== Math.round(unit),
        available: Boolean(product) && !product!.is_service,
        name: product?.name ?? String(i.sku),
        unit,
        inStock: (product?.stock.qty ?? 0) >= qty,
        lead: product?.stock.lead ?? null,
      };
    });
    return {
      items: lines.filter((l) => l.available),
      unavailable: lines.filter((l) => !l.available).map((l) => l.name),
      repriced: lines.filter((l) => l.available && l.priceChanged).map((l) => l.name),
    };
  });
