// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readFileSync } from "node:fs";

/**
 * Ассеты `*.asset.json` ссылаются на CDN Lovable (`/__l5e/assets-v1/...`),
 * который на собственном VPS отдаёт 404. Все файлы продублированы в
 * `public/media/`, поэтому подменяем url на локальный ещё на этапе сборки.
 */
const localAssetsPlugin = {
  name: "almafort:local-media-assets",
  enforce: "pre" as const,
  load(id: string) {
    const file = id.split("?")[0] ?? "";
    if (!file.endsWith(".asset.json") || !existsSync(file)) return null;
    try {
      const json = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const name = String(json["original_filename"] ?? "");
      if (name) json["url"] = `/media/${name}`;
      return { code: `export default ${JSON.stringify(json)};`, moduleType: "js" };
    } catch {
      return null;
    }
  },
};


// Внутри Lovable-сборки пресет пинится платформой (LOVABLE_NITRO_PRESET) — не трогаем.
// На своём сервере (VPS Reg.ru) собираем под Node: DEPLOY_TARGET=vps npm run build
// либо NITRO_PRESET=node-server npm run build.
const selfHostPreset =
  process.env["NITRO_PRESET"] ||
  (process.env["DEPLOY_TARGET"] === "vps" ? "node-server" : undefined);
// Явный NITRO_PRESET/DEPLOY_TARGET на своём сервере важнее платформенного пресета.
const isLovableBuild = Boolean(process.env["LOVABLE_NITRO_PRESET"]) && !selfHostPreset;

// Vite 8/Rolldown может удалить декларацию __exportAll при tree-shaking тяжёлых
// графов реэкспортов (Three/pdfmake/xlsx), оставив обращения к ней в SSR-чанках.
// Для VPS отключаем tree-shaking именно в production-сборке: noExternal здесь
// не помогает, потому что Nitro уже бандлит эти пакеты в .output/server/_libs.
const ssrOutput = {
  format: "es",
  interop: "auto",
  esModule: true,
  generatedCode: { constBindings: true, symbols: false },
  hoistTransitiveImports: false,
} as const;

export default defineConfig({
  ...(!isLovableBuild && selfHostPreset
    ? {
        nitro: { preset: selfHostPreset } as const,
      }
    : {}),
  tanstackStart: {
    // SSR включён: общедоступные маршруты рендерятся на сервере.
    // Тяжёлые браузерные пакеты (Three.js) изолированы через ClientOnly.
    ssr: true,
  },

  vite: {
    ...(!isLovableBuild && selfHostPreset
      ? {
          build: {
            rollupOptions: { treeshake: false as const },
          },
          environments: {
            ssr: {
              build: {
                minify: false as const,
                rollupOptions: {
                  treeshake: false as const,
                  output: ssrOutput,
                },
              },
            },
          },
        }
      : {}),
    plugins: [
      localAssetsPlugin,
      VitePWA({
        strategies: "generateSW",
        registerType: "autoUpdate",
        injectRegister: null,
        filename: "sw.js",
        // Манифест лежит в public/ и обслуживается как есть.
        manifest: false,
        // Клиентские ассеты собираются в dist/client — SW должен лежать рядом.
        outDir: "dist/client",
        devOptions: { enabled: false },

        workbox: {
          globPatterns: ["**/*.{js,css,woff2,png,svg,webp,ico}"],
          // SPA-бандл содержит тяжёлые чанки (3D-вьюер, pdfmake) — поднимаем лимит.
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallback: null,
          navigateFallbackDenylist: [/^\/~oauth/, /^\/api\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              // HTML — только NetworkFirst: свежая версия важнее офлайна.
              urlPattern: ({ request }: { request: Request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "almafort-pages",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 },
              },
            },
            {
              urlPattern: ({ request }: { request: Request }) =>
                ["style", "script", "worker", "font"].includes(request.destination),
              handler: "StaleWhileRevalidate",
              options: { cacheName: "almafort-assets" },
            },
            {
              urlPattern: ({ request }: { request: Request }) => request.destination === "image",
              handler: "CacheFirst",
              options: {
                cacheName: "almafort-images",
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              },
            },
          ],
        },
      }),
    ],
  },
});
