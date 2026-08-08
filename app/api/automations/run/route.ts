import { getAppUser } from "../../../auth";
import { automationForUser, recordAutomationError, runAutomation } from "../../../automation-runner";

export async function POST(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const payload = await request.json() as { id?: string };
  if (!payload.id) return Response.json({ error: "缺少任务 ID" }, { status: 400 });
  const row = await automationForUser(payload.id, user.userId);
  if (!row) return Response.json({ error: "任务不存在" }, { status: 404 });
  try {
    return Response.json({ result: await runAutomation(row) });
  } catch (error) {
    await recordAutomationError(row, error);
    return Response.json({ error: error instanceof Error ? error.message : "任务执行失败" }, { status: 502 });
  }
}
