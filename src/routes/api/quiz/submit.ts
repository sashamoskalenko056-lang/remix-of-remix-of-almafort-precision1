import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { requiredFieldsResponse, zEmail, zName, zPhone } from "@/lib/required-fields";
import { verifyRecaptcha } from "@/lib/recaptcha.server";
import { pushQuizLead } from "@/lib/quiz-crm.server";

const schema = z.object({
  // ФИО, телефон и почта — обязательный минимум по любой заявке.
  name: zName,
  phone: zPhone,
  email: zEmail,
  quiz_answers: z.record(z.string().max(120), z.string().max(500)).default({}),
  file_urls: z.array(z.string().url().max(600)).max(10).default([]),
  token: z.string().max(4000).optional(),
});

export const Route = createFileRoute("/api/quiz/submit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.json().catch(() => null);
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
          const required = ["name", "phone", "email"];
          if (parsed.error.issues.some((i) => required.includes(String(i.path[0]))))
            return requiredFieldsResponse();
          return Response.json({ error: "Некорректные данные формы" }, { status: 400 });
        }
        const { token, ...lead } = parsed.data;

        const verdict = await verifyRecaptcha(token);
        if (!verdict.trusted) {
          // Боту отвечаем «успешно», данные никуда не уходят.
          console.warn(`[quiz] отклонён спам, score=${verdict.score}`);
          return Response.json({ ok: true });
        }

        const crm = await pushQuizLead({
          name: lead.name,
          phone: lead.phone,
          email: lead.email,
          quiz_answers: lead.quiz_answers,
          file_urls: lead.file_urls,
        });

        return Response.json({ ok: true, crm: crm.crm, delivered: crm.ok });
      },
    },
  },
});
