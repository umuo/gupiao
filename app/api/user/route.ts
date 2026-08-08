import { ensureDefaultAdmin, getAppUser } from "../../auth";

export async function GET(request: Request) {
  const adminReady = await ensureDefaultAdmin();
  const user = await getAppUser(request);
  return Response.json({ user, adminReady });
}
