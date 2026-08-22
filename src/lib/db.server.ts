/**
 * Локальное хранилище ALMAFORT. Никаких внешних облачных баз:
 * данные лежат в JSON-файле на диске VPS (DATA_DIR, по умолчанию ./data).
 *
 * Экспортируется минимальный query-builder с API, повторяющим тот,
 * что использовался в проекте ранее, чтобы вся бизнес-логика осталась
 * читаемой: db.from("orders").select("*").eq("user_id", id).order(...)
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = any;
type Store = Record<string, Row[]>;

const TABLES = [
  "users",
  "profiles",
  "companies",
  "orders",
  "order_events",
  "order_documents",
  "saved_carts",
  "app_settings",
  "admin_logs",
  "llm_logs",
  "llm_prompts",
  "leads",
  "asset_groups",
  "product_asset_links",
  "product_overrides",
  "user_roles",
  "password_resets",
  "otp_codes",
  "crm_queue",
] as const;

function dbPath() {
  const dir = process.env["DATA_DIR"] ?? join(process.cwd(), "data");
  return join(dir, "almafort-db.json");
}

let cache: Store | undefined;
let writeChain: Promise<unknown> = Promise.resolve();

function emptyStore(): Store {
  return Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Store;
}

async function load(): Promise<Store> {
  if (cache) return cache;
  try {
    const raw = await readFile(dbPath(), "utf8");
    const parsed = JSON.parse(raw) as Store;
    cache = { ...emptyStore(), ...parsed };
  } catch {
    cache = emptyStore();
  }
  return cache;
}

async function persist() {
  const data = cache ?? emptyStore();
  const target = dbPath();
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, target);
}

/** Записи сериализуются, чтобы параллельные запросы не затирали файл. */
function queueWrite() {
  writeChain = writeChain.then(persist, persist);
  return writeChain;
}

export type DbResult<T> = { data: T; error: { message: string } | null; count?: number };

type Filter = (row: Row) => boolean;

class Query implements PromiseLike<DbResult<Row[]>> {
  private filters: Filter[] = [];
  private sort?: { column: string; asc: boolean };
  private limitN?: number;
  private rangeWindow?: [number, number];
  private mode: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row[] = [];
  private conflict?: string[];
  private wantCount = false;

  constructor(private table: string) {}

  /* ── терминальные операции ─────────────────────────────────────── */
  select(_columns?: string, opts?: { count?: "exact" }) {
    if (this.mode === "select") this.mode = "select";
    if (opts?.count === "exact") this.wantCount = true;
    return this;
  }

  insert(values: Row | Row[]) {
    this.mode = "insert";
    this.payload = Array.isArray(values) ? values : [values];
    return this;
  }

  update(values: Row) {
    this.mode = "update";
    this.payload = [values];
    return this;
  }

  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.mode = "upsert";
    this.payload = Array.isArray(values) ? values : [values];
    this.conflict = opts?.onConflict?.split(",").map((c) => c.trim()) ?? ["id"];
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  /* ── фильтры ───────────────────────────────────────────────────── */
  eq(column: string, value: unknown) {
    this.filters.push((r) => r[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filters.push((r) => r[column] !== value);
    return this;
  }
  is(column: string, value: unknown) {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[column]));
    return this;
  }
  gte(column: string, value: string | number) {
    this.filters.push((r) => String(r[column] ?? "") >= String(value));
    return this;
  }
  lte(column: string, value: string | number) {
    this.filters.push((r) => String(r[column] ?? "") <= String(value));
    return this;
  }
  ilike(column: string, pattern: string) {
    const needle = pattern.replace(/%/g, "").toLowerCase();
    this.filters.push((r) => String(r[column] ?? "").toLowerCase().includes(needle));
    return this;
  }
  /** Поддерживает формат "col.ilike.%x%,col2.ilike.%x%". */
  or(expression: string) {
    const parts = expression.split(",").map((p) => p.split("."));
    this.filters.push((r) =>
      parts.some(([col, op, ...rest]) => {
        const needle = rest.join(".").replace(/%/g, "").toLowerCase();
        const value = String(r[col ?? ""] ?? "").toLowerCase();
        return op === "ilike" || op === "like" ? value.includes(needle) : value === needle;
      }),
    );
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }) {
    this.sort = { column, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  range(from: number, to: number) {
    this.rangeWindow = [from, to];
    return this;
  }

  async maybeSingle(): Promise<DbResult<Row | null>> {
    const res = await this.run();
    return { data: res.data[0] ?? null, error: res.error };
  }

  async single(): Promise<DbResult<Row>> {
    const res = await this.run();
    if (!res.data[0]) return { data: null as never, error: { message: "Запись не найдена" } };
    return { data: res.data[0], error: res.error };
  }

  then<R1 = DbResult<Row[]>, R2 = never>(
    onfulfilled?: ((value: DbResult<Row[]>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.run().then(onfulfilled, onrejected);
  }

  private matches(row: Row) {
    return this.filters.every((f) => f(row));
  }

  private async run(): Promise<DbResult<Row[]>> {
    try {
      const store = await load();
      const rows = (store[this.table] ??= []);
      const now = new Date().toISOString();

      if (this.mode === "insert" || this.mode === "upsert") {
        const written: Row[] = [];
        for (const value of this.payload) {
          const existingIndex =
            this.mode === "upsert"
              ? rows.findIndex((r) => (this.conflict ?? []).every((c) => r[c] === value[c]))
              : -1;
          if (existingIndex >= 0) {
            const merged = { ...rows[existingIndex], ...value, updated_at: now };
            rows[existingIndex] = merged;
            written.push(merged);
          } else {
            const created = {
              id: value["id"] ?? randomUUID(),
              created_at: value["created_at"] ?? now,
              updated_at: now,
              ...value,
            };
            rows.push(created);
            written.push(created);
          }
        }
        await queueWrite();
        return { data: written, error: null };
      }

      if (this.mode === "update") {
        const patch = this.payload[0] ?? {};
        const written: Row[] = [];
        rows.forEach((row, i) => {
          if (!this.matches(row)) return;
          rows[i] = { ...row, ...patch, updated_at: now };
          written.push(rows[i]!);
        });
        await queueWrite();
        return { data: written, error: null };
      }

      if (this.mode === "delete") {
        const kept = rows.filter((r) => !this.matches(r));
        const removed = rows.length - kept.length;
        store[this.table] = kept;
        await queueWrite();
        return { data: [], error: null, count: removed };
      }

      let result = rows.filter((r) => this.matches(r));
      const total = result.length;
      if (this.sort) {
        const { column, asc } = this.sort;
        result = [...result].sort((a, b) => {
          const av = a[column] ?? "";
          const bv = b[column] ?? "";
          const cmp = av === bv ? 0 : av > bv ? 1 : -1;
          return asc ? cmp : -cmp;
        });
      }
      if (this.rangeWindow) result = result.slice(this.rangeWindow[0], this.rangeWindow[1] + 1);
      if (this.limitN != null) result = result.slice(0, this.limitN);
      return { data: result.map((r) => ({ ...r })), error: null, count: this.wantCount ? total : total };
    } catch (e) {
      return { data: [], error: { message: e instanceof Error ? e.message : String(e) } };
    }
  }
}

export const db = {
  from(table: string) {
    return new Query(table);
  },
  /** Прямой доступ для сложных выборок. */
  async all(table: string): Promise<Row[]> {
    const store = await load();
    return [...(store[table] ?? [])];
  },
  async replace(table: string, rows: Row[]) {
    const store = await load();
    store[table] = rows;
    await queueWrite();
  },
  newId: () => randomUUID(),
};

/* ── Лояльность считается кодом, а не SQL-функцией ─────────────────── */

export type Loyalty = { total_spent: number; tier: 1 | 2 | 3; next_threshold: number | null };

const TIER_2 = 300_000;
const TIER_3 = 1_500_000;

export async function loyaltyOf(userId: string): Promise<Loyalty> {
  const orders = (await db.all("orders")).filter(
    (o) => o["user_id"] === userId && o["status"] !== "cancelled",
  );
  const total = orders.reduce((s, o) => s + Number(o["total"] ?? 0), 0);
  const tier: 1 | 2 | 3 = total >= TIER_3 ? 3 : total >= TIER_2 ? 2 : 1;
  const next = tier === 1 ? TIER_2 : tier === 2 ? TIER_3 : null;
  return { total_spent: total, tier, next_threshold: next };
}
