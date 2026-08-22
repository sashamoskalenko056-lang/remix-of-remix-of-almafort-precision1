import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Building2,
  Loader2,
  LogOut,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Send,
  Trash2,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BackLink } from "@/components/back-link";
import { formatPrice } from "@/lib/pricing";
import { innHint, isValidInn, sanitizeInn } from "@/lib/inn";
import { BackupPassword } from "@/components/cabinet/backup-password";
import { InnField, type Party } from "@/components/inn-field";
import { Skeleton } from "@/components/ui/skeleton";

import { STAGES, TIER_META, stageIndex, tierProgress, type LoyaltyTier } from "@/lib/loyalty";
import { addCompanyByInn, removeCompany, repeatOrder } from "@/lib/cabinet.functions";
import { getCabinetFromBrowser } from "@/lib/cabinet-client";
import { clearSession } from "@/lib/session";
import { isAuthError } from "@/lib/auth-error";
import { COMPANY } from "@/lib/company";
import { useCart } from "@/store/cart-store";

export const Route = createFileRoute("/_authenticated/cabinet")({
  head: () => ({
    meta: [
      { title: "Кабинет снабженца ALMAFORT — заказы, документы, грейд" },
      {
        name: "description",
        content:
          "Сводка закупок, статус программы лояльности, активные заказы с трекингом и архив документов ALMAFORT.",
      },
      { property: "og:title", content: "B2B-кабинет ALMAFORT" },
      { property: "og:description", content: "Пульт управления закупками: заказы, документы, грейды." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: CabinetPage,
});

function CabinetPage() {
  const addCompany = useServerFn(addCompanyByInn);
  const dropCompany = useServerFn(removeCompany);
  const repeat = useServerFn(repeatOrder);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const addLine = useCart((s) => s.addLine);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["cabinet"],
    queryFn: getCabinetFromBrowser,
    // Истёкшую сессию бессмысленно ретраить — уводим на /auth.
    retry: (count, err) => !isAuthError(err) && count < 2,
    // Возврат в кабинет из каталога не должен снова блокировать экран.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  // 401 = токен протух: чистим сессию и отправляем на вход, а не показываем заглушку.
  useEffect(() => {
    if (!isAuthError(error)) return;
    void (async () => {
      await qc.cancelQueries();
      qc.clear();
      clearSession();
      void navigate({ to: "/auth", replace: true });
    })();
  }, [error, qc, navigate]);

  const [inn, setInn] = useState("");
  const [party, setParty] = useState<Party | null>(null);
  const [busy, setBusy] = useState(false);

  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    clearSession();
    void navigate({ to: "/auth", replace: true });
  };

  const onAddCompany = async () => {
    const hint = innHint(inn);
    if (hint) {
      toast.error(hint);
      return;
    }
    setBusy(true);
    try {
      const row = await addCompany({ data: { inn: sanitizeInn(inn) } });
      setInn("");
      await qc.invalidateQueries({ queryKey: ["cabinet"] });
      toast.success(
        (row as { resolved?: boolean }).resolved
          ? "Юрлицо добавлено — реквизиты подтянутся в счета автоматически"
          : "Юрлицо добавлено. Реестр сейчас недоступен — название и адрес уточнит менеджер",
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось добавить юрлицо");
    } finally {
      setBusy(false);
    }
  };


  const onRepeat = async (orderId: string) => {
    try {
      const { items, unavailable, repriced } = await repeat({ data: { orderId } });
      items.forEach((i) => addLine(i.sku, i.quantity));
      if (unavailable.length) {
        toast.warning(
          `Внимание: ${unavailable.length} поз. из прошлого заказа больше не поставляются (${unavailable.join(", ")}).`,
        );
      }
      if (repriced.length) {
        toast.info(`Цены обновлены по текущему прайсу: ${repriced.length} поз.`);
      }
      toast.success("Спецификация перенесена в корзину по актуальным ценам");
      void navigate({ to: "/cart" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось повторить заказ");
    }
  };

  // Скелетон вместо пустого экрана: интерфейс появляется мгновенно.
  if (isLoading) {
    return (
      <Shell>
        <Skeleton className="h-9 w-72" />
        <Skeleton className="mt-3 h-4 w-full max-w-[42rem]" />
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Skeleton className="h-48 w-full rounded-sm" />
            <Skeleton className="h-72 w-full rounded-sm" />
          </div>
          <div className="space-y-6">
            <Skeleton className="h-56 w-full rounded-sm" />
            <Skeleton className="h-40 w-full rounded-sm" />
          </div>
        </div>
      </Shell>
    );
  }
  if (isAuthError(error)) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Сессия истекла — открываем страницу входа…
        </div>
      </Shell>
    );
  }
  if (error || !data) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Не удалось загрузить кабинет.";
    return (
      <Shell>
        <p className="text-sm text-primary">Не удалось загрузить кабинет.</p>
        <p className="mt-1 text-xs text-muted-foreground break-words">{message}</p>
        <button
          type="button"
          disabled={isFetching}
          onClick={() => void refetch()}
          className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          <RefreshCw className={`size-4 ${isFetching ? "animate-spin" : ""}`} /> Повторить
        </button>
      </Shell>
    );
  }

  const tier = data.loyalty.tier as LoyaltyTier;
  const meta = TIER_META[tier];
  const progress = tierProgress(data.loyalty);
  const left = data.loyalty.next_threshold
    ? Math.max(0, data.loyalty.next_threshold - data.loyalty.total_spent)
    : 0;
  const profile = data.profile as
    | {
        full_name: string | null;
        manager_name: string;
        manager_phone: string;
        manager_telegram: string;
        manager_whatsapp: string;
      }
    | null;

  return (
    <Shell onSignOut={signOut}>
      <header className="mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground lg:text-[40px]">
          Кабинет снабженца
        </h1>
        <p className="mt-3 max-w-[70ch] text-sm leading-[1.6] text-muted-foreground">
          Заказы, документы и статус партнёрства — без звонков менеджеру.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="space-y-6">
          {/* Лояльность */}
          <div className="rounded-sm border border-border bg-card p-6 lg:p-8">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Ваш статус</p>
                <p className="mt-1 text-xl font-extrabold text-foreground">{meta.name}</p>
              </div>
              <p className="text-sm tabular-nums text-muted-foreground">
                Выкуплено за 12 месяцев:{" "}
                <span className="font-semibold text-foreground">
                  {formatPrice(data.loyalty.total_spent)}
                </span>
              </p>
            </div>

            <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-[#F1F3F5]">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {data.loyalty.next_threshold
                ? `До статуса «${TIER_META[(tier + 1) as LoyaltyTier].name}» осталось докупить на ${formatPrice(left)} — и оптовая колонка закрепится за вами постоянно.`
                : "Максимальный грейд: минимальная цена «Опт 2» на любой объём и отсрочка платежа."}
            </p>

            <ul className="mt-5 grid gap-2 text-sm text-foreground">
              {meta.perks.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="text-primary">—</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>

          {/* Заказы */}
          <div className="rounded-sm border border-border bg-card p-6 lg:p-8">
            <h2 className="text-lg font-bold text-foreground">Заказы</h2>
            {data.orders.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                Заказов пока нет.{" "}
                <Link to="/catalog" className="font-medium text-primary hover:underline">
                  Перейти в каталог
                </Link>
                .
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {data.orders.map((o) => {
                  const idx = Math.max(0, stageIndex(o.status));
                  return (
                    <li key={o.id} className="py-4">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link
                          to="/orders/$orderId"
                          params={{ orderId: o.id }}
                          className="text-sm font-semibold text-foreground hover:text-primary"
                        >
                          Заказ № {o.number}
                        </Link>
                        <span className="text-sm font-semibold tabular-nums text-foreground">
                          {formatPrice(Number(o.total))}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {STAGES[idx]?.icon} {STAGES[idx]?.title} ·{" "}
                        {new Date(o.created_at).toLocaleDateString("ru-RU")}
                        {o.city ? ` · ${o.city}` : ""}
                      </p>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F1F3F5]">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${((idx + 1) / STAGES.length) * 100}%` }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => onRepeat(o.id)}
                        className="mt-3 inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-sm border border-border px-4 py-2 text-xs font-medium text-foreground transition-all duration-200 hover:-translate-y-px hover:border-primary hover:text-primary"
                      >
                        <RefreshCw className="size-3.5" strokeWidth={1.75} />
                        Повторить заказ
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          {/* Менеджер */}
          <div className="rounded-sm border border-border bg-card p-6">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Ваш менеджер</p>
            <p className="mt-1 text-base font-bold text-foreground">
              {profile?.manager_name ?? "Менеджер ALMAFORT"}
            </p>
            {(() => {
              const phone = profile?.manager_phone?.trim() || COMPANY.phone;
              const wa =
                profile?.manager_whatsapp?.trim() ||
                `https://wa.me/${COMPANY.phoneHref.replace(/\D/g, "")}`;
              const tg = profile?.manager_telegram?.trim() || "https://t.me/almafort";
              const telHref = `tel:+${phone.replace(/\D/g, "").replace(/^8/, "7")}`;
              return (
                <div className="mt-4 grid gap-2 text-sm">
                  {phone && (
                    <a
                      href={telHref}
                      className="inline-flex min-h-11 items-center gap-2 text-foreground transition-colors hover:text-primary"
                    >
                      <Phone className="size-4 shrink-0" strokeWidth={1.75} />
                      <span className="tabular-nums">{phone}</span>
                    </a>
                  )}
                  {wa && (
                    <a
                      href={wa}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                    >
                      <MessageCircle className="size-4 shrink-0" strokeWidth={1.75} /> WhatsApp
                    </a>
                  )}
                  {tg && (
                    <a
                      href={tg}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center gap-2 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
                    >
                      <Send className="size-4 shrink-0" strokeWidth={1.75} /> Telegram
                    </a>
                  )}
                </div>
              );
            })()}

          </div>

          {/* Юрлица */}
          <div className="rounded-sm border border-border bg-card p-6">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
              <Building2 className="size-4" strokeWidth={1.75} /> Мои юрлица
            </p>
            <ul className="mt-4 space-y-3">
              {data.companies.map((c) => (
                <li key={c.id} className="rounded-sm border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{c.name}</p>
                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        ИНН {c.inn}
                        {c.kpp ? ` · КПП ${c.kpp}` : ""}
                      </p>
                      {c.legal_address && (
                        <p className="mt-1 text-xs text-muted-foreground">{c.legal_address}</p>
                      )}
                      {c.director && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Руководитель: {c.director}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Удалить юрлицо"
                      onClick={async () => {
                        await dropCompany({ data: { id: c.id } });
                        await qc.invalidateQueries({ queryKey: ["cabinet"] });
                      }}
                      className="cursor-pointer text-muted-foreground transition-colors hover:text-primary"
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} />
                    </button>
                  </div>
                </li>
              ))}
              {data.companies.length === 0 && (
                <li className="text-xs text-muted-foreground">
                  Добавьте ИНН — КПП, название и юридический адрес подтянутся сами.
                </li>
              )}
            </ul>
            <div className="mt-4">
              <InnField
                value={inn}
                onChange={setInn}
                onParty={setParty}
                label="ИНН — 10 цифр (юрлицо) или 12 (ИП)"
              />
              <button
                type="button"
                disabled={busy || !isValidInn(inn) || Boolean(party?.blocked)}
                onClick={onAddCompany}
                className="mt-3 inline-flex h-12 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-sm bg-primary px-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-[#B91C1C] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 md:h-10"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                Добавить
              </button>
            </div>


          </div>

          <BackupPassword />
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children, onSignOut }: { children: React.ReactNode; onSignOut?: () => void }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto w-full max-w-[1100px] flex-1 px-5 pb-24 pt-10 lg:px-10">
        <div className="mb-6 flex items-center justify-between">
          <BackLink fallback="/" label="На главную" />
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <LogOut className="size-4" strokeWidth={1.75} /> Выйти
            </button>
          )}
        </div>
        {children}
      </main>
    </div>
  );
}
