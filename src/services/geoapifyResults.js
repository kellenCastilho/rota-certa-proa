// Mantém o contrato usado pela conferência de rua e número do DaRota.
// Um número repetido em uma resposta de rua não confirma o imóvel.
export function geoapifyCandidates(data) {
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((item) => item && typeof item.lat === "number" && typeof item.lon === "number" &&
      Number.isFinite(item.lat) && Number.isFinite(item.lon) &&
      Math.abs(item.lat) <= 90 && Math.abs(item.lon) <= 180)
    .map((item) => {
      const rank = item.rank || {};
      const building = ["building", "amenity"].includes(item.result_type) &&
        ["full_match", "match_by_building"].includes(rank.match_type) &&
        Number(rank.confidence) >= 0.95 &&
        (rank.confidence_building_level == null || Number(rank.confidence_building_level) >= 0.95);
      const uf = String(item.state_code || "").replace(/^BR-/i, "").toUpperCase();
      return {
        lat: item.lat,
        lon: item.lon,
        address: {
          road: item.street || "",
          house_number: building ? item.housenumber || "" : "",
          city: item.city || "",
          town: item.town || "",
          municipality: item.municipality || "",
          village: item.village || "",
          county: item.county || "",
          state: item.state || "",
          "ISO3166-2-lvl4": /^[A-Z]{2}$/.test(uf) ? `BR-${uf}` : "",
          country_code: item.country_code || "",
        },
      };
    });
}
