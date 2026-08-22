/**
 * Серверная корзина профиля: гостевая корзина со смартфона сливается
 * с исторической корзиной кабинета без дублей артикулов.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";

const lineSchema = z.object({
  sku: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(1_000_000),
});

export type SyncedLine = z.infer<typeof lineSchema>;

/** Слияние: одинаковый SKU не дублируется, берём максимальное количество. */
export function mergeCartLines(a: SyncedLine[], b: SyncedLine[]): SyncedLine[] {
  const map = new Map<string, number>();
  for (const l of [...a, ...b]) {
    map.set(l.sku, Math.max(map.get(l.sku) ?? 0, l.quantity));
  }
  return [...map].map(([sku, quantity]) => ({ sku, quantity }));
}

export const mergeSavedCart = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { lines: SyncedLine[] }) =>
    z.object({ lines: z.array(lineSchema).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { db, userId } = context;
    const { data: row } = await supabase
      .from("saved_carts")
      .select("lines")
      .eq("user_id", userId)
      .maybeSingle();

    const stored = z.array(lineSchema).catch([]).parse(row?.lines ?? []);
    const merged = mergeCartLines(stored, data.lines);

    const { error } = await supabase
      .from("saved_carts")
      .upsert({ user_id: userId, lines: merged }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    return { lines: merged, restored: merged.length - data.lines.length };
  });

export const saveCart = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .inputValidator((input: { lines: SyncedLine[] }) =>
    z.object({ lines: z.array(lineSchema).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.db
      .from("saved_carts")
      .upsert({ user_id: context.userId, lines: data.lines }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
