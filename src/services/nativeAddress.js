import { addressKey, requestedAddress, isVerifiedCoordinate } from "./addressPrecision.js";
const normalize = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function selectNativeAddress(address, results, context, origin) {
  // A known city is required; a street midpoint never confirms a house number.
  if (!context?.city || !requestedAddress(address).number || !Array.isArray(results)) return null;
  for (const r of results) {
    if (normalize(r.city) !== normalize(context.city) || normalize(r.countryCode) !== "br") continue;
    const coords = {lat:r.lat,lng:r.lng,geocodePrecision:"house",houseNumber:r.houseNumber,
      matchedRoad:r.road,verifiedAddressKey:addressKey(address),source:r.source || "android-geocoder"};
    if (!isVerifiedCoordinate(address,coords)) continue;
    if (origin) {
      const rad = Math.PI / 180;
      const dlat=(Number(coords.lat)-origin.lat)*rad,dlng=(Number(coords.lng)-origin.lng)*rad;
      const a=Math.sin(dlat/2)**2+Math.cos(origin.lat*rad)*Math.cos(Number(coords.lat)*rad)*Math.sin(dlng/2)**2;
      const km=6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));
      if (km>120) continue;
    }
    return coords;
  }
  return null;
}

// A provider spelling can differ. Validate it against the street-specific CEP,
// with the requested house number and city still required. No fuzzy matching.
export async function resolveNativeAddress(address, results, context, origin, lookupPostalCode) {
  const exact = selectNativeAddress(address, results, context, origin);
  if (exact) return exact;
  if (!context?.city || !Array.isArray(results)) return null;
  const postalCodes = new Map();
  for (const candidate of results) {
    if (candidate.source !== "ios-geocoder" || normalize(candidate.city) !== normalize(context.city)
        || normalize(candidate.countryCode) !== "br") continue;
    const cep = String(candidate.postalCode || "").replace(/\D/g, "");
    if (!/^\d{8}$/.test(cep)) continue;
    // First verify number, coordinates and distance, without accepting the street yet.
    const requested = requestedAddress(address);
    if (!selectNativeAddress(address, [{ ...candidate, road: requested.road }], context, origin)) continue;
    try {
      if (!postalCodes.has(cep)) postalCodes.set(cep, await lookupPostalCode(cep));
      const postal = postalCodes.get(cep);
      if (!postal || postal.erro || String(postal.cep || "").replace(/\D/g, "") !== cep
          || normalize(postal.localidade) !== normalize(context.city)
          || !postal.uf || normalize(postal.uf) !== normalize(candidate.uf)
          || (context.uf && normalize(postal.uf) !== normalize(context.uf)) || !postal.logradouro) continue;
      // selectNativeAddress requires the CEP's street to equal the requested street.
      const verified = selectNativeAddress(address, [{ ...candidate, road: postal.logradouro }], context, origin);
      if (verified) return { ...verified, providerRoad: candidate.road, postalCode: cep,
        streetValidation: "postal-code" };
    } catch { /* Keep the destination unconfirmed if the independent lookup fails. */ }
  }
  return null;
}
