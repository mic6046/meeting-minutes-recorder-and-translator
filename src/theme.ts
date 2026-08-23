/** Theme preference for MinutesFlow (persisted locally). */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "minutesflow_theme";

export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "light" || raw === "dark" || raw === "system") return raw;
  } catch {
    /* private mode */
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "light" || preference === "dark") return preference;
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

/** Apply theme class + meta theme-color. Safe to call on load and on change. */
export function applyTheme(preference: ThemePreference): "light" | "dark" {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#0b1220" : "#f4f6f9");
  }

  const apple = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (apple) {
    apple.setAttribute("content", resolved === "dark" ? "black-translucent" : "default");
  }

  return resolved;
}

export function setThemePreference(preference: ThemePreference): "light" | "dark" {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* ignore */
  }
  return applyTheme(preference);
}
