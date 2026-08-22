/**
 * Система «Master Asset»: один пакет контента (фото + инженерное описание)
 * связан отношением Many-to-One с выборкой конкретных SKU.
 *
 * БД: public.asset_groups (slug, title, description, images jsonb)
 *     public.product_asset_links (sku → group_id)
 *
 * Каждое изображение хранит два готовых webp-размера:
 *   thumb_url — 64×64 для микро-превью в таблице каталога;
 *   full_url  — 800×800 для модального окна.
 */
import { useQuery } from "@tanstack/react-query";
import { getAssetGroupsData } from "@/lib/public.functions";

export type AssetImage = {
  thumb_url: string;
  full_url: string;
  caption?: string;
};

export type AssetGroup = {
  id: string;
  slug: string;
  title: string;
  description: string;
  images: AssetImage[];
};

const isImage = (v: unknown): v is AssetImage =>
  !!v &&
  typeof v === "object" &&
  typeof (v as AssetImage).thumb_url === "string" &&
  typeof (v as AssetImage).full_url === "string";

/** Карта SKU → группа контента. Пустая карта = фото ещё не привязаны. */
export async function fetchAssetGroups(): Promise<Map<string, AssetGroup>> {
  const map = new Map<string, AssetGroup>();
  const { groups, links } = await getAssetGroupsData().catch(() => ({ groups: [], links: [] }));

  const byId = new Map<string, AssetGroup>();
  for (const g of groups) {
    byId.set(g.id, {
      id: g.id,
      slug: g.slug,
      title: g.title,
      description: g.description ?? "",
      images: (g.images as unknown[]).filter(isImage),
    });
  }
  for (const l of links) {
    const g = byId.get(l.group_id);
    if (g) map.set(l.sku, g);
  }
  return map;
}

export function useAssetGroups() {
  const { data } = useQuery({
    queryKey: ["asset-groups"],
    queryFn: fetchAssetGroups,
    staleTime: 5 * 60_000,
  });
  return data ?? new Map<string, AssetGroup>();
}
