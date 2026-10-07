import { editDeliveryAddress, removeDeliveryById } from "../services/deliveryAddressEdit";
import { groupDeliveryStops } from "../services/deliveryStops";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  useNavigate,
  useSearchParams,
} from "react-router-dom";

import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";

import L from "leaflet";
import { addressKey, isVerifiedCoordinate } from "../services/addressPrecision.js";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { TextToSpeech } from "@capacitor-community/text-to-speech";

import {
  geocodeAddress as geocodeAddressService,
  getLocationContext,
  haversineKm,
} from "../services/geocoding";

import {
  fetchNavigationRoute,
  fetchRoadRoute as fetchRoadRouteService,
  fetchOptimizedTrip as fetchOptimizedTripService,
} from "../services/routing";

const NativeNavigation = registerPlugin("DaRotaNavigation");
const isNativeNavigation = ["android", "ios"].includes(Capacitor.getPlatform());

function maneuverInstruction(step) {
  if (!step) return { icon: "⬆️", text: "Siga pela rota indicada" };

  const street = step.streetName || "próxima via";
  const modifier = step.modifier;
  const type = step.maneuver;

  if (type === "arrive") return { icon: "🏁", text: "Você chegou à entrega" };
  if (type === "depart") return { icon: "⬆️", text: `Siga pela ${street}` };
  if (type === "roundabout" || type === "rotary") {
    return { icon: "🔄", text: `Entre na rotatória e siga para ${street}` };
  }
  if (modifier?.includes("uturn")) return { icon: "↩️", text: "Faça o retorno" };
  if (modifier?.includes("left")) return { icon: "⬅️", text: `Vire à esquerda na ${street}` };
  if (modifier?.includes("right")) return { icon: "➡️", text: `Vire à direita na ${street}` };
  return { icon: "⬆️", text: `Siga em frente pela ${street}` };
}

function distanceLabel(meters) {
  if (!Number.isFinite(meters)) return "";
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

const DEFAULT_CENTER = [
  -18.9186,
  -48.2772,
];

const ROUTE_CODES_KEY =
  "rota-certa-route-codes";

function readSavedRouteCodes() {
  try {
    return JSON.parse(
      localStorage.getItem(
        ROUTE_CODES_KEY
      ) || "{}"
    );
  } catch {
    return {};
  }
}

function saveRouteCodes(
  deliveries
) {
  const codes = {};

  deliveries.forEach(
    (delivery) => {
      if (
        !delivery.completed &&
        delivery.routeCode
      ) {
        codes[delivery.id] =
          delivery.routeCode;
      }
    }
  );

  if (
    Object.keys(codes)
      .length
  ) {
    localStorage.setItem(
      ROUTE_CODES_KEY,
      JSON.stringify(codes)
    );
  } else {
    localStorage.removeItem(
      ROUTE_CODES_KEY
    );
  }
}

function restoreRouteCodes(
  deliveries
) {
  const saved =
    readSavedRouteCodes();

  return deliveries.map(
    (delivery) => {
      if (
        delivery.routeCode ||
        !saved[delivery.id]
      ) {
        return delivery;
      }

      return {
        ...delivery,

        routeCode:
          saved[
            delivery.id
          ],
      };
    }
  );
}

function assignRouteCodes(
  deliveries
) {
  let routeNumber = 0;

  const result =
    deliveries.map(
      (delivery) => {
        if (
          delivery.completed
        ) {
          return delivery;
        }

        routeNumber += 1;

        return {
          ...delivery,

          routeCode:
            `A${routeNumber}`,
        };
      }
    );

  saveRouteCodes(result);

  return result;
}

function routeMarkerIcon(
  label,
  isNext
) {
  return L.divIcon({
    className: "",

    html: `
      <div style="
        width:42px;
        height:42px;
        border-radius:50%;
        background:${
          isNext
            ? "#ef4444"
            : "#2563eb"
        };
        color:white;
        border:3px solid white;
        box-shadow:0 4px 12px rgba(0,0,0,.35);
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:14px;
        font-weight:900;
      ">
        ${label}
      </div>
    `,

    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [
      0,
      -25,
    ],
  });
}

function FitMap({
  points,
}) {
  const map = useMap();

  useEffect(() => {
    if (
      points.length
    ) {
      map.fitBounds(
        points,
        {
          padding: [
            35,
            35,
          ],

          maxZoom:
            15,
        }
      );
    }
  }, [
    map,
    points,
  ]);

  return null;
}

function FollowDriver({ position, active }) {
  const map = useMap();

  useEffect(() => {
    if (!active || !position) return;

    map.setView(
      [position.lat, position.lng],
      Math.max(map.getZoom(), 17),
      { animate: true }
    );
  }, [map, position, active]);

  return null;
}

function pointValue(
  delivery
) {
  if (
    delivery.address
      ?.trim()
  ) {
    return delivery.address.trim();
  }

  if (
    delivery.coords
  ) {
    return `${delivery.coords.lat},${delivery.coords.lng}`;
  }

  return "";
}

function routeUrl(
  deliveries,
  currentOrigin
) {
  const pending =
    deliveries.filter(
      (delivery) =>
        !delivery.completed
    );

  if (
    !pending.length
  ) {
    return "";
  }

  const origin =
    currentOrigin
      ? `${currentOrigin.lat},${currentOrigin.lng}`
      : pointValue(
          pending[0]
        );

  const destination =
    pointValue(
      pending[
        pending.length -
          1
      ]
    );

  const middle =
    pending
      .slice(
        0,
        -1
      )
      .map(
        pointValue
      )
      .filter(Boolean);

  let url =
    `https://www.google.com/maps/dir/?api=1` +
    `&travelmode=driving` +
    `&origin=${encodeURIComponent(
      origin
    )}` +
    `&destination=${encodeURIComponent(
      destination
    )}`;

  if (
    middle.length
  ) {
    url +=
      `&waypoints=${encodeURIComponent(
        middle.join(
          "|"
        )
      )}`;
  }

  return url;
}
function routeCodeNumber(delivery) {
  const match = String(
    delivery?.routeCode || ""
  ).match(/(\d+)/);

  return match
    ? Number(match[1])
    : Number.MAX_SAFE_INTEGER;
}
function DeliveryPointPicker({ point, center, onPick }) {
  const map = useMapEvents({ click: (event) => onPick({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  useEffect(() => { map.setView([center.lat, center.lng], Math.max(16, map.getZoom())); }, [map, center.lat, center.lng]);
  useEffect(() => { if (point) map.panTo([point.lat, point.lng]); }, [map, point?.lat, point?.lng]);
  if (!point) return null;
  return <Marker position={[point.lat, point.lng]} icon={routeMarkerIcon("📍", true)} draggable
    eventHandlers={{ dragend: (event) => { const pos = event.target.getLatLng(); onPick({ lat: pos.lat, lng: pos.lng }); } }} />;
}

export default function MapPage({
  deliveries,
  setDeliveries,
}) {
  const navigate =
    useNavigate();

  const [
    searchParams,
  ] = useSearchParams();

  const autoPrepared =
    useRef(false);

  // ==========================================
  // 📁 FILTRO DA PASTA
  // ==========================================

  const rotaId =
    searchParams.get(
      "rota"
    );

  const rotaNome =
    searchParams.get(
      "nome"
    ) || "";

  const shouldAutoPrepare =
    searchParams.get(
      "auto"
    ) === "1";

  const shouldOpenNavigation =
    searchParams.get(
      "nav"
    ) === "1";

  const folderMode =
    Boolean(rotaId);

  const selectedDeliveryId = searchParams.get("entrega");

  function filterFolder(
    list
  ) {
    if (selectedDeliveryId) {
      return list.filter(
        (delivery) =>
          String(delivery.id) === selectedDeliveryId &&
          !delivery.completed
      );
    }

    // Modo pasta: mostra somente as entregas daquela pasta.
    if (rotaId) {
      return list.filter(
        (delivery) =>
          String(
            delivery.rotaId
          ) ===
          String(rotaId)
      );
    }

    // Mapa geral: mostra somente entregas avulsas, sem pasta.
    return list.filter(
      (delivery) =>
        !delivery.rotaId
    );
  }

  const routeDeliveries =
    useMemo(
      () =>
        filterFolder(
          deliveries
        ),
      [
        deliveries,
        rotaId,
        selectedDeliveryId,
      ]
    );

const pending =
  useMemo(
    () =>
      routeDeliveries
        .filter(
          (delivery) =>
            !delivery.completed
        )
        .sort(
          (a, b) =>
            routeCodeNumber(a) -
            routeCodeNumber(b)
        ),
    [
      routeDeliveries,
    ]
  );

  const [addressReviewReady, setAddressReviewReady] = useState(false);
  useEffect(() => { setAddressReviewReady(false); }, [rotaId, selectedDeliveryId]);
  const unlocatedDeliveries = pending.filter((delivery) => !isVerifiedCoordinate(delivery.address, delivery.coords));
  const confirmedDeliveries = pending.filter((delivery) => isVerifiedCoordinate(delivery.address, delivery.coords));

  const nextDelivery =
    pending[0];

  const deliveryStops = useMemo(() => groupDeliveryStops(pending), [pending]);
  const locatedStops = useMemo(() => groupDeliveryStops(pending.filter((delivery) => delivery.coords)), [pending]);
  const sharedStops = deliveryStops.filter((stop) => stop.deliveries.length > 1);

  const [
    origin,
    setOrigin,
  ] = useState(null);

  const [
    routeLine,
    setRouteLine,
  ] = useState([]);

  const [
    distance,
    setDistance,
  ] = useState(0);

  const [
    duration,
    setDuration,
  ] = useState(0);

  const [
    message,
    setMessage,
  ] = useState("");

  const [
    busy,
    setBusy,
  ] = useState(false);

  const [
    routeReady,
    setRouteReady,
  ] = useState(false);

  const [
    showNavigationModal,
    setShowNavigationModal,
  ] = useState(false);

  const [
    internalNavigationActive,
    setInternalNavigationActive,
  ] = useState(false);

  const [
    navigationMessage,
    setNavigationMessage,
  ] = useState("");

  const [navigationSteps, setNavigationSteps] = useState([]);
  const [navigationDistance, setNavigationDistance] = useState(0);
  const [navigationDuration, setNavigationDuration] = useState(0);
  const [currentLegStarted, setCurrentLegStarted] = useState(false);
  const navigationRefreshRef = useRef({ at: 0, position: null });
  const spokenInstructionRef = useRef("");
  const spokenStagesRef = useRef(new Set());
  const [nativeNavigation, setNativeNavigation] = useState(null);
  // Trecho até a próxima entrega (do GPS nativo). A rota completa otimizada continua em routeLine.
  const [legLine, setLegLine] = useState([]);
  const [pointCorrection, setPointCorrection] = useState(null);
  const [addressEditor, setAddressEditor] = useState(null);
  const [addressEditorError, setAddressEditorError] = useState("");

  useEffect(() => {
    if (!isNativeNavigation) return undefined;
    let disposed = false;
    let listener;
    function update(state) {
      if (disposed) return;
      setNativeNavigation(state);
      setInternalNavigationActive(Boolean(state.active));
      if (!state.active) { setCurrentLegStarted(false); setLegLine([]); return; }
      if (state.position) setOrigin(state.position);
      setLegLine(state.line?.length ? state.line : []);
      setNavigationMessage(state.message || "GPS ativo");
      setNavigationDistance(state.distanceKm || 0);
      setNavigationDuration(state.durationMinutes || 0);
    }
    const restore = () => { if (!document.hidden) NativeNavigation.getState().then(update).catch(console.warn); };
    NativeNavigation.addListener("navigationState", update).then((handle) => {
      if (disposed) handle.remove(); else listener = handle;
      restore();
    }).catch(console.warn);
    document.addEventListener("visibilitychange", restore);
    return () => { disposed = true; listener?.remove(); document.removeEventListener("visibilitychange", restore); };
  }, []);

  // Each completed delivery changes the native destination; no backend changes.
  useEffect(() => {
    if (!isNativeNavigation || !internalNavigationActive) return;
    if (!isVerifiedCoordinate(nextDelivery?.address, nextDelivery?.coords)) { void NativeNavigation.stop(); return; }
    if (nativeNavigation?.destinationId === String(nextDelivery.id)) return;
    void NativeNavigation.start({ destination: nextDelivery.coords, destinationId: String(nextDelivery.id) })
      .catch((error) => { setNavigationMessage(error.message); void NativeNavigation.stop(); });
  }, [internalNavigationActive, nextDelivery?.id, nextDelivery?.coords?.lat, nextDelivery?.coords?.lng, nativeNavigation?.destinationId]);

  const activeStep = useMemo(() => {
    if (!navigationSteps.length || !origin) return navigationSteps[0] || null;

    const upcoming = navigationSteps.find((step) => {
      if (!step.location) return false;
      return haversineKm(origin, step.location) * 1000 > 18;
    });

    return upcoming || navigationSteps[navigationSteps.length - 1];
  }, [navigationSteps, origin]);

  const metersToDelivery =
    origin && nextDelivery?.coords
      ? haversineKm(origin, nextDelivery.coords) * 1000
      : Infinity;

  const activeInstruction = useMemo(() => {
    if (isNativeNavigation && nativeNavigation?.active) {
      return { icon: nativeNavigation.icon || "⬆️", text: nativeNavigation.instruction };
    }
    if (metersToDelivery <= 35) {
      return { icon: "🏁", text: "Você chegou à entrega" };
    }

    if (activeStep?.maneuver === "arrive") {
      return {
        icon: "⬆️",
        text: `Continue até ${nextDelivery?.address || "a entrega"}`,
      };
    }

    return maneuverInstruction(activeStep);
  }, [activeStep, metersToDelivery, nextDelivery?.address, nativeNavigation]);

  function speakInstruction(text) {
    if (!text || spokenInstructionRef.current === text) return;
    spokenInstructionRef.current = text;

    if (Capacitor.isNativePlatform()) {
      TextToSpeech.stop()
        .catch(() => {})
        .then(() => TextToSpeech.speak({
          text,
          lang: "pt-BR",
          rate: 0.95,
          volume: 1,
        }))
        .catch((error) => {
          spokenInstructionRef.current = "";
          console.warn("Não foi possível falar a orientação:", error);
        });
      return;
    }

    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang = "pt-BR";
    speech.rate = 0.95;
    window.speechSynthesis.speak(speech);
  }

  async function refreshTurnByTurn(position, destination, announce = false) {
    if (!position || !destination?.coords) return;

    try {
      const guide = await fetchNavigationRoute(position, destination.coords);
      setRouteLine(guide.line);
      setNavigationSteps(guide.steps);
      setNavigationDistance(guide.distanceKm);
      setNavigationDuration(guide.durationMin);
      setNavigationMessage("📡 GPS ativo • orientação atualizada");

      if (announce) {
        const firstUseful = guide.steps.find((step) => step.maneuver !== "depart") || guide.steps[0];
        const instruction = maneuverInstruction(firstUseful);
        speakInstruction(`${instruction.text}. Em ${distanceLabel(firstUseful?.distanceMeters || 0)}.`);
      }
    } catch {
      setNavigationMessage("GPS ativo • tentando atualizar a orientação...");
    }
  }

  useEffect(() => {
    if (!internalNavigationActive || isNativeNavigation) return undefined;

    if (!navigator.geolocation) {
      setNavigationMessage("GPS não disponível neste aparelho.");
      setInternalNavigationActive(false);
      return undefined;
    }

    setNavigationMessage("📡 Acompanhando sua localização em tempo real");

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const currentPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };
        setOrigin(currentPosition);
        setNavigationMessage("📡 GPS ativo • siga a linha azul");

        const last = navigationRefreshRef.current;
        const movedMeters = last.position
          ? haversineKm(last.position, currentPosition) * 1000
          : Infinity;
        const enoughTime = Date.now() - last.at > 12000;

        if (nextDelivery?.coords && (movedMeters > 35 || enoughTime)) {
          navigationRefreshRef.current = { at: Date.now(), position: currentPosition };
          void refreshTurnByTurn(currentPosition, nextDelivery, false);
        }
      },
      () => {
        setNavigationMessage(
          "Não consegui acompanhar o GPS. Verifique a permissão de localização."
        );
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
      }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [internalNavigationActive, nextDelivery?.id]);

  useEffect(() => {
    if (!internalNavigationActive || isNativeNavigation || !activeStep) return;
    const metersToTurn = activeStep.location && origin
      ? haversineKm(origin, activeStep.location) * 1000
      : activeStep.distanceMeters;

    if (metersToTurn <= 250) {
      const stage = metersToTurn <= 30 ? 3 : metersToTurn <= 100 ? 2 : 1;
      const key = `${nextDelivery?.id}:${activeStep.location?.lat}:${activeStep.location?.lng}:${activeInstruction.text}:${stage}`;
      if (!spokenStagesRef.current.has(key)) {
        spokenStagesRef.current.add(key);
        speakInstruction(`${activeInstruction.text}. Em ${distanceLabel(metersToTurn)}.`);
      }
    }
  }, [internalNavigationActive, activeStep, activeInstruction.text, origin]);

  const located =
    useMemo(
      () =>
        pending.filter(
          (delivery) =>
            delivery.coords
        ),
      [pending]
    );

  const fitPoints =
    useMemo(() => {
      const points =
        located.map(
          (delivery) => [
            delivery.coords
              .lat,

            delivery.coords
              .lng,
          ]
        );

      if (origin) {
        points.push([
          origin.lat,
          origin.lng,
        ]);
      }

      return routeLine
        .length
        ? routeLine
        : points;
    }, [
      located,
      origin,
      routeLine,
    ]);

  function mergeIntoAll(
    updatedSubset
  ) {
    const byId =
      new Map(
        updatedSubset.map(
          (delivery) => [
            String(
              delivery.id
            ),

            delivery,
          ]
        )
      );

    setDeliveries(
      (current) =>
        current.map(
          (delivery) =>
            byId.get(
              String(
                delivery.id
              )
            ) ||
            delivery
        )
    );
  }

  function getCurrentLocation() {
    return new Promise(
      (
        resolve,
        reject
      ) => {
        if (
          !navigator.geolocation
        ) {
          reject(
            new Error(
              "Localização não suportada neste aparelho."
            )
          );

          return;
        }

        navigator.geolocation.getCurrentPosition(
          (
            position
          ) => {
            resolve({
              lat:
                position
                  .coords
                  .latitude,

              lng:
                position
                  .coords
                  .longitude,
              accuracy: position.coords.accuracy,
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
            enableHighAccuracy:
              true,

            timeout:
              10000,
          }
        );
      }
    );
  }

  async function prepareRoute(
    sourceList =
      deliveries,

    openNavigationAfter =
      false
  ) {
    try {
      const scoped =
        filterFolder(
          sourceList
        );

      const sourceWithCodes =
        restoreRouteCodes(
          scoped
        );

      const sourcePending =
        sourceWithCodes.filter(
          (delivery) =>
            !delivery.completed
        );

      if (
        !sourcePending.length
      ) {
        alert(
          folderMode
            ? `A pasta ${
                rotaNome ||
                ""
              } não possui entregas pendentes.`
            : "Cadastre pelo menos uma entrega."
        );

        return;
      }

      setBusy(true);

      setRouteReady(
        false
      );

      setMessage(
        "📍 Obtendo sua localização..."
      );

      const currentOrigin =
        await getCurrentLocation();

      setOrigin(
        currentOrigin
      );

      setMessage(
        "🔎 Preparando a localização das entregas..."
      );

      const locationContext =
        await getLocationContext(
          currentOrigin
        );

      const updated = [
        ...sourceWithCodes,
      ];

      const pendingTotal =
        updated.filter(
          (delivery) =>
            !delivery.completed
        ).length;

      let pendingPosition = 0;

      for (
        let i = 0;
        i <
        updated.length;
        i += 1
      ) {
        if (
          updated[i]
            .completed
        ) {
          continue;
        }

        pendingPosition += 1;

        setMessage(
          `🔎 Localizando entrega ${pendingPosition} de ${pendingTotal}...`
        );

        if (
          updated[i]
            .coords &&
          isVerifiedCoordinate(updated[i].address, updated[i].coords) &&
          haversineKm(
            currentOrigin,
            updated[i]
              .coords
          ) <= 150
        ) {
          continue;
        }

        updated[i] = { ...updated[i], coords: null };
        try {
          updated[i] = {
            ...updated[i],

            coords:
              await geocodeAddressService(
                updated[i]
                  .address,

                {
                  context:
                    locationContext,

                  origin:
                    currentOrigin,
                }
              ),
          };
        } catch (error) {
          updated[i] = { ...updated[i], geocodeError: error.message };
          console.warn(
            "Não foi possível localizar:",
            updated[i]
              .address
          );
        }

        await new Promise(
          (resolve) =>
            setTimeout(
              resolve,
              250
            )
        );
      }

      mergeIntoAll(assignRouteCodes(updated));
      setAddressReviewReady(true);
      const unconfirmed = updated.filter((delivery) => !delivery.completed && !isVerifiedCoordinate(delivery.address, delivery.coords));
      if (unconfirmed.length) {
        setRouteLine([]);
        throw new Error(`${unconfirmed.length} entrega(s) não localizada(s). Veja os endereços em destaque abaixo. Edite ou exclua e depois otimize novamente.`);
      }
      const stopCount = groupDeliveryStops(updated.filter((delivery) => !delivery.completed)).length;
      const notFoundNote = stopCount < pendingTotal ? ` • ${pendingTotal} entregas em ${stopCount} paradas. Pacotes do mesmo endereço ficam juntos.` : "";

      const locatedDeliveries =
        updated.filter(
          (delivery) =>
            !delivery.completed &&
            delivery.coords
        );

      if (
        !locatedDeliveries
          .length
      ) {
        throw new Error(
          "Não consegui localizar nenhuma entrega. Confira os endereços."
        );
      }

      // ======================================
      // SÓ UMA ENTREGA
      // ======================================

      if (
        locatedDeliveries
          .length === 1
      ) {
        setMessage(
          "🛣️ Montando sua rota..."
        );

        const route =
          await fetchRoadRouteService(
            [
              currentOrigin,

              locatedDeliveries[0]
                .coords,
            ]
          );

        const labeled =
          assignRouteCodes(
            updated
          );

        mergeIntoAll(
          labeled
        );

        setRouteLine(
          route.line
        );

        setDistance(
          route.distanceKm
        );

        setDuration(
          route.durationMin
        );

        setRouteReady(
          true
        );

        setMessage(
          "✅ Rota pronta!" + notFoundNote
        );

        if (
          openNavigationAfter
        ) {
          setShowNavigationModal(
            true
          );
        }

        return;
      }

      // ======================================
      // DUAS OU MAIS
      // ======================================

      setMessage(
        folderMode
          ? `⚡ Otimizando somente ${
              rotaNome ||
              "esta pasta"
            }...`
          : "⚡ Organizando a melhor rota..."
      );

      const result =
        await fetchOptimizedTripService(
          updated,
          currentOrigin
        );

      const labeled =
        assignRouteCodes(
          result.deliveries
        );

      mergeIntoAll(
        labeled
      );

      setRouteLine(
        result.line
      );

      setDistance(
        result.distanceKm
      );

      setDuration(
        result.durationMin
      );

      setRouteReady(
        true
      );

      setMessage(
        result.straightLine
          ? "⚠️ Ordem das entregas pronta, mas não consegui traçar o caminho pelas ruas agora. A linha azul é reta entre as paradas. A navegação calcula o caminho de cada trecho." + notFoundNote
          : result.usedFallback
          ? "✅ Rota otimizada e pronta!" + notFoundNote
          : "✅ Rota otimizada!" + notFoundNote
      );

      if (
        openNavigationAfter
      ) {
        setShowNavigationModal(
          true
        );
      }
    } catch (error) {
      console.error(
        "Erro ao preparar rota:",
        error
      );

      setRouteReady(
        false
      );

      setMessage(
        error?.message ||
          "Não foi possível preparar a rota."
      );
      if (openNavigationAfter) setShowNavigationModal(true);
    } finally {
      setBusy(false);
    }
  }

  // ==========================================
  // AUTOMÁTICO AO VIR DO SCANNER / PASTA
  // ==========================================

  useEffect(() => {
    if (
      shouldAutoPrepare &&
      !autoPrepared.current
    ) {
      autoPrepared.current =
        true;

      void prepareRoute(
        deliveries,
        shouldOpenNavigation
      );
    }
  }, []);

  function openNavigationModal() {
    if (
      !pending.length
    ) {
      alert(
        "Nenhuma entrega pendente."
      );

      return;
    }

    setShowNavigationModal(
      true
    );
  }

  async function startInternalNavigation() {
    if (pending.some((delivery) => !isVerifiedCoordinate(delivery.address, delivery.coords))) {
      alert("Há entregas sem destino confirmado. Confira a localização antes de navegar."); return;
    }
    if (!routeReady || !nextDelivery) {
      alert("Otimize a rota antes de iniciar a navegação.");
      return;
    }

    setNavigationMessage("📡 Iniciando o GPS...");
    navigationRefreshRef.current = { at: 0, position: null };
    spokenInstructionRef.current = "";
    spokenStagesRef.current.clear();
    if (isNativeNavigation) {
      try {
        if (!isVerifiedCoordinate(nextDelivery.address, nextDelivery.coords)) throw new Error("Não consegui localizar o endereço da próxima entrega. Use “Editar endereço” abaixo do mapa.");
        await NativeNavigation.start({ destination: nextDelivery.coords, destinationId: String(nextDelivery.id) });
        setShowNavigationModal(false);
        setCurrentLegStarted(true);
        // The service event enables navigation after it has actually started.
      } catch (error) { alert(error.message || "Não foi possível iniciar a navegação."); }
      return;
    }

    let currentPosition;

    try {
      // Exige uma leitura nova do GPS. Nunca usa a posição antiga para
      // decidir que o motorista chegou à entrega.
      currentPosition = await getCurrentLocation();
    } catch {
      setNavigationMessage("");
      alert(
        "Não consegui iniciar a rota porque a localização está bloqueada.\n\nNo navegador, toque no cadeado ao lado do endereço do site, permita Localização e tente novamente."
      );
      return;
    }

    setOrigin(currentPosition);
    setShowNavigationModal(false);
    setInternalNavigationActive(true);
    setCurrentLegStarted(false);
    await refreshTurnByTurn(currentPosition, nextDelivery, false);
  }

  async function beginCurrentLeg() {
    if (isNativeNavigation) { await NativeNavigation.repeat(); setCurrentLegStarted(true); return; }
    if (!origin || !nextDelivery) return;
    setCurrentLegStarted(true);
    await refreshTurnByTurn(origin, nextDelivery, true);
  }

  function stopInternalNavigation() {
    if (isNativeNavigation) void NativeNavigation.stop().catch(console.warn);
    setLegLine([]);
    setInternalNavigationActive(false);
    setNavigationMessage("");
    setNavigationSteps([]);
    setCurrentLegStarted(false);
    if (Capacitor.isNativePlatform()) {
      TextToSpeech.stop().catch((error) => console.warn("Não foi possível parar a voz:", error));
    } else {
      window.speechSynthesis?.cancel();
    }
  }

  function invalidateEditedRoute() {
    stopInternalNavigation();
    setRouteReady(false);
    setRouteLine([]);
    setDistance(0);
    setDuration(0);
    setShowNavigationModal(false);
    setPointCorrection(null);
  }

  function beginAddressEdit(delivery) {
    if (busy) return;
    setAddressEditor({ id: delivery.id, address: delivery.address || "" });
    setAddressEditorError("");
  }

  function saveAddressEdit(event) {
    event.preventDefault();
    if (busy || !addressEditor) return;
    const { id, address } = addressEditor;
    if (!address.trim()) { setAddressEditorError("Digite o endereço antes de salvar."); return; }
    invalidateEditedRoute();
    setDeliveries((current) => editDeliveryAddress(current, id, address));
    setAddressEditor(null);
    setAddressEditorError("");
    setMessage("✅ Endereço atualizado. Toque em Otimizar rota para localizar novamente.");
  }

  function deleteAddressDelivery(delivery) {
    if (busy || !window.confirm(`Excluir somente esta entrega?\n${delivery.routeCode || ""} • ${delivery.address}\n\nEla será removida da lista, não marcada como entregue.`)) return;
    invalidateEditedRoute();
    setDeliveries((current) => removeDeliveryById(current, delivery.id));
    setAddressEditor(null);
    setAddressEditorError("");
    setMessage("Entrega excluída. Toque em Otimizar rota para atualizar o caminho das restantes.");
  }

  function beginPointCorrection(delivery) {
    stopInternalNavigation();
    setRouteReady(false);
    setRouteLine([]);
    setDistance(0);
    setDuration(0);
    setPointCorrection({ id: delivery.id, address: delivery.address,
      center: delivery.coords || origin || { lat: DEFAULT_CENTER[0], lng: DEFAULT_CENTER[1] },
      point: isVerifiedCoordinate(delivery.address, delivery.coords) ? delivery.coords : null });
    setMessage("Destino ainda não confirmado. Sua posição atual é apenas a referência do mapa; toque no local da entrega para selecionar um destino.");
  }

  function confirmDeliveryPoint() {
    if (!pointCorrection?.point) { setMessage("Selecione o destino no mapa antes de confirmar."); return; }
    const correction = pointCorrection;
    const delivery = deliveries.find((item) => String(item.id) === String(correction.id));
    if (!delivery || addressKey(delivery.address) !== addressKey(correction.address)) {
      setPointCorrection(null); setMessage("O endereço mudou. Confira o ponto novamente."); return;
    }
    const coords = { lat: correction.point.lat, lng: correction.point.lng,
      geocodePrecision: "manual", verifiedAddressKey: addressKey(delivery.address) };
    if (!isVerifiedCoordinate(delivery.address, coords)) { setMessage("Ponto inválido. Selecione novamente."); return; }
    setDeliveries((current) => current.map((item) => String(item.id) === String(correction.id) ? { ...item, coords, geocodeError: "" } : item));
    setPointCorrection(null);
    setMessage("📍 Ponto confirmado por você. Toque em Otimizar rota para calcular o novo caminho.");
  }

  async function useCurrentDeliveryPoint() {
    try {
      const position = await getCurrentLocation();
      if (!Number.isFinite(position.accuracy) || position.accuracy > 30) { setMessage("Sinal de GPS impreciso. Aguarde em área aberta ou selecione o ponto no mapa."); return; }
      setPointCorrection((current) => current ? { ...current, point: position } : current);
    } catch { setMessage("Não consegui obter sua posição. Selecione o local no mapa."); }
  }

  function openGoogleMaps() {
    if (pending.some((delivery) => !isVerifiedCoordinate(delivery.address, delivery.coords))) {
      alert("Há entregas sem destino confirmado. Confira a localização antes de navegar."); return;
    }
    const url =
      routeUrl(
        pending,
        origin
      );

    if (!url) {
      alert(
        "Não foi possível montar a rota."
      );

      return;
    }

    setShowNavigationModal(
      false
    );

    window.location.href =
      url;
  }

  function openWaze() {
    if (pending.some((delivery) => !isVerifiedCoordinate(delivery.address, delivery.coords))) {
      alert("Há entregas sem destino confirmado. Confira a localização antes de navegar."); return;
    }
    const next =
      pending[0];

    if (!next) {
      alert(
        "Nenhuma entrega pendente."
      );

      return;
    }

    const destination =
      next.coords
        ? `${next.coords.lat},${next.coords.lng}`
        : next.address;

    const url =
      `https://waze.com/ul?q=${encodeURIComponent(
        destination
      )}` +
      "&navigate=yes&utm_source=rota_certa_pro";

    setShowNavigationModal(
      false
    );

    window.location.href =
      url;
  }

  function completeNextDelivery() {
    const next =
      pending[0];

    if (!next) {
      alert(
        "Nenhuma entrega pendente."
      );

      return;
    }

    const updatedAll =
      deliveries.map(
        (delivery) =>
          delivery.id ===
          next.id
            ? {
                ...delivery,
                completed:
                  true,
              }
            : delivery
      );

    setDeliveries(
      updatedAll
    );

    setShowNavigationModal(
      false
    );

    setRouteLine([]);

    setDistance(0);

    setDuration(0);

    setRouteReady(
      false
    );

    setCurrentLegStarted(false);

    const remainingFolder =
      filterFolder(
        updatedAll
      ).filter(
        (delivery) =>
          !delivery.completed
      );

    if (
      !remainingFolder
        .length
    ) {
      stopInternalNavigation();

      localStorage.removeItem(
        ROUTE_CODES_KEY
      );

      setMessage(
        folderMode
          ? `🎉 Todas as entregas de ${
              rotaNome ||
              "esta pasta"
            } foram concluídas!`
          : "🎉 Todas as entregas foram concluídas!"
      );

      return;
    }

    setMessage(
      "✅ Entrega concluída! Preparando a próxima..."
    );

    void prepareRoute(
      updatedAll,
      false
    );
  }

  function completeFolderRoute() {
    if (
      !folderMode ||
      !pending.length
    ) {
      return;
    }

    const routeLabel =
      rotaNome ||
      "este bairro";

    const confirmed =
      window.confirm(
        `Concluir todas as ${pending.length} entregas de ${routeLabel}?\n\nUse esta opção somente depois de terminar a rota do bairro.`
      );

    if (!confirmed) {
      return;
    }

    setDeliveries(
      (current) =>
        current.map(
          (delivery) =>
            String(
              delivery.rotaId
            ) ===
            String(rotaId)
              ? {
                  ...delivery,
                  completed:
                    true,
                }
              : delivery
        )
    );

    localStorage.removeItem(
      ROUTE_CODES_KEY
    );

    setShowNavigationModal(
      false
    );

    setInternalNavigationActive(
      false
    );

    setCurrentLegStarted(
      false
    );

    navigate(
      "/historico"
    );
  }

  function voltar() {
    if (
      folderMode
    ) {
      navigate(
        "/rotas"
      );
    } else {
      navigate("/");
    }
  }

  function renderAddressCard(delivery) {
    return (
<div key={delivery.id} style={{ padding: "10px 0", borderBottom: "1px solid #64748b" }}>
              <p><strong>{delivery.routeCode || "Entrega"}</strong> • {delivery.address}</p>
              <small>{!delivery.coords ? "⚠️ Endereço não localizado" : delivery.coords.geocodePrecision === "manual" ? "Ponto marcado por você" : delivery.coords.geocodePrecision === "house" ? "Número encontrado no mapa" : delivery.coords.geocodePrecision === "street" ? "Rua encontrada; número não localizado" : delivery.coords.geocodePrecision === "cep" ? "Região do CEP; número não localizado" : "Localização aproximada"}</small>
              {addressEditor && String(addressEditor.id) === String(delivery.id) ? (
                <form onSubmit={saveAddressEdit} style={{ marginTop: "12px" }}>
                  <label style={{ display: "block", marginBottom: "6px" }}>
                    Endereço completo
                    <textarea autoFocus required rows={4} value={addressEditor.address} disabled={busy}
                      onChange={(event) => { setAddressEditor({ ...addressEditor, address: event.target.value }); setAddressEditorError(""); }}
                      style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: "6px", padding: "12px", borderRadius: "12px", border: "1px solid var(--line)", background: "var(--panel-soft)", color: "var(--text)", resize: "vertical" }} />
                  </label>
                  <small>Mantenha apartamento ou bloco. Inclua cidade e estado para localizar o destino certo.</small>
                  {addressEditorError && <p role="alert">{addressEditorError}</p>}
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" }}>
                    <button type="submit" disabled={busy} className="primary-button" style={{ minHeight: "44px" }}>Salvar endereço</button>
                    <button type="button" disabled={busy} className="secondary-button" style={{ minHeight: "44px" }} onClick={() => { setAddressEditor(null); setAddressEditorError(""); }}>Cancelar</button>
                  </div>
                </form>
              ) : (
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "12px" }}>
                  <button type="button" disabled={busy} className="secondary-button" style={{ minHeight: "44px" }} onClick={() => beginAddressEdit(delivery)}>✏️ Editar endereço</button>
                  <button type="button" disabled={busy} style={{ minHeight: "44px", borderRadius: "12px", padding: "8px 14px", border: "1px solid var(--line)", background: "var(--panel-soft)", color: "#f87171" }} onClick={() => deleteAddressDelivery(delivery)}>Excluir entrega</button>
                </div>
              )}
            </div>
    );
  }

  return (
    <main className="page map-page">
      {folderMode && (
        <div
          style={{
            marginBottom:
              16,

            padding:
              "14px 16px",

            borderRadius:
              16,

            background:
              "rgba(37,99,235,.12)",

            border:
              "1px solid rgba(59,130,246,.45)",
          }}
        >
          <button
            type="button"
            onClick={
              voltar
            }
            style={{
              marginBottom:
                10,
            }}
          >
            ← Voltar
          </button>

          <div
            style={{
              fontSize:
                13,

              opacity:
                0.7,
            }}
          >
            📁 ROTA DO BAIRRO
          </div>

          <strong
            style={{
              fontSize:
                22,
            }}
          >
            {rotaNome ||
              "Pasta selecionada"}
          </strong>

          <div
            style={{
              marginTop:
                5,

              opacity:
                0.75,
            }}
          >
            {
              pending.length
            }{" "}
            {pending.length ===
            1
              ? "entrega pendente"
              : "entregas pendentes"}
          </div>
        </div>
      )}

      <div className="page-title map-title">
        <div>
          <span className="eyebrow">
            ROTA INTELIGENTE
          </span>

          <h1>
            {folderMode
              ? `Rota • ${
                  rotaNome ||
                  "Bairro"
                }`
              : "Mapa da rota"}
          </h1>

          <p>
            {folderMode
              ? "Otimize apenas as encomendas desta pasta."
              : "Localize, organize e abra a navegação."}
          </p>
        </div>

        <div className="map-buttons">
          <button
            type="button"
            className="optimize-button"
            onClick={() =>
              prepareRoute(
                deliveries,
                false
              )
            }
            disabled={
              busy || pointCorrection || addressEditor ||
              !pending.length
            }
          >
            {busy
              ? "⏳ Otimizando..."
              : routeReady
              ? "🔄 Recalcular rota"
              : "⚡ Otimizar rota"}
          </button>
        </div>
      </div>

      {message && (
        <div className="map-message">
          {busy && (
            <span className="spinner" />
          )}

          {message}
        </div>
      )}

      {addressReviewReady && !pointCorrection && unlocatedDeliveries.length > 0 && (
        <section className="premium-card" aria-labelledby="unlocated-title" style={{ padding: "18px", margin: "12px 0 16px", border: "2px solid #f59e0b", background: "var(--panel)" }}>
          <span className="eyebrow" style={{ color: "#f59e0b" }}>PRECISAM DE ATENÇÃO</span>
          <h2 id="unlocated-title" style={{ fontSize: "20px", margin: "8px 0" }}>
            {unlocatedDeliveries.length === 1 ? "1 entrega não localizada" : `${unlocatedDeliveries.length} entregas não localizadas`}
          </h2>
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Edite o endereço com rua, número e cidade ou exclua a entrega. Depois toque em Otimizar rota.</p>
          {unlocatedDeliveries.map(renderAddressCard)}
        </section>
      )}

      <section className="map-card premium-card">
        <MapContainer
          center={
            DEFAULT_CENTER
          }
          zoom={12}
          className="leaflet-map"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> | <a href="https://www.geoapify.com/">Powered by Geoapify</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {origin && (
            <CircleMarker
              center={[
                origin.lat,
                origin.lng,
              ]}
              radius={9}
              pathOptions={{
                color:
                  "#22c55e",

                fillColor:
                  "#22c55e",

                fillOpacity:
                  1,
              }}
            >
              <Popup>
                Você está aqui
              </Popup>
            </CircleMarker>
          )}

          {pointCorrection && <DeliveryPointPicker point={pointCorrection.point} center={pointCorrection.center} onPick={(point) => setPointCorrection((current) => current ? { ...current, point } : current)} />}

          {!pointCorrection && locatedStops.map((stop, index) => (
            <Marker key={stop.key}
              position={[stop.representative.coords.lat, stop.representative.coords.lng]}
              icon={routeMarkerIcon(stop.representative.routeCode || `A${index + 1}`, index === 0)}>
              <Popup>
                <strong>{stop.deliveries.length > 1 ? `${stop.deliveries.length} entregas neste endereço` : stop.representative.customer || "Entrega"}</strong>
                <p>{stop.label}</p>
                {stop.deliveries.map((delivery) => <p key={delivery.id}><strong>{delivery.routeCode || "Entrega"}</strong> • {delivery.address}</p>)}
              </Popup>
            </Marker>
          ))}

          {!pointCorrection && routeLine.length >
            1 && (
            <Polyline
              positions={
                routeLine
              }
              pathOptions={{
                color:
                  "#2563eb",

                weight:
                  7,
              }}
            />
          )}

          {internalNavigationActive && !pointCorrection && legLine.length > 1 && (
            <Polyline
              positions={legLine}
              pathOptions={{ color: "#16a34a", weight: 9 }}
            />
          )}

          {!internalNavigationActive && !pointCorrection && (
            <FitMap
              points={fitPoints}
            />
          )}

          <FollowDriver
            position={origin}
            active={internalNavigationActive && !pointCorrection}
          />
        </MapContainer>
      </section>

      {!pointCorrection && sharedStops.length > 0 && (
        <section className="premium-card" style={{ padding: "18px", marginTop: "16px" }}>
          <span className="eyebrow">ENTREGAS NO MESMO LOCAL</span>
          <h2 style={{ margin: "8px 0", fontSize: "20px" }}>Uma parada, vários pacotes</h2>
          <p style={{ color: "var(--muted)", fontSize: "14px" }}>Mesmo endereço e número. Confira cada apartamento ou bloco e conclua os pacotes individualmente.</p>
          {sharedStops.map((stop) => (
            <details key={stop.key} open style={{ border: "1px solid var(--line)", borderRadius: "16px", padding: "14px", marginTop: "12px" }}>
              <summary style={{ cursor: "pointer" }}><strong>{stop.deliveries.length} entregas</strong> • {stop.label}</summary>
              {stop.deliveries.map((delivery) => (
                <div key={delivery.id} style={{ borderTop: "1px solid var(--line)", marginTop: "12px", paddingTop: "12px" }}>
                  <strong>{delivery.routeCode || "Entrega"}{delivery.customer ? ` • ${delivery.customer}` : ""}</strong>
                  <p style={{ margin: "6px 0", overflowWrap: "anywhere", fontSize: "14px" }}>{delivery.address}</p>
                  <button type="button" disabled={busy} style={{ marginTop: "6px", minHeight: "44px", padding: "8px 14px", border: "1px solid var(--line)", borderRadius: "12px", background: "var(--panel-soft)", color: "var(--text)" }} onClick={() => {
                    if (window.confirm(`Marcar somente esta entrega como concluída?\n${delivery.routeCode || ""} • ${delivery.address}`)) setDeliveries((current) => current.map((item) => item.id === delivery.id ? { ...item, completed: true } : item));
                  }}>Concluir esta entrega</button>
                </div>
              ))}
            </details>
          ))}
        </section>
      )}

      {pointCorrection ? (
        <section className="premium-card" style={{ padding: "16px", marginTop: "12px" }}>
          <strong>📍 Ajustar localização da entrega</strong>
          <p>{pointCorrection.address}</p>
          <p>Sua posição atual é apenas uma referência. Toque no local da entrega para selecionar o destino; depois confirme.</p>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button type="button" onClick={useCurrentDeliveryPoint}>Estou no endereço: usar minha posição</button>
            <button type="button" disabled={!pointCorrection.point} onClick={confirmDeliveryPoint}>Confirmar este ponto</button>
            <button type="button" onClick={() => setPointCorrection(null)}>Cancelar</button>
          </div>
        </section>
      ) : (addressReviewReady ? confirmedDeliveries : pending).length > 0 && (
        <details className="premium-card" style={{ padding: "12px 16px", marginTop: "12px" }} >
          <summary><strong>📍 {addressReviewReady ? `Entregas localizadas (${confirmedDeliveries.length})` : "Localização das entregas"}</strong></summary>
          <p><small>Confira os endereços e seus números de entrega.</small></p>
          {(addressReviewReady ? confirmedDeliveries : pending).map(renderAddressCard)}
        </details>
      )}

      {internalNavigationActive && nextDelivery && (
        <section className="internal-navigation-card">
          <div className="turn-by-turn-panel">
            <div className="turn-by-turn-icon">{activeInstruction.icon}</div>
            <div>
              <span>PRÓXIMA ORIENTAÇÃO</span>
              <strong>{activeInstruction.text}</strong>
              <p>
                {isNativeNavigation && !nativeNavigation?.line?.length ? "Caminho ainda não calculado" : distanceLabel(isNativeNavigation ? nativeNavigation?.turnMeters : activeStep?.distanceMeters || 0)}
                {navigationDuration ? ` • ${Math.max(1, Math.round(navigationDuration))} min até a entrega` : ""}
              </p>
            </div>
          </div>
          <div className="internal-navigation-status">
            <span>🚚 NAVEGAÇÃO NO DaRota</span>
            <strong>
              Próxima parada {nextDelivery.routeCode || ""}
            </strong>
            <p>{nextDelivery.address}</p>
            {origin && nextDelivery.coords && (
              <small>
                {haversineKm(origin, nextDelivery.coords) < 1
                  ? `${Math.max(
                      1,
                      Math.round(
                        haversineKm(origin, nextDelivery.coords) * 1000
                      )
                    )} m até a entrega`
                  : `${haversineKm(origin, nextDelivery.coords).toFixed(1)} km até a entrega`}
              </small>
            )}
            <small>{navigationMessage}</small>
            {navigationDistance > 0 && (
              <small>{navigationDistance.toFixed(1)} km restantes pela rua</small>
            )}
          </div>

          <button
            type="button"
            className="internal-navigation-start"
            onClick={beginCurrentLeg}
            disabled={currentLegStarted}
          >
            {currentLegStarted
              ? `🚗 Rota ${nextDelivery.routeCode || "A1"} iniciada`
              : `▶️ Iniciar ${nextDelivery.routeCode || "A1"}`}
          </button>

          <button
            type="button"
            className="internal-navigation-complete"
            onClick={completeNextDelivery}
          >
            ✅ Entrega concluída • ir para a próxima
          </button>

          <button
            type="button"
            className="internal-navigation-stop"
            onClick={stopInternalNavigation}
          >
            Encerrar navegação
          </button>
        </section>
      )}

      <section className="map-summary premium-card">
        <div>
          <strong>
            {
              located.length
            }
          </strong>

          <span>
            paradas localizadas
          </span>
        </div>

        <div>
          <strong>
            {distance
              ? `${distance.toFixed(
                  1
                )} km`
              : "—"}
          </strong>

          <span>
            distância estimada
          </span>
        </div>

        <div>
          <strong>
            {duration
              ? `${Math.round(
                  duration
                )} min`
              : "—"}
          </strong>

          <span>
            tempo estimado
          </span>
        </div>

        <button
          type="button"
          onClick={
            openNavigationModal
          }
          disabled={busy || !pending.length}
        >
          🚚 Escolher navegação
        </button>

        {folderMode &&
          pending.length >
            0 && (
            <button
              type="button"
              className="navigation-option success"
              onClick={
                completeFolderRoute
              }
              disabled={busy}
            >
              ✅ Concluir rota do bairro
            </button>
          )}
      </section>

      {showNavigationModal && (
        <div
          className="navigation-modal-overlay"
          role="presentation"
          onClick={(
            event
          ) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowNavigationModal(
                false
              );
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
                setShowNavigationModal(
                  false
                )
              }
              aria-label="Fechar"
            >
              ×
            </button>

            <div className="navigation-modal-icon">
              🚚
            </div>

            <h2 id="navigation-modal-title">
              Escolher navegação
            </h2>

            {folderMode && (
              <p
                style={{
                  fontWeight:
                    700,
                }}
              >
                📁{" "}
                {rotaNome}
              </p>
            )}

            <p>
              {routeReady ? "Navegue dentro do DaRota ou use outro aplicativo." : "Prepare a rota para iniciar o GPS. Os endereços que não foram localizados serão indicados no mapa."}
            </p>

            {nextDelivery && (
              <div className="navigation-next-stop">
                <span>
                  📍 PRÓXIMA
                  PARADA
                  {nextDelivery.routeCode
                    ? ` • ${nextDelivery.routeCode}`
                    : ""}
                </span>

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

            <button
              type="button"
              className="rota-certa-navigation-button"
              onClick={startInternalNavigation}
            >
              <span>▶️</span>
              <div>
                <strong>Iniciar no DaRota</strong>
                <small>Começar agora com GPS e orientação por voz</small>
              </div>
            </button>

            <div className="navigation-external-label">
              Outras opções
            </div>

            <div className="navigation-app-buttons">
              <button
                type="button"
                className="google-maps-button"
                onClick={
                  openGoogleMaps
                }
              >
                <span>
                  🗺️
                </span>

                <div>
                  <strong>
                    Google Maps
                  </strong>

                  <small>
                    Abrir rota
                    completa
                  </small>
                </div>
              </button>

              <button
                type="button"
                className="waze-button"
                onClick={
                  openWaze
                }
              >
                <span>
                  🚙
                </span>

                <div>
                  <strong>
                    Waze
                  </strong>

                  <small>
                    Próxima
                    parada
                  </small>
                </div>
              </button>
            </div>

            <button
              type="button"
              className="navigation-option success"
              onClick={
                completeNextDelivery
              }
            >
              ✅ Concluir{" "}
              {nextDelivery?.routeCode ||
                "entrega"}
            </button>

            {folderMode && (
              <button
                type="button"
                className="navigation-option success"
                onClick={
                  completeFolderRoute
                }
              >
                ✅ Concluir rota do bairro
              </button>
            )}

            <button
              type="button"
              className="navigation-cancel-button"
              onClick={() =>
                setShowNavigationModal(
                  false
                )
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
