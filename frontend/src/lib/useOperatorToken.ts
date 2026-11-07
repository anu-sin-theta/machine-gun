"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The deployment operator's API_TOKEN, kept for this browser tab only
 * (sessionStorage), so it is gone when the tab closes. Guarded: storage can be
 * unavailable, and the page then keeps it in memory.
 */

const KEY = "kavach402.operator";

export function useOperatorToken() {
  const [token, setToken] = useState("");

  useEffect(() => {
    try {
      setToken(window.sessionStorage.getItem(KEY) ?? "");
    } catch {
      setToken("");
    }
  }, []);

  const save = useCallback((next: string) => {
    setToken(next);
    try {
      if (next) window.sessionStorage.setItem(KEY, next);
      else window.sessionStorage.removeItem(KEY);
    } catch {
      // Memory only.
    }
  }, []);

  return { token, save };
}
