// HTTP client tolerante a headers fora do padrão HTTP/1.1.
// O firmware do iDFace devolve headers com caracteres que o parser do undici
// (llhttp) rejeita com HPE_INVALID_HEADER_TOKEN. Usamos https.request com
// insecureHTTPParser:true (mesmo comportamento que o curl).

import * as https from "node:https";
import * as http from "node:http";

const insecureAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });

export interface TolerantResponseInit {
    status: number;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
}

export class TolerantResponse {
    readonly status: number;
    readonly ok: boolean;
    readonly headers: { get: (name: string) => string | null; getSetCookie: () => string[] };
    private readonly _body: Buffer;

    constructor(init: TolerantResponseInit) {
        this.status = init.status;
        this.ok = init.status >= 200 && init.status < 300;
        this._body = init.body;
        const raw = init.headers;
        this.headers = {
            get(name: string): string | null {
                const v = raw[name.toLowerCase()];
                if (Array.isArray(v)) return v.join(", ");
                return v ?? null;
            },
            getSetCookie(): string[] {
                const v = raw["set-cookie"];
                if (!v) return [];
                return Array.isArray(v) ? v : [v];
            },
        };
    }

    async text(): Promise<string> { return this._body.toString("utf8"); }
    async json(): Promise<any> { return JSON.parse(this._body.toString("utf8")); }
    async arrayBuffer(): Promise<ArrayBuffer> {
        const ab = new ArrayBuffer(this._body.byteLength);
        new Uint8Array(ab).set(this._body);
        return ab;
    }
}

export interface TolerantFetchInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Buffer | Uint8Array;
    signal?: AbortSignal;
}

export function tolerantFetch(rawUrl: string, init: TolerantFetchInit = {}, timeoutMs = 25_000): Promise<TolerantResponse> {
    return new Promise((resolve, reject) => {
        let parsed: URL;
        try { parsed = new URL(rawUrl); } catch (e: any) { return reject(e); }

        const isHttps = parsed.protocol === "https:";
        const lib = isHttps ? https : http;
        const headers: Record<string, string> = { ...(init.headers || {}) };
        let bodyBuf: Buffer | undefined;
        if (init.body !== undefined) {
            bodyBuf = Buffer.isBuffer(init.body)
                ? init.body
                : init.body instanceof Uint8Array
                    ? Buffer.from(init.body)
                    : Buffer.from(String(init.body), "utf8");
            if (!headers["Content-Length"] && !headers["content-length"]) {
                headers["Content-Length"] = String(bodyBuf.length);
            }
        }

        const opts: https.RequestOptions = {
            method: init.method || "GET",
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            headers,
            insecureHTTPParser: true,
            agent: isHttps ? insecureAgent : undefined,
        };

        const req = lib.request(opts, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
            res.on("end", () => {
                resolve(new TolerantResponse({
                    status: res.statusCode || 0,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                }));
            });
            res.on("error", reject);
        });

        req.on("error", reject);
        const timer = setTimeout(() => { req.destroy(new Error(`timeout after ${timeoutMs}ms`)); }, timeoutMs);
        req.on("close", () => clearTimeout(timer));
        if (init.signal) {
            const onAbort = () => req.destroy(new Error("aborted"));
            if (init.signal.aborted) onAbort();
            else init.signal.addEventListener("abort", onAbort, { once: true });
        }

        if (bodyBuf) req.write(bodyBuf);
        req.end();
    });
}
