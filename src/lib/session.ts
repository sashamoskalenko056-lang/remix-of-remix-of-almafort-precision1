/**
 * Клиентская сессия ALMAFORT.
 *
 * ВАЖНО: сам токен авторизации в браузерном хранилище НЕ живёт — он лежит
 * в HttpOnly-куке `almafort_session`, недоступной JavaScript. В localStorage
 * держим только безопасный снимок профиля, чтобы шапка и кабинет знали,
 * кто вошёл, без лишних запросов.
 */
export type SessionUser = {
  id: string;
  email: string;
  full_name: string | null;
  email_verified: boolean;
};

export type Session = { user: SessionUser; expiresAt: number; token?: string };

const KEY = "almafort:session:v2";
const EVENT = "almafort:auth";

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.user?.id || parsed.expiresAt * 1000 < Date.now()) {
      window.localStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: Session) {
  if (typeof window === "undefined") return;
  // Токен намеренно отбрасываем: хранить его в localStorage запрещено.
  const safe: Session = { user: session.user, expiresAt: session.expiresAt };
  window.localStorage.setItem(KEY, JSON.stringify(safe));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: "SIGNED_IN" }));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  // Куку может погасить только сервер.
  void fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
  window.dispatchEvent(new CustomEvent(EVENT, { detail: "SIGNED_OUT" }));
}

export const currentUser = () => readSession()?.user ?? null;
export const isAuthed = () => Boolean(readSession());
/** Токен недоступен клиенту — сессия передаётся кукой. */
export const authToken = (): string | null => null;

/** Подписка на вход/выход, в том числе из соседней вкладки. */
export function onAuthChange(handler: (event: "SIGNED_IN" | "SIGNED_OUT") => void) {
  if (typeof window === "undefined") return () => {};
  const local = (e: Event) => handler((e as CustomEvent<string>).detail as "SIGNED_IN");
  const cross = (e: StorageEvent) => {
    if (e.key === KEY) handler(e.newValue ? "SIGNED_IN" : "SIGNED_OUT");
  };
  window.addEventListener(EVENT, local);
  window.addEventListener("storage", cross);
  return () => {
    window.removeEventListener(EVENT, local);
    window.removeEventListener("storage", cross);
  };
}
