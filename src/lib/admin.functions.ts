/**
 * Server-функции админ-панели. Каждая проверяет роль на бэкенде (403),
 * фронтенд-проверок недостаточно. Все изменения пишутся в Audit Trail.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";
import {
  decryptSecret,
  encryptSecret,
  logAdmin,
  maskSecret,
  requireRole,
  rolesOf,
} from "@/lib/admin.server";
import {
  buildProductMatrix,
  parseProductCsv,
  priceItems,
  VAULT_KEYS,
  VAULT_CUSTOM_GROUP,
  type AdminOrderItem,
} from "@/lib/admin-data";

const uuid = z.string().uuid();
const PAGE = 20;

export const adminMe = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const roles = await rolesOf(context.userId);
    return { roles, email: context.email };
  });

/* ── БЛОК 2. Заказы ───────────────────────────────────────────────── */

export const adminListOrders = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        page: z.number().int().min(0).max(500).default(0),
        status: z.string().max(40).optional(),
        q: z.string().max(120).optional(),
        from: z.string().max(30).optional(),
        to: z.string().max(30).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    let query = context.db
      .from("orders")
      .select("id, number, status, total, city, carrier, created_at, company_id", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * PAGE, data.page * PAGE + PAGE - 1);
    if (data.status) query = query.eq("status", data.status);
    if (data.q) query = query.ilike("number", `%${data.q}%`);
    if (data.from) query = query.gte("created_at", data.from);
    if (data.to) query = query.lte("created_at", data.to);
    const { data: rows, count, error } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0, page: data.page, pageSize: PAGE };
  });

export const adminGetOrder = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { data: order, error } = await context.db
      .from("orders")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Заказ не найден");
    const [events, docs, company] = await Promise.all([
      context.db
        .from("order_events")
        .select("*")
        .eq("order_id", data.id)
        .order("created_at", { ascending: true }),
      context.db.from("order_documents").select("*").eq("order_id", data.id),
      order.company_id
        ? context.db.from("companies").select("*").eq("id", order.company_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return {
      order,
      events: events.data ?? [],
      documents: docs.data ?? [],
      company: company.data ?? null,
    };
  });

export const adminUpdateOrderItems = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: uuid,
        updatedAt: z.string(),
        items: z
          .array(z.object({ sku: z.string().max(60), quantity: z.number().int().min(1).max(1_000_000) }))
          .min(1)
          .max(500),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { data: current, error: readErr } = await context.db
      .from("orders")
      .select("id, items, goods_price, total, delivery_price, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!current) throw new Error("Заказ не найден");
    // Оптимистическая блокировка: параллельная правка клиента не будет затёрта.
    if (current.updated_at !== data.updatedAt) {
      throw new Error("Заказ изменён параллельно. Обновите страницу и повторите.");
    }

    const priced = priceItems(data.items);
    const total = priced.goods + Number(current.delivery_price ?? 0);
    const { error } = await context.db
      .from("orders")
      .update({ items: priced.items as never, goods_price: priced.goods, total })
      .eq("id", data.id)
      .eq("updated_at", data.updatedAt);
    if (error) throw new Error(error.message);

    await logAdmin(
      context.userId,
      context.email,
      "UPDATE_ORDER_ITEMS",
      data.id,
      { items: current.items, total: current.total },
      { items: priced.items, total },
    );
    return { ok: true, total, goods: priced.goods };
  });

export const adminSetOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: uuid,
        status: z.enum([
          "awaiting_payment",
          "paid",
          "production",
          "packing",
          "shipped",
          "arrived",
          "closed",
        ]),
        title: z.string().max(160),
        note: z.string().max(600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { data: prev } = await context.db
      .from("orders")
      .select("status")
      .eq("id", data.id)
      .maybeSingle();
    const patch = {
      status: data.status,
      ...(data.status === "closed" ? { closed_at: new Date().toISOString() } : {}),
    };
    const { error } = await context.db.from("orders").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await context.db.from("order_events").insert({
      order_id: data.id,
      stage: data.status,
      title: data.title,
      note: data.note ?? null,
      source: "almafort",
    });
    await logAdmin(
      context.userId,
      context.email,
      "UPDATE_ORDER_STATUS",
      data.id,
      prev?.status ?? null,
      data.status,
    );
    return { ok: true };
  });

export const adminAttachDocument = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: uuid,
        kind: z.enum(["invoice", "upd", "contract", "other"]),
        title: z.string().min(2).max(160),
        url: z.string().url().max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { error } = await context.db.from("order_documents").insert({
      order_id: data.orderId,
      kind: data.kind,
      title: data.title,
      url: data.url,
    });
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "ATTACH_DOCUMENT",
      data.orderId,
      null,
      { kind: data.kind, title: data.title },
    );
    return { ok: true };
  });

/* ── БЛОК 3. Контрагенты ──────────────────────────────────────────── */

export const adminListCompanies = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ q: z.string().max(120).optional() }).parse(input ?? {}))
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    let query = context.db
      .from("companies")
      .select("*")
      .order("lifetime_value", { ascending: false })
      .limit(200);
    if (data.q) query = query.or(`inn.ilike.%${data.q}%,name.ilike.%${data.q}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const adminUpdateCompany = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: uuid,
        manual_tier_override: z.boolean(),
        assigned_tier: z.number().int().min(1).max(3),
        credit_allowed: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Ручное переопределение грейда и отсрочка — только владелец.
    await requireRole(context.userId, ["owner"]);
    const { data: prev } = await context.db
      .from("companies")
      .select("manual_tier_override, assigned_tier, credit_allowed")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.db
      .from("companies")
      .update({
        manual_tier_override: data.manual_tier_override,
        assigned_tier: data.assigned_tier,
        credit_allowed: data.credit_allowed,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "UPDATE_COMPANY_LOYALTY",
      data.id,
      prev ?? null,
      data,
    );
    return { ok: true };
  });

/* ── БЛОК 4. PIM ──────────────────────────────────────────────────── */

export const adminListProducts = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner", "content"]);
    const { data, error } = await context.db.from("product_overrides").select("*");
    if (error) throw new Error(error.message);
    return { rows: buildProductMatrix(data ?? []) };
  });

const overrideSchema = z.object({
  sku: z.string().min(1).max(60),
  base_price: z.number().min(0).nullable(),
  opt1_price: z.number().min(0).nullable(),
  opt2_price: z.number().min(0).nullable(),
  stock: z.number().int().min(0).nullable(),
  image_url: z.string().url().max(1000).nullable().optional(),
  model_url: z.string().url().max(1000).nullable().optional(),
  synonyms: z.array(z.string().max(60)).max(40).optional(),
  hidden: z.boolean().optional(),
});

export const adminSaveProducts = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ rows: z.array(overrideSchema).min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "content"]);
    const { error } = await context.db
      .from("product_overrides")
      .upsert(data.rows as never, { onConflict: "sku" });
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "UPDATE_PRODUCTS",
      data.rows.map((r) => r.sku).join(", ").slice(0, 200),
      null,
      data.rows,
    );
    return { ok: true, updated: data.rows.length };
  });

export const adminImportProductsCsv = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ csv: z.string().max(2_000_000) }).parse(input))
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "content"]);
    const parsed = parseProductCsv(data.csv);
    if (parsed.errors.length) return { ok: false, errors: parsed.errors, updated: 0 };
    const { error } = await context.db
      .from("product_overrides")
      .upsert(parsed.rows as never, { onConflict: "sku" });
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "BATCH_IMPORT_CSV",
      `${parsed.rows.length} SKU`,
      null,
      parsed.rows.slice(0, 50),
    );
    return { ok: true, errors: [], updated: parsed.rows.length };
  });

/* ── БЛОК 5. ИИ ───────────────────────────────────────────────────── */

export const adminGetAi = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner"]);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [prompts, logs] = await Promise.all([
      context.db
        .from("llm_prompts")
        .select("*")
        .order("version", { ascending: false })
        .limit(30),
      context.db
        .from("llm_logs")
        .select("*")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    const rows = logs.data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const stat = (list: typeof rows) => ({
      tokens: list.reduce((s, r) => s + (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0), 0),
      cost: list.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0),
      calls: list.length,
    });
    return {
      prompts: prompts.data ?? [],
      logs: rows,
      usage: {
        day: stat(rows.filter((r) => String(r.created_at).slice(0, 10) === today)),
        month: stat(rows),
      },
    };
  });

export const adminSavePrompt = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({ slot: z.enum(["configurator", "vision"]), content: z.string().min(20).max(20000) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner"]);
    const { data: last } = await context.db
      .from("llm_prompts")
      .select("version, content")
      .eq("slot", data.slot)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const version = (last?.version ?? 0) + 1;
    await context.db.from("llm_prompts").update({ is_active: false }).eq("slot", data.slot);
    const { error } = await context.db
      .from("llm_prompts")
      .insert({
        slot: data.slot,
        version,
        content: data.content,
        is_active: true,
        created_by: context.userId,
      });
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "UPDATE_PROMPT",
      `${data.slot} v${version}`,
      last?.content ?? null,
      data.content,
    );
    return { ok: true, version };
  });

export const adminRollbackPrompt = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) => z.object({ id: uuid }).parse(input))
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner"]);
    const { data: target } = await context.db
      .from("llm_prompts")
      .select("id, slot, version")
      .eq("id", data.id)
      .maybeSingle();
    if (!target) throw new Error("Версия не найдена");
    await context.db.from("llm_prompts").update({ is_active: false }).eq("slot", target.slot);
    await context.db.from("llm_prompts").update({ is_active: true }).eq("id", data.id);
    await logAdmin(
      context.userId,
      context.email,
      "ROLLBACK_PROMPT",
      `${target.slot} v${target.version}`,
      null,
      null,
    );
    return { ok: true };
  });

/* ── БЛОК 6. Настройки и хранилище ключей ─────────────────────────── */

export const adminGetSettings = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner"]);
    const { data, error } = await context.db.from("app_settings").select("*");
    if (error) throw new Error(error.message);
    const map = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
    const maskOf = (cipher?: string) => {
      if (!cipher) return null;
      try {
        return maskSecret(decryptSecret(cipher));
      } catch {
        return "ошибка расшифровки";
      }
    };
    const vault: Array<{
      name: string;
      label: string;
      group: string;
      masked: string | null;
      custom?: boolean;
    }> = VAULT_KEYS.map((k) => ({
      ...k,
      masked: maskOf((map[`vault:${k.name}`] as { cipher?: string } | undefined)?.cipher),
    }));

    // Пользовательские интеграции: реестр живёт в БД, а не в коде страницы.
    const custom =
      ((map["vault_custom"] as { list?: Array<{ name: string; label: string }> } | undefined)
        ?.list ?? []);
    for (const c of custom) {
      vault.push({
        name: c.name,
        label: c.label,
        group: VAULT_CUSTOM_GROUP,
        masked: maskOf((map[`vault:${c.name}`] as { cipher?: string } | undefined)?.cipher),
        custom: true,
      });
    }

    return {
      maintenance: (map["maintenance_mode"] as { enabled: boolean; message: string }) ?? {
        enabled: false,
        message: "",
      },
      logistics: (map["logistics_markup"] as { fixed_rub: number; percent: number }) ?? {
        fixed_rub: 0,
        percent: 0,
      },
      vault,
    };
  });

export const adminSaveSetting = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        key: z.enum(["maintenance_mode", "logistics_markup"]),
        value: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean()])),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner"]);
    const { data: prev } = await context.db
      .from("app_settings")
      .select("value")
      .eq("key", data.key)
      .maybeSingle();
    const { error } = await context.db
      .from("app_settings")
      .upsert(
        {
          key: data.key,
          value: data.value as never,
          is_public: data.key === "maintenance_mode",
        } as never,
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "UPDATE_SETTING",
      data.key,
      prev?.value ?? null,
      data.value,
    );
    return { ok: true };
  });

export const adminSaveApiKey = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        name: z.string().trim().min(3).max(60),
        value: z.string().min(4).max(4000),
        /** Заполняется только при добавлении новой (пользовательской) интеграции. */
        label: z.string().trim().max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner"]);
    const known = VAULT_KEYS.some((k) => k.name === data.name);

    if (!known) {
      // Динамическая интеграция: имя ключа нормализуем до безопасного ENV-формата.
      if (!/^[A-Z0-9_]{3,60}$/.test(data.name)) {
        throw new Error("Имя ключа: только латиница в верхнем регистре, цифры и «_»");
      }
      const { data: reg } = await context.db
        .from("app_settings")
        .select("value")
        .eq("key", "vault_custom")
        .maybeSingle();
      const list =
        ((reg?.value as { list?: Array<{ name: string; label: string }> } | null)?.list ?? []);
      if (!list.some((c) => c.name === data.name)) {
        if (list.length >= 40) throw new Error("Достигнут лимит пользовательских интеграций (40)");
        list.push({ name: data.name, label: data.label?.trim() || data.name });
        const { error: regErr } = await context.db
          .from("app_settings")
          .upsert(
            { key: "vault_custom", value: { list } as never, is_public: false } as never,
            { onConflict: "key" },
          );
        if (regErr) throw new Error(regErr.message);
      }
    }

    const { error } = await context.db
      .from("app_settings")
      .upsert(
        { key: `vault:${data.name}`, value: { cipher: encryptSecret(data.value) } as never, is_public: false } as never,
        { onConflict: "key" },
      );
    if (error) throw new Error(error.message);
    // Сбрасываем кеш, чтобы интеграции подхватили новый ключ немедленно.
    const { invalidateSecret } = await import("@/lib/vault.server");
    invalidateSecret(data.name);
    await logAdmin(
      context.userId,
      context.email,
      "UPDATE_API_KEY",
      data.name,
      null,
      { masked: maskSecret(data.value) },
    );
    return { ok: true };
  });

/** Удаление пользовательской интеграции: и значение, и запись в реестре. */
export const adminDeleteApiKey = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ name: z.string().trim().min(3).max(60) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner"]);
    if (VAULT_KEYS.some((k) => k.name === data.name)) {
      throw new Error("Системный ключ удалить нельзя — очистите значение вручную");
    }
    const { data: reg } = await context.db
      .from("app_settings")
      .select("value")
      .eq("key", "vault_custom")
      .maybeSingle();
    const list = ((reg?.value as { list?: Array<{ name: string; label: string }> } | null)?.list ??
      []).filter((c) => c.name !== data.name);
    await context.db
      .from("app_settings")
      .upsert(
        { key: "vault_custom", value: { list } as never, is_public: false } as never,
        { onConflict: "key" },
      );
    await context.db.from("app_settings").delete().eq("key", `vault:${data.name}`);
    const { invalidateSecret } = await import("@/lib/vault.server");
    invalidateSecret(data.name);
    await logAdmin(
      context.userId,
      context.email,
      "DELETE_API_KEY",
      data.name,
      null,
      null,
    );
    return { ok: true };
  });

/* ── Персонал и журнал ────────────────────────────────────────────── */

export const adminListLogs = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ page: z.number().int().min(0).max(200).default(0) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner"]);
    const { data: rows, count, error } = await context.db
      .from("admin_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(data.page * 50, data.page * 50 + 49);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], count: count ?? 0, page: data.page };
  });

export const adminListStaff = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner"]);
    const { data, error } = await context.db
      .from("user_roles")
      .select("id, user_id, role, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = [...new Set((data ?? []).map((r) => r.user_id))];
    const { data: profiles } = ids.length
      ? await context.db.from("profiles").select("id, email, full_name").in("id", ids)
      : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };
    const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
    return {
      rows: (data ?? []).map((r) => ({
        ...r,
        email: byId.get(r.user_id)?.email ?? null,
        full_name: byId.get(r.user_id)?.full_name ?? null,
      })),
    };
  });

export const adminSetStaffRole = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        email: z.string().email().max(200),
        role: z.enum(["owner", "manager", "content"]),
        revoke: z.boolean().default(false),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner"]);
    const { data: profile } = await context.db
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();
    if (!profile) throw new Error("Пользователь с такой почтой не зарегистрирован");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.revoke && data.role === "owner") {
      // Защита от самоблокировки: последнего владельца снять нельзя.
      const { count } = await supabaseAdmin
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "owner");
      if ((count ?? 0) <= 1) {
        throw new Error(
          "Нельзя отозвать роль у единственного владельца — сначала назначьте второго владельца.",
        );
      }
    }
    if (data.revoke) {
      await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", profile.id)
        .eq("role", data.role);
    } else {
      await supabaseAdmin
        .from("user_roles")
        .upsert({ user_id: profile.id, role: data.role } as never, { onConflict: "user_id,role" });
    }
    await logAdmin(
      context.userId,
      context.email,
      data.revoke ? "REVOKE_ROLE" : "GRANT_ROLE",
      data.email,
      null,
      data.role,
    );
    return { ok: true };
  });

export type { AdminOrderItem };

/* ── БЛОК 4б. Массовая привязка контента (Master Asset) ───────────── */

const assetImageSchema = z.object({
  thumb_url: z.string().min(1).max(400_000),
  full_url: z.string().min(1).max(2_000_000),
  caption: z.string().max(300).optional(),
});

/** Список групп контента и привязанных к ним артикулов. */
export const adminListAssetGroups = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner", "content"]);
    const [groups, links] = await Promise.all([
      context.db.from("asset_groups").select("id, slug, title, description, images"),
      context.db.from("product_asset_links").select("sku, group_id"),
    ]);
    if (groups.error) throw new Error(groups.error.message);
    if (links.error) throw new Error(links.error.message);
    return { groups: groups.data ?? [], links: links.data ?? [] };
  });

/**
 * Одной транзакцией (SQL-функция link_asset_group) создаёт/обновляет пакет
 * контента и переустанавливает связи Many-to-One строго на выбранные SKU.
 */
export const adminLinkAssetGroup = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        slug: z.string().min(2).max(80).regex(/^[A-Za-z0-9._-]+$/),
        title: z.string().min(2).max(200),
        description: z.string().max(4000),
        images: z.array(assetImageSchema).max(8),
        skus: z.array(z.string().min(1).max(60)).min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "content"]);
    // EXECUTE на link_asset_group отозван у роли authenticated: вызов идёт
    // только с сервера после проверки роли выше.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: gid, error } = await supabaseAdmin.rpc("link_asset_group", {
      _slug: data.slug,
      _title: data.title,
      _description: data.description,
      _images: data.images,
      _skus: data.skus,
    });
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "LINK_ASSET_GROUP",
      `${data.slug}: ${data.skus.join(", ")}`.slice(0, 200),
      null,
      { slug: data.slug, skus: data.skus, images: data.images.length },
    );
    return { ok: true, groupId: gid as string, linked: data.skus.length };
  });

/** Очередь обмена с 1С: что не ушло и почему. */
export const adminErpJobs = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { data, error } = await context.db
      .from("erp_sync_jobs")
      .select("id, order_number, status, attempts, last_error, next_attempt_at, created_at")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

/** Ручной прогон Retry Pattern из админки — без ожидания крона. */
export const adminRetryErp = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { retryPendingOrders } = await import("@/lib/erp-1c.server");
    const result = await retryPendingOrders();
    await logAdmin(
      context.userId,
      context.email,
      "ERP_RETRY",
      `обработано ${result.processed}, синхронизировано ${result.synced}`,
      null,
      result,
    );
    return result;
  });

/* ── Оптовые заявки из карточек товара ───────────────────────────── */

/** Список заявок на спеццену: что запросили и по какому артикулу. */
export const adminBulkRequests = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { data, error } = await context.db
      .from("bulk_requests")
      .select(
        "id, sku, product_name, base_price, qty, contact_name, phone, email, inn, comment, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { rows: data ?? [] };
  });

/** Пометить заявку обработанной. */
export const adminSetBulkStatus = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: uuid, status: z.enum(["new", "in_work", "done"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireRole(context.userId, ["owner", "manager"]);
    const { error } = await context.db
      .from("bulk_requests")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAdmin(
      context.userId,
      context.email,
      "bulk_request_status",
      data.id,
      null,
      { status: data.status },
    );
    return { ok: true };
  });
