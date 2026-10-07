import { requestGeoapify } from "./geoapifyClient.js";
import { searchNativeAddressQueries } from "./nativeAddressQueries.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { destinationSearch, destinationQuery, explicitDestinationContext } from "./destinationContext.js";
import { resolveNativeAddress } from "./nativeAddress.js";
const nativeAddress = registerPlugin("DaRotaNavigation");
import { addressKey, requestedAddress, matchesHouse, sameRoad, isVerifiedCoordinate } from "./addressPrecision.js";

let cachedLocationContext = null;
let cachedOriginKey = "";

const MAX_DISTANCE_KM = 120;
const VIACEP_TIMEOUT_MS = 6000;
const CEP_COORDS_TIMEOUT_MS = 7000;
const GEOCODE_CACHE_KEY = "rota-certa-geocode-cache-v8";
const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 8000
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "O serviço de localização demorou para responder."
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function haversineKm(a, b) {
  const R = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(h));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeAddressKey(value) {
  return normalizeText(value)
    .replace(/[.,;:/\\|()[\]{}_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contextLabel(context) {
  if (!context) return "";

  if (typeof context === "string") {
    return context.trim();
  }

  return [
    context.city,
    context.uf || context.state,
    "Brasil",
  ]
    .filter(Boolean)
    .join(", ");
}

function candidateCity(item) {
  const address = item?.address || {};

  return (
    address.city ||
    address.town ||
    address.municipality ||
    address.village ||
    address.county ||
    ""
  );
}

function candidatePlaceNames(item) {
  const address = item?.address || {};

  return [
    address.city,
    address.town,
    address.municipality,
    address.village,
    address.county,
    address.state_district,
  ]
    .filter(Boolean)
    .map(normalizeText);
}

function belongsToCurrentCity(item, context) {
  if (!context?.city) return true;

  const expected = normalizeText(context.city);
  const foundNames = candidatePlaceNames(item);

  if (!foundNames.length) return false;

  return foundNames.some(
    (found) =>
      found === expected ||
      found.includes(expected) ||
      expected.includes(found)
  );
}

function readCache() {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return {};
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(
        GEOCODE_CACHE_KEY
      ) || "{}"
    );

    return parsed &&
      typeof parsed === "object"
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function writeCache(cache) {
  if (
    typeof window === "undefined" ||
    !window.localStorage
  ) {
    return;
  }

  try {
    window.localStorage.setItem(
      GEOCODE_CACHE_KEY,
      JSON.stringify(cache)
    );
  } catch (error) {
    console.warn(
      "Não foi possível salvar o cache de endereços:",
      error
    );
  }
}

function cacheKey(address, context) {
  const city =
    typeof context === "string"
      ? context
      : [
          context?.city,
          context?.uf ||
            context?.state,
        ]
          .filter(Boolean)
          .join(" ");

  return `${addressKey(address)}|${normalizeAddressKey(city)}`;
}

function getCachedGeocode(
  address,
  context,
  origin
) {
  const cache = readCache();
  const key = cacheKey(
    address,
    context
  );

  const contextSuffix = key.slice(key.lastIndexOf("|"));
  const candidates = [
    cache[key],
    ...Object.entries(cache)
      .filter(([savedKey]) => savedKey !== key && savedKey.endsWith(contextSuffix))
      .map(([, value]) => value),
  ];
  const item = candidates.find((candidate) =>
    candidate &&
    candidate.verifiedAddressKey === addressKey(address) &&
    isVerifiedCoordinate(address, candidate) &&
    Date.now() - Number(candidate.savedAt || 0) <= GEOCODE_CACHE_TTL_MS &&
    (!origin || haversineKm(origin, candidate) <= MAX_DISTANCE_KM)
  );
  if (item && cache[key] !== item) {
    cache[key] = item;
    writeCache(cache);
  }

  if (!item) return null;

  if (
    Date.now() -
      Number(item.savedAt || 0) >
    GEOCODE_CACHE_TTL_MS
  ) {
    delete cache[key];
    writeCache(cache);
    return null;
  }

  const coords = {
    ...item,
    lat: Number(item.lat),
    lng: Number(item.lng),
  };

  if (
    !Number.isFinite(coords.lat) ||
    !Number.isFinite(coords.lng)
  ) {
    return null;
  }

  if (
    origin &&
    haversineKm(origin, coords) >
      MAX_DISTANCE_KM
  ) {
    return null;
  }

  if (!isVerifiedCoordinate(address, coords)) return null;
  return coords;
}

function saveCachedGeocode(
  address,
  context,
  coords
) {
  if (
    !Number.isFinite(coords?.lat) ||
    !Number.isFinite(coords?.lng)
  ) {
    return;
  }

  const cache = readCache();

  cache[
    cacheKey(address, context)
  ] = {
    ...coords,
    lat: coords.lat,
    lng: coords.lng,
    savedAt: Date.now(),
  };

  writeCache(cache);
}

export async function getLocationContext(
  origin
) {
  if (
    !origin ||
    !Number.isFinite(
      origin.lat
    ) ||
    !Number.isFinite(
      origin.lng
    )
  ) {
    return null;
  }

  const originKey =
    `${origin.lat.toFixed(
      3
    )},${origin.lng.toFixed(3)}`;

  if (
    cachedLocationContext &&
    cachedOriginKey ===
      originKey
  ) {
    return cachedLocationContext;
  }

  if (Capacitor.getPlatform() === "ios") {
    try {
      const response = await nativeAddress.reverseGeocode({ lat: origin.lat, lng: origin.lng });
      const result = response.results?.find((item) => item.city);
      // A simulator outside Brazil must not silently become a Brazilian destination city.
      if (result && result.countryCode?.toLowerCase() !== "br") return null;
      if (result?.city) {
        cachedLocationContext = { city: result.city, uf: result.uf || "", country: "Brasil" };
        cachedOriginKey = originKey;
        return cachedLocationContext;
      }
    } catch (error) { console.warn("Não foi possível identificar a cidade pelo iPhone.", error.message); }
  }

  try {
    const data = await requestGeoapify({ operation: "reverse", origin });

    const address =
      data?.address || {};
    if (address.country_code?.toLowerCase() !== "br") return null;

    const city =
      address.city ||
      address.town ||
      address.municipality ||
      address.village ||
      address.county ||
      "";

    const isoCode =
      address[
        "ISO3166-2-lvl4"
      ] ||
      address[
        "ISO3166-2-lvl6"
      ] ||
      "";

    const uf =
      isoCode.includes("-")
        ? isoCode
            .split("-")
            .pop()
        : "";

    if (!city) {
      return null;
    }

    cachedLocationContext = {
      city,
      uf,
      state:
        address.state || "",
      country: "Brasil",
    };

    cachedOriginKey =
      originKey;

    return cachedLocationContext;
  } catch (error) {
    console.warn(
      "Não foi possível descobrir a cidade pelo GPS:",
      error
    );

    return null;
  }
}

function extractHouseNumber(
  original
) {
  const withoutCep =
    String(original || "")
      .replace(
        /\b\d{2}\.?\d{3}-?\d{3}\b/g,
        " "
      )
      .replace(
        /\bN[º°o.]?\s*(\d{1,6})\b/gi,
        " $1 "
      );

  const match =
    withoutCep.match(
      /(?:RUA|R\.?|AVENIDA|AV\.?|ALAMEDA|AL\.?|TRAVESSA|TV\.?|PRA[CÇ]A|RODOVIA|ROD\.?|ESTRADA|EST\.?)\s+[^,\n]{1,100}?,?\s+(\d{1,6})\b/i
    );

  if (match?.[1]) {
    return match[1];
  }

  const generic =
    withoutCep.match(
      /(?:^|,|\s)(\d{1,6})(?=\s|,|$)/
    );

  return generic?.[1] || "";
}

function cleanAddress(
  original
) {
  return String(
    original || ""
  )
    .replace(
      /\b(AP|APT|APTO|APARTAMENTO|SALA|BL|BLOCO)\s*[A-Z0-9-]+/gi,
      ""
    )
    .replace(
      /\b\d{2}\.?\d{3}-?\d{3}\b/g,
      ""
    )
    .replace(
      /\bN[º°o.]?\s*/gi,
      ""
    )
    .replace(
      /\s+-\s+/g,
      ", "
    )
    .replace(
      /\//g,
      ", "
    )
    .replace(
      /\s*,\s*/g,
      ", "
    )
    .replace(
      /,{2,}/g,
      ","
    )
    .replace(
      /\s+/g,
      " "
    )
    .replace(
      /^,|,$/g,
      ""
    )
    .trim();
}

function pushUniqueAttempt(
  attempts,
  value
) {
  const text =
    String(value || "")
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!text) return;

  const normalized =
    normalizeAddressKey(
      text
    );

  if (
    attempts.some(
      (item) =>
        normalizeAddressKey(
          item
        ) === normalized
    )
  ) {
    return;
  }

  attempts.push(text);
}

export async function geocodeAddress(
  address,
  options = {}
) {
  const original =
    String(
      address || ""
    ).trim();

  const currentContext = options.context || null;
  const currentOrigin = options.origin || null;

  if (!original) {
    throw new Error(
      "Endereço vazio."
    );
  }

  const cepMatch = original.match(/\b\d{2}\.?\d{3}-?\d{3}\b/);
  let destinationCep = null;
  // A CEP can identify another city even when the label omits city/UF.
  if (cepMatch && !explicitDestinationContext(original)) {
    try {
      const cep = cepMatch[0].replace(/\D/g, "");
      const response = await fetchWithTimeout(`https://viacep.com.br/ws/${cep}/json/`, {}, VIACEP_TIMEOUT_MS);
      if (response.ok) destinationCep = await response.json();
    } catch (error) { console.warn("Não foi possível identificar a cidade pelo CEP:", error.message); }
  }
  const { context, origin } = destinationSearch(original, currentContext, currentOrigin, destinationCep);

  const cached =
    getCachedGeocode(
      original,
      context,
      origin
    );

  if (cached && isVerifiedCoordinate(original, cached)) return cached;

  if (["android", "ios"].includes(Capacitor.getPlatform()) && context?.city && requestedAddress(original).number) {
    try {
      const query = destinationQuery(original, context);
      const precise = await searchNativeAddressQueries(original, query,
        (candidateQuery) => nativeAddress.geocode({ query: candidateQuery }),
        (results) => resolveNativeAddress(original, results, context, origin, async (cep) => {
          const response = await fetchWithTimeout(`https://viacep.com.br/ws/${cep}/json/`, {}, VIACEP_TIMEOUT_MS);
          return response.ok ? response.json() : null;
        })
      );
      if (precise) { saveCachedGeocode(original, context, precise); return precise; }
    } catch (error) { console.warn("Busca nativa indisponível; tentando a busca de endereços alternativa.", error.message); }
  }
  if (cached) return cached;

  const locationText =
    contextLabel(context);

  const numero =
    requestedAddress(original).number;

  const attempts = [];
  let viaCepAddress = "";
  // Sugestões aproximadas: mesma rua ou CEP. Não autorizam navegação sem confirmação.
  let streetResult = null;
  let cepResult = null;


  if (cepMatch) {
    const cep =
      cepMatch[0].replace(
        /\D/g,
        ""
      );

    try {
      const response =
        await fetchWithTimeout(
          `https://cep.awesomeapi.com.br/json/${cep}`,
          {},
          CEP_COORDS_TIMEOUT_MS
        );

      if (response.ok) {
        const cepData =
          await response.json();

        const coords = {
          lat: Number(cepData.lat),
          lng: Number(cepData.lng),
        };

        const sameCity =
          !context?.city ||
          normalizeText(cepData.city) ===
            normalizeText(context.city);

        const nearOrigin =
          !origin ||
          haversineKm(origin, coords) <=
            MAX_DISTANCE_KM;

        if (
          Number.isFinite(coords.lat) &&
          Number.isFinite(coords.lng) &&
          sameCity &&
          nearOrigin
        ) {
          const cepCoords = {
            ...coords,
            geocodePrecision: "cep",
            verifiedAddressKey: addressKey(original),
          };

          if (!numero) {
            saveCachedGeocode(original, context, cepCoords);
            return cepCoords;
          }

          // Com número de casa, tenta antes uma busca mais precisa; o CEP fica de reserva.
          cepResult = cepCoords;
        }
      }
    } catch (error) {
      console.warn(
        "Falha ao localizar pelo CEP:",
        error
      );
    }

    try {
      const response = destinationCep ? null :
        await fetchWithTimeout(
          `https://viacep.com.br/ws/${cep}/json/`,
          {},
          VIACEP_TIMEOUT_MS
        );

      if (destinationCep || response?.ok) {
        const dadosCep = destinationCep || await response.json();

        const sameCity =
          !context?.city ||
          normalizeText(
            dadosCep.localidade
          ) ===
            normalizeText(
              context.city
            );

        if (
          !dadosCep.erro &&
          dadosCep.logradouro &&
          sameCity
        ) {
          viaCepAddress =
            [
              dadosCep.logradouro,
              numero,
              dadosCep.bairro,
              dadosCep.localidade,
              dadosCep.uf,
              "Brasil",
            ]
              .filter(Boolean)
              .join(", ");

          pushUniqueAttempt(
            attempts,
            viaCepAddress
          );
        }
      }
    } catch (error) {
      console.warn(
        "Falha ao consultar CEP:",
        error
      );
    }
  }

  const cleaned = requestedAddress(original).number && context?.city
    ? destinationQuery(original, context)
    : cleanAddress(original);

  if (locationText) {
    const cityNormalized =
      normalizeText(
        context?.city
      );

    const cleanedNormalized =
      normalizeText(
        cleaned
      );

    if (
      cityNormalized &&
      cleanedNormalized.includes(
        cityNormalized
      )
    ) {
      pushUniqueAttempt(
        attempts,
        cleaned
      );
    } else {
      pushUniqueAttempt(
        attempts,
        `${cleaned}, ${locationText}`
      );
    }
  } else {
    pushUniqueAttempt(
      attempts,
      cleaned
    );
  }

  if (
    viaCepAddress &&
    numero
  ) {
    const streetFallback =
      viaCepAddress
        .split(",")
        .filter(
          (part) =>
            normalizeText(
              part
            ) !==
            normalizeText(
              numero
            )
        )
        .join(",")
        .replace(
          /\s+/g,
          " "
        )
        .trim();

    pushUniqueAttempt(
      attempts,
      streetFallback
    );
  }

  for (
    const query of attempts
  ) {
    try {
      const data = await requestGeoapify({ operation: "search", text: query, origin });

      if (!data?.length) {
        continue;
      }

      let validItems =
        context?.city
          ? data.filter(
              (item) =>
                belongsToCurrentCity(
                  item,
                  context
                )
            )
          : data;

      // Rua e número conferidos. Pontos de rua ficam apenas como sugestão aproximada.
      const exactItems = numero
        ? validItems.filter((item) => matchesHouse(original, item))
        : validItems.filter((item) => sameRoad(original, item));
      const exact = Boolean(numero) && exactItems.length > 0;
      const roadItems = numero && !exact
        ? validItems.filter((item) => sameRoad(original, item))
        : [];

      if (numero) {
        validItems = exact ? exactItems : roadItems;
      }

      let candidates =
        validItems
          .map((item) => ({
            geocodePrecision: exact ? "house" : roadItems.length || !numero ? "street" : "approx",
            houseNumber: item.address?.house_number || "",
            matchedRoad: item.address?.road || item.address?.pedestrian || item.address?.residential || item.address?.footway || "",
            verifiedAddressKey: addressKey(original),
            lat:
              Number(
                item.lat
              ),
            lng:
              Number(
                item.lon
              ),
            city:
              candidateCity(
                item
              ),
          }))
          .filter(
            (candidate) =>
              Number.isFinite(
                candidate.lat
              ) &&
              Number.isFinite(
                candidate.lng
              )
          );

      if (
        !candidates.length
      ) {
        continue;
      }

      let selected =
        candidates[0];

      if (origin) {
        candidates =
          candidates
            .map(
              (candidate) => ({
                ...candidate,
                distanceKm:
                  haversineKm(
                    origin,
                    candidate
                  ),
              })
            )
            .filter(
              (candidate) =>
                candidate.distanceKm <=
                MAX_DISTANCE_KM
            )
            .sort(
              (a, b) =>
                a.distanceKm -
                b.distanceKm
            );

        if (
          !candidates.length
        ) {
          continue;
        }

        selected =
          candidates[0];
      }

      const coords = {
        geocodePrecision: selected.geocodePrecision,
        houseNumber: selected.houseNumber,
        matchedRoad: selected.matchedRoad,
        verifiedAddressKey: selected.verifiedAddressKey,
        lat:
          selected.lat,
        lng:
          selected.lng,
      };

      if (numero && !exact) {
        // Sem o número no mapa: guarda este ponto e ainda tenta as outras buscas.
        if (coords.geocodePrecision === "street") {
          if (!streetResult) streetResult = coords;
        }
        continue;
      }

      saveCachedGeocode(
        original,
        context,
        coords
      );

      return coords;
    } catch (error) {
      console.warn(
        "Falha ao consultar o serviço de localização."
      );
    }
  }

  const approximate = streetResult || cepResult;

  if (approximate) {
    saveCachedGeocode(original, context, approximate);
    return approximate;
  }

  throw new Error(
    `Não foi possível localizar o endereço${context?.city ? " em " + context.city : ""}: ${original}`
  );
}
