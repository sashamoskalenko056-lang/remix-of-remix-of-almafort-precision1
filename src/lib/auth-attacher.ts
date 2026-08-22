import { createMiddleware } from "@tanstack/react-start";
import { authToken } from "@/lib/session";

/** Подставляет наш токен в каждый вызов server-функции. */
export const attachAuth = createMiddleware({ type: "function" }).client(async ({ next }) => {
  const token = authToken();
  return next({ headers: token ? { Authorization: `Bearer ${token}` } : {} });
});
