// Preferences are optional: private browsers may deny storage access.
export function readPreference(key: string, session = false): string | null {
  try {
    return (session ? window.sessionStorage : window.localStorage).getItem(key);
  } catch {
    return null;
  }
}
export function writePreference(
  key: string,
  value: string,
  session = false,
): void {
  try {
    (session ? window.sessionStorage : window.localStorage).setItem(key, value);
  } catch {
    // Keep the current UI state even when the preference cannot be persisted.
  }
}
