/**
 * Публичные серверные функции: данные, которые доступны без входа.
 * Читают локальную JSON-БД, никаких внешних облаков.
 */
import { createServerFn } from "@tanstack/react-start";

export const getMaintenanceState = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { db } = await import("@/lib/db.server");
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", "maintenance_mode")
      .maybeSingle();
    const v = (data?.["value"] ?? null) as { enabled?: boolean; message?: string } | null;
    return { enabled: Boolean(v?.enabled), message: v?.message ?? "" };
  } catch {
    return { enabled: false, message: "" };
  }
});

export const getAssetGroupsData = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { db } = await import("@/lib/db.server");
    const [groups, links] = await Promise.all([
      db.from("asset_groups").select("id, slug, title, description, images"),
      db.from("product_asset_links").select("sku, group_id"),
    ]);
    return {
      groups: (groups.data ?? []) as Array<Record<string, unknown>>,
      links: (links.data ?? []) as Array<Record<string, unknown>>,
    };
  } catch {
    return { groups: [], links: [] };
  }
});
