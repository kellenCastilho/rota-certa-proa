// "número" pertence à numeração da casa, não ao nome da rua.
function cleanHouseNumberMarker(value) {
  return String(value || "").replace(/(?:\s+|,\s*)(?:número|numero|n[º°o.]?)\s*[:.,]?\s*(?=\d)/giu, " ");
}
function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
export function addressKey(address) { return normalize(cleanHouseNumberMarker(address)).replace(/[.,;]+/g, " ").replace(/\s+/g, " ").trim(); }
function normalizeNumber(number) { return normalize(number).replace(/^0+(?=\d)/, ""); }
function roadKey(road) {
  return normalize(road).replace(/^(avenida|av\.?|rua|r\.?|travessa|tv\.?|alameda|al\.?|praca|rodovia|estrada)\s+/, "").replace(/[.,]/g, "").trim();
}
export function requestedAddress(address) {
  const original = cleanHouseNumberMarker(address);
  const text = original.split("(")[0].replace(/\b\d{2}\.?\d{3}-?\d{3}\b/g, "").replace(/\b(?:apto|apartamento|apt|ap|sala|bloco|bl)\s+[a-z0-9-]+/gi, "").replace(/\s+-\s+/g, ", ").trim();
  const first = text.split(/[,\n]/)[0].trim();
  const separated = text.match(/^(.*?)(?:,\s*|\s+n[º°o.]?\s*)(\d{1,6}[a-z]?)(?=\s|,|$)/i);
  if (separated && roadKey(separated[1])) return { number: normalizeNumber(separated[2]), road: roadKey(separated[1]) };
  const trailing = first.match(/^(.*?)\s+(\d{1,6}[a-z]?)\s*$/i);
  if (trailing && roadKey(trailing[1]) && !/^(rua|avenida|travessa|alameda|praca|rodovia)\s*$/i.test(trailing[1])) return { number: normalizeNumber(trailing[2]), road: roadKey(trailing[1]) };
  const road = roadKey(first);
  if (road) {
    const escaped = road.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // SPX includes the full street and house number again inside delivery details.
    // Match only that same road; apartment, postcode and CPF digits are never house numbers.
    const pattern = new RegExp("(?:^|[;\\s])(?:rua\\s+|r\\.?\\s+|avenida\\s+|av\\.?\\s+|travessa\\s+|tv\\.?\\s+)?" + escaped + "[,;\\s]+(?:n[º°o.]?\\s*)?(\\d{1,6}[a-z]?)(?=\\s|;|,|$)", "i");
    for (const detail of original.matchAll(/\(([^)]*)\)/g)) {
      const found = normalize(detail[1]).match(pattern);
      if (found) return { number: normalizeNumber(found[1]), road };
    }
  }
  return { number: "", road };
}
export function matchesHouse(address, candidate) {
  const expected = requestedAddress(address);
  if (!expected.number) return true;
  const data = candidate?.address || {};
  const road = data.road || data.pedestrian || data.residential || data.footway || "";
  return normalizeNumber(data.house_number) === expected.number && roadKey(road) === expected.road;
}
export function sameRoad(address, candidate) {
  const expected = requestedAddress(address);
  const data = candidate?.address || {};
  const road = data.road || data.pedestrian || data.residential || data.footway || "";
  return Boolean(expected.road) && roadKey(road) === expected.road;
}
function finiteCoords(coords) {
  const valid = (value) => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value));
  return Boolean(coords) && valid(coords.lat) && valid(coords.lng) && Math.abs(Number(coords.lat)) <= 90 && Math.abs(Number(coords.lng)) <= 180;
}
// Apenas um ponto ligado ao endereço e confirmado é aceito como destino.
export function isVerifiedCoordinate(address, coords) {
  if (!finiteCoords(coords) || coords.verifiedAddressKey !== addressKey(address)) return false;
  if (coords.geocodePrecision === "manual") return true;
  const expected = requestedAddress(address);
  if (!expected.number) return coords.geocodePrecision === "street" && roadKey(coords.matchedRoad) === expected.road;
  return coords.geocodePrecision === "house" && normalizeNumber(coords.houseNumber) === expected.number && roadKey(coords.matchedRoad) === expected.road;
}
export function isExactCoordinate(address, coords) {
  return isVerifiedCoordinate(address, coords) && (coords.geocodePrecision === "manual" || Boolean(requestedAddress(address).number));
}
