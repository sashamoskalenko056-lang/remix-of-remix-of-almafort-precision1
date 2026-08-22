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

export type RawAssetGroup = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  images: unknown[];
};
export type RawAssetLink = { sku: string; group_id: string };

export const getAssetGroupsData = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ groups: RawAssetGroup[]; links: RawAssetLink[] }> => {
    try {
      const { db } = await import("@/lib/db.server");
      const [groups, links] = await Promise.all([
        db.from("asset_groups").select("id, slug, title, description, images"),
        db.from("product_asset_links").select("sku, group_id"),
      ]);
      return {
        groups: (groups.data ?? []).map((g: Record<string, unknown>) => ({
          id: String(g["id"] ?? ""),
          slug: String(g["slug"] ?? ""),
          title: String(g["title"] ?? ""),
          description: (g["description"] as string | null) ?? null,
          images: Array.isArray(g["images"]) ? (g["images"] as unknown[]) : [],
        })),
        links: (links.data ?? []).map((l: Record<string, unknown>) => ({
          sku: String(l["sku"] ?? ""),
          group_id: String(l["group_id"] ?? ""),
        })),
      };
    } catch {
      return { groups: [], links: [] };
    }
  },
);
