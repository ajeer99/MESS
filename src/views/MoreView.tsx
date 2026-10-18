import { useMemo, useRef, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  addPartner, changePassword, closeMonth, deleteRecurring, deleteSettlement, renameSelf,
  reopenMonth, updateAvatar, updateRecurring,
} from "../api";
import { saveSession } from "../api";
import { useApp } from "../app-context";
import { InviteCard } from "../components/InviteCard";
import { RecurringForm } from "../components/RecurringForm";
import { formatINR } from "../money";
import { currentMonthKey, expensesInMonth, monthKeyAdd, monthLabel, toCSV, totalPaise } from "../compute";
import type { MonthClose, RecurringRule } from "../types";
import { PartnerAvatar } from "../components/ui-bits";
import { ApiError } from "../api";
import { cn } from "@/lib/utils";
import { CURRENCIES, getCurrencyConfig, setCurrency, setTheme, type ThemeMode } from "../preferences";
import { usePrefs } from "../usePrefs";

export function MoreView() {
  const prefs = usePrefs();
  const [pendingCurrency, setPendingCurrency] = useState<string | null>(null);
  const { session, data, refresh, signOut } = useApp();
  const partners = data?.partners ?? [];
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<RecurringRule | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [newName, setNewName] = useState(session.partner.name);
  const [nameBusy, setNameBusy] = useState(false);
  const [openSummary, setOpenSummary] = useState<MonthClose | null>(null);
  const [monthBusy, setMonthBusy] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const [addName, setAddName] = useState("");
  const [addUsername, setAddUsername] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  const me = partners.find((p) => p.id === session.partner.id);

  const submitAddPartner = async () => {
    const name = addName.trim();
    const username = addUsername.trim().toLowerCase();
    if (!name || username.length < 3 || addPassword.length < 6) {
      toast.error("Fill all fields — username 3+ characters, password 6+.");
      return;
    }
    setAddBusy(true);
    try {
      const result = await addPartner(session.token, { name, username, password: addPassword });
      setAddName("");
      setAddUsername("");
      setAddPassword("");
      await refresh();
      if (result.inviteCode) {
        const link = `${window.location.origin}${window.location.pathname}?join=${result.inviteCode}`;
        try {
          await navigator.clipboard.writeText(link);
          toast.success(`${result.partner.name} added. Joining link copied — send it; they tap it once and they're in.`);
        } catch {
          toast.success(`${result.partner.name} added. Send them the joining link below.`);
        }
      } else {
        toast.success(`${result.partner.name} added. They can sign in with the username and password you set.`);
      }
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not add your partner.");
    } finally {
      setAddBusy(false);
    }
  };

  const applyAvatar = async (emoji: string | null, url: string | null, message: string) => {
    setAvatarBusy(true);
    try {
      await updateAvatar(session.token, emoji, url);
      toast.success(message);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not update your avatar.");
    } finally {
      setAvatarBusy(false);
    }
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const dataUrl = await shrinkToAvatarDataUrl(file);
    if (!dataUrl) {
      toast.error("Could not use that image. Try a JPG or PNG photo under 10 MB.");
      return;
    }
    await applyAvatar(null, dataUrl, "Photo updated — it shows everywhere your name does.");
  };

  const closeMonths = useMemo(() => data?.monthCloses ?? [], [data]);
  const pastMonths = useMemo(
    () => Array.from({ length: 6 }, (_, i) => monthKeyAdd(currentMonthKey(), -(i + 1))),
    [],
  );
  const summary = openSummary?.summary ?? null;

  const toggleRule = async (rule: RecurringRule, active: boolean) => {
    try {
      await updateRecurring(session.token, rule.id, {
        merchant: rule.merchant, category: rule.category, note: rule.note,
        amountPaise: rule.amount_paise, paidBy: rule.paid_by, splitType: rule.split_type,
        dayOfMonth: rule.day_of_month, active,
      });
      toast.success(active ? `${rule.merchant} reactivated — resumes from this month` : `${rule.merchant} paused`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update.");
    }
  };

  const removeRule = async (rule: RecurringRule) => {
    try {
      await deleteRecurring(session.token, rule.id);
      toast.success("Recurring expense removed. Already-added entries stay in history.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete.");
    }
  };

  const removeSettlement = async (id: string) => {
    try {
      await deleteSettlement(session.token, id);
      toast.success("Settlement deleted");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete.");
    }
  };

  const doCloseMonth = async (month: string) => {
    setMonthBusy(month);
    try {
      await closeMonth(session.token, month);
      toast.success(`${monthLabel(month)} closed. Its entries are now locked.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not close the month.");
    } finally {
      setMonthBusy(null);
    }
  };

  const doReopenMonth = async (month: string) => {
    setMonthBusy(month);
    try {
      await reopenMonth(session.token, month);
      toast.success(`${monthLabel(month)} reopened — entries can be edited again.`);
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not reopen the month.");
    } finally {
      setMonthBusy(null);
    }
  };

  const submitRename = async () => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed.length > 40) { toast.error("Name must be 1–40 characters."); return; }
    setNameBusy(true);
    try {
      const updatedName = await renameSelf(session.token, trimmed);
      const updatedSession = { ...session, partner: { ...session.partner, name: updatedName } };
      saveSession(updatedSession);
      toast.success("Display name updated.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not update name.");
    } finally {
      setNameBusy(false);
    }
  };

  const submitPassword = async () => {
    if (newPassword.length < 6) { toast.error("New password needs at least 6 characters."); return; }
    setPwBusy(true);
    try {
      await changePassword(session.token, currentPassword, newPassword);
      toast.success("Password changed. Other devices will need to sign in again.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not change password.");
    } finally {
      setPwBusy(false);
    }
  };

  const exportCSV = () => {
    if (!data) return;
    const csv = toCSV(data.expenses, data.settlements, data.partners, prefs.currencyCode);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `partners-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("CSV downloaded");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Appearance & currency</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Color mode</legend>
            <div className="grid grid-cols-3 gap-2">
              {(["light", "dark", "system"] as ThemeMode[]).map((mode) => (
                <Button key={mode} variant={prefs.theme === mode ? "default" : "outline"}
                  aria-pressed={prefs.theme === mode} onClick={() => {
                    try { setTheme(mode); } catch { toast.error("Your browser couldn't save this preference."); }
                  }}>
                  {mode === "light" ? "Light" : mode === "dark" ? "Dark" : "System"}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Saved on this device. System follows your phone or computer.</p>
          </fieldset>
          <Separator />
          <div className="space-y-2">
            <Label htmlFor="currency-code">Currency label (this device)</Label>
            <select id="currency-code" value={prefs.currencyCode}
              onChange={(e) => setPendingCurrency(e.target.value === prefs.currencyCode ? null : e.target.value)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-ring">
              {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
            </select>
            <p className="text-sm">Preview: <span className="font-semibold tabular-nums">{formatINR(10000)}</span></p>
            <p className="text-xs text-muted-foreground">
              Changes labels and number formatting across amounts, reports and CSV exports. It does not convert money or change saved amounts.
              Both partners must use the same currency label; this choice is not synced.
            </p>
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={pendingCurrency !== null} onOpenChange={(open) => { if (!open) setPendingCurrency(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Use {pendingCurrency} labels?</AlertDialogTitle>
            <AlertDialogDescription>
              A saved amount of 100 {prefs.currencyCode} will display as 100 {pendingCurrency}, not its converted value.
              Only this device changes. Use this only if the new label matches the currency of your book.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep {prefs.currencyCode}</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (!pendingCurrency) return;
              try {
                setCurrency(pendingCurrency);
                toast.success(`Currency label changed to ${getCurrencyConfig(pendingCurrency).code}. Amounts unchanged.`);
              } catch { toast.error("Your browser couldn't save this preference."); }
              setPendingCurrency(null);
            }}>Change label</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Partners list + add */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Partners ({partners.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {partners.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border p-3">
              <PartnerAvatar partner={p} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">{p.username ?? "—"}</p>
              </div>
              {p.id === session.partner.id && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">You</span>
              )}
            </div>
          ))}
          {partners.length < 2 && (
            <>
              <Separator />
              <p className="text-sm text-muted-foreground">
                Add your partner yourself: set their name and login, then share the one-tap joining link.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="partner-name">Partner's name</Label>
                <Input id="partner-name" value={addName} onChange={(e) => setAddName(e.target.value)}
                  placeholder="e.g. Sara" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="partner-username">Username</Label>
                <Input id="partner-username" value={addUsername} onChange={(e) => setAddUsername(e.target.value)}
                  placeholder="sara" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="partner-password">Password (6+ characters)</Label>
                <Input id="partner-password" type="password" value={addPassword}
                  onChange={(e) => setAddPassword(e.target.value)} autoComplete="new-password" />
              </div>
              <Button className="w-full" onClick={submitAddPartner} disabled={addBusy}>
                {addBusy ? "Adding…" : "Add partner & get joining link"}
              </Button>
              <Separator />
              <p className="text-xs text-muted-foreground">
                Or send a link so they create their own account:
              </p>
              <InviteCard />
            </>
          )}
          {partners.length >= 2 && data?.invitePartnerId && data?.inviteCode && (
            <>
              <Separator />
              <p className="text-xs text-muted-foreground">
                {data.partners.find((p) => p.id === data.invitePartnerId)?.name ?? "Your partner"} hasn't opened their joining link yet:
              </p>
              <InviteCard />
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            Recurring expenses
            <Button size="sm" onClick={() => { setEditingRule(null); setRecurringOpen(true); }}>+ Add</Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(data?.recurring ?? []).length === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">
              None yet. Add rent or subscriptions once — they appear automatically every month.
            </p>
          )}
          {(data?.recurring ?? []).map((rule) => (
            <div key={rule.id} className="flex items-center gap-3 rounded-xl border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {rule.merchant}
                  {!rule.active && <span className="ml-1.5 text-xs text-muted-foreground">(paused)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatINR(rule.amount_paise)} · {rule.category} · day {rule.day_of_month} · paid by{" "}
                  {partners.find((p) => p.id === rule.paid_by)?.name ?? "—"}
                </p>
              </div>
              <Switch
                checked={rule.active}
                onCheckedChange={(checked) => toggleRule(rule, checked)}
                aria-label={`Toggle ${rule.merchant}`}
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit recurring"
                onClick={() => { setEditingRule(rule); setRecurringOpen(true); }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Delete recurring">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove "{rule.merchant}"?</AlertDialogTitle>
                    <AlertDialogDescription>
                      No new monthly entries will be added. Expenses already recorded stay in your history.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep it</AlertDialogCancel>
                    <AlertDialogAction onClick={() => removeRule(rule)}>Remove</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Settlement history</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {(data?.settlements ?? []).length === 0 && (
            <p className="py-3 text-center text-sm text-muted-foreground">No repayments recorded yet.</p>
          )}
          {(data?.settlements ?? []).map((s) => {
            const from = partners.find((p) => p.id === s.from_partner);
            const to = partners.find((p) => p.id === s.to_partner);
            return (
              <div key={s.id} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="flex items-center gap-1">
                  <PartnerAvatar partner={from} size="sm" />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5 text-muted-foreground"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
                  <PartnerAvatar partner={to} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{from?.name} → {to?.name}</p>
                  <p className="text-xs text-muted-foreground">{s.settle_date}{s.note ? ` · ${s.note}` : ""}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums">{formatINR(s.amount_paise)}</span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" aria-label="Delete settlement">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this settlement?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {from?.name} → {to?.name} {formatINR(s.amount_paise)} on {s.settle_date}. The balance recalculates.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Keep it</AlertDialogCancel>
                      <AlertDialogAction onClick={() => removeSettlement(s.id)}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Month closing</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Close a finished month to lock its entries — nothing in it can be added, edited or deleted until you reopen it.
          </p>
          {pastMonths.map((m) => {
            const close = closeMonths.find((c) => c.month === m);
            const live = expensesInMonth(data?.expenses ?? [], m);
            const liveTotal = totalPaise(live);
            const busy = monthBusy === m;
            return (
              <div key={m} className="flex items-center gap-3 rounded-xl border p-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {monthLabel(m)}
                    {close ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Closed</span>
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Open</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {live.length} expense{live.length === 1 ? "" : "s"} · {formatINR(liveTotal)}
                  </p>
                </div>
                {close ? (
                  <>
                    {close.summary && (
                      <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setOpenSummary(close)}>
                        View
                      </Button>
                    )}
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="shrink-0" disabled={busy}>
                          {busy ? "…" : "Reopen"}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Reopen {monthLabel(m)}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Entries in {monthLabel(m)} become editable again. The saved closing snapshot is discarded.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Keep it closed</AlertDialogCancel>
                          <AlertDialogAction onClick={() => doReopenMonth(m)}>Reopen</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                ) : (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="shrink-0" disabled={busy}>
                        {busy ? "…" : "Close"}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Close {monthLabel(m)}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          {live.length} expense{live.length === 1 ? "" : "s"} totalling {formatINR(liveTotal)} will be locked —
                          no adds, edits or deletes in this month. A snapshot of the totals is saved. You can reopen it later.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Not yet</AlertDialogCancel>
                        <AlertDialogAction onClick={() => doCloseMonth(m)}>Close month</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Your profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <PartnerAvatar partner={me} size="lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" disabled={avatarBusy} onClick={() => photoInputRef.current?.click()}>
                  {avatarBusy ? "Saving…" : me?.avatar_url ? "Change photo" : "Upload photo"}
                </Button>
                {(me?.avatar_url || me?.avatar_emoji) && (
                  <Button variant="ghost" size="sm" disabled={avatarBusy}
                    onClick={() => applyAvatar(null, null, "Avatar removed.")}>
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Or pick an emoji — it appears next to your name across the app.
              </p>
            </div>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }}
          />
          <div className="grid grid-cols-8 gap-1.5">
            {AVATAR_EMOJI_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                disabled={avatarBusy}
                aria-label={`Use ${emoji} as avatar`}
                onClick={() => applyAvatar(emoji, null, "Emoji avatar set.")}
                className={cn(
                  "flex h-9 items-center justify-center rounded-lg border text-lg transition-colors hover:bg-muted disabled:opacity-50",
                  me?.avatar_emoji === emoji && !me?.avatar_url && "border-primary bg-primary/5 ring-1 ring-primary",
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
          <Separator />
          <div className="space-y-1.5">
            <Label htmlFor="display-name">Your name</Label>
            <Input
              id="display-name"
              value={newName}
              maxLength={40}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter your display name"
            />
          </div>
          <Button
            onClick={submitRename}
            disabled={nameBusy || !newName.trim() || newName.trim() === session.partner.name}
          >
            {nameBusy ? "Saving…" : "Save name"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-sm">Change password</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="current-pw">Current password</Label>
            <Input id="current-pw" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-pw">New password</Label>
            <Input id="new-pw" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <Button onClick={submitPassword} disabled={pwBusy || !currentPassword || newPassword.length < 6}>
            {pwBusy ? "Changing…" : "Change password"}
          </Button>
        </CardContent>
      </Card>

      <Separator />

      <div className="flex flex-col gap-2 pb-4">
        <Button variant="outline" onClick={exportCSV}>Export everything (CSV)</Button>
        <Button variant="outline" onClick={signOut}>Sign out</Button>
        <p className="text-center text-xs text-muted-foreground">
          Signed in as {session.partner.name} · data covers {data ? `${data.range.from} → ${data.range.to}` : "—"}
        </p>
      </div>

      <RecurringForm
        open={recurringOpen}
        onOpenChange={(next) => { setRecurringOpen(next); if (!next) setEditingRule(null); }}
        editing={editingRule}
        onClosed={() => setEditingRule(null)}
      />

      <Dialog open={!!openSummary} onOpenChange={(next) => { if (!next) setOpenSummary(null); }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{openSummary ? `Closing snapshot · ${monthLabel(openSummary.month)}` : ""}</DialogTitle>
            <DialogDescription>
              Saved {openSummary ? openSummary.closedAt.slice(0, 10) : ""}
              {openSummary ? ` by ${partners.find((p) => p.id === openSummary.closedBy)?.name ?? "—"}` : ""}. Totals at the moment the month was locked.
            </DialogDescription>
          </DialogHeader>
          {summary && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Total spent</p>
                  <p className="text-lg font-semibold tabular-nums">{formatINR(summary.totalPaise)}</p>
                </div>
                <div className="rounded-xl bg-muted/60 p-3">
                  <p className="text-xs text-muted-foreground">Expenses</p>
                  <p className="text-lg font-semibold tabular-nums">{summary.expenseCount}</p>
                </div>
              </div>
              {summary.byCategory.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">By category</p>
                  <div className="space-y-1">
                    {summary.byCategory.map((c) => (
                      <div key={c.name} className="flex justify-between">
                        <span>{c.name}</span>
                        <span className="font-medium tabular-nums">{formatINR(c.paise)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Paid / fair share</p>
                <div className="space-y-1">
                  {partners.map((p) => (
                    <div key={p.id} className="flex justify-between">
                      <span>{p.name}</span>
                      <span className="tabular-nums">
                        {formatINR(summary.paidBy[p.id] ?? 0)} paid · {formatINR(summary.sharesBy[p.id] ?? 0)} share
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Repayments in this month</p>
                <p className="text-muted-foreground">
                  {summary.settlements.count} settlement{summary.settlements.count === 1 ? "" : "s"} · {formatINR(summary.settlements.totalPaise)}
                </p>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Balance when closed</p>
                {summary.debts.length === 0 ? (
                  <p className="text-muted-foreground">All settled up.</p>
                ) : (
                  <div className="space-y-1">
                    {summary.debts.map((d, i) => (
                      <div key={i} className="flex justify-between">
                        <span>{d.fromName} owes {d.toName}</span>
                        <span className="font-medium tabular-nums">{formatINR(d.amountPaise)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Keep in sync with AVATAR_EMOJI in functions/handler.mjs.
const AVATAR_EMOJI_CHOICES = ["🐱", "🐶", "🦊", "🐻", "🐼", "🦁", "🐨", "🐸", "🐵", "🐧", "🦄", "🌸", "🌟", "⚽", "🎮", "☕"];

/** Downscale a picked photo to a small square data URL the backend accepts. */
async function shrinkToAvatarDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) return null;
  try {
    let source: ImageBitmap | HTMLImageElement;
    if (typeof createImageBitmap === "function") {
      try {
        source = await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        source = await loadImageElement(file);
      }
    } else {
      source = await loadImageElement(file);
    }
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const scale = Math.max(size / source.width, size / source.height);
    const w = Math.max(1, Math.round(source.width * scale));
    const h = Math.max(1, Math.round(source.height * scale));
    ctx.drawImage(source, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
    if (source instanceof ImageBitmap) source.close();
    let out = canvas.toDataURL("image/webp", 0.8);
    if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", 0.85);
    return out.length <= 120000 ? out : null;
  } catch {
    return null;
  }
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed")); };
    img.src = url;
  });
}
