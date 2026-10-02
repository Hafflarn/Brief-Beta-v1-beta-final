"use client";
import { useEffect, useState } from "react";
export type Theme = "light" | "dark" | "auto";
export default function ThemePicker() {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    setTheme((localStorage.getItem("brief-theme") || "auto") as Theme);
  }, []);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        theme === "auto" ? (mq.matches ? "dark" : "light") : theme;
    };
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [theme]);
  return (
    <label className="theme-picker">
      <span className="sr-only">Tema</span>
      <select
        aria-label="Tema"
        value={theme}
        onChange={(e) => {
          const value = e.target.value as Theme;
          setTheme(value);
          localStorage.setItem("brief-theme", value);
        }}
      >
        <option value="auto">◐ Automatiskt</option>
        <option value="light">☀ Ljust</option>
        <option value="dark">☾ Mörkt</option>
      </select>
    </label>
  );
}
