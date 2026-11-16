import type { ReactNode } from "react";

// Nothing to show yet: what's missing, and what to do about it.
export default function EmptyState({ title, children, action, className = "" }: {
  title: ReactNode; children?: ReactNode; action?: ReactNode; className?: string;
}) {
  return (
    <div className={`well flex flex-col items-center px-6 py-10 text-center animate-fade ${className}`}>
      <div className="text-sm font-semibold text-ink">{title}</div>
      {children && <div className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-faint">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
