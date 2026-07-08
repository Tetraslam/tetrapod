import {
  Activity,
  BookOpenText,
  Bot,
  Cloud,
  Database,
  Factory,
  Home,
  KeyRound,
  type LucideIcon,
  Server,
  Siren,
  TerminalSquare,
} from "lucide-react";
import type { ComponentType } from "react";
import { AgentsPage } from "./agents";
import { BackupsPage } from "./backups";
import { ConnectingPage } from "./connecting";
import { FactorioPage } from "./factorio";
import { HomePage } from "./home";
import { InfraPage } from "./infra";
import { MonitoringPage } from "./monitoring";
import { RulesPage } from "./rules";
import { RunbookPage } from "./runbook";
import { SecretsPage } from "./secrets";
import { ServicesPage } from "./services";

export type WikiPage = {
  slug: string;
  title: string;
  icon: LucideIcon;
  component: ComponentType;
};

export const pages: WikiPage[] = [
  { slug: "home", title: "home", icon: Home, component: HomePage },
  { slug: "connecting", title: "connecting", icon: TerminalSquare, component: ConnectingPage },
  { slug: "factorio", title: "factorio", icon: Factory, component: FactorioPage },
  { slug: "services", title: "services", icon: Server, component: ServicesPage },
  { slug: "backups", title: "backups", icon: Database, component: BackupsPage },
  { slug: "monitoring", title: "monitoring", icon: Activity, component: MonitoringPage },
  { slug: "secrets", title: "secrets", icon: KeyRound, component: SecretsPage },
  { slug: "agents", title: "agents & ai", icon: Bot, component: AgentsPage },
  { slug: "infra", title: "infra", icon: Cloud, component: InfraPage },
  { slug: "runbook", title: "runbook", icon: BookOpenText, component: RunbookPage },
];

// pinned to the sidebar footer, separate from the main nav
export const rulesPage: WikiPage = {
  slug: "rules",
  title: "rules (for claudes)",
  icon: Siren,
  component: RulesPage,
};

export const allPages = [...pages, rulesPage];
