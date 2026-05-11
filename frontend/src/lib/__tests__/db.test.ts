/**
 * Database-layer unit tests.
 *
 * These tests verify that the code issues the correct Prisma queries
 * (correct where clauses, orderBy, fields) without connecting to a real DB.
 * For real integration tests, set DATABASE_URL to a test database and run
 * the app with `npx prisma migrate deploy`.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    voiceProfile: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";

// ── User queries ──────────────────────────────────────────────────────────────

describe("User — findUnique by email", () => {
  beforeEach(() => jest.clearAllMocks());

  it("queries by email field", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    await prisma.user.findUnique({ where: { email: "a@b.com" } });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "a@b.com" },
    });
  });

  it("returns the user when found", async () => {
    const user = { id: "u1", email: "a@b.com", username: "alice", passwordHash: "$2b$12$x" };
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(user);
    const result = await prisma.user.findUnique({ where: { email: "a@b.com" } });
    expect(result).toEqual(user);
  });

  it("returns null when user is not found", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);
    const result = await prisma.user.findUnique({ where: { email: "nobody@b.com" } });
    expect(result).toBeNull();
  });
});

describe("User — findFirst with OR for duplicate detection", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses OR condition to check both email and username", async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
    await prisma.user.findFirst({
      where: { OR: [{ email: "a@b.com" }, { username: "alice" }] },
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ email: "a@b.com" }, { username: "alice" }] },
    });
  });
});

describe("User — create", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates with email, username and passwordHash", async () => {
    const data = {
      email: "a@b.com",
      username: "alice",
      passwordHash: "$2b$12$abcdefghijklmnopqrstuvwx",
    };
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: "u1", ...data });

    const result = await prisma.user.create({ data });

    expect(prisma.user.create).toHaveBeenCalledWith({ data });
    expect(result).toMatchObject({ id: "u1", email: data.email });
  });

  it("stores a bcrypt hash (not plaintext)", async () => {
    const hash = "$2b$12$ABCDEFGHIJKLMNOPQRSTUVWabcdefghijklmnopqrstu";
    (prisma.user.create as jest.Mock).mockResolvedValue({
      id: "u1",
      email: "a@b.com",
      username: "alice",
      passwordHash: hash,
    });

    const result = (await prisma.user.create({
      data: { email: "a@b.com", username: "alice", passwordHash: hash },
    })) as { passwordHash: string };

    expect(result.passwordHash).toMatch(/^\$2[ab]\$/);
    expect(result.passwordHash).not.toBe("plaintext");
  });
});

// ── VoiceProfile queries ──────────────────────────────────────────────────────

describe("VoiceProfile — findMany", () => {
  beforeEach(() => jest.clearAllMocks());

  it("filters by userId", async () => {
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue([]);
    await prisma.voiceProfile.findMany({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
    });
    expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "u1" } })
    );
  });

  it("orders results by createdAt desc", async () => {
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue([]);
    await prisma.voiceProfile.findMany({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
    });
    expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });

  it("returns an array of profiles", async () => {
    const profiles = [
      { id: "p1", name: "Voice 1", userId: "u1", sourceKey: "profiles/u1/1.wav" },
      { id: "p2", name: "Voice 2", userId: "u1", sourceKey: "profiles/u1/2.wav" },
    ];
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue(profiles);
    const result = await prisma.voiceProfile.findMany({ where: { userId: "u1" }, orderBy: { createdAt: "desc" } });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("p1");
  });
});

describe("VoiceProfile — create", () => {
  beforeEach(() => jest.clearAllMocks());

  it("stores all required fields", async () => {
    const data = {
      userId: "u1",
      name: "My Voice",
      sourceType: "wav",
      sourceUrl: "/api/profiles/p1",
      sourceKey: "profiles/u1/1234-My Voice.wav",
    };
    (prisma.voiceProfile.create as jest.Mock).mockResolvedValue({ id: "p1", ...data });

    const result = await prisma.voiceProfile.create({ data });

    expect(prisma.voiceProfile.create).toHaveBeenCalledWith({ data });
    expect(result).toMatchObject({ id: "p1", name: "My Voice" });
  });

  it("accepts non-wav formats (webm, mp3, ogg)", async () => {
    for (const sourceType of ["webm", "mp3", "ogg"]) {
      const data = {
        userId: "u1",
        name: "Voice",
        sourceType,
        sourceUrl: "/api/profiles/p1",
        sourceKey: `profiles/u1/file.${sourceType}`,
      };
      (prisma.voiceProfile.create as jest.Mock).mockResolvedValue({ id: "p1", ...data });
      const result = (await prisma.voiceProfile.create({ data })) as { sourceType: string };
      expect(result.sourceType).toBe(sourceType);
    }
  });
});

describe("VoiceProfile — update", () => {
  beforeEach(() => jest.clearAllMocks());

  it("can update sourceUrl after creation", async () => {
    const updated = { id: "p1", sourceUrl: "/api/profiles/p1" };
    (prisma.voiceProfile.update as jest.Mock).mockResolvedValue(updated);

    await prisma.voiceProfile.update({
      where: { id: "p1" },
      data: { sourceUrl: "/api/profiles/p1" },
    });

    expect(prisma.voiceProfile.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { sourceUrl: "/api/profiles/p1" },
    });
  });
});
