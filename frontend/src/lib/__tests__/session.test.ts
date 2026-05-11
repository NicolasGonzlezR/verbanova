import {
  AUTH_TOKEN_COOKIE,
  AUTH_USER_COOKIE,
  setAuthCookie,
  clearAuthCookie,
  getClientAuthToken,
} from "../session";

// ── exported constants ────────────────────────────────────────────────────────

describe("session constants", () => {
  it("AUTH_TOKEN_COOKIE has the expected name", () => {
    expect(AUTH_TOKEN_COOKIE).toBe("translateapp_token");
  });

  it("AUTH_USER_COOKIE has the expected name", () => {
    expect(AUTH_USER_COOKIE).toBe("translateapp_user");
  });
});

// ── SSR safety (document is undefined in node environment) ───────────────────

describe("browser-only functions in SSR context", () => {
  it("setAuthCookie returns undefined without throwing in SSR", () => {
    expect(() => setAuthCookie("some-token")).not.toThrow();
    expect(setAuthCookie("some-token")).toBeUndefined();
  });

  it("clearAuthCookie returns undefined without throwing in SSR", () => {
    expect(() => clearAuthCookie()).not.toThrow();
    expect(clearAuthCookie()).toBeUndefined();
  });

  it("getClientAuthToken returns null in SSR", () => {
    expect(getClientAuthToken()).toBeNull();
  });
});
