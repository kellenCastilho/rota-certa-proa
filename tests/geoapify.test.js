import test from "node:test";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

test("busca web identifica cidade pelo GPS e confere endereço sem cidade digitada", async () => {
  let source = await readFile(new URL("../src/services/geocoding.js", import.meta.url), "utf8");
  source = source
    .replace('import { requestGeoapify } from "./geoapifyClient.js";', 'const requestGeoapify = (...args) => globalThis.__geoapifyTestRequest(...args);')
    .replace('import { searchNativeAddressQueries } from "./nativeAddressQueries.js";', 'const searchNativeAddressQueries = () => {};')
    .replace('import { Capacitor, registerPlugin } from "@capacitor/core";', 'const Capacitor = { getPlatform: () => "web" }; const registerPlugin = () => ({});')
    .replace('import { resolveNativeAddress } from "./nativeAddress.js";', 'const resolveNativeAddress = () => {};')
    .replace('"./destinationContext.js"', JSON.stringify(new URL("../src/services/destinationContext.js", import.meta.url).href))
    .replace('"./addressPrecision.js"', JSON.stringify(new URL("../src/services/addressPrecision.js", import.meta.url).href));
  const calls = [];
  globalThis.__geoapifyTestRequest = async (payload) => {
    calls.push(payload);
    const candidate = geoapifyCandidates({ results: [building] })[0];
    return payload.operation === "reverse" ? candidate : [candidate];
  };
  try {
    const module = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
    const origin = { lat: -18.9, lng: -48.2 };
    const context = await module.getLocationContext(origin);
    assert.equal(context.city, "Cidade Exemplo");
    assert.equal(context.uf, "MG");
    const result = await module.geocodeAddress("Rua Exemplo, 50", { origin, context });
    assert.equal(result.geocodePrecision, "house");
    assert.equal(result.houseNumber, "50");
    assert.equal(result.matchedRoad, "Rua Exemplo");
    assert.match(calls[1].text, /Cidade Exemplo/);
    assert.deepEqual(calls[1].origin, origin);
    // Um número diferente no resultado não pode virar uma entrega confirmada.
    const unmatched = await module.geocodeAddress("Rua Exemplo, 51", { origin, context });
    assert.equal(unmatched.geocodePrecision, "street");
  } finally { delete globalThis.__geoapifyTestRequest; }
});

import assert from "node:assert/strict";
import { geoapifyCandidates } from "../src/services/geoapifyResults.js";
import { matchesHouse, sameRoad } from "../src/services/addressPrecision.js";
import { POST, OPTIONS } from "../api/geocodificar.js";

const building = { lat: -18.9, lon: -48.2, street: "Rua Exemplo", housenumber: "50",
  city: "Cidade Exemplo", state_code: "MG", country_code: "br", result_type: "building",
  rank: { confidence: 1, match_type: "full_match" } };
test("confirma rua e número apenas em imóvel com confiança suficiente", () => {
  const good = geoapifyCandidates({ results: [building] })[0];
  assert.equal(matchesHouse("Rua Exemplo, 50", good), true);
  assert.equal(matchesHouse("Rua Exemplo, 51", good), false);
  assert.equal(matchesHouse("Rua Outra, 50", good), false);
  assert.equal(good.address["ISO3166-2-lvl4"], "BR-MG");
  for (const change of [
    { result_type: "street" },
    { rank: { confidence: 0.8, match_type: "full_match" } },
    { rank: { confidence: 1, confidence_building_level: 0, match_type: "full_match" } },
    { rank: { confidence: 1, match_type: "match_by_street" } },
  ]) {
    const candidate = geoapifyCandidates({ results: [{ ...building, ...change }] })[0];
    assert.equal(matchesHouse("Rua Exemplo, 50", candidate), false);
    assert.equal(sameRoad("Rua Exemplo, 50", candidate), true);
  }
});
test("ignora coordenadas inválidas e tolera resposta vazia", () => {
  assert.deepEqual(geoapifyCandidates({ results: [null, { ...building, lat: null }, { ...building, lon: 181 }] }), []);
  assert.deepEqual(geoapifyCandidates({}), []);
});

test("API autentica, restringe consulta, preserva segredo, cacheia e limita", async () => {
  const previousFetch = globalThis.fetch;
  const envNames = ["GEOAPIFY_API_KEY", "VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"];
  const previousEnv = envNames.map((name) => process.env[name]);
  process.env.GEOAPIFY_API_KEY = "private-test-value";
  process.env.VITE_SUPABASE_URL = "https://example.supabase.co";
  process.env.VITE_SUPABASE_ANON_KEY = "public-test-value";
  let providerCalls = 0;
  let authAllowed = true;
  let failProvider = false;
  let lastUrl;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === "example.supabase.co") return Response.json(
      authAllowed ? { id: "test-user" } : { error: "unauthorized" }, { status: authAllowed ? 200 : 401 });
    assert.equal(url.hostname, "api.geoapify.com");
    assert.equal(url.searchParams.get("apiKey"), "private-test-value");
    lastUrl = url;
    providerCalls++;
    if (failProvider) throw new Error("private-test-value");
    return Response.json({ results: [building, { ...building, country_code: "us" }],
      query: { text: "not returned" } });
  };
  const req = (body, headers = {}) => new Request("https://rota-certa-proa.vercel.app/api/geocodificar", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer valid-token",
      Origin: "capacitor://localhost", ...headers }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await POST(req({ operation: "search", text: "Rua Exemplo, 50" }, { Authorization: "" }))).status, 401);
    assert.equal(providerCalls, 0);
    assert.equal((await POST(req({ operation: "search", text: "Rua Exemplo, 50" }, { Origin: "https://untrusted.example" }))).status, 403);
    assert.equal((await POST(req({ operation: "search", text: "x", origin: { lat: null, lng: 0 } }))).status, 400);
    assert.equal((await POST(req({ operation: "arbitrary-url", text: "x" }))).status, 400);
    assert.equal((await POST(req({ operation: "search", text: "x".repeat(2100) }))).status, 413);
    authAllowed = false;
    assert.equal((await POST(req({ operation: "search", text: "x" }))).status, 401);
    assert.equal(providerCalls, 0);
    authAllowed = true;

    const query = { operation: "search", text: "Rua Exemplo, 50, Cidade Exemplo",
      origin: { lat: -18.9, lng: -48.2 }, apiKey: "attacker-supplied-key" };
    const response = await POST(req(query));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "capacitor://localhost");
    const body = await response.json();
    assert.equal(body.results.length, 1);
    assert.equal(body.query, undefined);
    assert.equal(JSON.stringify(body).includes("private-test-value"), false);
    assert.equal(lastUrl.searchParams.get("filter"), "countrycode:br");
    assert.equal(lastUrl.searchParams.get("bias"), "proximity:-48.2,-18.9");
    assert.equal((await POST(req(query))).status, 200);
    assert.equal(providerCalls, 1);

    assert.equal((await POST(req({ operation: "reverse", origin: { lat: -18.9, lng: -48.2 } }))).status, 200);
    assert.equal(lastUrl.pathname, "/v1/geocode/reverse");
    assert.equal(lastUrl.searchParams.get("type"), "city");
    failProvider = true;
    const error = await POST(req({ operation: "search", text: "unique failure" }));
    assert.equal(error.status, 502);
    assert.equal((await error.text()).includes("private-test-value"), false);
    failProvider = false;

    const preflight = OPTIONS(new Request("https://app.example", { headers: { Origin: "http://localhost" } }));
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("Access-Control-Allow-Headers"), /Authorization/);
    for (let i = 0; i < 296; i++) assert.equal((await POST(req(query))).status, 200);
    assert.equal((await POST(req(query))).status, 429);
  } finally {
    globalThis.fetch = previousFetch;
    envNames.forEach((name, i) => previousEnv[i] === undefined ? delete process.env[name] : process.env[name] = previousEnv[i]);
  }
});
