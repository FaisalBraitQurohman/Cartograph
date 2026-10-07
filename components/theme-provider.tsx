"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

export type Theme = "system" | "light" | "dark";

const STORAGE_KEY = "cartograph-theme";
const CHANGE_EVENT = "cartograph-theme-change";

/**
 * Runs before paint so the root class is already correct on first render —
 * otherwise a forced-dark user sees a light flash on every load.
 *
 * Kept as a string because it is injected into <head> ahead of React.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");var d=window.matchMedia("(prefers-color-scheme: dark)").matches;var c=t==="dark"||(t!=="light"&&d)?"dark":"light";document.documentElement.classList.remove("light","dark");document.documentElement.classList.add(c);}catch(e){}})();`;

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** Applies a theme to <html>. "system" defers to the media query. */
function apply(theme: Theme) {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.remove("light", "dark");
  root.classList.add(dark ? "dark" : "light");
}

/**
 * localStorage is the source of truth for the chosen theme, so it is read as
 * external state through useSyncExternalStore rather than copied into React
 * state inside an effect. The provider only mirrors it; the pre-paint script
 * has already set the class on <html>.
 */
function readStoredTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system"
    ? stored
    : "system";
}

function subscribe(onChange: () => void) {
  // Three things can change the theme: this tab, another tab, and the OS
  // colour scheme while following the system.
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onMediaChange = () => {
    if (readStoredTheme() === "system") apply("system");
    onChange();
  };

  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  media.addEventListener("change", onMediaChange);

  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    media.removeEventListener("change", onMediaChange);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server has no localStorage, so it renders "system" and the client
  // corrects after hydration. The class is already right from the pre-paint
  // script, so this only syncs the control's own state.
  const theme = useSyncExternalStore(
    subscribe,
    readStoredTheme,
    () => "system" as const,
  );

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
