/**
 * Проверка кода. При успехе выдаёт JWT в HttpOnly-куке
 * (Secure на HTTPS, SameSite=Strict) — токен недоступен из JS.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sessionCookie } from "@/lib/session-cookie.server";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(160),
  code: z.string().trim().regex(/^\d{4}$/, "Код состоит из 4 цифр"),
});

export const Route = createFileRoute("/api/auth/otp-verify")({
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
          return Response.json({ status: "wrong", error: "Введите 4 цифры" }, { status: 400 });
        }

        const { verifyOtp } = await import("@/lib/otp.server");
        const result = await verifyOtp(parsed.data.email, parsed.data.code);

        if (result.status === "expired") {
          return Response.json(
            { status: "expired", error: "Время действия кода истекло. Запросите новый." },
            { status: 400 },
          );
        }
        if (result.status === "locked") {
          return Response.json(
            { status: "locked", error: "Попытки исчерпаны. Запросите код заново." },
            { status: 429 },
          );
        }
        if (result.status === "wrong") {
          return Response.json(
            {
              status: "wrong",
              attemptsLeft: result.attemptsLeft,
              error: `Неверный код. Осталось попыток: ${result.attemptsLeft}`,
            },
            { status: 401 },
          );
        }

        return Response.json(
          {
            status: "ok",
            isNew: result.isNew,
            expiresAt: result.expiresAt,
            user: result.user,
          },
          {
            status: 200,
            headers: {
              "Set-Cookie": sessionCookie(request, result.token, result.expiresAt),
            },
          },
        );
      },
    },
  },
});
