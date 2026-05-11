import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getAuthToken, verifyToken } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    user: { id: user.id, email: user.email, username: user.username },
  });
}
