import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { addExpense, updateExpense } from "../api";
import { useApp } from "../app-context";
import { DEFAULT_CATEGORIES, todayISO } from "../compute";
import { formatINR, parseAmountToPaise } from "../money";
import { useCurrency } from "../usePrefs";
import type { Expense, SplitType } from "../types";
import { parseShares } from "../types";
import { PartnerAvatar } from "./ui-bits";
import { cn } from "@/lib/utils";

type SplitMode = "equal" | "personal" | "custom";

export function ExpenseForm({ open, onOpenChange, editing, onClosed }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: Expense | null;
  onClosed: () => void;
}) {
  const currency = useCurrency();
  const { session, data, refresh } = useApp();
  const partners = data?.partners ?? [];
  const solo = partners.length < 2;
  const merchantList = useMemo(() => (data?.lists.merchants ?? []).map((m) => m.name).slice(0, 60), [data]);
  const categoryList = useMemo(() => {
    const used = (data?.lists.categories ?? []).map((c) => c.name);
    return [...new Set([...used, ...DEFAULT_CATEGORIES])].slice(0, 40);
  }, [data]);

  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState<string>("");
  const [date, setDate] = useState(todayISO());
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [splitMode, setSplitMode] = useState<SplitMode>("equal");
  // for equal: which partners are included
  const [splitPartners, setSplitPartners] = useState<string[]>([]);
  // for custom: per-partner amount strings
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const allIds = partners.map((p) => p.id);
    if (editing) {
      setAmount((editing.amount_paise / 100).toString());
      setPaidBy(editing.paid_by);
      setDate(editing.expense_date);
      setMerchant(editing.merchant);
      setCategory(editing.category);
      setNote(editing.note);
      const sm = (editing.split_type === "personal" ? "personal" : editing.split_type === "custom" ? "custom" : "equal") as SplitMode;
      setSplitMode(sm);
      try {
        const sh = JSON.parse(editing.shares ?? "{}") as Record<string, number>;
        setSplitPartners(sm === "equal" ? Object.keys(sh) : allIds);
        if (sm === "custom") {
          const ca: Record<string, string> = {};
          for (const p of partners) ca[p.id] = sh[p.id] ? (sh[p.id] / 100).toString() : "0";
          setCustomAmounts(ca);
        } else {
          setCustomAmounts({});
        }
      } catch {
        setSplitPartners(allIds);
        setCustomAmounts({});
      }
    } else {
      setAmount("");
      setPaidBy(session.partner.id);
      setDate(todayISO());
      setMerchant("");
      setCategory("");
      setNote("");
      setSplitMode("equal");
      setSplitPartners(allIds);
      setCustomAmounts({});
    }
    setBusy(false);
  }, [open, editing, session.partner.id, partners.length]);

  const paise = parseAmountToPaise(amount);

  const toggleSplitPartner = (id: string) => {
    setSplitPartners((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id]
    );
  };

  // Preview of per-partner shares for equal split
  const equalSharePreview = useMemo(() => {
    if (paise === null || splitMode !== "equal" || splitPartners.length === 0) return null;
    const included = splitPartners.includes(paidBy) ? splitPartners : [...splitPartners, paidBy];
    const n = included.length;
    const base = Math.floor(paise / n);
    const rem = paise - base * n;
    return included.map((id) => ({
      id,
      name: partners.find((p) => p.id === id)?.name ?? id,
      share: id === paidBy ? base + rem : base,
    }));
  }, [paise, splitMode, splitPartners, paidBy, partners]);

  const customTotal = useMemo(() => {
    return Object.values(customAmounts).reduce((sum, v) => {
      const p = parseAmountToPaise(v);
      return sum + (p ?? 0);
    }, 0);
  }, [customAmounts]);

  const submit = async () => {
    if (paise === null) { toast.error("Enter a valid amount."); return; }
    if (!merchant.trim()) { toast.error("Enter where you spent it."); return; }
    if (!category.trim()) { toast.error("Pick what it was for."); return; }
    if (!solo && !paidBy) { toast.error("Choose who paid."); return; }

    if (!solo && splitMode === "equal") {
      const included = splitPartners.includes(paidBy) ? splitPartners : [...splitPartners, paidBy];
      if (included.length < 1) { toast.error("Select at least one partner for the split."); return; }
    }
    if (!solo && splitMode === "custom") {
      for (const partner of partners) {
        const raw = (customAmounts[partner.id] ?? "").trim();
        const isZero = /^(?:0+(?:\.0{0,2})?|\.0{1,2})$/.test(raw);
        if (raw !== "" && !isZero && parseAmountToPaise(raw) === null) {
          toast.error(`Enter a valid share for ${partner.name}. Use a dot for decimals; zero is allowed.`);
          return;
        }
      }
      if (customTotal !== paise) {
        toast.error(`Custom amounts must total ${formatINR(paise)}. Currently: ${formatINR(customTotal)}`);
        return;
      }
    }

    setBusy(true);
    const included = splitMode === "equal"
      ? (splitPartners.includes(paidBy) ? splitPartners : [...splitPartners, paidBy])
      : [];

    const customShares = splitMode === "custom"
      ? Object.fromEntries(
          partners
            .map((p) => [p.id, parseAmountToPaise(customAmounts[p.id] ?? "0") ?? 0] as [string, number])
            .filter(([, v]) => v > 0)
        )
      : undefined;

    const input = {
      date,
      merchant: merchant.trim(),
      category: category.trim(),
      note: note.trim(),
      amountPaise: paise,
      paidBy: solo ? session.partner.id : paidBy,
      splitType: (solo ? "personal" : splitMode) as SplitType,
      splitPartners: !solo && splitMode === "equal" ? included : undefined,
      customShares: !solo ? customShares : undefined,
    };
    try {
      if (editing) {
        await updateExpense(session.token, editing.id, input);
        toast.success("Expense updated");
      } else {
        await addExpense(session.token, input);
        toast.success(`Added ${formatINR(paise)} — split recorded`);
      }
      onOpenChange(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the expense.");
      setBusy(false);
    }
  };

  const gridCols = partners.length <= 2 ? "grid-cols-2" : partners.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <Sheet open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) onClosed(); }}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] overflow-y-auto rounded-t-2xl p-0 sm:max-w-lg sm:rounded-2xl">
        <SheetHeader className="px-5 pt-5">
          <SheetTitle>{editing ? "Edit expense" : "Add expense"}</SheetTitle>
          <SheetDescription>
            {editing ? "Update the details — splits and balance recalculate." : "Choose who paid and how to split it."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 pb-6 pt-1">
          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount ({currency.code}) · use a dot for decimals</Label>
            <div className="relative">
              <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground", currency.code === "SAR" ? "text-xl" : "text-xs font-semibold")}>{currency.code === "SAR" ? currency.symbol : currency.code}</span>
              <Input
                id="amount"
                inputMode="decimal"
                className="h-12 pl-14 text-xl font-semibold tabular-nums"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                autoFocus={!editing}
              />
            </div>
          </div>

          {/* Paid by — hidden until a second partner joins */}
          {!solo && (
            <div className="space-y-1.5">
              <Label>Paid by</Label>
              <div className={cn("grid gap-2", gridCols)}>
                {partners.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPaidBy(p.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-xl border p-3 text-left transition-colors",
                      paidBy === p.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                    )}
                  >
                    <PartnerAvatar partner={p} />
                    <span className="truncate text-sm font-medium">{p.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="date">Date</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">What for</Label>
              <Input
                id="category"
                list="pe-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Groceries"
                className="h-11"
              />
              <datalist id="pe-categories">
                {categoryList.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          {/* Where */}
          <div className="space-y-1.5">
            <Label htmlFor="merchant">Where</Label>
            <Input
              id="merchant"
              list="pe-merchants"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="Big Bazaar, Amazon, Landlord…"
              className="h-11"
            />
            <datalist id="pe-merchants">
              {merchantList.map((m) => <option key={m} value={m} />)}
            </datalist>
          </div>

          {/* Note */}
          <div className="space-y-1.5">
            <Label htmlFor="note">Note (optional)</Label>
            <Input id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="weekly shopping" className="h-11" />
          </div>

          {/* Split mode — hidden until a second partner joins */}
          {!solo && (
          <div className="space-y-2">
            <Label>Split</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["equal", "personal", "custom"] as SplitMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSplitMode(mode)}
                  className={cn(
                    "rounded-xl border px-2 py-2.5 text-sm font-medium capitalize transition-colors",
                    splitMode === mode ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                  )}
                >
                  {mode === "equal" ? "Equal" : mode === "personal" ? "Personal" : "Custom"}
                </button>
              ))}
            </div>

            {/* Equal — partner checkboxes */}
            {splitMode === "equal" && partners.length > 2 && (
              <div className="rounded-xl border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Choose who splits this expense:</p>
                <div className={cn("grid gap-2", gridCols)}>
                  {partners.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => p.id !== paidBy && toggleSplitPartner(p.id)}
                      disabled={p.id === paidBy}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border p-2 text-sm transition-colors",
                        (splitPartners.includes(p.id) || p.id === paidBy)
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "hover:bg-muted opacity-50",
                        p.id === paidBy && "opacity-100 cursor-default",
                      )}
                    >
                      <PartnerAvatar partner={p} size="sm" />
                      <span className="truncate font-medium">{p.name}</span>
                      {p.id === paidBy && <span className="ml-auto text-xs text-muted-foreground">payer</span>}
                    </button>
                  ))}
                </div>
                {equalSharePreview && (
                  <p className="text-xs text-muted-foreground">
                    {equalSharePreview.map((s) => `${s.name}: ${formatINR(s.share)}`).join(" · ")}
                  </p>
                )}
              </div>
            )}

            {/* Equal 2-partner preview */}
            {splitMode === "equal" && partners.length === 2 && equalSharePreview && (
              <p className="text-xs text-muted-foreground">
                {equalSharePreview.map((s) => `${s.name}: ${formatINR(s.share)}`).join(" · ")}
              </p>
            )}

            {/* Custom amounts */}
            {splitMode === "custom" && (
              <div className="rounded-xl border p-3 space-y-2">
                <p className="text-xs text-muted-foreground">Enter each person's share (must total {paise !== null ? formatINR(paise) : "the amount"}):</p>
                {partners.map((p) => (
                  <div key={p.id} className="flex items-center gap-2">
                    <PartnerAvatar partner={p} size="sm" />
                    <span className="w-20 truncate text-sm font-medium">{p.name}</span>
                    <div className="relative flex-1">
                      <span className={cn("pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground", currency.code === "SAR" ? "text-base" : "text-[10px]")}>{currency.code === "SAR" ? currency.symbol : currency.code}</span>
                      <Input
                        inputMode="decimal"
                        className="h-9 pl-12 text-sm"
                        placeholder="0"
                        value={customAmounts[p.id] ?? ""}
                        onChange={(e) => setCustomAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      />
                    </div>
                  </div>
                ))}
                {paise !== null && (
                  <p className={cn("text-xs font-medium", customTotal === paise ? "text-emerald-600" : "text-rose-600")}>
                    Total: {formatINR(customTotal)} {customTotal === paise ? "✓" : `(${formatINR(Math.abs(customTotal - paise))} ${customTotal < paise ? "short" : "over"})`}
                  </p>
                )}
              </div>
            )}

            {splitMode === "personal" && (
              <p className="text-xs text-muted-foreground">
                100% of this expense counts as the payer's own cost — it does not affect the shared balance.
              </p>
            )}
          </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button className="flex-1" onClick={submit} disabled={busy || paise === null}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add expense"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
