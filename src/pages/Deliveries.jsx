import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
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
import { fetchOptimizedTrip as fetchOptimizedTripService } from "../services/routing";

const DEFAULT_CENTER = [-18.9186, -48.2772];

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    address
  )}`;
}

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
export default function Deliveries({ deliveries, setDeliveries }) {
  const [deliverySearch, setDeliverySearch] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");

  const [origin, setOrigin] = useState(null);
  const [routeLine, setRouteLine] = useState([]);
  const [distance, setDistance] = useState(0);
  const [duration, setDuration] = useState(0);
  const [routeMessage, setRouteMessage] = useState("");
  const [routeBusy, setRouteBusy] = useState(false);
  const [routeReady, setRouteReady] = useState(false);
  const [showNavigationModal, setShowNavigationModal] = useState(false);

  const completed = deliveries.filter(
    (delivery) => delivery.completed
  ).length;

  const pendingDeliveries = deliveries.filter(
    (delivery) => !delivery.completed
  );

  const locatedDeliveries = pendingDeliveries.filter(
    (delivery) => delivery.coords
  );

  const deliveryFitPoints = routeLine.length
    ? routeLine
    : [
        ...locatedDeliveries.map((delivery) => [
          delivery.coords.lat,
          delivery.coords.lng,
        ]),
        ...(origin ? [[origin.lat, origin.lng]] : []),
      ];

  const query = deliverySearch.trim().toLowerCase();

  const filteredDeliveries = deliveries.filter((delivery) => {
    const matchesSearch =
      !query ||
      delivery.customer?.toLowerCase().includes(query) ||
      delivery.address?.toLowerCase().includes(query) ||
      delivery.phone?.toLowerCase().includes(query) ||
      delivery.notes?.toLowerCase().includes(query) ||
      String(delivery.id).toLowerCase().includes(query);

    const matchesStatus =
      deliveryFilter === "all" ||
      (deliveryFilter === "completed" && delivery.completed) ||
      (deliveryFilter === "pending" && !delivery.completed);

    const priority = delivery.priority || "normal";

    const matchesPriority =
      priorityFilter === "all" ||
      priority === priorityFilter;

    return matchesSearch && matchesStatus && matchesPriority;
  });

  function getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error("Localização não suportada neste aparelho.")
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
  async function optimizeDeliveriesRoute() {
  try {
    const pending = deliveries.filter(
      (delivery) => !delivery.completed
    );

    if (!pending.length) {
      alert("Não há entregas pendentes para otimizar.");
      return;
    }

    setRouteBusy(true);
    setRouteReady(false);
    setRouteMessage("📍 Obtendo sua localização...");

    const currentOrigin = await getCurrentLocation();
    setOrigin(currentOrigin);

    setRouteMessage("🔎 Localizando as entregas...");

    const updated = [...deliveries];

    for (let i = 0; i < updated.length; i += 1) {
      if (updated[i].completed || updated[i].coords) continue;

      try {
        updated[i] = {
          ...updated[i],
          coords: await geocodeAddressService(
            updated[i].address
          ),
        };
      } catch (error) {
        console.error(
          "Não foi possível localizar:",
          updated[i].address,
          error
        );
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 500)
      );
    }

    const located = updated.filter(
      (delivery) =>
        !delivery.completed && delivery.coords
    );

    if (located.length < 2) {
      throw new Error(
        "Não consegui localizar pelo menos duas entregas. Confira os endereços."
      );
    }

    setRouteMessage("⚡ Calculando a melhor rota...");

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
    setRouteMessage("✅ Melhor rota encontrada!");
  } catch (error) {
    console.error(error);
    setRouteReady(false);
    setRouteMessage(
      error?.message ||
        "Não foi possível otimizar a rota."
    );
  } finally {
    setRouteBusy(false);
  }
}
function startRoute() {
  if (!routeReady) {
    alert("Otimize a rota antes de começar.");
    return;
  }

  setShowNavigationModal(true);
}

function openGoogleMapsRoute() {
  const pending = deliveries.filter(
    (delivery) => !delivery.completed
  );

  if (!pending.length) {
    alert("Nenhuma entrega pendente.");
    return;
  }

  const pointValue = (delivery) =>
    delivery.coords
      ? `${delivery.coords.lat},${delivery.coords.lng}`
      : delivery.address;

  const originValue = origin
    ? `${origin.lat},${origin.lng}`
    : pointValue(pending[0]);

  const destination = pointValue(
    pending[pending.length - 1]
  );

  const waypoints = pending
    .slice(0, -1)
    .map(pointValue);

  let url =
    `https://www.google.com/maps/dir/?api=1` +
    `&travelmode=driving` +
    `&origin=${encodeURIComponent(originValue)}` +
    `&destination=${encodeURIComponent(destination)}`;

  if (waypoints.length) {
    url += `&waypoints=${encodeURIComponent(
      waypoints.join("|")
    )}`;
  }

  setShowNavigationModal(false);
  window.location.href = url;
}

function openWazeRoute() {
  const nextDelivery = deliveries.find(
    (delivery) => !delivery.completed
  );

  if (!nextDelivery) {
    alert("Nenhuma entrega pendente.");
    return;
  }

  const destination = nextDelivery.coords
    ? `${nextDelivery.coords.lat},${nextDelivery.coords.lng}`
    : nextDelivery.address;

  const url =
    `https://waze.com/ul?q=${encodeURIComponent(destination)}` +
    `&navigate=yes&utm_source=rota_certa_pro`;

  setShowNavigationModal(false);
  window.location.href = url;
}
return (
  <main className="page">
    <div className="page-title">
      <div>
        <span className="eyebrow">SUAS PARADAS</span>
        <h1>Entregas</h1>

        <div className="delivery-tools">
          <label className="delivery-search">
            <span>🔎</span>

            <input
              value={deliverySearch}
              onChange={(event) =>
                setDeliverySearch(event.target.value)
              }
              placeholder="Buscar por endereço, cliente, telefone ou código"
            />
          </label>

          <select
            value={deliveryFilter}
            onChange={(event) =>
              setDeliveryFilter(event.target.value)
            }
          >
            <option value="all">Todos os status</option>
            <option value="pending">Pendentes</option>
            <option value="completed">Concluídas</option>
          </select>

          <select
            value={priorityFilter}
            onChange={(event) =>
              setPriorityFilter(event.target.value)
            }
          >
            <option value="all">Todas as prioridades</option>
            <option value="urgent">Urgente</option>
            <option value="high">Alta</option>
            <option value="normal">Normal</option>
            <option value="low">Baixa</option>
          </select>
        </div>

        <p>
          {completed} concluídas de {deliveries.length}
        </p>
      </div>

      <NavLink className="mini-add" to="/nova-entrega">
        + Adicionar
      </NavLink>
    </div>

    {deliveries.length === 0 ? (
      <section className="empty-card premium-card">
        <div>📦</div>
        <h2>Nenhuma entrega</h2>
        <p>
          Cadastre sua primeira parada para montar a rota.
        </p>
        <NavLink to="/nova-entrega">
          Nova entrega
        </NavLink>
      </section>
    ) : filteredDeliveries.length === 0 ? (
      <section className="empty-card premium-card">
        <div>🔎</div>
        <h2>Nenhum resultado</h2>
        <p>Altere a busca ou os filtros.</p>
      </section>
    ) : (
      <section className="delivery-list">
        {filteredDeliveries.map((delivery, index) => (
          <article
            className={`delivery-card premium-card ${
              delivery.completed ? "completed" : ""
            }`}
            key={delivery.id}
          >
            <div className="delivery-number">
              {delivery.completed ? "✓" : index + 1}
            </div>

            <div className="delivery-content">
              <div className="delivery-title-row">
                <strong>
                  {delivery.customer ||
                    "Cliente não informado"}
                </strong>

                <span
                  className={`status-pill ${
                    delivery.completed ? "done" : ""
                  }`}
                >
                  {delivery.completed
                    ? "Entregue"
                    : "Pendente"}
                </span>
              </div>

              <p>{delivery.address}</p>

              {delivery.notes && (
                <small className="delivery-note">
                  📝 {delivery.notes}
                </small>
              )}

              <div className="delivery-actions">
                <button
                  onClick={() =>
                    window.open(
                      mapsUrl(delivery.address),
                      "_blank"
                    )
                  }
                >
                  🧭 Ir
                </button>

                <NavLink
                  className="edit-link"
                  to={`/editar-entrega/${delivery.id}`}
                >
                  ✏️ Editar
                </NavLink>

                <button
                  className="complete-button"
                  onClick={() =>
                    setDeliveries((list) =>
                      list.map((item) =>
                        item.id === delivery.id
                          ? {
                              ...item,
                              completed:
                                !item.completed,
                            }
                          : item
                      )
                    )
                  }
                >
                  {delivery.completed
                    ? "↩ Reabrir"
                    : "✓ Entregue"}
                </button>

                <button
                  className="danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Remover esta entrega?"
                      )
                    ) {
                      setDeliveries((list) =>
                        list.filter(
                          (item) =>
                            item.id !== delivery.id
                        )
                      );
                    }
                  }}
                >
                  Remover
                </button>
              </div>
            </div>
          </article>
        ))}
      </section>
    )}

    {deliveries.some(
      (delivery) => !delivery.completed
    ) && (
      <section
        style={{
          marginTop: 24,
          marginBottom: 24,
        }}
      >
        <button
          type="button"
          onClick={optimizeDeliveriesRoute}
          disabled={routeBusy}
          style={{
            width: "100%",
            padding: "18px 20px",
            borderRadius: 16,
            border: "none",
            fontSize: 18,
            fontWeight: 800,
            cursor: routeBusy ? "wait" : "pointer",
            background: "#2563eb",
            color: "white",
          }}
        >
          {routeBusy
            ? "⏳ Otimizando rota..."
            : routeReady
              ? "🔄 Recalcular rota"
              : "⚡ Otimizar rota"}
        </button>

        {routeMessage && (
          <p
            style={{
              marginTop: 12,
              textAlign: "center",
              fontWeight: 700,
            }}
          >
            {routeMessage}
          </p>
        )}
      </section>
    )}
        {routeReady && (
      <section
        style={{
          marginTop: 24,
          marginBottom: 24,
        }}
      >
        <h2 style={{ marginBottom: 14 }}>
          🗺️ Mapa da melhor rota
        </h2>

        <div
          style={{
            borderRadius: 18,
            overflow: "hidden",
          }}
        >
          <MapContainer
            center={DEFAULT_CENTER}
            zoom={12}
            className="leaflet-map"
            style={{
              width: "100%",
              height: "420px",
            }}
          >
            <TileLayer
              attribution="&copy; OpenStreetMap &copy; CARTO"
              url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
            />

            {origin && (
              <CircleMarker
                center={[origin.lat, origin.lng]}
                radius={10}
                pathOptions={{
                  color: "#22c55e",
                  fillColor: "#22c55e",
                  fillOpacity: 1,
                }}
              >
                <Popup>📍 Você está aqui</Popup>
              </CircleMarker>
            )}

            {locatedDeliveries.map(
              (delivery, index) => (
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
              )
            )}

            {routeLine.length > 1 && (
              <Polyline
                positions={routeLine}
                pathOptions={{
                  color: "#2563eb",
                  weight: 7,
                }}
              />
            )}

            <FitMap points={deliveryFitPoints} />
          </MapContainer>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            justifyContent: "space-around",
            marginTop: 14,
            padding: 16,
            borderRadius: 16,
            background: "rgba(15, 23, 42, 0.75)",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <strong>{locatedDeliveries.length}</strong>
            <div>paradas</div>
          </div>

          <div style={{ textAlign: "center" }}>
            <strong>
              {distance
                ? `${distance.toFixed(1)} km`
                : "—"}
            </strong>
            <div>distância</div>
          </div>

          <div style={{ textAlign: "center" }}>
            <strong>
              {duration
                ? `${Math.round(duration)} min`
                : "—"}
            </strong>
            <div>tempo</div>
          </div>
        </div>

        <button
          type="button"
          onClick={startRoute}
          style={{
            width: "100%",
            marginTop: 18,
            padding: "20px 22px",
            borderRadius: 18,
            border: "none",
            fontSize: 19,
            fontWeight: 900,
            cursor: "pointer",
            background: "#22c55e",
            color: "#052e16",
          }}
        >
          🚚 COMEÇAR ROTA
        </button>
      </section>
    )}

    {showNavigationModal && (
      <div
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setShowNavigationModal(false);
          }
        }}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.65)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          zIndex: 9999,
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 420,
            background: "#0f172a",
            borderRadius: 22,
            padding: 24,
            color: "white",
          }}
        >
          <div
            style={{
              fontSize: 42,
              textAlign: "center",
              marginBottom: 10,
            }}
          >
            🚚
          </div>

          <h2 style={{ textAlign: "center" }}>
            Começar rota
          </h2>

          <p
            style={{
              textAlign: "center",
              opacity: 0.75,
              marginBottom: 22,
            }}
          >
            Escolha como deseja navegar.
          </p>

          <button
            type="button"
            onClick={openWazeRoute}
            style={{
              width: "100%",
              padding: 18,
              marginBottom: 12,
              borderRadius: 16,
              border: "none",
              fontSize: 17,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🚙 Abrir no Waze
          </button>

          <button
            type="button"
            onClick={openGoogleMapsRoute}
            style={{
              width: "100%",
              padding: 18,
              marginBottom: 12,
              borderRadius: 16,
              border: "none",
              fontSize: 17,
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            🗺️ Abrir no Google Maps
          </button>

          <button
            type="button"
            onClick={() =>
              setShowNavigationModal(false)
            }
            style={{
              width: "100%",
              padding: 14,
              borderRadius: 14,
              border: "1px solid #475569",
              background: "transparent",
              color: "white",
              fontSize: 16,
              cursor: "pointer",
            }}
          >
            Cancelar
          </button>
        </div>
      </div>
    )}
  </main>
);
}