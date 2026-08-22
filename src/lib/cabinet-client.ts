import { supabase } from "@/integrations/supabase/client";
import { EMPTY_LOYALTY, type LoyaltySummary } from "@/lib/loyalty";

const CABINET_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), CABINET_TIMEOUT_MS);
    }),
  ]);
}

export async function getCabinetFromBrowser() {
  const sessionResult = await withTimeout(supabase.auth.getSession(), "Проверка сессии");
  if (sessionResult.error || !sessionResult.data.session) {
    throw new Error("Unauthorized: сессия отсутствует или истекла");
  }

  const [profileRes, companiesRes, ordersRes, loyaltyRes] = await withTimeout(
    Promise.all([
      supabase.from("profiles").select("*").eq("id", sessionResult.data.session.user.id).maybeSingle(),
      supabase.from("companies").select("*").order("created_at", { ascending: true }),
      supabase
        .from("orders")
        .select("id, number, status, total, carrier, city, created_at, tracking_number")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase.rpc("my_loyalty"),
    ]),
    "Загрузка кабинета",
  );

  const firstError = profileRes.error ?? companiesRes.error ?? ordersRes.error ?? loyaltyRes.error;
  if (firstError) throw firstError;

  const loyalty = (loyaltyRes.data as LoyaltySummary | null) ?? EMPTY_LOYALTY;
  return {
    profile: profileRes.data ?? null,
    companies: companiesRes.data ?? [],
    orders: ordersRes.data ?? [],
    loyalty: {
      total_spent: Number(loyalty.total_spent ?? 0),
      tier: (loyalty.tier ?? 1) as 1 | 2 | 3,
      next_threshold: loyalty.next_threshold ?? null,
    },
  };
}