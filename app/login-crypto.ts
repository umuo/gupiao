import { env } from "cloudflare:workers";

const LOGIN_CHALLENGE_COOKIE = "paper_alpha_login_challenge";
const LOGIN_CHALLENGE_SECONDS = 120;
const LOGIN_ENVELOPE_VERSION = "v1";

type LoginPrivateJwk = JsonWebKey & {
  kty: "RSA";
  n: string;
  e: string;
  d: string;
};

export type LoginEnvelope = {
  version?: string;
  keyId?: string;
  encryptedKey?: string;
  iv?: string;
  ciphertext?: string;
};

type LoginCredentials = {
  email: string;
  password: string;
  challenge: string;
  issuedAt: number;
};

let cachedKeySource = "";
let cachedPrivateKey: Promise<CryptoKey> | null = null;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlToBytes(value: string, maximumLength: number) {
  if (!value || value.length > maximumLength || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("登录密文格式无效");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function secureCookieSuffix(request: Request) {
  return new URL(request.url).protocol === "https:" ? "; Secure" : "";
}

function challengeCookieFrom(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${LOGIN_CHALLENGE_COOKIE}=`))?.slice(LOGIN_CHALLENGE_COOKIE.length + 1) ?? "";
}

function privateJwk() {
  const source = String((env as unknown as { LOGIN_PRIVATE_KEY_JWK?: string }).LOGIN_PRIVATE_KEY_JWK ?? "");
  if (!source) throw new Error("登录加密密钥尚未配置");
  let parsed: LoginPrivateJwk;
  try {
    parsed = JSON.parse(source) as LoginPrivateJwk;
  } catch {
    throw new Error("登录加密密钥格式无效");
  }
  if (parsed.kty !== "RSA" || !parsed.n || !parsed.e || !parsed.d) throw new Error("登录加密密钥格式无效");
  return { parsed, source };
}

async function keyIdFor(jwk: Pick<LoginPrivateJwk, "n" | "e">) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${jwk.n}.${jwk.e}`));
  return bytesToBase64Url(new Uint8Array(digest).slice(0, 18));
}

async function loginPrivateKey(jwk: LoginPrivateJwk, source: string) {
  if (!cachedPrivateKey || cachedKeySource !== source) {
    cachedKeySource = source;
    cachedPrivateKey = crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  }
  return cachedPrivateKey;
}

export function clearLoginChallengeCookie(request: Request) {
  return `${LOGIN_CHALLENGE_COOKIE}=; Path=/api/auth/login; HttpOnly; SameSite=Strict; Max-Age=0${secureCookieSuffix(request)}`;
}

export async function createLoginEncryptionOffer(request: Request) {
  const { parsed } = privateJwk();
  const keyId = await keyIdFor(parsed);
  const challenge = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(24)));
  return {
    payload: {
      version: LOGIN_ENVELOPE_VERSION,
      algorithm: "RSA-OAEP-256+A256GCM",
      keyId,
      challenge,
      expiresAt: Date.now() + LOGIN_CHALLENGE_SECONDS * 1000,
      publicKey: {
        kty: "RSA",
        n: parsed.n,
        e: parsed.e,
        alg: "RSA-OAEP-256",
        ext: true,
        key_ops: ["encrypt"],
      } satisfies JsonWebKey,
    },
    cookie: `${LOGIN_CHALLENGE_COOKIE}=${keyId}.${challenge}; Path=/api/auth/login; HttpOnly; SameSite=Strict; Max-Age=${LOGIN_CHALLENGE_SECONDS}${secureCookieSuffix(request)}`,
  };
}

export async function decryptLoginEnvelope(request: Request, envelope: LoginEnvelope): Promise<LoginCredentials> {
  if (envelope.version !== LOGIN_ENVELOPE_VERSION || !envelope.keyId) throw new Error("登录密文版本无效");
  const { parsed, source } = privateJwk();
  const expectedKeyId = await keyIdFor(parsed);
  if (envelope.keyId !== expectedKeyId) throw new Error("登录加密密钥已更新，请重试");

  const encryptedKey = base64UrlToBytes(String(envelope.encryptedKey ?? ""), 1024);
  const iv = base64UrlToBytes(String(envelope.iv ?? ""), 64);
  const ciphertext = base64UrlToBytes(String(envelope.ciphertext ?? ""), 4096);
  if (iv.length !== 12) throw new Error("登录密文格式无效");

  const rawKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, await loginPrivateKey(parsed, source), encryptedKey);
  const aesKey = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(envelope.keyId) },
    aesKey,
    ciphertext,
  );

  const credentials = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<LoginCredentials>;
  const expectedChallenge = challengeCookieFrom(request);
  if (!expectedChallenge || expectedChallenge !== `${envelope.keyId}.${credentials.challenge ?? ""}`) throw new Error("登录请求已失效，请重试");
  if (!Number.isFinite(credentials.issuedAt) || Math.abs(Date.now() - Number(credentials.issuedAt)) > LOGIN_CHALLENGE_SECONDS * 1000) throw new Error("登录请求已过期，请重试");
  return {
    email: String(credentials.email ?? ""),
    password: String(credentials.password ?? ""),
    challenge: String(credentials.challenge ?? ""),
    issuedAt: Number(credentials.issuedAt),
  };
}
