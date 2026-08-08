import { env } from "cloudflare:workers";

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) throw new Error("密钥数据格式无效");
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  return bytes;
}

async function encryptionKey() {
  const runtimeEnv = env as unknown as { APP_ENCRYPTION_KEY?: string };
  const secret = String(runtimeEnv.APP_ENCRYPTION_KEY ?? "").trim();
  if (secret.length < 24) throw new Error("服务端尚未配置 APP_ENCRYPTION_KEY，无法安全保存 TickFlow Key");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return `v1:${bytesToHex(iv)}:${bytesToHex(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string) {
  const [version, ivHex, encryptedHex] = value.split(":");
  if (version !== "v1" || !ivHex || !encryptedHex) throw new Error("密钥数据版本无效");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(ivHex) },
    await encryptionKey(),
    hexToBytes(encryptedHex),
  );
  return new TextDecoder().decode(decrypted);
}
