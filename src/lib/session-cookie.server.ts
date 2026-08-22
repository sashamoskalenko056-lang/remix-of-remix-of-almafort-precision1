/**
 * Сессионная кука ALMAFORT: HttpOnly + SameSite=Strict (+ Secure на HTTPS).
 * Токен НИКОГДА не попадает в localStorage — только в куку, недоступную JS.
 */
export const SESSION_COOKIE = "almafort_session";

function isHttps(request: Request) {
  try {
    return (
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https"
    );
  } catch {
    return false;
  }
}

export function sessionCookie(request: Request, token: string, expiresAtSec: number): string {
  const maxAge = Math.max(60, expiresAtSec - Math.floor(Date.now() / 1000));
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${maxAge}`,
  ];
  // Secure нельзя ставить на http — иначе браузер молча выбросит куку
  // (self-host по IP до выпуска сертификата).
  if (isHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request: Request): string {
  const parts = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isHttps(request)) parts.push("Secure");
  return parts.join("; ");
}

/** Достаёт токен из заголовка Cookie входящего запроса. */
export function readSessionCookie(request: Request | undefined | null): string | null {
  const raw = request?.headers?.get("cookie");
  if (!raw) return null;
  for (const chunk of raw.split(";")) {
    const [name, ...rest] = chunk.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}
