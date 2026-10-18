import type {
  DataResponse, Expense, ExpenseInput, Partner, RecurringInput, RecurringRule, SessionInfo, Settlement,
} from "./types";

const ENDPOINT = "/functions/v1/app";
const STORAGE_KEY = "pe_session";

const MESSAGES: Record<string, string> = {
  network_error: "Could not reach the server. Check your connection and try again.",
  invalid_response: "The server returned an unexpected response.",
  request_failed: "Something went wrong. Try again.",
  login_required: "Your session expired. Please sign in again.",
  access_denied: "Access denied. Please sign in again.",
  invalid_credentials: "Wrong username or password.",
  login_locked: "Too many attempts. Wait a minute, then try again.",
  already_set_up: "Accounts already exist. Sign in instead.",
  setup_failed: "Could not create the accounts. Try again.",
  write_rejected: "Could not save. Check the values and try again.",
  database_request_failed: "The service is unavailable right now. Try again in a moment.",
  body_too_large: "That entry is too long.",
  invalid_input: "Check the entered values.",
  invalid_date: "Enter a valid date.",
  invalid_amount: "Enter a valid amount.",
  invalid_merchant: "Enter where the money was spent (1-80 characters).",
  invalid_category: "Enter what it was for (1-40 characters).",
  invalid_note: "The note is too long (200 characters max).",
  invalid_payer: "Choose who paid.",
  invalid_split: "Choose a valid split.",
  invalid_percent: "Enter a percentage between 0 and 100.",
  invalid_name: "Enter a name (1-40 characters).",
  invalid_username: "Usernames are 3-30 characters: letters, numbers, dot, dash or underscore.",
  invalid_password: "Passwords need at least 6 characters.",
  invalid_day: "Choose a day of month between 1 and 31.",
  invalid_offset: "Could not load more entries.",
  range_too_wide: "That date range is too wide.",
  not_found: "That entry no longer exists. Refresh and try again.",
  method_not_allowed: "Unsupported request.",
  invalid_invite: "That invite link is invalid or was already used. Ask for a new one.",
  invalid_join: "That joining link is invalid or was already used. Ask your partner for a new one.",
  join_link: "That's a joining link, not a signup invite — open it as sent and tap Join now.",
  already_two_partners: "Both partner seats are taken — this book is for two partners.",
  month_closed: "That month is closed. Reopen it under More → Month closing to make changes.",
  already_closed: "That month is already closed.",
  not_closed: "That month isn't closed.",
  invalid_avatar: "That avatar isn't supported. Pick an emoji or a smaller image.",
};

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export function loadSession(): SessionInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && typeof parsed.token === "string" &&
      typeof parsed.partner === "object" && typeof parsed.partner.id === "string") {
      return parsed as SessionInfo;
    }
  } catch { /* fall through */ }
  return null;
}

export function saveSession(session: SessionInfo) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

async function request(url: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, credentials: "same-origin" });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(MESSAGES.network_error!, "network_error", 0);
  }
  if (response.redirected || !response.headers.get("content-type")?.includes("application/json")) {
    throw new ApiError(MESSAGES.invalid_response!, "invalid_response", response.status);
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(MESSAGES.invalid_response!, "invalid_response", response.status);
  }
  const body = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const code = typeof body?.error === "string" ? body.error : response.ok ? null : "request_failed";
  if (!response.ok || body?.ok === false || code) {
    const resolved = code ?? "request_failed";
    throw new ApiError(MESSAGES[resolved] ?? MESSAGES.request_failed!, resolved, response.status);
  }
  return data;
}

function sessionUrl(action: string, token: string): string {
  return `${ENDPOINT}?action=${action}&st=${token}`;
}

async function post<T>(action: string, token: string | null, body: unknown): Promise<T> {
  const url = token ? sessionUrl(action, token) : `${ENDPOINT}?action=${action}`;
  const data = await request(url, { method: "POST", body: JSON.stringify(body) });
  return data as T;
}

// ---------------------------------------------------------------- public API

export async function bootstrap(): Promise<boolean> {
  const data = (await request(`${ENDPOINT}?action=bootstrap`)) as { setupRequired: boolean };
  return data.setupRequired === true;
}

export async function setup(input: {
  name: string; username: string; password: string;
}): Promise<void> {
  await post("setup", null, input);
}

export async function addPartner(token: string, input: {
  name: string; username: string; password: string;
}): Promise<{ partner: Partner; inviteCode: string | null }> {
  const data = (await post("add_partner", token, input)) as { partner: Partner; inviteCode?: string | null };
  return { partner: data.partner, inviteCode: typeof data.inviteCode === "string" ? data.inviteCode : null };
}

export async function acceptInvite(input: {
  code: string; name: string; username: string; password: string;
}): Promise<void> {
  await post("accept_invite", null, input);
}

/** Consume a one-tap joining link: signs in the partner the owner added. */
export async function joinViaLink(code: string): Promise<SessionInfo> {
  const data = (await post("join", null, { code })) as { token: string; partner: Partner };
  return { token: data.token, partner: data.partner };
}

export async function regenerateInvite(token: string): Promise<string> {
  const data = (await post("regenerate_invite", token, {})) as { inviteCode: string };
  return data.inviteCode;
}

export async function closeMonth(token: string, month: string): Promise<void> {
  await post("close_month", token, { month });
}

export async function reopenMonth(token: string, month: string): Promise<void> {
  await post("reopen_month", token, { month });
}

export async function login(username: string, password: string): Promise<SessionInfo> {
  const data = (await post("login", null, { username, password })) as { token: string; partner: Partner };
  return { token: data.token, partner: data.partner };
}

export async function logout(token: string): Promise<void> {
  try {
    await post("logout", token, {});
  } catch { /* clearing locally is enough */ }
}

export async function sync(token: string): Promise<void> {
  await post("sync", token, {});
}

export async function getData(token: string, from: string, to: string, offset = 0): Promise<DataResponse> {
  const data = (await request(`${ENDPOINT}?action=data&from=${from}&to=${to}&offset=${offset}&st=${token}`)) as DataResponse;
  return data;
}

export async function addExpense(token: string, input: ExpenseInput): Promise<Expense> {
  const data = (await post("add_expense", token, input)) as { expense: Expense };
  return data.expense;
}

export async function updateExpense(token: string, id: string, input: ExpenseInput): Promise<Expense> {
  const data = (await post("update_expense", token, { id, ...input })) as { expense: Expense };
  return data.expense;
}

export async function deleteExpense(token: string, id: string): Promise<void> {
  await post("delete_expense", token, { id });
}

export async function addSettlement(token: string, input: {
  date: string; fromId: string; toId: string; amountPaise: number; note: string;
}): Promise<Settlement> {
  const data = (await post("add_settlement", token, input)) as { settlement: Settlement };
  return data.settlement;
}

export async function deleteSettlement(token: string, id: string): Promise<void> {
  await post("delete_settlement", token, { id });
}

export async function addRecurring(token: string, input: RecurringInput): Promise<RecurringRule> {
  const data = (await post("add_recurring", token, input)) as { rule: RecurringRule };
  return data.rule;
}

export async function updateRecurring(token: string, id: string, input: RecurringInput): Promise<RecurringRule> {
  const data = (await post("update_recurring", token, { id, ...input })) as { rule: RecurringRule };
  return data.rule;
}

export async function deleteRecurring(token: string, id: string): Promise<void> {
  await post("delete_recurring", token, { id });
}

export async function changePassword(token: string, currentPassword: string, newPassword: string): Promise<void> {
  await post("change_password", token, { currentPassword, newPassword });
}

export async function renameSelf(token: string, name: string): Promise<string> {
  const data = (await post("rename_self", token, { name })) as { name: string };
  return data.name;
}

export async function updateAvatar(
  token: string,
  avatarEmoji: string | null,
  avatarUrl: string | null,
): Promise<void> {
  await post("update_avatar", token, { avatarEmoji, avatarUrl });
}
