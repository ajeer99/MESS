import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useApp } from "../app-context";
import {
  cumulativeNetSeries, currentMonthKey, expensesInMonth, monthKeyAdd, monthLabel, monthStatement,
  monthlySeries, partnerStats, totalsByCategory, totalsByMerchant, weekdayTotals, WEEKDAYS,
} from "../compute";
import { formatINR, formatINRCompact } from "../money";
import { MonthStepper, PartnerAvatar } from "../components/ui-bits";
import { cn } from "@/lib/utils";

const COLORS = ["#0d9488", "#d97706", "#475569", "#e11d48", "#7c3aed", "#0284c7", "#65a30d", "#9333ea"];

function ChartTooltip({ active, payload, label, formatter }: {
  active?: boolean;
  payload?: { value?: number | string; name?: string; payload?: Record<string, unknown> }[];
  label?: string;
  formatter: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="tabular-nums">
          {entry.name ? `${entry.name}: ` : ""}{formatter(Number(entry.value ?? 0))}
        </p>
      ))}
    </div>
  );
}

export function ReportsView() {
  const { data } = useApp();
  const [month, setMonth] = useState(currentMonthKey());
  const partners = data?.partners ?? [];
  const expenses = data?.expenses ?? [];
  const settlements = data?.settlements ?? [];
  const rangeMin = data ? monthKeyAdd(data.range.from.slice(0, 7), 0) : undefined;

  const monthExpenses = useMemo(() => expensesInMonth(expenses, month), [expenses, month]);
  const prevMonthExpenses = useMemo(() => expensesInMonth(expenses, monthKeyAdd(month, -1)), [expenses, month]);
  const merchants = useMemo(() => totalsByMerchant(monthExpenses).slice(0, 8), [monthExpenses]);
  const prevMerchants = useMemo(() => totalsByMerchant(prevMonthExpenses), [prevMonthExpenses]);
  const categories = useMemo(() => totalsByCategory(monthExpenses).slice(0, 6), [monthExpenses]);
  const prevCategories = useMemo(() => totalsByCategory(prevMonthExpenses), [prevMonthExpenses]);

  const months = useMemo(() => monthlySeries(expenses, currentMonthKey(), 13), [expenses]);
  const weekdays = useMemo(() => weekdayTotals(expenses), [expenses]);
  const cumulative = useMemo(
    () => cumulativeNetSeries(expenses, settlements, partners, currentMonthKey(), 13),
    [expenses, settlements, partners],
  );
  const stats = useMemo(() => partnerStats(expenses, partners), [expenses, partners]);
  const statement = useMemo(() => monthStatement(expenses, settlements, partners, month), [expenses, settlements, partners, month]);

  if (!data) {
    return <div className="space-y-3">{[0, 1].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <Tabs defaultValue="where">
        <TabsList className={cn("grid w-full", partners.length < 2 ? "grid-cols-4" : "grid-cols-5")}>
          <TabsTrigger value="where">Where</TabsTrigger>
          <TabsTrigger value="what">What</TabsTrigger>
          <TabsTrigger value="when">When</TabsTrigger>
          {partners.length >= 2 && <TabsTrigger value="who">Who</TabsTrigger>}
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>

        {/* -------------------------------------------------- WHERE */}
        <TabsContent value="where" className="space-y-4">
          <div className="flex items-center justify-between">
            <MonthStepper month={month} onChange={setMonth} min={rangeMin} max={currentMonthKey()} />
            <p className="text-sm font-semibold tabular-nums">
              {formatINR(monthExpenses.reduce((s, e) => s + e.amount_paise, 0))}
            </p>
          </div>
          {merchants.length === 0 ? (
            <EmptyCard label={`No spending recorded in ${monthLabel(month)}.`} />
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Top places · {monthLabel(month)}</CardTitle></CardHeader>
                <CardContent>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={merchants} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                        <XAxis type="number" tickFormatter={(v) => formatINRCompact(v)} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip formatter={formatINR} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                        <Bar dataKey="totalPaise" name="Spent" radius={[0, 6, 6, 0]}>
                          {merchants.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-0 sm:p-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Place</th>
                        <th className="px-3 py-2 text-right font-medium">Visits</th>
                        <th className="px-3 py-2 text-right font-medium">Avg</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">vs last month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {merchants.map((m, i) => {
                        const prev = prevMerchants.find((p) => p.name === m.name)?.totalPaise ?? 0;
                        const delta = m.totalPaise - prev;
                        return (
                          <tr key={m.name} className="border-b last:border-0">
                            <td className="px-3 py-2.5 text-muted-foreground tabular-nums">{i + 1}</td>
                            <td className="max-w-40 truncate px-3 py-2.5 font-medium">{m.name}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{m.count}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(m.avgPaise)}</td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatINR(m.totalPaise)}</td>
                            <td className={cn("px-3 py-2.5 text-right tabular-nums", prev === 0 ? "text-muted-foreground" : delta <= 0 ? "text-emerald-600" : "text-rose-600")}>
                              {prev === 0 ? "new" : `${delta <= 0 ? "▼" : "▲"} ${formatINRCompact(Math.abs(delta))}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* -------------------------------------------------- WHAT */}
        <TabsContent value="what" className="space-y-4">
          <div className="flex items-center justify-between">
            <MonthStepper month={month} onChange={setMonth} min={rangeMin} max={currentMonthKey()} />
            <p className="text-sm font-semibold tabular-nums">
              {formatINR(monthExpenses.reduce((s, e) => s + e.amount_paise, 0))}
            </p>
          </div>
          {categories.length === 0 ? (
            <EmptyCard label={`No spending recorded in ${monthLabel(month)}.`} />
          ) : (
            <>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Categories · {monthLabel(month)}</CardTitle></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-4">
                    <div className="h-44 w-44 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={categories} dataKey="totalPaise" nameKey="name" innerRadius={52} outerRadius={80} paddingAngle={2} strokeWidth={0}>
                            {categories.map((entry, i) => <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />)}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      {categories.map((c, i) => (
                        <div key={c.name} className="flex items-center gap-2 text-sm">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto shrink-0 font-medium tabular-nums">{formatINRCompact(c.totalPaise)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-0 sm:p-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-medium">Category</th>
                        <th className="px-3 py-2 text-right font-medium">Entries</th>
                        <th className="px-3 py-2 text-right font-medium">Share</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">vs last month</th>
                      </tr>
                    </thead>
                    <tbody>
                      {totalsByCategory(monthExpenses).map((c) => {
                        const total = statement.totalPaise;
                        const prev = prevCategories.find((p) => p.name === c.name)?.totalPaise ?? 0;
                        const delta = c.totalPaise - prev;
                        return (
                          <tr key={c.name} className="border-b last:border-0">
                            <td className="px-3 py-2.5 font-medium">{c.name}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{c.count}</td>
                            <td className="px-3 py-2.5 text-right tabular-nums">{total > 0 ? Math.round((c.totalPaise / total) * 100) : 0}%</td>
                            <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatINR(c.totalPaise)}</td>
                            <td className={cn("px-3 py-2.5 text-right tabular-nums", prev === 0 ? "text-muted-foreground" : delta <= 0 ? "text-emerald-600" : "text-rose-600")}>
                              {prev === 0 ? "new" : `${delta <= 0 ? "▼" : "▲"} ${formatINRCompact(Math.abs(delta))}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* -------------------------------------------------- WHEN */}
        <TabsContent value="when" className="space-y-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Monthly total · last 13 months</CardTitle></CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={months} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <defs>
                      <linearGradient id="monthFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0d9488" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#0d9488" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={(v) => formatINRCompact(v)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
                    <Tooltip content={<ChartTooltip formatter={formatINR} />} />
                    <Area type="monotone" dataKey="totalPaise" name="Spent" stroke="#0d9488" strokeWidth={2} fill="url(#monthFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Spending by weekday · all recorded months</CardTitle></CardHeader>
            <CardContent>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weekdays} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tickFormatter={(v) => formatINRCompact(v)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
                    <Tooltip content={<ChartTooltip formatter={formatINR} />} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
                    <Bar dataKey="totalPaise" name="Spent" radius={[6, 6, 0, 0]}>
                      {weekdays.map((w, i) => (
                        <Cell key={i} fill={w.totalPaise === Math.max(...weekdays.map((x) => x.totalPaise)) && w.totalPaise > 0 ? "#e11d48" : "#d97706"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                The red bar is your most expensive day of the week. Biggest spend day overall:{" "}
                {(() => {
                  const top = weekdays.reduce((a, b) => (b.totalPaise > a.totalPaise ? b : a), weekdays[0]);
                  return top && top.totalPaise > 0 ? `${top.day} (${formatINR(top.totalPaise)}, ${top.count} expenses)` : "—";
                })()}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* -------------------------------------------------- WHO */}
        {partners.length >= 2 && (
          <TabsContent value="who" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Balance over time · {partners[0]?.name ?? "A"} vs {partners[1]?.name ?? "B"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={cumulative} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tickFormatter={(v) => formatINRCompact(v)} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={54} />
                    <Tooltip content={<ChartTooltip formatter={formatINR} />} />
                    <ReferenceLine y={0} stroke="rgba(0,0,0,0.25)" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="netAPaise" name={`${partners[0]?.name ?? "A"}'s net`} stroke="#0d9488" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Above zero: {partners[1]?.name ?? "B"} owes {partners[0]?.name ?? "A"}. Below zero: the reverse.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Contributions · last 13 months</CardTitle></CardHeader>
            <CardContent className="p-0 sm:p-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Partner</th>
                    <th className="px-3 py-2 text-right font-medium">Paid</th>
                    <th className="px-3 py-2 text-right font-medium">Fair share</th>
                    <th className="px-3 py-2 text-right font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.partner.id} className="border-b last:border-0">
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2 font-medium">
                          <PartnerAvatar partner={s.partner} size="sm" />
                          {s.partner.name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(s.paidPaise)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(s.sharePaise)}</td>
                      <td className={cn("px-3 py-2.5 text-right font-semibold tabular-nums", s.deltaPaise >= 0 ? "text-emerald-600" : "text-rose-600")}>
                        {s.deltaPaise >= 0 ? "+" : ""}{formatINR(s.deltaPaise)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* -------------------------------------------------- STATEMENT */}
        <TabsContent value="statement" className="space-y-4">
          <div className="flex items-center justify-between no-print">
            <MonthStepper month={month} onChange={setMonth} min={rangeMin} max={currentMonthKey()} />
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mr-1.5 h-4 w-4"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" /></svg>
              Print / Save PDF
            </Button>
          </div>
          <div id="printable" className="rounded-xl border bg-card p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <div>
                <p className="flex items-center gap-2 text-lg font-bold">
                  Monthly statement
                  {data.monthCloses.some((c) => c.month === month) && (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      Closed
                    </span>
                  )}
                </p>
                <p className="text-sm text-muted-foreground">{monthLabel(month)} · {partners.map((p) => p.name).join(" & ")}</p>
              </div>
              <p className="text-2xl font-bold tabular-nums">{formatINR(statement.totalPaise)}</p>
            </div>
            {statement.count === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No expenses in {monthLabel(month)}.</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">By category</p>
                    <table className="w-full text-sm">
                      <tbody>
                        {statement.categories.map((c) => (
                          <tr key={c.name} className="border-b last:border-0">
                            <td className="py-1.5">{c.name} <span className="text-xs text-muted-foreground">×{c.count}</span></td>
                            <td className="py-1.5 text-right tabular-nums">{formatINR(c.totalPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">By partner</p>
                    <table className="w-full text-sm">
                      <tbody>
                        {statement.partnerStats.map((s) => (
                          <tr key={s.partner.id} className="border-b last:border-0">
                            <td className="py-1.5">{s.partner.name}</td>
                            <td className="py-1.5 text-right tabular-nums">
                              paid {formatINR(s.paidPaise)} · share {formatINR(s.sharePaise)}
                            </td>
                          </tr>
                        ))}
                        {statement.settlements.map((s) => (
                          <tr key={s.id} className="border-b last:border-0">
                            <td className="py-1.5">Settlement</td>
                            <td className="py-1.5 text-right tabular-nums">
                              {partners.find((p) => p.id === s.from_partner)?.name} → {partners.find((p) => p.id === s.to_partner)?.name}{" "}
                              {formatINR(s.amount_paise)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {statement.merchants.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top places</p>
                    <table className="w-full text-sm">
                      <tbody>
                        {statement.merchants.slice(0, 5).map((m) => (
                          <tr key={m.name} className="border-b last:border-0">
                            <td className="py-1.5">{m.name} <span className="text-xs text-muted-foreground">×{m.count}</span></td>
                            <td className="py-1.5 text-right tabular-nums">{formatINR(m.totalPaise)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {statement.largest && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Largest single expense: {statement.largest.merchant} — {formatINR(statement.largest.amount_paise)} on {statement.largest.expense_date}.
                  </p>
                )}
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyCard({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">{label}</div>
  );
}
