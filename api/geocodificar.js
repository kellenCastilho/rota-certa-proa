import { createHash } from "node:crypto";

// Estes limites e caches são por instância. Não substituem um contador
// compartilhado nem a cota diária do projeto Geoapify.
const usage = new Map();
const cache = new Map();
const pending = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 256;
const MAX_USERS = 2048;

function cors(request) {
  const origin = request.headers.get("origin");
  const allowed = new Set([
    "https://rota-certa-proa.vercel.app",
    "capacitor://localhost", "http://localhost", "https://localhost",
    "http://localhost:5173", "http://localhost:3000",
    ...[process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]
      .filter(Boolean).map((host) => `https://${host}`),
  ]);
  if (origin && !allowed.has(origin)) return null;
  return {
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
}

function json(body, status, headers) {
  return Response.json(body, { status, headers });
}

export function OPTIONS(request) {
  const headers = cors(request);
  return new Response(null, { status: headers ? 204 : 403, headers: headers || {} });
}

function validPoint(point) {
  return point && typeof point.lat === "number" && typeof point.lng === "number" &&
    Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}

function requestParameters(body) {
  if (!body || !["search", "reverse"].includes(body.operation)) return null;
  const params = new URLSearchParams({ format: "json", lang: "pt" });
  if (body.operation === "reverse") {
    if (!validPoint(body.origin)) return null;
    params.set("lat", String(body.origin.lat));
    params.set("lon", String(body.origin.lng));
    params.set("type", "city");
    params.set("limit", "1");
  } else {
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 500) return null;
    if (body.origin != null && !validPoint(body.origin)) return null;
    params.set("text", body.text.trim());
    params.set("limit", "8");
    params.set("filter", "countrycode:br");
    if (body.origin) params.set("bias", `proximity:${body.origin.lng},${body.origin.lat}`);
  }
  return params;
}

function consume(userId) {
  const now = Date.now();
  for (const [id, entry] of usage) if (entry.expires <= now) usage.delete(id);
  let entry = usage.get(userId);
  if (!entry) {
    if (usage.size >= MAX_USERS) return false;
    entry = { expires: now + 60000, count: 0 };
    usage.set(userId, entry);
  }
  entry.count += 1;
  return entry.count <= 300;
}

function cleanResults(data) {
  const fields = ["lat", "lon", "street", "housenumber", "city", "town", "municipality",
    "village", "county", "state", "state_code", "country_code", "result_type"];
  return { results: (Array.isArray(data?.results) ? data.results : []).slice(0, 8).map((item) => ({
    ...Object.fromEntries(fields.filter((field) => item[field] != null).map((field) => [field, item[field]])),
    rank: Object.fromEntries(["confidence", "confidence_building_level", "match_type"]
      .filter((field) => item.rank?.[field] != null).map((field) => [field, item.rank[field]])),
  })) };
}

async function queryProvider(operation, params, key, cacheKey) {
  const saved = cache.get(cacheKey);
  if (saved && saved.expires > Date.now()) return saved.data;
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  if (pending.size >= 16) throw Object.assign(new Error(), { status: 429 });
  const task = (async () => {
    const url = new URL(`https://api.geoapify.com/v1/geocode/${operation}`);
    url.search = params.toString();
    url.searchParams.set("apiKey", key);
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Object.assign(new Error(), { status: response.status === 429 ? 429 : 502 });
    const data = cleanResults(await response.json());
    if (operation === "search") {
      data.results = data.results.filter((item) => item.country_code?.toLowerCase() === "br");
    }
    for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL });
    return data;
  })();
  pending.set(cacheKey, task);
  try { return await task; } finally { pending.delete(cacheKey); }
}

export async function POST(request) {
  const headers = cors(request);
  if (!headers) return json({ error: "Origem não autorizada." }, 403, {});
  const key = process.env.GEOAPIFY_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key || !supabaseUrl || !anonKey) {
    return json({ error: "Serviço de localização ainda não configurado." }, 503, headers);
  }
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer [^\s]{1,4096}$/.test(authorization)) {
    return json({ error: "Entre na sua conta para localizar endereços." }, 401, headers);
  }
  if (Number(request.headers.get("content-length")) > 2048) {
    return json({ error: "Consulta de endereço inválida." }, 413, headers);
  }
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 2048) return json({ error: "Consulta de endereço inválida." }, 413, headers);
    let body;
    try { body = JSON.parse(raw); } catch { return json({ error: "Consulta de endereço inválida." }, 400, headers); }
    const params = requestParameters(body);
    if (!params) return json({ error: "Consulta de endereço inválida." }, 400, headers);

    // A chave pública do Supabase não autentica o chamador: o token é conferido
    // pelo /auth/v1/user. Nunca aceite apenas um userId enviado pelo aplicativo.
    const authResponse = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/user`, {
      headers: { apikey: anonKey, Authorization: authorization },
      signal: AbortSignal.timeout(5000),
    });
    if (!authResponse.ok) {
      return json({ error: "Sua sessão expirou. Entre novamente na sua conta." },
        authResponse.status >= 500 ? 503 : 401, headers);
    }
    const user = await authResponse.json();
    if (!user?.id) return json({ error: "Sessão inválida." }, 401, headers);
    if (!consume(user.id)) {
      return json({ error: "Muitas consultas. Aguarde um minuto e tente novamente." }, 429,
        { ...headers, "Retry-After": "60" });
    }
    const cacheKey = createHash("sha256").update(`${user.id}|${body.operation}|${params}`).digest("hex");
    const result = await queryProvider(body.operation, params, key, cacheKey);
    return json(result, 200, headers);
  } catch (error) {
    const status = error?.status === 429 ? 429 : 502;
    return json({ error: status === 429 ? "Limite de consultas atingido. Tente novamente mais tarde."
      : "Serviço de localização temporariamente indisponível." }, status, headers);
  }
}
