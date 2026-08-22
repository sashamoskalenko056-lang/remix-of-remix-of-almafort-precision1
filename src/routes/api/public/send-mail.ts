import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit.server";
import {
  inviteEmail,
  magicLinkEmail,
  noticeEmail,
  orderNotificationEmail,
  registrationEmail,
  recoveryEmail,
  sendMail,
  siteUrl,
} from "@/lib/mailer.server";
import { ensureServerWebSocket } from "@/lib/ws-polyfill.server";

/**
 * Кастомный SMTP-шлюз ALMAFORT (аналог PHP-мейлера).
 * POST JSON -> nodemailer -> корпоративный SMTP. Почта Supabase не используется.
 *
 * Публичный тип только один — `recovery` (сброс пароля): тело письма формирует
 * сервер, произвольный текст снаружи прислать нельзя => это не open relay.
 * Служебные типы (invite / order / notice) требуют заголовок
 * `x-almafort-mail-token` со значением MAIL_API_TOKEN.
 */

const RecoverySchema = z.object({
  type: z.literal("recovery"),
  email: z.string().email().max(200),
});

const MagicLinkSchema = z.object({
  type: z.literal("magiclink"),
  email: z.string().email().max(200),
});

const RegistrationSchema = z.object({
  type: z.literal("registration"),
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2).max(120),
});

const InviteSchema = z.object({
  type: z.literal("invite"),
  email: z.string().email().max(200),
  company: z.string().max(200).optional(),
});

const OrderSchema = z.object({
  type: z.literal("order"),
  email: z.string().email().max(200),
  orderNumber: z.string().min(1).max(64),
  total: z.string().max(64).optional(),
  customer: z.string().max(200).optional(),
  url: z.string().url().max(500).optional(),
});

const NoticeSchema = z.object({
  type: z.literal("notice"),
  email: z.string().email().max(200),
  subject: z.string().min(1).max(150),
  message: z.string().min(1).max(4000),
});

const BodySchema = z.discriminatedUnion("type", [
  RecoverySchema,
  MagicLinkSchema,
  RegistrationSchema,
  InviteSchema,
  OrderSchema,
  NoticeSchema,
]);

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  const allowed = new Set([siteUrl(), "https://www.almafort.ru"]);
  return {
    "Access-Control-Allow-Origin": origin && allowed.has(origin) ? origin : siteUrl(),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-almafort-mail-token",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: corsHeaders(request) });
}

export const Route = createFileRoute("/api/public/send-mail")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => new Response(null, { status: 204, headers: corsHeaders(request) }),

      POST: async ({ request }) => {
        const limited = rateLimit(request, "send-mail", { limit: 8, windowMs: 60_000 });
        if (limited) return limited;

        let raw: unknown;
        try {
          raw = await request.json();
        } catch {
          return json(request, { error: "Некорректный JSON" }, 400);
        }

        const parsed = BodySchema.safeParse(raw);
        if (!parsed.success) return json(request, { error: "Некорректные данные" }, 400);
        const body = parsed.data;

        if (body.type !== "recovery" && body.type !== "magiclink" && body.type !== "registration") {
          const token = process.env["MAIL_API_TOKEN"];
          if (!token || request.headers.get("x-almafort-mail-token") !== token) {
            return json(request, { error: "Доступ запрещён" }, 401);
          }
        }

        try {
          if (body.type === "registration") {
            await ensureServerWebSocket();
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { error } = await supabaseAdmin.auth.admin.createUser({
              email: body.email,
              password: body.password,
              email_confirm: true,
              user_metadata: { full_name: body.name },
            });
            if (error) {
              const duplicate = /already|registered|exists/i.test(error.message);
              return json(
                request,
                { error: duplicate ? "Аккаунт с этой почтой уже существует" : "Не удалось создать аккаунт" },
                duplicate ? 409 : 500,
              );
            }
            await sendMail({ to: body.email, ...registrationEmail() });
            return json(request, { ok: true });
          }

          if (body.type === "recovery" || body.type === "magiclink") {
            await ensureServerWebSocket();
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data, error } = await supabaseAdmin.auth.admin.generateLink({
              type: body.type === "recovery" ? "recovery" : "magiclink",
              email: body.email,
              options: {
                redirectTo:
                  body.type === "recovery" ? `${siteUrl()}/reset-password` : `${siteUrl()}/auth`,
              },
            });
            // Не раскрываем, зарегистрирован ли адрес.
            if (error) console.error("[send-mail] generateLink:", error.message);
            const hashed = data?.properties?.hashed_token;
            if (error || !hashed) return json(request, { ok: true });
            // Ссылка строится только от PUBLIC_SITE_URL: ни одного стороннего домена в письме.
            const link =
              body.type === "recovery"
                ? `${siteUrl()}/reset-password?token_hash=${encodeURIComponent(hashed)}&type=recovery`
                : `${siteUrl()}/auth?token_hash=${encodeURIComponent(hashed)}&type=magiclink`;
            const mail = body.type === "recovery" ? recoveryEmail(link) : magicLinkEmail(link);
            await sendMail({ to: body.email, ...mail });
            return json(request, { ok: true });
          }

          const mail =
            body.type === "invite"
              ? inviteEmail(`${siteUrl()}/auth`, body.company)
              : body.type === "order"
                ? orderNotificationEmail({
                    orderNumber: body.orderNumber,
                    ...(body.total ? { total: body.total } : {}),
                    ...(body.customer ? { customer: body.customer } : {}),
                    ...(body.url ? { url: body.url } : {}),
                  })
                : noticeEmail(body.subject, body.message);

          await sendMail({ to: body.email, ...mail });
          return json(request, { ok: true });
        } catch (e) {
          const err = e as NodeJS.ErrnoException & { command?: string; response?: string };
          console.error(
            "[send-mail] сбой отправки:",
            JSON.stringify({
              type: body.type,
              code: err?.code ?? null,
              command: err?.command ?? null,
              response: err?.response ?? null,
              message: err?.message ?? String(e),
            }),
          );
          return json(request, { error: "Не удалось отправить письмо" }, 500);
        }
      },
    },
  },
});
