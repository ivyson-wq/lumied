// WebAuthn server helpers — Deno/Supabase Edge Functions
// Minimal CBOR decoder + WebAuthn verification without external deps

// ── Base64url ─────────────────────────────────────────
export function b64urlEncode(buf: Uint8Array): string {
  let b = '';
  for (const byte of buf) b += String.fromCharCode(byte);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - b64.length % 4);
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, (_, i) => bin.charCodeAt(i));
}

// ── Random challenge ──────────────────────────────────
export function generateChallenge(): string {
  return b64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

// ── SHA-256 ───────────────────────────────────────────
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return new Uint8Array(hash);
}

// ── Minimal CBOR decoder (subset: maps, bstr, uint, tstr) ──
function decodeCbor(data: Uint8Array): unknown {
  let offset = 0;
  function read(): unknown {
    const initial = data[offset++];
    const major = initial >> 5;
    const info = initial & 0x1f;
    let val = 0;
    if (info < 24) val = info;
    else if (info === 24) val = data[offset++];
    else if (info === 25) { val = (data[offset] << 8) | data[offset + 1]; offset += 2; }
    else if (info === 26) { val = (data[offset] << 24) | (data[offset+1] << 16) | (data[offset+2] << 8) | data[offset+3]; offset += 4; }

    if (major === 0) return val; // unsigned int
    if (major === 1) return -(val + 1); // negative int
    if (major === 2) { const buf = data.slice(offset, offset + val); offset += val; return buf; } // byte string
    if (major === 3) { const buf = data.slice(offset, offset + val); offset += val; return new TextDecoder().decode(buf); } // text string
    if (major === 4) { const arr: unknown[] = []; for (let i = 0; i < val; i++) arr.push(read()); return arr; } // array
    if (major === 5) { // map
      const map: Record<string, unknown> = {};
      for (let i = 0; i < val; i++) { const k = read(); map[String(k)] = read(); }
      return map;
    }
    return null;
  }
  return read();
}

// ── Parse clientDataJSON ──────────────────────────────
export function parseClientDataJSON(b64url: string): { type: string; challenge: string; origin: string } {
  const json = new TextDecoder().decode(b64urlDecode(b64url));
  return JSON.parse(json);
}

// ── Parse authenticator data ──────────────────────────
interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  userPresent: boolean;
  userVerified: boolean;
  signCount: number;
  attestedCredData?: { credentialId: Uint8Array; publicKeyBytes: Uint8Array };
}

export function parseAuthData(buf: Uint8Array): AuthData {
  const rpIdHash = buf.slice(0, 32);
  const flags = buf[32];
  const signCount = (buf[33] << 24) | (buf[34] << 16) | (buf[35] << 8) | buf[36];
  const result: AuthData = {
    rpIdHash, flags, signCount,
    userPresent: !!(flags & 0x01),
    userVerified: !!(flags & 0x04),
  };
  // Attested credential data (bit 6 of flags)
  if (flags & 0x40) {
    // Skip AAGUID (16 bytes at offset 37)
    const credIdLen = (buf[53] << 8) | buf[54];
    const credentialId = buf.slice(55, 55 + credIdLen);
    const publicKeyBytes = buf.slice(55 + credIdLen);
    result.attestedCredData = { credentialId, publicKeyBytes };
  }
  return result;
}

// ── COSE key to CryptoKey (ES256 / P-256) ─────────────
export function coseToKey(coseBytes: Uint8Array): Promise<CryptoKey> {
  const cose = decodeCbor(coseBytes) as Record<string, unknown>;
  // COSE key map: 1=kty, 3=alg, -1=crv, -2=x, -3=y
  const x = cose['-2'] as Uint8Array;
  const y = cose['-3'] as Uint8Array;
  // Uncompressed point: 0x04 || x || y
  const rawKey = new Uint8Array(1 + x.length + y.length);
  rawKey[0] = 0x04;
  rawKey.set(x, 1);
  rawKey.set(y, 1 + x.length);
  return crypto.subtle.importKey('raw', rawKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}

// ── Verify registration ──────────────────────────────
export async function verifyRegistration(
  clientDataB64: string, attestationObjectB64: string,
  expectedChallenge: string, rpId: string
): Promise<{ credentialId: string; publicKey: string; signCount: number }> {
  // 1. Parse clientDataJSON
  const cd = parseClientDataJSON(clientDataB64);
  if (cd.type !== 'webauthn.create') throw new Error('Invalid type');
  if (cd.challenge !== expectedChallenge) throw new Error('Challenge mismatch');

  // 2. Parse attestationObject (CBOR)
  const attObjBytes = b64urlDecode(attestationObjectB64);
  const attObj = decodeCbor(attObjBytes) as Record<string, unknown>;
  const authDataBytes = attObj['authData'] as Uint8Array;

  // 3. Parse authData
  const authData = parseAuthData(authDataBytes);

  // 4. Verify rpIdHash
  const expectedRpIdHash = await sha256(new TextEncoder().encode(rpId));
  if (!arraysEqual(authData.rpIdHash, expectedRpIdHash)) throw new Error('RP ID mismatch');

  if (!authData.attestedCredData) throw new Error('No attested credential data');

  const credentialId = b64urlEncode(authData.attestedCredData.credentialId);
  const publicKey = b64urlEncode(authData.attestedCredData.publicKeyBytes);

  // Verify the key can be imported (validates it's a proper COSE key)
  await coseToKey(authData.attestedCredData.publicKeyBytes);

  return { credentialId, publicKey, signCount: authData.signCount };
}

// ── Verify authentication ─────────────────────────────
export async function verifyAuthentication(
  clientDataB64: string, authenticatorDataB64: string, signatureB64: string,
  expectedChallenge: string, rpId: string, publicKeyB64: string, storedSignCount: number
): Promise<{ newSignCount: number }> {
  // 1. Parse clientDataJSON
  const cd = parseClientDataJSON(clientDataB64);
  if (cd.type !== 'webauthn.get') throw new Error('Invalid type');
  if (cd.challenge !== expectedChallenge) throw new Error('Challenge mismatch');

  // 2. Parse authenticatorData
  const authDataBytes = b64urlDecode(authenticatorDataB64);
  const authData = parseAuthData(authDataBytes);

  // 3. Verify rpIdHash
  const expectedRpIdHash = await sha256(new TextEncoder().encode(rpId));
  if (!arraysEqual(authData.rpIdHash, expectedRpIdHash)) throw new Error('RP ID mismatch');

  if (!authData.userPresent || !authData.userVerified) throw new Error('User not verified');

  // 4. Verify signature: sign(authData || SHA-256(clientDataJSON))
  const clientDataBytes = b64urlDecode(clientDataB64);
  const clientDataHash = await sha256(clientDataBytes);
  const signedData = new Uint8Array(authDataBytes.length + clientDataHash.length);
  signedData.set(authDataBytes, 0);
  signedData.set(clientDataHash, authDataBytes.length);

  const pubKeyBytes = b64urlDecode(publicKeyB64);
  const cryptoKey = await coseToKey(pubKeyBytes);
  const sig = b64urlDecode(signatureB64);

  // Convert DER signature to raw r||s for WebCrypto
  const rawSig = derToRaw(sig);

  const valid = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey, rawSig as BufferSource, signedData as BufferSource
  );
  if (!valid) throw new Error('Signature invalid');

  // 5. Check sign count (clone detection)
  if (authData.signCount > 0 && authData.signCount <= storedSignCount) {
    throw new Error('Sign count regression (possible clone)');
  }

  return { newSignCount: authData.signCount };
}

// ── DER signature to raw (r || s) ─────────────────────
function derToRaw(der: Uint8Array): Uint8Array {
  // DER: 0x30 <len> 0x02 <rlen> <r> 0x02 <slen> <s>
  if (der[0] !== 0x30) return der; // already raw?
  let offset = 2;
  const rLen = der[offset + 1];
  const r = der.slice(offset + 2, offset + 2 + rLen);
  offset += 2 + rLen;
  const sLen = der[offset + 1];
  const s = der.slice(offset + 2, offset + 2 + sLen);
  // Pad or trim to 32 bytes each
  const raw = new Uint8Array(64);
  raw.set(r.length > 32 ? r.slice(r.length - 32) : r, 32 - Math.min(r.length, 32));
  raw.set(s.length > 32 ? s.slice(s.length - 32) : s, 64 - Math.min(s.length, 32));
  return raw;
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
