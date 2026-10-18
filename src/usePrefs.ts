import { useEffect, useState } from "react";
import { getPrefs, getCurrencyConfig, type Prefs, type CurrencyConfig } from "./preferences";

export function usePrefs(): Prefs {
  const [prefs, setPrefs] = useState<Prefs>(getPrefs);
  useEffect(() => {
    const handler = () => setPrefs(getPrefs());
    window.addEventListener("pe-prefs-change", handler);
    window.addEventListener("storage", handler);
    return () => {
      window.removeEventListener("pe-prefs-change", handler);
      window.removeEventListener("storage", handler);
    };
  }, []);
  return prefs;
}

export function useCurrency(): CurrencyConfig {
  const prefs = usePrefs();
  return getCurrencyConfig(prefs.currencyCode);
}
