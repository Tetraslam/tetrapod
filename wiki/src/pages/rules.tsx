import { Siren } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Doc, P, Page } from "@/components/wiki";
import { HARD_RULES } from "@/config";

export function RulesPage() {
  return (
    <Page
      title="rules (for claudes)"
      intro="agents running on this box: these are non-negotiable. humans may also find them character-building."
    >
      <Alert variant="destructive">
        <Siren className="size-4" />
        <AlertTitle>hard rules</AlertTitle>
        <AlertDescription>
          <ul className="list-disc space-y-1.5 pl-4">
            {HARD_RULES.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>

      <Doc title="why they exist">
        <P>
          bedrock hosts the claude models tetraslam depends on; tailscale is the only door to the
          box; the factorio server has real players; and the repo-first rule is what keeps this
          machine rebuildable in twenty minutes instead of being a haunted snowflake.
        </P>
        <P>
          the same rules ship to agents as memory (provision/agent/memory/reference_tetrapod.md) —
          this page is the human-readable copy.
        </P>
      </Doc>
    </Page>
  );
}
