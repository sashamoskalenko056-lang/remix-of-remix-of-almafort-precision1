/**
 * Node < 22 не имеет глобального WebSocket, а supabase-js (Realtime) требует его
 * уже на этапе createClient и падает с
 * «Node.js detected but native WebSocket not found».
 * На VPS (node-server) подставляем реализацию из пакета `ws`.
 * В Cloudflare/Workers и в браузере ничего не делаем — WebSocket там есть.
 */
export async function ensureServerWebSocket(): Promise<void> {
  const g = globalThis as { WebSocket?: unknown; process?: { versions?: { node?: string } } };
  if (typeof g.WebSocket !== "undefined") return;
  if (!g.process?.versions?.node) return;
  try {
    const mod = (await import("ws")) as unknown as { default?: unknown; WebSocket?: unknown };
    const impl = (mod.WebSocket ?? mod.default) as unknown;
    if (impl) g.WebSocket = impl;
  } catch {
    // Пакет недоступен (edge-сборка) — оставляем как есть.
  }
}
