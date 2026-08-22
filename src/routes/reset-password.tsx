import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { BackLink } from "@/components/back-link";
import { writeSession, type SessionUser } from "@/lib/session";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Восстановление доступа к кабинету ALMAFORT" },
      {
        name: "description",
        content:
          "Безопасный вход в B2B-кабинет ALMAFORT по одноразовой ссылке восстановления доступа.",
      },
      { property: "og:title", content: "Восстановление доступа ALMAFORT" },
      { property: "og:description", content: "Одноразовая ссылка безопасного входа в кабинет." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: RecoveryPage,
});

function RecoveryPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "failed">("checking");
  const [message, setMessage] = useState("Проверяем ссылку…");

  // Пароли отменены: ссылка просто открывает сессию и ведёт в кабинет.
  useEffect(() => {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token") ?? url.searchParams.get("token_hash");
    if (!token) {
      setState("failed");
      setMessage("Ссылка недействительна. Запросите код входа на странице входа.");
      return;
    }
    window.history.replaceState(null, "", url.pathname);
    void (async () => {
      try {
        const res = await fetch("/api/auth/consume-link", {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ token }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          user?: SessionUser;
          expiresAt?: number;
        };
        if (!res.ok || !body.ok || !body.user || !body.expiresAt) {
          setState("failed");
          setMessage(body.error ?? "Ссылка недействительна или истекла.");
          return;
        }
        writeSession({ user: body.user, expiresAt: body.expiresAt });
        toast.success("Вход выполнен");
        void navigate({ to: "/cabinet", replace: true });
      } catch {
        setState("failed");
        setMessage("Сеть недоступна. Повторите попытку.");
      }
    })();
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[520px] flex-1 flex-col px-5 pb-24 pt-10">
        <BackLink fallback="/auth" label="К входу" className="mb-6" />
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          Восстановление доступа
        </h1>
        <div className="mt-8 space-y-4 rounded-sm border border-border bg-card p-6">
          {state === "checking" ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {message}
            </p>
          ) : (
            <>
              <KeyRound className="size-6 text-primary" strokeWidth={1.75} />
              <p className="text-sm leading-[1.6] text-muted-foreground">{message}</p>
              <Link
                to="/auth"
                className="inline-flex h-12 w-full items-center justify-center rounded-sm bg-primary text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-[#B91C1C] active:scale-[0.98]"
              >
                Получить код входа
              </Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
