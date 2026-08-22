import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { MobileTabBar } from "@/components/mobile-tab-bar";
import { ClientOnly } from "@/components/client-only";
import { registerServiceWorker } from "@/lib/pwa";



function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { name: "theme-color", content: "#E52421" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "apple-mobile-web-app-title", content: "ALMAFORT" },
      { title: "ALMAFORT — производство пластиковой фурнитуры" },
      {
        name: "description",

        content: "Производитель пластиковых комплектующих для B2B: литьё, 3D-печать, ЭДО.",
      },
      { name: "author", content: "ALMAFORT" },
      { property: "og:title", content: "ALMAFORT — производство пластиковой фурнитуры" },
      {
        property: "og:description",
        content: "Производитель пластиковых комплектующих для B2B: литьё, 3D-печать, ЭДО.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;800&display=swap",
      },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/icons/apple-touch-icon.png", sizes: "180x180" },

    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

import { CartSync } from "@/components/cart-sync";
import { NetworkWatcher } from "@/components/network-watcher";

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <CartSync />
        <NetworkWatcher />
        <Scripts />
      </body>
    </html>
  );
}

/** Режим техработ: включается в панели управления, персонал внутрь пускаем. */
function MaintenanceGate() {
  const location = useLocation();
  const [state, setState] = useState<{ enabled: boolean; message: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void supabase
      .from("app_settings")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle()
      .then(({ data }) => {
        if (!alive) return;
        const v = (data as { value?: { enabled?: boolean; message?: string } } | null)?.value;
        setState({ enabled: Boolean(v?.enabled), message: v?.message ?? "" });
      });
    return () => {
      alive = false;
    };
  }, []);

  const exempt =
    location.pathname.startsWith("/admin-alma-secure-2026") ||
    location.pathname.startsWith("/auth");
  if (!state?.enabled || exempt) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-background/98 p-6 text-center">
      <div className="max-w-lg space-y-3">
        <h1 className="text-2xl font-bold">Идут технические работы</h1>
        <p className="text-muted-foreground">
          {state.message || "Приём заказов временно приостановлен. Скоро вернёмся."}
        </p>
      </div>
    </div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const location = useLocation();
  // В админке нижняя панель снабженца не нужна.
  const hideTabBar = location.pathname.startsWith("/admin-alma-secure-2026");

  useEffect(() => {
    registerServiceWorker();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <MaintenanceGate />
      {!hideTabBar && (
        <ClientOnly>
          <MobileTabBar />
        </ClientOnly>
      )}
      <Toaster />
    </QueryClientProvider>
  );
}


