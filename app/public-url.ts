export function assertPublicHttpsUrl(value: string, label = "URL") {
  const url = new URL(value.trim());
  if (url.protocol !== "https:") throw new Error(`${label} 必须使用 HTTPS`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const blocked = host === "localhost"
    || host.endsWith(".local")
    || host.endsWith(".internal")
    || host === "0.0.0.0"
    || host === "::1"
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^f[cd][0-9a-f]{2}:/i.test(host)
    || /^fe[89ab][0-9a-f]:/i.test(host);
  if (blocked) throw new Error(`${label} 不能指向本地或内网服务`);
  return url;
}
