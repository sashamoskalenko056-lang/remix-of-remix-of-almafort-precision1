import type { ReactNode } from "react";

/**
 * Обязательное поле: подпись со звёздочкой, красная рамка после попытки
 * отправки и микротекст с причиной. Используется во всех формах платформы.
 */
export function Field({
  label,
  required = false,
  error,
  children,
  className = "",
}: {
  label: string;
  required?: boolean;
  /** Текст ошибки; null/undefined — поле валидно или ещё не проверялось. */
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        {required && <span className="font-bold text-[#E52421]"> *</span>}
      </span>
      {children}
      {error && <span className="text-[11px] leading-[1.4] text-[#E52421]">{error}</span>}
    </label>
  );
}

/** Классы инпута с подсветкой невалидного состояния. */
export const inputClass = (invalid?: boolean, extra = "") =>
  `h-12 w-full rounded-sm border px-3.5 text-base outline-none transition-colors md:h-11 md:text-[13px] ${
    invalid ? "border-[#E52421] bg-[#E52421]/[0.03]" : "border-[#D1D5DB] focus:border-primary"
  } ${extra}`;
