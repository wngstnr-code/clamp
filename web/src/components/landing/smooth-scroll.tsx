"use client";

import { ReactLenis } from "lenis/react";
import "lenis/dist/lenis.css";
import { useEffect, useState } from "react";

// Smooth, eased scrolling for the landing page. Off when the visitor asks for reduced motion.
export function SmoothScroll() {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return on ? <ReactLenis root options={{ lerp: 0.1, anchors: true }} /> : null;
}
