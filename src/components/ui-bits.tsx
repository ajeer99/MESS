import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { monthLabel } from "../compute";
import type { Expense, Partner } from "../types";

export function MonthStepper({ month, onChange, min, max }: {
  month: string;
  onChange: (month: string) => void;
  min?: string;
  max?: string;
}) {
  const clamp = (value: string) => {
    if (min && value < min) return min;
    if (max && value > max) return max;
    return value;
  };
  return (
    <div className="flex items-center gap-1">
      <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Previous month"
        onClick={() => onChange(shift(month, -1, min, max))}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="m15 18-6-6 6-6" /></svg>
      </Button>
      <span className="min-w-24 text-center text-sm font-semibold tabular-nums">{monthLabel(month)}</span>
      <Button variant="outline" size="icon" className="h-8 w-8" aria-label="Next month"
        onClick={() => onChange(clamp(shift(month, 1)))}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="m9 18 6-6-6-6" /></svg>
      </Button>
    </div>
  );
}

function shift(month: string, delta: number, min?: string, max?: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  let next = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (min && next < min) next = min;
  if (max && next > max) next = max;
  return next;
}

export function PartnerAvatar({ partner, size = "md" }: { partner: Partner | undefined; size?: "sm" | "md" | "lg" }) {
  const initial = partner?.name?.trim()?.[0]?.toUpperCase() ?? "?";
  const dims = size === "sm" ? "h-6 w-6" : size === "lg" ? "h-14 w-14" : "h-9 w-9";
  if (partner?.avatar_url) {
    return (
      <img
        src={partner.avatar_url}
        alt={partner.name ?? "avatar"}
        className={cn("shrink-0 rounded-full object-cover ring-1 ring-black/5", dims)}
      />
    );
  }
  return (
    <span className={cn(
      "flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
      dims,
      size === "sm" ? "text-[10px]" : size === "lg" ? "text-2xl" : "text-sm",
      partner?.position === 0 ? "bg-teal-800" : "bg-slate-700",
    )}>
      {partner?.avatar_emoji ?? initial}
    </span>
  );
}

export function SplitBadge({ expense }: { expense: Expense }) {
  if (expense.split_type === "personal") {
    return <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">personal</span>;
  }
  if (expense.split_type === "custom") {
    return <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">custom</span>;
  }
  return null;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-dashed p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
