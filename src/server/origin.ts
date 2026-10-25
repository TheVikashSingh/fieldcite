// Same-origin check for form POSTs handled by route handlers (server actions already check this).
// Stops another site from posting a link token it owns to sign a visitor into the wrong account.

/** True when the request's Origin (or, failing that, Referer) is the request's own host. */
export function isSameOrigin(headers: Headers, requestUrl: string): boolean {
  const host = new URL(requestUrl).host;
  const source = headers.get("origin") ?? headers.get("referer");
  if (!source) return false;
  try {
    return new URL(source).host === host;
  } catch {
    return false;
  }
}
