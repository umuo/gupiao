import type { notificationChannels } from "../db/schema";
import { assertPublicHttpsUrl } from "./public-url";
import { decryptSecret } from "./secret-box";

type ChannelRow = typeof notificationChannels.$inferSelect;
export type NotificationVariables = Record<string, string | number | boolean | null | undefined>;

export function renderMessageTemplate(template: string, variables: NotificationVariables, jsonMode = false) {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (match, key: string) => {
    if (!(key in variables)) return match;
    const value = variables[key];
    if (value == null) return "";
    if (!jsonMode || typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(String(value)).slice(1, -1);
  });
}

export async function deliverNotification(channel: ChannelRow, variables: NotificationVariables) {
  if (!channel.enabled) throw new Error("所选通知渠道已停用");
  const url = assertPublicHttpsUrl(channel.url, "Webhook URL");
  const rendered = renderMessageTemplate(channel.messageTemplate, variables, channel.contentType === "application/json");
  const storedHeaders = JSON.parse(await decryptSecret(channel.headersEncrypted)) as Array<{ name: string; value: string }>;
  const headers = new Headers();
  storedHeaders.forEach((header) => headers.set(header.name, header.value));
  headers.set("Content-Type", channel.contentType);
  headers.set("User-Agent", "paper-alpha-webhook/1.0");

  let body: string | undefined;
  if (channel.method === "GET") {
    url.searchParams.set("message", rendered);
  } else if (channel.contentType === "application/json") {
    try {
      body = JSON.stringify(JSON.parse(rendered));
    } catch {
      throw new Error("消息模板渲染后不是有效 JSON，请检查引号和变量位置");
    }
  } else if (channel.contentType === "application/x-www-form-urlencoded") {
    body = new URLSearchParams({ message: rendered }).toString();
  } else {
    body = rendered;
  }

  const response = await fetch(url, {
    method: channel.method,
    headers,
    body,
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: response.ok, status: response.status, rendered };
}
