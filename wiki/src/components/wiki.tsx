import type { ReactNode } from "react";
import { href } from "@/lib/route";

// shared building blocks so every page reads the same way

export function Page({
  title,
  intro,
  children,
}: {
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-semibold text-2xl tracking-tight">{title}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{intro}</p>
      </header>
      {children}
    </article>
  );
}

export function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold text-lg tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

// reference = the tables/values half; visually separated from the how-to half
export function Reference({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-dashed p-4">
      <h2 className="font-mono text-muted-foreground text-xs uppercase tracking-widest">
        reference
      </h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm leading-relaxed">{children}</p>;
}

export function Steps({ children }: { children: ReactNode }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-muted-foreground text-sm leading-relaxed">
      {children}
    </ol>
  );
}

export function WikiLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a
      href={href(to)}
      className="text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
    >
      {children}
    </a>
  );
}

export function Ext({ url, children }: { url: string; children: ReactNode }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
    >
      {children}
    </a>
  );
}
