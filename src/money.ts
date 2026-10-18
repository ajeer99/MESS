import type { CurrencyConfig } from "./preferences";
import { getCurrencyConfig, getPrefs } from "./preferences";

function getConfig(cfg?: CurrencyConfig | null): CurrencyConfig {
  return cfg ?? getCurrencyConfig(getPrefs().currencyCode);
}

function buildFormatter(cfg: CurrencyConfig, fractionDigits: number) {
  return new Intl.NumberFormat(cfg.locale, {
    style: "currency",
    currency: cfg.code,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format paise (smallest unit) as currency string. */
export function formatINR(paise: number, cfg?: CurrencyConfig | null): string {
  const c = getConfig(cfg);
  const value = paise / 100;
  const fractions = Number.isInteger(value) ? 0 : 2;
  const formatter = buildFormatter(c, fractions);
  // Older browsers still format SAR as an abbreviation. Use the new symbol
  // explicitly; its official outline is bundled as a one-glyph webfont.
  if (c.code === "SAR") {
    return formatter.formatToParts(value)
      .map((part) => part.type === "currency" ? c.symbol : part.value).join("");
  }
  return formatter.format(value);
}

/** Plain number, no currency sign */
export function formatNumber(paise: number): string {
  const value = paise / 100;
  return new Intl.NumberFormat(getConfig().locale, {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Compact units for chart axes. For INR uses Indian system (k/L/Cr); others use K/M/B. */
export function formatINRCompact(paise: number, cfg?: CurrencyConfig | null): string {
  const c = getConfig(cfg);
  const rupees = paise / 100;
  const abs = Math.abs(rupees);
  const sym = c.code === "SAR" ? `${c.symbol}\u00A0` : c.symbol;
  if (c.code === "INR") {
    if (abs >= 1e7) return `${sym}${trim(rupees / 1e7)}Cr`;
    if (abs >= 1e5) return `${sym}${trim(rupees / 1e5)}L`;
    if (abs >= 1e3) return `${sym}${trim(rupees / 1e3)}k`;
    return `${sym}${trim(rupees)}`;
  }
  // Generic compact
  if (abs >= 1e9) return `${sym}${trim(rupees / 1e9)}B`;
  if (abs >= 1e6) return `${sym}${trim(rupees / 1e6)}M`;
  if (abs >= 1e3) return `${sym}${trim(rupees / 1e3)}K`;
  return `${sym}${trim(rupees)}`;
}

function trim(value: number): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return String(rounded);
}

/** Parse user amount input ("1,234.5", "1234") to integer paise; null when invalid. */
export function parseAmountToPaise(input: string): number | null {
  const text = input.trim().replace(/^[₹$€£﷼\u20C1]\s*/, "");
  // Never silently turn a negative or comma-decimal amount into a different value.
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})?(?:\.\d{0,2})?$/.test(text)) return null;
  const cleaned = text.replace(/,/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const rupees = Number(cleaned);
  if (!Number.isFinite(rupees)) return null;
  const paise = Math.round(rupees * 100);
  if (paise < 1 || paise > 100000000000) return null;
  return paise;
}

