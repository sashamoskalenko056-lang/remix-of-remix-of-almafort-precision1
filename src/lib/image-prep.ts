// Клиентская предобработка фото для ИИ-камеры: декодирование (включая HEIC с iPhone),
// сжатие до 800×800 WebP/JPEG и оценка условий съёмки (темнота, слияние с фоном).
// Цель — не гонять 4K/8 МБ на сервер: на 3G это гарантированный отказ клиента.

export const TARGET_SIDE = 800;
/** Предел стороны при декодировании: телефонные 12–50 Мп рушат память Safari. */
export const DECODE_MAX_SIDE = 1600;
/** Жёсткий потолок полезной нагрузки: сервер режет кадры тяжелее 3 МБ. */
export const MAX_UPLOAD_KB = 1400;


export type Prepared = {
  dataUrl: string;
  /** Приблизительный вес полезной нагрузки в килобайтах. */
  kb: number;
  width: number;
  height: number;
};

/** WebP умеет не каждый Safari — проверяем один раз и падаем в JPEG. */
let webpOk: boolean | null = null;
function supportsWebp(): boolean {
  if (webpOk !== null) return webpOk;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    webpOk = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    webpOk = false;
  }
  return webpOk;
}

/**
 * Декодирование файла с камеры/диска. iPhone отдаёт HEIC/HEIF: `createImageBitmap`
 * его не берёт в Chrome, поэтому пробуем ещё и путь через <img> + objectURL,
 * который в Safari отрабатывает нативно.
 */
export async function decodeImageFile(
  file: File,
): Promise<{ source: CanvasImageSource; width: number; height: number } | null> {
  // Телефон отдаёт 12–50 Мп: полноразмерный bitmap съедает память Safari и кадр
  // молча превращается в пустое полотно. Просим декодер сразу уменьшить картинку.
  const bitmap =
    (await createImageBitmap(file, {
      resizeWidth: DECODE_MAX_SIDE,
      resizeQuality: "high",
    } as ImageBitmapOptions).catch(() => null)) ?? (await createImageBitmap(file).catch(() => null));
  if (bitmap) return { source: bitmap, width: bitmap.width, height: bitmap.height };


  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("decode failed"));
    });
    await img.decode().catch(() => undefined);
    if (!img.naturalWidth) return null;
    // Рисуем сразу: после revokeObjectURL источник станет непригоден.
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    return { source: canvas, width: canvas.width, height: canvas.height };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Сжатие в квадрат TARGET_SIDE с центральным кропом — тот же кадр, что видит рамка. */
export function compress(
  source: CanvasImageSource,
  width: number,
  height: number,
  opts: { square?: boolean; quality?: number } = {},
): Prepared {
  const quality = opts.quality ?? 0.82;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (opts.square !== false) {
    const side = Math.min(width, height);
    canvas.width = TARGET_SIDE;
    canvas.height = TARGET_SIDE;
    ctx?.drawImage(
      source,
      Math.round((width - side) / 2),
      Math.round((height - side) / 2),
      side,
      side,
      0,
      0,
      TARGET_SIDE,
      TARGET_SIDE,
    );
  } else {
    const scale = Math.min(1, TARGET_SIDE / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    ctx?.drawImage(source, 0, 0, canvas.width, canvas.height);
  }

  const type = supportsWebp() ? "image/webp" : "image/jpeg";
  const dataUrl = canvas.toDataURL(type, quality);
  return {
    dataUrl,
    kb: Math.round((dataUrl.length * 0.75) / 1024),
    width: canvas.width,
    height: canvas.height,
  };
}

export type FrameStats = {
  /** Средняя яркость 0..255. */
  luma: number;
  /** Среднеквадратичное отклонение яркости — «контраст» кадра. */
  contrast: number;
  /** Дисперсия лапласиана — резкость. */
  sharpness: number;
};

/** Быстрая статистика кадра по уменьшенной копии: темнота, контраст, смаз. */
export function frameStats(source: CanvasImageSource, width: number, height: number): FrameStats {
  const w = 128;
  const h = Math.max(1, Math.round((height / width) * w));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { luma: 128, contrast: 99, sharpness: Infinity };
  ctx.drawImage(source, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    gray[i] = g;
    sum += g;
  }
  const luma = sum / (w * h);
  let varSum = 0;
  for (let i = 0; i < w * h; i++) varSum += (gray[i]! - luma) ** 2;
  const contrast = Math.sqrt(varSum / (w * h));

  let lapSum = 0;
  let lapSq = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i]! - gray[i - 1]! - gray[i + 1]! - gray[i - w]! - gray[i + w]!;
      lapSum += lap;
      lapSq += lap * lap;
      n++;
    }
  }
  const sharpness = n ? lapSq / n - (lapSum / n) ** 2 : Infinity;
  return { luma, contrast, sharpness };
}

/** Порог «тёмный цех / чёрное на чёрном»: тратить токены на такой кадр бессмысленно. */
export function lowLightHint(s: FrameStats): string | null {
  if (s.luma < 42)
    return "Слишком темно. Включите вспышку или подсветите деталь — ИИ не различит геометрию";
  if (s.contrast < 12)
    return "Деталь сливается с фоном. Положите её на светлый лист бумаги и снимите ещё раз";
  return null;
}
