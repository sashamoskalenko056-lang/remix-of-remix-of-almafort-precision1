import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const schema = z.object({
  orderNumber: z.string().trim().min(1).max(64),
  status: z.string().trim().min(1).max(64),
  trackingNumber: z.string().trim().max(64).nullish(),
});

/**
 * 1С → сайт: событийный вебхук смены статуса.
 * Бухгалтер проводит «Поступление на расчётный счёт» — заказ на сайте
 * мгновенно двигается по таймлайну личного кабинета.
 */
export const Route = createFileRoute("/api/public/erp/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { secretValue } = await import("@/lib/vault.server");
        const token = await secretValue("ERP_1C_TOKEN");
        if (!token || request.headers.get("X-Almafort-Erp-Token") !== token) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: z.infer<typeof schema>;
        try {
          body = schema.parse(await request.json());
        } catch {
          return Response.json({ error: "Некорректный пакет" }, { status: 400 });
        }

        const { ERP_STATUS_MAP } = await import("@/lib/erp-1c.server");
        const status = ERP_STATUS_MAP[body.status];
        if (!status) return Response.json({ error: "Неизвестный статус" }, { status: 400 });

        const { db: store } = await import("@/lib/db.server");
        const patch: Record<string, unknown> = { status };
        if (body.trackingNumber) patch["tracking_number"] = body.trackingNumber;
        if (status === "closed") patch["closed_at"] = new Date().toISOString();

        const { data, error } = await store
          .from("orders")
          .update(patch as never)
          .eq("number", body.orderNumber)
          .select("id, status")
          .maybeSingle();

        if (error) {
          console.error("[1c] status update failed", error.message);
          return Response.json({ error: "Не удалось обновить заказ" }, { status: 500 });
        }
        if (!data) return Response.json({ error: "Заказ не найден" }, { status: 404 });

        return Response.json({ ok: true, orderNumber: body.orderNumber, status });
      },
    },
  },
});
