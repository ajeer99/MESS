import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { useApp } from "../app-context";
import {
  currentMonthKey, expensesInMonth, monthKeyAdd, monthLabel, paceProjection, totalsByCategory,
  totalsByMerchant, totalPaise,
} from "../compute";
import { formatINR, formatINRCompact } from "../money";
import { ExpenseRow } from "../components/ExpenseRow";
import { InviteCard } from "../components/InviteCard";
import { EmptyState, MonthStepper } from "../components/ui-bits";
import { parseShares } from "../types";
import { cn } from "@/lib/utils";

const DONUT_COLORS = ["#0d9488", "#d97706", "#475569", "#e11d48", "#7c3aed", "#0284c7", "#65a30d", "#9333ea"];

export function Dashboard() {
  const { data, loading, session, openAdd, openSettle } = useApp();
  const [month, setMonth] = useState(currentMonthKey());
  const partners = data?.partners ?? [];
  const expenses = data?.expenses ?? [];
  const me = session.partner;
  const isCurrentMonth = month === currentMonthKey();

  const monthExpenses = useMemo(() => expensesInMonth(expenses, month), [expenses, month]);
  const monthTotal = useMemo(() => totalPaise(monthExpenses), [monthExpenses]);
  const prevMonthTotal = useMemo(
    () => totalPaise(expensesInMonth(expenses, monthKeyAdd(month, -1))),
    [expenses, month],
  );
  const debts = data?.debts ?? [];
  const myDebt = debts.find((d) => d.fromId === me.id);

  const myShare = useMemo(() => {
    return monthExpenses.reduce((sum, e) => {
      const sh = parseShares(e);
      return sum + (sh[me.id] ?? 0);
    }, 0);
  }, [monthExpenses, me.id]);

  const categories = useMemo(() => totalsByCategory(monthExpenses).slice(0, 6), [monthExpenses]);
  const topMerchants = useMemo(() => totalsByMerchant(monthExpenses).slice(0, 3), [monthExpenses]);
  const recent = useMemo(() => expenses.slice(0, 8), [expenses]);
  const projection = isCurrentMonth ? paceProjection(monthTotal, month) : null;
  const monthDays = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const today = new Date();
  const dayNow = isCurrentMonth ? today.getDate() : monthDays;
  const pacePercent = isCurrentMonth ? Math.round((dayNow / monthDays) * 100) : 100;

  if (loading && !data) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Invite the partner while nobody has joined yet */}
      {partners.length < 2 && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="space-y-3 p-4">
            <div>
              <p className="text-sm font-semibold">Invite your partner</p>
              <p className="text-xs text-muted-foreground">
                Until they join, everything you add is recorded as your own spending. 50/50 splits start when they create their account.
              </p>
            </div>
            <InviteCard compact />
          </CardContent>
        </Card>
      )}

      {/* Debts summary */}
      {debts.length > 0 ? (
        <div className="space-y-2">
          {debts.map((debt) => {
            const isMyDebt = debt.fromId === me.id;
            return (
              <Card
                key={`${debt.fromId}-${debt.toId}`}
                className={cn(
                  "border-0 text-white cursor-pointer",
                  isMyDebt
                    ? "bg-slate-800"
                    : "bg-teal-800",
                )}
                onClick={openSettle}
              >
                <CardContent className="flex items-center gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-white/80">
                      {isMyDebt ? `You owe ${debt.toName}` : `${debt.fromName} owes ${debt.toName === me.name ? "you" : debt.toName}`}
                    </p>
                    <p className="text-2xl font-bold tabular-nums">{formatINR(debt.amountPaise)}</p>
                  </div>
                  <Button variant="secondary" className="shrink-0 bg-white text-slate-900 hover:bg-slate-100" onClick={(e) => { e.stopPropagation(); openSettle(); }}>
                    Settle
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-0 bg-teal-800 text-white">
          <CardContent className="p-5">
            <p className="text-xs font-medium uppercase tracking-wide text-white/80">Balance</p>
            <p className="text-2xl font-bold">All settled up</p>
            <p className="text-xs text-white/80">Everyone is square.</p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <MonthStepper month={month} onChange={setMonth} min={data ? monthKeyAdd(data.range.from.slice(0, 7), 0) : undefined} max={currentMonthKey()} />
        <Button variant="outline" size="sm" onClick={openAdd} className="md:hidden">+ Add</Button>
      </div>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{monthLabel(month)} · shared spending</p>
              <p className="text-3xl font-bold tabular-nums">{formatINR(monthTotal)}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <p>{monthExpenses.length} expense{monthExpenses.length === 1 ? "" : "s"}</p>
              {prevMonthTotal > 0 && (
                <p className={monthTotal <= prevMonthTotal ? "text-emerald-600" : "text-rose-600"}>
                  {monthTotal <= prevMonthTotal ? "▼" : "▲"} {formatINRCompact(Math.abs(monthTotal - prevMonthTotal))} vs {monthLabel(monthKeyAdd(month, -1))}
                </p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Your share</p>
              <p className="text-lg font-semibold tabular-nums">{formatINR(myShare)}</p>
            </div>
            <div className="rounded-xl bg-muted/60 p-3">
              <p className="text-xs text-muted-foreground">Total expenses</p>
              <p className="text-lg font-semibold tabular-nums">{formatINR(monthTotal)}</p>
            </div>
          </div>
          {projection !== null && isCurrentMonth && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Pace for month end: <span className="font-semibold text-foreground">{formatINRCompact(projection)}</span></span>
                <span>day {dayNow} / {monthDays}</span>
              </div>
              <Progress value={pacePercent} className="h-1.5" />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="mb-3 text-sm font-semibold">What it went on</p>
            {categories.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing this month yet.</p>
            ) : (
              <div className="flex items-center gap-4">
                <div className="h-36 w-36 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categories}
                        dataKey="totalPaise"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={68}
                        paddingAngle={2}
                        strokeWidth={0}
                      >
                        {categories.map((entry, i) => (
                          <Cell key={entry.name} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {categories.slice(0, 5).map((c, i) => (
                    <div key={c.name} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto shrink-0 font-medium tabular-nums">{formatINRCompact(c.totalPaise)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <p className="mb-3 text-sm font-semibold">Top places</p>
            {topMerchants.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing this month yet.</p>
            ) : (
              <div className="space-y-2.5">
                {topMerchants.map((m, i) => (
                  <div key={m.name} className="flex items-center gap-3 text-sm">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">{i + 1}</span>
                    <span className="truncate">{m.name}</span>
                    <span className="ml-auto shrink-0 font-medium tabular-nums">{formatINR(m.totalPaise)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-2 sm:p-4">
          <div className="flex items-center justify-between px-2 pb-1 pt-2">
            <p className="text-sm font-semibold">Recent activity</p>
          </div>
          {recent.length === 0 ? (
            <div className="p-2">
              <EmptyState
                title="No expenses yet"
                hint={
                  partners.length >= 2
                    ? `Tap + to add the first one, ${me.name}. It splits equally by default.`
                    : `Tap + to add your first expense, ${me.name}. It's recorded as yours until your partner joins.`
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {recent.map((e) => <ExpenseRow key={e.id} expense={e} showDate />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
