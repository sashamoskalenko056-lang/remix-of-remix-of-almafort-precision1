import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Mail, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BackLink } from "@/components/back-link";
import { supabase } from "@/integrations/supabase/client";
import { ConsentCheckbox } from "@/components/consent-checkbox";
import { authErrorField, authErrorMessage } from "@/lib/auth-errors";
import { useServerFn } from "@tanstack/react-start";
import { passwordIssue } from "@/lib/password";
import {
  checkLoginAllowed,
  reportLoginFailure,
  reportLoginSuccess,
} from "@/lib/auth-guard.functions";


type Mode = "login" | "register" | "magic" | "forgot";

const TABS: Array<{ id: Mode; label: string }> = [
  { id: "login", label: "Вход" },
  { id: "register", label: "Регистрация" },
  { id: "magic", label: "Вход по ссылке" },
];

const emailOk = (v: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim());

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Вход в B2B-кабинет ALMAFORT — заказы, документы, статусы" },
      {
        name: "description",
        content:
          "Кабинет снабженца: статусы заказов от станка до двери, архив счетов и УПД, повтор закупки в один клик и персональный грейд цен.",
      },
      { property: "og:title", content: "Вход в B2B-кабинет ALMAFORT" },
      {
        property: "og:description",
        content: "Личный кабинет снабженца: сквозной трекинг заказов, документы и оптовые грейды.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, follow" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Экран «проверьте почту»: подтверждение регистрации, magic-link или сброс. */
  const [sentKind, setSentKind] = useState<null | "verify" | "magic" | "reset">(null);
  const [fieldError, setFieldError] = useState<{
    field: "email" | "password";
    text: string;
  } | null>(null);
  const navigate = useNavigate();
  const checkLogin = useServerFn(checkLoginAllowed);
  const reportFailure = useServerFn(reportLoginFailure);
  const reportSuccess = useServerFn(reportLoginSuccess);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void navigate({ to: "/cabinet", replace: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) void navigate({ to: "/cabinet", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const submit = async () => {
    setFieldError(null);
    if (!emailOk(email)) {
      setFieldError({ field: "email", text: "Укажите корректный рабочий E-mail." });
      toast.error("Укажите корректный рабочий E-mail.");
      return;
    }
    if ((mode === "login" || mode === "register") && password.length < 8) {
      setFieldError({
        field: "password",
        text: "Пароль слишком простой. Используйте минимум 8 символов, заглавные буквы и цифры.",
      });
      toast.error("Пароль — минимум 8 символов");
      return;
    }
    if (mode === "register") {
      // Регистрация B2B-кабинета: слабый пароль — прямой путь к credential stuffing.
      const weak = passwordIssue(password, email);
      if (weak) {
        setFieldError({ field: "password", text: weak });
        toast.error(weak);
        return;
      }
    }

    const fail = (error: unknown) => {
      const text = authErrorMessage(error);
      const field = authErrorField(error);
      if (field) setFieldError({ field, text });
      toast.error(text);
    };
    setBusy(true);
    try {
      if (mode === "login") {
        const gate = await checkLogin({ data: { email: email.trim() } }).catch(() => null);
        if (gate && !gate.allowed) {
          const min = Math.ceil(gate.retryAfter / 60);
          toast.error(`Слишком много попыток входа. Повторите через ${min} мин.`);
          return;
        }
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) {
          const res = await reportFailure({ data: { email: email.trim() } }).catch(() => null);
          if (res?.blocked) {
            toast.error("Вход заблокирован на 15 минут. Владелец аккаунта уведомлён.");
            return;
          }
          fail(error);
          return;
        }
        void reportSuccess({ data: { email: email.trim() } }).catch(() => null);
      }

      if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/cabinet`,
            data: { full_name: name.trim() },
          },
        });
        if (error) {
          fail(error);
          return;
        }
        // Пока письмо не подтверждено, сессии нет — кабинет закрыт.
        if (!data.session) setSentKind("verify");
      }

      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: `${window.location.origin}/cabinet` },
        });
        if (error) {
          fail(error);
          return;
        }
        setSentKind("magic");
      }

      if (mode === "forgot") {
        // Письмо уходит через собственный SMTP ALMAFORT, а не через почтовик бэкенда.
        const res = await fetch("/api/public/send-mail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "recovery", email: email.trim() }),
        });
        if (!res.ok) {
          fail(new Error("Не удалось отправить письмо. Повторите позже."));
          return;
        }
        setSentKind("reset");
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };


  const needConsent = mode === "register";
  const disabled = busy || (needConsent && !consent);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col px-5 pb-24 pt-10">
        <BackLink fallback="/" label="На главную" className="mb-6" />
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">B2B-кабинет</h1>
        <p className="mt-3 text-sm leading-[1.6] text-muted-foreground">
          Статусы заказов от станка до двери, архив счетов и УПД, повтор закупки в один клик и ваш
          грейд цен. Пароли хранятся в виде необратимого хэша, сессия — в защищённой куке.
        </p>

        {sentKind ? (
          <div className="mt-8 rounded-sm border border-border bg-card p-6">
            <Mail className="size-6 text-primary" strokeWidth={1.75} />
            <p className="mt-3 text-sm font-semibold text-foreground">
              {sentKind === "verify"
                ? "Подтвердите почту"
                : sentKind === "reset"
                  ? "Письмо для сброса отправлено"
                  : "Ссылка входа отправлена"}
            </p>
            <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">
              Проверьте ящик {email}.{" "}
              {sentKind === "verify"
                ? "До подтверждения кабинет и оформление заказов заблокированы."
                : sentKind === "reset"
                  ? "Ссылка одноразовая и действует ограниченное время."
                  : "Откройте ссылку на этом же устройстве."}
            </p>
            <button
              type="button"
              onClick={() => setSentKind(null)}
              className="mt-4 cursor-pointer bg-transparent text-sm font-medium text-primary transition-opacity hover:opacity-80"
            >
              Вернуться к форме
            </button>
          </div>
        ) : (
          <div className="mt-8 rounded-sm border border-border bg-card p-6">
            <div className="mb-5 flex gap-1 rounded-sm bg-[#F1F3F5] p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setMode(t.id)}
                  className={`flex-1 cursor-pointer rounded-sm px-3 py-2 text-[13px] font-semibold transition-all duration-200 ${
                    mode === t.id || (mode === "forgot" && t.id === "login")
                      ? "bg-card text-foreground shadow-[0_1px_3px_oklch(0_0_0/0.12)]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {mode === "register" && (
                <label className="block text-sm font-medium text-foreground">
                  ФИО снабженца <span className="text-primary">*</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Иванов Иван"
                    autoComplete="name"
                    className="mt-2 h-11 w-full rounded-sm border border-[#D1D5DB] px-3.5 text-sm outline-none transition-colors focus:border-foreground"
                  />
                </label>
              )}

              <label className="block text-sm font-medium text-foreground">
                Рабочая почта <span className="text-primary">*</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setFieldError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && !disabled && void submit()}
                  placeholder="snab@zavod.ru"
                  autoComplete="email"
                  aria-invalid={fieldError?.field === "email"}
                  className={`mt-2 h-11 w-full rounded-sm border px-3.5 text-sm outline-none transition-colors focus:border-foreground ${
                    fieldError?.field === "email" ? "border-primary" : "border-[#D1D5DB]"
                  }`}
                />
                {fieldError?.field === "email" && (
                  <span className="mt-1.5 block text-xs font-normal leading-[1.5] text-primary">
                    {fieldError.text}
                  </span>
                )}
              </label>


              {(mode === "login" || mode === "register") && (
                <label className="block text-sm font-medium text-foreground">
                  Пароль <span className="text-primary">*</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setFieldError(null);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && !disabled && void submit()}
                    placeholder="Минимум 8 символов"
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    aria-invalid={fieldError?.field === "password"}
                    className={`mt-2 h-11 w-full rounded-sm border px-3.5 text-sm outline-none transition-colors focus:border-foreground ${
                      fieldError?.field === "password" ? "border-primary" : "border-[#D1D5DB]"
                    }`}
                  />
                  {fieldError?.field === "password" && (
                    <span className="mt-1.5 block text-xs font-normal leading-[1.5] text-primary">
                      {fieldError.text}
                    </span>
                  )}
                </label>

              )}

              {mode === "forgot" && (
                <p className="rounded-sm bg-[#F8F9FA] px-3 py-2 text-xs leading-[1.5] text-muted-foreground">
                  Пришлём одноразовую ссылку на смену пароля. После сброса активные сессии на всех
                  устройствах завершаются.
                </p>
              )}

              {needConsent && <ConsentCheckbox checked={consent} onChange={setConsent} />}

              <button
                type="button"
                disabled={disabled}
                onClick={() => void submit()}
                className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-sm bg-primary text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-[#B91C1C] hover:shadow-[0_8px_20px_oklch(0_0_0/0.18)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                {mode === "login"
                  ? "Войти в кабинет"
                  : mode === "register"
                    ? "Создать кабинет"
                    : mode === "magic"
                      ? "Получить ссылку для входа"
                      : "Прислать ссылку для сброса"}
              </button>

              {mode !== "magic" && (
                <button
                  type="button"
                  onClick={() => setMode(mode === "forgot" ? "login" : "forgot")}
                  className="cursor-pointer bg-transparent text-[13px] font-medium text-muted-foreground transition-colors hover:text-primary"
                >
                  {mode === "forgot" ? "Вспомнил пароль — войти" : "Забыли пароль?"}
                </button>
              )}
            </div>
          </div>
        )}

        <p className="mt-6 flex items-start gap-2 text-xs leading-[1.5] text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
          Доступ к заказам, счетам и УПД — только владельцу аккаунта: данные изолированы на уровне
          базы.
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
