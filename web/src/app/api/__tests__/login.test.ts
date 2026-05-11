/**
 * Tests for POST /api/auth/login
 * Prisma and bcryptjs are mocked — no real DB or crypto needed.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

jest.mock("bcryptjs", () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

import { POST } from "../auth/login/route";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { verifyToken } from "@/lib/auth";

const EXISTING_USER = {
  id: "user-abc-123",
  email: "alice@example.com",
  username: "alice",
  passwordHash: "$2b$12$hashedpassword",
};

function makeRequest(body: object) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => jest.clearAllMocks());

// ── validation ────────────────────────────────────────────────────────────────

describe("field validation", () => {
  it("returns 400 when body is empty", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_fields");
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ password: "password123" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_fields");
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ email: "a@b.com" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_fields");
  });

  it("returns 400 for invalid email format", async () => {
    const res = await POST(makeRequest({ email: "notvalid", password: "password123" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_email");
  });

  it("returns 400 for password shorter than 8 chars", async () => {
    const res = await POST(makeRequest({ email: "a@b.com", password: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_password");
  });
});

// ── authentication failures ───────────────────────────────────────────────────

describe("authentication failures", () => {
  it("returns 401 when the user does not exist", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const res = await POST(makeRequest({ email: "nobody@b.com", password: "password123" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("user_not_found");
  });

  it("returns 401 when the password is wrong", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(EXISTING_USER);
    (bcrypt.compare as jest.Mock).mockResolvedValue(false);
    const res = await POST(makeRequest({ email: "alice@example.com", password: "wrongpass" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("wrong_password");
  });

  it("queries the DB with the lowercased email", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await POST(makeRequest({ email: "ALICE@EXAMPLE.COM", password: "password123" }));
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "alice@example.com" },
    });
  });
});

// ── successful login ──────────────────────────────────────────────────────────

describe("successful login", () => {
  beforeEach(() => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(EXISTING_USER);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
  });

  it("returns 200", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com", password: "password123" }));
    expect(res.status).toBe(200);
  });

  it("response contains user and token", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com", password: "password123" }));
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.token).toBeTruthy();
  });

  it("returned user has id, email and username", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com", password: "password123" }));
    const { user } = await res.json();
    expect(user.id).toBe(EXISTING_USER.id);
    expect(user.email).toBe(EXISTING_USER.email);
    expect(user.username).toBe(EXISTING_USER.username);
  });

  it("returned token is a valid JWT for the user", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com", password: "password123" }));
    const { token } = await res.json();
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(EXISTING_USER.id);
    expect(decoded.email).toBe(EXISTING_USER.email);
  });

  it("does not expose the password hash in the response", async () => {
    const res = await POST(makeRequest({ email: "alice@example.com", password: "password123" }));
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("passwordHash");
    expect(JSON.stringify(body)).not.toContain("$2b$");
  });

  it("compares password against the stored hash", async () => {
    await POST(makeRequest({ email: "alice@example.com", password: "password123" }));
    expect(bcrypt.compare).toHaveBeenCalledWith("password123", EXISTING_USER.passwordHash);
  });
});
