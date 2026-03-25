// WebAuthn/Passkeys client helper — Maple Bear RS
const WebAuthnClient = {
  isAvailable() {
    return !!window.PublicKeyCredential && location.protocol === 'https:';
  },
  async isPlatformAvailable() {
    if (!this.isAvailable()) return false;
    try {
      if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      }
      return true; // HTTPS + PublicKeyCredential exists — assume available
    } catch (_) { return true; }
  },
  b64urlToBuffer(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - b64.length % 4);
    const bin = atob(b64 + pad);
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  },
  bufferToB64url(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },
  async register(data) {
    const cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Maple Bear', id: data.rp_id },
        user: {
          id: this.b64urlToBuffer(data.user_id),
          name: data.user_name,
          displayName: data.user_display_name
        },
        challenge: this.b64urlToBuffer(data.challenge),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          residentKey: 'preferred',
          userVerification: 'required'
        },
        attestation: 'none',
        timeout: 60000
      }
    });
    return {
      id: cred.id,
      rawId: this.bufferToB64url(cred.rawId),
      type: cred.type,
      response: {
        clientDataJSON: this.bufferToB64url(cred.response.clientDataJSON),
        attestationObject: this.bufferToB64url(cred.response.attestationObject),
      },
      transports: cred.response.getTransports ? cred.response.getTransports() : ['internal']
    };
  },
  async authenticate(data) {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: this.b64urlToBuffer(data.challenge),
        rpId: data.rp_id,
        allowCredentials: (data.allowCredentials || []).map(c => ({
          type: 'public-key',
          id: this.b64urlToBuffer(c.id),
          transports: c.transports || ['internal']
        })),
        userVerification: 'required',
        timeout: 60000
      }
    });
    return {
      id: assertion.id,
      rawId: this.bufferToB64url(assertion.rawId),
      type: assertion.type,
      response: {
        clientDataJSON: this.bufferToB64url(assertion.response.clientDataJSON),
        authenticatorData: this.bufferToB64url(assertion.response.authenticatorData),
        signature: this.bufferToB64url(assertion.response.signature),
        userHandle: assertion.response.userHandle ? this.bufferToB64url(assertion.response.userHandle) : null
      }
    };
  }
};
