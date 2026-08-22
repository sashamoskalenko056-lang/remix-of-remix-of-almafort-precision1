/**
 * Проверка сессии для server-функций. Токен приходит в HttpOnly-куке
 * (основной путь) либо в заголовке Authorization (совместимость),
 * подпись проверяется локально — внешние сервисы не участвуют.
 *
 * Важно: при отсутствии/протухании токена отвечаем МГНОВЕННО 401 JSON.
 * Никаких обращений к базе до проверки подписи — пустая локальная БД
 * не должна приводить к «висящему» запросу и вечным скелетонам в кабинете.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { readSessionCookie } from "@/lib/session-cookie.server";

/** Мгновенный 401 с предсказуемым JSON-телом — без 500-страниц и «висящих» запросов. */
function unauthorized(reason: string): Response {
  return new Response(JSON.stringify({ error: "Unauthorized", reason }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const requireAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const request = getRequest();
  const header = request?.headers?.get("authorization") ?? "";
  const raw = header.startsWith("Bearer ")
    ? header.slice(7).trim()
    : (readSessionCookie(request) ?? "");

  if (raw.split(".").length !== 3) throw unauthorized("сессия не найдена");

  const { verifyToken } = await import("@/lib/auth.server");
  let claims: ReturnType<typeof verifyToken> = null;
  try {
    claims = verifyToken(raw);
  } catch (error) {
    // Например, не задан AUTH_SECRET: сообщаем в лог, но клиенту отдаём 401,
    // чтобы интерфейс ушёл на /auth, а не завис в загрузке.
    console.error("[auth] проверка токена невозможна:", error);
    throw unauthorized("сессия не проверена");
  }
  if (!claims) throw unauthorized("сессия истекла");

  const { db } = await import("@/lib/db.server");
  return next({
    context: { db, userId: claims.sub, email: claims.email, claims },
  });
});
