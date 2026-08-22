import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { isAuthed, onAuthChange } from "@/lib/session";
import { useCart } from "@/store/cart-store";
import { mergeSavedCart, saveCart } from "@/lib/cart-sync.functions";

/**
 * Коллизия гостевой корзины: при входе гостевые позиции сливаются
 * с корзиной профиля без дублей, дальше корзина зеркалится на сервер.
 */
export function CartSync() {
  const merge = useServerFn(mergeSavedCart);
  const push = useServerFn(saveCart);
  const lines = useCart((s) => s.lines);
  const applyMerged = useCart((s) => s.applyMergedLines);
  const signedIn = useRef(false);

  useEffect(() => {
    const run = async () => {
      const guest = useCart.getState().lines.map((l) => ({ sku: l.sku, quantity: l.quantity }));
      try {
        const res = await merge({ data: { lines: guest } });
        applyMerged(res?.lines ?? []);
        if ((res?.restored ?? 0) > 0) {
          toast.info(`Корзина объединена с сохранённой в кабинете: +${res.restored} поз.`);
        }
      } catch (e) {
        console.error("[cart-sync] слияние не выполнено", e);
      }
    };

    if (isAuthed() && !signedIn.current) {
      signedIn.current = true;
      void run();
    }

    return onAuthChange((event) => {
      if (event === "SIGNED_IN" && !signedIn.current) {
        signedIn.current = true;
        void run();
      }
      if (event === "SIGNED_OUT") signedIn.current = false;
    });
  }, [merge, applyMerged]);

  // Кросс-таб синхронизация: снабженец держит 15 вкладок с карточками.
  // Добавил товар во вкладке 2 — счётчик и сумма в шапке вкладки 1 обновятся сразу.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key && e.key !== "almafort:cart:v5") return;
      void useCart.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Зеркалим изменения корзины в профиль — не чаще раза в 2 секунды.
  useEffect(() => {
    if (!signedIn.current) return;
    const t = window.setTimeout(() => {
      void push({ data: { lines: lines.map((l) => ({ sku: l.sku, quantity: l.quantity })) } }).catch(
        () => null,
      );
    }, 2000);
    return () => window.clearTimeout(t);
  }, [lines, push]);

  return null;
}
