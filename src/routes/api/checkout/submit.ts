import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit.server";
import { readJson, SlowRequestError, timeoutResponse } from "@/lib/request-guard.server";
import { requiredFieldsResponse, zEmail, zInn, zName, zPhone } from "@/lib/required-fields";

/** Обрезаем длинные строки вместо отказа: юрназвания и адреса из ЕГРЮЛ бывают очень длинными. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .transform((s) => s.slice(0, max));

const schema = z.object({
  // ФИО, телефон и почта обязательны: без них счёт выставить не по кому.
  customer: z.object({
    name: zName,
    phone: zPhone,
    email: zEmail,
    company: text(300).nullish(),
    comment: text(2000).nullish(),
  }),
  // Реквизиты плательщика: 1С мэтчит контрагента именно по ИНН.
  // ИНН плательщика обязателен: 1С мэтчит контрагента именно по нему.
  inn: zInn,
  kpp: text(12).nullish().catch(null),
  city: text(300).default(""),
  carrier: z.enum(["cdek", "dl", "pickup"]),
  deliveryPrice: z.coerce.number().min(0).max(1_000_000).catch(0),
  goodsPrice: z.coerce.number().min(0).max(1_000_000_000).catch(0),
  total: z.coerce.number().min(0).max(1_000_000_000).catch(0),
  items: z
    .array(
      z.object({
        sku: text(64),
        name: text(500),
        quantity: z.coerce.number().int().min(1).max(1_000_000),
        unit: z.coerce.number().min(0),
        sum: z.coerce.number().min(0),
      }),
    )
    .min(1)
    .max(500),
  // PDF-счёт, сгенерированный на клиенте (pdfmake), в base64 — без префикса data:
  invoicePdfBase64: z
    .string()
    .nullish()
    // Слишком большое вложение не роняет заказ — счёт пересоберётся на сервере.
    .transform((s) => (s && s.length <= 12_000_000 ? s : null)),
});


const CARRIER_LABEL = {
  cdek: "СДЭК",
  dl: "Деловые Линии",
  pickup: "Самовывоз",
} as const;

function b64ToBytes(b64: string) {
  const clean = b64.includes(",") ? (b64.split(",")[1] ?? "") : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const Route = createFileRoute("/api/checkout/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Оформление — тяжёлая транзакция (S3 + CRM + 1С): не чаще 10 в минуту с IP.
        const limited = rateLimit(request, "checkout", {
          limit: 10,
          windowMs: 60_000,
          blockMs: 10 * 60_000,
        });
        if (limited) return limited;

        let parsed;
        try {
          parsed = schema.parse(await readJson(request));
        } catch (e) {
          if (e instanceof SlowRequestError) return timeoutResponse();
          // Показываем клиенту конкретное поле, а не общую фразу.
          const issues =
            e instanceof z.ZodError
              ? e.issues.map((i) => `${i.path.join(".") || "форма"}: ${i.message}`)
              : [String(e)];
          console.error("[checkout] validation failed", issues);
          return Response.json(
            { error: `Проверьте данные заказа — ${issues.join("; ")}`, detail: issues },
            { status: 400 },
          );

        }

        try {
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
        let invoiceUrl: string | null = null;
        let storageNote: string | undefined;

        if (parsed.invoicePdfBase64) {
          try {
            const { uploadInvoice } = await import("@/lib/s3.server");
            const res = await uploadInvoice(
              `Schet_Almafort_${stamp}.pdf`,
              b64ToBytes(parsed.invoicePdfBase64),
            );
            invoiceUrl = res.url;
            storageNote = res.skipped;
          } catch (e) {
            console.error("[checkout] upload failed", e);
            storageNote = "Ошибка загрузки счёта в хранилище";
          }
        }

        const { pushToCrm } = await import("@/lib/crm.server");
        const crmOrder = {
          customer: {
            name: parsed.customer.name,
            phone: parsed.customer.phone,
            ...(parsed.customer.email ? { email: parsed.customer.email } : {}),
            ...(parsed.customer.company ? { company: parsed.customer.company } : {}),
            ...(parsed.customer.comment ? { comment: parsed.customer.comment } : {}),
          },
          city: parsed.city,
          carrierLabel: CARRIER_LABEL[parsed.carrier],
          deliveryPrice: parsed.deliveryPrice,
          goodsPrice: parsed.goodsPrice,
          total: parsed.total,
          invoiceUrl,
          items: parsed.items,
        };
        const crm = await pushToCrm(crmOrder).catch((e) => ({
          crm: "none" as const,
          ok: false,
          detail: String(e),
        }));

        const orderNumber = `AF-${stamp}`;
        // CRM на профилактике — лид уходит в резервную очередь и переотправляется кроном.
        if (!crm.ok) {
          const { enqueueCrmLead } = await import("@/lib/crm-queue.server");
          await enqueueCrmLead(orderNumber, crmOrder, crm.detail ?? "CRM недоступна");
        }

        // Push в 1С: неудача не ломает чекаут — заказ уйдёт по Retry Pattern.
        const { enqueueOrder } = await import("@/lib/erp-1c.server");
        const erp = await enqueueOrder({
          orderNumber,
          inn: parsed.inn ?? null,
          kpp: parsed.kpp ?? null,
          companyName: parsed.customer.company ?? null,
          customer: {
            name: parsed.customer.name,
            phone: parsed.customer.phone,
            ...(parsed.customer.email ? { email: parsed.customer.email } : {}),
          },
          city: parsed.city,
          carrier: CARRIER_LABEL[parsed.carrier],
          deliveryPrice: parsed.deliveryPrice,
          goodsPrice: parsed.goodsPrice,
          total: parsed.total,
          status: "new",
          items: parsed.items,
        }).catch((e) => {
          console.error("[checkout] erp enqueue failed", e);
          return { ok: false, detail: "Очередь 1С недоступна" };
        });

        return Response.json({
          ok: true,
          orderId: orderNumber,
          invoiceUrl,
          storageNote,
          crm: crm.crm,
          crmOk: crm.ok,
          crmDetail: crm.detail,
          erpOk: erp.ok,
        });
        } catch (e) {
          // Обрыв связи с БД/хранилищем не должен ронять воркер: корзина остаётся
          // у клиента, ему предлагается повторить отправку через минуту.
          console.error("[checkout] fatal", e);
          return Response.json(
            {
              error:
                "Проблемы с сохранением заказа. Мы уже восстанавливаем связь, повторите попытку через 1 минуту.",
              retryable: true,
            },
            { status: 503, headers: { "Retry-After": "60" } },
          );
        }
      },
    },
  },
});
