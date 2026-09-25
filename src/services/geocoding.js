let cachedLocationContext = null;
let cachedOriginKey = "";

const MAX_DISTANCE_KM = 120;
const SEARCH_RADIUS_KM = 80;
const NOMINATIM_MIN_INTERVAL_MS = 1150;
const NOMINATIM_MAX_RETRIES = 1;
const NOMINATIM_TIMEOUT_MS = 8000;
const VIACEP_TIMEOUT_MS = 6000;
const CEP_COORDS_TIMEOUT_MS = 7000;
const GEOCODE_CACHE_KEY = "rota-certa-geocode-cache-v2";
const GEOCODE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let nominatimQueue = Promise.resolve();
let lastNominatimRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  if (!foundNames.length) return true;

  return foundNames.some(
    (found) =>
      found === expected ||
      found.includes(expected) ||
      expected.includes(found)
  );
}

function buildViewbox(origin) {
  if (!origin) return "";

  const latDelta = SEARCH_RADIUS_KM / 111;

  const lngDivisor =
    111 *
    Math.cos(
      (origin.lat * Math.PI) / 180
    );

  const lngDelta =
    SEARCH_RADIUS_KM /
    Math.max(
      Math.abs(lngDivisor),
      1
    );

  return [
    origin.lng - lngDelta,
    origin.lat + latDelta,
    origin.lng + lngDelta,
    origin.lat - latDelta,
  ].join(",");
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

  return `${normalizeAddressKey(
    address
  )}|${normalizeAddressKey(city)}`;
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

  const item = cache[key];

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
    lat: coords.lat,
    lng: coords.lng,
    savedAt: Date.now(),
  };

  writeCache(cache);
}

async function waitForNominatimSlot() {
  const elapsed =
    Date.now() -
    lastNominatimRequestAt;

  const waitMs =
    Math.max(
      0,
      NOMINATIM_MIN_INTERVAL_MS -
        elapsed
    );

  if (waitMs > 0) {
    await sleep(waitMs);
  }

  lastNominatimRequestAt =
    Date.now();
}

function enqueueNominatim(task) {
  const run =
    nominatimQueue.then(
      task,
      task
    );

  nominatimQueue =
    run.catch(() => {});

  return run;
}

async function fetchNominatimJson(
  url
) {
  return enqueueNominatim(
    async () => {
      let lastError = null;

      for (
        let attempt = 0;
        attempt <=
        NOMINATIM_MAX_RETRIES;
        attempt += 1
      ) {
        await waitForNominatimSlot();

        try {
          const response =
            await fetchWithTimeout(url, {
              headers: {
                "Accept-Language":
                  "pt-BR",
              },
            }, NOMINATIM_TIMEOUT_MS);

          if (response.ok) {
            return await response.json();
          }

          lastError =
            new Error(
              `Serviço de localização respondeu ${response.status}.`
            );

          if (
            ![
              429,
              502,
              503,
              504,
            ].includes(
              response.status
            )
          ) {
            throw lastError;
          }
        } catch (error) {
          lastError = error;
        }

        if (
          attempt <
          NOMINATIM_MAX_RETRIES
        ) {
          await sleep(
            1200 *
              (attempt + 1)
          );
        }
      }

      throw (
        lastError ||
        new Error(
          "Serviço de localização indisponível."
        )
      );
    }
  );
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

  try {
    const params =
      new URLSearchParams({
        format: "jsonv2",
        lat: String(
          origin.lat
        ),
        lon: String(
          origin.lng
        ),
        zoom: "14",
        addressdetails: "1",
        "accept-language":
          "pt-BR",
      });

    const data =
      await fetchNominatimJson(
        `https://nominatim.openstreetmap.org/reverse?${params.toString()}`
      );

    const address =
      data?.address || {};

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

  const {
    context = null,
    origin = null,
  } = options;

  if (!original) {
    throw new Error(
      "Endereço vazio."
    );
  }

  const cached =
    getCachedGeocode(
      original,
      context,
      origin
    );

  if (cached) {
    return cached;
  }

  const locationText =
    contextLabel(context);

  const cepMatch =
    original.match(
      /\b\d{2}\.?\d{3}-?\d{3}\b/
    );

  const numero =
    extractHouseNumber(
      original
    );

  const attempts = [];
  let viaCepAddress = "";

  if (cepMatch) {
    const cep =
      cepMatch[0].replace(
        /\D/g,
        ""
      );

    // As planilhas da Shopee/SPX sempre trazem CEP. Esta consulta
    // devolve latitude e longitude diretamente e evita depender da
    // pesquisa textual, que pode bloquear chamadas feitas pelo navegador.
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
          saveCachedGeocode(
            original,
            context,
            coords
          );

          return coords;
        }
      }
    } catch (error) {
      console.warn(
        "Falha ao localizar pelo CEP:",
        error
      );
    }

    try {
      const response =
        await fetchWithTimeout(
          `https://viacep.com.br/ws/${cep}/json/`,
          {},
          VIACEP_TIMEOUT_MS
        );

      if (
        response.ok
      ) {
        const dadosCep =
          await response.json();

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

  const cleaned =
    cleanAddress(original);

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
      const params =
        new URLSearchParams({
          format: "jsonv2",
          limit: "8",
          countrycodes: "br",
          addressdetails: "1",
          "accept-language":
            "pt-BR",
          q: query,
        });

      if (origin) {
        params.set(
          "viewbox",
          buildViewbox(
            origin
          )
        );
      }

      const data =
        await fetchNominatimJson(
          `https://nominatim.openstreetmap.org/search?${params.toString()}`
        );

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

      if (
        !validItems.length &&
        origin
      ) {
        validItems = data;
      }

      let candidates =
        validItems
          .map((item) => ({
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
        lat:
          selected.lat,
        lng:
          selected.lng,
      };

      saveCachedGeocode(
        original,
        context,
        coords
      );

      return coords;
    } catch (error) {
      console.warn(
        "Falha ao localizar:",
        query,
        error
      );
    }
  }

  throw new Error(
    `Endereço não encontrado perto da sua localização: ${original}`
  );
}
