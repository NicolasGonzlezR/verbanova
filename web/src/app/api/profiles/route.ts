import { NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/prisma";
import { getAuthToken, verifyToken } from "@/lib/auth";

export const runtime = "nodejs";

const UPLOADS_DIR = path.join(process.cwd(), "uploads", "profiles");

function inferAudioExtension(contentType: string, fileName?: string | null) {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("mpeg")) return "mp3";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("mp4") || normalized.includes("m4a")) return "m4a";
  if (normalized.includes("wav")) return "wav";

  const nameExtension = fileName?.split(".").pop()?.toLowerCase();
  if (nameExtension && ["mp3", "webm", "ogg", "m4a", "wav"].includes(nameExtension)) {
    return nameExtension;
  }

  return "wav";
}

function requireAuth(request: Request) {
  const token = getAuthToken(request);
  if (!token) return null;
  try {
    return verifyToken(token);
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const auth = requireAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const profiles = await prisma.voiceProfile.findMany({
    where: { userId: auth.sub },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ profiles });
}

export async function POST(request: Request) {
  const auth = requireAuth(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData();
  const name = String(formData.get("name") || "").trim();
  const file = formData.get("file");

  if (!name || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing name or file" }, { status: 400 });
  }

  const contentType = file.type || "application/octet-stream";
  if (!contentType.startsWith("audio/")) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const extension = inferAudioExtension(contentType, file.name);
  const arrayBuffer = await file.arrayBuffer();
  const userDir = path.join(UPLOADS_DIR, auth.sub);
  const filename = `${Date.now()}-${name}.${extension}`;
  const filePath = path.join(userDir, filename);
  const sourceKey = ["profiles", auth.sub, filename].join("/");

  await mkdir(userDir, { recursive: true });
  await writeFile(filePath, Buffer.from(arrayBuffer));

  const profile = await prisma.voiceProfile.create({
    data: {
      userId: auth.sub,
      name,
      sourceType: extension,
      sourceUrl: `/api/profiles/pending`,
      sourceKey,
    },
  });

  const sourceUrl = `/api/profiles/${profile.id}`;

  await prisma.voiceProfile.update({
    where: { id: profile.id },
    data: { sourceUrl },
  });

  return NextResponse.json({ profile: { ...profile, sourceUrl } });
}
