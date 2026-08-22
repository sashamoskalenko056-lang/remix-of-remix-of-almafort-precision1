/**
 * Защита формы входа от перебора паролей.
 * Счётчик живёт на сервере, поэтому его нельзя обойти из devtools.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const emailInput = (input: { email: string }) => ({
  email: z.string().trim().toLowerCase().max(160).parse(input.email),
});

async function guard() {
  return await import("@/lib/rate-limit.server");
}


export const checkLoginAllowed = createServerFn({ method: "POST" })
  .inputValidator(emailInput)
  .handler(async ({ data }) => {
    const { clientIp, loginBlockedFor } = await guard();
    const ip = clientIp(getRequest());
    const retryAfter = Math.max(
      loginBlockedFor(`login:${ip}`),
      loginBlockedFor(`login:${data.email}`),
    );
    return { allowed: retryAfter === 0, retryAfter };
  });

export const reportLoginFailure = createServerFn({ method: "POST" })
  .inputValidator(emailInput)
  .handler(async ({ data }) => {
    const { clientIp, registerLoginFailure } = await guard();
    const ip = clientIp(getRequest());
    const blocked =
      [registerLoginFailure(`login:${ip}`), registerLoginFailure(`login:${data.email}`)].some(
        Boolean,
      );

    if (blocked) {
      // Владелец аккаунта и владелец платформы должны узнать о переборе.
      try {
        const { db: store } = await import("@/lib/db.server");
        await store.from("admin_logs").insert({
          action: "login_bruteforce_block",
          target: data.email,
          new_value: { ip, blocked_minutes: 15 },
        });
      } catch (e) {
        console.error("[auth-guard] не удалось записать инцидент", e);
      }
    }
    return { blocked };
  });

export const reportLoginSuccess = createServerFn({ method: "POST" })
  .inputValidator(emailInput)
  .handler(async ({ data }) => {
    const { clientIp, clearLoginFailures } = await guard();
    clearLoginFailures(`login:${clientIp(getRequest())}`);
    clearLoginFailures(`login:${data.email}`);
    return { ok: true };
  });
