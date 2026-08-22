import { useEffect, useState } from "react";
import { Clock, MapPin, Phone, UserRound, Menu, ShoppingCart, X } from "lucide-react";
import { currentUser, onAuthChange } from "@/lib/session";
import { useCart } from "@/store/cart-store";
import { trackContact } from "@/lib/metrika";

const NAV = [
  { label: "Каталог", href: "/catalog" },
  { label: "Производство", href: "/#services" },
  { label: "Реверс-инжиниринг", href: "/#reverse" },
  { label: "Доставка", href: "/#delivery" },
  { label: "Контакты", href: "/#contacts" },
];


export function SiteHeader() {
  const [elevated, setElevated] = useState(false);
  const [open, setOpen] = useState(false);
  /** null — сессия ещё не прочитана (SSR-safe), иначе e-mail снабженца или "". */
  const [account, setAccount] = useState<string | null>(null);
  const cartLines = useCart((s) => s.lines.length);

  useEffect(() => {
    const onScroll = () => setElevated(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Скролл страницы блокируется, пока открыто off-canvas меню
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    const sync = () => setAccount(currentUser()?.email ?? "");
    sync();
    return onAuthChange(sync);
  }, []);

  const authed = Boolean(account);


  return (
    <header
      className="sticky top-0 z-50 bg-background"
      style={elevated ? { boxShadow: "var(--shadow-header)" } : undefined}
    >
      <div className="mx-auto grid max-w-[1440px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3 lg:flex lg:items-center lg:justify-between lg:gap-6 lg:px-10 lg:py-4 xl:gap-10">
        <a href="/" className="flex min-w-0 shrink-0 items-center">
          <span className="text-xl font-extrabold tracking-tight text-primary">ALMAFORT</span>
        </a>

        <nav className="hidden lg:flex lg:items-center lg:gap-5 xl:gap-7">
          {NAV.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="whitespace-nowrap text-sm font-medium text-foreground hover:text-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:flex lg:shrink-0 lg:items-center lg:gap-4 xl:gap-5">
          <span className="hidden items-center gap-2 whitespace-nowrap text-[13px] leading-none text-muted-foreground xl:flex">
            <Clock className="size-4 shrink-0" strokeWidth={1.5} />
            Пн-Пт 08:00–19:00 (МСК+4)
          </span>
          <span className="hidden max-w-[220px] items-center gap-2 text-[13px] leading-none text-muted-foreground 2xl:flex">
            <MapPin className="size-4 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Нижний проезд, 15/1</span>
          </span>
          <a
            href="tel:+79029229734"
            onClick={() => trackContact("phone_click")}
            className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[14px] font-semibold leading-none text-foreground hover:text-primary"
            style={{ whiteSpace: "nowrap" }}
          >
            <Phone className="size-4 shrink-0" strokeWidth={1.5} />
            +7&nbsp;(902)&nbsp;922-97-34
          </a>

          <a
            href={authed ? "/cabinet" : "/auth"}
            title={authed ? `Кабинет · ${account}` : "Вход и регистрация для партнёров"}
            className={`flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-sm border px-3 text-[13px] font-semibold transition-colors ${
              authed
                ? "border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                : "border-border text-foreground hover:border-primary hover:text-primary"
            }`}
          >
            <UserRound className="size-4 shrink-0" strokeWidth={1.75} />
            {authed ? "Мой кабинет" : "Вход для партнёров"}
          </a>

        </div>


        {/* Мобильная панель: корзина с бейджем + гамбургер, зоны касания 44px */}
        <div className="flex items-center gap-2 justify-self-end lg:hidden">
          <a
            href="/cart"
            aria-label={`Корзина: ${cartLines} позиций`}
            className="relative grid size-11 place-items-center rounded-md border border-border text-foreground"
          >
            <ShoppingCart className="size-5" strokeWidth={1.6} />
            {cartLines > 0 && (
              <span className="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold leading-5 text-primary-foreground">
                {cartLines}
              </span>
            )}
          </a>
          <button
            type="button"
            aria-label="Меню"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="grid size-11 place-items-center rounded-md border border-border text-foreground"
          >
            <Menu className="size-5" strokeWidth={1.6} />
          </button>
        </div>
      </div>

      {/* Off-canvas меню на весь экран */}
      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-foreground/40"
          />
          <div className="safe-bottom absolute inset-y-0 right-0 flex w-[86%] max-w-[380px] flex-col overflow-y-auto bg-background px-5 py-4 shadow-[0_0_40px_oklch(0_0_0/0.25)]">
            <div className="flex items-center justify-between">
              <span className="text-lg font-extrabold tracking-tight text-primary">ALMAFORT</span>
              <button
                type="button"
                aria-label="Закрыть"
                onClick={() => setOpen(false)}
                className="grid size-11 place-items-center rounded-md border border-border text-foreground"
              >
                <X className="size-5" strokeWidth={1.6} />
              </button>
            </div>

            <nav className="mt-6 flex flex-col">
              {NAV.map((item) => (
                <a
                  key={item.label}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex min-h-[52px] items-center border-b border-border text-base font-medium text-foreground"
                >
                  {item.label}
                </a>
              ))}
            </nav>

            <a
              href={authed ? "/cabinet" : "/auth"}
              onClick={() => setOpen(false)}
              className="mt-6 flex h-14 items-center justify-center gap-2 rounded-md bg-primary text-base font-semibold text-primary-foreground"
            >
              <UserRound className="size-5" strokeWidth={1.75} />
              {authed ? "Мой кабинет" : "B2B-Кабинет"}
            </a>

            <a
              href="tel:+79029229734"
            onClick={() => trackContact("phone_click")}
              className="mt-3 flex h-14 items-center justify-center gap-2 rounded-md border border-border text-base font-semibold text-foreground"
            >
              <Phone className="size-5" strokeWidth={1.6} />
              +7 (902) 922-97-34
            </a>

            <p className="mt-6 text-sm leading-[1.5] text-muted-foreground">
              Пн-Пт 08:00–19:00 (МСК+4)
              <br />г. Дивногорск, Нижний проезд, 15/1
            </p>
          </div>
        </div>
      )}
    </header>
  );
}
