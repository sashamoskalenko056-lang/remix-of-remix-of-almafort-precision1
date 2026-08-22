/**
 * Учёт использования ИИ и подмена системного промпта из панели управления.
 * Метрики админки («Вызовов за сутки», «Токенов за месяц», «Расходы») считаются
 * из этой таблицы, а не вводятся руками.
 */

export type LlmUsage = { prompt_tokens: number; completion_tokens: number };

/** Ориентировочная стоимость: считаем в USD по прайсу gpt-класса. */
const COST_PER_1K_IN = 0.00125;
const COST_PER_1K_OUT = 0.01;

/** Активная версия системного промпта из редактора админки (или null). */
export async function activePrompt(slot: "configurator" | "vision"): Promise<string | null> {
  try {
    const { db: store } = await import("@/lib/db.server");
    const { data } = await store
      .from("llm_prompts")
      .select("content")
      .eq("slot", slot)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const content = (data as { content?: string } | null)?.content?.trim();
    return content && content.length >= 20 ? content : null;
  } catch (e) {
    console.error("[llm] prompt load failed", e);
    return null;
  }
}

/** Журнал диалогов: пишем каждый вызов, включая сломанный JSON. */
export async function logLlmCall(entry: {
  kind: "configurator" | "vision";
  prompt: string;
  response: string;
  parseStatus: "ok" | "json_error" | "api_error";
  model: string;
  usage: LlmUsage;
}) {
  try {
    const { db: store } = await import("@/lib/db.server");
    const cost =
      (entry.usage.prompt_tokens / 1000) * COST_PER_1K_IN +
      (entry.usage.completion_tokens / 1000) * COST_PER_1K_OUT;
    await store.from("llm_logs").insert({
      kind: entry.kind,
      prompt: entry.prompt.slice(0, 4000),
      response: entry.response.slice(0, 8000),
      parse_status: entry.parseStatus,
      model: entry.model,
      prompt_tokens: entry.usage.prompt_tokens,
      completion_tokens: entry.usage.completion_tokens,
      cost_usd: Math.round(cost * 1e6) / 1e6,
    } as never);
  } catch (e) {
    // Журнал не должен ронять ответ клиенту.
    console.error("[llm] log failed", e);
  }
}
