import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ApiError, regenerateInvite } from "../api";
import { useApp } from "../app-context";
import { cn } from "@/lib/utils";

/**
 * Shareable one-time link. In signup mode the partner creates their own account;
 * in joining mode (invitePartnerId set) it signs in the partner the owner added.
 */
export function InviteCard({ compact = false }: { compact?: boolean }) {
  const { session, data, refresh } = useApp();
  const [busy, setBusy] = useState(false);
  const code = data?.inviteCode ?? null;
  const joinPartner = code && data?.invitePartnerId
    ? data.partners.find((p) => p.id === data.invitePartnerId) ?? null
    : null;
  const isJoin = joinPartner !== null;
  const link = code ? `${window.location.origin}${window.location.pathname}?${isJoin ? "join" : "invite"}=${code}` : null;

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success(isJoin
        ? `Joining link copied — send it to ${joinPartner.name} on WhatsApp.`
        : "Invite link copied — send it to your partner on WhatsApp.");
    } catch {
      toast.error("Could not copy. Long-press the link to copy it.");
    }
  };

  const makeNew = async () => {
    setBusy(true);
    try {
      await regenerateInvite(session.token);
      toast.success(code
        ? (isJoin ? "New joining link created. The old one no longer works." : "New link created. The old link no longer works.")
        : "Invite link ready.");
      await refresh();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not create a link.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("space-y-3", !compact && "p-1")}>
      {!compact && (
        <p className="text-sm text-muted-foreground">
          {isJoin
            ? `Send this one-tap link to ${joinPartner.name}. They open it, tap "Join the book" and they're signed in. It works once.`
            : code
              ? "Send this link to your partner. They create their own account with it. It works once."
              : "Create an invite link, then send it to your partner so they can make their own account."}
        </p>
      )}
      {link ? (
        <>
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className="h-10 text-xs"
              aria-label={isJoin ? "Joining link" : "Invite link"} />
            <Button className="shrink-0" onClick={copy}>Copy</Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {isJoin ? "Joining code" : "Invite code"}: <span className="font-semibold tracking-widest text-foreground">{code}</span>
            </p>
            <Button variant="ghost" size="sm" onClick={makeNew} disabled={busy}>
              {busy ? "Creating…" : "New link"}
            </Button>
          </div>
        </>
      ) : (
        <Button className="w-full" onClick={makeNew} disabled={busy}>
          {busy ? "Creating…" : "Create invite link"}
        </Button>
      )}
    </div>
  );
}
