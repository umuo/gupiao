import { env } from "cloudflare:workers";
import { runDueAutomations } from "../../../automation-runner";

export async function POST(request: Request) {
  const runtimeEnv = env as unknown as { CRON_SECRET?: string };
  const configured = String(runtimeEnv.CRON_SECRET ?? "");
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!configured || provided !== configured) return Response.json({ error: "Cron 未授权" }, { status: 401 });
  return Response.json(await runDueAutomations());
}
