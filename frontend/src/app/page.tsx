import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AUTH_TOKEN_COOKIE } from "@/lib/session";

export default async function RootPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_TOKEN_COOKIE)?.value;
  redirect(token ? "/translate" : "/login");
}
