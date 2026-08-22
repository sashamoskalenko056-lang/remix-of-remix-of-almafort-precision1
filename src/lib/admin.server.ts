/**
 * Серверные помощники админки: RBAC, журнал действий и AES-256 хранилище ключей.
 * Файл *.server.ts никогда не попадает в клиентский бандл.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { AdminRole } from "@/lib/admin";

type AnyClient = SupabaseClient<any, any, any>;

export async function rolesOf(supabase: AnyClient, userId: string): Promise<AdminRole[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return ((data ?? []) as Array<{ role: AdminRole }>).map((r) => r.role);
}

/** Единственная точка авторизации админки. Ошибка = 403 на бэкенде, не на фронте. */
export async function requireRole(
  supabase: AnyClient,
  userId: string,
  allowed: AdminRole[],
): Promise<AdminRole[]> {
  const roles = await rolesOf(supabase, userId);
  if (!roles.some((r) => allowed.includes(r))) {
    throw new Error("403 Forbidden: недостаточно прав");
  }
  return roles;
}

/** Audit Trail: пишем сервис-ролью, чтобы запись нельзя было подделать или удалить. */
export async function logAdmin(
  userId: string,
  email: string | null,
  action: string,
  target: string | null,
  oldValue: unknown,
  newValue: unknown,
) {
  const { db: store } = await import("@/lib/db.server");
  await store.from("admin_logs").insert({
    admin_id: userId,
    admin_email: email,
    action,
    target,
    old_value: (oldValue ?? null) as never,
    new_value: (newValue ?? null) as never,
  });
}

/* ── AES-256-GCM хранилище API-ключей ─────────────────────────────── */

const keyMaterial = () => {
  const raw = process.env["ADMIN_VAULT_KEY"];
  if (!raw) throw new Error("Хранилище ключей не сконфигурировано");
  return createHash("sha256").update(raw).digest();
};

export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

export function decryptSecret(payload: string) {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) throw new Error("Повреждённое значение ключа");
  const decipher = createDecipheriv("aes-256-gcm", keyMaterial(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString(
    "utf8",
  );
}

export const maskSecret = (plain: string) =>
  plain.length <= 6 ? "••••" : `${plain.slice(0, 3)}••••${plain.slice(-3)}`;
