import { getAppUser } from "../../auth";
import { getDb } from "../../../db";
import { users } from "../../../db/schema";

export async function GET(request: Request) {
  const user = await getAppUser(request);
  const [existingUser] = await getDb().select({ id: users.id }).from(users).limit(1);
  return Response.json({ user, needsBootstrap: !existingUser });
}
