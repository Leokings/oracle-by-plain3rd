export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("access-control-allow-origin", "*");
  headers.set("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  headers.set("access-control-allow-headers", "content-type,authorization");
  const status = Number(init.status || 200);
  const body = [204, 205, 304].includes(status) ? null : JSON.stringify(data);
  return new Response(body, { ...init, status, headers });
}

export function problem(error, status = 500) {
  const message = String(error?.message || error || "Unknown error");
  return json({ error: message }, { status });
}

export async function requestJson(request, maxBytes = 16_384) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("Request body is too large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw new Error("Request body is too large");
  }
  return text ? JSON.parse(text) : {};
}
