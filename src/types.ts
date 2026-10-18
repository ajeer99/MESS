export type SplitType = "equal" | "personal" | "custom";

export interface Partner {
  id: string;
  position: number;
  name: string;
  username?: string;
  avatar_emoji?: string | null;
  /** Small data-URL photo; takes precedence over the emoji when both are set. */
  avatar_url?: string | null;
}

export interface Expense {
  id: string;
  expense_date: string;
  merchant: string;
  category: string;
  note: string;
  amount_paise: number;
  paid_by: string;
  split_type: SplitType;
  /** JSON string: Record<partnerId, paise> */
  shares: string;
  recurring_rule_id: string | null;
  created_by?: string;
  created_at?: string;
}

export interface Settlement {
  id: string;
  settle_date: string;
  from_partner: string;
  to_partner: string;
  amount_paise: number;
  note: string;
}

export interface RecurringRule {
  id: string;
  merchant: string;
  category: string;
  note: string;
  amount_paise: number;
  paid_by: string;
  split_type: SplitType;
  /** JSON string: partner IDs included in split */
  split_partners: string;
  day_of_month: number;
  active: boolean;
  last_generated: string | null;
}

/** A single pairwise debt: `from` owes `to` this amount. */
export interface Debt {
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  amountPaise: number;
}

/** Snapshot stored when a month is closed. */
export interface MonthCloseSummary {
  totalPaise: number;
  expenseCount: number;
  paidBy: Record<string, number>;
  sharesBy: Record<string, number>;
  byCategory: { name: string; paise: number }[];
  settlements: { count: number; totalPaise: number };
  debts: Debt[];
}

export interface MonthClose {
  month: string;
  closedBy: string;
  closedAt: string;
  summary: MonthCloseSummary | null;
}

export interface DataResponse {
  partners: Partner[];
  range: { from: string; to: string };
  expenses: Expense[];
  hasMore: boolean;
  nextOffset: number | null;
  settlements: Settlement[];
  recurring: RecurringRule[];
  /** Simplified pairwise debts after netting. */
  debts: Debt[];
  lists: {
    merchants: { name: string; count: number }[];
    categories: { name: string; count: number }[];
  };
  /** Active one-time invite code; null while no invite exists. */
  inviteCode: string | null;
  /** When set, the invite is a one-tap joining link for this partner's id. */
  invitePartnerId: string | null;
  monthCloses: MonthClose[];
}

export interface SessionInfo {
  token: string;
  partner: Partner;
}

export interface ExpenseInput {
  date: string;
  merchant: string;
  category: string;
  note: string;
  amountPaise: number;
  paidBy: string;
  splitType: SplitType;
  /** Partner IDs to include in equal split. Required for "equal". */
  splitPartners?: string[];
  /** custom per-partner amounts in paise. Required for "custom". */
  customShares?: Record<string, number>;
}

export interface RecurringInput {
  merchant: string;
  category: string;
  note: string;
  amountPaise: number;
  paidBy: string;
  splitType: SplitType;
  splitPartners?: string[];
  dayOfMonth: number;
  active: boolean;
}

/** Parse shares JSON from an expense safely */
export function parseShares(expense: Expense): Record<string, number> {
  try {
    const parsed = JSON.parse(expense.shares);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number>;
    }
  } catch { /* fall through */ }
  return {};
}
