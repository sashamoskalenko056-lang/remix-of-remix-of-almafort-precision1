/**
 * Единая точка выхода во внешние LLM (паттерн Strategy).
 *
 * Зачем: на площадке Lovable ИИ работает через шлюз Lovable AI Gateway с
 * платформенным ключом. На боевом VPS (в т.ч. в РФ) этого ключа нет, а прямые
 * домены OpenAI/Google недоступны — обращаться придётся через свой API-шлюз.
 * Поэтому и провайдер, и точка входа (Base URL), и имя модели задаются
 * переменными окружения, а код вызова остаётся один.
 *
 * Переменные (.env):
 *   AI_PROVIDER              = lovable | openai | gemini      (общий режим)
 *   AI_PROVIDER_VISION       = ...                            (переопределение для ИИ-камеры)
 *   AI_PROVIDER_CONFIGURATOR = ...                            (переопределение для конфигуратора)
 *
 *   LOVABLE_API_KEY   / LOVABLE_BASE_URL
 *   OPENAI_API_KEY    / OPENAI_BASE_URL    / OPENAI_MODEL     / OPENAI_VISION_MODEL
 *   GEMINI_API_KEY    / GEMINI_BASE_URL    / GEMINI_MODEL     / GEMINI_VISION_MODEL
 *
 * Ключи читаются через vault: сначала зашифрованное хранилище админки
 * (AES-256-GCM), затем переменная окружения. Хардкод ключей запрещён.
 */
import { secretValue } from "@/lib/vault.server";

export type AiTask = "vision" | "configurator";
export type AiProviderId = "lovable" | "openai" | "gemini";

export type AiUsage = { prompt_tokens: number; completion_tokens: number };

export type AiTextPart = { type: "text"; text: string };
export type AiImagePart = { type: "image_url"; image_url: { url: string } };
export type AiContent = string | Array<AiTextPart | AiImagePart>;

export type AiJsonSchema = { name: string; schema: unknown };

export type AiRequest = {
  task: AiTask;
  system: string;
  content: AiContent;
  /** Строгий JSON-ответ по схеме (конфигуратор). */
  jsonSchema?: AiJsonSchema;
  timeoutMs?: number;
};

export type AiResponse = { text: string; usage: AiUsage; model: string; provider: AiProviderId };

/** Ключи не заданы / шлюз не сконфигурирован — фронтенд уходит в ручной режим. */
export class AiUnavailableError extends Error {
  readonly fallback = true;
  constructor(message = "Сервис временно недоступен") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** Провайдер ответил ошибкой (лимиты, 4xx/5xx) — сообщение уже человеческое. */
export class AiGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** true — задачу можно увести в ручной режим, а не показывать код ошибки. */
    readonly fallback = true,
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}

const DEFAULTS = {
  lovable: {
    baseUrl: "https://ai.gateway.lovable.dev/v1",
    model: "openai/gpt-5.6-sol",
    visionModel: "google/gemini-3.6-flash",
  },
  openai: {
    // Рег.облако (Reg.ru Cloud AI) — OpenAI-совместимый шлюз.
    // Точка входа задаётся OPENAI_BASE_URL, значение ниже — только запасное.
    baseUrl: "https://api.openai.com/v1",
    model: "deepseek-v4-flash",
    visionModel: "gemini-3.5-flash",
  },
  gemini: {
    // OpenAI-совместимый эндпоинт Google: тело запроса не меняется.
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    visionModel: "gemini-2.0-flash",
  },
} as const;

const env = (name: string) => process.env[name]?.trim() || null;

const trimSlash = (url: string) => url.replace(/\/+$/, "");

function providerFor(task: AiTask): AiProviderId {
  const explicit =
    env(task === "vision" ? "AI_PROVIDER_VISION" : "AI_PROVIDER_CONFIGURATOR") ?? env("AI_PROVIDER");
  // По умолчанию — Рег.облако (OpenAI-совместимый режим), как только заданы
  // OPENAI_BASE_URL/OPENAI_API_KEY. Шлюз Lovable остаётся запасным вариантом.
  const fallback = env("OPENAI_BASE_URL") || env("OPENAI_API_KEY") ? "openai" : "lovable";
  const raw = (explicit ?? fallback).toLowerCase();
  return raw === "openai" || raw === "gemini" ? raw : "lovable";
}

type Resolved = {
  provider: AiProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
};

/** Единая резолюция «провайдер + ключ + точка входа + модель» для задачи. */
export async function resolveAi(task: AiTask): Promise<Resolved> {
  const provider = providerFor(task);
  const d = DEFAULTS[provider];
  const isVision = task === "vision";

  if (provider === "openai") {
    const apiKey = await secretValue("OPENAI_API_KEY");
    if (!apiKey) throw new AiUnavailableError();
    return {
      provider,
      apiKey,
      baseUrl: trimSlash(env("OPENAI_BASE_URL") ?? d.baseUrl),
      model: (isVision ? env("OPENAI_VISION_MODEL") : null) ?? env("OPENAI_MODEL") ??
        (isVision ? d.visionModel : d.model),
    };
  }

  if (provider === "gemini") {
    const apiKey = await secretValue("GEMINI_API_KEY");
    if (!apiKey) throw new AiUnavailableError();
    return {
      provider,
      apiKey,
      baseUrl: trimSlash(env("GEMINI_BASE_URL") ?? d.baseUrl),
      model: (isVision ? env("GEMINI_VISION_MODEL") : null) ?? env("GEMINI_MODEL") ??
        (isVision ? d.visionModel : d.model),
    };
  }

  const apiKey = await secretValue("LOVABLE_API_KEY");
  if (!apiKey) throw new AiUnavailableError();
  return {
    provider,
    apiKey,
    baseUrl: trimSlash(env("LOVABLE_BASE_URL") ?? d.baseUrl),
    model: (isVision ? env("LOVABLE_VISION_MODEL") : null) ?? env("LOVABLE_MODEL") ??
      (isVision ? d.visionModel : d.model),
  };
}

/** Быстрая проверка для UI: сконфигурирован ли ИИ вообще. */
export async function aiConfigured(task: AiTask): Promise<boolean> {
  try {
    await resolveAi(task);
    return true;
  } catch {
    return false;
  }
}

function authHeaders(r: Resolved): Record<string, string> {
  if (r.provider === "lovable") {
    return {
      Authorization: `Bearer ${r.apiKey}`,
      "Lovable-API-Key": r.apiKey,
      "X-Lovable-AIG-SDK": "fetch",
    };
  }
  // OpenAI и OpenAI-совместимые шлюзы (в т.ч. российские прокси и Gemini-compat).
  return { Authorization: `Bearer ${r.apiKey}` };
}

/** Человеческие сообщения вместо кодов ошибок провайдера. */
function gatewayError(status: number, task: AiTask, detail = ""): AiGatewayError {
  const what = task === "vision" ? "распознавания" : "конфигуратора";
  if (status === 429)
    return new AiGatewayError("Слишком много запросов к ИИ. Повторите через минуту.", status);
  if (status === 402 || status === 403)
    return new AiGatewayError("Лимит ИИ-запросов исчерпан. Обратитесь к менеджеру.", status);
  if (status === 401) {
    // Ключ шлюза истёк или отозван — это настройка, а не сбой сети.
    const expired = /expired/i.test(detail);
    return new AiGatewayError(
      expired
        ? "Ключ доступа к ИИ-шлюзу истёк. Обновите OPENAI_API_KEY в настройках."
        : "Ключ доступа к ИИ-шлюзу неверен. Проверьте OPENAI_API_KEY и OPENAI_BASE_URL.",
      status,
    );
  }
  return new AiGatewayError(`Сервис ${what} временно недоступен`, status);
}


async function postJson(
  r: Resolved,
  path: string,
  body: unknown,
  timeoutMs: number,
  task: AiTask,
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${r.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(r) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new AiGatewayError(
        "Анализ занимает слишком много времени. Упростите запрос или обратитесь к менеджеру.",
        504,
      );
    }
    // Сеть/DNS: типовая история для VPS в РФ без корректного шлюза.
    console.error(`[ai:${r.provider}] network error`, e);
    throw new AiUnavailableError();
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[ai:${r.provider}] ${path} ${res.status}: ${detail.slice(0, 500)}`);
    throw gatewayError(res.status, task);
  }
  return res;
}

/* ── Стратегия 1: OpenAI-совместимый /chat/completions ─────────────── */

async function chatCompletions(r: Resolved, req: AiRequest): Promise<AiResponse> {
  const body: Record<string, unknown> = {
    model: r.model,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.content },
    ],
  };
  if (req.jsonSchema) {
    body["response_format"] = {
      type: "json_schema",
      json_schema: { name: req.jsonSchema.name, strict: true, schema: req.jsonSchema.schema },
    };
  }

  const res = await postJson(r, "/chat/completions", body, req.timeoutMs ?? 30_000, req.task);
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  return {
    text: (json.choices?.[0]?.message?.content ?? "").trim(),
    usage: {
      prompt_tokens: json.usage?.prompt_tokens ?? 0,
      completion_tokens: json.usage?.completion_tokens ?? 0,
    },
    model: r.model,
    provider: r.provider,
  };
}

/* ── Стратегия 2: Lovable AI Gateway /responses (SSE) ──────────────── */

function asInputText(content: AiContent): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is AiTextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n\n");
}

async function lovableResponses(r: Resolved, req: AiRequest): Promise<AiResponse> {
  const body: Record<string, unknown> = {
    model: r.model,
    stream: true,
    instructions: req.system,
    input: [{ role: "user", content: [{ type: "input_text", text: asInputText(req.content) }] }],
  };
  if (req.jsonSchema) {
    body["text"] = {
      format: {
        type: "json_schema",
        name: req.jsonSchema.name,
        strict: true,
        schema: req.jsonSchema.schema,
      },
    };
  }

  const res = await postJson(r, "/responses", body, req.timeoutMs ?? 30_000, req.task);
  if (!res.body) throw new AiGatewayError("Сервис конфигуратора временно недоступен", 502);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const usage: AiUsage = { prompt_tokens: 0, completion_tokens: 0 };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const event = JSON.parse(payload) as {
          type?: string;
          delta?: string;
          response?: {
            output_text?: string;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
        };
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
          text += event.delta;
        } else if (event.type === "response.completed") {
          if (!text) text = event.response?.output_text ?? "";
          usage.prompt_tokens = event.response?.usage?.input_tokens ?? usage.prompt_tokens;
          usage.completion_tokens = event.response?.usage?.output_tokens ?? usage.completion_tokens;
        }
      } catch {
        /* незакрытый фрагмент SSE */
      }
    }
  }

  return { text: text.trim(), usage, model: r.model, provider: r.provider };
}

/* ── Публичный вызов ───────────────────────────────────────────────── */

/**
 * Единственный способ обратиться к LLM из бизнес-кода.
 * Бросает AiUnavailableError (ключей нет) или AiGatewayError (провайдер ответил ошибкой).
 */
export async function aiComplete(req: AiRequest): Promise<AiResponse> {
  const r = await resolveAi(req.task);
  // Мультимодальный вход и «сырые» шлюзы удобнее гонять через chat/completions;
  // /responses оставляем только для конфигуратора на шлюзе Lovable.
  if (r.provider === "lovable" && req.task === "configurator") return lovableResponses(r, req);
  return chatCompletions(r, req);
}
