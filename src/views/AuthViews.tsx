import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvite, ApiError, joinViaLink, login as apiLogin, setup as apiSetup } from "../api";
import type { SessionInfo } from "../types";
import { useCurrency } from "../usePrefs";

function Brand() {
  const currency = useCurrency();
  return (
    <div className="flex items-center justify-center gap-2">
      <div className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-primary px-1 text-sm font-bold text-primary-foreground"><span className={currency.code === "SAR" ? "text-2xl" : undefined}>{currency.code === "SAR" ? currency.symbol : currency.code}</span></div>
      <div className="text-left leading-tight">
        <p className="text-lg font-semibold">Partners</p>
        <p className="text-xs text-muted-foreground">Shared expense book</p>
      </div>
    </div>
  );
}

export function SetupScreen({ onDone }: { onDone: (session: SessionInfo) => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!name.trim() || !username.trim() || password.length < 6) {
      setError("Fill in all fields. Username needs 3+ characters, password 6+.");
      return;
    }
    setBusy(true);
    try {
      await apiSetup({ name: name.trim(), username: username.trim().toLowerCase(), password });
      const session = await apiLogin(username.trim().toLowerCase(), password);
      onDone(session);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Setup failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <Brand />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create your account</CardTitle>
            <CardDescription>
              You're the first partner. Once you're in, invite your partner — send them a link to make their own account, or add their login yourself on the More tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nameA">Your name</Label>
              <Input id="nameA" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ajeer" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usernameA">Username</Label>
              <Input id="usernameA" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="ajeer" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="passwordA">Password (6+ characters)</Label>
              <Input id="passwordA" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={submit} disabled={busy}>
              {busy ? "Creating…" : "Create account & sign in"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function AcceptInviteScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!name.trim() || !username.trim() || password.length < 6) {
      setError("Fill in all fields. Username needs 3+ characters, password 6+.");
      return;
    }
    setBusy(true);
    try {
      await acceptInvite({ code, name: name.trim(), username: username.trim().toLowerCase(), password });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not join. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <Brand />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You're invited</CardTitle>
            <CardDescription>
              Your partner set up the shared expense book and invited you. Create your own account to join.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-name">Your name</Label>
              <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sara" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-username">Username</Label>
              <Input id="invite-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="sara" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="invite-password">Password (6+ characters)</Label>
              <Input id="invite-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={submit} disabled={busy}>
              {busy ? "Joining…" : "Join & continue"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function JoinScreen({ code, onDone }: { code: string; onDone: (session: SessionInfo) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const session = await joinViaLink(code);
      onDone(session);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not join. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <Brand />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You've been added</CardTitle>
            <CardDescription>
              Your partner set up the shared expense book and made you an account. Tap below and you're signed in on this device —
              no username or password needed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button className="w-full" onClick={submit} disabled={busy}>
              {busy ? "Signing you in…" : "Join the book"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              This link signs in once — open it only on your own device.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function LoginScreen({ onLogin }: { onLogin: (session: SessionInfo) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    try {
      const session = await apiLogin(username.trim().toLowerCase(), password);
      onLogin(session);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-4">
        <Brand />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sign in</CardTitle>
            <CardDescription>Each partner signs in with their own account.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={submit}>
              <div className="space-y-1.5">
                <Label htmlFor="username">Username</Label>
                <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
