/**
 * Node < 22 не имеет глобального WebSocket, а supabase-js (Realtime) требует его
 * уже на этапе createClient и падает с
 * «Node.js detected but native WebSocket not found».
 * На VPS (node-server) подставляем реализацию из пакета `ws` через createRequire,
 * чтобы бандлер edge-сборки вообще не видел этот импорт.
 * В Cloudflare/Workers и в браузере ничего не делаем — WebSocket там есть.
 */
let installed = false;

export async function ensureServerWebSocket(): Promise<void> {
  if (installed) return;
  const g = globalThis as {
    WebSocket?: unknown;
    process?: { versions?: { node?: string } };
  };
  if (typeof g.WebSocket !== "undefined") {
    installed = true;
    return;
  }
  if (!g.process?.versions?.node) return;

  const impl = (await loadViaRequire()) ?? (await loadViaImport());
  if (impl) {
    g.WebSocket = impl;
    installed = true;
  }
}

type WsModule = { default?: unknown; WebSocket?: unknown };

async function loadViaRequire(): Promise<unknown> {
  try {
    const moduleSpecifier = "node:module";
    const { createRequire } = (await import(/* @vite-ignore */ moduleSpecifier)) as {
      createRequire: (path: string) => (id: string) => WsModule;
    };
    const req = createRequire(import.meta.url);
    const mod = req("ws");
    return mod.WebSocket ?? mod.default ?? mod;
  } catch {
    return null;
  }
}

async function loadViaImport(): Promise<unknown> {
  try {
    // Спецификатор через переменную: бандлер edge-сборки не тянет `ws` в граф.
    const specifier = "ws";
    const mod = (await import(/* @vite-ignore */ specifier)) as WsModule;
    return mod.WebSocket ?? mod.default ?? null;
  } catch {
    return null;
  }
}
