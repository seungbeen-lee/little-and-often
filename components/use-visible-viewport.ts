"use client";
import { useEffect, useState } from "react";

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
