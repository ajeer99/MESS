import type { Expense, Partner, Settlement } from "./types";
import { parseShares } from "./types";

export const DEFAULT_CATEGORIES = [
  "Groceries", "Dining", "Rent", "Utilities", "Transport", "Fuel", "Shopping",
  "Health", "Entertainment", "Travel", "Gifts", "Home", "Personal", "Other",
];

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function monthKeyOf(dateStr: string): string {
  return dateStr.slice(0, 7);
}

export function monthKeyAdd(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${y}`;
}

export function daysInMonthKey(key: string): number {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function currentMonthKey(): string {
  return todayISO().slice(0, 7);
}

export function expensesInMonth(expenses: Expense[], month: string): Expense[] {
  return expenses.filter((e) => e.expense_date.startsWith(month));
}

export function settlementsInMonth(settlements: Settlement[], month: string): Settlement[] {
  return settlements.filter((s) => s.settle_date.startsWith(month));
}

export function totalPaise(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.amount_paise, 0);
}

export interface CategoryTotal { name: string; totalPaise: number; count: number }
export interface MerchantTotal { name: string; totalPaise: number; count: number; avgPaise: number }

export function totalsByCategory(expenses: Expense[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();
  for (const e of expenses) {
    const entry = map.get(e.category) ?? { name: e.category, totalPaise: 0, count: 0 };
    entry.totalPaise += e.amount_paise;
    entry.count += 1;
    map.set(e.category, entry);
  }
  return [...map.values()].sort((a, b) => b.totalPaise - a.totalPaise);
}

export function totalsByMerchant(expenses: Expense[]): MerchantTotal[] {
  const map = new Map<string, MerchantTotal>();
  for (const e of expenses) {
    const entry = map.get(e.merchant) ?? { name: e.merchant, totalPaise: 0, count: 0, avgPaise: 0 };
    entry.totalPaise += e.amount_paise;
    entry.count += 1;
    map.set(e.merchant, entry);
  }
  return [...map.values()].map((m) => ({ ...m, avgPaise: Math.round(m.totalPaise / m.count) }))
    .sort((a, b) => b.totalPaise - a.totalPaise);
}

export interface MonthPoint { month: string; label: string; totalPaise: number; count: number }

export function monthlySeries(expenses: Expense[], lastMonth: string, months: number): MonthPoint[] {
  const points: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const key = monthKeyAdd(lastMonth, -i);
    points.push({ month: key, label: monthLabel(key), totalPaise: 0, count: 0 });
  }
  const index = new Map(points.map((p) => [p.month, p]));
  for (const e of expenses) {
    const point = index.get(monthKeyOf(e.expense_date));
    if (point) { point.totalPaise += e.amount_paise; point.count += 1; }
  }
  return points;
}

export function weekdayTotals(expenses: Expense[]): { day: string; totalPaise: number; count: number }[] {
  const totals = WEEKDAYS.map((day) => ({ day, totalPaise: 0, count: 0 }));
  for (const e of expenses) {
    const [y, m, d] = e.expense_date.split("-").map(Number);
    const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    const idx = (jsDay + 6) % 7; // 0=Mon..6=Sun
    totals[idx].totalPaise += e.amount_paise;
    totals[idx].count += 1;
  }
  return totals;
}

export interface PartnerStat { partner: Partner; paidPaise: number; sharePaise: number; deltaPaise: number }

export function partnerStats(expenses: Expense[], partners: Partner[]): PartnerStat[] {
  return partners.map((partner) => {
    let paid = 0;
    let share = 0;
    for (const e of expenses) {
      if (e.paid_by === partner.id) paid += e.amount_paise;
      const shares = parseShares(e);
      share += shares[partner.id] ?? 0;
    }
    return { partner, paidPaise: paid, sharePaise: share, deltaPaise: paid - share };
  });
}

/** Running net position of a partner by month end, including settlements. */
export function cumulativeNetSeries(
  expenses: Expense[],
  settlements: Settlement[],
  partners: Partner[],
  lastMonth: string,
  months: number,
): { month: string; label: string; netAPaise: number }[] {
  const aId = partners[0]?.id;
  const events: { date: string; delta: number }[] = [];
  for (const e of expenses) {
    const shares = parseShares(e);
    const myShare = shares[aId] ?? 0;
    events.push({ date: e.expense_date, delta: (e.paid_by === aId ? e.amount_paise : 0) - myShare });
  }
  for (const s of settlements) {
    events.push({
      date: s.settle_date,
      delta: (s.from_partner === aId ? s.amount_paise : 0) - (s.to_partner === aId ? s.amount_paise : 0),
    });
  }
  events.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  const points: { month: string; label: string; netAPaise: number }[] = [];
  let running = 0;
  let cursor = 0;
  for (let i = months - 1; i >= 0; i--) {
    const key = monthKeyAdd(lastMonth, -i);
    const monthEnd = `${key}-${daysInMonthKey(key)}`;
    while (cursor < events.length && events[cursor].date <= monthEnd) {
      running += events[cursor].delta;
      cursor += 1;
    }
    points.push({ month: key, label: monthLabel(key), netAPaise: running });
  }
  return points;
}

export interface MonthStatement {
  month: string;
  totalPaise: number;
  count: number;
  categories: CategoryTotal[];
  merchants: MerchantTotal[];
  partnerStats: PartnerStat[];
  settlements: Settlement[];
  netAEndPaise: number;
  largest: Expense | null;
}

export function monthStatement(
  expenses: Expense[],
  settlements: Settlement[],
  partners: Partner[],
  month: string,
): MonthStatement {
  const monthExpenses = expensesInMonth(expenses, month);
  const monthSettlements = settlementsInMonth(settlements, month);
  const stats = partnerStats(monthExpenses, partners);
  const monthEnd = `${month}-${daysInMonthKey(month)}`;
  let netA = 0;
  const aId = partners[0]?.id;
  for (const e of expenses) {
    if (e.expense_date <= monthEnd) {
      const shares = parseShares(e);
      netA += (e.paid_by === aId ? e.amount_paise : 0) - (shares[aId] ?? 0);
    }
  }
  for (const s of settlements) {
    if (s.settle_date <= monthEnd) {
      netA += (s.from_partner === aId ? s.amount_paise : 0) - (s.to_partner === aId ? s.amount_paise : 0);
    }
  }
  const largest = monthExpenses.length
    ? monthExpenses.reduce((max, e) => (e.amount_paise > max.amount_paise ? e : max))
    : null;
  return {
    month,
    totalPaise: totalPaise(monthExpenses),
    count: monthExpenses.length,
    categories: totalsByCategory(monthExpenses),
    merchants: totalsByMerchant(monthExpenses).slice(0, 8),
    partnerStats: stats,
    settlements: monthSettlements,
    netAEndPaise: netA,
    largest,
  };
}

/** Projects the month-end total from the pace so far. */
export function paceProjection(monthTotalPaise: number, month: string): number | null {
  const today = todayISO();
  if (!today.startsWith(month)) return null;
  const dayOfMonth = Number(today.slice(8, 10));
  const days = daysInMonthKey(month);
  if (dayOfMonth <= 0) return null;
  return Math.round((monthTotalPaise / dayOfMonth) * days);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function toCSV(expenses: Expense[], settlements: Settlement[], partners: Partner[], currencyCode = "INR"): string {
  const nameOf = (id: string) => partners.find((p) => p.id === id)?.name ?? "Unknown";
  const code = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : "INR";
  const rows: string[] = [`Date,Kind,Where,What,Note,Amount (${code}),Paid by,Split`];
  const sortedExpenses = [...expenses].sort((a, b) => (a.expense_date < b.expense_date ? -1 : 1));
  const splitLabel = (e: Expense) => {
    if (e.split_type === "personal") return "Personal";
    if (e.split_type === "custom") return "Custom";
    const shares = parseShares(e);
    const n = Object.keys(shares).length;
    return n <= 1 ? "Personal" : `Equal /${n}`;
  };
  for (const e of sortedExpenses) {
    rows.push([
      e.expense_date, "Expense", e.merchant, e.category, e.note,
      (e.amount_paise / 100).toFixed(2), nameOf(e.paid_by), splitLabel(e),
    ].map(csvEscape).join(","));
  }
  const sortedSettlements = [...settlements].sort((a, b) => (a.settle_date < b.settle_date ? -1 : 1));
  for (const s of sortedSettlements) {
    rows.push([
      s.settle_date,
      "Settlement",
      `${nameOf(s.from_partner)} -> ${nameOf(s.to_partner)}`,
      "Settle up",
      s.note,
      (s.amount_paise / 100).toFixed(2),
      nameOf(s.from_partner),
      "-",
    ].map(csvEscape).join(","));
  }
  return `\uFEFF${rows.join("\r\n")}`;
}
