// ═══════════════════════════════════════════════════════════════
//  Migração — validators (CPF/CNPJ mod 11, dedupe, normalizações)
// ═══════════════════════════════════════════════════════════════

export type Flag = { code: string; msg: string; severity: "info" | "warn" | "error" };

export function onlyDigits(s: string | null | undefined): string {
  return String(s || "").replace(/\D+/g, "");
}

export function isValidCpf(raw: string | null | undefined): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i);
  let dv = 11 - (sum % 11);
  if (dv >= 10) dv = 0;
  if (dv !== parseInt(d[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i);
  dv = 11 - (sum % 11);
  if (dv >= 10) dv = 0;
  return dv === parseInt(d[10]);
}

export function isValidCnpj(raw: string | null | undefined): boolean {
  const d = onlyDigits(raw);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;
  const calc = (len: number) => {
    const pesos = len === 12
      ? [5,4,3,2,9,8,7,6,5,4,3,2]
      : [6,5,4,3,2,9,8,7,6,5,4,3,2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += parseInt(d[i]) * pesos[i];
    const dv = sum % 11;
    return dv < 2 ? 0 : 11 - dv;
  };
  return calc(12) === parseInt(d[12]) && calc(13) === parseInt(d[13]);
}

export function normName(s: string | null | undefined): string {
  return String(s || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
}

export function normEmail(s: string | null | undefined): string {
  return String(s || "").toLowerCase().trim();
}

export function parseDateBR(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = String(s).trim();
  // DD/MM/YYYY ou DD-MM-YYYY
  let m = v.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/);
  if (m) {
    let yyyy = parseInt(m[3]);
    if (yyyy < 100) yyyy += yyyy < 30 ? 2000 : 1900;
    return `${yyyy.toString().padStart(4,"0")}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  // YYYY-MM-DD ou YYYY/MM/DD
  m = v.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
  return null;
}

export function parseMoneyBR(s: string | number | null | undefined): number | null {
  if (s === null || s === undefined || s === "") return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  // "1.234,56" → 1234.56 ; "1234.56" → 1234.56 ; "R$ 1.200" → 1200
  const cleaned = String(s).replace(/[^\d,.\-]/g, "");
  if (!cleaned) return null;
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");
  let normalized = cleaned;
  if (hasComma && hasDot) {
    // assume formato BR: . milhar, , decimal
    normalized = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    normalized = cleaned.replace(",", ".");
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

export function statusFinanceiroMap(raw: string | null | undefined): "pendente"|"pago"|"cancelado"|"atrasado"|null {
  const v = normName(raw);
  if (!v) return null;
  if (/pago|liquid|baixado|quitado/.test(v)) return "pago";
  if (/cancel|estorn/.test(v)) return "cancelado";
  if (/atras|vencid/.test(v)) return "atrasado";
  if (/pend|aberto|a receber|a pagar/.test(v)) return "pendente";
  return null;
}

export async function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
