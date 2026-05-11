/**
 * Tests for POST /api/auth/register
 * Prisma is mocked — no real database connection required.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
  },
}));

jest.mock("bcryptjs", () => ({
  hash: jest.fn().mockResolvedValue("$2b$12$hashedpassword"),
  compare: jest.fn(),
}));

import { POST } from "../auth/register/route";
import { prisma } from "@/lib/prisma";
import { verifyToken } from "@/lib/auth";

function makeRequest(body: object) {
  return new Request("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  email: "test@example.com",
  username: "testuser",
  password: "password123",
};

beforeEach(() => jest.clearAllMocks());

// ── validation ────────────────────────────────────────────────────────────────

describe("field validation", () => {
  it("returns 400 when all fields are missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_fields");
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ username: "user", password: "pass1234" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_fields");
  });

  it("returns 400 when username is missing", async () => {
    const res = await POST(makeRequest({ email: "a@b.com", password: "pass1234" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_fields");
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ email: "a@b.com", username: "user" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("missing_fields");
  });

  it("returns 400 for an invalid email format", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, email: "notanemail" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_email");
  });

  it("returns 400 for email without TLD", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, email: "user@domain" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_email");
  });

  it("returns 400 for username shorter than 3 chars", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, username: "ab" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_username");
  });

  it("returns 400 for username longer than 20 chars", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, username: "a".repeat(21) }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_username");
  });

  it("returns 400 for password shorter than 8 chars", async () => {
    const res = await POST(makeRequest({ ...VALID_BODY, password: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_password");
  });
});

// ── duplicate detection ───────────────────────────────────────────────────────

describe("duplicate user detection", () => {
  it("returns 409 when email is already registered", async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      email: "test@example.com",
      username: "other",
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("user_exists_email");
  });

  it("returns 409 when username is already taken", async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      email: "other@example.com",
      username: "testuser",
    });
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("user_exists_username");
  });
});

// ── successful registration ───────────────────────────────────────────────────

describe("successful registration", () => {
  beforeEach(() => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.user.create as jest.Mock).mockResolvedValue({
      id: "user123",
      email: "test@example.com",
      username: "testuser",
    });
  });

  it("returns 200", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
  });

  it("response body contains user and token", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    const body = await res.json();
    expect(body.user).toBeDefined();
    expect(body.token).toBeTruthy();
  });

  it("returned user has id, email and username", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    const { user } = await res.json();
    expect(user.id).toBe("user123");
    expect(user.email).toBe("test@example.com");
    expect(user.username).toBe("testuser");
  });

  it("returned token is a valid JWT for the created user", async () => {
    const res = await POST(makeRequest(VALID_BODY));
    const { token } = await res.json();
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe("user123");
    expect(decoded.email).toBe("test@example.com");
  });

  it("email is lowercased before storing", async () => {
    await POST(makeRequest({ ...VALID_BODY, email: "TEST@EXAMPLE.COM" }));
    const createCall = (prisma.user.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data.email).toBe("test@example.com");
  });

  it("does not store the plaintext password", async () => {
    await POST(makeRequest(VALID_BODY));
    const createCall = (prisma.user.create as jest.Mock).mock.calls[0][0];
    expect(createCall.data).not.toHaveProperty("password");
    expect(createCall.data.passwordHash).toBeDefined();
    expect(createCall.data.passwordHash).not.toBe(VALID_BODY.password);
  });
});
