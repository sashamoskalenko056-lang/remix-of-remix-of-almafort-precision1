import { useEffect, useState } from "react";
import { getCabinet } from "@/lib/cabinet.functions";
import { currentUser, isAuthed, onAuthChange } from "@/lib/session";
import { EMPTY_LOYALTY, TIER_META, type LoyaltySummary, type LoyaltyTier } from "@/lib/loyalty";

/**
 * Грейд лояльности текущего клиента. Для гостей — базовый.
 * Грейд закрепляет минимальную ценовую колонку каталога на любой объём.
 */
export function useLoyalty() {
  const [summary, setSummary] = useState<LoyaltySummary>(EMPTY_LOYALTY);
  const [authed, setAuthed] = useState(false);
  const [verified, setVerified] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const user = currentUser();
      if (!alive) return;
      setAuthed(isAuthed());
      if (!user) {
        setSummary(EMPTY_LOYALTY);
        setVerified(true);
        return;
      }
      setVerified(user.email_verified);
      try {
        const data = await getCabinet();
        if (!alive) return;
        setSummary({
          total_spent: Number(data.loyalty.total_spent ?? 0),
          tier: (data.loyalty.tier ?? 1) as LoyaltyTier,
          next_threshold: data.loyalty.next_threshold ?? null,
        });
      } catch {
        // Гость или протухшая сессия — остаёмся на базовом грейде.
      }
    };
    void load();
    const off = onAuthChange(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, []);

  const tier = summary.tier;
  return {
    summary,
    tier,
    authed,
    verified,
    minColumn: TIER_META[tier].minColumn,
    credit: TIER_META[tier].credit,
  };
}
