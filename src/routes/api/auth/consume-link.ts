/**
 * Экстренное восстановление доступа по одноразовой ссылке из письма.
 * Ссылка живёт 15 минут, срабатывает один раз и сразу выдаёт HttpOnly-сессию.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { sessionCookie } from "@/lib/session-cookie.server";

const Body = z.object({ token: z.string().min(10).max(400) });

export const Route = createFileRoute("/api/auth/consume-link")({
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
        if (!parsed.success) return Response.json({ error: "Ссылка повреждена" }, { status: 400 });

        const { consumeActionToken, findUserById, markEmailVerified, issueToken, ensureOwnerRole } =
          await import("@/lib/auth.server");

        let userId: string | null = null;
        for (const kind of ["recovery", "magiclink", "verify"] as const) {
          userId = await consumeActionToken(parsed.data.token, kind);
          if (userId) break;
        }
        if (!userId) {
          return Response.json(
            { error: "Ссылка недействительна или истекла. Запросите код на странице входа." },
            { status: 400 },
          );
        }

        await markEmailVerified(userId);
        const user = await findUserById(userId);
        if (!user) return Response.json({ error: "Пользователь не найден" }, { status: 400 });
        await ensureOwnerRole(user);

        const { token, expiresAt } = issueToken(user);
        return Response.json(
          { ok: true, user, expiresAt },
          { status: 200, headers: { "Set-Cookie": sessionCookie(request, token, expiresAt) } },
        );
      },
    },
  },
});
