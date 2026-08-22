/**
 * Проверка сессии для server-функций. Токен приходит в заголовке Authorization,
 * подпись проверяется локально — внешние сервисы не участвуют.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { verifyToken } = await import("@/lib/auth.server");
  const { db } = await import("@/lib/db.server");

  const request = getRequest();
  const header = request?.headers?.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Unauthorized: сессия не найдена");
  }
  const claims = verifyToken(header.slice(7));
  if (!claims) throw new Error("Unauthorized: сессия истекла");

  return next({
    context: {
      db,
      userId: claims.sub,
      email: claims.email,
      claims,
    },
  });
});
