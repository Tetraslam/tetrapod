import { ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { KumaStatus } from "@/components/kuma-status";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { FACTORIO, URLS } from "@/config";
import { sections } from "@/sections";

const quickLinks = [
  { title: "code-server", url: URLS.codeServer },
  { title: "uptime-kuma", url: URLS.kuma },
  { title: "repo", url: URLS.repo },
];

function scrollTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader className="px-4 pt-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">🐾</span>
            <span className="font-semibold tracking-tight">tetrapod</span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>wiki</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {sections.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <SidebarMenuButton onClick={() => scrollTo(s.id)}>
                      <s.icon className="size-4" />
                      <span>{s.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>links</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {quickLinks.map((l) => (
                  <SidebarMenuItem key={l.title}>
                    <SidebarMenuButton asChild>
                      <a href={l.url} target="_blank" rel="noreferrer">
                        {l.title === "repo" ? (
                          <ExternalLink className="size-4" />
                        ) : (
                          <ExternalLink className="size-4" />
                        )}
                        <span>{l.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-5" />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent/50"
          >
            <Search className="size-3.5" />
            <span>search the wiki…</span>
            <Kbd className="ml-4">⌘K</Kbd>
          </button>
        </header>

        <main className="mx-auto w-full max-w-3xl space-y-12 px-6 py-10">
          <section className="space-y-3">
            <h1 className="font-semibold text-2xl tracking-tight">home dashboard</h1>
            <KumaStatus />
          </section>

          {sections.map((s) => (
            <section key={s.id} id={s.id} className="scroll-mt-20 space-y-4">
              <div className="flex items-center gap-2">
                <s.icon className="size-4 text-muted-foreground" />
                <h2 className="font-semibold text-xl tracking-tight">{s.title}</h2>
              </div>
              {s.body}
            </section>
          ))}

          <footer className="pb-8 text-muted-foreground text-xs">
            source of truth:{" "}
            <a className="underline" href={URLS.repo}>
              {URLS.repo}
            </a>{" "}
            — edit <code>wiki/src/config.ts</code> and rebuild.
          </footer>
        </main>
      </SidebarInset>

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="jump to…" />
        <CommandList>
          <CommandEmpty>nothing found.</CommandEmpty>
          <CommandGroup heading="sections">
            {sections.map((s) => (
              <CommandItem
                key={s.id}
                onSelect={() => {
                  setPaletteOpen(false);
                  scrollTo(s.id);
                }}
              >
                <s.icon className="size-4" />
                {s.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="open">
            {quickLinks.map((l) => (
              <CommandItem
                key={l.title}
                onSelect={() => {
                  setPaletteOpen(false);
                  window.open(l.url, "_blank");
                }}
              >
                <ExternalLink className="size-4" />
                {l.title}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="copy">
            <CommandItem
              onSelect={() => {
                navigator.clipboard.writeText(FACTORIO.connectAddress);
                setPaletteOpen(false);
              }}
            >
              factorio address ({FACTORIO.connectAddress})
            </CommandItem>
            <CommandItem
              onSelect={() => {
                navigator.clipboard.writeText("ssh tetraslam@tetrapod");
                setPaletteOpen(false);
              }}
            >
              ssh command
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </SidebarProvider>
  );
}
