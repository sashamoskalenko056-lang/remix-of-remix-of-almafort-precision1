import { formatPhone } from "@/lib/phone";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSwipeClose } from "@/lib/use-swipe-close";
import { getCabinet } from "@/lib/cabinet.functions";
import { currentUser } from "@/lib/session";
import type { Product } from "@/data/catalog";
import { formatPrice } from "@/lib/pricing";
import { Field, inputClass } from "@/components/forms/field";
import { fieldError, isFilledEmail, isFilledInn, isFilledName, isFilledPhone } from "@/lib/required-fields";
import { sanitizeInn } from "@/lib/inn";

const field =
  "h-11 w-full rounded-sm border border-[#D1D5DB] px-3 text-base outline-none transition-colors focus:border-foreground";

/**
 * Заявка на спеццену: Bottom Sheet на мобильном, модалка по центру на десктопе.
 * Артикул, название и базовая цена подставляются из карточки автоматически.
 */
export function BulkRequestDialog({
  product,
  open,
  onClose,
  presetComment,
}: {
  product: Product;
  open: boolean;
  onClose: () => void;
  /** Предзаполненный текст (например, ненайденные позиции из спецификации). */
  presetComment?: string;
}) {
  const minQty = Math.max(product.tier2Qty || 50000, 1000);
  const [qty, setQty] = useState(String(minQty));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [inn, setInn] = useState("");
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [exceeds, setExceeds] = useState(false);
  const [tried, setTried] = useState(false);

  // Обязательный минимум по заявке: ФИО, телефон, почта, ИНН.
  const requiredOk =
    isFilledName(name) && isFilledPhone(phone) && isFilledEmail(email) && isFilledInn(inn);
  const err = (kind: "name" | "email" | "phone" | "inn", value: string) =>
    tried ? fieldError(kind, value) : null;

  useEffect(() => {
    if (open && presetComment) setComment((c) => c || presetComment.slice(0, 1000));
  }, [open, presetComment]);


  // Авторизованному снабженцу не нужно вводить контакты заново.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      const user = currentUser();
      if (!user || !alive) return;
      setEmail((e) => e || user.email);
      try {
        const data = await getCabinet();
        if (!alive) return;
        const profile = data.profile as { full_name?: string; phone?: string } | null;
        const company = data.companies[0] as { inn?: string } | undefined;
        if (profile?.full_name) setName((v) => v || profile.full_name!);
        if (profile?.phone) setPhone((v) => v || profile.phone!);
        if (company?.inn) setInn((v) => v || company.inn!);
      } catch {
        // Не авторизован или сессия истекла — форма заполняется вручную.
      }
    })();
    return () => {
      alive = false;
    };
  }, [open]);

  const submit = async () => {
    setError("");
    const qtyNum = Number(qty.replace(/\D/g, ""));
    if (!Number.isFinite(qtyNum) || qtyNum < minQty) {
      setError(`Минимальный объём запроса — ${minQty.toLocaleString("ru-RU")} шт`);
      return;
    }
    if (!requiredOk) {
      setError("Заполните все обязательные поля: ФИО, телефон, e-mail и ИНН");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/leads/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: product.sku,
          product_name: product.name,
          base_price: product.price,
          qty: qtyNum,
          contact_name: name.trim(),
          phone: phone.trim(),
          email: email.trim(),
          inn: inn.trim(),
          comment: comment.trim(),
        }),
      });
      const json = (await res.json()) as { error?: string; exceedsStock?: boolean };
      if (!res.ok) throw new Error(json.error ?? "Ошибка отправки");
      setExceeds(Boolean(json.exceedsStock));
      setState("done");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Ошибка отправки");
    }
  };

  const swipe = useSwipeClose(onClose);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        data-bottom-sheet
        style={swipe.sheetStyle}
        className="bottom-0 top-auto max-h-[88dvh] w-full max-w-full translate-y-0 overflow-y-auto rounded-t-2xl px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-lg sm:pb-6"
      >
        {/* Свайп вниз — привычный способ закрыть шторку на смартфоне */}
        <div className="sheet-grabber -mt-2 sm:hidden" aria-hidden {...swipe.handleProps} />
        <DialogHeader>
          <DialogTitle className="text-lg font-extrabold">Спеццена на крупную партию</DialogTitle>
        </DialogHeader>

        {state === "done" ? (
          <div className="space-y-3 py-4 text-sm">
            <p className="font-semibold text-foreground">Заявка принята.</p>
            <p className="text-muted-foreground">
              Отдел оптовых продаж пришлёт расчёт по {product.name} ({product.sku}) в течение
              рабочего дня.
            </p>
            {exceeds && (
              <p className="rounded-sm bg-primary/10 p-3 text-xs leading-[1.5] font-semibold text-primary">
                Объём превышает текущий складской остаток — партия будет размещена в производство,
                менеджер согласует срок изготовления.
              </p>
            )}
            <button type="button" onClick={onClose} className="h-12 w-full rounded-sm bg-foreground text-sm font-semibold text-background">
              Закрыть
            </button>
          </div>
        ) : (
          // Enter в любом поле отправляет форму: снабженцу не нужно тянуться мышкой.
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setTried(true);
              void submit();
            }}
          >
            <div className="rounded-sm bg-surface p-3 text-sm">
              <p className="font-semibold text-foreground">{product.name}</p>
              <p className="text-xs text-muted-foreground">
                Артикул {product.sku} · базовая цена {formatPrice(product.price)}
              </p>
            </div>

            <label className="block text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wider text-muted-foreground">
                Желаемый объём, шт
              </span>
              <input
                value={qty}
                autoFocus
                onChange={(e) => setQty(e.target.value.replace(/[^0-9]/g, "").slice(0, 9))}
                onBlur={() => setQty(String(Math.max(minQty, Number(qty.replace(/\D/g, "")) || minQty)))}
                inputMode="numeric"
                pattern="[0-9]*"
                className={field}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Имя и фамилия" required error={err("name", name)}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Имя и фамилия"
                  aria-invalid={Boolean(err("name", name))}
                  className={inputClass(Boolean(err("name", name)))}
                />
              </Field>
              <Field label="Телефон" required error={err("phone", phone)}>
                <input
                  value={phone}
                  onChange={(e) => setPhone(formatPhone(e.target.value))}
                  type="tel"
                  required
                  autoComplete="tel"
                  maxLength={18}
                  placeholder="+7 (___) ___-__-__"
                  inputMode="tel"
                  aria-invalid={Boolean(err("phone", phone))}
                  className={inputClass(Boolean(err("phone", phone)))}
                />
              </Field>
              <Field label="E-mail" required error={err("email", email)}>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={255}
                  placeholder="name@company.ru"
                  inputMode="email"
                  aria-invalid={Boolean(err("email", email))}
                  className={inputClass(Boolean(err("email", email)))}
                />
              </Field>
              <Field label="ИНН" required error={err("inn", inn)}>
                <input
                  value={inn}
                  onChange={(e) => setInn(sanitizeInn(e.target.value))}
                  required
                  placeholder="10 или 12 цифр"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  aria-invalid={Boolean(err("inn", inn))}
                  className={inputClass(Boolean(err("inn", inn)), "tabular-nums")}
                />
              </Field>
            </div>

            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value.slice(0, 2000))}
              maxLength={2000}
              placeholder="Сроки, цвет, доставка — что важно учесть"
              rows={3}
              className="w-full rounded-sm border border-[#D1D5DB] p-3 text-base outline-none focus:border-foreground"
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={state === "sending" || !requiredOk}
              className="h-12 w-full cursor-pointer rounded-sm bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-[#B91C1C] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {state === "sending" ? "Отправляем…" : "Отправить запрос в отдел оптовых продаж"}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
