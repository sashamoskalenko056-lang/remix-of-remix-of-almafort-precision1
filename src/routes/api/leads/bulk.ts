/**
 * Заявка на спеццену по крупной партии из карточки товара.
 * Пишется в public.bulk_requests (service role) и дублируется в CRM.
 */
import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/rate-limit.server";
import { z } from "zod";
import { pushQuizLead } from "@/lib/quiz-crm.server";
import { PRODUCTS } from "@/data/catalog";

const schema = z.object({
  sku: z.string().trim().min(1).max(60),
  product_name: z.string().trim().min(1).max(200),
  base_price: z.number().nonnegative().max(10_000_000).default(0),
  qty: z.number().int().min(1000).max(100_000_000),
  contact_name: z.string().trim().min(2).max(80),
  phone: z.string().trim().min(10).max(24),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  inn: z.string().trim().regex(/^\d{10}$|^\d{12}$/).optional().or(z.literal("")),
  comment: z.string().trim().max(1000).optional().or(z.literal("")),
});

export const Route = createFileRoute("/api/leads/bulk")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = rateLimit(request, "bulk", { limit: 10, windowMs: 60_000, blockMs: 300_000 });
        if (limited) return limited;
        const raw = await request.json().catch(() => null);
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Проверьте поля формы" }, { status: 400 });
        }
        const d = parsed.data;

        // Синхронизация с остатком: заявка уходит всегда, но менеджер видит,
        // что объём превышает склад и требуется дозаказ на производстве.
        const stock = PRODUCTS.find((p) => p.sku === d.sku)?.stock.qty ?? 0;
        const exceedsStock = d.qty > stock;
        const stockNote = exceedsStock
          ? `Запрос превышает текущий складской остаток (${stock.toLocaleString("ru-RU")} шт) — требуется дозаказ на производстве`
          : null;

        const { db: store } = await import("@/lib/db.server");
        const { error } = await store.from("bulk_requests").insert({
          sku: d.sku,
          product_name: d.product_name,
          base_price: d.base_price,
          qty: d.qty,
          contact_name: d.contact_name,
          phone: d.phone,
          email: d.email || null,
          inn: d.inn || null,
          comment: [d.comment || null, stockNote].filter(Boolean).join(' | ') || null,
        });
        if (error) {
          console.error("[bulk-lead] не записана заявка:", error.message);
          return Response.json({ error: "Не удалось сохранить заявку" }, { status: 500 });
        }

        // Дубль в CRM — менеджер видит заявку там же, где остальные лиды.
        await pushQuizLead({
          name: d.contact_name,
          phone: d.phone,
          ...(d.email ? { email: d.email } : {}),
          quiz_answers: {
            "Запрос спеццены на товар": `${d.product_name} (${d.sku})`,
            "Желаемый объем": `${d.qty.toLocaleString("ru-RU")} шт`,
            "Базовая цена": `${d.base_price} ₽`,
            ...(d.inn ? { ИНН: d.inn } : {}),
            ...(d.comment ? { Комментарий: d.comment } : {}),
            "Складской остаток": `${stock.toLocaleString("ru-RU")} шт`,
            ...(stockNote ? { "⚠ Дозаказ": stockNote } : {}),
          },
          file_urls: [],
        }).catch((e) => console.warn("[bulk-lead] CRM недоступна:", String(e)));

        return Response.json({ ok: true, exceedsStock, stock });
      },
    },
  },
});
