/**
 * Tests for GET /api/profiles/[id] and DELETE /api/profiles/[id]
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    voiceProfile: {
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

jest.mock("@/lib/s3", () => ({
  getObjectBuffer: jest.fn(),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));

import { GET, DELETE } from "../profiles/[id]/route";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";

// ── helpers ───────────────────────────────────────────────────────────────────

function authHeader(userId = "user-abc-123") {
  return { authorization: `Bearer ${signToken({ sub: userId, email: "t@t.com" })}` };
}

function makeRequest(method: string, id: string, headers: Record<string, string> = {}) {
  return new Request(`http://localhost/api/profiles/${id}`, { method, headers });
}

const PROFILE = {
  id: "profile-1",
  userId: "user-abc-123",
  name: "My Voice",
  sourceType: "wav",
  sourceUrl: "/api/profiles/profile-1",
  sourceKey: "profiles/user-abc-123/file.wav",
};

beforeEach(() => jest.clearAllMocks());

// ── GET /api/profiles/[id] ────────────────────────────────────────────────────

describe("GET /api/profiles/[id]", () => {
  it("returns 401 without auth", async () => {
    const res = await GET(makeRequest("GET", "profile-1"), {
      params: Promise.resolve({ id: "profile-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when profile not found", async () => {
    (prisma.voiceProfile.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await GET(makeRequest("GET", "profile-1", authHeader()), {
      params: Promise.resolve({ id: "profile-1" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns 200 with file bytes when profile exists", async () => {
    const { getObjectBuffer } = jest.requireMock("@/lib/s3");
    (prisma.voiceProfile.findFirst as jest.Mock).mockResolvedValue(PROFILE);
    getObjectBuffer.mockResolvedValue(Buffer.from("fake-audio-data"));
    const res = await GET(makeRequest("GET", "profile-1", authHeader()), {
      params: Promise.resolve({ id: "profile-1" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 when object is missing from storage", async () => {
    const { getObjectBuffer } = jest.requireMock("@/lib/s3");
    (prisma.voiceProfile.findFirst as jest.Mock).mockResolvedValue(PROFILE);
    getObjectBuffer.mockRejectedValue(new Error("NoSuchKey"));
    const res = await GET(makeRequest("GET", "profile-1", authHeader()), {
      params: Promise.resolve({ id: "profile-1" }),
    });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/profiles/[id] ─────────────────────────────────────────────────

describe("DELETE /api/profiles/[id]", () => {
  it("returns 401 without auth", async () => {
    const res = await DELETE(makeRequest("DELETE", "profile-1"), {
      params: Promise.resolve({ id: "profile-1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 and ok:true after deleting", async () => {
    (prisma.voiceProfile.findFirst as jest.Mock).mockResolvedValue(PROFILE);
    (prisma.voiceProfile.delete as jest.Mock).mockResolvedValue(PROFILE);
    const res = await DELETE(makeRequest("DELETE", "profile-1", authHeader()), {
      params: Promise.resolve({ id: "profile-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it("still deletes DB record if object not in storage", async () => {
    const { deleteObject } = jest.requireMock("@/lib/s3");
    (prisma.voiceProfile.findFirst as jest.Mock).mockResolvedValue(PROFILE);
    (prisma.voiceProfile.delete as jest.Mock).mockResolvedValue(PROFILE);
    deleteObject.mockRejectedValue(new Error("NoSuchKey"));
    const res = await DELETE(makeRequest("DELETE", "profile-1", authHeader()), {
      params: Promise.resolve({ id: "profile-1" }),
    });
    expect(res.status).toBe(200);
    expect(prisma.voiceProfile.delete).toHaveBeenCalled();
  });
});
