// ============================================================================
// src/hooks/use-theme.tsx — shadcn/ui 主题系统
// ============================================================================
// localStorage.themeMode: "dark" | "light" | 未设置（跟随系统）

import { createContext, useContext, useEffect, useState, type ReactNode, useCallback } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: ReactNode;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

/** 获取当前实际显示模式（dark/light），跟随系统或用户设定 */
function getEffectiveMode(): "dark" | "light" {
  const stored = localStorage.getItem("themeMode");
  if (stored === "dark" || stored === "light") return stored;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** 获取用户设定（含 system） */
function getThemeSetting(): Theme {
  const stored = localStorage.getItem("themeMode");
  if (stored === "dark") return "dark";
  if (stored === "light") return "light";
  return "system";
}

function applyTheme(t: Theme) {
  if (t === "system") {
    const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", systemDark);
  } else {
    document.documentElement.classList.toggle("dark", t === "dark");
  }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(getThemeSetting);

  const setTheme = useCallback((t: Theme) => {
    if (t === "system") {
      localStorage.removeItem("themeMode");
    } else {
      localStorage.setItem("themeMode", t);
    }
    applyTheme(t);
    setThemeState(t);
  }, []);

  // 初始化
  useEffect(() => {
    const mode = getEffectiveMode();
    document.documentElement.classList.toggle("dark", mode === "dark");

    // 监听系统主题变化
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (getThemeSetting() === "system") {
        document.documentElement.classList.toggle("dark", mq.matches);
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return (
    <ThemeProviderContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
