// Cada alternativa precisa passar pela mesma validação exata de rua, número e cidade.
export async function searchNativeAddressQueries(address, query, search, validate) {
  const hasRoadType = /^(?:avenida|av\.?|rua|r\.?|travessa|tv\.?|alameda|al\.?|praça|praca|rodovia|estrada)\s+/i.test(String(address || "").trim());
  const queries = hasRoadType ? [query] : [query, `Rua ${query}`, `Avenida ${query}`];
  for (const candidateQuery of [...new Set(queries)]) {
    try {
      const result = await search(candidateQuery);
      const precise = await validate(result?.results || []);
      if (precise) return precise;
    } catch (error) {
      console.warn("Não foi possível consultar esta alternativa de endereço:", error.message);
    }
  }
  return null;
}
