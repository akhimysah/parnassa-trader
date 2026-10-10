/**
 * Envoi de notifications Web Push depuis Cloudflare Workers, sans dépendance :
 * signature VAPID (RFC 8292, ES256) et chiffrement du contenu « aes128gcm » (RFC 8291 / 8188).
 */

export interface AbonnementPush {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface MessagePush {
  titre: string;
  corps: string;
  url?: string;
  tag?: string;
}

const encodeur = new TextEncoder();

export function versBase64Url(octets: ArrayBuffer | Uint8Array<ArrayBuffer>): string {
  const tab = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let binaire = '';
  for (const o of tab) binaire += String.fromCharCode(o);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function depuisBase64Url(texte: string): Uint8Array<ArrayBuffer> {
  const b64 = texte.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (texte.length % 4)) % 4);
  const binaire = atob(b64);
  const tab = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i++) tab[i] = binaire.charCodeAt(i);
  return tab;
}

function concat(...parties: Uint8Array<ArrayBuffer>[]): Uint8Array<ArrayBuffer> {
  const total = parties.reduce((s, p) => s + p.length, 0);
  const sortie = new Uint8Array(total);
  let i = 0;
  for (const p of parties) {
    sortie.set(p, i);
    i += p.length;
  }
  return sortie;
}

async function hkdf(sel: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, longueur: number): Promise<Uint8Array<ArrayBuffer>> {
  const cle = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sel, info }, cle, longueur * 8);
  return new Uint8Array(bits);
}

/** Jeton VAPID signé pour l'origine du service de push (valable 12 h). */
export async function jetonVapid(endpoint: string, clePrivee: JsonWebKey, contact: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const entete = versBase64Url(encodeur.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const charge = versBase64Url(encodeur.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact })));
  const cle = await crypto.subtle.importKey('jwk', clePrivee, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, encodeur.encode(`${entete}.${charge}`));
  return `${entete}.${charge}.${versBase64Url(signature)}`;
}

/** Chiffre `contenu` pour l'abonnement (aes128gcm, un seul enregistrement). */
export async function chiffrer(abonnement: AbonnementPush, contenu: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const clePubliqueUA = depuisBase64Url(abonnement.keys.p256dh);
  const secretAuth = depuisBase64Url(abonnement.keys.auth);
  const ephemere = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const clePubliqueAS = new Uint8Array((await crypto.subtle.exportKey('raw', ephemere.publicKey)) as ArrayBuffer);
  const cleUA = await crypto.subtle.importKey('raw', clePubliqueUA, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: cleUA }, ephemere.privateKey, 256));

  const infoCle = concat(encodeur.encode('WebPush: info\0'), clePubliqueUA, clePubliqueAS);
  const ikm = await hkdf(secretAuth, partage, infoCle, 32);
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sel, ikm, encodeur.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sel, ikm, encodeur.encode('Content-Encoding: nonce\0'), 12);

  const cleAes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const clair = concat(contenu, new Uint8Array([2])); // 0x02 : dernier (et unique) enregistrement
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cleAes, clair));

  const taille = new Uint8Array(4);
  new DataView(taille.buffer).setUint32(0, 4096);
  return concat(sel, taille, new Uint8Array([clePubliqueAS.length]), clePubliqueAS, chiffre);
}

export type ResultatEnvoi = 'ok' | 'expire' | 'erreur';

/** Envoie un message ; « expire » signifie que l'abonnement n'existe plus (à supprimer). */
export async function envoyerPush(
  abonnement: AbonnementPush,
  message: MessagePush,
  vapid: { publique: string; privee: JsonWebKey; contact: string },
): Promise<ResultatEnvoi> {
  try {
    const corps = await chiffrer(abonnement, encodeur.encode(JSON.stringify(message)));
    const jeton = await jetonVapid(abonnement.endpoint, vapid.privee, vapid.contact);
    const r = await fetch(abonnement.endpoint, {
      method: 'POST',
      headers: {
        TTL: '3600',
        Urgency: 'high',
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        Authorization: `vapid t=${jeton}, k=${vapid.publique}`,
        ...(message.tag ? { Topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
      },
      body: corps,
      signal: AbortSignal.timeout(8000),
    });
    if (r.status === 404 || r.status === 410) return 'expire';
    return r.ok ? 'ok' : 'erreur';
  } catch {
    return 'erreur';
  }
}
