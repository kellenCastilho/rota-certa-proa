import { groupDeliveryStops, expandDeliveryStops } from "./deliveryStops";

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 15000
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
  } finally {
    clearTimeout(timeoutId);
  }
}

// No app Android os arquivos ficam dentro do aparelho; por isso a API precisa de um endereço
// completo (ex.: VITE_API_BASE=https://seu-projeto.vercel.app). No site (Vercel) fica vazio.
const API_BASE = String(import.meta.env?.VITE_API_BASE || "").replace(/\/+$/, "");

// Servidores OSRM compatíveis: se o principal recusar (ex.: 403/429) ou cair, tenta o reserva.
const OSRM_ROUTE_HOSTS = [
  "https://router.project-osrm.org/route/v1/driving/",
  "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
];

async function fetchOsrmRoute(coords, query, timeoutMs = 15000) {
  let lastError = new Error("Serviço de rota indisponível.");

  for (const host of OSRM_ROUTE_HOSTS) {
    try {
      const response = await fetchWithTimeout(
        `${host}${coords}?${query}`,
        {},
        timeoutMs
      );

      if (!response.ok) {
        lastError = new Error(`Serviço de rota indisponível (HTTP ${response.status}).`);
        continue;
      }

      const data = await response.json();

      if (data.code !== "Ok" || !data.routes?.length) {
        lastError = new Error("Rota não encontrada.");
        continue;
      }

      return data;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function fetchRoadRouteChunk(points) {
  if (points.length < 2) {
    throw new Error("São necessários pelo menos 2 pontos.");
  }

  const coords = points
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");

  const data = await fetchOsrmRoute(
    coords,
    "overview=full&geometries=geojson&steps=false"
  );

  const route = data.routes[0];

  return {
    line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  };
}

export async function fetchNavigationRoute(origin, destination) {
  const coords = `${origin.lng},${origin.lat};${destination.lng},${destination.lat}`;
  const data = await fetchOsrmRoute(
    coords,
    "overview=full&geometries=geojson&steps=true&alternatives=false"
  );
  const route = data.routes[0];

  const steps = (route.legs?.[0]?.steps || []).map((step) => ({
    distanceMeters: step.distance,
    durationSeconds: step.duration,
    streetName: step.name || "próxima via",
    maneuver: step.maneuver?.type || "continue",
    modifier: step.maneuver?.modifier || "straight",
    location: step.maneuver?.location
      ? {
          lng: step.maneuver.location[0],
          lat: step.maneuver.location[1],
        }
      : null,
  }));

  return {
    line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
    steps,
  };
}

export async function fetchRoadRoute(points) {
  if (points.length < 2) {
    throw new Error("São necessários pelo menos 2 pontos.");
  }

  // Divide rotas grandes para não depender do limite de pontos de uma
  // única chamada. O último ponto de um trecho é repetido no próximo,
  // preservando uma linha contínua mesmo com até 200 entregas.
  const MAX_POINTS_PER_CHUNK = 50;

  if (points.length <= MAX_POINTS_PER_CHUNK) {
    return fetchRoadRouteChunk(points);
  }

  const line = [];
  let distanceKm = 0;
  let durationMin = 0;

  for (
    let start = 0;
    start < points.length - 1;
    start += MAX_POINTS_PER_CHUNK - 1
  ) {
    const chunk = points.slice(
      start,
      Math.min(start + MAX_POINTS_PER_CHUNK, points.length)
    );

    const result = await fetchRoadRouteChunk(chunk);

    line.push(
      ...(line.length ? result.line.slice(1) : result.line)
    );
    distanceKm += result.distanceKm;
    durationMin += result.durationMin;
  }

  return {
    line,
    distanceKm,
    durationMin,
  };
}
function haversineKm(a, b) {
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
function optimizeLocally(deliveries, origin) {
  const pending = deliveries.filter(
    (delivery) => !delivery.completed && delivery.coords
  );

  const withoutCoords = deliveries.filter(
    (delivery) => !delivery.completed && !delivery.coords
  );

  const completed = deliveries.filter(
    (delivery) => delivery.completed
  );

  if (pending.length < 2) {
    throw new Error("Localize pelo menos 2 entregas.");
  }

  const remaining = [...pending];
  const ordered = [];
  let current;

  if (origin) {
    current = origin;
  } else {
    const first = remaining.shift();
    ordered.push(first);
    current = first.coords;
  }

  while (remaining.length) {
    let bestIndex = 0;
    let bestDistance = Infinity;

    remaining.forEach((delivery, index) => {
      const distance = haversineKm(current, delivery.coords);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const next = remaining.splice(bestIndex, 1)[0];
    ordered.push(next);
    current = next.coords;
  }

  return [...ordered, ...withoutCoords, ...completed];
}

export async function fetchOptimizedTrip(deliveries, origin) {
  const groups = groupDeliveryStops(deliveries.filter((delivery) => !delivery.completed && delivery.coords));
  const representatives = groups.map((group) => group.representative);
  const remainder = deliveries.filter((delivery) => delivery.completed || !delivery.coords);
  if (representatives.length === 1) {
    const points = [...(origin ? [origin] : []), representatives[0].coords];
    let route = { line: points.map((point) => [point.lat, point.lng]), distanceKm: 0, durationMin: 0 };
    if (origin) {
      try { route = await fetchRoadRoute(points); }
      catch {
        const distanceKm = haversineKm(origin, representatives[0].coords);
        route = { ...route, distanceKm, durationMin: distanceKm / 30 * 60, usedFallback: true, straightLine: true };
      }
    }
    return { ...route, deliveries: [...groups[0].deliveries, ...remainder], optimizationEngine: "single-stop" };
  }
  const result = await fetchOptimizedStops([...representatives, ...remainder], origin);
  return { ...result, deliveries: expandDeliveryStops(result.deliveries, groups) };
}

async function fetchOptimizedStops(deliveries, origin) {
  let optimizedDeliveries;
  let optimizationEngine = "ortools-osrm";
  let optimizationFallback = false;

  try {
    if (!origin) {
      throw new Error("Localização inicial não disponível.");
    }

    const pendingWithCoords = deliveries.filter(
      (delivery) =>
        !delivery.completed &&
        delivery.coords
    );

    if (pendingWithCoords.length < 2) {
      throw new Error(
        "Localize pelo menos 2 entregas."
      );
    }

    // A matriz viária pública usada pelo servidor é ideal para rotas
    // menores. Acima de 50 paradas usamos a otimização local, que não
    // possui o limite do Google Maps ou Waze e suporta rotas grandes.
    if (pendingWithCoords.length > 50) {
      optimizedDeliveries = optimizeLocally(deliveries, origin);
      optimizationEngine = "local-large-route";
      optimizationFallback = true;
    } else {

      const response = await fetchWithTimeout(
        `${API_BASE}/api/otimizar-rota-local`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            origin,
            deliveries: pendingWithCoords,
          }),
        },
        20000
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Não foi possível otimizar a rota."
        );
      }

      const deliveryById = new Map(
        pendingWithCoords.map((delivery) => [
          String(delivery.id),
          delivery,
        ])
      );

      const ordered = (
        data.orderedDeliveryIds || []
      )
        .map((id) =>
          deliveryById.get(String(id))
        )
        .filter(Boolean);

      const orderedIds = new Set(
        ordered.map((delivery) =>
          String(delivery.id)
        )
      );

      const missing = pendingWithCoords.filter(
        (delivery) =>
          !orderedIds.has(String(delivery.id))
      )

      const withoutCoords = deliveries.filter(
        (delivery) =>
          !delivery.completed &&
          !delivery.coords
      );

      const completed = deliveries.filter(
        (delivery) => delivery.completed
      );

      optimizedDeliveries = [
        ...ordered,
        ...missing,
        ...withoutCoords,
        ...completed,
      ];

      optimizationEngine =
        data.engine || "ortools-osrm";
    }
  } catch (error) {
    console.warn(
      "OR-Tools indisponível. Usando otimização local:",
      error
    );

    optimizedDeliveries =
      optimizeLocally(deliveries, origin);

    optimizationEngine = "local-greedy";
    optimizationFallback = true;
  }

  const pending = optimizedDeliveries.filter(
    (delivery) =>
      !delivery.completed &&
      delivery.coords
  );

  const points = [
    ...(origin ? [origin] : []),
    ...pending.map(
      (delivery) => delivery.coords
    ),
  ];

  try {
    const route = await fetchRoadRoute(points);

    return {
      deliveries: optimizedDeliveries,
      ...route,
      usedFallback: optimizationFallback,
      optimizationEngine,
    };
  } catch {
    const line = points.map((point) => [
      point.lat,
      point.lng,
    ]);

    let distanceKm = 0;

    for (
      let i = 0;
      i < points.length - 1;
      i += 1
    ) {
      distanceKm += haversineKm(
        points[i],
        points[i + 1]
      );
    }

    return {
      deliveries: optimizedDeliveries,
      line,
      distanceKm,
      durationMin:
        (distanceKm / 30) * 60,
      usedFallback: true,
      straightLine: true,
      optimizationEngine,
    };
  }
}
