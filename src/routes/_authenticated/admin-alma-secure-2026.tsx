import { createFileRoute, Link, Outlet, notFound, useRouterState } from "@tanstack/react-router";
import { adminMe } from "@/lib/admin.functions";
import { ADMIN_BASE, ROLE_LABEL, can, type AdminRole } from "@/lib/admin";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Кэш RBAC-проверки: без него каждый переход между вкладками админки
 * блокировал рендер на круговом запросе ролей к бэкенду.
 */
type AdminIdentity = { roles: AdminRole[]; email: string | null };
let cached: { at: number; value: AdminIdentity } | null = null;
const TTL = 60_000;

async function loadIdentity(): Promise<AdminIdentity> {
  if (cached && Date.now() - cached.at < TTL) return cached.value;
  const me = await adminMe();
  const value: AdminIdentity = { roles: me.roles as AdminRole[], email: me.email };
  cached = { at: Date.now(), value };
  return value;
}

export const Route = createFileRoute("/_authenticated/admin-alma-secure-2026")({
  ssr: false,
  beforeLoad: async () => {
    // RBAC-гейт: обычного снабженца возвращаем в его кабинет, роль проверяет
    // бэкенд (владелец = ADMIN_OWNER_EMAIL), клиент лишь исполняет решение.
    try {
      const me = await loadIdentity();
      if (!me.roles.length) throw redirect({ to: "/cabinet", replace: true });
      return { adminRoles: me.roles, adminEmail: me.email };
    } catch (error) {
      cached = null;
      if (isRedirect(error)) throw error;
      throw redirect({ to: "/cabinet", replace: true });
    }
  },
  pendingMs: 0,
  pendingComponent: () => (
    <div className="min-h-screen bg-muted/30">
      <div className="border-b bg-background px-6 py-4">
        <Skeleton className="h-6 w-72" />
      </div>
      <div className="mx-auto max-w-[1400px] space-y-4 px-6 py-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-64 w-full rounded-md" />
      </div>
    </div>
  ),
  notFoundComponent: () => (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-2">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-muted-foreground">Страница не найдена</p>
    </div>
  ),
  component: AdminLayout,
});

const TABS = [
  { key: "orders", to: ADMIN_BASE, label: "Заказы", exact: true },
  { key: "companies", to: `${ADMIN_BASE}/companies`, label: "Контрагенты" },
  { key: "leads", to: `${ADMIN_BASE}/leads`, label: "Оптовые заявки" },
  { key: "products", to: `${ADMIN_BASE}/products`, label: "Каталог" },
  { key: "ai", to: `${ADMIN_BASE}/ai`, label: "ИИ" },
  { key: "settings", to: `${ADMIN_BASE}/settings`, label: "Настройки" },
  { key: "logs", to: `${ADMIN_BASE}/logs`, label: "Журнал" },
];

function AdminLayout() {
  const ctx = Route.useRouteContext() as { adminRoles: AdminRole[]; adminEmail: string | null };
  const adminRoles = ctx.adminRoles;
  const adminEmail = ctx.adminEmail;
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-lg font-bold tracking-tight">ALMAFORT · Панель управления</span>
            <span className="rounded border px-2 py-0.5 text-xs text-muted-foreground">
              {adminRoles.map((r) => ROLE_LABEL[r]).join(", ")}
            </span>
          </div>
          <nav className="flex flex-wrap gap-1">
            {TABS.filter((t) => can(adminRoles, t.key)).map((t) => {
              const active = t.exact ? pathname === t.to : pathname.startsWith(t.to);
              return (
                <Link
                  key={t.key}
                  to={t.to}
                  aria-current={active ? "page" : undefined}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-sm transition-all duration-200 ${
                    active
                      ? "bg-foreground font-semibold text-background shadow-sm"
                      : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground hover:shadow-sm"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </nav>
          <span className="ml-auto text-xs text-muted-foreground">{adminEmail}</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
