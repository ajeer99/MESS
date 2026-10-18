/**
 * Local-only user preferences, stored in localStorage.
 * Nothing here is synced to the server — purely client-side UX.
 */

const PREFS_KEY = "pe_preferences";

export interface CurrencyConfig {
  code: string;   // e.g. "INR", "USD"
  symbol: string; // e.g. "₹", "$"
  locale: string; // e.g. "en-IN", "en-US"
  name: string;   // e.g. "Indian Rupee"
}

export const CURRENCIES: CurrencyConfig[] = [
  { code: "INR", symbol: "₹", locale: "en-IN", name: "Indian Rupee (₹)" },
  { code: "USD", symbol: "$", locale: "en-US", name: "US Dollar ($)" },
  { code: "EUR", symbol: "€", locale: "de-DE", name: "Euro (€)" },
  { code: "GBP", symbol: "£", locale: "en-GB", name: "British Pound (£)" },
  { code: "AED", symbol: "د.إ", locale: "ar-AE", name: "UAE Dirham (د.إ)" },
  { code: "SAR", symbol: "\u20C1", locale: "en-SA", name: "Saudi Riyal" },
  { code: "SGD", symbol: "S$", locale: "en-SG", name: "Singapore Dollar (S$)" },
  { code: "AUD", symbol: "A$", locale: "en-AU", name: "Australian Dollar (A$)" },
  { code: "CAD", symbol: "C$", locale: "en-CA", name: "Canadian Dollar (C$)" },
  { code: "JPY", symbol: "¥", locale: "ja-JP", name: "Japanese Yen (¥)" },
  { code: "CNY", symbol: "¥", locale: "zh-CN", name: "Chinese Yuan (¥)" },
];

export const AVATAR_EMOJIS = [
  "😎", "🐱", "🦊", "👻", "🤖", "🦁", "🐻", "🦋",
  "🌸", "⚡", "🎯", "🌊", "🔥", "🎸", "🦄", "🍀",
  "🌙", "☀️", "🎩", "🐼", "🐸", "🦝", "🦔", "🐙",
  "🦅", "🦜", "🐬", "🦈", "🌺", "🍁",
];

export type ThemeMode = "light" | "dark" | "system";

export interface Prefs {
  theme: ThemeMode;
  currencyCode: string;
  /** partner id → emoji or data-URL for profile pic */
  avatars: Record<string, string>;
  /** months archived: "YYYY-MM" array */
  archivedMonths: string[];
}

const DEFAULTS: Prefs = {
  theme: "system",
  currencyCode: "INR",
  avatars: {},
  archivedMonths: [],
};

function load(): Prefs {
  // Each read gets fresh nested defaults; setters must never mutate DEFAULTS.
  const defaults: Prefs = { ...DEFAULTS, avatars: {}, archivedMonths: [] };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return defaults;
    return {
      ...defaults, ...saved,
      theme: saved.theme === "light" || saved.theme === "dark" ? saved.theme : "system",
      currencyCode: getCurrencyConfig(saved.currencyCode).code,
      avatars: saved.avatars && typeof saved.avatars === "object" && !Array.isArray(saved.avatars)
        ? Object.fromEntries(Object.entries(saved.avatars).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
        : {},
      archivedMonths: Array.isArray(saved.archivedMonths)
        ? saved.archivedMonths.filter((month: unknown) => typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month))
        : [],
    };
  } catch {
    return defaults;
  }
}

function savePrefs(prefs: Prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function getPrefs(): Prefs {
  return load();
}

export function setCurrency(code: string) {
  const p = load();
  p.currencyCode = getCurrencyConfig(code).code;
  savePrefs(p);
  window.dispatchEvent(new Event("pe-prefs-change"));
}

export function setTheme(theme: ThemeMode) {
  const p = load();
  p.theme = theme;
  savePrefs(p);
  window.dispatchEvent(new Event("pe-prefs-change"));
}

/** Keep CSS variables, dark utility classes, and native controls in agreement. */
export function initializeTheme() {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const { theme } = load();
    const dark = theme === "dark" || (theme === "system" && system.matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0c0a09" : "#0f766e");
  };
  apply();
  system.addEventListener("change", apply);
  window.addEventListener("pe-prefs-change", apply);
  window.addEventListener("storage", apply);
}

export function setAvatar(partnerId: string, value: string) {
  const p = load();
  p.avatars[partnerId] = value;
  savePrefs(p);
  window.dispatchEvent(new Event("pe-prefs-change"));
}

export function removeAvatar(partnerId: string) {
  const p = load();
  delete p.avatars[partnerId];
  savePrefs(p);
  window.dispatchEvent(new Event("pe-prefs-change"));
}

export function archiveMonth(monthKey: string) {
  const p = load();
  if (!p.archivedMonths.includes(monthKey)) {
    p.archivedMonths = [...p.archivedMonths, monthKey];
    savePrefs(p);
    window.dispatchEvent(new Event("pe-prefs-change"));
  }
}

export function unarchiveMonth(monthKey: string) {
  const p = load();
  p.archivedMonths = p.archivedMonths.filter((m) => m !== monthKey);
  savePrefs(p);
  window.dispatchEvent(new Event("pe-prefs-change"));
}

export function getCurrencyConfig(code: string): CurrencyConfig {
  return CURRENCIES.find((c) => c.code === code) ?? CURRENCIES[0];
}
