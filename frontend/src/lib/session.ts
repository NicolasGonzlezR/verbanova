export const AUTH_TOKEN_COOKIE = "translateapp_token";
export const AUTH_USER_COOKIE = "translateapp_user";

export function setAuthCookie(token: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax`;
}

export function clearAuthCookie() {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_TOKEN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

export function getClientAuthToken() {
  if (typeof document === "undefined") return null;
  const entry = document.cookie
    .split("; ")
    .find((cookie) => cookie.startsWith(`${AUTH_TOKEN_COOKIE}=`));
  if (!entry) return null;
  return decodeURIComponent(entry.slice(AUTH_TOKEN_COOKIE.length + 1));
}
