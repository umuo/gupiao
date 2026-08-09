export const notificationMethods = ["GET", "POST", "PUT", "PATCH"] as const;
export const notificationContentTypes = ["application/json", "application/x-www-form-urlencoded", "text/plain"] as const;
export const notificationChannelTypes = ["webhook", "dingtalk", "feishu"] as const;

export type NotificationMethod = typeof notificationMethods[number];
export type NotificationContentType = typeof notificationContentTypes[number];
export type NotificationHeader = { name: string; value: string };
export type NotificationChannelType = typeof notificationChannelTypes[number];

export const defaultMessageTemplate = `{
  "event": "strategy.{{action}}",
  "action": "{{actionText}}",
  "stock": "{{stockName}}",
  "symbol": "{{symbol}}",
  "strategy": "{{strategyName}}",
  "paper_account": "{{paperAccountName}}",
  "price": {{price}},
  "reason": "{{reason}}",
  "time": "{{marketTime}}"
}`;

export const dingtalkMessageTemplate = `{
  "msgtype": "text",
  "text": {
    "content": "【Paper Alpha】{{actionText}}提醒\\n任务：{{automationName}}\\n股票：{{stockName}}（{{symbol}}）\\n策略：{{strategyName}}\\n成交价：{{executionPrice}}\\n原因：{{reason}}\\n时间：{{marketTime}}"
  }
}`;

export const feishuMessageTemplate = `{
  "msg_type": "text",
  "content": {
    "text": "【Paper Alpha】{{actionText}}提醒\\n任务：{{automationName}}\\n股票：{{stockName}}（{{symbol}}）\\n策略：{{strategyName}}\\n成交价：{{executionPrice}}\\n原因：{{reason}}\\n时间：{{marketTime}}"
  }
}`;

export const notificationTypeLabels: Record<NotificationChannelType, string> = {
  webhook: "自定义 Webhook",
  dingtalk: "钉钉通知",
  feishu: "飞书通知",
};

export function templateForNotificationType(type: NotificationChannelType) {
  if (type === "dingtalk") return dingtalkMessageTemplate;
  if (type === "feishu") return feishuMessageTemplate;
  return defaultMessageTemplate;
}

export function normalizeNotificationChannelType(value: unknown): NotificationChannelType {
  const type = String(value ?? "webhook");
  if (!notificationChannelTypes.includes(type as NotificationChannelType)) throw new Error("通知渠道类型无效");
  return type as NotificationChannelType;
}

const blockedHeaders = new Set(["host", "content-length", "transfer-encoding", "connection", "user-agent", "content-type"]);

export function normalizeNotificationHeaders(value: unknown): NotificationHeader[] {
  if (!Array.isArray(value)) throw new Error("请求头格式无效");
  const headers = value.slice(0, 20).map((item) => {
    if (!item || typeof item !== "object") throw new Error("请求头格式无效");
    const header = item as Record<string, unknown>;
    const name = String(header.name ?? "").trim();
    const headerValue = String(header.value ?? "").trim();
    if (!name && !headerValue) return null;
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/.test(name)) throw new Error(`请求头名称“${name}”无效`);
    if (blockedHeaders.has(name.toLowerCase())) throw new Error(`${name} 请使用单独的配置项或由系统管理`);
    if (!headerValue || headerValue.length > 1_000 || /[\r\n]/.test(headerValue)) throw new Error(`${name} 的值无效`);
    return { name, value: headerValue };
  }).filter((item): item is NotificationHeader => Boolean(item));
  const unique = new Set<string>();
  for (const header of headers) {
    const key = header.name.toLowerCase();
    if (unique.has(key)) throw new Error(`请求头 ${header.name} 重复`);
    unique.add(key);
  }
  return headers;
}

export function normalizeNotificationMethod(value: unknown): NotificationMethod {
  const method = String(value ?? "POST").toUpperCase();
  if (!notificationMethods.includes(method as NotificationMethod)) throw new Error("请求方法不受支持");
  return method as NotificationMethod;
}

export function normalizeNotificationContentType(value: unknown): NotificationContentType {
  const contentType = String(value ?? "application/json");
  if (!notificationContentTypes.includes(contentType as NotificationContentType)) throw new Error("Content-Type 不受支持");
  return contentType as NotificationContentType;
}

export function normalizeMessageTemplate(value: unknown) {
  const template = String(value ?? "").trim();
  if (!template || template.length > 8_000) throw new Error("消息模板不能为空且不能超过 8000 个字符");
  return template;
}
