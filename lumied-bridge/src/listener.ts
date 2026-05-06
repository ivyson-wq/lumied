import http from "node:http";
import { networkInterfaces } from "node:os";
import { config } from "./config.js";
import { log } from "./log.js";
import { forwardEvent } from "./ws.js";

function detectLanIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "0.0.0.0";
}

function readBody(req: http.IncomingMessage, max = 5 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (c: Buffer) => {
      total += c.length;
      if (total > max) {
        req.destroy();
        reject(new Error("payload too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function startListener(): void {
  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, ts: Date.now() }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
      return;
    }

    try {
      const body = await readBody(req);
      let parsed: any = {};
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) {
        try { parsed = JSON.parse(body.toString("utf8") || "{}"); }
        catch { parsed = { raw_b64: body.toString("base64") }; }
      } else {
        parsed = { raw_b64: body.toString("base64"), content_type: ct };
      }

      // Anexa metadata útil pro edge function
      const sourceIp = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
      const eventPayload = {
        ...parsed,
        source_ip: sourceIp,
        path: req.url,
        received_at: new Date().toISOString(),
      };

      forwardEvent(eventPayload);
      log.info(`evento de ${sourceIp} forwarded`, { path: req.url });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    } catch (e: any) {
      log.error("erro processando evento", e?.message || String(e));
      res.writeHead(400);
      res.end(JSON.stringify({ ok: false, error: e?.message || "erro" }));
    }
  });

  const host = config.eventListenerHost || detectLanIp();
  server.listen(config.eventListenerPort, "0.0.0.0", () => {
    log.info(`HTTP listener ouvindo em http://${host}:${config.eventListenerPort}`);
    log.info(`→ configure os iDFace pra POST eventos em http://${host}:${config.eventListenerPort}/event`);
  });
}
