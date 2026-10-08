"use client";
import { useEffect, useState } from "react";
import { readPreference, writePreference } from "../../lib/browser-storage";
export type Theme = "light" | "dark";
export default function ThemePicker() {
 const [theme,setTheme]=useState<Theme>("light");
 useEffect(()=>{setTheme(readPreference("brief-theme")==="dark"?"dark":"light");},[]);
 useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 const label=theme==="dark"?"Byt till ljust tema":"Byt till mörkt tema";
 return <button className="theme-toggle" type="button" title={label} aria-label={label} onClick={()=>{const next=theme==="dark"?"light":"dark";setTheme(next);writePreference("brief-theme",next);}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{theme==="dark"?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>:<path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/>}</svg></button>;
}
