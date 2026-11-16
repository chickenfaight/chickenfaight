import type { ReactNode } from "react";

// The top of every signed-in screen: eyebrow, display-face title, a line of description, and
// optional actions on the right. `id` labels the page's <main> (`aria-labelledby`).
export default function PageHeader({ id, eyebrow, title, description, actions, back }: {
  id: string; eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: ReactNode;
}) {
  return (
    <header className="mb-stack">
      {back && <div className="mb-4">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 animate-rise">
          {eyebrow && <p className="eyebrow mb-2 text-accent-ink">{eyebrow}</p>}
          <h1 id={id} className="headline truncate text-4xl">{title}</h1>
          {description && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </div>
    </header>
  );
}
