/**
 * Серверное ядро расчёта доставки.
 * Оба оператора опрашиваются параллельно с жёстким таймаутом 3000 мс.
 * Если живого API нет (нет кредов) или он не ответил — отдаём тарифную модель,
 * чтобы интерфейс клиента никогда не блокировался.
 */
import { secretValues } from "@/lib/vault.server";
import {
  ORIGIN,
  type Destination,
  type Parcel,
  type ShippingQuote,
} from "./logistics";

const TIMEOUT_MS = 3000;

type Zone = { k: number; days: number; match: RegExp };

const ZONES: Zone[] = [
  { k: 0.35, days: 1, match: /дивногорск|красноярск|железногорск|сосновоборск|ачинск|канск/i },
  { k: 0.7, days: 3, match: /новосибирск|кемеро|томск|барнаул|омск|абакан|иркут|улан|чита|тюмен/i },
  {
    k: 1,
    days: 5,
    match: /москв|петербург|казан|екатеринбург|нижн|самар|уф[аы]|перм|воронеж|ростов|краснодар|волгоград|челябин|саратов/i,
  },
  { k: 1.45, days: 8, match: /владивосток|хабаровск|якут|магадан|камчат|сахалин|мурманск|калининград|сочи/i },
];

const zoneFor = (city: string) => ZONES.find((z) => z.match.test(city)) ?? { k: 1.15, days: 6 };

/** Платный вес: max(физический, объёмный по 250 кг/м3 у сборных грузов). */
export function chargeableWeight(parcel: Parcel) {
  return Math.max(parcel.totalWeight, parcel.totalVolume * 250);
}

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/* --------------------------- Тарифные модели ---------------------------- */

function cdekModel(dest: Destination, parcel: Parcel): ShippingQuote {
  const z = zoneFor(dest.city);
  const w = chargeableWeight(parcel);
  return {
    carrier: "cdek",
    label: "СДЭК · Магистральный экспресс",
    price: Math.round((420 + w * 26) * z.k),
    days: z.days,
    toDoor: true,
    source: "model",
  };
}

function dlModel(dest: Destination, parcel: Parcel): ShippingQuote {
  const z = zoneFor(dest.city);
  const w = chargeableWeight(parcel);
  // ДЛ считает межтерминальную перевозку + обрешётка на объёмных партиях.
  const crate = parcel.totalVolume > 0.5 ? 900 + parcel.totalVolume * 350 : 0;
  return {
    carrier: "dl",
    label: "Деловые Линии · межтерминальная",
    price: Math.round((780 + w * 15 + crate) * z.k),
    days: z.days + 1,
    toDoor: false,
    source: "model",
  };
}

/* ------------------------------- СДЭК API -------------------------------- */

let cdekToken: { value: string; expires: number } | null = null;

async function cdekAuth(id: string, secret: string) {
  if (cdekToken && cdekToken.expires > Date.now() + 60_000) return cdekToken.value;
  const res = await fetch("https://api.cdek.ru/v2/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: id,
      client_secret: secret,
    }),
  });
  if (!res.ok) throw new Error("cdek auth failed");
  const json = (await res.json()) as { access_token: string; expires_in: number };
  // Токен живёт час — кэшируем в памяти воркера, а не дёргаем на каждый клик.
  cdekToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

async function cdekQuote(dest: Destination, parcel: Parcel): Promise<ShippingQuote> {
  const cfg = await secretValues(["CDEK_ACCOUNT", "CDEK_SECURE_PASSWORD"] as const);
  const id = cfg.CDEK_ACCOUNT;
  const secret = cfg.CDEK_SECURE_PASSWORD;
  if (!id || !secret) return cdekModel(dest, parcel);

  const token = await cdekAuth(id, secret);
  const res = await fetch("https://api.cdek.ru/v2/calculator/tarifflist", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      type: 1,
      currency: 1,
      from_location: { code: ORIGIN.cdekCityCode, city: ORIGIN.city },
      to_location: dest.fiasId ? { fias_guid: dest.fiasId, city: dest.city } : { city: dest.city },
      packages: [
        {
          weight: Math.max(1, Math.round(parcel.totalWeight * 1000)),
          // приводим объём партии к габаритам условного короба, см
          length: Math.max(10, Math.round(Math.cbrt(parcel.totalVolume) * 100)),
          width: Math.max(10, Math.round(Math.cbrt(parcel.totalVolume) * 100)),
          height: Math.max(10, Math.round(Math.cbrt(parcel.totalVolume) * 100)),
        },
      ],
    }),
  });
  if (!res.ok) throw new Error("cdek calc failed");
  const json = (await res.json()) as {
    tariff_codes?: Array<{ tariff_code: number; tariff_name: string; delivery_sum: number; period_max: number }>;
  };
  const list = json.tariff_codes ?? [];
  // Магистральный экспресс склад-дверь (код 234) либо «Посылка», иначе — самый дешёвый.
  const pick =
    list.find((t) => t.tariff_code === 234) ??
    list.find((t) => /посылка/i.test(t.tariff_name)) ??
    [...list].sort((a, b) => a.delivery_sum - b.delivery_sum)[0];
  if (!pick) throw new Error("cdek: no tariffs");
  return {
    carrier: "cdek",
    label: `СДЭК · ${pick.tariff_name}`,
    price: Math.round(pick.delivery_sum),
    days: pick.period_max,
    toDoor: true,
    source: "api",
  };
}

/* --------------------------- Деловые Линии API --------------------------- */

async function dlQuote(dest: Destination, parcel: Parcel): Promise<ShippingQuote> {
  const key = (await secretValues(["DL_API_KEY"] as const)).DL_API_KEY;
  if (!key) return dlModel(dest, parcel);

  const res = await fetch("https://api.dellin.ru/v3/calculator.json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      appkey: key,
      delivery: {
        deliveryType: { type: "auto" },
        derival: { produceDate: new Date().toISOString().slice(0, 10), variant: "terminal", city: ORIGIN.city },
        arrival: { variant: "terminal", city: dest.city },
      },
      cargo: {
        totalVolume: parcel.totalVolume,
        totalWeight: parcel.totalWeight,
        freightName: "Пластиковые комплектующие",
        hazardClass: 0,
      },
    }),
  });
  if (!res.ok) throw new Error("dl calc failed");
  const json = (await res.json()) as {
    data?: { price?: number; orderDates?: { arrivalToOspReceiver?: string } };
  };
  const price = json.data?.price;
  if (!price) throw new Error("dl: no price");
  const arrival = json.data?.orderDates?.arrivalToOspReceiver;
  const days = arrival
    ? Math.max(1, Math.round((Date.parse(arrival) - Date.now()) / 86_400_000))
    : dlModel(dest, parcel).days;
  return {
    carrier: "dl",
    label: "Деловые Линии · межтерминальная",
    price: Math.round(price),
    days,
    toDoor: false,
    source: "api",
  };
}

/* -------------------------------- Агрегатор ------------------------------ */

/** Наценка производства сверх тарифа ТК (упаковка, обрешётка) из панели управления. */
async function markup(): Promise<{ fixed: number; percent: number }> {
  try {
    const { db: store } = await import("@/lib/db.server");
    const { data } = await store
      .from("app_settings")
      .select("value")
      .eq("key", "logistics_markup")
      .maybeSingle();
    const v = (data as { value?: { fixed_rub?: number; percent?: number } } | null)?.value;
    return { fixed: Number(v?.fixed_rub ?? 0) || 0, percent: Number(v?.percent ?? 0) || 0 };
  } catch {
    return { fixed: 0, percent: 0 };
  }
}

export async function calcShipping(dest: Destination, parcel: Parcel) {
  const [results, extra] = await Promise.all([
    Promise.allSettled([
      withTimeout(cdekQuote(dest, parcel)).catch(() => cdekModel(dest, parcel)),
      withTimeout(dlQuote(dest, parcel)).catch(() => dlModel(dest, parcel)),
    ]),
    markup(),
  ]);
  const quotes: ShippingQuote[] = [];
  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    const q = r.value;
    quotes.push({
      ...q,
      price: Math.round(q.price * (1 + extra.percent / 100) + extra.fixed),
    });
  }
  return quotes;
}
