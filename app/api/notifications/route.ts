import { getAppUser } from "../../auth";
import { recentNotificationLogs } from "../../automation-runner";

export async function GET(request: Request) {
  const user = await getAppUser(request);
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  return Response.json({ notifications: await recentNotificationLogs(user.userId) });
}
