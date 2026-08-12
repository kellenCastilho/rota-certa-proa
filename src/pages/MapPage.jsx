import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";

import { geocodeAddress as geocodeAddressService } from "../services/geocoding";
import {
  fetchRoadRoute as fetchRoadRouteService,
  fetchOptimizedTrip as fetchOptimizedTripService,
} from "../services/routing";

const DEFAULT_CENTER = [-18.9186, -48.2772];

function numberedMarkerIcon(number, isNext) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: ${isNext ? "#ef4444" : "#2563eb"};
        color: white;
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        font-weight: 800;
      ">
        ${number}
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -23],
  });
}

function FitMap({ points }) {
  const map = useMap();

  useEffect(() => {
    if (points.length) {
      map.fitBounds(points, {
        padding: [35, 35],
        maxZoom: 15,
      });
    }
  }, [map, points]);

  return null;
}

function routeUrl(deliveries) {
  const pending = deliveries.filter(
    (delivery) => !delivery.completed
  );

  if (!pending.length) return "";

  const pointValue = (delivery) =>
    delivery.coords
      ? `${delivery.coords.lat},${delivery.coords.lng}`
      : delivery.address;

  const origin = pointValue(pending[0]);
  const destination = pointValue(
    pending[pending.length - 1]
  );

  const middle = pending
    .slice(1, -1)
    .map(pointValue);

  let url =
    `https://www.google.com/maps/dir/?api=1` +
    `&travelmode=driving` +
    `&origin=${encodeURIComponent(origin)}` +
    `&destination=${encodeURIComponent(destination)}`;

  if (middle.length) {
    url += `&waypoints=${encodeURIComponent(
      middle.join("|")
    )}`;
  }

  return url;
}export default function MapPage({ deliveries, setDeliveries }) {
  const pending = useMemo(
    () => deliveries.filter((delivery) => !delivery.completed),
    [deliveries]
  );

  const nextDelivery = pending[0];

  const [origin, setOrigin] = useState(null);
  const [routeLine, setRouteLine] = useState([]);
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [showNavigationModal, setShowNavigationModal] =
    useState(false);
  const [routeReady, setRouteReady] = useState(false);

  const located = useMemo(
    () => pending.filter((delivery) => delivery.coords),
    [pending]
  );

  const fitPoints = useMemo(() => {
    const points = located.map((delivery) => [
      delivery.coords.lat,
      delivery.coords.lng,
    ]);

    if (origin) {
      points.push([origin.lat, origin.lng]);
    }

    return routeLine.length ? routeLine : points;
  }, [located, origin, routeLine]);

  function getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            "Localização não suportada neste aparelho."
          )
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          reject(
            new Error(
              "Não foi possível obter sua localização. Permita o acesso ao GPS."
            )
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
        }
      );
    });
  }

  async function prepareRoute() {
    try {
      if (!pending.length) {
        alert("Cadastre pelo menos uma entrega.");
        return;
      }

      setBusy(true);
      setRouteReady(false);
      setMessage("📍 Obtendo sua localização...");

      const currentOrigin =
        await getCurrentLocation();

      setOrigin(currentOrigin);

      setMessage("🔎 Localizando as entregas...");

      const updated = [...deliveries];

      for (let i = 0; i < updated.length; i += 1) {
        if (
          updated[i].completed ||
          updated[i].coords
        ) {
          continue;
        }

        try {
          updated[i] = {
            ...updated[i],
            coords: await geocodeAddressService(
              updated[i].address
            ),
          };
        } catch {
          console.warn(
            "Não foi possível localizar:",
            updated[i].address
          );
        }

        await new Promise((resolve) =>
          setTimeout(resolve, 500)
        );
      }

      const locatedDeliveries = updated.filter(
        (delivery) =>
          !delivery.completed && delivery.coords
      );

      if (!locatedDeliveries.length) {
        throw new Error(
          "Não consegui localizar nenhuma entrega. Confira os endereços."
        );
      }

      if (locatedDeliveries.length === 1) {
        setMessage("🛣️ Montando sua rota...");

        const route =
          await fetchRoadRouteService([
            currentOrigin,
            locatedDeliveries[0].coords,
          ]);

        setDeliveries(updated);
        setRouteLine(route.line);
        setDistance(route.distanceKm);
        setDuration(route.durationMin);

        setRouteReady(true);
        setMessage("✅ Rota pronta!");
        return;
      }

      setMessage(
        "⚡ Organizando a melhor rota..."
      );

      const result =
        await fetchOptimizedTripService(
          updated,
          currentOrigin
        );

      setDeliveries(result.deliveries);
      setRouteLine(result.line);
      setDistance(result.distanceKm);
      setDuration(result.durationMin);

      setRouteReady(true);

      setMessage(
        result.usedFallback
          ? "✅ Rota pronta no modo reserva."
          : "✅ Rota pronta!"
      );
    } catch (error) {
      console.error(
        "Erro ao preparar rota:",
        error
      );

      setRouteReady(false);

      setMessage(
        error?.message ||
          "Não foi possível preparar a rota."
      );
    } finally {
      setBusy(false);
    }
  }
  function openNavigationModal() {
  if (!pending.length) {
    alert("Cadastre uma entrega pendente.");
    return;
  }

  setShowNavigationModal(true);
}

function openGoogleMaps() {
  const url = routeUrl(pending);

  if (!url) {
    alert("Não foi possível montar a rota.");
    return;
  }

  setShowNavigationModal(false);
  window.location.href = url;
}

function openWaze() {
  const nextDelivery = pending[0];

  if (!nextDelivery) {
    alert("Nenhuma entrega pendente.");
    return;
  }

  const destination = nextDelivery.coords
    ? `${nextDelivery.coords.lat},${nextDelivery.coords.lng}`
    : nextDelivery.address;

  const url =
    `https://waze.com/ul?q=${encodeURIComponent(destination)}` +
    "&navigate=yes&utm_source=rota_certa_pro";

  setShowNavigationModal(false);
  window.location.href = url;
}

function completeNextDelivery() {
  const nextDelivery = pending[0];

  if (!nextDelivery) {
    alert("Nenhuma entrega pendente.");
    return;
  }

  setDeliveries((list) =>
    list.map((delivery) =>
      delivery.id === nextDelivery.id
        ? { ...delivery, completed: true }
        : delivery
    )
  );

  setShowNavigationModal(false);
  setRouteLine([]);
  setDistance(0);
  setDuration(0);
  setMessage("Entrega concluída com sucesso.");
}
  return (
    <main className="page map-page">
      <div className="page-title map-title">
        <div>
          <span className="eyebrow">ROTA INTELIGENTE</span>
          <h1>Mapa da rota</h1>
          <p>Localize, organize e abra a navegação.</p>
        </div>

        <div className="map-buttons">
          <button
            type="button"
            className="optimize-button"
            onClick={prepareRoute}
            disabled={busy || !pending.length}
          >
            {busy
              ? "⏳ Preparando rota..."
              : routeReady
                ? "🔄 Recalcular rota"
                : "⚡ Preparar rota"}
          </button>
        </div>
      </div>

      {message && (
        <div className="map-message">
          {busy && <span className="spinner" />}
          {message}
        </div>
      )}

      <section className="map-card premium-card">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={12}
          className="leaflet-map"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />

          {origin && (
            <CircleMarker
              center={[origin.lat, origin.lng]}
              radius={9}
              pathOptions={{
                color: "#22c55e",
                fillColor: "#22c55e",
                fillOpacity: 1,
              }}
            >
              <Popup>Você está aqui</Popup>
            </CircleMarker>
          )}

          {located.map((delivery, index) => (
            <Marker
              key={delivery.id}
              position={[
                delivery.coords.lat,
                delivery.coords.lng,
              ]}
              icon={numberedMarkerIcon(
                index + 1,
                index === 0
              )}
            >
              <Popup>
                <strong>
                  {index + 1}.{" "}
                  {delivery.customer || "Entrega"}
                </strong>

                <br />

                {delivery.address}
              </Popup>
            </Marker>
          ))}

          {routeLine.length > 1 && (
            <Polyline
              positions={routeLine}
              pathOptions={{
                color: "#2563eb",
                weight: 7,
              }}
            />
          )}

          <FitMap points={fitPoints} />
        </MapContainer>
      </section>

      <section className="map-summary premium-card">
        <div>
          <strong>{located.length}</strong>
          <span>paradas localizadas</span>
        </div>

        <div>
          <strong>
            {distance
              ? `${distance.toFixed(1)} km`
              : "—"}
          </strong>
          <span>distância estimada</span>
        </div>

        <div>
          <strong>
            {duration
              ? `${Math.round(duration)} min`
              : "—"}
          </strong>
          <span>tempo estimado</span>
        </div>

        <button
          type="button"
          onClick={openNavigationModal}
          disabled={
            !routeReady ||
            busy ||
            !pending.length
          }
        >
          🚚 Iniciar rota
        </button>
      </section>

      {showNavigationModal && (
        <div
          className="navigation-modal-overlay"
          role="presentation"
          onClick={(event) => {
            if (
              event.target === event.currentTarget
            ) {
              setShowNavigationModal(false);
            }
          }}
        >
          <section
            className="navigation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="navigation-modal-title"
          >
            <button
              type="button"
              className="navigation-modal-close"
              onClick={() =>
                setShowNavigationModal(false)
              }
              aria-label="Fechar"
            >
              ×
            </button>

            <div className="navigation-modal-icon">
              🚚
            </div>

            <h2 id="navigation-modal-title">
              Iniciar navegação
            </h2>

            <p>
              Escolha o aplicativo que deseja usar.
            </p>

            {nextDelivery && (
              <div className="navigation-next-stop">
                <span>📍 PRÓXIMA PARADA</span>

                <strong>
                  {nextDelivery.customer ||
                    "Cliente não informado"}
                </strong>

                <small>
                  {nextDelivery.address ||
                    "Endereço não informado"}
                </small>
              </div>
            )}

            <div className="navigation-app-buttons">
              <button
                type="button"
                className="google-maps-button"
                onClick={openGoogleMaps}
              >
                <span>🗺️</span>
                <div>
                  <strong>Google Maps</strong>
                  <small>
                    Rota com todas as paradas
                  </small>
                </div>
              </button>

              <button
                type="button"
                className="waze-button"
                onClick={openWaze}
              >
                <span>🚙</span>
                <div>
                  <strong>Waze</strong>
                  <small>
                    Navegar para a próxima parada
                  </small>
                </div>
              </button>
            </div>

            <button
              type="button"
              className="navigation-option success"
              onClick={completeNextDelivery}
            >
              ✅ Concluir entrega
            </button>

            <button
              type="button"
              className="navigation-cancel-button"
              onClick={() =>
                setShowNavigationModal(false)
              }
            >
              Cancelar
            </button>
          </section>
        </div>
      )}
    </main>
  );
}