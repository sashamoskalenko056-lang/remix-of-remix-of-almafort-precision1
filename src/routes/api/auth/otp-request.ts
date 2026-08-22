/**
 * Отправка одноразового кода входа. Единый флоу: новый email = регистрация,
 * существующий = вход. Пароли не участвуют.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(160) });

export const Route = createFileRoute("/api/auth/otp-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return Response.json({ error: "Некорректный запрос" }, { status: 400 });
        }
        const parsed = Body.safeParse(raw);
        if (!parsed.success) {
          return Response.json({ error: "Укажите корректный e-mail" }, { status: 400 });
        }

        const { clientIp } = await import("@/lib/rate-limit.server");
        const { requestOtp } = await import("@/lib/otp.server");
        const ip = clientIp(request);

        try {
          const result = await requestOtp(parsed.data.email, ip);
          if (!result.ok) {
            return Response.json(
              {
                error: `Запросить новый код можно через ${result.retryAfter} сек.`,
                retryAfter: result.retryAfter,
              },
              { status: 429, headers: { "Retry-After": String(result.retryAfter) } },
            );
          }
          return Response.json({ ok: true, ttl: result.ttl });
        } catch (e) {
          console.error("[otp] не удалось отправить код", e);
          return Response.json(
            { error: "Почтовый сервер недоступен. Повторите позже." },
            { status: 502 },
          );
        }
      },
    },
  },
});
