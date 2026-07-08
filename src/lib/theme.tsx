import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "seaguard:theme";

// Allow build / runtime to force light-only via Vite env flag
const FORCE_LIGHT = (import.meta as any).env?.VITE_FORCE_LIGHT === "1" ||
  (import.meta as any).env?.VITE_FORCE_LIGHT === "true";

const ThemeContext = createContext({
  theme: "light" as Theme,
  setTheme: (_: Theme) => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    if (FORCE_LIGHT) {
      // Ensure light class state
      document.documentElement.classList.remove("dark");
      try {
        localStorage.setItem(STORAGE_KEY, "light");
      } catch {}
      return;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "dark" || stored === "light") setTheme(stored as Theme);
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (FORCE_LIGHT) return; // don't toggle when forced
    try {
      if (theme === "dark") document.documentElement.classList.add("dark");
      else document.documentElement.classList.remove("dark");
      localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {
      // ignore
    }
  }, [theme]);

  // If forced, expose a no-op setter
  const setter = FORCE_LIGHT ? (() => {}) : setTheme;

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setter }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeToggle() {
  if (FORCE_LIGHT) return null;
  const { theme, setTheme } = useTheme();
  return (
    <div className="fixed right-6 top-4 z-50">
      <button
        aria-label="Toggle theme"
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-input bg-background text-sm text-foreground shadow-sm hover:brightness-95"
        title={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
      >
        <span aria-hidden>{theme === "light" ? "🌞" : "🌙"}</span>
      </button>
    </div>
  );
}

export default ThemeProvider;
