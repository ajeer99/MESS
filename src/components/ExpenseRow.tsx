import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { deleteExpense } from "../api";
import { useApp } from "../app-context";
import { formatINR } from "../money";
import type { Expense } from "../types";
import { PartnerAvatar, SplitBadge } from "./ui-bits";

export function ExpenseRow({ expense, showDate = false }: { expense: Expense; showDate?: boolean }) {
  const { session, data, refresh, openEdit } = useApp();
  const partners = data?.partners ?? [];
  const payer = partners.find((p) => p.id === expense.paid_by);

  const remove = async () => {
    try {
      await deleteExpense(session.token, expense.id);
      toast.success("Expense deleted");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete.");
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/60">
      <PartnerAvatar partner={payer} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium">{expense.merchant}</p>
          {expense.recurring_rule_id && (
            <span title="Added automatically by a recurring rule" className="shrink-0 text-[10px] text-muted-foreground">↻</span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {expense.category}
          {showDate ? ` · ${expense.expense_date}` : ""}
          {expense.note ? ` · ${expense.note}` : ""}
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-sm font-semibold tabular-nums">{formatINR(expense.amount_paise)}</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{payer?.name ?? ""}</span>
          <SplitBadge expense={expense} />
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground" aria-label="Expense actions">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(expense)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mr-2 h-4 w-4"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
            Edit
          </DropdownMenuItem>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <DropdownMenuItem onSelect={(e) => e.preventDefault()} variant="destructive">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mr-2 h-4 w-4"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                Delete
              </DropdownMenuItem>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
                <AlertDialogDescription>
                  {expense.merchant} — {formatINR(expense.amount_paise)} on {expense.expense_date}. The balance recalculates after deletion.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
