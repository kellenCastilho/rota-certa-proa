import { requestedAddress } from "./addressPrecision.js";

const STATES = "AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO";
const CITY_STATE = new RegExp(`(?:^|[-,;\\n])\\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]*?)\\s*[/,-]\\s*(${STATES})(?:\\s*[,;-]?\\s*Brasil)?\\s*$`, "i");
export function explicitDestinationContext(address) {
  const text = String(address || "").split("(")[0].replace(/\b\d{2}\.?\d{3}-?\d{3}\b/g, "").replace(/[,;\s]+$/, "");
  const match = text.match(CITY_STATE);
  return match ? { city: match[1].trim(), uf: match[2].toUpperCase(), country: "Brasil" } : null;
}

export function destinationSearch(address, currentContext, currentOrigin, cepData = null) {
  const explicit = explicitDestinationContext(address);
  const fromCep = !cepData?.erro && cepData?.localidade && cepData?.uf
    ? { city: cepData.localidade, uf: cepData.uf, country: "Brasil" } : null;
  const destination = explicit || fromCep;
  // The GPS remains the navigation origin; only the destination lookup loses the local radius.
  return { context: destination || currentContext, origin: destination ? null : currentOrigin };
}

export function destinationQuery(address, context) {
  const requested = requestedAddress(address);
  // Complements such as BARRACÃO describe the delivery, not the street location.
  const street = requested.number ? `${requested.road}, ${requested.number}` : String(address).trim();
  return [street, context?.city, context?.uf || context?.state, "Brasil"].filter(Boolean).join(", ");
}
