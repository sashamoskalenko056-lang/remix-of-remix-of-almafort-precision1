import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { maintenanceResponse, trailingSlashRedirect } from "./lib/seo-guard.server";
import { ensureServerWebSocket } from "./lib/ws-polyfill.server";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

// Node < 22 без глобального WebSocket роняет supabase-js на createClient —
// подставляем полифилл до любого серверного кода (SSR и server functions).
const wsMiddleware = createMiddleware().server(async ({ next }) => {
  await ensureServerWebSocket();
  return next();
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

// SEO-предохранители: один 301 со слеша на конце и жёсткий 503 в режиме техработ.
const seoGuardMiddleware = createMiddleware().server(async ({ next, request }) => {
  const url = new URL(request.url);
  const redirect = trailingSlashRedirect(url);
  if (redirect) return redirect;
  const maintenance = await maintenanceResponse(url);
  if (maintenance) return maintenance;
  return next();
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware, seoGuardMiddleware],
}));
