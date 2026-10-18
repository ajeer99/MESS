import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { CURRENCIES } from "../preferences";

// Public application configuration. This publishable key is not a server secret.
// Private records are protected by Supabase Auth + the migration's RLS policies.
export const booksClient = createClient(
  "https://dulbjaoszcndrzgtxrub.supabase.co",
  "sb_publishable_TzHLJdeDyQIJ1qXKpmyVGQ_0ZRx1bLT",
  {
    auth: {
      storageKey: "partners-books-auth",
      flowType: "pkce",
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    },
  },
);

export const memberSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), display_name: z.string(),
  role: z.enum(["owner", "member"]), joined_at: z.string(),
});
export const bookSchema = z.object({
  id: z.string().uuid(), owner_id: z.string().uuid(), name: z.string(),
  currency_code: z.string().refine(code => CURRENCIES.some(c => c.code === code)),
  currency_minor_digits: z.union([z.literal(0), z.literal(2)]),
  default_split: z.enum(["equal", "personal", "custom"]),
  created_at: z.string(), book_members: z.array(memberSchema),
});
export type ExpenseBook = z.infer<typeof bookSchema>;
export type BookSplit = ExpenseBook["default_split"];
export interface NewBookInput {
  id: string;
  name: string;
  currencyCode: string;
  defaultSplit: BookSplit;
  displayName: string;
}

export class BooksError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function friendlyError(error: unknown): string {
  if (error instanceof BooksError) return error.message;
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  switch (code) {
    case "email_not_confirmed": return "Confirm your email first, then sign in.";
    case "invalid_credentials": return "The email or password is incorrect.";
    case "user_already_exists": return "An account may already exist. Try signing in.";
    case "weak_password": return "Choose a stronger password with at least 8 characters.";
    case "over_email_send_rate_limit": case "over_request_rate_limit":
      return "Too many attempts. Please wait before trying again.";
    case "signup_disabled": return "New account registration is currently disabled.";
    default: return "Could not complete the request. Check your connection and try again.";
  }
}

function databaseError(error: { code?: string; message?: string }): never {
  if (error.code === "PGRST205" || error.code === "PGRST202") {
    throw new BooksError("setup_required", "Private-book database setup is not installed yet. Your existing expense book is unchanged.");
  }
  if (error.code === "42501") throw new BooksError("access_denied", "You do not have permission to do that in this book.");
  if (error.code === "PGRST301" || error.code === "PGRST303") throw new BooksError("login_required", "Your session expired. Sign in again.");
  const messages: Record<string, string> = {
    login_required: "Sign in before continuing.",
    invalid_book: "Check the book name, currency, split and your display name.",
    invalid_name: "Enter a display name with 1–40 characters.",
    invalid_invite: "This invite is invalid, expired, or replaced. Ask the book owner for a new link.",
    operation_conflict: "This request was already used with different details. Refresh your books before creating another.",
  };
  if (error.message && messages[error.message]) throw new BooksError(error.message, messages[error.message]);
  // Never render raw database diagnostics or silently repeat a write.
  throw new BooksError("request_failed", "The request could not be confirmed. Refresh to check the result, or retry the same details.");
}

export async function listBooks(signal?: AbortSignal): Promise<ExpenseBook[]> {
  const books = new Map<string, ExpenseBook>();
  for (let offset = 0; ; offset += 100) {
    let query = booksClient.from("expense_books")
      .select("id,owner_id,name,currency_code,currency_minor_digits,default_split,created_at,book_members(id,user_id,display_name,role,joined_at)")
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + 99);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) databaseError(error);
    const parsed = z.array(bookSchema).safeParse(data);
    if (!parsed.success) throw new BooksError("invalid_response", "The book list returned an unexpected response.");
    for (const book of parsed.data) books.set(book.id, book);
    if (parsed.data.length < 100) return [...books.values()];
  }
}

export async function createBook(input: NewBookInput): Promise<string> {
  const { data, error } = await booksClient.rpc("create_expense_book", {
    p_id: input.id, p_name: input.name.trim(), p_currency_code: input.currencyCode,
    p_default_split: input.defaultSplit, p_display_name: input.displayName.trim(),
  });
  if (error) databaseError(error);
  if (!z.string().uuid().safeParse(data).success || data !== input.id) {
    throw new BooksError("invalid_response", "The book result could not be confirmed. Refresh your books before trying again.");
  }
  return data as string;
}

export function newInviteToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, "0")).join("");
}

export async function createInvite(bookId: string, token: string): Promise<string> {
  const { data, error } = await booksClient.rpc("create_book_invite", { p_book_id: bookId, p_token: token });
  if (error) databaseError(error);
  if (typeof data !== "string" || !Number.isFinite(Date.parse(data))) {
    throw new BooksError("invalid_response", "The invite result could not be confirmed. Retry the same request.");
  }
  return data;
}

export async function revokeInvite(bookId: string): Promise<void> {
  const { error } = await booksClient.rpc("revoke_book_invite", { p_book_id: bookId });
  if (error) databaseError(error);
}

export async function acceptBookInvite(token: string, displayName: string): Promise<string> {
  const { data, error } = await booksClient.rpc("accept_book_invite", { p_token: token, p_display_name: displayName.trim() });
  if (error) databaseError(error);
  if (!z.string().uuid().safeParse(data).success) throw new BooksError("invalid_response", "The invitation result could not be confirmed. Refresh your books.");
  return data as string;
}
