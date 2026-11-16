"use client";

import { useEffect, useState } from "react";

// A number that counts from `from` to `to` (Elo changes, results). Screen readers and reduced
// motion get the final value straight away; `format` renders each frame.
export default function CountUp({ from = 0, to, delay = 0, duration = 900, format = String, className = "" }: {
  from?: number; to: number; delay?: number; duration?: number; format?: (value: number) => string; className?: string;
}) {
  const [value, setValue] = useState(from);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || from === to) {
      const frame = requestAnimationFrame(() => setValue(to));
      return () => cancelAnimationFrame(frame);
    }
    let frame = 0;
    let start: number | null = null;
    function tick(now: number) {
      start ??= now;
      const progress = Math.min(1, Math.max(0, (now - start - delay) / duration));
      const eased = 1 - Math.pow(1 - progress, 4);
      setValue(Math.round(from + (to - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [from, to, delay, duration]);

  return <span className={className}><span aria-hidden="true">{format(value)}</span><span className="sr-only">{format(to)}</span></span>;
}
