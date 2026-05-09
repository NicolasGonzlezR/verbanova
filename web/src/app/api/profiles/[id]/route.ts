import { NextResponse } from "next/server";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { getAuthToken, verifyToken } from "@/lib/auth";
import { AUTH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

function requireAuth(request: Request) {
  const token =
    getAuthToken(request) ||
    request.headers
      .get("cookie")
      ?.split("; ")
      .find((cookie) => cookie.startsWith(`${AUTH_TOKEN_COOKIE}=`))
      ?.slice(AUTH_TOKEN_COOKIE.length + 1) ||
    null;
  if (!token) return null;
  try {
    return verifyToken(decodeURIComponent(token));
  } catch {
    return null;
  }
}

function contentTypeFromSourceType(sourceType: string) {
  switch (sourceType.toLowerCase()) {
    case "mp3":
      return "audio/mpeg";
    case "webm":
      return "audio/webm";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = await context.params;
  const profile = await prisma.voiceProfile.findFirst({
    where: { id: params.id, userId: auth.sub },
  });

  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "uploads", profile.sourceKey);

  try {
    const fileBuffer = await readFile(filePath);
    const headers = new Headers();
    headers.set("Content-Type", contentTypeFromSourceType(profile.sourceType));
    headers.set("Content-Disposition", `inline; filename="${profile.name}.${profile.sourceType}"`);
    return new Response(fileBuffer, { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "File not found on disk" }, { status: 404 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = await context.params;
  const profile = await prisma.voiceProfile.findFirst({
    where: { id: params.id, userId: auth.sub },
  });

  if (!profile) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(process.cwd(), "uploads", profile.sourceKey);
  try {
    await unlink(filePath);
  } catch {
    // File may already be gone — continue with DB cleanup
  }

  await prisma.voiceProfile.delete({ where: { id: profile.id } });
  return NextResponse.json({ ok: true });
}
