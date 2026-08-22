import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Единая точка приёма пушей от СДЭК (v2) и Деловых Линий.
 * ТК присылают смену статуса груза — мы транслируем её в таймлайн ЛК,
 * чтобы клиент не ходил на сайты перевозчиков.
 *
 * Авторизация: общий токен в заголовке X-Almafort-Token (задаётся в ЛК перевозчика).
 */

const payload = z.object({
  carrier: z.enum(["cdek", "dl"]),
  tracking_number: z.string().trim().min(3).max(64),
  /** Внутренний этап ALMAFORT, в который переводим заказ */
  stage: z.enum(["shipped", "arrived", "closed"]),
  note: z.string().trim().max(500).optional(),
  pvz_address: z.string().trim().max(300).optional(),
  storage_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const STAGE_TITLE: Record<string, string> = {
  shipped: "Груз принят транспортной компанией",
  arrived: "Груз прибыл в терминал назначения",
  closed: "Груз получен клиентом",
};

export const Route = createFileRoute("/api/public/webhooks/carrier")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["CARRIER_WEBHOOK_TOKEN"];
        if (!secret) {
          return Response.json({ error: "Webhook is not configured" }, { status: 503 });
        }
        const token = request.headers.get("x-almafort-token") ?? "";
        if (token.length !== secret.length || token !== secret) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        let body: z.infer<typeof payload>;
        try {
          body = payload.parse(await request.json());
        } catch {
          return Response.json({ error: "Bad payload" }, { status: 400 });
        }

        const { db: store } = await import("@/lib/db.server");
        const { data: order, error } = await store
          .from("orders")
          .select("id")
          .eq("tracking_number", body.tracking_number)
          .maybeSingle();
        if (error) return Response.json({ error: "Storage error" }, { status: 500 });
        if (!order) return Response.json({ ok: true, matched: false });

        await store
          .from("orders")
          .update({
            status: body.stage,
            ...(body.pvz_address ? { pvz_address: body.pvz_address } : {}),
            ...(body.storage_until ? { storage_until: body.storage_until } : {}),
            ...(body.stage === "closed" ? { closed_at: new Date().toISOString() } : {}),
          })
          .eq("id", order.id);

        await store.from("order_events").insert({
          order_id: order.id,
          stage: body.stage,
          title: STAGE_TITLE[body.stage] ?? "Обновление статуса",
          note: body.note ?? null,
          source: body.carrier,
        });

        return Response.json({ ok: true, matched: true });
      },
    },
  },
});
