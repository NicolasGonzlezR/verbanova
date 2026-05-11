import { signToken, verifyToken, getAuthToken, type AuthPayload } from "../auth";

const PAYLOAD: AuthPayload = { sub: "user-abc-123", email: "test@example.com" };

// ── signToken / verifyToken ───────────────────────────────────────────────────

describe("signToken + verifyToken", () => {
  it("round-trips a payload correctly", () => {
    const token = signToken(PAYLOAD);
    const decoded = verifyToken(token);
    expect(decoded.sub).toBe(PAYLOAD.sub);
    expect(decoded.email).toBe(PAYLOAD.email);
  });

  it("returns a non-empty JWT string", () => {
    const token = signToken(PAYLOAD);
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3); // header.payload.signature
  });

  it("different payloads produce different tokens", () => {
    const t1 = signToken({ sub: "u1", email: "a@b.com" });
    const t2 = signToken({ sub: "u2", email: "c@d.com" });
    expect(t1).not.toBe(t2);
  });

  it("throws on a completely invalid token", () => {
    expect(() => verifyToken("not-a-token")).toThrow();
  });

  it("throws on a tampered signature", () => {
    const token = signToken(PAYLOAD);
    const parts = token.split(".");
    parts[2] = parts[2].slice(0, -3) + "xxx"; // corrupt signature
    expect(() => verifyToken(parts.join("."))).toThrow();
  });

  it("throws on an empty string", () => {
    expect(() => verifyToken("")).toThrow();
  });

  it("token payload contains sub and email claims", () => {
    const token = signToken(PAYLOAD);
    const decoded = verifyToken(token);
    expect(decoded).toMatchObject({ sub: PAYLOAD.sub, email: PAYLOAD.email });
  });
});

// ── getAuthToken ──────────────────────────────────────────────────────────────

describe("getAuthToken", () => {
  function req(authHeader?: string) {
    const headers: Record<string, string> = {};
    if (authHeader) headers["authorization"] = authHeader;
    return new Request("http://localhost/", { headers });
  }

  it("extracts a Bearer token", () => {
    expect(getAuthToken(req("Bearer my-secret-token"))).toBe("my-secret-token");
  });

  it("is case-insensitive for the Bearer prefix", () => {
    expect(getAuthToken(req("BEARER abc123"))).toBe("abc123");
    expect(getAuthToken(req("bearer abc123"))).toBe("abc123");
  });

  it("returns null when the authorization header is absent", () => {
    expect(getAuthToken(req())).toBeNull();
  });

  it("returns null for Basic auth scheme", () => {
    expect(getAuthToken(req("Basic dXNlcjpwYXNz"))).toBeNull();
  });

  it("returns null for an empty authorization header", () => {
    expect(getAuthToken(req(""))).toBeNull();
  });

  it("returns null when Bearer has no token value", () => {
    expect(getAuthToken(req("Bearer"))).toBeNull();
  });

  it("preserves the token value exactly (including dots)", () => {
    const token = "aaa.bbb.ccc";
    expect(getAuthToken(req(`Bearer ${token}`))).toBe(token);
  });
});
