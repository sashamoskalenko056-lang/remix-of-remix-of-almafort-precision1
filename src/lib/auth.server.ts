/**
 * Собственная авторизация ALMAFORT: пользователи, пароли и токены живут
 * в локальном хранилище на VPS. Внешние сервисы аутентификации не нужны.
 *
 * Пароль хранится как scrypt-хеш с индивидуальной солью, сессия — компактный
 * подписанный HMAC-SHA256 токен (формат JWT, алгоритм HS256).
 */
import {
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { db, type Row } from "@/lib/db.server";

export type AuthUser = {
  id: string;
  email: string;
  full_name: string | null;
  email_verified: boolean;
  created_at: string;
};

export type AuthClaims = {
  sub: string;
  email: string;
  email_verified: boolean;
  exp: number;
};

const SESSION_TTL_SEC = 60 * 60 * 24 * 30; // 30 дней

function secret(): string {
  const value =
    process.env["AUTH_SECRET"] ??
    process.env["ADMIN_VAULT_KEY"] ??
    process.env["SESSION_SECRET"];
  if (!value) {
    throw new Error(
      "AUTH_SECRET не задан. Добавьте AUTH_SECRET в .env перед запуском (см. .env.example).",
    );
  }
  return value;
}

/* ── пароли ────────────────────────────────────────────────────────── */

export function hashPassword(plain: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = scryptSync(plain, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

/* ── токены сессии ─────────────────────────────────────────────────── */

const b64 = (input: Buffer | string) =>
  Buffer.from(input).toString("base64url");

function sign(data: string) {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

export function issueToken(user: AuthUser): { token: string; expiresAt: number } {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      email_verified: user.email_verified,
      exp,
    } satisfies AuthClaims),
  );
  const body = `${header}.${payload}`;
  return { token: `${body}.${sign(body)}`, expiresAt: exp };
}

export function verifyToken(token: string): AuthClaims | null {
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return null;
  const expected = sign(`${header}.${payload}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AuthClaims;
    if (!claims.sub || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/* ── пользователи ──────────────────────────────────────────────────── */

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function toUser(row: Row): AuthUser {
  return {
    id: String(row["id"]),
    email: String(row["email"]),
    full_name: (row["full_name"] as string | null) ?? null,
    email_verified: Boolean(row["email_verified"]),
    created_at: String(row["created_at"] ?? new Date().toISOString()),
  };
}

export async function findUserByEmail(email: string): Promise<Row | null> {
  const { data } = await db.from("users").select("*").eq("email", normalizeEmail(email)).maybeSingle();
  return data;
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const { data } = await db.from("users").select("*").eq("id", id).maybeSingle();
  return data ? toUser(data) : null;
}

export async function createUser(params: {
  email: string;
  password: string;
  fullName?: string | null;
  phone?: string | null;
  emailVerified?: boolean;
}): Promise<AuthUser> {
  const email = normalizeEmail(params.email);
  if (await findUserByEmail(email)) {
    throw new Error("Пользователь с такой почтой уже зарегистрирован");
  }
  const id = randomUUID();
  await db.from("users").insert({
    id,
    email,
    password_hash: hashPassword(params.password),
    full_name: params.fullName ?? null,
    email_verified: params.emailVerified ?? false,
  });
  await db.from("profiles").insert({
    id,
    full_name: params.fullName ?? null,
    phone: params.phone ?? null,
  });
  const user = await findUserById(id);
  if (!user) throw new Error("Не удалось создать пользователя");
  return user;
}

export async function authenticate(email: string, password: string): Promise<AuthUser> {
  const row = await findUserByEmail(email);
  if (!row || !verifyPassword(password, String(row["password_hash"] ?? ""))) {
    throw new Error("Неверная почта или пароль");
  }
  return toUser(row);
}

export async function setPassword(userId: string, password: string) {
  await db.from("users").update({ password_hash: hashPassword(password) }).eq("id", userId);
}

export async function markEmailVerified(userId: string) {
  await db.from("users").update({ email_verified: true }).eq("id", userId);
}

/* ── одноразовые ссылки (подтверждение почты и сброс пароля) ───────── */

export type LinkKind = "recovery" | "verify" | "magiclink";

export async function createActionToken(userId: string, kind: LinkKind): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.from("password_resets").insert({
    id: randomUUID(),
    user_id: userId,
    kind,
    token,
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    used: false,
  });
  return token;
}

export async function consumeActionToken(
  token: string,
  kind: LinkKind,
): Promise<string | null> {
  const { data } = await db.from("password_resets").select("*").eq("token", token).maybeSingle();
  if (!data || data["kind"] !== kind || data["used"]) return null;
  if (String(data["expires_at"]) < new Date().toISOString()) return null;
  await db.from("password_resets").update({ used: true }).eq("id", data["id"]);
  return String(data["user_id"]);
}

/* ── роли ──────────────────────────────────────────────────────────── */

export async function rolesOfUser(userId: string): Promise<string[]> {
  const { data } = await db.from("user_roles").select("role").eq("user_id", userId);
  return data.map((r) => String(r["role"]));
}

/**
 * Первичный владелец: почта из ADMIN_OWNER_EMAIL (или OWNER_EMAIL) получает
 * роль owner при первом входе — админка доступна сразу после деплоя.
 */
export async function ensureOwnerRole(user: AuthUser) {
  const owner = (
    process.env["ADMIN_OWNER_EMAIL"] ??
    process.env["OWNER_EMAIL"] ??
    ""
  )
    .trim()
    .toLowerCase();
  if (!owner || owner !== user.email) return;
  const roles = await rolesOfUser(user.id);
  if (roles.includes("owner")) return;
  await db.from("user_roles").insert({ user_id: user.id, role: "owner" });
}
