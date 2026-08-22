/**
 * Единая точка чтения внешних учётных данных.
 * Приоритет: зашифрованное хранилище админки (AES-256-GCM) → переменная окружения.
 * Хардкод паролей в коде запрещён — все шлюзы читают ключи только отсюда.
 */
import { decryptSecret } from "@/lib/admin.server";

type Cached = { value: string | null; at: number };
const TTL_MS = 60_000;
const cache = new Map<string, Cached>();

export async function secretValue(name: string): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  let value: string | null = null;
  try {
    const { db: store } = await import("@/lib/db.server");
    const { data } = await store
      .from("app_settings")
      .select("value")
      .eq("key", `vault:${name}`)
      .maybeSingle();
    const cipher = (data?.value as { cipher?: string } | null)?.cipher;
    if (cipher) value = decryptSecret(cipher);
  } catch (e) {
    // Хранилище недоступно — не роняем интеграцию, уходим в переменные окружения.
    console.error(`[vault] read ${name} failed`, e);
  }

  if (!value) value = process.env[name] ?? null;
  cache.set(name, { value, at: Date.now() });
  return value;
}

/** Несколько ключей за один проход — для интеграций с логином и паролем. */
export async function secretValues<T extends string>(
  names: readonly T[],
): Promise<Record<T, string | null>> {
  const out = {} as Record<T, string | null>;
  await Promise.all(
    names.map(async (n) => {
      out[n] = await secretValue(n);
    }),
  );
  return out;
}

/** Сбрасываем кеш после сохранения ключа в админке. */
export function invalidateSecret(name: string) {
  cache.delete(name);
}
