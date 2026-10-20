"use client";

import { useEffect, useRef } from "react";

// Open dialogs and menus, most recent last: Escape closes only the topmost (a conflict dialog over the
// upload dialog closes first).
const stack: symbol[] = [];

/** Calls `onEscape` when Escape is pressed while `active` and this is the topmost open layer. */
export function useEscape(active: boolean, onEscape: () => void) {
  const callback = useRef(onEscape);
  useEffect(() => {
    callback.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const id = Symbol();
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || stack.at(-1) !== id) return;
      e.preventDefault();
      callback.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stack.splice(stack.indexOf(id), 1);
    };
  }, [active]);
}
