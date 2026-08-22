/**
 * Клиентская сессия ALMAFORT: токен и профиль пользователя в localStorage.
 * Никаких сторонних SDK — только наш собственный API.
 */
export type SessionUser = {
  id: string;
  email: string;
  full_name: string | null;
  email_verified: boolean;
};

export type Session = { token: string; user: SessionUser; expiresAt: number };

const KEY = "almafort:session:v1";
const EVENT = "almafort:auth";

export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || parsed.expiresAt * 1000 < Date.now()) {
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
  window.localStorage.setItem(KEY, JSON.stringify(session));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: "SIGNED_IN" }));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: "SIGNED_OUT" }));
}

export const currentUser = () => readSession()?.user ?? null;
export const isAuthed = () => Boolean(readSession());
export const authToken = () => readSession()?.token ?? null;

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
