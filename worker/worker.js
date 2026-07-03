/*
 * worker.js — Cloudflare Worker (or any edge function) that makes the KinoPUB
 * API usable from a browser-based MSX plugin.
 *
 * It does three things:
 *   1. Adds permissive CORS headers so the TV browser can read API responses.
 *   2. Serves POST /msx/keyboard — bridges MSX's native on-screen keyboard
 *      (execute:code) into an interaction request carrying the typed query.
 *   3. Serves GET  /sub?u=<encoded-url> — proxies cross-origin subtitle files
 *      so they can be read and converted to WebVTT by the player.
 *
 * Everything else is forwarded verbatim to the KinoPUB API host.
 *
 * Deploy:  wrangler deploy   (or paste into the Cloudflare dashboard editor)
 * Then set API_BASE in public/js/config.js to this Worker's URL.
 *
 * CREDENTIALS (recommended for public hosting like GitHub Pages):
 *   Store your client_id / client_secret as Worker secrets so they NEVER live
 *   in the client bundle / public repo:
 *       npx wrangler secret put KP_CLIENT_ID
 *       npx wrangler secret put KP_CLIENT_SECRET
 *   When present, they are injected into every /oauth2/* request below, and you
 *   can leave CLIENT_ID / CLIENT_SECRET blank in config.js.
 */

const API_HOST = "https://api.service-kp.com"; // primary KinoPUB API host

function cors(resp) {
  const h = new Headers(resp.headers);
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  h.set("Access-Control-Max-Age", "86400");
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

function json(obj, status) {
  return cors(new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
  }));
}

async function handle(request, env) {
  const url = new URL(request.url);

  // --- CORS preflight ---
  if (request.method === "OPTIONS") { return cors(new Response(null, { status: 204 })); }

  // --- (2) native keyboard bridge for search ---
  if (url.pathname === "/msx/keyboard" && request.method === "POST") {
    let body = {};
    try { body = JSON.parse(await request.text() || "{}"); } catch (e) { body = {}; }
    const code = body.code || "";
    const returnAction = (body.data && body.data.returnAction) || "";
    // MSX expects a wrapped response whose action gets executed on the client.
    return json({ response: { data: { action: returnAction, data: { q: code } } } });
  }

  // --- (3) subtitle proxy ---
  if (url.pathname === "/sub") {
    const target = url.searchParams.get("u");
    if (!target) { return json({ error: "missing u" }, 400); }
    const r = await fetch(target, { method: "GET" });
    const text = await r.text();
    return cors(new Response(text, { status: r.status, headers: { "Content-Type": "text/plain; charset=utf-8" } }));
  }

  // --- (1) transparent proxy to the KinoPUB API ---
  // Inject client credentials from Worker secrets into oauth requests (optional,
  // recommended for public hosting). Leave them blank in config.js when used.
  if (env && env.KP_CLIENT_ID && url.pathname.indexOf("/oauth2/") === 0) {
    url.searchParams.set("client_id", env.KP_CLIENT_ID);
    if (env.KP_CLIENT_SECRET) { url.searchParams.set("client_secret", env.KP_CLIENT_SECRET); }
  }
  const target = API_HOST + url.pathname + url.search;
  const init = { method: request.method, headers: { "Accept": "application/json" } };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }
  const apiResp = await fetch(target, init);
  return cors(apiResp);
}

// Cloudflare Workers entrypoint (module syntax) — receives `env` with secrets.
export default {
  async fetch(request, env) {
    try { return await handle(request, env); }
    catch (e) { return json({ error: "proxy_error", detail: String(e) }, 502); }
  }
};

/* --- Service Worker syntax fallback (older Workers runtime, no `env`) ---
addEventListener("fetch", (event) => { event.respondWith(handle(event.request, self)); });
*/
