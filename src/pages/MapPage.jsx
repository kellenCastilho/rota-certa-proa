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
} from "react-leaflet";

import L from "leaflet";
import { Capacitor } from "@capacitor/core";
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

  const nextDelivery =
    pending[0];

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
  }, [activeStep, metersToDelivery, nextDelivery?.address]);

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
    if (!internalNavigationActive) return undefined;

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
    if (!internalNavigationActive || !activeStep) return;
    const metersToTurn = activeStep.location && origin
      ? haversineKm(origin, activeStep.location) * 1000
      : activeStep.distanceMeters;

    if (metersToTurn <= 250) {
      speakInstruction(`${activeInstruction.text}. Em ${distanceLabel(metersToTurn)}.`);
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
          haversineKm(
            currentOrigin,
            updated[i]
              .coords
          ) <= 150
        ) {
          continue;
        }

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
        } catch {
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
          "✅ Rota pronta!"
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
        result.usedFallback
          ? "✅ Rota otimizada e pronta!"
          : "✅ Rota otimizada!"
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
    if (!routeReady || !nextDelivery) {
      alert("Otimize a rota antes de iniciar a navegação.");
      return;
    }

    setNavigationMessage("📡 Iniciando o GPS...");
    navigationRefreshRef.current = { at: 0, position: null };
    spokenInstructionRef.current = "";

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
    if (!origin || !nextDelivery) return;
    setCurrentLegStarted(true);
    await refreshTurnByTurn(origin, nextDelivery, true);
  }

  function stopInternalNavigation() {
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

  function openGoogleMaps() {
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
      setInternalNavigationActive(false);

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
              busy ||
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

      <section className="map-card premium-card">
        <MapContainer
          center={
            DEFAULT_CENTER
          }
          zoom={12}
          className="leaflet-map"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap"
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

          {located.map(
            (
              delivery,
              index
            ) => (
              <Marker
                key={
                  delivery.id
                }
                position={[
                  delivery.coords
                    .lat,

                  delivery.coords
                    .lng,
                ]}
                icon={routeMarkerIcon(
                  delivery.routeCode ||
                    `A${
                      index +
                      1
                    }`,

                  index === 0
                )}
              >
                <Popup>
                  <strong>
                    {delivery.routeCode ||
                      `A${
                        index +
                        1
                      }`}{" "}
                    •{" "}
                    {delivery.customer ||
                      "Entrega"}
                  </strong>

                  <br />

                  {
                    delivery.address
                  }
                </Popup>
              </Marker>
            )
          )}

          {routeLine.length >
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

          {!internalNavigationActive && (
            <FitMap
              points={fitPoints}
            />
          )}

          <FollowDriver
            position={origin}
            active={internalNavigationActive}
          />
        </MapContainer>
      </section>

      {internalNavigationActive && nextDelivery && (
        <section className="internal-navigation-card">
          <div className="turn-by-turn-panel">
            <div className="turn-by-turn-icon">{activeInstruction.icon}</div>
            <div>
              <span>PRÓXIMA ORIENTAÇÃO</span>
              <strong>{activeInstruction.text}</strong>
              <p>
                {distanceLabel(activeStep?.distanceMeters || 0)}
                {navigationDuration ? ` • ${Math.max(1, Math.round(navigationDuration))} min até a entrega` : ""}
              </p>
            </div>
          </div>
          <div className="internal-navigation-status">
            <span>🚚 NAVEGAÇÃO NO ROTA CERTA</span>
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
          disabled={
            !routeReady ||
            busy ||
            !pending.length
          }
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
              Rota pronta
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
              Navegue dentro do Rota Certa ou use outro aplicativo.
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
                <strong>Iniciar rota</strong>
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
