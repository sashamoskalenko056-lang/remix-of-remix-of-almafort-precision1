import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, FileDown } from "lucide-react";
import { toast } from "sonner";
import { SiteHeader } from "@/components/site-header";
import { generateInvoicePdfInBrowser } from "@/lib/pdf-browser";
import { readLastOrder, type LastOrder } from "@/lib/last-order";
import { isAuthed } from "@/lib/session";


export const Route = createFileRoute("/success")({
  head: () => ({
    meta: [
      { title: "Заказ оформлен — ALMAFORT" },
      {
        name: "description",
        content:
          "Заказ принят в работу: счёт передан в отдел отгрузки ALMAFORT, менеджер свяжется для подтверждения условий и сроков.",
      },
      { property: "og:title", content: "Заказ оформлен — ALMAFORT" },
      {
        property: "og:description",
        content: "Счёт сформирован и передан в отдел отгрузки. Менеджер свяжется для подтверждения.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: SuccessPage,
});

function SuccessPage() {
  // sessionStorage читаем после гидрации, чтобы SSR и клиент совпали.
  const [order, setOrder] = useState<LastOrder | null>(null);
  const [authed, setAuthed] = useState(false);
  useEffect(() => setOrder(readLastOrder()), []);
  useEffect(() => {
    setAuthed(isAuthed());
  }, []);


  const downloadCopy = async () => {
    if (!order) return;
    try {
      await generateInvoicePdfInBrowser({
        lines: order.lines,
        carrier: order.carrier,
        city: order.city,
        delivery: order.delivery,
      });
    } catch {
      toast.error("Не удалось сформировать копию счёта");
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="w-full flex-1 mx-auto max-w-[720px] px-5 pb-24 pt-20 lg:px-10">
        <CheckCircle2 className="size-14 text-primary" strokeWidth={1.5} />
        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-foreground lg:text-[40px]">
          Заказ успешно оформлен
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          Ваш счёт{" "}
          {order ? (
            <button
              type="button"
              onClick={downloadCopy}
              className="inline-flex cursor-pointer items-center gap-1 font-semibold text-primary underline underline-offset-4"
            >
              <FileDown className="size-4" strokeWidth={2} /> Скачать копию
            </button>
          ) : (
            <span className="font-semibold text-foreground">отправлен</span>
          )}{" "}
          отправлен на почту и передан в отдел отгрузки. Мы свяжемся с вами для подтверждения.
        </p>

        {order && (
          <dl className="mt-10 grid gap-3 rounded-lg bg-[#F8F9FA] p-6 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Номер заказа</dt>
              <dd className="font-semibold text-foreground">{order.orderId}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Позиций</dt>
              <dd className="tabular-nums text-foreground">{order.lines.length}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Доставка</dt>
              <dd className="text-foreground">
                {order.carrier === "pickup"
                  ? "Самовывоз, Дивногорск, Нижний проезд 15/1"
                  : `${order.carrier === "cdek" ? "СДЭК" : "Деловые Линии"}${order.city ? `, ${order.city}` : ""}`}
              </dd>
            </div>
            <div className="flex justify-between border-t border-border pt-3">
              <dt className="font-semibold text-foreground">Итого к оплате</dt>
              <dd className="text-lg font-extrabold tabular-nums text-foreground">
                {order.total.toLocaleString("ru-RU", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                ₽
              </dd>
            </div>
          </dl>
        )}

        <div className="mt-10 rounded-lg border border-primary/30 bg-primary/5 p-6">
          <p className="text-sm font-bold text-foreground">
            {authed
              ? "Заказ уже в вашем B2B-кабинете"
              : "Отслеживайте эту сделку в B2B-кабинете"}
          </p>
          <p className="mt-2 text-sm leading-[1.6] text-muted-foreground">
            {authed
              ? "Статусы от оплаты до двери, счёт и УПД, повтор закупки в один клик."
              : "Создайте пароль для этой почты — и получите сквозной трекинг заказа, архив документов и повтор закупки в один клик."}
          </p>
          <Link
            to={authed ? "/cabinet" : "/auth"}
            className="mt-4 inline-flex items-center rounded-sm bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200 hover:bg-[#B91C1C] hover:shadow-[0_8px_20px_oklch(0_0_0/0.18)] active:scale-[0.98]"
          >
            {authed ? "Открыть кабинет" : "Создать пароль и открыть кабинет"}
          </Link>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link
            to="/catalog"
            className="rounded-sm bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Вернуться в каталог
          </Link>
          <Link
            to="/"
            className="rounded-sm border border-[#D1D5DB] px-6 py-3 text-sm font-semibold text-foreground hover:border-primary hover:text-primary"
          >
            На главную
          </Link>
        </div>

      </main>
    </div>
  );
}
