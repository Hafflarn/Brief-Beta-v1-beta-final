"use client";
import { useCallback, useEffect, useRef, useState } from "react";
type Entry = { brief: true; index: number; scroll: number };
export function useNavigation(dirty: boolean) {
  const [route, setRoute] = useState("/orders");
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const entry = useRef<Entry>({ brief: true, index: 0, scroll: 0 });
  const correcting = useRef(false);
  useEffect(() => {
    const initial = location.hash.startsWith("#/")
      ? location.hash.slice(1)
      : "/orders";
    setRoute(initial);
    const state = history.state as Entry | null;
    entry.current = state?.brief ? state : { brief: true, index: 0, scroll: 0 };
    const authCallback =
      /access_token=|refresh_token=|type=recovery|error_description=/.test(
        location.hash,
      ) || new URLSearchParams(location.search).has("code");
    if (!authCallback) history.replaceState(entry.current, "", "#" + initial);
    const pop = (e: PopStateEvent) => {
      if (correcting.current) {
        correcting.current = false;
        return;
      }
      const next = (
        e.state?.brief ? e.state : { brief: true, index: 0, scroll: 0 }
      ) as Entry;
      if (
        dirtyRef.current &&
        !confirm("Du har osparade ändringar. Vill du lämna sidan?")
      ) {
        const delta = entry.current.index - next.index;
        if (delta) {
          correcting.current = true;
          history.go(delta);
        }
        return;
      }
      entry.current = next;
      setRoute(location.hash.slice(1) || "/orders");
      requestAnimationFrame(() =>
        requestAnimationFrame(() => scrollTo(0, next.scroll || 0)),
      );
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const scroll = () => {
      entry.current = { ...entry.current, scroll: window.scrollY };
      history.replaceState(entry.current, "");
    };
    addEventListener("popstate", pop);
    addEventListener("beforeunload", leave);
    addEventListener("scroll", scroll, { passive: true });
    return () => {
      removeEventListener("popstate", pop);
      removeEventListener("beforeunload", leave);
      removeEventListener("scroll", scroll);
    };
  }, []);
  const navigate = useCallback((path: string, discard = false) => {
    if (
      !discard &&
      dirtyRef.current &&
      !confirm("Du har osparade ändringar. Vill du lämna sidan?")
    )
      return false;
    history.replaceState({ ...entry.current, scroll: window.scrollY }, "");
    entry.current = { brief: true, index: entry.current.index + 1, scroll: 0 };
    history.pushState(entry.current, "", "#" + path);
    setRoute(path);
    scrollTo(0, 0);
    return true;
  }, []);
  return { route, navigate };
}
