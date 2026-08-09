import { getAppUser } from "../../../auth";
import { automationForUser, runAutomationNow } from "../../../automation-runner";

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少任务 ID" }, { status: 400 });
  const row = await automationForUser(payload.id, user.userId);
  if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
  const run = await runAutomationNow(row);
  if (run.status === "succeeded") return Response.json({ result: run.result, run });
  if (run.status === "retrying") return Response.json({ queued: true, run, message: run.reason || "任务已进入自动重试队列" }, { status: 202 });
  return Response.json({ error: run.error || run.reason || "任务执行失败", run }, { status: run.status === "skipped" ? 409 : 502 });
}
