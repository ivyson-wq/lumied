import { config } from "./config.js";
import { log } from "./log.js";
import { start as startWs, stop as stopWs } from "./ws.js";
import { startListener } from "./listener.js";
import { runStartupAutoConfig } from "./autoconfig.js";

log.info(`Lumied Bridge — escola_id=${config.escolaId.slice(0, 8)}…`);
log.info(`gateway: ${config.gatewayUrl}`);

startListener();
startWs();

// Auto-config callbacks: rodada após 5s pra dar tempo do listener subir e LAN estabilizar
setTimeout(() => {
  runStartupAutoConfig().catch((e) => log.warn("auto-config crashed", String(e)));
}, 5000);

function shutdown(signal: string) {
  log.info(`recebido ${signal} — encerrando…`);
  stopWs();
  setTimeout(() => process.exit(0), 200);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  log.error("uncaughtException", err.message);
});
process.on("unhandledRejection", (reason) => {
  log.error("unhandledRejection", String(reason));
});
