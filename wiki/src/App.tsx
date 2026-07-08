import { ExternalLink, Search } from "lucide-react";
import { useEffect, useState } from "react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FACTORIO, URLS } from "@/config";
import { href, navigate, useRoute } from "@/lib/route";
import { allPages, pages, rulesPage } from "@/pages";

const externalLinks = [
  { title: "code-server", url: URLS.codeServer },
  { title: "uptime-kuma", url: URLS.kuma },
  { title: "repo", url: URLS.repo },
];

export default function App() {
  const slug = useRoute();
  const page = allPages.find((p) => p.slug === slug) ?? pages[0];
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
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <div className="flex items-center justify-between gap-2 pl-2 group-data-[collapsible=icon]:pl-0">
              <a
                href={href("home")}
                className="flex items-center gap-2 group-data-[collapsible=icon]:hidden"
              >
                <span>🐾</span>
                <span className="font-semibold tracking-tight">tetrapod</span>
              </a>
              <SidebarTrigger />
            </div>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {pages.map((p) => (
                    <SidebarMenuItem key={p.slug}>
                      <SidebarMenuButton asChild isActive={p.slug === slug} tooltip={p.title}>
                        <a href={href(p.slug)}>
                          <p.icon className="size-4" />
                          <span>{p.title}</span>
                        </a>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={rulesPage.slug === slug}
                  tooltip={rulesPage.title}
                >
                  <a href={href(rulesPage.slug)}>
                    <rulesPage.icon className="size-4" />
                    <span>{rulesPage.title}</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur">
          {/* mobile-only: the in-sidebar trigger is unreachable when the sheet is closed */}
          <SidebarTrigger className="md:hidden" />
          <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent/50"
            >
              <Search className="size-3.5" />
              <span>search…</span>
              <Kbd className="ml-4">⌘K</Kbd>
            </button>
          </header>

          <main className="mx-auto w-full max-w-3xl px-6 py-10">
            <page.component />
            <footer className="mt-16 border-t pt-6 text-muted-foreground text-xs">
              edit <code>wiki/src</code> in{" "}
              <a className="underline" href={URLS.repo}>
                the repo
              </a>{" "}
              (facts live in <code>src/config.ts</code>), <code>pnpm build</code> on the box.
            </footer>
          </main>
        </SidebarInset>

        <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
          <Command>
            <CommandInput placeholder="go to…" />
            <CommandList>
              <CommandEmpty>nothing found.</CommandEmpty>
              <CommandGroup heading="pages">
                {allPages.map((p) => (
                  <CommandItem
                    key={p.slug}
                    onSelect={() => {
                      setPaletteOpen(false);
                      navigate(p.slug);
                    }}
                  >
                    <p.icon className="size-4" />
                    {p.title}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup heading="open">
                {externalLinks.map((l) => (
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
          </Command>
        </CommandDialog>
      </SidebarProvider>
    </TooltipProvider>
  );
}
