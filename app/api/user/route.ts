import { getAppUser } from "../../auth";

export async function GET(request: Request) {
  const user = await getAppUser(request);
  return Response.json({ user });
}
