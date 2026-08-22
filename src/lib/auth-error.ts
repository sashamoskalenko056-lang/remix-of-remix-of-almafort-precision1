/**
 * Определение «протухшей» сессии: серверные функции с requireAuth
 * отвечают 401/Unauthorized, если bearer-токен отсутствует или истёк.
 */
export function isAuthError(error: unknown): boolean {
  if (!error) return false;
  if (typeof error === "object") {
    const e = error as { status?: number; statusCode?: number; message?: string };
    if (e.status === 401 || e.statusCode === 401) return true;
    if (typeof e.message === "string") return /401|unauthor/i.test(e.message);
  }
  if (typeof error === "string") return /401|unauthor/i.test(error);
  return false;
}
