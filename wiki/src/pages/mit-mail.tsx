import { CodeBlock } from "@/components/code-block";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Doc, P, Page, Reference } from "@/components/wiki";
import { MIT_MAIL } from "@/config";

export function MitMailPage() {
  return (
    <Page
      title="MIT mail proxy"
      intro="a tailnet-only TLS bridge that gives ordinary IMAP and SMTP clients Microsoft 365 OAuth2 access to shresht@mit.edu."
    >
      <Doc title="connect Omamail">
        <P>
          choose <strong>Add a mailbox...</strong>, then <strong>IMAP</strong>, expand{" "}
          <strong>Server settings</strong>, and enter these values. Server fields take a hostname,
          not a URL.
        </P>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">email / username</TableCell>
              <TableCell className="font-mono text-xs">{MIT_MAIL.address}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">password</TableCell>
              <TableCell className="font-mono text-xs">{MIT_MAIL.passwordRef}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">IMAP server / port</TableCell>
              <TableCell className="font-mono text-xs">
                {MIT_MAIL.host} / {MIT_MAIL.imapPort}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">SMTP server / port</TableCell>
              <TableCell className="font-mono text-xs">
                {MIT_MAIL.host} / {MIT_MAIL.smtpPort}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">username override</TableCell>
              <TableCell className="text-xs">leave blank</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <P>
          keep TLS verification enabled. The listeners use a publicly trusted Tailscale certificate,
          but only accept connections on tetrapod&apos;s tailnet address.
        </P>
      </Doc>

      <Doc title="authorize Microsoft 365">
        <P>
          the first login starts Microsoft device authorization. Follow the URL and code printed in
          the service journal, then complete Touchstone and Duo. Later logins use the cached refresh
          token.
        </P>
        <CodeBlock>{`sudo journalctl -fu email-oauth2-proxy.service`}</CodeBlock>
      </Doc>

      <Doc title="operate">
        <CodeBlock>{`sudo systemctl status email-oauth2-proxy.service
sudo systemctl start email-oauth2-proxy-cert.service
sudo journalctl -u email-oauth2-proxy.service -n 100
openssl s_client -connect ${MIT_MAIL.host}:${MIT_MAIL.imapPort} -servername ${MIT_MAIL.host}`}</CodeBlock>
        <P>
          the certificate job runs daily and renews when fewer than 30 days remain. A renewed
          certificate restarts the proxy so new TLS sessions receive it.
        </P>
      </Doc>

      <Reference>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="text-muted-foreground">proxy</TableCell>
              <TableCell className="font-mono text-xs">emailproxy 2026.7.3</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">upstream</TableCell>
              <TableCell className="font-mono text-xs">
                outlook.office365.com:993 / smtp.office365.com:587 STARTTLS
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">OAuth cache</TableCell>
              <TableCell className="font-mono text-xs">
                /var/lib/email-oauth2-proxy/emailproxy.cache (mode 0700 state, outside restic roots)
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="text-muted-foreground">monitoring</TableCell>
              <TableCell className="text-xs">Kuma TCP checks for both tailnet listeners</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Reference>
    </Page>
  );
}
