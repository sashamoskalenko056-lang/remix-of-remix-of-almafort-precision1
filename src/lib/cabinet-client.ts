import { getCabinet } from "@/lib/cabinet.functions";
import { readSession } from "@/lib/session";

const CABINET_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error(`${label}: превышено время ожидания`)),
        CABINET_TIMEOUT_MS,
      );
    }),
  ]);
}

/** Данные кабинета грузим с клиента: сессия живёт в localStorage, SSR её не видит. */
export async function getCabinetFromBrowser() {
  if (!readSession()) throw new Error("401 Unauthorized: сессия отсутствует или истекла");

  const result = await withTimeout(getCabinet(), "Загрузка кабинета");

  // Сервер при отказе отдаёт { error: "Unauthorized" } со статусом 401.
  // Такой ответ нельзя пускать в компонент как данные: иначе экран падает
  // на пустом профиле вместо мгновенного редиректа на /auth.
  const payload = result as unknown as { error?: string; loyalty?: unknown };
  if (payload?.error || !payload?.loyalty) {
    throw new Error(
      payload?.error ? `401 Unauthorized: ${payload.error}` : "Кабинет вернул пустой ответ",
    );
  }
  return result;
}
