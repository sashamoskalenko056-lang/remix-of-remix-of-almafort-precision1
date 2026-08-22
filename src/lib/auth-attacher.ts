import { createMiddleware, type CustomFetch } from "@tanstack/react-start";
import { clearSession } from "@/lib/session";

/**
 * Сессия передаётся HttpOnly-кукой, поэтому заголовок Authorization не нужен.
 * Здесь остаётся жёсткая обработка 401: сервер отвечает мгновенно, а клиент
 * обязан превратить этот ответ в ошибку, иначе тело `{ error: "Unauthorized" }`
 * уедет в компонент как «данные» и кабинет зависнет вместо редиректа на /auth.
 */
export const attachAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const guardedFetch: CustomFetch = async (url, init) => {
    const response = await fetch(url, { ...init, credentials: "same-origin" });
    if (response.status === 401) {
      clearSession();
      throw new Error("401 Unauthorized: сессия истекла, войдите заново");
    }
    return response;
  };

  return next({ fetch: guardedFetch });
});
