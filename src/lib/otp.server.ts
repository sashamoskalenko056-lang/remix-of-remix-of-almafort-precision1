/**
 * Одноразовые коды входа (OTP) ALMAFORT.
 *
 * Правила блока «Безопасность»:
 *  • 4 цифры, генерация через crypto.randomInt (CSPRNG);
 *  • в базе хранится ТОЛЬКО scrypt-хеш кода с индивидуальной солью;
 *  • TTL ровно 5 минут, после чего запись уничтожается;
 *  • не более 3 попыток ввода — затем код аннулируется;
 *  • не чаще 1 запроса в 60 секунд на один email и на один IP.
 *
 * Хранилище — локальный JSON (DATA_DIR). Никаких внешних сервисов.
 */
import { randomBytes, randomInt, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { db, type Row } from "@/lib/db.server";
import {
  createUser,
  ensureOwnerRole,
  findUserById,
  findUserByEmail,
  issueToken,
  markEmailVerified,
  type AuthUser,
} from "@/lib/auth.server";

export const OTP_TTL_SEC = 5 * 60;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_RESEND_SEC = 60;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

function hashCode(code: string, salt: string) {
  return scryptSync(code, salt, 64).toString("hex");
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

async function activeRow(email: string): Promise<Row | null> {
  const { data } = await db.from("otp_codes").select("*").eq("email", email).order("created_at");
  const rows = (data ?? []).filter((r) => String(r["expires_at"]) > new Date().toISOString());
  return rows[rows.length - 1] ?? null;
}

/** Сколько секунд осталось ждать до повторной отправки (0 — можно отправлять). */
export async function resendCooldown(email: string, ip: string): Promise<number> {
  const all = await db.all("otp_codes");
  const now = Date.now();
  const recent = all.filter((r) => {
    const at = Date.parse(String(r["created_at"] ?? 0));
    if (!Number.isFinite(at) || now - at > OTP_RESEND_SEC * 1000) return false;
    return r["email"] === email || (ip && r["ip"] === ip);
  });
  if (!recent.length) return 0;
  const newest = Math.max(...recent.map((r) => Date.parse(String(r["created_at"]))));
  return Math.max(1, Math.ceil((OTP_RESEND_SEC * 1000 - (now - newest)) / 1000));
}

/** Чистка мусора: истёкшие коды не должны накапливаться в JSON-базе. */
async function purgeExpired() {
  const all = await db.all("otp_codes");
  const now = new Date().toISOString();
  const alive = all.filter((r) => String(r["expires_at"]) > now);
  if (alive.length !== all.length) await db.replace("otp_codes", alive);
}

export type RequestResult =
  | { ok: true; ttl: number }
  | { ok: false; retryAfter: number };

/** Генерирует код, сохраняет хеш и отправляет письмо. */
export async function requestOtp(emailRaw: string, ip: string): Promise<RequestResult> {
  const email = normalizeEmail(emailRaw);
  await purgeExpired();

  const wait = await resendCooldown(email, ip);
  if (wait > 0) return { ok: false, retryAfter: wait };

  // Старые коды этой почты аннулируем — активным остаётся только последний.
  const all = await db.all("otp_codes");
  await db.replace(
    "otp_codes",
    all.filter((r) => r["email"] !== email),
  );

  const code = String(randomInt(0, 10_000)).padStart(4, "0");
  const salt = randomBytes(16).toString("hex");

  await db.from("otp_codes").insert({
    id: randomUUID(),
    email,
    ip: ip || null,
    salt,
    code_hash: hashCode(code, salt),
    attempts: 0,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + OTP_TTL_SEC * 1000).toISOString(),
  });

  const { sendMail, otpEmail } = await import("@/lib/mailer.server");
  const tpl = otpEmail(code);
  await sendMail({ to: email, subject: tpl.subject, html: tpl.html });

  return { ok: true, ttl: OTP_TTL_SEC };
}

export type VerifyResult =
  | { status: "ok"; token: string; expiresAt: number; user: AuthUser; isNew: boolean }
  | { status: "expired" }
  | { status: "locked" }
  | { status: "wrong"; attemptsLeft: number };

/** Проверяет код и при успехе выдаёт сессионный токен. */
export async function verifyOtp(emailRaw: string, code: string): Promise<VerifyResult> {
  const email = normalizeEmail(emailRaw);
  const row = await activeRow(email);
  if (!row) return { status: "expired" };

  const attempts = Number(row["attempts"] ?? 0);
  if (attempts >= OTP_MAX_ATTEMPTS) {
    await db.from("otp_codes").delete().eq("id", row["id"]);
    return { status: "locked" };
  }

  if (!sameHash(hashCode(code, String(row["salt"])), String(row["code_hash"]))) {
    const next = attempts + 1;
    if (next >= OTP_MAX_ATTEMPTS) {
      await db.from("otp_codes").delete().eq("id", row["id"]);
      return { status: "locked" };
    }
    await db.from("otp_codes").update({ attempts: next }).eq("id", row["id"]);
    return { status: "wrong", attemptsLeft: OTP_MAX_ATTEMPTS - next };
  }

  // Код верный — уничтожаем его сразу, повторное использование невозможно.
  await db.from("otp_codes").delete().eq("id", row["id"]);

  const existing = await findUserByEmail(email);
  let user: AuthUser | null = null;
  let isNew = false;

  if (existing) {
    user = await findUserById(String(existing["id"]));
  } else {
    // Единый флоу: первый вход по коду создаёт B2B-профиль снабженца.
    user = await createUser({
      email,
      password: randomBytes(24).toString("base64url"),
      emailVerified: true,
    });
    isNew = true;
  }
  if (!user) return { status: "expired" };

  if (!user.email_verified) {
    await markEmailVerified(user.id);
    user = { ...user, email_verified: true };
  }
  await ensureOwnerRole(user);

  if (isNew) {
    try {
      const { sendMail, welcomeEmail } = await import("@/lib/mailer.server");
      const tpl = welcomeEmail();
      await sendMail({ to: email, subject: tpl.subject, html: tpl.html });
    } catch (e) {
      console.error("[otp] приветственное письмо не отправлено", e);
    }
  }

  const { token, expiresAt } = issueToken(user);
  return { status: "ok", token, expiresAt, user, isNew };
}
