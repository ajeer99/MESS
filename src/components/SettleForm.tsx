import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { toast } from "sonner";
import { addSettlement } from "../api";
import { useApp } from "../app-context";
import { todayISO } from "../compute";
import { formatINR, parseAmountToPaise } from "../money";
import { useCurrency } from "../usePrefs";
import { PartnerAvatar } from "./ui-bits";
import { cn } from "@/lib/utils";

export function SettleForm({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const currency = useCurrency();
  const { session, data, refresh } = useApp();
  const partners = data?.partners ?? [];
  const debts = data?.debts ?? [];

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  // Find the most relevant debt suggestion for the current user
  const suggestedDebt = useMemo(() => {
    // Prefer a debt where the viewer is the one who owes
    return debts.find((d) => d.fromId === session.partner.id)
      ?? debts.find((d) => d.toId === session.partner.id)
      ?? debts[0]
      ?? null;
  }, [debts, session.partner.id]);

  useEffect(() => {
    if (!open) return;
    if (suggestedDebt) {
      setFromId(suggestedDebt.fromId);
      setToId(suggestedDebt.toId);
      setAmount((suggestedDebt.amountPaise / 100).toString());
    } else {
      setFromId(session.partner.id);
      setToId(partners.find((p) => p.id !== session.partner.id)?.id ?? "");
      setAmount("");
    }
    setDate(todayISO());
    setNote("");
    setBusy(false);
  }, [open, suggestedDebt, session.partner.id, partners.length]);

  const paise = parseAmountToPaise(amount);
  const from = partners.find((p) => p.id === fromId);
  const to = partners.find((p) => p.id === toId);

  // When fromId changes, ensure toId is a different partner
  const handleFromChange = (id: string) => {
    setFromId(id);
    if (id === toId) {
      setToId(partners.find((p) => p.id !== id)?.id ?? "");
    }
  };

  const submit = async () => {
    if (paise === null) { toast.error("Enter a valid amount."); return; }
    if (!from || !to || from.id === to.id) { toast.error("Choose two different partners."); return; }
    setBusy(true);
    try {
      await addSettlement(session.token, {
        date, fromId: from.id, toId: to.id, amountPaise: paise, note: note.trim(),
      });
      toast.success(`${from.name} paid ${to.name} ${formatINR(paise)} — recorded`);
      onOpenChange(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the repayment.");
      setBusy(false);
    }
  };

  const gridCols = partners.length <= 2 ? "grid-cols-2" : partners.length === 3 ? "grid-cols-3" : "grid-cols-2";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92dvh] overflow-y-auto rounded-t-2xl p-0 sm:max-w-lg sm:rounded-2xl">
        <SheetHeader className="px-5 pt-5">
          <SheetTitle>Settle up</SheetTitle>
          <SheetDescription>
            {suggestedDebt
              ? `${suggestedDebt.fromName} owes ${suggestedDebt.toName} ${formatINR(suggestedDebt.amountPaise)} — prefilled below.`
              : "Record a repayment between partners. The balance updates instantly."}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-5 pb-6 pt-1">

          {/* Who paid (from) */}
          <div className="space-y-1.5">
            <Label>Who paid</Label>
            <div className={cn("grid gap-2", gridCols)}>
              {partners.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleFromChange(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-3 text-left transition-colors",
                    fromId === p.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                  )}
                >
                  <PartnerAvatar partner={p} />
                  <span className="truncate text-sm font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Paid to */}
          <div className="space-y-1.5">
            <Label>Paid to</Label>
            <div className={cn("grid gap-2", gridCols)}>
              {partners.filter((p) => p.id !== fromId).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setToId(p.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-3 text-left transition-colors",
                    toId === p.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                  )}
                >
                  <PartnerAvatar partner={p} />
                  <span className="truncate text-sm font-medium">{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Amount */}
          <div className="space-y-1.5">
            <Label htmlFor="settle-amount">Amount ({currency.code}) · use a dot for decimals</Label>
            <div className="relative">
              <span className={cn("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground", currency.code === "SAR" ? "text-xl" : "text-xs font-semibold")}>{currency.code === "SAR" ? currency.symbol : currency.code}</span>
              <Input
                id="settle-amount"
                inputMode="decimal"
                className="h-12 pl-14 text-xl font-semibold tabular-nums"
                placeholder="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            {suggestedDebt && paise !== suggestedDebt.amountPaise && (
              <p className="text-xs text-muted-foreground">Full balance: {formatINR(suggestedDebt.amountPaise)}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="settle-date">Date</Label>
              <Input id="settle-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settle-note">Note (optional)</Label>
              <Input id="settle-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="UPI / cash" className="h-11" />
            </div>
          </div>

          {from && to && (
            <p className="text-xs text-muted-foreground">{from.name} → {to.name}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button className="flex-1" onClick={submit} disabled={busy || paise === null || !from || !to || from.id === to.id}>
              {busy ? "Recording…" : "Record payment"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
