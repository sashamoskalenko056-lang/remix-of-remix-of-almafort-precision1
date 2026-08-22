/**
 * ALMAFORT — собственный SMTP-мейлер (аналог классического PHP mail()-скрипта).
 * Никакой облачной почты: письма уходят с корпоративного SMTP,
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
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    // Точная подсказка для VPS: пустой .env или pm2 без --update-env.
    throw new Error(
      `SMTP не настроен: пустая переменная ${name}. Заполните SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS в /var/www/almafort/.env и перезапустите: pm2 restart almafort --update-env`,
    );
  }
  return value;
}

type NodemailerModule = {
  default?: { createTransport: (o: unknown) => Transporter };
  createTransport?: (o: unknown) => Transporter;
};

/** Грузим nodemailer в обход бандлера: сначала CommonJS require, затем import(). */
async function loadNodemailer(): Promise<{ createTransport: (o: unknown) => Transporter }> {
  try {
    const moduleSpecifier = "node:module";
    const { createRequire } = (await import(/* @vite-ignore */ moduleSpecifier)) as {
      createRequire: (path: string) => (id: string) => NodemailerModule;
    };
    const mod = createRequire(import.meta.url)("nodemailer");
    const nm = mod.default ?? mod;
    if (nm.createTransport) return nm as { createTransport: (o: unknown) => Transporter };
  } catch (e) {
    console.error("[mailer] require('nodemailer') не сработал:", (e as Error)?.message);
  }
  const specifier = "nodemailer";
  const mod = (await import(/* @vite-ignore */ specifier)) as NodemailerModule;
  const nm = mod.default ?? mod;
  if (!nm.createTransport) throw new Error("nodemailer не установлен на сервере (npm i nodemailer)");
  return nm as { createTransport: (o: unknown) => Transporter };
}

export function smtpConfig() {
  const port = Number(process.env["SMTP_PORT"] ?? 587);
  // 587 — STARTTLS (Gmail, большинство хостингов), 465 — implicit SSL/TLS.
  // Порт 465 часто блокируется хостингом; по умолчанию используем 587.
  const secure = (process.env["SMTP_SECURE"] ?? "").trim()
    ? /^(1|true|yes)$/i.test(process.env["SMTP_SECURE"]!)
    : port === 465;
  return {
    // По умолчанию — Gmail (пароль приложения из 16 символов в SMTP_PASS).
    host: process.env["SMTP_HOST"] || "smtp.gmail.com",
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: { user: requireEnv("SMTP_USER"), pass: requireEnv("SMTP_PASS") },
    pool: true,
    maxConnections: 3,
    // Форсируем IPv4: на VPS с частичным IPv6-стеком Node иначе падает с ENETUNREACH.
    family: 4 as const,
    // Без явных таймаутов зависший SMTP держит запрос до таймаута nginx.
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" as const },
    logger: process.env["SMTP_DEBUG"] === "1",
    debug: process.env["SMTP_DEBUG"] === "1",
  };
}

async function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = (async () => {
      const nodemailer = await loadNodemailer();
      const cfg = smtpConfig();
      console.info(
        `[mailer] SMTP ${cfg.host}:${cfg.port} secure=${cfg.secure} user=${cfg.auth.user.replace(/(.{2}).*(@.*)/, "$1***$2")}`,
      );
      return nodemailer.createTransport(cfg);
    })().catch((e) => {
      transporterPromise = null; // повторная попытка на следующем запросе
      throw e;
    });
  }
  return transporterPromise;
}

export async function sendMail(payload: MailPayload): Promise<{ messageId?: string }> {
  const fromEmail = process.env["SMTP_FROM"] || process.env["SMTP_USER"] || "";
  const fromName = process.env["SMTP_FROM_NAME"] || "ALMAFORT";
  try {
    const transporter = await getTransporter();
    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text ?? stripHtml(payload.html),
      ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
      headers: { "X-Mailer": "ALMAFORT" },
    });
    console.info(`[mailer] отправлено -> ${payload.to} (${info?.messageId ?? "no-id"})`);
    return info;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { command?: string; responseCode?: number; response?: string };
    console.error(
      "[mailer] ОШИБКА ОТПРАВКИ",
      JSON.stringify({
        to: payload.to,
        host: process.env["SMTP_HOST"] ?? null,
        port: process.env["SMTP_PORT"] ?? null,
        code: err?.code ?? null,
        command: err?.command ?? null,
        responseCode: err?.responseCode ?? null,
        response: err?.response ?? null,
        message: err?.message ?? String(e),
      }),
    );
    throw e;
  }
}

/** Диагностика соединения: используется health-проверкой SMTP. */
export async function verifySmtp(): Promise<void> {
  const transporter = (await getTransporter()) as Transporter & { verify?: () => Promise<boolean> };
  if (transporter.verify) await transporter.verify();
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
    subject: `Восстановление доступа к ${BRAND}`,
    html: layout(
      "Восстановление доступа",
      `<h1 style="margin:0 0 12px;font-size:20px;">Восстановление сессии</h1>
       <p style="margin:0;">Запрошено восстановление сессии. Для безопасного входа перейдите по уникальной одноразовой ссылке. Ссылка сгорит через 15 минут.</p>
       ${button(link, "Войти безопасно")}`,
    ),
  };
}

export function magicLinkEmail(link: string): { subject: string; html: string } {
  return {
    subject: `${BRAND} — вход в B2B-кабинет`,
    html: layout(
      "Вход в кабинет",
      `<h1 style="margin:0 0 12px;font-size:20px;">Одноразовая ссылка для входа</h1>
       <p style="margin:0;">Перейдите по ссылке, чтобы войти в B2B-кабинет ${BRAND}. Ссылка действует ограниченное время и срабатывает один раз.</p>
       ${button(link, "Войти в кабинет")}`,
    ),
  };
}

export function registrationEmail(): { subject: string; html: string } {
  return {
    subject: `${BRAND} — кабинет создан`,
    html: layout(
      "Кабинет создан",
      `<h1 style="margin:0 0 12px;font-size:20px;">Добро пожаловать в ${BRAND}</h1>
       <p style="margin:0;">Ваш B2B-кабинет создан. Теперь вы можете войти с указанными при регистрации почтой и паролем.</p>
       ${button(`${siteUrl()}/auth`, "Войти в кабинет")}`,
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

/** Одноразовый код входа: крупные цифры, адаптивная вёрстка. */
export function otpEmail(code: string): { subject: string; html: string } {
  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="padding:0 6px;"><div style="width:56px;height:64px;line-height:64px;text-align:center;background:#f4f5f4;border:1px solid #d9ddd9;font-size:34px;font-weight:800;letter-spacing:.04em;">${escapeHtml(d)}</div></td>`,
    )
    .join("");
  return {
    subject: `Ваш код доступа ${BRAND}`,
    html: layout(
      "Код доступа",
      `<h1 style="margin:0 0 12px;font-size:20px;">Здравствуйте!</h1>
       <p style="margin:0 0 18px;">Для входа в личный кабинет используйте следующий одноразовый код:</p>
       <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto;"><tr>${digits}</tr></table>
       <p style="margin:20px 0 0;font-size:13px;color:#6b706b;">Код действителен 5 минут. Если вы не запрашивали код, просто проигнорируйте это письмо.</p>`,
    ),
  };
}

/** Приветствие нового B2B-профиля. */
export function welcomeEmail(): { subject: string; html: string } {
  return {
    subject: `Добро пожаловать в ${BRAND}`,
    html: layout(
      "Добро пожаловать",
      `<h1 style="margin:0 0 12px;font-size:20px;">Аккаунт снабженца создан</h1>
       <p style="margin:0;">Ваш аккаунт снабженца успешно создан. Теперь вам доступны ИИ-конфигуратор и история заказов.</p>
       ${button(`${siteUrl()}/cabinet`, "Открыть кабинет")}`,
    ),
  };
}
