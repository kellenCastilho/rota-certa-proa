import { addressKey, requestedAddress, isVerifiedCoordinate } from "./addressPrecision.js";
const normalize = (v) => String(v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function selectNativeAddress(address, results, context, origin) {
  // A known city is required; a street midpoint never confirms a house number.
  if (!context?.city || !requestedAddress(address).number || !Array.isArray(results)) return null;
  for (const r of results) {
    if (normalize(r.city) !== normalize(context.city) || normalize(r.countryCode) !== "br") continue;
    const coords = {lat:r.lat,lng:r.lng,geocodePrecision:"house",houseNumber:r.houseNumber,
      matchedRoad:r.road,verifiedAddressKey:addressKey(address),source:"android-geocoder"};
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
