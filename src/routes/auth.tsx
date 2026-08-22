import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BackLink } from "@/components/back-link";
import { readSession, writeSession, type SessionUser } from "@/lib/session";
import { ConsentCheckbox } from "@/components/consent-checkbox";

const emailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());
const OTP_LENGTH = 4;

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход в B2B-кабинет ALMAFORT — заказы, документы, статусы" },
      {
        name: "description",
        content:
          "Кабинет снабженца: вход по одноразовому коду из письма, статусы заказов, архив счетов и УПД, повтор закупки в один клик.",
      },
      { property: "og:title", content: "Вход в B2B-кабинет ALMAFORT" },
      {
        property: "og:description",
        content: "Личный кабинет снабженца: вход по коду из письма, трекинг заказов и документы.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [codeError, setCodeError] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    if (readSession()) void navigate({ to: "/cabinet", replace: true });
  }, [navigate]);

  // Таймер повторной отправки: кнопка блокируется на 60 секунд.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => setCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") inputs.current[0]?.focus();
  }, [step]);

  const sendCode = async () => {
    setEmailError(null);
    if (!emailOk(email)) {
      setEmailError("Укажите корректный рабочий E-mail.");
      return;
    }
    if (!consent) {
      toast.error("Подтвердите согласие на обработку данных");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/otp-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        retryAfter?: number;
      };
      if (res.status === 429) {
        setCooldown(body.retryAfter ?? 60);
        toast.error(body.error ?? "Слишком часто. Попробуйте позже.");
        return;
      }
      if (!res.ok) {
        toast.error(body.error ?? "Не удалось отправить код. Повторите позже.");
        return;
      }
      setDigits(Array(OTP_LENGTH).fill(""));
      setCodeError(null);
      setCooldown(60);
      setStep("code");
      toast.success(`Код отправлен на ${email.trim()}`);
    } catch {
      toast.error("Сеть недоступна. Проверьте соединение.");
    } finally {
      setBusy(false);
    }
  };

  const failCode = (text: string, backToEmail = false) => {
    setCodeError(text);
    setShake(true);
    window.setTimeout(() => setShake(false), 420);
    setDigits(Array(OTP_LENGTH).fill(""));
    if (backToEmail) {
      setStep("email");
      toast.error(text);
    } else {
      inputs.current[0]?.focus();
    }
  };

  const submitCode = async (code: string) => {
    if (code.length !== OTP_LENGTH || busy) return;
    setBusy(true);
    setCodeError(null);
    try {
      const res = await fetch("/api/auth/otp-verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim().toLowerCase(), code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        status?: string;
        error?: string;
        user?: SessionUser;
        expiresAt?: number;
      };

      if (body.status === "ok" && body.user && body.expiresAt) {
        writeSession({ user: body.user, expiresAt: body.expiresAt });
        void navigate({ to: "/cabinet", replace: true });
        return;
      }
      if (body.status === "locked") {
        setCooldown(0);
        failCode(body.error ?? "Попытки исчерпаны. Запросите код заново", true);
        return;
      }
      if (body.status === "expired") {
        failCode(body.error ?? "Время действия кода истекло. Запросите новый", true);
        return;
      }
      failCode(body.error ?? "Неверный код");
    } catch {
      failCode("Сеть недоступна. Повторите попытку.");
    } finally {
      setBusy(false);
    }
  };

  const setDigit = (index: number, value: string) => {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      const next = [...digits];
      next[index] = "";
      setDigits(next);
      return;
    }
    // Вставка полного кода из письма: раскладываем цифры по всем квадратам.
    if (clean.length > 1) {
      const filled = clean.slice(0, OTP_LENGTH).split("");
      const next = Array(OTP_LENGTH)
        .fill("")
        .map((_, i) => filled[i] ?? "");
      setDigits(next);
      inputs.current[Math.min(filled.length, OTP_LENGTH) - 1]?.focus();
      if (filled.length === OTP_LENGTH) void submitCode(filled.join(""));
      return;
    }
    const next = [...digits];
    next[index] = clean;
    setDigits(next);
    setCodeError(null);
    if (index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
    if (next.every((d) => d)) void submitCode(next.join(""));
  };

  const onKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        setDigits(next);
        return;
      }
      if (index > 0) {
        next[index - 1] = "";
        setDigits(next);
        inputs.current[index - 1]?.focus();
      }
    }
    if (e.key === "ArrowLeft" && index > 0) inputs.current[index - 1]?.focus();
    if (e.key === "ArrowRight" && index < OTP_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col px-5 pb-24 pt-10">
        <BackLink fallback="/" label="На главную" className="mb-6" />
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">B2B-кабинет</h1>
        <p className="mt-3 text-sm leading-[1.6] text-muted-foreground">
          Вход и регистрация — по одноразовому коду из письма. Пароли не нужны: сессия хранится в
          защищённой куке, недоступной сторонним скриптам.
        </p>

        <div className="mt-8 rounded-sm border border-border bg-card p-6">
          {step === "email" ? (
            <div className="space-y-4">
              <label className="block text-sm font-medium text-foreground">
                Рабочая почта <span className="text-primary">*</span>
                <input
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && !busy && void sendCode()}
                  placeholder="snab@zavod.ru"
                  autoComplete="email"
                  aria-invalid={Boolean(emailError)}
                  className={`mt-2 h-12 w-full rounded-sm border px-3.5 text-base outline-none transition-colors focus:border-foreground ${
                    emailError ? "border-primary" : "border-[#D1D5DB]"
                  }`}
                />
                {emailError && (
                  <span className="mt-1.5 block text-xs font-normal leading-[1.5] text-primary">
                    {emailError}
                  </span>
                )}
              </label>

              <ConsentCheckbox checked={consent} onChange={setConsent} />

              <button
                type="button"
                disabled={busy || cooldown > 0}
                onClick={() => void sendCode()}
                className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-sm bg-primary text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-[#B91C1C] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {cooldown > 0
                  ? `Запросить новый код можно через ${cooldown} сек.`
                  : "Получить код входа"}
              </button>
              <p className="text-xs leading-[1.5] text-muted-foreground">
                Если почты ещё нет в системе — кабинет снабженца создастся автоматически.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-2">
                <Mail className="mt-0.5 size-5 shrink-0 text-primary" strokeWidth={1.75} />
                <p className="text-sm leading-[1.6] text-foreground">
                  Код из 4 цифр отправлен на <span className="font-semibold">{email}</span>. Он
                  действует 5 минут.
                </p>
              </div>

              <div
                className={`flex justify-center gap-3 ${shake ? "animate-[otp-shake_0.4s_ease-in-out]" : ""}`}
              >
                {digits.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    value={digit}
                    onChange={(e) => setDigit(i, e.target.value)}
                    onKeyDown={(e) => onKeyDown(i, e)}
                    onFocus={(e) => e.currentTarget.select()}
                    type="tel"
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    maxLength={OTP_LENGTH}
                    aria-label={`Цифра ${i + 1}`}
                    aria-invalid={Boolean(codeError)}
                    disabled={busy}
                    className={`size-16 rounded-sm border-2 text-center text-3xl font-bold text-foreground outline-none transition-colors sm:size-[68px] ${
                      codeError
                        ? "border-primary bg-primary/5"
                        : "border-[#D1D5DB] focus:border-foreground"
                    }`}
                  />
                ))}
              </div>

              {codeError && (
                <p className="text-center text-sm font-medium text-primary">{codeError}</p>
              )}
              {busy && (
                <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Проверяем код…
                </p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setStep("email");
                    setCodeError(null);
                  }}
                  className="cursor-pointer bg-transparent text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  Изменить почту
                </button>
                <button
                  type="button"
                  disabled={cooldown > 0 || busy}
                  onClick={() => void sendCode()}
                  className="cursor-pointer bg-transparent text-[13px] font-semibold text-primary transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:text-muted-foreground"
                >
                  {cooldown > 0 ? `Новый код через ${cooldown} сек.` : "Отправить код повторно"}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-6 flex items-start gap-2 text-xs leading-[1.5] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          Доступ к заказам, счетам и УПД — только владельцу аккаунта: код действует 5 минут, не
          более 3 попыток ввода.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Нет заказов?{" "}
          <Link to="/catalog" className="font-medium text-primary hover:underline">
            Начните с каталога
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
