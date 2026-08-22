import { formatPhone } from "@/lib/phone";
import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { Field, inputClass } from "@/components/forms/field";
import { fieldError, isFilledEmail, isFilledName, isFilledPhone } from "@/lib/required-fields";

/** Модальное окно «Запросить индивидуальный расчет» для позиций без цены. */
export function QuoteRequestModal({
  sku,
  name,
  onClose,
}: {
  sku: string;
  name: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", qty: "" });
  const [consent, setConsent] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const valid =
    isFilledName(form.name) && isFilledPhone(form.phone) && isFilledEmail(form.email) && consent;
  const err = (kind: "name" | "email" | "phone", value: string) =>
    tried ? fieldError(kind, value) : null;

  const submit = async () => {
    setTried(true);
    if (!valid) return;
    setBusy(true);
    try {
      await fetch("/api/quiz/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          quiz_answers: {
            Тип: "Запрос индивидуального расчёта",
            Артикул: sku,
            Позиция: name,
            "Требуемое количество": form.qty || "не указано",
            "Согласие 152-ФЗ": "получено",
          },
          file_urls: [],
        }),
      });
      toast.success("Запрос отправлен — менеджер вернётся с расчётом");
      onClose();
    } catch {
      toast.error("Не удалось отправить запрос — позвоните нам");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Запросить индивидуальный расчет"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[420px] rounded-lg bg-card p-7"
      >
        <button
          type="button"
          aria-label="Закрыть"
          onClick={onClose}
          className="absolute right-4 top-4 cursor-pointer text-muted-foreground hover:text-foreground"
        >
          <X className="size-5" strokeWidth={1.75} />
        </button>
        <h3 className="pr-8 text-lg font-bold text-foreground [overflow-wrap:anywhere]">
          Запросить индивидуальный расчет
        </h3>
        <p className="mt-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {sku} · {name}
        </p>

        <div className="mt-5 grid gap-3">
          <Field label="Имя и фамилия" required error={err("name", form.name)}>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              maxLength={120}
              autoComplete="name"
              placeholder="Имя и фамилия"
              aria-invalid={Boolean(err("name", form.name))}
              className={inputClass(Boolean(err("name", form.name)))}
            />
          </Field>
          <Field label="Телефон" required error={err("phone", form.phone)}>
            <input
              value={form.phone}
              inputMode="tel"
              onChange={(e) => setForm((f) => ({ ...f, phone: formatPhone(e.target.value) }))}
              type="tel"
              required
              autoComplete="tel"
              maxLength={18}
              placeholder="+7 (___) ___-__-__"
              aria-invalid={Boolean(err("phone", form.phone))}
              className={inputClass(Boolean(err("phone", form.phone)), "tabular-nums")}
            />
          </Field>
          <Field label="E-mail" required error={err("email", form.email)}>
            <input
              value={form.email}
              inputMode="email"
              type="email"
              required
              autoComplete="email"
              maxLength={255}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              placeholder="name@company.ru"
              aria-invalid={Boolean(err("email", form.email))}
              className={inputClass(Boolean(err("email", form.email)))}
            />
          </Field>
          <Field label="Требуемое количество, шт">
            <input
              value={form.qty}
              inputMode="numeric"
              pattern="[0-9]*"
              onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value.replace(/\D/g, "") }))}
              placeholder="например, 5000"
              className={inputClass(false, "tabular-nums")}
            />
          </Field>
        </div>

        <ConsentCheckbox
          id={`consent-quote-${sku}`}
          checked={consent}
          onChange={setConsent}
          invalid={tried}
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!valid || busy}
          className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-sm bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
          Отправить запрос
        </button>
      </div>
    </div>
  );
}
