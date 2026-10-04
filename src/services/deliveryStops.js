function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function street(value) {
  return normalize(value).replace(/^av\.?\s+/, "avenida ").replace(/^r\.\s+/, "rua ").replace(/^tv\.?\s+/, "travessa ").replace(/[.;]/g, "").trim();
}
function number(value) { return normalize(value).replace(/^0+(?=\d)/, ""); }
const states = "AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO";

// Only an explicit house number and locality establish a shared stop.
// Apartment/block numbers, a street midpoint or a postcode alone never do.
export function deliveryStopIdentity(delivery) {
  const address = String(delivery.address || "");
  const main = address.split("(")[0];
  const parts = main.split(",").map((part) => part.trim());
  let road = parts[0] || "";
  let house = /^\d{1,6}[a-z]?$/i.test(parts[1] || "") ? parts[1] : "";
  const trailing = road.match(/^(.*?)\s+(?:n[º°o.]?\s*)?(\d{1,6}[a-z]?)$/i);
  // Numbered street names require a comma separating the house number.
  if (!house && trailing && !/^(rua|avenida|travessa|alameda)\s*$/i.test(trailing[1])) {
    road = trailing[1]; house = trailing[2];
  }
  const canonicalRoad = street(road);
  if (!house) {
    for (const match of address.matchAll(/\(([^)]*)\)/g)) {
      const detail = normalize(match[1]);
      const escaped = canonicalRoad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = detail.match(new RegExp("(?:^|[;\\s])" + escaped + "[;,\\s]+(?:n[º°o.]?\\s*)?(\\d{1,6}[a-z]?)(?=\\s|;|,|$)", "i"));
      if (found) { house = found[1]; break; }
    }
  }
  const localityMatch = main.match(new RegExp(",\\s*([^,]+),\\s*(" + states + ")(?=\\s*,|\\s*$)", "i"));
  const cep = address.match(/\b(\d{5})-?(\d{3})\b/);
  const locality = localityMatch ? normalize(localityMatch[1]) + "/" + localityMatch[2].toLowerCase() : cep ? "cep:" + cep[1] + cep[2] : "";
  if (!canonicalRoad || !house || !locality) return null;
  return {
    key: JSON.stringify([String(delivery.rotaId || ""), canonicalRoad, number(house), locality]),
    label: road + ", " + number(house),
  };
}

function farApart(a, b) {
  if (!a || !b) return false;
  const radians = Math.PI / 180;
  const dLat = (Number(a.lat) - Number(b.lat)) * radians;
  const dLng = (Number(a.lng) - Number(b.lng)) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(Number(a.lat) * radians) * Math.cos(Number(b.lat) * radians) * Math.sin(dLng / 2) ** 2;
  return !Number.isFinite(h) || 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h))) > 80;
}

export function groupDeliveryStops(deliveries) {
  const groups = [];
  const byKey = new Map();
  for (const delivery of deliveries) {
    const identity = deliveryStopIdentity(delivery);
    const candidates = identity ? byKey.get(identity.key) || [] : [];
    const group = candidates.find((candidate) => candidate.deliveries.every((member) => !farApart(member.coords, delivery.coords)));
    if (group) group.deliveries.push(delivery);
    else {
      const created = { key: identity ? identity.key + ":" + candidates.length : "delivery:" + delivery.id, label: identity?.label || delivery.address, deliveries: [delivery], representative: delivery };
      groups.push(created);
      if (identity) byKey.set(identity.key, [...candidates, created]);
    }
  }
  return groups;
}

export function expandDeliveryStops(orderedRepresentatives, groups) {
  const members = new Map(groups.map((group) => [String(group.representative.id), group.deliveries]));
  return orderedRepresentatives.flatMap((delivery) => members.get(String(delivery.id)) || [delivery]);
}
