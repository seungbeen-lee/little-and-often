"use client";
import { useEffect, useState, useSyncExternalStore } from "react";

const mobileTableQuery = "(max-width: 760px)";
function subscribeMobileTableLayout(onChange: () => void) {
  const query = window.matchMedia(mobileTableQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

// Choose the editing host from the layout viewport before the first focus.
// Visual viewport measurements arrive later and can change with the keyboard.
export function useMobileTableLayout() {
  return useSyncExternalStore(subscribeMobileTableLayout, () => window.matchMedia(mobileTableQuery).matches, () => false);
}

export function useVisibleViewport() {
  const [viewport, setViewport] = useState({ width: 0, height: 0, left: 0, top: 0 });
  useEffect(() => {
    const visual = window.visualViewport;
    const update = () => setViewport({ width: visual?.width ?? window.innerWidth, height: visual?.height ?? window.innerHeight, left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0 });
    update();
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => { visual?.removeEventListener("resize", update); visual?.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  return viewport;
}
