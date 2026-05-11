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
  const password = String(body.password || "");

  if (!email || !password) {
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

  if (password.length < 8) {
    return NextResponse.json(
      { error: "La contrasena debe tener al menos 8 caracteres", code: "invalid_password" },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json(
      { error: "El usuario con ese mail no esta registrado", code: "user_not_found" },
      { status: 401 }
    );
  }

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) {
    return NextResponse.json(
      { error: "La contrasena es incorrecta", code: "wrong_password" },
      { status: 401 }
    );
  }

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
