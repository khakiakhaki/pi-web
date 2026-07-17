const LAST_SESSION_STORAGE_KEY = "pi-web:last-session-id";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadLastSessionId(storage: StorageLike | null = browserStorage()): string | null {
  if (!storage) return null;
  try {
    const sessionId = storage.getItem(LAST_SESSION_STORAGE_KEY)?.trim();
    return sessionId || null;
  } catch {
    return null;
  }
}

export function saveLastSessionId(sessionId: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage || !sessionId.trim()) return;
  try {
    storage.setItem(LAST_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Storage can be unavailable in private/restricted browser contexts.
  }
}

export function clearLastSessionId(sessionId?: string, storage: StorageLike | null = browserStorage()): void {
  if (!storage) return;
  try {
    if (sessionId && storage.getItem(LAST_SESSION_STORAGE_KEY) !== sessionId) return;
    storage.removeItem(LAST_SESSION_STORAGE_KEY);
  } catch {
    // Ignore unavailable browser storage and keep the normal startup behavior.
  }
}
