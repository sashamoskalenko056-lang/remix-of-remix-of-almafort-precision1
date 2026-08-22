import { formatPhone } from "@/lib/phone";
import { ensureOnline } from "@/lib/use-network";
import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, FileDown, Loader2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PRODUCTS } from "@/data/catalog";
import { scoreMatch } from "@/lib/fuzzy-search";
import { useDebounce } from "@/hooks/use-debounce";
import { CityInput } from "@/components/cart/city-input";
import { SwipeToDelete } from "@/components/cart/swipe-to-delete";
import { InnField, type Party } from "@/components/inn-field";

import { formatPrice } from "@/lib/pricing";
import { generateInvoicePdfInBrowser } from "@/lib/pdf-browser";
import { trackBeginCheckout, trackPurchase } from "@/lib/metrika";
import { saveLastOrder } from "@/lib/last-order";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { ProductThumb } from "@/components/catalog/product-thumb";
import { useLoyalty } from "@/hooks/use-loyalty";
import { TIER_META } from "@/lib/loyalty";
import { saveOrderToCabinet } from "@/lib/cabinet.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  cartTotals,
  deliveryCost,
  linePrice,
  useCart,
  type Carrier,
  type PendingRow,
} from "@/store/cart-store";

/** Единый валютный формат платформы: «150,00 ₽». */
const money = (n: number) => formatPrice(n);

/**
 * Сетка таблицы корзины живёт в styles.css как `.cart-table-grid`
 * и применяется и к шапке, и к строкам — колонки не могут разъехаться.
 */


const CARRIERS: Array<{ id: Carrier; label: string }> = [
  { id: "cdek", label: "СДЭК" },
  { id: "dl", label: "Деловые Линии" },
  { id: "pickup", label: "Самовывоз" },
];

const TIER_LABEL = ["базовая", "от 1 000 шт", "от 5 000 шт"];

export function CartPanel() {
  const lines = useCart((s) => s.lines);
  const pending = useCart((s) => s.pending);
  const carrier = useCart((s) => s.carrier);
  const city = useCart((s) => s.city);
  const setCarrier = useCart((s) => s.setCarrier);
  const fiasId = useCart((s) => s.fiasId);
  const setDestination = useCart((s) => s.setDestination);
  const setQuantity = useCart((s) => s.setQuantity);
  const removeLine = useCart((s) => s.removeLine);
  const resolvePending = useCart((s) => s.resolvePending);
  const removePending = useCart((s) => s.removePending);
  const clear = useCart((s) => s.clear);
  const navigate = useNavigate();
  const quotes = useCart((s) => s.quotes);
  const quoting = useCart((s) => s.quoting);
  const quoteError = useCart((s) => s.quoteError);
  const setQuotes = useCart((s) => s.setQuotes);
  const setQuoting = useCart((s) => s.setQuoting);
  const setQuoteError = useCart((s) => s.setQuoteError);

  // Грейд лояльности закрепляет оптовую колонку на любой объём.
  const { tier, authed, verified, minColumn, credit } = useLoyalty();
  const { goods, weight, volume } = useMemo(
    () => cartTotals(lines, minColumn),
    [lines, minColumn],
  );

  // Единый дебаунс 500 мс: и на ввод города, и на изменение габаритов партии —
  // один запрос к ТК вместо шквала при наборе количества.
  const payloadKey = `${city.trim()}|${fiasId ?? ""}|${weight}|${volume}`;
  const debouncedKey = useDebounce(payloadKey, 500);

  // Запрос в /api/shipping-calc: параллельно СДЭК + Деловые Линии на бэкенде.
  useEffect(() => {
    const [city0 = "", fias0 = "", w0 = "0", v0 = "0"] = debouncedKey.split("|");
    const totalWeight = Number(w0);
    const totalVolume = Number(v0);
    if (city0.length < 2 || totalWeight <= 0) {
      setQuotes([]);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setQuotes([]);
      setQuoting(false);
      return;
    }
    const ctrl = new AbortController();
    let alive = true;
    setQuoting(true);
    // Обрыв связи не должен оставлять бесконечный лоадер.
    const offlineTimer = window.setTimeout(() => ctrl.abort(), 15000);
    (async () => {
      try {
        const res = await fetch("/api/shipping-calc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination: { city: city0, fias_id: fias0 || null },
            parcel: { totalWeight, totalVolume },
          }),
          signal: ctrl.signal,
        });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(json?.error ?? "Не удалось рассчитать доставку");
        setQuotes(json.quotes);
      } catch (e) {
        if ((e as Error).name !== "AbortError" && alive)
          setQuoteError(e instanceof Error ? e.message : "Ошибка расчёта доставки");
      } finally {
        window.clearTimeout(offlineTimer);
        if (alive) setQuoting(false);
      }
    })();
    return () => {
      alive = false;
      window.clearTimeout(offlineTimer);
      ctrl.abort();
    };
  }, [debouncedKey, setQuotes, setQuoting, setQuoteError]);

  const quoteFor = (c: Carrier) => quotes.find((q) => q.carrier === c);
  const delivery =
    carrier === "pickup" ? 0 : (quoteFor(carrier)?.price ?? deliveryCost(carrier, weight));
  const total = goods + delivery;

  const pendingQuote =
    quoting ||
    (carrier !== "pickup" &&
      city.trim().length >= 2 &&
      weight > 0 &&
      (payloadKey !== debouncedKey || !quoteFor(carrier)));
  const [consent, setConsent] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", company: "", comment: "" });
  const [inn, setInn] = useState("");
  const [party, setParty] = useState<Party | null>(null);
  const cartReady = Boolean(lines.length) && !pendingQuote;
  const unverified = authed && !verified;
  const ctaDisabled = !cartReady || !consent || unverified || Boolean(party?.blocked);

  const [submitting, setSubmitting] = useState(false);
  const idemKey = useRef<string | null>(null);
  // Стратегическому партнёру доступна отгрузка с отсрочкой платежа 15–30 дней.
  const [deferred, setDeferred] = useState(false);
  const field = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submitOrder = async () => {
    // Идемпотентность: 5 кликов подряд — один заказ. Ключ живёт до успешной отправки.
    if (submitting) return;
    if (!idemKey.current) idemKey.current = `af-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const idempotencyKey = idemKey.current;
    if (!ensureOnline("Заказ не отправлен — проверьте сеть и повторите")) return;
    if (!lines.length) {
      toast.error("Корзина пуста — добавьте позиции или загрузите спецификацию");
      return;
    }
    if (form.name.trim().length < 2 || form.phone.replace(/\D/g, "").length < 10) {
      toast.error("Укажите имя и телефон — менеджер должен знать, кому подтверждать отгрузку");
      return;
    }
    if (party?.blocked) {
      toast.error(
        "Данное юридическое лицо ликвидировано или находится в стадии банкротства. Выставление счёта невозможно",
      );
      return;
    }
    setSubmitting(true);
    const ecomItems = lines.map((l) => ({
      sku: l.sku,
      name: l.name,
      price: linePrice(l.sku, l.quantity, minColumn).unit,
      quantity: l.quantity,
    }));
    trackBeginCheckout(ecomItems, total);
    try {
      // PDF не должен блокировать заявку: дольше 5 с — уходим без вложения,
      // счёт формируется на сервере и уезжает клиенту на почту.
      const invoicePdfBase64 = await Promise.race([
        generateInvoicePdfInBrowser({ lines, carrier, city, delivery, output: "base64" }).catch(
          () => null,
        ),
        new Promise<null>((r) => window.setTimeout(() => r(null), 5000)),
      ]);
      if (!invoicePdfBase64) {
        toast.info("Заявка принята, счёт формируется и придёт на почту в течение минуты");
      }

      const res = await fetch("/api/checkout/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          customer: {
            name: form.name.trim(),
            phone: form.phone.trim(),
            email: form.email.trim(),
            company: (party?.name || form.company).trim(),
            comment: form.comment.trim().slice(0, 2000),
          },
          ...(party?.inn ? { inn: party.inn } : {}),
          ...(party?.kpp ? { kpp: party.kpp } : {}),
          city,
          carrier,
          deliveryPrice: delivery,
          goodsPrice: goods,
          total,
          items: lines.map((l) => {
            const { unit, sum } = linePrice(l.sku, l.quantity, minColumn);
            return { sku: l.sku, name: l.name, quantity: l.quantity, unit, sum };
          }),
          ...(invoicePdfBase64 ? { invoicePdfBase64 } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не удалось оформить заказ");

      // Вход мог произойти в соседней вкладке: перечитываем сессию,
      // чтобы заказ привязался к аккаунту, а не ушёл как гостевой.
      const { data: fresh } = await supabase.auth.getSession();
      if (authed || fresh.session) {
        try {
          await saveOrderToCabinet({
            data: {
              number: String(json.orderId ?? Date.now()),
              items: lines.map((l) => {
                const { unit, sum } = linePrice(l.sku, l.quantity, minColumn);
                return { sku: l.sku, name: l.name, quantity: l.quantity, unit, sum };
              }),
              goodsPrice: goods,
              deliveryPrice: delivery,
              total,
              carrier,
              city,
              deferred,
              invoiceUrl: json.invoiceUrl ?? null,
              idempotencyKey,
            },
          });
        } catch (err) {
          console.error("[cabinet] order save failed", err);
        }
      }

      idemKey.current = null;
      trackPurchase(json.orderId ?? Date.now(), ecomItems, total);

      saveLastOrder({
        orderId: json.orderId,
        lines,
        carrier,
        city,
        delivery,
        total,
        invoiceUrl: json.invoiceUrl ?? null,
      });
      clear();
      await navigate({ to: "/success" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось оформить заказ");
    } finally {
      setSubmitting(false);
    }
  };

  const download = async () => {
    if (ctaDisabled) return;
    if (!lines.length) {
      toast.error("Корзина пуста — добавьте позиции или загрузите спецификацию");
      return;
    }
    try {
      await generateInvoicePdfInBrowser({ lines, carrier, city, delivery });
      toast.success("PDF-счёт сформирован");
    } catch {
      toast.error("Не удалось сформировать счёт");
    }
  };

  return (
    <div className="space-y-8">
      {/* Строки спецификации, требующие решения человека */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-base font-bold text-foreground">
            Строки из вашего файла, требующие внимания ({pending.length})
          </h3>
          <p className="text-sm text-muted-foreground">
            Ни одна строка сметы не потеряна. Жёлтые — выберите модель из списка, красные — можно
            отправить в производство на заказ.
          </p>
          {pending.map((row) => (
            <PendingRowCard
              key={row.id}
              row={row}
              onResolve={(sku) => resolvePending(row.id, sku)}
              onRemove={() => removePending(row.id)}
            />
          ))}
        </section>
      )}

      {/* Корзина */}
      <section className="cart-table-scroll rounded-lg border border-border bg-card">
        <div className="cart-table-grid hidden border-b border-border bg-[#F8F9FA] px-5 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <span>Позиция</span>
          <span className="text-right">Кол-во</span>
          <span className="text-right">Цена</span>
          <span className="text-right">Сумма</span>
          <span />
        </div>


        {lines.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Корзина пуста. Загрузите спецификацию — позиции подставятся автоматически.
          </p>
        )}

        {lines.map((l) => {
          const { base, unit, tier, sum } = linePrice(l.sku, l.quantity);
          const discounted = tier > 0;
          return (
            <SwipeToDelete key={l.sku} onDelete={() => removeLine(l.sku)}>
            <div
              className="cart-table-grid border-b border-border px-4 py-4 last:border-b-0 md:px-5 md:py-3"
            >


              <div className="flex min-w-0 items-center gap-3">
                <span className="block w-10 shrink-0">
                  <ProductThumb
                    src={PRODUCTS.find((p) => p.sku === l.sku)?.image_url ?? null}
                    alt={l.name}
                  />
                </span>
                <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground md:truncate">
                  {l.sku} — {l.name}
                </p>
                {l.originalName && l.originalName !== l.name && (
                  <p className="truncate text-xs text-muted-foreground">
                    из вашей сметы: {l.originalName}
                  </p>
                )}
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(l.sku)}
                  aria-label="Удалить позицию"
                  className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors active:scale-95 md:hidden"
                >
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </button>
              </div>

              {/* Мобильный блок количества: крупные «−» и «+» */}
              <div className="no-select mt-3 grid grid-cols-[44px_minmax(0,1fr)_44px] gap-2 md:mt-0 md:block">
                <button
                  type="button"
                  aria-label="Уменьшить количество"
                  onClick={() => setQuantity(l.sku, Math.max(0, l.quantity - 100))}
                  className="grid h-11 place-items-center rounded-md border border-[#D1D5DB] text-foreground active:scale-95 md:hidden"
                >
                  −
                </button>
                <input
                  inputMode="numeric"
                  value={l.quantity}
                  onChange={(e) =>
                    setQuantity(l.sku, Number(e.target.value.replace(/\D/g, "")) || 0)
                  }
                  className="h-11 w-full rounded-md border border-[#D1D5DB] px-2 text-center tabular-nums outline-none transition-colors focus:border-foreground md:h-auto md:rounded-sm md:py-1.5 md:text-right md:text-sm"
                />
                <button
                  type="button"
                  aria-label="Увеличить количество"
                  onClick={() => setQuantity(l.sku, l.quantity + 100)}
                  className="grid h-11 place-items-center rounded-md border border-[#D1D5DB] text-foreground active:scale-95 md:hidden"
                >
                  +
                </button>
              </div>

              <div className="mt-3 flex items-baseline justify-between text-sm tabular-nums md:mt-0 md:block md:text-right">
                <span className="text-xs uppercase text-muted-foreground md:hidden">Цена</span>
                <span>
                  {discounted && (
                    <span className="mr-1 text-xs text-muted-foreground line-through">
                      {money(base)}
                    </span>
                  )}
                  <span
                    className={
                      discounted ? "font-semibold text-[oklch(0.5_0.15_150)]" : "text-foreground"
                    }
                  >
                    {money(unit)}
                  </span>
                </span>
                <p className="text-[11px] text-muted-foreground md:mt-0">{TIER_LABEL[tier]}</p>
              </div>

              <div className="mt-2 flex items-baseline justify-between text-sm font-semibold tabular-nums text-foreground md:mt-0 md:block md:text-right">
                <span className="text-xs uppercase font-normal text-muted-foreground md:hidden">
                  Сумма
                </span>
                {money(sum)}
              </div>

              <button
                type="button"
                onClick={() => removeLine(l.sku)}
                aria-label="Удалить позицию"
                className="hidden size-8 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-all duration-200 hover:scale-110 hover:bg-primary hover:text-primary-foreground active:scale-95 md:grid"
              >
                <Trash2 className="size-4" strokeWidth={1.75} />
              </button>
            </div>
            </SwipeToDelete>
          );

        })}
      </section>


      {/* Логистика и итог */}
      <section className="grid gap-6 rounded-lg border border-border bg-card p-6 lg:grid-cols-[1fr_320px]">
        <div>
          <p className="text-sm font-semibold text-foreground">Доставка</p>
          <CityInput
            value={{ city, fiasId }}
            onChange={(v) => setDestination(v.city, v.fiasId)}
          />

          {quoting ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-[74px] animate-pulse rounded-sm border border-[#E5E7EB] bg-[#F1F3F5]"
                />
              ))}
            </div>
          ) : (
            <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Способ доставки">
              {CARRIERS.map((c) => {
                const q = quoteFor(c.id);
                const active = carrier === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setCarrier(c.id)}
                    className={`flex cursor-pointer items-start gap-3 rounded-sm border-2 px-4 py-3 text-left transition-colors ${
                      active
                        ? "border-primary text-foreground"
                        : "border-[#D1D5DB] text-muted-foreground hover:border-[#9CA3AF] hover:text-foreground"
                    }`}
                  >
                    <span
                      className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border-2 ${
                        active ? "border-primary" : "border-[#9CA3AF]"
                      }`}
                    >
                      {active && <span className="size-2 rounded-full bg-primary" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{c.label}</span>
                      <span className="mt-1 block text-xs tabular-nums text-muted-foreground">
                        {c.id === "pickup"
                          ? `${formatPrice(0)} · склад производства`
                          : q
                            ? `${money(q.price)} · ${q.days} дн. · ${q.toDoor ? "до двери" : "до терминала"}`
                            : "укажите город"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {carrier === "pickup" && (
            <p className="mt-3 rounded-sm border-l-2 border-primary bg-[#F8F9FA] px-4 py-3 text-xs leading-[1.6] text-foreground">
              Забор груза осуществляется со склада производства по адресу: г. Дивногорск, Нижний
              проезд 15/1. Пн-Пт 08:00–19:00.
            </p>
          )}

          <p className="mt-3 text-xs text-muted-foreground">
            Партия: {weight.toFixed(1)} кг · {volume.toFixed(3)} м³ · отгрузка с терминалов
            Красноярска{quoteError ? ` · ${quoteError}` : ""}
          </p>

        </div>

        {!authed && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-semibold text-foreground">
              Войдите в B2B-кабинет перед оформлением
            </p>
            <p className="mt-1.5 text-xs leading-[1.5] text-muted-foreground">
              Реквизиты подставятся автоматически, заказ попадёт в трекинг, а грейд закрепит оптовую
              колонку цен на весь объём.
            </p>
            <a
              href="/auth"
              className="mt-3 inline-flex items-center rounded-sm border border-primary px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              Войти или создать кабинет
            </a>
          </div>
        )}

        {/* Правая колонка: контакты и итог идут одной стопкой, чтобы итог не уезжал под доставку */}
        <div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-1">
        <div className="rounded-md border border-border p-5">

          <p className="text-sm font-semibold text-foreground">Контакты для счёта</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Имя и фамилия <span className="font-bold text-[#E52421]">*</span>
              </span>
            <input
              value={form.name}
              onChange={field("name")}
              placeholder="Имя и фамилия"
              className="h-11 rounded-sm border border-[#D1D5DB] px-3.5 py-2.5 text-[13px] leading-[1.3] outline-none transition-colors placeholder:text-[13px] focus:border-primary"
            />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Телефон <span className="font-bold text-[#E52421]">*</span>
              </span>
            <input
              value={form.phone}
              onChange={(e) =>
                setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))
              }
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={18}
              placeholder="+7 (___) ___-__-__"
              className="h-12 rounded-sm border border-[#D1D5DB] px-3.5 py-2.5 text-[13px] leading-[1.3] outline-none transition-colors placeholder:text-[13px] focus:border-primary md:h-11"
            />

            </label>
            <input
              value={form.email}
              onChange={field("email")}
              inputMode="email"
              placeholder="E-mail для счёта"
              className="h-11 rounded-sm border border-[#D1D5DB] px-3.5 py-2.5 text-[13px] leading-[1.3] outline-none transition-colors placeholder:text-[13px] focus:border-primary"
            />
            <input
              value={form.company}
              onChange={field("company")}
              placeholder="Компания"
              className="h-11 rounded-sm border border-[#D1D5DB] px-3.5 py-2.5 text-[13px] leading-[1.3] outline-none transition-colors placeholder:text-[13px] focus:border-primary"
            />
          </div>

          <div className="mt-3">
            <InnField
              value={inn}
              onChange={setInn}
              onParty={(p) => {
                setParty(p);
                // Название из реестра подставляем сами — снабженцу не нужно печатать ОПФ.
                if (p?.name) setForm((f) => ({ ...f, company: p.name }));
              }}
              label="ИНН плательщика"
            />
          </div>

          <textarea
            maxLength={2000}
            value={form.comment}
            onChange={field("comment")}
            rows={2}
            placeholder="Комментарий к отгрузке"
            className="mt-3 w-full rounded-sm border border-[#D1D5DB] px-3.5 py-2.5 text-[13px] leading-[1.4] outline-none transition-colors placeholder:text-[13px] focus:border-primary"
          />
        </div>

        <div className="rounded-md bg-[#F8F9FA] p-5">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Товары</span>
            <span className="tabular-nums text-foreground">{money(goods)}</span>
          </div>
          <div className="mt-2 flex justify-between text-sm">
            <span className="text-muted-foreground">Доставка</span>
            <span className="tabular-nums text-foreground">
              {delivery ? money(delivery) : "самовывоз"}
            </span>
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-4">
            <span className="text-sm font-semibold text-foreground">Итого к оплате</span>
            <span className="text-lg font-extrabold tabular-nums text-foreground">
              {money(total)}
            </span>
          </div>
          <div className="mt-5">
            <ConsentCheckbox
              id="consent-cart"
              checked={consent}
              onChange={setConsent}
              invalid={triedSubmit && !consent}
            />
          </div>

          {authed && minColumn > 0 && (
            <p className="mt-4 rounded-sm bg-[#E8F5E9] px-3 py-2 text-xs leading-[1.5] text-foreground">
              Статус «{TIER_META[tier].name}»: цены пересчитаны по колонке «Опт {minColumn}» на весь
              объём партии.
            </p>
          )}
          {credit && (
            <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs leading-[1.5] text-foreground">
              <input
                type="checkbox"
                checked={deferred}
                onChange={(e) => setDeferred(e.target.checked)}
                className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--primary)]"
              />
              Отгрузить с отсрочкой платежа (15–30 дней по договору)
            </label>
          )}

          {unverified && (
            <p className="mt-4 rounded-sm border border-primary/40 bg-primary/5 px-3 py-2 text-xs leading-[1.5] text-foreground">
              Почта не подтверждена. Откройте письмо ALMAFORT и перейдите по ссылке — оформление
              заказов в кабинете разблокируется сразу после подтверждения.
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              setTriedSubmit(true);
              void submitOrder();
            }}
            disabled={ctaDisabled || submitting}
            className="mt-5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-[15px] font-semibold text-primary-foreground transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:brightness-95 enabled:hover:shadow-[0_4px_12px_rgba(229,36,33,0.2)] enabled:active:translate-y-0 enabled:active:scale-[0.98] enabled:active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-pointer md:text-sm"
          >
            {submitting && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
            {submitting
              ? "Передаём заказ менеджеру…"
              : deferred
                ? "Отгрузить с отсрочкой"
                : "Оформить заказ"}
          </button>
          <button
            type="button"
            onClick={download}
            disabled={!cartReady}
            className="mt-3 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-sm border border-[#D1D5DB] px-4 py-3 text-[15px] font-semibold text-foreground transition-all duration-200 enabled:hover:-translate-y-px enabled:hover:border-primary enabled:hover:text-primary enabled:hover:shadow-[0_4px_12px_rgba(229,36,33,0.2)] enabled:active:translate-y-0 enabled:active:scale-[0.98] enabled:active:shadow-none disabled:cursor-not-allowed disabled:opacity-50 enabled:cursor-pointer md:text-sm"
          >
            <FileDown className="size-4" strokeWidth={2} />
            {pendingQuote && lines.length ? "Считаем доставку…" : "Скачать PDF-счёт"}
          </button>

          {lines.length > 0 && (
            <button
              type="button"
              onClick={clear}
              className="mt-3 w-full cursor-pointer text-xs text-muted-foreground underline underline-offset-4 hover:text-primary"
            >
              Очистить корзину
            </button>
          )}
        </div>

        {!authed && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-semibold text-foreground">
              Войдите в B2B-кабинет перед оформлением
            </p>
            <p className="mt-1.5 text-xs leading-[1.5] text-muted-foreground">
              Реквизиты подставятся автоматически, заказ попадёт в трекинг, а грейд закрепит оптовую
              колонку цен на весь объём.
            </p>
            <a
              href="/auth"
              className="mt-3 inline-flex items-center rounded-sm border border-primary px-4 py-2 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              Войти или создать кабинет
            </a>
          </div>
        )}

        </div>
      </section>



    </div>

  );
}

function PendingRowCard({
  row,
  onResolve,
  onRemove,
}: {
  row: PendingRow;
  onResolve: (sku: string) => void;
  onRemove: () => void;
}) {
  const [q, setQ] = useState("");
  const ambiguous = row.status === "AMBIGUOUS";
  const results = useMemo(() => {
    if (q.trim().length < 2) return [];
    return PRODUCTS.map((p) => ({ p, s: scoreMatch(`${p.name} ${p.sku} ${p.dims}`, q) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5)
      .map((r) => r.p);
  }, [q]);

  return (
    <div
      className={`rounded-md border p-5 transition-colors duration-300 ${
        ambiguous
          ? "border-[#F5C518]/70 bg-[#FFFBEB]"
          : "border-primary/40 bg-[oklch(0.973_0.02_27.5)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{row.originalString}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            из вашей сметы · {row.quantity.toLocaleString("ru-RU")} шт
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="cursor-pointer rounded-sm px-2 py-1 text-xs text-muted-foreground underline underline-offset-4 transition-colors hover:text-primary"
        >
          Удалить строку
        </button>
      </div>

      {ambiguous ? (
        <div className="mt-4">
          <p className="flex items-center gap-2 text-sm font-medium text-[oklch(0.55_0.13_75)]">
            <AlertTriangle className="size-4 shrink-0" strokeWidth={2} />
            Требуется уточнение. Найдено несколько совпадений
          </p>
          <label className="mt-3 block">
            <span className="sr-only">Выберите модель</span>
            <select
              defaultValue=""
              onChange={(e) => e.target.value && onResolve(e.target.value)}
              className="h-11 w-full cursor-pointer rounded-sm border border-[#D1D5DB] bg-card px-3 text-sm text-foreground outline-none transition-colors hover:border-foreground focus:border-foreground"
            >
              <option value="" disabled>
                Выберите модель…
              </option>
              {row.candidates.map((c) => (
                <option key={c.sku} value={c.sku}>
                  {c.name}
                  {c.dims ? ` · ${c.dims}` : ""}
                  {c.is_service ? " · по договоренности" : ` · ${formatPrice(c.price)}`}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-sm font-medium text-primary">
            Позиция не найдена в стандартном каталоге ALMAFORT
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onResolve("SRV-INJ")}
              className="cursor-pointer rounded-sm bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground shadow-[0_2px_8px_oklch(0.573_0.221_27.5/0.25)] transition-colors hover:bg-[#B91C1C]"
            >
              Запросить изготовление на заказ (Литьё / 3D-печать)
            </button>
            <button
              type="button"
              onClick={onRemove}
              className="cursor-pointer rounded-sm border border-[#D1D5DB] px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Удалить строку
            </button>
          </div>
        </div>
      )}

      <div className="relative mt-3 flex items-center gap-2 rounded-sm border border-[#D1D5DB] bg-card px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Или подберите вручную по названию либо артикулу"
          className="h-10 w-full bg-transparent text-sm outline-none"
        />
      </div>
      {results.length > 0 && (
        <ul className="mt-2 space-y-1">
          {results.map((p) => (
            <li key={p.sku}>
              <button
                type="button"
                onClick={() => onResolve(p.sku)}
                className="w-full cursor-pointer rounded-sm px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-[#F3F4F6]"
              >
                <span className="font-semibold">{p.sku}</span> — {p.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
