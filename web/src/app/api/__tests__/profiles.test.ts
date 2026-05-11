/**
 * Tests for GET and POST /api/profiles
 * Prisma and MinIO S3 are mocked.
 */

jest.mock("@/lib/prisma", () => ({
  prisma: {
    voiceProfile: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock("@/lib/s3", () => ({
  putObject: jest.fn().mockResolvedValue(undefined),
  ensureBucket: jest.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "../profiles/route";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";

// ── helpers ───────────────────────────────────────────────────────────────────

function makeAuthHeader(userId = "user-abc-123", email = "test@example.com") {
  const token = signToken({ sub: userId, email });
  return { authorization: `Bearer ${token}` };
}

function makeGetRequest(authHeader?: ReturnType<typeof makeAuthHeader>) {
  return new Request("http://localhost/api/profiles", {
    method: "GET",
    headers: authHeader ?? {},
  });
}

async function makePostRequest(
  fields: { name?: string; fileType?: string; fileName?: string } = {},
  authHeader?: ReturnType<typeof makeAuthHeader>
) {
  const form = new FormData();
  if (fields.name !== undefined) form.append("name", fields.name);
  if (fields.fileType !== undefined) {
    const file = new File(["audio-data"], fields.fileName ?? "recording.wav", {
      type: fields.fileType,
    });
    form.append("file", file);
  }
  return new Request("http://localhost/api/profiles", {
    method: "POST",
    headers: authHeader ?? makeAuthHeader(),
    body: form,
  });
}

beforeEach(() => jest.clearAllMocks());

// ── GET /api/profiles ─────────────────────────────────────────────────────────

describe("GET /api/profiles", () => {
  it("returns 401 without an Authorization header", async () => {
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 with an invalid token", async () => {
    const res = await GET(
      new Request("http://localhost/api/profiles", {
        headers: { authorization: "Bearer not-a-real-token" },
      })
    );
    expect(res.status).toBe(401);
  });

  it("returns 200 with a valid token", async () => {
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue([]);
    const res = await GET(makeGetRequest(makeAuthHeader()));
    expect(res.status).toBe(200);
  });

  it("returns a profiles array in the body", async () => {
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue([]);
    const res = await GET(makeGetRequest(makeAuthHeader()));
    const body = await res.json();
    expect(Array.isArray(body.profiles)).toBe(true);
  });

  it("returns only the authenticated user's profiles", async () => {
    const profiles = [
      { id: "p1", name: "Voice A", userId: "user-abc-123" },
      { id: "p2", name: "Voice B", userId: "user-abc-123" },
    ];
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue(profiles);

    const res = await GET(makeGetRequest(makeAuthHeader("user-abc-123")));
    const body = await res.json();
    expect(body.profiles).toHaveLength(2);
  });

  it("queries Prisma with the correct userId filter", async () => {
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue([]);
    await GET(makeGetRequest(makeAuthHeader("user-abc-123")));
    expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: "user-abc-123" } })
    );
  });

  it("orders results by createdAt desc", async () => {
    (prisma.voiceProfile.findMany as jest.Mock).mockResolvedValue([]);
    await GET(makeGetRequest(makeAuthHeader()));
    expect(prisma.voiceProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } })
    );
  });
});

// ── POST /api/profiles ────────────────────────────────────────────────────────

describe("POST /api/profiles", () => {
  it("returns 401 without auth", async () => {
    const req = await makePostRequest({ name: "My Voice", fileType: "audio/wav" }, {} as ReturnType<typeof makeAuthHeader>);
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("returns 400 when name is missing", async () => {
    const req = await makePostRequest({ fileType: "audio/wav" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when file is missing", async () => {
    const req = await makePostRequest({ name: "My Voice" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-audio content type", async () => {
    const req = await makePostRequest({ name: "My Voice", fileType: "image/png" });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 200 and creates a profile for a valid wav upload", async () => {
    const createdProfile = {
      id: "profile-1",
      userId: "user-abc-123",
      name: "My Voice",
      sourceType: "wav",
      sourceUrl: "/api/profiles/pending",
      sourceKey: "profiles/user-abc-123/123-My Voice.wav",
    };
    (prisma.voiceProfile.create as jest.Mock).mockResolvedValue(createdProfile);
    (prisma.voiceProfile.update as jest.Mock).mockResolvedValue({
      ...createdProfile,
      sourceUrl: "/api/profiles/profile-1",
    });

    const req = await makePostRequest({ name: "My Voice", fileType: "audio/wav" });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile).toBeDefined();
    expect(body.profile.name).toBe("My Voice");
  });

  it("uploads the file to MinIO (calls putObject)", async () => {
    const { putObject } = jest.requireMock("@/lib/s3");
    (prisma.voiceProfile.create as jest.Mock).mockResolvedValue({
      id: "p1",
      userId: "user-abc-123",
      name: "V",
      sourceType: "wav",
      sourceUrl: "/api/profiles/pending",
      sourceKey: "profiles/user-abc-123/file.wav",
    });
    (prisma.voiceProfile.update as jest.Mock).mockResolvedValue({});

    const req = await makePostRequest({ name: "V", fileType: "audio/wav" });
    await POST(req);

    expect(putObject).toHaveBeenCalled();
  });
});
