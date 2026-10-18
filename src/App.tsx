import { useCallback, useEffect, useMemo, useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import {
  ApiError, bootstrap, clearSession, getData, loadSession, login as apiLogin, logout as apiLogout,
  saveSession, setup as apiSetup, sync,
} from "./api";
import type { DataResponse, Expense, SessionInfo } from "./types";
import { currentMonthKey, monthKeyAdd, todayISO } from "./compute";
import { AppCtx, type AppCtxValue } from "./app-context";
import { LoginScreen, SetupScreen, AcceptInviteScreen, JoinScreen } from "./views/AuthViews";
import { Dashboard } from "./views/Dashboard";
import { ExpensesView } from "./views/ExpensesView";
import { ReportsView } from "./views/Reports";
import { MoreView } from "./views/MoreView";
import { ExpenseForm } from "./components/ExpenseForm";
import { SettleForm } from "./components/SettleForm";
import { PartnerAvatar } from "./components/ui-bits";
import { formatINR } from "./money";
import { usePrefs } from "./usePrefs";
import { getCurrencyConfig } from "./preferences";
import { cn } from "@/lib/utils";

type Phase = "loading" | "setup" | "login" | "accept" | "join" | "app";
type View = "home" | "expenses" | "reports" | "more";

const NAV: { key: View; label: string; icon: string }[] = [
  { key: "home", label: "Home", icon: "M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1z" },
  { key: "expenses", label: "Expenses", icon: "M4 6h16M4 12h16M4 18h10" },
  { key: "reports", label: "Reports", icon: "M4 20V10m6 10V4m6 16v-7" },
  { key: "more", label: "More", icon: "M12 8h.01M12 12h.01M12 16h.01" },
];

export default function App() {
  const prefs = usePrefs();
  const currency = getCurrencyConfig(prefs.currencyCode);
  const [phase, setPhase] = useState<Phase>("loading");
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [data, setData] = useState<DataResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("home");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [settleOpen, setSettleOpen] = useState(false);

  const load = useCallback(async (activeSession: SessionInfo) => {
    setLoading(true);
    try {
      await sync(activeSession.token);
      const from = `${monthKeyAdd(currentMonthKey(), -12)}-01`;
      const to = todayISO();
      let base: DataResponse | null = null;
      let allExpenses: Expense[] = [];
      let offset = 0;
      for (let page = 0; page < 40; page++) {
        const result = await getData(activeSession.token, from, to, offset);
        if (!base) base = result;
        allExpenses = [...allExpenses, ...result.expenses];
        if (!result.hasMore) break;
        offset = result.nextOffset ?? 0;
      }
      setData(base ? { ...base, expenses: allExpenses } : null);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.code === "login_required")) {
        clearSession();
        setSession(null);
        setData(null);
        // Re-check whether setup is still needed (e.g. DB was reset)
        try {
          const setupRequired = await bootstrap();
          setPhase(setupRequired ? "setup" : "login");
        } catch {
          setPhase("login");
        }
        toast.error("Session expired. Sign in again.");
      } else if (error instanceof ApiError) {
        toast.error(error.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = loadSession();
      if (stored) {
        setSession(stored);
        setPhase("app");
        await load(stored);
        return;
      }
      const inviteParam = new URLSearchParams(window.location.search).get("invite");
      const joinParam = new URLSearchParams(window.location.search).get("join");
      try {
        const setupRequired = await bootstrap();
        if (cancelled) return;
        if (setupRequired) setPhase("setup");
        else if (inviteParam && /^[A-Za-z2-9]{8}$/.test(inviteParam)) setPhase("accept");
        else if (joinParam && /^[A-Za-z2-9]{8}$/.test(joinParam)) setPhase("join");
        else setPhase("login");
      } catch {
        if (!cancelled) setPhase("login");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSetupDone = async (sessionInfo: SessionInfo) => {
    setSession(sessionInfo);
    saveSession(sessionInfo);
    setPhase("app");
    await load(sessionInfo);
  };

  const handleLogin = async (sessionInfo: SessionInfo) => {
    setSession(sessionInfo);
    saveSession(sessionInfo);
    setPhase("app");
    await load(sessionInfo);
  };

  const signOut = useCallback(async () => {
    if (session) await apiLogout(session.token);
    clearSession();
    setSession(null);
    setData(null);
    setPhase("login");
  }, [session]);

  const refresh = useCallback(async () => {
    if (session) await load(session);
  }, [session, load]);

  const openAdd = useCallback(() => { setEditing(null); setAddOpen(true); }, []);
  const openEdit = useCallback((expense: Expense) => { setEditing(expense); setAddOpen(true); }, []);
  const openSettle = useCallback(() => { setSettleOpen(true); }, []);

  const ctxValue = useMemo<AppCtxValue | null>(() => (
    session ? { session, data, loading, refresh, openAdd, openEdit, openSettle, signOut } : null
  ), [session, data, loading, refresh, openAdd, openEdit, openSettle, signOut]);

  const debts = data?.debts ?? [];
  const myDebt = debts.find((d) => d.fromId === session?.partner.id);
  const theyOweMe = debts.find((d) => d.toId === session?.partner.id && d.fromId !== session?.partner.id);

  if (phase === "loading" || (phase === "app" && !session)) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-primary/20" />
          <p className="text-sm text-muted-foreground">Loading Partners…</p>
        </div>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <>
        <SetupScreen onDone={handleSetupDone} />
        <Toaster position="top-center" richColors theme={prefs.theme} />
      </>
    );
  }

  if (phase === "accept") {
    const inviteParam = new URLSearchParams(window.location.search).get("invite") ?? "";
    return (
      <>
        <AcceptInviteScreen
          code={inviteParam.toUpperCase()}
          onDone={() => {
            window.history.replaceState(null, "", window.location.pathname);
            toast.success("You're in! Sign in with your new username.");
            setPhase("login");
          }}
        />
        <Toaster position="top-center" richColors theme={prefs.theme} />
      </>
    );
  }

  if (phase === "join") {
    const joinParam = new URLSearchParams(window.location.search).get("join") ?? "";
    return (
      <>
        <JoinScreen
          code={joinParam.toUpperCase()}
          onDone={(sessionInfo) => {
            window.history.replaceState(null, "", window.location.pathname);
            toast.success(`Welcome, ${sessionInfo.partner.name}! You're signed in on this device.`);
            void handleLogin(sessionInfo);
          }}
        />
        <Toaster position="top-center" richColors theme={prefs.theme} />
      </>
    );
  }

  if (phase === "login") {
    return (
      <>
        <LoginScreen onLogin={handleLogin} />
        <Toaster position="top-center" richColors theme={prefs.theme} />
      </>
    );
  }

  return (
    <AppCtx.Provider value={ctxValue!}>
      <div className="min-h-dvh bg-background pb-20 md:pb-0">
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur no-print">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <span className={currency.code === "SAR" ? "text-xl" : "text-[10px] font-bold"}>{currency.code === "SAR" ? currency.symbol : currency.code}</span>
              </div>
              <div className="leading-tight">
                <p className="text-sm font-semibold">Partners</p>
                <p className="text-[11px] text-muted-foreground">50/50 expense book</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              {myDebt ? (
                <button
                  onClick={openSettle}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900 ring-1 ring-slate-300 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:ring-slate-600 dark:hover:bg-slate-700"
                  title="Record a repayment"
                >
                  You owe {formatINR(myDebt.amountPaise)}
                </button>
              ) : theyOweMe ? (
                <button
                  onClick={openSettle}
                  className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 transition-colors hover:bg-emerald-100 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900"
                  title="Record a repayment"
                >
                  {theyOweMe.fromName} owes you {formatINR(theyOweMe.amountPaise)}
                </button>
              ) : (
                <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900">
                  Settled up
                </span>
              )}
              <span className="hidden items-center gap-1.5 rounded-full bg-muted py-1 pl-1 pr-3 text-xs font-medium text-muted-foreground sm:inline-flex">
                <PartnerAvatar partner={data?.partners.find((p) => p.id === session?.partner.id)} size="sm" />
                {session?.partner.name}
              </span>
            </div>
          </div>
          <nav className="mx-auto hidden max-w-5xl gap-1 px-4 pb-2 md:flex">
            {NAV.map((item) => (
              <button
                key={item.key}
                onClick={() => setView(item.key)}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                  view === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {item.label}
              </button>
            ))}
            <button
              onClick={openAdd}
              className="ml-auto rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              + Add expense
            </button>
          </nav>
        </header>

        <main className="mx-auto max-w-5xl px-4 py-4 md:py-6">
          {view === "home" && <Dashboard />}
          {view === "expenses" && <ExpensesView />}
          {view === "reports" && <ReportsView />}
          {view === "more" && <MoreView />}
        </main>

        <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur md:hidden no-print">
          <div className="mx-auto grid max-w-md grid-cols-5">
            {NAV.slice(0, 2).map((item) => (
              <NavButton key={item.key} item={item} active={view === item.key} onClick={() => setView(item.key)} />
            ))}
            <button
              onClick={openAdd}
              aria-label="Add expense"
              className="flex items-center justify-center"
            >
              <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-2xl font-light text-primary-foreground shadow-lg shadow-primary/30">
                +
              </span>
            </button>
            {NAV.slice(2).map((item) => (
              <NavButton key={item.key} item={item} active={view === item.key} onClick={() => setView(item.key)} />
            ))}
          </div>
        </nav>

        <ExpenseForm open={addOpen} onOpenChange={setAddOpen} editing={editing} onClosed={() => setEditing(null)} />
        <SettleForm open={settleOpen} onOpenChange={setSettleOpen} />
        <Toaster position="top-center" richColors theme={prefs.theme} />
      </div>
    </AppCtx.Provider>
  );
}

function NavButton({ item, active, onClick }: {
  item: { key: string; label: string; icon: string };
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-0.5 py-2">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn("h-5 w-5", active ? "text-primary" : "text-muted-foreground")}
      >
        <path d={item.icon} />
      </svg>
      <span className={cn("text-[10px] font-medium", active ? "text-primary" : "text-muted-foreground")}>
        {item.label}
      </span>
    </button>
  );
}
