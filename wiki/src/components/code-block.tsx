import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed text-card-foreground">
        {children}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        onClick={copy}
        className="absolute top-2 right-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="copy"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </Button>
    </div>
  );
}

export function InlineCode({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[13px]">{children}</code>;
}
