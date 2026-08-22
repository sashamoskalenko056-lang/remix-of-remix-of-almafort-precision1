import { getCabinet } from "@/lib/cabinet.functions";
import { readSession } from "@/lib/session";

const CABINET_TIMEOUT_MS = 15_000;

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
  if (!readSession()) throw new Error("Unauthorized: сессия отсутствует или истекла");
  return withTimeout(getCabinet(), "Загрузка кабинета");
}
