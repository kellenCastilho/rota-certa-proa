import { requestedAddress } from "./addressPrecision.js";

// Alternativas passam pela mesma validação de rua, número e cidade.
export function nativeAddressQueryVariants(address, query) {
  const hasRoadType = /^(?:avenida|av\.?|rua|r\.?|travessa|tv\.?|alameda|al\.?|praça|praca|rodovia|estrada)\s+/i.test(String(address || "").trim());
  const bases = hasRoadType ? [query] : [query, `Rua ${query}`, `Avenida ${query}`];
  const number = requestedAddress(address).number;
  const queries = [];
  for (const candidate of bases) {
    queries.push(candidate);
    const comma = candidate.indexOf(",");
    if (!number || comma < 0) continue;
    const head = candidate.slice(0, comma).trim();
    if (!head.toLowerCase().endsWith(" " + number)) continue;
    const road = head.slice(0, -number.length).trim();
    queries.push(`${road}, número ${number}${candidate.slice(comma)}`);
  }
  return [...new Set(queries)];
}

export async function searchNativeAddressQueries(address, query, search, validate) {
  for (const candidateQuery of nativeAddressQueryVariants(address, query)) {
    try {
      console.info("[DaRota endereço] Consulta:", candidateQuery);
      const result = await search(candidateQuery);
      console.info("[DaRota endereço] Resposta:", JSON.stringify(result?.results || []));
      const precise = await validate(result?.results || []);
      if (precise) return precise;
    } catch (error) {
      console.warn("Não foi possível consultar esta alternativa de endereço:", error.message);
    }
  }
  return null;
}
