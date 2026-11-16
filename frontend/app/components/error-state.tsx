"use client";

import type { ReactNode } from "react";
import Button from "./button";

// Something failed to load: say what, and offer the retry when there is one. `compact` fits inside
// a list or a small card.
export default function ErrorState({ message, onRetry, retryLabel = "Try again", children, compact = false, className = "" }: {
  message: ReactNode; onRetry?: () => void; retryLabel?: string; children?: ReactNode; compact?: boolean; className?: string;
}) {
  if (compact) {
    return <div role="alert" className={`flex flex-wrap items-center gap-3 text-sm text-danger ${className}`}>
      <span>{message}</span>
      {onRetry && <Button size="sm" onClick={onRetry}>{retryLabel}</Button>}
    </div>;
  }
  return (
    <div role="alert" className={`well flex flex-col items-center px-6 py-10 text-center animate-fade ${className}`}>
      <p className="text-sm font-semibold text-danger">{message}</p>
      {children && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-faint">{children}</div>}
      {onRetry && <Button className="mt-5" onClick={onRetry}>{retryLabel}</Button>}
    </div>
  );
}
