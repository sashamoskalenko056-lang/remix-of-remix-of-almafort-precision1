/**
 * Серверные SEO-предохранители, выполняемые до рендера:
 *  1) строгий 301 со слеша на конце (единственный шаг, без цепочек редиректов);
 *  2) режим техработ отдаёт 503 + Retry-After вместо 200/500.
 */

const MAINTENANCE_TTL_MS = 30_000;
const DEFAULT_RETRY_AFTER = 7200;

type Maintenance = { enabled: boolean; message: string; retryAfter: number };

let cache: { at: number; value: Maintenance } | null = null;

/** Пути, которым нельзя блокироваться: персонал, вход и служебные API. */
function isExempt(pathname: string): boolean {
  return (
    pathname.startsWith("/admin-alma-secure-2026") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_serverFn") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap")
  );
}

export function trailingSlashRedirect(url: URL): Response | null {
  if (url.pathname === "/" || !url.pathname.endsWith("/")) return null;
  const target = new URL(url.toString());
  target.pathname = url.pathname.replace(/\/+$/, "");
  return new Response(null, { status: 301, headers: { Location: target.pathname + target.search } });
}

async function readMaintenance(): Promise<Maintenance> {
  const now = Date.now();
  if (cache && now - cache.at < MAINTENANCE_TTL_MS) return cache.value;

  let value: Maintenance = { enabled: false, message: "", retryAfter: DEFAULT_RETRY_AFTER };

  try {
    const { db } = await import("@/lib/db.server");
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle();
    const v = (data?.["value"] ?? null) as
      | { enabled?: boolean; message?: string; retry_after?: number }
      | null;
    value = {
      enabled: Boolean(v?.enabled),
      message: v?.message ?? "",
      retryAfter: Number(v?.retry_after) > 0 ? Number(v?.retry_after) : DEFAULT_RETRY_AFTER,
    };
  } catch {
    // Недоступность настроек не должна ронять сайт — работаем в обычном режиме.
  }

  cache = { at: now, value };
  return value;
}

function maintenanceHtml(message: string): string {
  const text = message || "Приём заказов временно приостановлен. Скоро вернёмся.";
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Технические работы — ALMAFORT</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center">
<main><h1>Идут технические работы</h1><p>${text.replace(/[<>&]/g, "")}</p></main></body></html>`;
}

/** Возвращает 503-ответ, если включён режим техработ и путь не исключён. */
export async function maintenanceResponse(url: URL): Promise<Response | null> {
  if (isExempt(url.pathname)) return null;
  const state = await readMaintenance();
  if (!state.enabled) return null;
  return new Response(maintenanceHtml(state.message), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Retry-After": String(state.retryAfter),
      "Cache-Control": "no-store",
    },
  });
}
