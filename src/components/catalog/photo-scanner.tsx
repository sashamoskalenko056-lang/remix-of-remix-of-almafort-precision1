import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CameraOff,
  ImageUp,
  Loader2,
  Monitor,
  PlayCircle,
  RefreshCw,
  SwitchCamera,
  TriangleAlert,
  X,
} from "lucide-react";
import { useSwipeClose } from "@/lib/use-swipe-close";
import { toast } from "sonner";
import { useCart } from "@/store/cart-store";
import { formatPrice } from "@/lib/pricing";
import { QuoteRequestModal } from "@/components/catalog/quote-request-modal";
import { compress, decodeImageFile, frameStats, lowLightHint } from "@/lib/image-prep";

type Item = {
  sku: string;
  name: string;
  dims: string;
  price: number;
  stock: number;
  lead: string | null;
};

type Verdict = {
  status: "VALID" | "FOREIGN" | "INVALID";
  type: string;
  shape: string;
  color: string;
  has_threads: boolean;
  confidence: number;
  observed: string;
  hands_present: boolean;
  low_light: boolean;
  markers: string[];
};

type Result =
  | { scenario: "exact"; verdict: Verdict; category: string; variants: Item[] }
  | { scenario: "ambiguous"; verdict: Verdict; question?: string; matches: Item[] }
  | {
      scenario: "clarify";
      verdict: Verdict;
      question?: string;
      groups: Array<{ category: string; items: Item[] }>;
    }
  | { scenario: "foreign"; verdict: Verdict }
  | { scenario: "lowlight"; verdict: Verdict }
  | { scenario: "invalid"; verdict: Verdict };

const BLUR_THRESHOLD = 45;

/** ПК без тач-экрана: снабженец не будет подносить грязный подпятник к монитору. */
function detectDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const finePointer = window.matchMedia("(pointer: fine)").matches;
  const noTouch = !window.matchMedia("(any-pointer: coarse)").matches;
  return finePointer && noTouch;
}

export function PhotoScanner({ open, onClose }: { open: boolean; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [paused, setPaused] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const swipe = useSwipeClose(() => setResult(null));
  const [dragOver, setDragOver] = useState(false);
  const [shake, setShake] = useState<string | null>(null);
  /** Сетевая/серверная ошибка: без явного текста экран выглядит «зависшим». */
  const [fatal, setFatal] = useState<string | null>(null);
  /** Выбранная клиентом категория в сценарии ручного уточнения. */
  const [clarified, setClarified] = useState<string | null>(null);
  const [size, setSize] = useState("");
  const [reverse, setReverse] = useState(false);
  /** Замороженный кадр: показываем поверх видео, пока думает нейросеть. */
  const [frozen, setFrozen] = useState<string | null>(null);
  /** Превью выбранного/снятого файла: показываем всегда, независимо от результата анализа. */
  const [preview, setPreview] = useState<string | null>(null);

  const [desktop, setDesktop] = useState(false);
  /** На ПК стартуем с зоны Drag & Drop, камеру включаем только по явной просьбе. */
  const [wantCamera, setWantCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const addLine = useCart((s) => s.addLine);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const facingRef = useRef<"environment" | "user">("environment");
  facingRef.current = facing;

  const start = useCallback(async () => {
    setCamError(null);
    setPaused(false);
    try {
      // Без HTTPS (или localhost) браузер вообще не спрашивает разрешение на камеру.
      if (typeof window !== "undefined" && window.isSecureContext === false) {
        throw Object.assign(new Error("insecure"), { name: "InsecureContextError" });
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error("no api"), { name: "NotFoundError" });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        // Тыльная камера обязательна по умолчанию: селфи-камера в сканере — критический баг.
        video: { facingMode: { ideal: facingRef.current }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;


      const track = stream.getVideoTracks()[0];
      if (track && facingRef.current === "environment") {
        // Мелкий крепёж: просим ближнюю дистанцию фокусировки (макро-модуль),
        // непрерывный автофокус и лёгкий зум. Неподдержанные ключи браузер игнорирует.
        const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
        const advanced: Record<string, unknown>[] = [];
        if ("focusMode" in caps) advanced.push({ focusMode: "continuous" });
        const fd = caps["focusDistance"] as { min?: number } | undefined;
        if (fd && typeof fd.min === "number") advanced.push({ focusDistance: fd.min });
        const zoom = caps["zoom"] as { min?: number; max?: number } | undefined;
        if (zoom && typeof zoom.max === "number" && typeof zoom.min === "number") {
          advanced.push({ zoom: Math.min(zoom.max, Math.max(zoom.min, 1.5)) });
        }
        if (advanced.length) {
          await track
            .applyConstraints({ advanced } as MediaTrackConstraints)
            .catch(() => undefined);
        }
        // Трек «умирает» после блокировки экрана или звонка — предлагаем перезапуск.
        track.addEventListener("ended", () => setPaused(true));
        track.addEventListener("mute", () => setPaused(true));
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (e) {
      const name = (e as { name?: string })?.name ?? "";
      const isDenied = name === "NotAllowedError" || name === "SecurityError";
      setDenied(isDenied);
      setCamError(
        isDenied
          ? "Доступ к камере запрещён системными настройками"
          : name === "InsecureContextError"
            ? "Камера работает только по защищённому соединению (HTTPS)"
            : name === "NotReadableError"
              ? "Камера занята другим приложением"
              : "Камера не обнаружена",
      );

    }
  }, []);

  const shakeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(shakeTimer.current), []);

  useEffect(() => {
    setDesktop(detectDesktop());
  }, []);

  const cameraMode = !desktop || wantCamera;

  useEffect(() => {
    if (!open) {
      stop();
      setResult(null);
      setCamError(null);
      setSize("");
      setReverse(false);
      setDenied(false);
      setPaused(false);
      setFrozen(null);
      setPreview(null);

      setWantCamera(false);
      return;
    }
    if (cameraMode) void start();

    // Блокировка экрана обрывает трек: при возврате поднимаем поток заново,
    // иначе вместо видео остаётся замерший кадр.
    const onVisible = () => {
      if (document.visibilityState !== "visible") {
        // Ушли в фон — гасим камеру, чтобы зелёный индикатор не горел впустую.
        if (streamRef.current) {
          stop();
          setPaused(true);
        }
        return;
      }
      if (!cameraMode) return;
      const live = streamRef.current?.getVideoTracks().some((t) => t.readyState === "live");
      if (!live) {
        stop();
        void start();
      } else {
        void videoRef.current?.play().catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    // Уход со страницы в bfcache — тоже повод убить поток.
    window.addEventListener("pagehide", stop);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("pagehide", stop);
      document.body.style.overflow = prevOverflow;
      stop();
    };
  }, [open, cameraMode, start, stop, onClose]);

  /** Переключение основная ↔ фронтальная камера. */
  const flipCamera = () => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    facingRef.current = next;
    stop();
    void start();
  };

  const analyze = async (image: string) => {
    setBusy(true);
    setFatal(null);
    setShake(null);
    setClarified(null);
    try {
      const res = await fetch("/api/vision/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не удалось распознать деталь");
      const data = json as Result;
      setResult(data);
      setSize("");
      // Сценарии «переснимите» — камеру не глушим, клиент повторит кадр.
      if (data.scenario !== "invalid" && data.scenario !== "lowlight") stop();
      else setFrozen(null);
    } catch (e) {
      setFrozen(null);
      const message = e instanceof Error ? e.message : "Ошибка распознавания";
      setFatal(`${message}. Попробуйте загрузить другое фото или повторить попытку.`);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  /** Загрузка картинки с диска/галереи — основной сценарий для ПК и для отказа в доступе. */
  const pickFile = async (file: File | undefined | null) => {
    if (!file) return;
    setFatal(null);
    setShake(null);
    setResult(null);
    setPreview(null);
    const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
    if (!file.type.startsWith("image/") && !heic) {
      const m = "Нужен файл изображения: JPG, PNG, WEBP или HEIC";
      setFatal(m);
      toast.error(m);
      return;
    }
    const decoded = await decodeImageFile(file);
    if (!decoded) {
      const m = heic
        ? "Браузер не открывает HEIC. Сохраните фото в JPG (Настройки → Камера → «Наиболее совместимый») и повторите"
        : "Не удалось прочитать изображение";
      setFatal(m);
      toast.error(m);
      return;
    }

    // Сжимаем на клиенте: 800×800 WebP вместо 4K/8 МБ — иначе на 3G ответа не дождаться.
    const prepared = compress(decoded.source, decoded.width, decoded.height);
    setFrozen(prepared.dataUrl);
    // Превью загруженного файла живёт независимо от статуса анализа:
    // клиент должен видеть, что именно он отправил, даже при ошибке.
    setPreview(prepared.dataUrl);

    const stats = frameStats(decoded.source, decoded.width, decoded.height);
    const hint = lowLightHint(stats);
    if (hint) {
      setFrozen(null);
      setResult(null);
      setShake(hint);
      window.clearTimeout(shakeTimer.current);
      shakeTimer.current = window.setTimeout(() => setShake(null), 4000);
      toast.error(hint);
      return;
    }
    await analyze(prepared.dataUrl);
  };

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    // Кроп строго по центральной рамке видоискателя: нейросеть получает деталь,
    // а не стол, руки, чертежи и кружку кофе на фоне.
    const side = Math.round(Math.min(video.videoWidth, video.videoHeight) * 0.72);
    const sx = Math.round((video.videoWidth - side) / 2);
    const sy = Math.round((video.videoHeight - side) / 2);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    canvas.getContext("2d")?.drawImage(video, sx, sy, side, side, 0, 0, side, side);

    const stats = frameStats(canvas, side, side);
    const problem =
      stats.sharpness < BLUR_THRESHOLD ? "Зафиксируйте камеру — кадр смазан" : lowLightHint(stats);
    if (problem) {
      setShake(problem);
      window.clearTimeout(shakeTimer.current);
      shakeTimer.current = window.setTimeout(() => setShake(null), 4000);
      return;
    }

    const prepared = compress(canvas, side, side);
    setFrozen(prepared.dataUrl);
    setPreview(prepared.dataUrl);
    await analyze(prepared.dataUrl);
  };

  const retry = () => {
    setResult(null);
    setFrozen(null);
    setPreview(null);
    void start();
  };


  const restart = () => {
    setPaused(false);
    stop();
    void start();
  };

  const sizeVariants = useMemo(
    () => (result?.scenario === "exact" ? result.variants : []),
    [result],
  );

  if (!open) return null;

  const showViewfinder =
    cameraMode &&
    !camError &&
    (!result || result.scenario === "invalid" || result.scenario === "lowlight");
  const showSheet = result && result.scenario !== "invalid" && result.scenario !== "lowlight";
  /** Явный Error State для ПК: «тихий» сброс к дропзоне запрещён. */
  const desktopError =
    fatal ??
    shake ??
    (result?.scenario === "invalid"
      ? "На фото не обнаружена фурнитура. Распознан посторонний объект. Пожалуйста, загрузите фото крепежа крупным планом."
      : result?.scenario === "lowlight"
        ? "Деталь сливается с фоном или снимок слишком тёмный. Положите деталь на светлый лист бумаги и загрузите фото ещё раз."
        : null);

  return (
    <div
      className="fixed inset-0 z-50 bg-[oklch(0.16_0.01_264)]"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void pickFile(e.dataTransfer.files?.[0]);
      }}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-6 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-white/70 bg-black/50 text-center text-white">
          <div>
            <ImageUp className="mx-auto size-8" strokeWidth={1.5} />
            <p className="mt-2 text-sm font-semibold">Отпустите фото — распознаем деталь</p>
            <p className="text-xs text-white/70">JPG, PNG, WEBP, HEIC · сжимаем на вашем компьютере</p>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Закрыть сканер"
        className="absolute right-4 top-4 z-20 grid size-11 cursor-pointer place-items-center rounded-full bg-black/50 text-white"
        style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
      >
        <X className="size-5" strokeWidth={2} />
      </button>

      {showViewfinder && (
        <button
          type="button"
          onClick={flipCamera}
          aria-label="Переключить камеру"
          className="absolute left-4 z-20 grid size-11 cursor-pointer place-items-center rounded-full bg-black/50 text-white"
          style={{ top: "calc(1rem + env(safe-area-inset-top))" }}
        >
          <SwitchCamera className="size-5" strokeWidth={2} />
        </button>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Сбрасываем значение: иначе повторный выбор того же файла
          // не вызывает onChange и кнопка выглядит «мёртвой».
          e.target.value = "";
          void pickFile(file);
        }}
      />


      {/* ПК без камеры: зона Drag & Drop, лоадер анализа и явный Error State. */}
      {cameraMode === false && !showSheet && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
          {busy ? (
            <div className="w-full max-w-[560px] rounded-2xl border border-white/15 bg-white/5 p-8">
              {frozen && (
                <img
                  src={frozen}
                  alt="Загруженный кадр детали"
                  className="mx-auto mb-6 size-40 rounded-xl object-cover"
                />
              )}
              <p className="flex items-center justify-center gap-3 text-base font-semibold text-white">
                <Loader2 className="size-5 animate-spin" strokeWidth={2} />
                Нейросеть анализирует геометрию…
              </p>
              <p className="mt-2 text-xs text-white/60">
                Тяжёлые снимки обрабатываются дольше — не закрывайте окно.
              </p>
              <div className="mt-6 space-y-2" aria-hidden>
                <span className="block h-3 w-full animate-pulse rounded bg-white/10" />
                <span className="block h-3 w-4/5 animate-pulse rounded bg-white/10" />
                <span className="block h-3 w-2/3 animate-pulse rounded bg-white/10" />
              </div>
            </div>
          ) : desktopError ? (
            <div className="w-full max-w-[560px] rounded-2xl border border-[#F59E0B]/60 bg-[#F59E0B]/12 p-8 text-left">
              <p className="flex items-start gap-3 text-base font-semibold leading-[1.5] text-white">
                <TriangleAlert className="mt-0.5 size-6 shrink-0 text-[#FBBF24]" strokeWidth={2} />
                {desktopError}
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setShake(null);
                    setFatal(null);
                    fileRef.current?.click();
                  }}
                  className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground"
                >
                  <ImageUp className="size-4" strokeWidth={1.75} />
                  Загрузить другое фото
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setResult(null);
                    setShake(null);
                    setFatal(null);
                    setFrozen(null);
                  }}
                  className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-white/30 px-6 text-sm font-semibold text-white"
                >
                  <RefreshCw className="size-4" strokeWidth={1.75} />
                  Начать заново
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full max-w-[560px] rounded-2xl border-2 border-dashed border-white/35 bg-white/5 px-8 py-14">
              <Monitor className="mx-auto size-10 text-white/70" strokeWidth={1.5} />
              <h2 className="mt-4 text-xl font-bold text-white">
                Перетащите фото детали сюда или выберите файл на компьютере
              </h2>
              <p className="mx-auto mt-2 max-w-[46ch] text-sm leading-[1.6] text-white/70">
                Подойдёт снимок с телефона: сожмём его прямо в браузере до 800×800 и отправим на
                распознавание. JPG, PNG, WEBP, HEIC.
              </p>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-6 inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-primary px-8 py-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02]"
              >
                <ImageUp className="size-4" strokeWidth={1.75} />
                Выбрать файл на компьютере
              </button>
              <button
                type="button"
                onClick={() => setWantCamera(true)}
                className="mt-4 block w-full cursor-pointer text-xs text-white/55 underline underline-offset-4 hover:text-white"
              >
                У меня есть веб-камера — включить съёмку
              </button>
            </div>
          )}
        </div>
      )}


      {cameraMode && camError && !showSheet && (
        <div className="flex h-full w-full flex-col items-center justify-center gap-5 px-6 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-white/10 text-white">
            <CameraOff className="size-8" strokeWidth={1.5} />
          </span>
          <p className="max-w-[46ch] text-base leading-[1.6] text-white/85">
            {denied
              ? "Доступ к камере запрещён системными настройками. Чтобы ИИ смог распознать деталь, разрешите доступ к камере в настройках браузера либо загрузите готовое фото из галереи."
              : `${camError}. Загрузите фото из галереи — распознавание работает и по снимку.`}
          </p>
          {denied && (
            <div className="max-w-[46ch] rounded-md bg-white/10 p-4 text-left text-xs leading-[1.6] text-white/75">
              <p className="mb-2 font-semibold text-white">Как включить камеру</p>
              <p>
                <b>iPhone (Safari):</b> «Настройки» → Safari → «Камера» → «Разрешить», затем
                обновите страницу.
              </p>
              <p className="mt-1.5">
                <b>Android (Chrome):</b> значок замка в адресной строке → «Разрешения» → «Камера»
                → «Разрешить».
              </p>
              <p className="mt-1.5">
                <b>Компьютер:</b> значок камеры справа в адресной строке → «Всегда разрешать».
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="flex min-h-[56px] w-full max-w-[420px] cursor-pointer items-center justify-center gap-3 rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="size-5 animate-spin" strokeWidth={2} />
            ) : (
              <ImageUp className="size-5" strokeWidth={1.75} />
            )}
            {busy ? "Нейросеть анализирует геометрию…" : "Выбрать файл"}
          </button>
          <button
            type="button"
            onClick={() => void start()}
            className="min-h-[44px] cursor-pointer rounded-full border border-white/25 px-6 text-sm font-semibold text-white"
          >
            Повторить запрос доступа
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] cursor-pointer text-xs text-white/60 underline underline-offset-4 hover:text-white"
          >
            Закрыть сканер
          </button>
        </div>
      )}

      {showViewfinder && (
        <>
          <video
            ref={videoRef}
            playsInline
            muted
            className="h-full w-full object-cover opacity-90"
          />

          {/* Snap-and-Send: кадр замирает, поверх него — статус нейросети */}
          {frozen && (
            <div className="absolute inset-0 z-10">
              <img src={frozen} alt="Снятый кадр детали" className="h-full w-full object-cover" />
              <div className="absolute inset-0 grid place-items-center bg-black/55 text-center">
                <p className="flex items-center gap-3 text-sm font-semibold text-white">
                  <Loader2 className="size-5 animate-spin" strokeWidth={2} />
                  Нейросеть анализирует геометрию…
                </p>
              </div>
            </div>
          )}

          {/* Поток «умер» после блокировки экрана или звонка */}
          {paused && !frozen && (
            <div className="absolute inset-0 z-10 grid place-items-center bg-black/70 px-6 text-center">
              <button
                type="button"
                onClick={restart}
                className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-full bg-primary px-8 py-4 text-base font-semibold text-primary-foreground"
              >
                <PlayCircle className="size-5" strokeWidth={2} />
                Камера приостановлена. Нажмите для перезапуска
              </button>
            </div>
          )}

          {/* Тёмная маска с прозрачным окном видоискателя */}
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[58vw] max-h-[420px] w-[58vw] max-w-[420px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-sm shadow-[0_0_0_100vmax_oklch(0_0_0/0.62)]"
            aria-hidden
          >
            {busy && <span className="scan-beam" />}
          </div>
          {/* Прицел с перекрестием */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute left-1/2 top-1/2 h-[58vw] max-h-[420px] w-[58vw] max-w-[420px] -translate-x-1/2 -translate-y-1/2"
            aria-hidden
          >
            <path
              d="M2 22V2h20M78 2h20v20M98 78v20H78M22 98H2V78"
              fill="none"
              stroke="#E52421"
              strokeWidth="2.5"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d="M50 44v12M44 50h12"
              fill="none"
              stroke="#E52421"
              strokeOpacity="0.8"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {shake && (
            <div className="pointer-events-none absolute left-1/2 top-[16%] z-10 w-[86%] max-w-[420px] -translate-x-1/2 rounded-md bg-black/80 px-5 py-3 text-center text-sm font-semibold text-white">
              {shake}
            </div>
          )}

          {/* Out-of-Distribution: ботинок, палец, гаечный ключ */}
          {result?.scenario === "invalid" && (
            <div className="absolute inset-x-4 top-[10%] z-20 rounded-md bg-primary p-4 text-primary-foreground">
              <p className="flex items-start gap-2 text-sm leading-[1.5]">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
                <span>
                  На фото не обнаружена мебельная фурнитура или пластиковые комплектующие
                  ALMAFORT. Пожалуйста, сделайте более чёткий снимок детали.
                </span>
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-3 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-sm bg-white/15 text-sm font-semibold"
              >
                <RefreshCw className="size-4" strokeWidth={2} />
                Переснять
              </button>
            </div>
          )}

          {/* Тёмный цех / чёрное на чёрном */}
          {result?.scenario === "lowlight" && (
            <div className="absolute inset-x-4 top-[10%] z-20 rounded-md bg-[#F59E0B] p-4 text-[oklch(0.25_0.05_70)]">
              <p className="flex items-start gap-2 text-sm leading-[1.5]">
                <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
                <span>
                  Деталь сливается с фоном или недостаточно освещена. Пожалуйста, положите деталь
                  на светлый лист бумаги, включите вспышку и повторите снимок.
                </span>
              </p>
              <button
                type="button"
                onClick={retry}
                className="mt-3 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-sm bg-black/15 text-sm font-semibold"
              >
                <RefreshCw className="size-4" strokeWidth={2} />
                Переснять
              </button>
            </div>
          )}

          <div
            className="absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-4 p-8"
            style={{ paddingBottom: "calc(2rem + env(safe-area-inset-bottom))" }}
          >
            <p className="max-w-[42ch] text-center text-xs leading-[1.5] text-white/75">
              Поместите деталь в центр рамки. Желательно на светлый однотонный фон (лист бумаги).
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={capture}
                disabled={busy || paused}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full bg-primary px-8 py-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] disabled:opacity-50"
              >
                {busy && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
                {busy ? "Анализируем кадр…" : "Сделать фото"}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-full border border-white/30 px-6 py-4 text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:opacity-50"
              >
                <ImageUp className="size-4" strokeWidth={1.75} />
                Фото из галереи
              </button>
              <p className="hidden w-full text-center text-xs text-white/60 lg:block">
                Или перетащите файл фотографии детали прямо в это окно
              </p>
            </div>
          </div>
        </>
      )}

      {showSheet && result && (
        <div
          data-bottom-sheet
          className="absolute inset-x-0 bottom-0 max-h-[88dvh] overflow-y-auto rounded-t-2xl bg-card p-6 motion-safe:animate-[slide-in-bottom_0.28s_ease-out]"
          style={{
            paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))",
            ...(swipe.sheetStyle ?? {}),
          }}
        >
          <div className="sheet-grabber -mt-3 mb-1" aria-hidden {...swipe.handleProps} />

          {result.scenario === "exact" && (
            <>
              <h3 className="text-lg font-bold text-foreground">
                Распознана: {result.category}
              </h3>
              <p className="mt-1 text-sm leading-[1.6] text-muted-foreground">
                Уверенность {Math.round(result.verdict.confidence * 100)}%. Размер по фотографии не
                определяется — выберите ваш размер профиля:
              </p>
              {/* Размерные чипы: клик — и клиент сразу в конкретном артикуле */}
              <div className="mt-4 flex flex-wrap gap-2">
                {sizeVariants.map((v) => (
                  <button
                    key={v.sku}
                    type="button"
                    onClick={() => setSize(v.sku)}
                    aria-pressed={size === v.sku}
                    className={`min-h-[44px] cursor-pointer rounded-full border px-4 text-sm font-semibold transition-colors ${
                      size === v.sku
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-foreground hover:border-primary hover:text-primary"
                    }`}
                  >
                    {v.dims || v.sku}
                  </button>
                ))}
                {sizeVariants.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Размерный ряд не найден — отправьте фото менеджеру, подберём вручную.
                  </p>
                )}
              </div>
              {size && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {sizeVariants.find((v) => v.sku === size)?.name} ({size}) ·{" "}
                  <b className="text-foreground">
                    {formatPrice(sizeVariants.find((v) => v.sku === size)?.price ?? 0)}
                  </b>
                </p>
              )}
              <button
                type="button"
                disabled={!size}
                onClick={() => {
                  addLine(size, 1);
                  toast.success(`${size} добавлен в корзину`);
                  onClose();
                }}
                className="mt-4 min-h-[44px] w-full cursor-pointer rounded-sm bg-primary py-3.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
              >
                В корзину
              </button>
            </>
          )}

          {result.scenario === "ambiguous" && (
            <>
              <h3 className="text-lg font-bold leading-[1.35] text-foreground">
                {result.question ?? "Найдено несколько совпадений. Выберите подходящий вариант:"}
              </h3>
              {result.verdict.markers.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  ИИ увидел: {result.verdict.markers.join(", ")}
                </p>
              )}
              <ul className="mt-5 space-y-3">
                {result.matches.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    Совпадений не найдено — пришлите фото менеджеру, подберём вручную.
                  </li>
                )}
                {result.matches.map((m) => (
                  <li
                    key={m.sku}
                    className="flex items-center gap-4 rounded-md border border-border p-4"
                  >
                    <span className="grid size-14 shrink-0 place-items-center rounded-sm bg-surface text-xs font-semibold text-muted-foreground">
                      {m.sku.slice(0, 2)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-foreground">{m.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {m.sku} · {m.dims} ·{" "}
                        {m.stock > 0
                          ? `${m.stock.toLocaleString("ru-RU")} шт на складе`
                          : "под заказ"}
                      </span>
                      <span className="mt-1 block text-sm font-bold tabular-nums text-foreground">
                        {formatPrice(m.price)}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        addLine(m.sku, 1);
                        toast.success(`${m.sku} добавлен в корзину`);
                      }}
                      className="min-h-[44px] shrink-0 cursor-pointer rounded-sm bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
                    >
                      В корзину
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.scenario === "clarify" && (
            <>
              <div className="rounded-md border border-[#F59E0B] bg-[oklch(0.97_0.06_90)] p-4">
                <h3 className="flex items-start gap-2 text-base font-bold leading-[1.4] text-[oklch(0.35_0.08_70)]">
                  <TriangleAlert className="mt-0.5 size-5 shrink-0" strokeWidth={2} />
                  {result.question ??
                    "Деталь распознана неточно. Уточните категорию — артикул подберём после вашего выбора:"}
                </h3>
                <p className="mt-2 text-xs text-[oklch(0.45_0.06_70)]">
                  Уверенность модели {Math.round(result.verdict.confidence * 100)}% — этого мало,
                  чтобы назвать артикул. Гадать не будем.
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {result.groups.map((g) => (
                  <button
                    key={g.category}
                    type="button"
                    onClick={() => setClarified(g.category)}
                    aria-pressed={clarified === g.category}
                    className={`min-h-[44px] cursor-pointer rounded-full border px-4 text-sm font-semibold ${
                      clarified === g.category
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border text-foreground hover:bg-surface"
                    }`}
                  >
                    {g.category}
                  </button>
                ))}
              </div>

              {clarified && (
                <ul className="mt-5 space-y-3">
                  {(result.groups.find((g) => g.category === clarified)?.items ?? []).map((m) => (
                    <li
                      key={m.sku}
                      className="flex items-center gap-4 rounded-md border border-border p-4"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-foreground">
                          {m.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {m.sku} · {m.dims} ·{" "}
                          {m.stock > 0
                            ? `${m.stock.toLocaleString("ru-RU")} шт на складе`
                            : "под заказ"}
                        </span>
                        <span className="mt-1 block text-sm font-bold tabular-nums text-foreground">
                          {formatPrice(m.price)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          addLine(m.sku, 1);
                          toast.success(`${m.sku} добавлен в корзину`);
                        }}
                        className="min-h-[44px] shrink-0 cursor-pointer rounded-sm bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90"
                      >
                        В корзину
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {result.scenario === "foreign" && (
            <div className="rounded-md border border-[#F59E0B] bg-[oklch(0.97_0.06_90)] p-5">
              <h3 className="text-lg font-bold leading-[1.35] text-[oklch(0.35_0.08_70)]">
                В нашем стандартном каталоге нет точного совпадения с вашей деталью
              </h3>
              <p className="mt-2 text-sm leading-[1.6] text-[oklch(0.4_0.06_70)]">
                Однако мы видим, что это сложная полимерная форма
                {result.verdict.observed ? ` (${result.verdict.observed})` : ""}. Мы специализируемся
                на воссоздании таких узлов: передадим фото в инженерный отдел и оценим стоимость
                3D-печати или литья под давлением.
              </p>
              <button
                type="button"
                onClick={() => setReverse(true)}
                className="mt-4 min-h-[44px] w-full cursor-pointer rounded-sm bg-primary py-3.5 text-sm font-semibold text-primary-foreground"
              >
                Рассчитать производство
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={retry}
            className="mt-4 flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-sm border border-[#D1D5DB] py-3 text-sm font-semibold text-foreground hover:border-primary hover:text-primary"
          >
            <RefreshCw className="size-4" strokeWidth={1.75} />
            Сканировать ещё раз
          </button>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 min-h-[44px] w-full cursor-pointer text-sm font-semibold text-muted-foreground hover:text-foreground"
          >
            Закрыть
          </button>
        </div>
      )}

      {reverse && (
        <QuoteRequestModal
          sku="REVERSE-ENG"
          name="Реверс-инжиниринг детали по фото"
          onClose={() => setReverse(false)}
        />
      )}
    </div>
  );
}
