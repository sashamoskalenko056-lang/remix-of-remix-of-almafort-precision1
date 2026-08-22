import { createMiddleware, type CustomFetch } from "@tanstack/react-start";
import { authToken, clearSession } from "@/lib/session";

/**
 * Подставляет наш токен в каждый вызов server-функции и жёстко обрабатывает 401:
 * сервер отвечает мгновенно, а клиент обязан превратить этот ответ в ошибку,
 * иначе тело `{ error: "Unauthorized" }` уедет в компонент как «данные»
 * и кабинет упадёт/зависнет вместо редиректа на /auth.
 */
export const attachAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = authToken();

  const guardedFetch: CustomFetch = async (url, init) => {
    const response = await fetch(url, init);
    if (response.status === 401) {
      clearSession();
      throw new Error("401 Unauthorized: сессия истекла, войдите заново");
    }
    return response;
  };

  return next({
    fetch: guardedFetch,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
