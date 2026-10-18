import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useApp } from "../app-context";
import { currentMonthKey, monthKeyAdd, monthLabel } from "../compute";
import { formatINR } from "../money";
import { ExpenseRow } from "../components/ExpenseRow";
import { EmptyState, MonthStepper, PartnerAvatar } from "../components/ui-bits";
import { cn } from "@/lib/utils";

type PayerFilter = "all" | "me" | "them";

export function ExpensesView() {
  const { data, session, openAdd } = useApp();
  const partners = data?.partners ?? [];
  const other = partners.find((p) => p.id !== session.partner.id);
  const [month, setMonth] = useState(currentMonthKey());
  const [payer, setPayer] = useState<PayerFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = data?.expenses ?? [];
    list = list.filter((e) => e.expense_date.startsWith(month));
    if (payer === "me") list = list.filter((e) => e.paid_by === session.partner.id);
    if (payer === "them" && other) list = list.filter((e) => e.paid_by === other.id);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter((e) =>
        e.merchant.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) ||
        e.note.toLowerCase().includes(q));
    }
    return list;
  }, [data, month, payer, search, session.partner.id, other]);

  const grouped = useMemo(() => {
    const groups: { date: string; items: typeof filtered }[] = [];
    for (const e of filtered) {
      const last = groups[groups.length - 1];
      if (last && last.date === e.expense_date) last.items.push(e);
      else groups.push({ date: e.expense_date, items: [e] });
    }
    return groups;
  }, [filtered]);

  const monthTotal = filtered.reduce((sum, e) => sum + e.amount_paise, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthStepper month={month} onChange={setMonth} min={data ? monthKeyAdd(data.range.from.slice(0, 7), 0) : undefined} max={currentMonthKey()} />
        <Input
          placeholder="Search merchant, category, note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 max-w-52 flex-1"
        />
      </div>

      <div className="flex items-center gap-1.5">
        <span className="mr-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <PartnerAvatar partner={partners.find((p) => p.id === session.partner.id)} size="sm" />
        </span>
        {([["all", "Everyone"], ["me", "I paid"], ["them", `${other?.name ?? "Partner"} paid`]] as [PayerFilter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPayer(key)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors",
              payer === key ? "bg-primary text-primary-foreground ring-primary" : "text-muted-foreground ring-border hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-sm font-semibold tabular-nums">
          {filtered.length > 0 ? formatINR(monthTotal) : ""}
        </span>
      </div>

      {grouped.length === 0 ? (
        <EmptyState title="Nothing here" hint={`No expenses match in ${monthLabel(month)}.`} />
      ) : (
        <Card>
          <CardContent className="p-2 sm:p-4">
            {grouped.map((group) => (
              <div key={group.date} className="mb-2">
                <div className="flex items-baseline justify-between px-2 py-1.5">
                  <p className="text-xs font-semibold text-muted-foreground">{formatDate(group.date)}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatINR(group.items.reduce((sum, e) => sum + e.amount_paise, 0))}
                  </p>
                </div>
                <div className="divide-y divide-border/60">
                  {group.items.map((e) => <ExpenseRow key={e.id} expense={e} />)}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button variant="outline" className="w-full md:hidden" onClick={openAdd}>+ Add expense</Button>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
