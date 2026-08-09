type AuthEncryptionOffer = {
  version: string;
  keyId: string;
  challenge: string;
  publicKey: JsonWebKey;
  error?: string;
};

type AuthCredentials = {
  email?: string;
  password: string;
  newPassword?: string;
};

function bytesToBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export async function encryptAuthCredentials(credentials: AuthCredentials, offerEndpoint = "/api/auth/login") {
  const keyResponse = await fetch(offerEndpoint, { cache: "no-store", credentials: "same-origin" });
  const offer = await keyResponse.json() as AuthEncryptionOffer;
  if (!keyResponse.ok || !offer.publicKey || !offer.challenge || !offer.keyId) throw new Error(offer.error || "无法初始化安全加密");

  const rsaKey = await crypto.subtle.importKey("jwk", offer.publicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
  const encryptedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaKey, rawAesKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify({ ...credentials, challenge: offer.challenge, issuedAt: Date.now() }));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(offer.keyId) },
    aesKey,
    plaintext,
  );
  return {
    version: offer.version,
    keyId: offer.keyId,
    encryptedKey: bytesToBase64Url(encryptedKey),
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
  };
}
