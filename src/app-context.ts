import { createContext, useContext } from "react";
import type { DataResponse, Expense, SessionInfo } from "./types";

export interface AppCtxValue {
  session: SessionInfo;
  data: DataResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
  openAdd: () => void;
  openEdit: (expense: Expense) => void;
  openSettle: () => void;
  signOut: () => void;
}

export const AppCtx = createContext<AppCtxValue | null>(null);

export function useApp(): AppCtxValue {
  const value = useContext(AppCtx);
  if (!value) throw new Error("useApp outside provider");
  return value;
}
