import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BackLink } from "@/components/back-link";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth-errors";


export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Смена пароля кабинета ALMAFORT" },
      {
        name: "description",
        content: "Установите новый пароль для входа в B2B-кабинет ALMAFORT по одноразовой ссылке.",
      },
      { property: "og:title", content: "Смена пароля ALMAFORT" },
      { property: "og:description", content: "Одноразовая ссылка для установки нового пароля." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  // Письмо ведёт на наш хост со ссылкой ?token_hash=...&type=recovery —
  // обмениваем одноразовый токен на временную сессию прямо здесь.
  useEffect(() => {
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    void (async () => {
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
        url.searchParams.delete("token_hash");
        url.searchParams.delete("type");
        window.history.replaceState(null, "", url.pathname + url.search);
        if (!error) {
          setReady(true);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      setReady(Boolean(data.session));
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const save = async () => {
    if (password.length < 8) {
      toast.error(
        "Пароль слишком простой. Используйте минимум 8 символов, заглавные буквы и цифры.",
      );
      return;
    }
    if (password !== repeat) {
      toast.error("Пароли не совпадают");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password }).catch((e) => ({ error: e }));
    setBusy(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }

    // Сбрасываем все прочие сессии: украденный refresh-токен становится бесполезным.
    await supabase.auth.signOut({ scope: "others" });
    toast.success("Пароль обновлён — остальные устройства разлогинены");
    void navigate({ to: "/cabinet", replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col px-5 pb-24 pt-10">
        <BackLink fallback="/auth" label="К входу" className="mb-6" />
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">Новый пароль</h1>

        {!ready ? (
          <p className="mt-4 text-sm leading-[1.6] text-muted-foreground">
            Ссылка недействительна или истекла. Запросите новую на странице входа — она живёт
            ограниченное время и срабатывает один раз.
          </p>
        ) : (
          <div className="mt-8 space-y-4 rounded-sm border border-border bg-card p-6">
            <KeyRound className="size-6 text-primary" strokeWidth={1.75} />
            <label className="block text-sm font-medium text-foreground">
              Новый пароль <span className="text-primary">*</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Минимум 8 символов"
                className="mt-2 h-11 w-full rounded-sm border border-[#D1D5DB] px-3.5 text-sm outline-none transition-colors focus:border-foreground"
              />
            </label>
            <label className="block text-sm font-medium text-foreground">
              Повторите пароль <span className="text-primary">*</span>
              <input
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !busy && void save()}
                autoComplete="new-password"
                className="mt-2 h-11 w-full rounded-sm border border-[#D1D5DB] px-3.5 text-sm outline-none transition-colors focus:border-foreground"
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-sm bg-primary text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-[#B91C1C] hover:shadow-[0_8px_20px_oklch(0_0_0/0.18)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              Сохранить пароль
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
