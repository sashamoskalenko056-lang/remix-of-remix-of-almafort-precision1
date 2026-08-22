/**
 * ALMAFORT — собственный SMTP-мейлер (аналог классического PHP mail()-скрипта).
 * Никакой облачной почты Supabase: письма уходят с корпоративного SMTP,
 * реквизиты берутся строго из .env (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS).
 */

export type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

type Transporter = {
  sendMail: (options: Record<string, unknown>) => Promise<{ messageId?: string }>;
};

let transporterPromise: Promise<Transporter> | null = null;

export function siteUrl(): string {
  const raw = process.env["PUBLIC_SITE_URL"] || process.env["SITE_URL"] || "https://almafort.ru";
  return raw.replace(/\/+$/, "");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`SMTP не настроен: отсутствует ${name} в .env`);
  return value;
}

async function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      // Спецификатор через переменную: edge-сборка не тянет nodemailer в граф.
      const specifier = "nodemailer";
      const mod = (await import(/* @vite-ignore */ specifier)) as {
        default?: { createTransport: (o: unknown) => Transporter };
        createTransport?: (o: unknown) => Transporter;
      };
      const nodemailer = mod.default ?? mod;
      const port = Number(process.env["SMTP_PORT"] ?? 465);
      return nodemailer.createTransport!({
        host: requireEnv("SMTP_HOST"),
        port,
        // 465 — implicit TLS, 587/25 — STARTTLS.
        secure: port === 465,
        auth: { user: requireEnv("SMTP_USER"), pass: requireEnv("SMTP_PASS") },
        pool: true,
        maxConnections: 3,
      });
    })();
  }
  return transporterPromise;
}

export async function sendMail(payload: MailPayload): Promise<{ messageId?: string }> {
  const transporter = await getTransporter();
  const fromEmail = process.env["SMTP_FROM"] || process.env["SMTP_USER"] || "";
  const fromName = process.env["SMTP_FROM_NAME"] || "ALMAFORT";
  return transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: payload.to,
    subject: payload.subject,
    html: payload.html,
    text: payload.text ?? stripHtml(payload.html),
    ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
    headers: { "X-Mailer": "ALMAFORT" },
  });
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h1|h2|h3)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ------------------------------- Шаблоны -------------------------------- */

const BRAND = "ALMAFORT";

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:24px;background:#f4f5f4;font-family:Arial,Helvetica,sans-serif;color:#151815;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e5e3;">
    <tr><td style="padding:20px 28px;border-bottom:1px solid #e3e5e3;">
      <span style="font-size:18px;font-weight:800;letter-spacing:.08em;">${BRAND}</span>
      <span style="font-size:12px;color:#6b706b;margin-left:10px;">промышленный крепёж</span>
    </td></tr>
    <tr><td style="padding:28px;font-size:14px;line-height:1.6;">${body}</td></tr>
    <tr><td style="padding:18px 28px;border-top:1px solid #e3e5e3;font-size:12px;color:#6b706b;">
      Письмо отправлено автоматически сервисом ${BRAND}. Если вы не запрашивали действие — просто проигнорируйте его.
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;"><a href="${escapeHtml(href)}" style="display:inline-block;background:#1f6b3a;color:#ffffff;text-decoration:none;padding:12px 22px;font-weight:700;">${escapeHtml(label)}</a></p>
  <p style="margin:0;font-size:12px;color:#6b706b;word-break:break-all;">Если кнопка не работает, скопируйте ссылку:<br>${escapeHtml(href)}</p>`;
}

export function recoveryEmail(link: string): { subject: string; html: string } {
  return {
    subject: `${BRAND} — восстановление пароля`,
    html: layout(
      "Восстановление пароля",
      `<h1 style="margin:0 0 12px;font-size:20px;">Смена пароля в кабинете</h1>
       <p style="margin:0;">Мы получили запрос на восстановление доступа к B2B-кабинету ${BRAND}. Ссылка действует ограниченное время и срабатывает один раз.</p>
       ${button(link, "Задать новый пароль")}`,
    ),
  };
}

export function inviteEmail(link: string, company?: string): { subject: string; html: string } {
  return {
    subject: `${BRAND} — приглашение в B2B-кабинет`,
    html: layout(
      "Приглашение",
      `<h1 style="margin:0 0 12px;font-size:20px;">Доступ к кабинету снабженца</h1>
       <p style="margin:0;">${company ? `Компания ${escapeHtml(company)} п` : "П"}риглашает вас в закупочный кабинет ${BRAND}: статусы заказов, счета и УПД, повтор закупки в один клик.</p>
       ${button(link, "Принять приглашение")}`,
    ),
  };
}

export function orderNotificationEmail(params: {
  orderNumber: string;
  total?: string;
  customer?: string;
  url?: string;
}): { subject: string; html: string } {
  const rows = [
    ["Заказ", params.orderNumber],
    ["Клиент", params.customer ?? "—"],
    ["Сумма", params.total ?? "—"],
  ]
    .map(
      ([k, v]) =>
        `<tr><td style="padding:6px 0;color:#6b706b;width:120px;">${escapeHtml(k!)}</td><td style="padding:6px 0;font-weight:700;">${escapeHtml(v!)}</td></tr>`,
    )
    .join("");
  return {
    subject: `${BRAND} — новый заказ ${params.orderNumber}`,
    html: layout(
      "Новый заказ",
      `<h1 style="margin:0 0 12px;font-size:20px;">Поступил новый заказ</h1>
       <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;font-size:14px;">${rows}</table>
       ${params.url ? button(params.url, "Открыть в админке") : ""}`,
    ),
  };
}

export function noticeEmail(subject: string, message: string): { subject: string; html: string } {
  return {
    subject: `${BRAND} — ${subject}`,
    html: layout(
      subject,
      `<h1 style="margin:0 0 12px;font-size:20px;">${escapeHtml(subject)}</h1>
       <p style="margin:0;white-space:pre-line;">${escapeHtml(message)}</p>`,
    ),
  };
}
