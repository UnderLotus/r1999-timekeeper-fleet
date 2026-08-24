import type { StateStorage } from "zustand/middleware";

export const STORAGE_ERROR_EVENT = "r1999-timekeeper-fleet:storage-error";
let hasFailed = false;

function markStorageError(): void {
  hasFailed = true;
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(STORAGE_ERROR_EVENT));
}

export function consumeStorageError(): boolean {
  const failed = hasFailed;
  hasFailed = false;
  return failed;
}

export function loadJSON<T>(key: string): T | null {
  try {
    const raw =
      typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    if (typeof localStorage !== "undefined")
      localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn("[storage] save failed", error);
    markStorageError();
  }
}

export function removeKey(key: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(key);
  } catch (error) {
    console.warn("[storage] remove failed", error);
    markStorageError();
  }
}

export function createSafeStorage(): StateStorage {
  return {
    getItem: (key) => {
      try {
        if (typeof localStorage === "undefined") return null;
        const raw = localStorage.getItem(key);
        if (raw !== null) JSON.parse(raw);
        return raw;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        if (typeof localStorage !== "undefined")
          localStorage.setItem(key, value);
      } catch (error) {
        console.warn("[storage] persist failed", error);
        markStorageError();
      }
    },
    removeItem: (key) => {
      try {
        if (typeof localStorage !== "undefined") localStorage.removeItem(key);
      } catch (error) {
        console.warn("[storage] persist remove failed", error);
        markStorageError();
      }
    },
  };
}
