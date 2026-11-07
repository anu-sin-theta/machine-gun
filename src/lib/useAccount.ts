"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The requester's account token, kept in this browser only. Storage can be
 * unavailable (private windows, blocked site data), so every access is
 * guarded and the page still works for the session without it.
 */

const KEY = "kavach402.account";

export interface StoredAccount {
  id: string;
  name: string;
  token: string;
}

function read(): StoredAccount | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as StoredAccount;
    return v && typeof v.token === "string" ? v : null;
  } catch {
    return null;
  }
}

export function useAccount() {
  const [account, setAccount] = useState<StoredAccount | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAccount(read());
    setLoaded(true);
  }, []);

  const save = useCallback((next: StoredAccount | null) => {
    setAccount(next);
    try {
      if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
      else window.localStorage.removeItem(KEY);
    } catch {
      // Kept in memory for this session only.
    }
  }, []);

  return { account, loaded, save };
}
