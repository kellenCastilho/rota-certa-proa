export async function fetchRoadRoute(points) {
  if (points.length < 2) {
    throw new Error("São necessários pelo menos 2 pontos.");
  }

  const coords = points
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");

  const url =
    `https://router.project-osrm.org/route/v1/driving/${coords}` +
    `?overview=full&geometries=geojson&steps=false`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Serviço de rota indisponível.");
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error("Rota não encontrada.");
  }

  const route = data.routes[0];

  return {
    line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
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
  const optimizedDeliveries = optimizeLocally(deliveries, origin);

  const pending = optimizedDeliveries.filter(
    (delivery) => !delivery.completed && delivery.coords
  );

  const points = [
    ...(origin ? [origin] : []),
    ...pending.map((delivery) => delivery.coords),
  ];

  try {
    const route = await fetchRoadRoute(points);

    return {
      deliveries: optimizedDeliveries,
      ...route,
      usedFallback: false,
    };
  } catch {
    const line = points.map((point) => [point.lat, point.lng]);

    let distanceKm = 0;

    for (let i = 0; i < points.length - 1; i += 1) {
      distanceKm += haversineKm(points[i], points[i + 1]);
    }

    return {
      deliveries: optimizedDeliveries,
      line,
      distanceKm,
      durationMin: (distanceKm / 30) * 60,
      usedFallback: true,
    };
  }
}