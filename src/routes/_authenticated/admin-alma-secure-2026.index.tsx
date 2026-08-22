import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { adminListOrders } from "@/lib/admin.functions";
import { ADMIN_BASE, STATUS_COLOR } from "@/lib/admin";
import { STAGES } from "@/lib/loyalty";
import { formatPrice } from "@/lib/pricing";

export const Route = createFileRoute("/_authenticated/admin-alma-secure-2026/")({
  component: OrdersRegistry,
});

function OrdersRegistry() {
  const list = useServerFn(adminListOrders);
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");

  const { data, isFetching } = useQuery({
    queryKey: ["admin-orders", page, status, q, from],
    queryFn: () =>
      list({
        data: {
          page,
          ...(status ? { status } : {}),
          ...(q ? { q } : {}),
          ...(from ? { from: new Date(from).toISOString() } : {}),
        },
      }),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const pages = data ? Math.ceil(data.count / data.pageSize) : 0;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="mr-auto text-2xl font-bold">Реестр заказов</h1>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Номер заказа"
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        >
          <option value="">Все статусы</option>
          {STAGES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
          className="rounded-md border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Номер</th>
              <th className="px-4 py-3">Дата</th>
              <th className="px-4 py-3">Статус</th>
              <th className="px-4 py-3">Город</th>
              <th className="px-4 py-3 text-right">Сумма</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {(data?.rows ?? []).map((o) => (
              <tr
                key={o.id}
                onClick={() =>
                  void navigate({
                    to: "/admin-alma-secure-2026/orders/$orderId",
                    params: { orderId: o.id },
                  })
                }
                className="cursor-pointer border-t transition-colors hover:bg-muted/50"
              >
                <td className="px-4 py-3 font-medium">{o.number}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(o.created_at).toLocaleDateString("ru-RU")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs ${
                      STATUS_COLOR[o.status] ?? "bg-muted"
                    }`}
                  >
                    {STAGES.find((s) => s.id === o.status)?.title ?? o.status}
                  </span>
                </td>
                <td className="px-4 py-3">{o.city || "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatPrice(Number(o.total))}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to="/admin-alma-secure-2026/orders/$orderId"
                    params={{ orderId: o.id }}
                    className="rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-muted"
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
            {!isFetching && !data?.rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  Заказов не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <button
          disabled={page === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="rounded-md border px-3 py-1.5 transition-colors hover:bg-muted disabled:opacity-40"
        >
          Назад
        </button>
        <span className="text-muted-foreground">
          Стр. {page + 1} из {Math.max(1, pages)} · всего {data?.count ?? 0}
        </span>
        <button
          disabled={page + 1 >= pages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-md border px-3 py-1.5 transition-colors hover:bg-muted disabled:opacity-40"
        >
          Вперёд
        </button>
      </div>
    </section>
  );
}
