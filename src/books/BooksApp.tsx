import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { ArrowLeft, ArrowRight, BookOpen, Check, Copy, Link2, Loader2, LockKeyhole, Plus, ShieldCheck, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Toaster } from "@/components/ui/sonner";
import { CURRENCIES, getCurrencyConfig, setTheme, type ThemeMode } from "../preferences";
import { formatINR } from "../money";
import { usePrefs } from "../usePrefs";
import { acceptBookInvite, booksClient, createBook, createInvite, friendlyError, listBooks, newInviteToken, revokeInvite, type BookSplit, type ExpenseBook } from "./client";

const TOKEN = /^[0-9a-f]{64}$/i;
const INVITE_STORAGE_PREFIX = "partners-books:pending-invite:";
const INVITE_RETENTION = 7 * 24 * 60 * 60 * 1000;
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const fieldClass = "space-y-2";
const splitOptions: { value: BookSplit; title: string; description: string }[] = [
  { value: "equal", title: "Equal", description: "Start with an equal share for everyone in the book." },
  { value: "custom", title: "Custom", description: "Plan to enter each person's share when expense entry is available." },
  { value: "personal", title: "Personal", description: "Keep a personal default, with no shared split." },
];

type PendingInvite = { token: string; userId: string | null; savedAt: number };
type Notice = { kind: "error" | "success" | "info"; text: string } | null;
type ScopeCheck = () => boolean;

function storageKey(userId: string | null) {
  // The anonymous slot is only for carrying an explicitly opened link through login.
  // Once authenticated it is moved into the user's own session-storage slot.
  return INVITE_STORAGE_PREFIX + (userId ?? "before-login");
}

function readPending(userId: string | null): PendingInvite | null {
  try {
    const raw = sessionStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && "token" in value && "userId" in value && "savedAt" in value
      && typeof value.token === "string" && TOKEN.test(value.token) && value.userId === userId
      && typeof value.savedAt === "number" && value.savedAt <= Date.now() && Date.now() - value.savedAt < INVITE_RETENTION) {
      return { token: value.token.toLowerCase(), userId, savedAt: value.savedAt };
    }
    sessionStorage.removeItem(storageKey(userId));
  } catch { /* Storage is optional; a URL invitation still works in memory. */ }
  return null;
}

function forgetPending(userId: string | null) {
  try { sessionStorage.removeItem(storageKey(userId)); } catch { /* Never clear unrelated storage. */ }
}

function inviteFromHash(): { token: string | null; invalid: boolean } {
  const hash = window.location.hash;
  const match = /^#invite=([0-9a-f]{64})$/i.exec(hash);
  return { token: match?.[1].toLowerCase() ?? null, invalid: /^#invite=/i.test(hash) && !match };
}

function removeInviteHash() {
  // Do not touch PKCE query parameters or Supabase's access/error callback hashes.
  if (!/^#invite=[0-9a-f]{64}$/i.test(window.location.hash)) return;
  try { window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search); } catch { /* Keep the fragment rather than navigate. */ }
}

function parseInvite(value: string): string | null {
  const trimmed = value.trim();
  if (TOKEN.test(trimmed)) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== "/books-setup" || url.search) return null;
    return /^#invite=([0-9a-f]{64})$/i.exec(url.hash)?.[1].toLowerCase() ?? null;
  } catch { return null; }
}

function displayNameFor(user: User) {
  const name: unknown = user.user_metadata?.display_name;
  return typeof name === "string" && name.trim().length <= 40 ? name.trim() : "";
}

function useLiveScope(isCurrent: ScopeCheck) {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return useCallback(() => mounted.current && isCurrent(), [isCurrent]);
}

function Message({ notice }: { notice: Notice }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {notice && <p role={notice.kind === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm leading-relaxed ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200" : "border-teal-200 bg-teal-50 text-teal-950 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-100"}`}>{notice.text}</p>}
    </div>
  );
}

function FieldError({ id, text }: { id: string; text?: string }) {
  return text ? <p id={id} className="text-sm text-red-700 dark:text-red-300">{text}</p> : null;
}

function CurrencyPreview({ code }: { code: string }) {
  const cfg = getCurrencyConfig(code);
  // The legacy formatter takes hundredths. JPY is explicitly formatted as 100
  // whole yen, not used as evidence of the new book's minor-unit metadata.
  const sample = code === "JPY"
    ? new Intl.NumberFormat(cfg.locale, { style: "currency", currency: cfg.code, maximumFractionDigits: 0 }).format(100)
    : formatINR(10000, cfg);
  return <div className="rounded-lg bg-muted p-3 text-sm"><span className="font-semibold tabular-nums">{sample}</span><span className="text-muted-foreground"> · formatting sample, not a balance</span><p className="mt-1 text-xs text-muted-foreground">{code === "JPY" ? "JPY uses whole yen (0 decimal places)." : "This book uses 2 decimal places."} Your existing book's currency is unchanged.</p></div>;
}

/** Integration must also keep this route DEV-only; no existing app state is used. */
export default function BooksApp() {
  if (!import.meta.env.DEV) {
    return <main className="mx-auto max-w-lg p-6"><h1 className="text-xl font-semibold">New books setup preview</h1><p className="my-4 text-muted-foreground">This setup preview is available only in development. Your existing expense book is unchanged.</p><a className="text-primary underline" href="/">Return to existing expense book</a></main>;
  }
  return <BooksSetupPreview />;
}

function BooksSetupPreview() {
  const prefs = usePrefs();
  const [auth, setAuth] = useState<{ ready: boolean; user: User | null; revision: number }>({ ready: false, user: null, revision: 0 });
  const identity = useRef<{ id: string | null | undefined; revision: number }>({ id: undefined, revision: 0 });
  const [pending, setPending] = useState<PendingInvite | null>(null);
  const pendingRef = useRef<PendingInvite | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [authCheck, setAuthCheck] = useState(0);
  const [authCheckFailed, setAuthCheckFailed] = useState(false);
  const mounted = useRef(false);

  const retainPending = useCallback((invitation: PendingInvite | null) => {
    pendingRef.current = invitation;
    setPending(invitation);
    if (!invitation) return;
    try {
      sessionStorage.setItem(storageKey(invitation.userId), JSON.stringify(invitation));
      if (invitation.userId) forgetPending(null);
    } catch {
      setNotice({ kind: "info", text: "This browser cannot retain the invitation through a reload. Keep the original link and reopen it after confirming your email." });
    }
  }, []);

  const clearPending = useCallback(() => {
    if (pendingRef.current) forgetPending(pendingRef.current.userId);
    if (typeof identity.current.id === "string") forgetPending(identity.current.id);
    forgetPending(null);
    retainPending(null);
    removeInviteHash();
  }, [retainPending]);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let eventVersion = 0;
    setAuthCheckFailed(false);

    const applyUser = (user: User | null, signedOut = false) => {
      if (!active) return;
      const nextId = user?.id ?? null;
      const previousId = identity.current.id;
      const changed = previousId !== nextId;
      if (changed || signedOut) identity.current = { id: nextId, revision: identity.current.revision + 1 };
      if (signedOut || (typeof previousId === "string" && changed)) {
        forgetPending(previousId ?? null);
        clearPending();
        setNotice(null);
      } else if (changed || previousId === undefined) {
        const incoming = inviteFromHash();
        const carried = pendingRef.current;
        const invitation = incoming.token
          ? { token: incoming.token, userId: nextId, savedAt: Date.now() }
          : carried && (carried.userId === nextId || carried.userId === null)
            ? { ...carried, userId: nextId }
            : readPending(nextId) ?? (nextId ? readPending(null) : null);
        retainPending(invitation ? { ...invitation, userId: nextId } : null);
        if (incoming.token) removeInviteHash();
        if (incoming.invalid) setNotice({ kind: "error", text: "This invitation link is incomplete. Ask the owner for the full link, or paste a valid code after signing in." });
      }
      setAuth({ ready: true, user, revision: identity.current.revision });
      setAuthCheckFailed(false);
    };

    // This callback is synchronous: starting/awaiting another auth call here can
    // deadlock the SDK's auth lock. Book reads start in a child effect instead.
    const { data: { subscription } } = booksClient.auth.onAuthStateChange((event, session) => {
      eventVersion += 1;
      applyUser(session?.user ?? null, event === "SIGNED_OUT");
    });
    const versionAtRead = eventVersion;
    void booksClient.auth.getSession().then(({ data, error }) => {
      if (!active || eventVersion !== versionAtRead) return;
      if (error) throw error;
      applyUser(data.session?.user ?? null);
    }).catch((error: unknown) => {
      if (!active || eventVersion !== versionAtRead) return;
      setNotice({ kind: "error", text: friendlyError(error) });
      setAuthCheckFailed(true);
    });

    const captureHash = () => {
      const incoming = inviteFromHash();
      if (incoming.token) {
        retainPending({ token: incoming.token, userId: identity.current.id ?? null, savedAt: Date.now() });
        removeInviteHash();
      } else if (incoming.invalid) {
        setNotice({ kind: "error", text: "That invitation link is incomplete. Ask the owner to copy the full link." });
      }
    };
    window.addEventListener("hashchange", captureHash);
    const callbackParams = new URLSearchParams(window.location.hash.slice(1));
    if (callbackParams.has("error") || new URLSearchParams(window.location.search).has("error")) {
      setNotice({ kind: "error", text: "Email confirmation could not be completed. Try signing in, or open your latest confirmation email in the browser where you registered." });
    }
    return () => {
      active = false;
      mounted.current = false;
      subscription.unsubscribe();
      window.removeEventListener("hashchange", captureHash);
    };
  }, [authCheck, clearPending, retainPending]);

  const isCurrent = useCallback(() => identity.current.id === (auth.user?.id ?? null) && identity.current.revision === auth.revision, [auth.user?.id, auth.revision]);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setNotice(null);
    try {
      const { error } = await booksClient.auth.signOut({ scope: "local" });
      if (error) throw error;
      // SIGNED_OUT normally clears everything synchronously. Also clear the
      // pending link when the SDK already had no session to sign out.
      if (mounted.current && identity.current.id === null) clearPending();
    } catch (error) {
      if (mounted.current && isCurrent()) setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      if (mounted.current) setSigningOut(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <a href="/" className="inline-flex items-center gap-2 rounded-md text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring"><span className="rounded-lg bg-primary p-2 text-primary-foreground"><BookOpen aria-hidden="true" className="size-5" /></span>Partners Expenses</a>
          <div className="flex items-center gap-2">
            <Label htmlFor="books-theme" className="sr-only">Color theme</Label>
            <select id="books-theme" className={`${selectClass} w-auto`} value={prefs.theme} onChange={event => {
              try { setTheme(event.target.value as ThemeMode); } catch { setNotice({ kind: "error", text: "The theme preference could not be saved in this browser." }); }
            }}><option value="system">System theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option></select>
            {auth.user && <Button type="button" variant="outline" className="h-11" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "Signing out…" : "Sign out"}</Button>}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 sm:py-10">
        <section aria-labelledby="preview-heading" className="space-y-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-teal-50 px-3 py-1 text-xs font-semibold tracking-wide text-teal-900 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-200"><LockKeyhole aria-hidden="true" className="size-3" /> DEVELOPMENT ONLY</span>
          <div className="max-w-2xl space-y-2"><h1 id="preview-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">New books setup preview</h1><p className="text-base leading-relaxed text-muted-foreground">A separate space for your own books, your people, and a currency for each book.</p></div>
          <div className="flex gap-3 rounded-xl border bg-card p-4 text-sm leading-relaxed"><ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" /><p>Connected to a <strong>new Supabase project</strong>. Account, book, and invitation actions here are real. Your existing expense book is unchanged. <strong>Expense entry and history migration are not enabled in this preview.</strong></p></div>
          <ol aria-label="Setup stages" className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
            {["Your account", "Your book", "Your people"].map((label, index) => <li key={label} className={`flex items-center gap-2 rounded-lg px-2 py-3 sm:px-3 ${index === (auth.user ? 1 : 0) ? "bg-accent font-semibold text-accent-foreground" : "text-muted-foreground"}`}><span className="font-mono text-xs">0{index + 1}</span>{label}</li>)}
          </ol>
        </section>
        <Message notice={notice} />
        {!auth.ready ? <Card><CardContent className="flex flex-col items-start gap-4"><p role="status" className="flex items-center gap-2 text-sm"><Loader2 aria-hidden="true" className="size-4 animate-spin" />Checking your new-project session…</p>{authCheckFailed && <Button type="button" variant="outline" onClick={() => setAuthCheck(value => value + 1)}>Retry session check</Button>}</CardContent></Card>
          : auth.user ? <UserBooks key={`${auth.user.id}:${auth.revision}`} user={auth.user} isCurrent={isCurrent} pendingToken={pending?.userId === auth.user.id ? pending.token : null} clearPending={clearPending} />
            : <AuthForm key={`signed-out:${auth.revision}`} isCurrent={isCurrent} hasInvite={Boolean(pending)} />}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-xs text-muted-foreground"><span>Private books · setup only · no ledger migration</span><a href="/" className="rounded text-primary underline underline-offset-4">Back to existing expense book</a></footer>
      </main>
      <Toaster position="top-center" richColors theme={prefs.theme} />
    </div>
  );
}

function AuthForm({ isCurrent, hasInvite }: { isCurrent: ScopeCheck; hasInvite: boolean }) {
  const live = useLiveScope(isCurrent);
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [nameError, setNameError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !live()) return;
    if (mode === "signup" && (!name.trim() || name.trim().length > 40)) {
      setNameError("Enter a display name with 1–40 characters.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setNotice({ kind: "error", text: "Choose a password with at least 8 characters." });
      return;
    }
    lock.current = true;
    setBusy(true);
    setNotice(null);
    setNameError("");
    try {
      if (mode === "signup") {
        const { data, error } = await booksClient.auth.signUp({ email: email.trim(), password, options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin + "/books-setup" } });
        if (error) throw error;
        if (live() && !data.session) {
          setNotice({ kind: "info", text: "Check your email. If this address can be registered, a confirmation link will arrive from Supabase. Open it in this browser, then sign in. If you already have an account, sign in instead. No book has been created." });
          setMode("login");
        }
      } else {
        const { error } = await booksClient.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (error) {
      if (live()) setNotice({ kind: "error", text: friendlyError(error) });
    } finally {
      // Passwords are only held by this input and this request; never persisted.
      setPassword("");
      lock.current = false;
      if (live()) setBusy(false);
    }
  }

  return <div className="grid items-start gap-6 md:grid-cols-[1.2fr_0.8fr]">
    <Card><CardHeader><h2 className="text-xl font-semibold">{mode === "signup" ? "Make a little room for your books" : "Welcome to your new books"}</h2><CardDescription>Use an account on the new project. Your existing app login is separate.</CardDescription></CardHeader><CardContent className="space-y-5">
      {hasInvite && <Message notice={{ kind: "info", text: "An invitation is waiting. Sign in or confirm your new account first, then review and explicitly join. Keep the original link if you confirm email in another tab or browser." }} />}
      <div className="grid grid-cols-2 gap-2" aria-label="Account action"><Button type="button" variant={mode === "signup" ? "default" : "outline"} aria-pressed={mode === "signup"} disabled={busy} onClick={() => { setMode("signup"); setPassword(""); setNotice(null); setNameError(""); }}>Create account</Button><Button type="button" variant={mode === "login" ? "default" : "outline"} aria-pressed={mode === "login"} disabled={busy} onClick={() => { setMode("login"); setPassword(""); setNotice(null); setNameError(""); }}>Sign in</Button></div>
      <form onSubmit={event => void submit(event)} className="space-y-4" aria-busy={busy}>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {mode === "signup" && <div className={fieldClass}><Label htmlFor="auth-name">Display name</Label><Input id="auth-name" className="h-11" autoComplete="nickname" required maxLength={40} value={name} aria-invalid={Boolean(nameError)} aria-describedby="auth-name-help auth-name-error" onChange={event => { setName(event.target.value); setNameError(""); }} /><p id="auth-name-help" className="text-xs text-muted-foreground">1–40 characters. This is the name other book members will see.</p><FieldError id="auth-name-error" text={nameError} /></div>}
          <div className={fieldClass}><Label htmlFor="auth-email">Email address</Label><Input id="auth-email" className="h-11" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required value={email} onChange={event => setEmail(event.target.value)} /></div>
          <div className={fieldClass}><Label htmlFor="auth-password">Password</Label><Input id="auth-password" className="h-11" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={mode === "signup" ? 8 : undefined} value={password} aria-describedby={mode === "signup" ? "auth-password-help" : undefined} onChange={event => setPassword(event.target.value)} />{mode === "signup" && <p id="auth-password-help" className="text-xs text-muted-foreground">At least 8 characters. Email confirmation is required before signing in.</p>}</div>
          <Button type="submit" className="h-11 w-full" disabled={busy}>{busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-4" />}{busy ? "Please wait…" : mode === "signup" ? "Create account & confirm email" : "Sign in"}</Button>
        </fieldset>
      </form>
      <Message notice={notice} />
    </CardContent></Card>
    <aside className="space-y-5 rounded-xl bg-muted/70 p-5 sm:p-6"><h2 className="font-semibold">Start fresh, at your pace</h2><ul className="space-y-5 text-sm">{[["A book you own", "Create a private book for a household, a trip, or just yourself."], ["A currency per book", "Choose the book's currency without changing the existing expense app."], ["Invite your people", "Share a seven-day group link when you are ready. Joining is always a separate action."]].map(([title, detail]) => <li key={title} className="flex gap-3"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><div><p className="font-medium">{title}</p><p className="mt-1 leading-relaxed text-muted-foreground">{detail}</p></div></li>)}</ul></aside>
  </div>;
}

function UserBooks({ user, isCurrent, pendingToken, clearPending }: { user: User; isCurrent: ScopeCheck; pendingToken: string | null; clearPending: () => void }) {
  const live = useLiveScope(isCurrent);
  const [books, setBooks] = useState<ExpenseBook[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<"books" | "create" | "join">("books");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const request = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const initialPending = useRef(pendingToken);
  const wantedBook = useRef<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ kind: "created" | "joined"; id: string } | null>(null);
  // Owned by the keyed user workspace, not the wizard: leaving the form to
  // refresh the list does not lose an unconfirmed operation's idempotency key.
  const creationIds = useRef(new Map<string, string>());

  const selectBook = useCallback((id: string | null) => {
    selectedRef.current = id;
    setSelectedId(id);
  }, []);

  const reload = useCallback(async () => {
    if (!live()) return;
    request.current.controller?.abort();
    const controller = new AbortController();
    const generation = ++request.current.generation;
    request.current.controller = controller;
    setLoading(true);
    setLoadError("");
    try {
      const result = await listBooks(controller.signal);
      if (!live() || controller.signal.aborted || generation !== request.current.generation) return;
      setBooks(result);
      const target = wantedBook.current ?? selectedRef.current;
      selectBook(result.some(book => book.id === target) ? target : null);
      if (wantedBook.current && !result.some(book => book.id === wantedBook.current)) {
        setLoadError("The confirmed book is not visible in this list yet. Refresh to check access; do not repeat the create or join action.");
      } else {
        wantedBook.current = null;
      }
    } catch (error) {
      if (live() && !controller.signal.aborted && generation === request.current.generation) setLoadError(friendlyError(error));
    } finally {
      if (live() && generation === request.current.generation) setLoading(false);
    }
  }, [live, selectBook]);

  useEffect(() => {
    // URL invitations take priority even if the visitor already has a session.
    if (!initialPending.current) void reload();
    return () => { request.current.generation += 1; request.current.controller?.abort(); };
  }, [reload]);

  const completeWrite = (kind: "created" | "joined", id: string) => {
    if (!live()) return;
    setConfirmed({ kind, id });
    wantedBook.current = id;
    selectBook(null);
    setMode("books");
    if (kind === "joined") clearPending();
    // A confirmed write is never retried because this separate read fails.
    void reload();
  };

  const leaveForm = () => {
    clearPending();
    setMode("books");
    void reload();
  };
  const selected = books?.find(book => book.id === selectedId) ?? null;
  const selectionIsCurrent = useCallback(() => live() && selectedRef.current === selectedId, [live, selectedId]);

  if (pendingToken || mode === "join") return <JoinBook key={pendingToken ?? "manual"} initialToken={pendingToken ?? ""} defaultName={displayNameFor(user)} isCurrent={isCurrent} onCancel={leaveForm} onJoined={id => completeWrite("joined", id)} />;
  if (mode === "create") return <CreateBookWizard defaultName={displayNameFor(user)} isCurrent={isCurrent} creationIds={creationIds.current} onCancel={() => setMode("books")} onCreated={id => completeWrite("created", id)} />;

  return <section aria-labelledby="my-books-heading" className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id="my-books-heading" className="text-xl font-semibold">My books</h2><p className="mt-1 break-all text-sm text-muted-foreground">Signed in as {user.email ?? "a new-project account"}</p></div><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="h-11" onClick={() => { selectBook(null); setConfirmed(null); setMode("join"); }}><Link2 aria-hidden="true" />Join a book</Button><Button type="button" className="h-11" onClick={() => { selectBook(null); setConfirmed(null); setMode("create"); }}><Plus aria-hidden="true" />Create a book</Button></div></div>
    <Message notice={confirmed ? { kind: "success", text: `${confirmed.kind === "created" ? "Book creation" : "Book membership"} confirmed.${loading ? " Refreshing your books…" : loadError ? " The list could not be verified. Use Refresh books below; the write will not be repeated." : " You can inspect the book below. Expense entry is not enabled."}` } : null} />
    <Message notice={loadError ? { kind: "error", text: loadError } : null} />
    <div className="grid items-start gap-5 md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <Card className="gap-4"><CardHeader className="flex flex-row items-center justify-between gap-2 px-4"><h3 className="text-sm font-semibold">Your private books</h3><Button type="button" variant="ghost" size="sm" disabled={loading} onClick={() => void reload()}>{loading ? "Refreshing…" : "Refresh books"}</Button></CardHeader><CardContent className="px-4" aria-busy={loading}>
        {books === null ? <p role="status" className="py-5 text-sm text-muted-foreground">{loading ? "Loading books from the new project…" : "Books have not loaded. Try refreshing."}</p> : books.length === 0 ? <div className="space-y-3 rounded-lg border border-dashed p-5"><BookOpen aria-hidden="true" className="size-7 text-primary" /><h4 className="font-medium">Your first book starts here</h4><p className="text-sm leading-relaxed text-muted-foreground">No books were returned for this account. Create one, or join with an owner's invitation.</p></div> : <ul className="space-y-2">{books.map(book => <li key={book.id}><button type="button" aria-pressed={book.id === selectedId} onClick={() => { wantedBook.current = null; setConfirmed(null); selectBook(book.id); }} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring ${book.id === selectedId ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted"}`}><span className="rounded-lg bg-muted p-2"><BookOpen aria-hidden="true" className="size-4" /></span><span className="min-w-0 flex-1"><span className="block break-words text-sm font-semibold">{book.name}</span><span className="mt-1 block text-xs text-muted-foreground">{book.currency_code} · {book.owner_id === user.id ? "Owner" : "Member"} · {book.book_members.length} {book.book_members.length === 1 ? "person" : "people"}</span></span><ArrowRight aria-hidden="true" className="size-4 shrink-0" /></button></li>)}</ul>}
      </CardContent></Card>
      {selected ? <BookDetails key={selected.id} book={selected} userId={user.id} isCurrent={selectionIsCurrent} /> : <div className="rounded-xl border border-dashed p-6 sm:p-8"><Users aria-hidden="true" className="mb-3 size-6 text-muted-foreground" /><h3 className="font-medium">A space for your people</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Select a book to inspect its members and settings. Owners can generate, replace, or revoke an invitation link.</p><p className="mt-4 text-xs text-muted-foreground">This is setup, not an expense dashboard. No sample records or migrated balances are shown.</p></div>}
    </div>
  </section>;
}

function CreateBookWizard({ defaultName, isCurrent, creationIds, onCancel, onCreated }: { defaultName: string; isCurrent: ScopeCheck; creationIds: Map<string, string>; onCancel: () => void; onCreated: (id: string) => void }) {
  const live = useLiveScope(isCurrent);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState(defaultName);
  const [currency, setCurrency] = useState("INR");
  const [split, setSplit] = useState<BookSplit>("equal");
  const [errors, setErrors] = useState<{ name?: string; displayName?: string }>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { stepHeading.current?.focus(); }, [step]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !live()) return;
    const invalid = { name: !name.trim() || name.trim().length > 80 ? "Enter a book name with 1–80 characters." : undefined, displayName: !displayName.trim() || displayName.trim().length > 40 ? "Enter your display name with 1–40 characters." : undefined };
    setErrors(invalid);
    if (invalid.name || invalid.displayName) { setStep(0); return; }
    if (step < 2) { setStep(step + 1); return; }
    lock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const details = { name: name.trim(), currencyCode: currency, defaultSplit: split, displayName: displayName.trim() };
      const fingerprint = JSON.stringify(details);
      let id = creationIds.get(fingerprint);
      if (!id) { id = crypto.randomUUID(); creationIds.set(fingerprint, id); }
      const result = await createBook({ id, ...details });
      if (!live()) return;
      creationIds.delete(fingerprint);
      onCreated(result);
    } catch (error) {
      if (live()) setNotice({ kind: "error", text: `${friendlyError(error)} If the outcome is uncertain, check My books or retry without changing the details. The same details reuse the same request ID while this page stays open.` });
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  }

  return <Card className="mx-auto max-w-2xl"><CardHeader><div className="flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Create your book</h2><span className="text-xs text-muted-foreground">Step {step + 1} of 3</span></div><CardDescription>A real private book on the new project. Nothing is created until you confirm.</CardDescription></CardHeader><CardContent className="space-y-5">
    <ol aria-label="Create book progress" className="grid grid-cols-3 gap-2">{["Details", "Default split", "Review"].map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={`border-t-2 pt-2 text-xs ${index <= step ? "border-primary font-medium text-foreground" : "border-border text-muted-foreground"}`}>{index + 1}. {label}</li>)}</ol>
    <h3 ref={stepHeading} tabIndex={-1} className="rounded font-semibold outline-none">{["Give this book a home", "Choose a starting split", "Everything look right?"][step]}</h3>
    <form className="space-y-5" aria-busy={busy} onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        {step === 0 && <>
          <div className={fieldClass}><Label htmlFor="book-name">Book name</Label><Input id="book-name" className="h-11" placeholder="e.g. Our household" required maxLength={80} value={name} aria-invalid={Boolean(errors.name)} aria-describedby="book-name-error" onChange={event => setName(event.target.value)} /><FieldError id="book-name-error" text={errors.name} /></div>
          <div className={fieldClass}><Label htmlFor="book-display-name">Your name in this book</Label><Input id="book-display-name" className="h-11" autoComplete="nickname" required maxLength={40} value={displayName} aria-invalid={Boolean(errors.displayName)} aria-describedby="book-display-name-error" onChange={event => setDisplayName(event.target.value)} /><FieldError id="book-display-name-error" text={errors.displayName} /></div>
          <div className={fieldClass}><Label htmlFor="book-currency">Book currency</Label><select id="book-currency" className={selectClass} value={currency} onChange={event => setCurrency(event.target.value)}>{CURRENCIES.map(cfg => <option key={cfg.code} value={cfg.code}>{cfg.code} — {cfg.name}</option>)}</select><p className="text-xs text-muted-foreground">Set for this book only; currency conversion is not available.</p></div>
          <CurrencyPreview code={currency} />
        </>}
        {step === 1 && <fieldset className="space-y-3"><legend className="mb-3 text-sm text-muted-foreground">This saves a default, not expense shares. Ledger editing comes later.</legend>{splitOptions.map(option => <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${split === option.value ? "border-primary bg-accent" : "border-border"}`}><input className="mt-1 size-4 shrink-0 accent-teal-700 focus-visible:outline-2 focus-visible:outline-ring dark:accent-teal-400" type="radio" name="default-split" value={option.value} checked={split === option.value} onChange={() => setSplit(option.value)} /><span><span className="block text-sm font-semibold">{option.title}</span><span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{option.description}</span></span></label>)}</fieldset>}
        {step === 2 && <><dl className="space-y-4 rounded-xl border p-4 text-sm">{[["Book name", name.trim()], ["Your display name", displayName.trim()], ["Currency", `${currency} · ${getCurrencyConfig(currency).name}`], ["Default split", splitOptions.find(option => option.value === split)?.title ?? split], ["Your role", "Owner"]].map(([label, value]) => <div key={label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}</dl><CurrencyPreview code={currency} /><p className="text-sm leading-relaxed text-muted-foreground">Only you are added now. Invite people after creation. Expense entry, balances, and history migration remain unavailable.</p></>}
        <div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" className="h-11" disabled={busy} onClick={step === 0 ? onCancel : () => setStep(step - 1)}><ArrowLeft aria-hidden="true" />{step === 0 ? "My books" : "Back"}</Button><Button type="submit" className="h-11" disabled={busy}>{busy ? "Creating…" : step === 2 ? "Confirm & create book" : "Continue"}{busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" />}</Button></div>
      </fieldset>
    </form>
    <Message notice={notice} />
  </CardContent></Card>;
}

function JoinBook({ initialToken, defaultName, isCurrent, onCancel, onJoined }: { initialToken: string; defaultName: string; isCurrent: ScopeCheck; onCancel: () => void; onJoined: (id: string) => void }) {
  const live = useLiveScope(isCurrent);
  const [value, setValue] = useState(initialToken);
  const [name, setName] = useState(defaultName);
  const [errors, setErrors] = useState<{ token?: string; name?: string }>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || !live()) return;
    const token = parseInvite(value);
    const invalid = { token: token ? undefined : "Paste a full invitation link from this site, or its 64-character code.", name: !name.trim() || name.trim().length > 40 ? "Enter a display name with 1–40 characters." : undefined };
    setErrors(invalid);
    if (!token || invalid.name) return;
    lock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const id = await acceptBookInvite(token, name.trim());
      if (!live()) return;
      setValue("");
      onJoined(id);
    } catch (error) {
      if (live()) setNotice({ kind: "error", text: `${friendlyError(error)} No automatic retry was made. If the result is uncertain, check My books before retrying.` });
    } finally {
      lock.current = false;
      if (live()) setBusy(false);
    }
  }

  return <Card className="mx-auto max-w-2xl"><CardHeader><span className="mb-1 inline-flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Link2 aria-hidden="true" className="size-5" /></span><h2 className="text-xl font-semibold">{initialToken ? "An invitation is waiting" : "Join a book"}</h2><CardDescription>You're signed in. Joining still needs your confirmation.</CardDescription></CardHeader><CardContent className="space-y-5"><p className="text-sm leading-relaxed">A valid group invitation is reusable for <strong>7 days</strong>. Anyone holding the link can join that book. Only join links from people you trust; the book and its members will be shown after acceptance.</p><form className="space-y-5" aria-busy={busy} onSubmit={event => void submit(event)}><fieldset disabled={busy} className="min-w-0 space-y-5"><div className={fieldClass}><Label htmlFor="join-invite">Invitation link or code</Label><Input id="join-invite" className="h-11 font-mono text-sm" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={value} aria-invalid={Boolean(errors.token)} aria-describedby="join-token-error" onChange={event => setValue(event.target.value)} /><FieldError id="join-token-error" text={errors.token} /></div><div className={fieldClass}><Label htmlFor="join-name">Your name in this book</Label><Input id="join-name" className="h-11" autoComplete="nickname" required maxLength={40} value={name} aria-invalid={Boolean(errors.name)} aria-describedby="join-name-help join-name-error" onChange={event => setName(event.target.value)} /><p id="join-name-help" className="text-xs text-muted-foreground">1–40 characters. Visible to other members. If you're already a member, joining again keeps your existing membership.</p><FieldError id="join-name-error" text={errors.name} /></div><div className="flex flex-wrap justify-between gap-2"><Button type="button" variant="outline" className="h-11" disabled={busy} onClick={onCancel}>{initialToken ? "Dismiss invitation" : "My books"}</Button><Button type="submit" className="h-11" disabled={busy}>{busy ? "Joining…" : "Accept & join book"}<ArrowRight aria-hidden="true" /></Button></div></fieldset></form><Message notice={notice} /><p className="text-xs leading-relaxed text-muted-foreground">Joining changes membership on the new project only. It does not import any expense history.</p></CardContent></Card>;
}

function BookDetails({ book, userId, isCurrent }: { book: ExpenseBook; userId: string; isCurrent: ScopeCheck }) {
  return <Card><CardHeader><div className="flex items-start justify-between gap-3"><h3 className="min-w-0 break-words text-lg font-semibold">{book.name}</h3><span className="shrink-0 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">{book.owner_id === userId ? "You own this" : "Member"}</span></div><CardDescription>{book.currency_code} · {splitOptions.find(option => option.value === book.default_split)?.title} default · {book.currency_minor_digits} decimal places</CardDescription></CardHeader><CardContent className="space-y-6"><CurrencyPreview code={book.currency_code} /><section aria-labelledby="members-heading"><h4 id="members-heading" className="mb-3 flex items-center gap-2 text-sm font-semibold"><Users aria-hidden="true" className="size-4" />Members ({book.book_members.length})</h4>{book.book_members.length ? <ul className="divide-y">{book.book_members.map(member => <li key={member.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0 break-words">{member.display_name}{member.user_id === userId && <span className="text-muted-foreground"> (you)</span>}</span><span className="shrink-0 text-xs capitalize text-muted-foreground">{member.role}</span></li>)}</ul> : <p className="text-sm text-muted-foreground">No member records were returned. Refresh the book list to check access.</p>}</section>{book.owner_id === userId ? <OwnerInvites bookId={book.id} isCurrent={isCurrent} /> : <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">Only this book's owner can manage invitation links.</p>}<p className="border-t pt-4 text-xs text-muted-foreground">Setup only. Adding expenses and viewing or migrating expense history are not enabled.</p></CardContent></Card>;
}

function OwnerInvites({ bookId, isCurrent }: { bookId: string; isCurrent: ScopeCheck }) {
  const live = useLiveScope(isCurrent);
  const token = useRef<string | null>(null);
  const lock = useRef(false);
  const [expires, setExpires] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generate" | "revoke" | "copy" | null>(null);
  const [uncertain, setUncertain] = useState<"generate" | "revoke" | null>(null);
  const [confirm, setConfirm] = useState<"replace" | "revoke" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const link = expires && token.current ? `${window.location.origin}/books-setup#invite=${token.current}` : "";

  async function generate(replace: boolean) {
    if (lock.current || !live()) return;
    lock.current = true;
    setBusy("generate");
    setNotice(null);
    setConfirm(null);
    setExpires(null);
    try {
      // A retry after an unknown outcome must use the exact same token. Only
      // the explicitly confirmed Replace link action rotates that request.
      if (replace || !token.current) token.current = newInviteToken();
      const result = await createInvite(bookId, token.current);
      if (!live()) return;
      setExpires(result);
      setUncertain(null);
      setNotice({ kind: "success", text: "Invitation link confirmed. Share it only with people you want in this book." });
    } catch (error) {
      if (live()) { setUncertain("generate"); setNotice({ kind: "error", text: `${friendlyError(error)} Retry the same link to confirm this request; use Replace link only if you want a new token.` }); }
    } finally {
      lock.current = false;
      if (live()) setBusy(null);
    }
  }

  async function revoke() {
    if (lock.current || !live()) return;
    lock.current = true;
    setBusy("revoke");
    setConfirm(null);
    setNotice(null);
    // Do not offer to copy a link while revocation is in flight or uncertain.
    setExpires(null);
    try {
      await revokeInvite(bookId);
      if (!live()) return;
      token.current = null;
      setUncertain(null);
      setNotice({ kind: "success", text: "Invitation revoked. People who already joined remain members." });
    } catch (error) {
      if (live()) { setUncertain("revoke"); setNotice({ kind: "error", text: `${friendlyError(error)} Revocation is not confirmed; the old link may still work. Retry revocation to check.` }); }
    } finally {
      lock.current = false;
      if (live()) setBusy(null);
    }
  }

  async function copy() {
    if (!link || lock.current || !live()) return;
    lock.current = true;
    setBusy("copy");
    setNotice(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(link);
      if (live()) setNotice({ kind: "success", text: "Invitation link copied." });
    } catch {
      if (live()) setNotice({ kind: "error", text: "Clipboard access was unavailable. Select the read-only link above and copy it manually." });
    } finally {
      lock.current = false;
      if (live()) setBusy(null);
    }
  }

  return <section aria-labelledby="owner-invites-heading" className="space-y-4 border-t pt-5"><h4 id="owner-invites-heading" className="flex items-center gap-2 text-sm font-semibold"><Link2 aria-hidden="true" className="size-4" />Owner invitation controls</h4><p className="text-sm leading-relaxed text-muted-foreground">Group links are reusable for 7 days. <strong className="text-foreground">Anyone holding the link can join this book.</strong> Replacing or revoking a link never removes members who already joined.</p><p className="text-xs leading-relaxed text-muted-foreground">Existing link status is not loaded here. Generating a link replaces any previous link for this book. Ownership is enforced by the database, not just these controls.</p>
    {link && <div className="space-y-2"><Label htmlFor="owner-invite-link">Shareable invitation link</Label><Input id="owner-invite-link" className="h-11 font-mono text-xs" readOnly value={link} autoComplete="off" spellCheck={false} onFocus={event => event.currentTarget.select()} aria-describedby="owner-invite-expiry" /><p id="owner-invite-expiry" className="text-xs text-muted-foreground">Server-reported expiry: {new Date(expires!).toLocaleString()}. Select the link to copy manually.</p><Button type="button" variant="outline" className="h-11" disabled={Boolean(busy)} onClick={() => void copy()}><Copy aria-hidden="true" />{busy === "copy" ? "Copying…" : "Copy link"}</Button></div>}
    <div className="flex flex-wrap gap-2">
      {!expires && uncertain !== "revoke" && <Button type="button" className="h-11" disabled={Boolean(busy) || Boolean(confirm)} onClick={() => void generate(false)}>{busy === "generate" ? "Generating…" : uncertain === "generate" ? "Retry same link" : "Generate invite link"}</Button>}
      {token.current && <Button type="button" variant="outline" className="h-11" disabled={Boolean(busy) || Boolean(confirm)} onClick={() => setConfirm("replace")}>Replace link</Button>}
      <Button type="button" variant="outline" className="h-11" disabled={Boolean(busy) || Boolean(confirm)} onClick={() => uncertain === "revoke" ? void revoke() : setConfirm("revoke")}>{busy === "revoke" ? "Revoking…" : uncertain === "revoke" ? "Retry revocation" : "Revoke link"}</Button>
    </div>
    {confirm && <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"><p>{confirm === "replace" ? "Replace this invitation? A new link will be generated and the previous link will be invalidated. Existing members stay in the book." : "Revoke this book's invitation? The current link will stop accepting new members. People who already joined will remain members."}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => setConfirm(null)}>Cancel</Button><Button type="button" disabled={Boolean(busy)} onClick={() => confirm === "replace" ? void generate(true) : void revoke()}>{confirm === "replace" ? "Confirm replacement" : "Confirm revocation"}</Button></div></div>}
    <Message notice={notice} />
  </section>;
}
