import { CodeBlock, InlineCode } from "@/components/code-block";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Doc, P, Page, Reference } from "@/components/wiki";
import { OP_ITEMS } from "@/config";

export function SecretsPage() {
  return (
    <Page
      title="secrets"
      intro="the box's only 1password access is opa: a read-only service account scoped to the Agents vault. no desktop app, no personal vault, no op signin."
    >
      <Doc title="read a secret">
        <CodeBlock>{`opa read "op://Agents/<item>/credential"
opa item list --vault Agents
opa item get "<item>" --format json | jq '.fields[] | {label, type}'`}</CodeBlock>
      </Doc>

      <Doc title="add a secret">
        <P>
          the service account is read-only from here — new items are created from the laptop (which
          has write access). ask tetraslam, or add it yourself laptop-side and{" "}
          <InlineCode>opa read</InlineCode> it here.
        </P>
      </Doc>

      <Doc title="rules">
        <P>
          never write a resolved secret to a file, a committed env, or a log. the repo is public —
          only <InlineCode>op://</InlineCode> references are safe to commit. keep secrets in pipes
          or per-command env vars.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>item</TableHead>
              <TableHead>used for</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {OP_ITEMS.map((i) => (
              <TableRow key={i.item}>
                <TableCell className="font-mono text-xs">{i.item}</TableCell>
                <TableCell className="text-muted-foreground text-xs">{i.use}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <P>
          token: <InlineCode>~/.config/op/agents-token</InlineCode> (600) · wrapper:{" "}
          <InlineCode>/usr/local/bin/opa</InlineCode>
        </P>
      </Reference>
    </Page>
  );
}
