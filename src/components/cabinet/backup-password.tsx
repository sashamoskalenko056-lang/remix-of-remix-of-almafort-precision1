import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { KeyRound, Loader2 } from "lucide-react";
import { setBackupPassword } from "@/lib/cabinet.functions";

/**
 * Резервный пароль — только внутри кабинета. При входе и регистрации
 * пароль не спрашивается: стартовая авторизация всегда по OTP из письма.
 */
export function BackupPassword() {
  const save = useServerFn(setBackupPassword);
  const [value, setValue] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (value.length < 8) {
      toast.error("Пароль от 8 символов");
      return;
    }
    if (value !== repeat) {
      toast.error("Пароли не совпадают");
      return;
    }
    setBusy(true);
    try {
      await save({ data: { password: value } });
      setValue("");
      setRepeat("");
      toast.success("Резервный пароль сохранён");
    } catch (e) {
      toast.error((e as Error)?.message || "Не удалось сохранить пароль");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-sm border border-border bg-card p-6">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
        <KeyRound className="size-4" strokeWidth={1.75} /> Резервный пароль
      </p>
      <p className="mt-3 text-xs leading-[1.5] text-muted-foreground">
        Обычный вход — по коду из письма. Пароль нужен как запасной способ, если почта временно
        недоступна.
      </p>
      <div className="mt-4 grid gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Новый пароль"
          autoComplete="new-password"
          maxLength={200}
          className="h-12 w-full rounded-sm border border-[#D1D5DB] px-3.5 text-base outline-none transition-colors focus:border-foreground md:h-11"
        />
        <input
          type="password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          placeholder="Повторите пароль"
          autoComplete="new-password"
          maxLength={200}
          className="h-12 w-full rounded-sm border border-[#D1D5DB] px-3.5 text-base outline-none transition-colors focus:border-foreground md:h-11"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-border text-sm font-semibold text-foreground transition-all duration-200 hover:border-primary hover:text-primary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 md:h-11"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Сохранить пароль
        </button>
      </div>
    </div>
  );
}
