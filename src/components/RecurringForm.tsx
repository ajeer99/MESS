import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { addRecurring, updateRecurring } from "../api";
import { useApp } from "../app-context";
import { DEFAULT_CATEGORIES } from "../compute";
import { parseAmountToPaise } from "../money";
import { useCurrency } from "../usePrefs";
import type { RecurringRule, SplitType } from "../types";
import { PartnerAvatar } from "./ui-bits";
import { cn } from "@/lib/utils";

export function RecurringForm({ open, onOpenChange, editing, onClosed }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: RecurringRule | null;
  onClosed: () => void;
}) {
  const currency = useCurrency();
  const { session, data, refresh } = useApp();
  const partners = data?.partners ?? [];
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("Rent");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [paidBy, setPaidBy] = useState("");
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setMerchant(editing.merchant);
      setCategory(editing.category);
      setNote(editing.note);
      setAmount((editing.amount_paise / 100).toString());
      setPaidBy(editing.paid_by);
      setSplitType(editing.split_type);
      setDayOfMonth(String(editing.day_of_month));
      setActive(editing.active);
    } else {
      setMerchant("");
      setCategory("Rent");
      setNote("");
      setAmount("");
      setPaidBy(session.partner.id);
      setSplitType("equal");
      setDayOfMonth("1");
      setActive(true);
    }
    setBusy(false);
  }, [open, editing, session.partner.id]);

  const paise = parseAmountToPaise(amount);

  const submit = async () => {
    if (paise === null) { toast.error("Enter a valid amount."); return; }
    if (!merchant.trim()) { toast.error("Enter where it is paid (merchant)."); return; }
    if (!category.trim()) { toast.error("Pick a category."); return; }
    const day = Number(dayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 31) { toast.error("Day of month must be 1-31."); return; }
    if (!paidBy) { toast.error("Choose who pays it."); return; }
    setBusy(true);
    const input = {
      merchant: merchant.trim(), category: category.trim(), note: note.trim(),
      amountPaise: paise, paidBy, splitType, dayOfMonth: day, active,
    };
    try {
      if (editing) {
        await updateRecurring(session.token, editing.id, input);
        toast.success("Recurring expense updated");
      } else {
        await addRecurring(session.token, input);
        toast.success("Recurring expense added — appears automatically every month");
      }
      onOpenChange(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) onClosed(); }}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] overflow-y-auto rounded-t-2xl p-0 sm:max-w-lg sm:rounded-2xl">
        <SheetHeader className="px-5 pt-5">
          <SheetTitle>{editing ? "Edit recurring expense" : "New recurring expense"}</SheetTitle>
          <SheetDescription>
            Added automatically every month on the chosen day (fixed monthly costs like rent or subscriptions).
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 pb-6 pt-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-merchant">Where</Label>
              <Input id="r-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Landlord / Netflix" className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-category">What for</Label>
              <Input id="r-category" list="pe-r-categories" value={category} onChange={(e) => setCategory(e.target.value)} className="h-11" />
              <datalist id="pe-r-categories">
                {DEFAULT_CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="r-amount">Amount ({currency.code}) · dot decimals</Label>
              <Input id="r-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="15000" className="h-11 tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="r-day">Day of month</Label>
              <Input id="r-day" inputMode="numeric" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} className="h-11 tabular-nums" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Split</Label>
            <div className="grid grid-cols-3 gap-2">
              {([{ key: "equal", label: "50 / 50" }, { key: "personal", label: "Personal" }, { key: "percent", label: "Custom %" }] as { key: SplitType; label: string }[]).map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setSplitType(option.key)}
                  className={cn(
                    "rounded-xl border px-2 py-2.5 text-sm font-medium transition-colors",
                    splitType === option.key ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Paid by</Label>
            <div className="grid grid-cols-2 gap-2">
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
                  <PartnerAvatar partner={p} size="sm" />
                  <span className="text-sm font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="r-note">Note (optional)</Label>
            <Input id="r-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="monthly rent" className="h-11" />
          </div>

          <div className="flex items-center justify-between rounded-xl border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Paused rules stop adding new months</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button className="flex-1" onClick={submit} disabled={busy || paise === null}>
              {busy ? "Saving…" : editing ? "Save changes" : "Add recurring"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
