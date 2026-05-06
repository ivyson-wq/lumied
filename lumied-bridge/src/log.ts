import { config } from "./config.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function fmt(level: string, msg: string, extra?: unknown): string {
  const ts = new Date().toISOString();
  if (extra !== undefined) {
    try { return `${ts} [${level}] ${msg} ${JSON.stringify(extra)}`; }
    catch { return `${ts} [${level}] ${msg} ${String(extra)}`; }
  }
  return `${ts} [${level}] ${msg}`;
}

function should(level: keyof typeof LEVELS): boolean {
  return LEVELS[level] >= LEVELS[config.logLevel];
}

export const log = {
  debug: (msg: string, extra?: unknown) => should("debug") && console.log(fmt("debug", msg, extra)),
  info: (msg: string, extra?: unknown) => should("info") && console.log(fmt("info", msg, extra)),
  warn: (msg: string, extra?: unknown) => should("warn") && console.warn(fmt("warn", msg, extra)),
  error: (msg: string, extra?: unknown) => should("error") && console.error(fmt("error", msg, extra)),
};
