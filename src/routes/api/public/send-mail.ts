import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit.server";
import {
  inviteEmail,
  noticeEmail,
  orderNotificationEmail,
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

        if (body.type !== "recovery") {
          const token = process.env["MAIL_API_TOKEN"];
          if (!token || request.headers.get("x-almafort-mail-token") !== token) {
            return json(request, { error: "Доступ запрещён" }, 401);
          }
        }

        try {
          if (body.type === "recovery") {
            await ensureServerWebSocket();
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            const { data, error } = await supabaseAdmin.auth.admin.generateLink({
              type: "recovery",
              email: body.email,
              options: { redirectTo: `${siteUrl()}/reset-password` },
            });
            // Не раскрываем, зарегистрирован ли адрес.
            if (error || !data?.properties?.action_link) return json(request, { ok: true });
            const link = forceOurHost(data.properties.action_link);
            const mail = recoveryEmail(link);
            await sendMail({ to: body.email, ...mail });
            return json(request, { ok: true });
          }

          const mail =
            body.type === "invite"
              ? inviteEmail(`${siteUrl()}/auth`, body.company)
              : body.type === "order"
                ? orderNotificationEmail(body)
                : noticeEmail(body.subject, body.message);

          await sendMail({ to: body.email, ...mail });
          return json(request, { ok: true });
        } catch (e) {
          console.error("[send-mail]", e);
          return json(request, { error: "Не удалось отправить письмо" }, 500);
        }
      },
    },
  },
});

/** Ссылка обязана вести на боевой хост, а не на служебный домен Supabase-редиректа. */
function forceOurHost(actionLink: string): string {
  try {
    const url = new URL(actionLink);
    const redirect = url.searchParams.get("redirect_to");
    if (redirect) url.searchParams.set("redirect_to", `${siteUrl()}/reset-password`);
    return url.toString();
  } catch {
    return actionLink;
  }
}
