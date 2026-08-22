/** Выход: гасим HttpOnly-куку сессии. */
import { createFileRoute } from "@tanstack/react-router";
import { clearSessionCookie } from "@/lib/session-cookie.server";

export const Route = createFileRoute("/api/auth/logout")({
  server: {
    handlers: {
      POST: async ({ request }) =>
        Response.json(
          { ok: true },
          { status: 200, headers: { "Set-Cookie": clearSessionCookie(request) } },
        ),
    },
  },
});
