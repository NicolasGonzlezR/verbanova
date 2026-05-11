import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";
import { AUTH_TOKEN_COOKIE } from "@/lib/session";

export const runtime = "nodejs";

const emailPattern = /.+@.+\..+/;

export async function POST(request: Request) {
  const body = await request.json();
  const email = String(body.email || "").trim().toLowerCase();
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!email || !username || !password) {
    return NextResponse.json(
      { error: "Missing fields", code: "missing_fields" },
      { status: 400 }
    );
  }

  if (!emailPattern.test(email)) {
    return NextResponse.json(
      { error: "Formato de mail invalido", code: "invalid_email" },
      { status: 400 }
    );
  }

  if (username.length < 3 || username.length > 20) {
    return NextResponse.json(
      { error: "El nombre debe tener entre 3 y 20 caracteres", code: "invalid_username" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "La contrasena debe tener al menos 8 caracteres", code: "invalid_password" },
      { status: 400 }
    );
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [{ email }, { username }],
    },
  });

  if (existingUser?.email === email) {
    return NextResponse.json(
      { error: "El mail ya esta registrado", code: "user_exists_email" },
      { status: 409 }
    );
  }

  if (existingUser?.username === username) {
    return NextResponse.json(
      { error: "El nombre de usuario ya existe", code: "user_exists_username" },
      { status: 409 }
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
    },
  });

  const token = signToken({ sub: user.id, email: user.email });
  const response = NextResponse.json({
    user: { id: user.id, email: user.email, username: user.username },
    token,
  });
  response.cookies.set(AUTH_TOKEN_COOKIE, token, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
