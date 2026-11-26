import { readFile } from "node:fs/promises";
import { createConnection } from "node:net";

const RCON_AUTH = 3;
const RCON_EXECCOMMAND = 2;

function encodePacket(id: number, type: number, body: string): Buffer {
  const bodyBuf = Buffer.from(body, "utf8");
  const size = 4 + 4 + bodyBuf.length + 2;
  const buf = Buffer.alloc(4 + size);
  buf.writeInt32LE(size, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  bodyBuf.copy(buf, 12);
  buf.writeInt16LE(0, 12 + bodyBuf.length);
  return buf;
}

export async function factorioRcon(
  command: string,
  host = "127.0.0.1",
  port = 27015,
  passwordFile = "/opt/tetrapod/factorio/config/rconpw"
): Promise<string> {
  const password = (await readFile(passwordFile, "utf8")).trim();

  return await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let authed = false;
    let output = "";
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(output.trim());
    };

    const timer = setTimeout(() => done(new Error("RCON timeout")), 4000);

    socket.on("error", (err) => done(err));
    socket.on("connect", () => {
      socket.write(encodePacket(1, RCON_AUTH, password));
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const size = buf.readInt32LE(0);
        if (size < 10 || size > 1_048_576) {
          done(new Error("Invalid RCON packet size"));
          return;
        }
        if (buf.length < 4 + size) break;
        const id = buf.readInt32LE(4);
        const body = buf.subarray(12, 4 + size - 2).toString("utf8");
        buf = buf.subarray(4 + size);

        if (!authed) {
          if (id === -1) {
            done(new Error("RCON auth failed"));
            return;
          }
          if (id === 1) {
            authed = true;
            socket.write(encodePacket(2, RCON_EXECCOMMAND, command));
          }
        } else if (id === 2) {
          output += body;
          done();
          return;
        }
      }
    });
  });
}
