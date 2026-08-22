/**
 * Публичный контур авторизации: регистрация, вход, подтверждение почты
 * и сброс пароля. Всё считается на нашем сервере, письма уходят Nodemailer'ом.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuth } from "@/lib/auth-middleware";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Укажите корректную почту").max(160),
  password: z.string().min(8, "Пароль от 8 символов").max(200),
});

export const signUp = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    credentials
      .extend({
        fullName: z.string().trim().max(120).optional(),
        phone: z.string().trim().max(32).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { createUser, issueToken, createActionToken, ensureOwnerRole } = await import(
      "@/lib/auth.server"
    );
    const user = await createUser({
      email: data.email,
      password: data.password,
      fullName: data.fullName ?? null,
      phone: data.phone ?? null,
    });
    await ensureOwnerRole(user);

    // Письмо-подтверждение: доступ к оформлению заказов открывается после клика.
    try {
      const { sendMail, siteUrl, registrationEmail } = await import("@/lib/mailer.server");
      const token = await createActionToken(user.id, "verify");
      const link = `${siteUrl()}/auth?verify=${token}`;
      const tpl = registrationEmail();
      await sendMail({
        to: user.email,
        subject: tpl.subject,
        html: tpl.html.replace(`${siteUrl()}/auth`, link),
      });
    } catch (e) {
      console.error("[auth] письмо о регистрации не отправлено", e);
    }

    const { token, expiresAt } = issueToken(user);
    return { token, expiresAt, user };
  });

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => credentials.parse(input))
  .handler(async ({ data }) => {
    const { authenticate, issueToken, ensureOwnerRole } = await import("@/lib/auth.server");
    const user = await authenticate(data.email, data.password);
    await ensureOwnerRole(user);
    const { token, expiresAt } = issueToken(user);
    return { token, expiresAt, user };
  });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ email: z.string().trim().toLowerCase().email().max(160) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { findUserByEmail, createActionToken } = await import("@/lib/auth.server");
    const row = await findUserByEmail(data.email);
    // Ответ одинаковый в любом случае — почтовую базу перебором не собрать.
    if (row) {
      try {
        const { sendMail, siteUrl, recoveryEmail } = await import("@/lib/mailer.server");
        const token = await createActionToken(String(row["id"]), "recovery");
        const tpl = recoveryEmail(`${siteUrl()}/reset-password?token=${token}`);
        await sendMail({ to: data.email, subject: tpl.subject, html: tpl.html });
      } catch (e) {
        console.error("[auth] письмо восстановления не отправлено", e);
        throw new Error("Почтовый сервер недоступен. Сообщите менеджеру ALMAFORT.");
      }
    }
    return { ok: true };
  });

export const resetPassword = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({ token: z.string().min(10).max(400), password: z.string().min(8).max(200) })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { consumeActionToken, setPassword, markEmailVerified, findUserById, issueToken } =
      await import("@/lib/auth.server");
    const userId = await consumeActionToken(data.token, "recovery");
    if (!userId) throw new Error("Ссылка недействительна или уже использована");
    await setPassword(userId, data.password);
    await markEmailVerified(userId);
    const user = await findUserById(userId);
    if (!user) throw new Error("Пользователь не найден");
    const { token, expiresAt } = issueToken(user);
    return { token, expiresAt, user };
  });

export const verifyEmail = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ token: z.string().min(10).max(400) }).parse(input))
  .handler(async ({ data }) => {
    const { consumeActionToken, markEmailVerified, findUserById, issueToken } = await import(
      "@/lib/auth.server"
    );
    const userId = await consumeActionToken(data.token, "verify");
    if (!userId) throw new Error("Ссылка подтверждения недействительна");
    await markEmailVerified(userId);
    const user = await findUserById(userId);
    if (!user) throw new Error("Пользователь не найден");
    const { token, expiresAt } = issueToken(user);
    return { token, expiresAt, user };
  });

export const resendVerification = createServerFn({ method: "POST" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { createActionToken } = await import("@/lib/auth.server");
    const { sendMail, siteUrl, magicLinkEmail } = await import("@/lib/mailer.server");
    const token = await createActionToken(context.userId, "verify");
    const tpl = magicLinkEmail(`${siteUrl()}/auth?verify=${token}`);
    await sendMail({ to: context.email, subject: tpl.subject, html: tpl.html });
    return { ok: true };
  });

export const getMe = createServerFn({ method: "GET" })
  .middleware([requireAuth])
  .handler(async ({ context }) => {
    const { findUserById, rolesOfUser } = await import("@/lib/auth.server");
    const user = await findUserById(context.userId);
    if (!user) throw new Error("Unauthorized: пользователь удалён");
    return { user, roles: await rolesOfUser(user.id) };
  });
