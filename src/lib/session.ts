// Jeton de session signé (HMAC-SHA256), compatible Edge (middleware) ET Node
// (route handlers / server components) — n'utilise QUE la Web Crypto, jamais
// Prisma, pour rester utilisable dans le middleware Edge.
//
// Format : base64url(JSON{uid,role,exp}) + "." + base64url(hmac)
// La clé de signature = SESSION_SECRET (recommandé) sinon SYNC_API_KEY (repli
// pour un déploiement sans interruption ; à remplacer par un secret dédié).

const enc = new TextEncoder();
const dec = new TextDecoder();

// Durée de vie ABSOLUE d'une session (sécurité : un compte ne reste pas ouvert
// indéfiniment). Complétée par une déconnexion sur INACTIVITÉ côté client (AuthProvider).
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 24; // 24 heures

export interface SessionPayload {
  uid: string;
  role: string;
  scr: string[] | null; // screenAccess (null = tous les écrans)
}

function getSecret(): string {
  const s = process.env.SESSION_SECRET || process.env.SYNC_API_KEY;
  if (!s) throw new Error("SESSION_SECRET (ou SYNC_API_KEY) manquant");
  return s;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const strToB64url = (s: string) => bytesToB64url(enc.encode(s));
const b64urlToStr = (s: string) => dec.decode(b64urlToBytes(s));

// TextEncoder.encode renvoie Uint8Array<ArrayBufferLike> ; on normalise en
// BufferSource pour la Web Crypto (typage strict).
const buf = (s: string): BufferSource => enc.encode(s) as BufferSource;

async function importKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    buf(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signSession(
  uid: string,
  role: string,
  scr: string[] | null,
  ttlMs: number = DEFAULT_TTL_MS
): Promise<string> {
  const data = strToB64url(JSON.stringify({ uid, role, scr, exp: Date.now() + ttlMs }));
  const key = await importKey();
  const sig = await crypto.subtle.sign("HMAC", key, buf(data));
  return `${data}.${bytesToB64url(new Uint8Array(sig))}`;
}

// Renvoie le payload si le jeton est authentique ET non expiré, sinon null.
export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token || token.indexOf(".") === -1) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  try {
    const key = await importKey();
    const ok = await crypto.subtle.verify("HMAC", key, b64urlToBytes(sig) as BufferSource, buf(data));
    if (!ok) return null;
    const payload = JSON.parse(b64urlToStr(data)) as {
      uid?: string;
      role?: string;
      scr?: string[] | null;
      exp?: number;
    };
    if (!payload.uid || !payload.exp || Date.now() > payload.exp) return null;
    return {
      uid: payload.uid,
      role: payload.role || "USER",
      scr: Array.isArray(payload.scr) ? payload.scr : null,
    };
  } catch {
    return null;
  }
}
