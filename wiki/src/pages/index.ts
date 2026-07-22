import {
  Activity,
  BookOpenText,
  Bot,
  Clapperboard,
  Cloud,
  Database,
  Factory,
  Gamepad2,
  Globe,
  Home,
  KeyRound,
  Link as LinkIcon,
  type LucideIcon,
  MonitorPlay,
  PawPrint,
  Search,
  Server,
  Siren,
  TerminalSquare,
  Upload,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";
import { AgentsPage } from "./agents";
import { ArrPage } from "./arr";
import { BackupsPage } from "./backups";
import { BrowsersPage } from "./browsers";
import { ConnectingPage } from "./connecting";
import { FactorioPage } from "./factorio";
import { HomePage } from "./home";
import { InfraPage } from "./infra";
import { JellyfinPage } from "./jellyfin";
import { MindustryPage } from "./mindustry";
import { MonitoringPage } from "./monitoring";
import { NullclawPage } from "./nullclaw";
import { PinchflatPage } from "./pinchflat";
import { RulesPage } from "./rules";
import { RunbookPage } from "./runbook";
import { SearxngPage } from "./searxng";
import { SecretsPage } from "./secrets";
import { ServicesPage } from "./services";
import { ShlinkPage } from "./shlink";
import { ZiplinePage } from "./zipline";

export type WikiPage = {
  slug: string;
  title: string;
  icon: LucideIcon;
  component: ComponentType;
};

export type WikiGroup = {
  label?: string; // unlabeled = the always-visible top section
  pages: WikiPage[];
};

// sidebar structure. tightly-coupled services share a page on purpose:
// the arr stack is one machine, the two headless browsers are one concept.
export const groups: WikiGroup[] = [
  {
    pages: [
      { slug: "home", title: "home", icon: Home, component: HomePage },
      { slug: "connecting", title: "connecting", icon: TerminalSquare, component: ConnectingPage },
      { slug: "services", title: "services", icon: Server, component: ServicesPage },
    ],
  },
  {
    label: "media",
    pages: [
      { slug: "jellyfin", title: "jellyfin", icon: Clapperboard, component: JellyfinPage },
      { slug: "arr", title: "arr pipeline", icon: Workflow, component: ArrPage },
      { slug: "pinchflat", title: "pinchflat", icon: MonitorPlay, component: PinchflatPage },
    ],
  },
  {
    label: "agents & web",
    pages: [
      { slug: "agents", title: "agents & ai", icon: Bot, component: AgentsPage },
      { slug: "nullclaw", title: "nullclaw", icon: PawPrint, component: NullclawPage },
      { slug: "browsers", title: "browsers", icon: Globe, component: BrowsersPage },
      { slug: "searxng", title: "searxng", icon: Search, component: SearxngPage },
    ],
  },
  {
    label: "games",
    pages: [
      { slug: "factorio", title: "factorio", icon: Factory, component: FactorioPage },
      { slug: "mindustry", title: "mindustry", icon: Gamepad2, component: MindustryPage },
    ],
  },
  {
    label: "sharing",
    pages: [
      { slug: "zipline", title: "zipline", icon: Upload, component: ZiplinePage },
      { slug: "shlink", title: "shlink", icon: LinkIcon, component: ShlinkPage },
    ],
  },
  {
    label: "ops",
    pages: [
      { slug: "infra", title: "infra", icon: Cloud, component: InfraPage },
      { slug: "backups", title: "backups", icon: Database, component: BackupsPage },
      { slug: "monitoring", title: "monitoring", icon: Activity, component: MonitoringPage },
      { slug: "secrets", title: "secrets", icon: KeyRound, component: SecretsPage },
      { slug: "runbook", title: "runbook", icon: BookOpenText, component: RunbookPage },
    ],
  },
];

export const pages: WikiPage[] = groups.flatMap((g) => g.pages);

// pinned to the sidebar footer, separate from the main nav
export const rulesPage: WikiPage = {
  slug: "rules",
  title: "rules (for claudes)",
  icon: Siren,
  component: RulesPage,
};

export const allPages = [...pages, rulesPage];
