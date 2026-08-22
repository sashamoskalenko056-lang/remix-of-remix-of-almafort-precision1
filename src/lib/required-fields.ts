/**
 * Единые правила обязательных полей B2B-платформы: ФИО, телефон, e-mail, ИНН.
 * Один и тот же модуль используют формы на клиенте и валидаторы Nitro API,
 * поэтому «пустой» заказ невозможно отправить ни из UI, ни curl-ом.
 */
import { z } from "zod";
import { phoneDigits } from "@/lib/phone";
import { sanitizeInn, INN_REGEX } from "@/lib/inn";

export const REQUIRED_MSG = "Это поле обязательно для заполнения";
/** Один ответ на любой недобор обязательных полей — требование ТЗ. */
export const REQUIRED_API_ERROR = "Заполните все обязательные поля";

export const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[A-Za-zА-Яа-я]{2,}$/;

export const isFilledName = (v: string) => v.trim().length >= 2;
export const isFilledEmail = (v: string) => EMAIL_REGEX.test(v.trim());
export const isFilledPhone = (v: string) => phoneDigits(v).length === 11;
export const isFilledInn = (v: string) => INN_REGEX.test(sanitizeInn(v));

/** Ошибка поля: null — всё в порядке, строка — микротекст под инпутом. */
export function fieldError(
  kind: "name" | "email" | "phone" | "inn",
  value: string,
): string | null {
  if (!value.trim()) return REQUIRED_MSG;
  if (kind === "name") return isFilledName(value) ? null : "Укажите имя и фамилию";
  if (kind === "email") return isFilledEmail(value) ? null : "Некорректный e-mail: нужен формат name@domain.ru";
  if (kind === "phone") return isFilledPhone(value) ? null : "Введите номер полностью: +7 (___) ___-__-__";
  return isFilledInn(value) ? null : "ИНН содержит 10 цифр (юрлицо) или 12 цифр (ИП)";
}

/** Серверные схемы: те же правила, но уже как отбойник 400 Bad Request. */
export const zName = z.string().trim().min(2).max(120);
export const zEmail = z.string().trim().max(255).regex(EMAIL_REGEX);
export const zPhone = z
  .string()
  .trim()
  .max(32)
  .refine((v) => phoneDigits(v).length === 11);
export const zInn = z
  .string()
  .trim()
  .transform(sanitizeInn)
  .refine((v) => INN_REGEX.test(v));

/** Единый JSON-ответ отбойника для всех POST-эндпоинтов с формами. */
export const requiredFieldsResponse = () =>
  Response.json({ error: REQUIRED_API_ERROR }, { status: 400 });
