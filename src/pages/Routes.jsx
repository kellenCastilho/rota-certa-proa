import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  useNavigate,
} from "react-router-dom";

import {
  extractNeighborhood,
  importSpreadsheet,
} from "../services/importSpreadsheet";

import {
  getLocationContext,
} from "../services/geocoding";

function getCurrentLocation() {
  return new Promise(
    (resolve, reject) => {
      if (!navigator.geolocation) {
        reject(
          new Error(
            "Localização não disponível neste aparelho."
          )
        );
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat:
              position.coords.latitude,
            lng:
              position.coords.longitude,
          });
        },

        () => {
          reject(
            new Error(
              "Não consegui obter sua localização. Permita o acesso ao GPS."
            )
          );
        },

        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        }
      );
    }
  );
}

function extractCityState(context) {
  if (!context) {
    return {
      cidade: "",
      estado: "",
    };
  }

  if (typeof context === "string") {
    const parts = context
      .split(",")
      .map((part) =>
        part.trim()
      )
      .filter(Boolean);

    return {
      cidade: parts[0] || "",
      estado: parts[1] || "",
    };
  }

  const possibleSources = [
    context,
    context.address,
    context.raw?.address,
    context.location,
  ].filter(
    (item) =>
      item &&
      typeof item === "object"
  );

  function findValue(names) {
    for (const source of possibleSources) {
      for (const name of names) {
        if (
          typeof source[name] ===
            "string" &&
          source[name].trim()
        ) {
          return source[name].trim();
        }
      }
    }

    return "";
  }

  return {
    cidade:
      findValue([
        "cidade",
        "city",
        "town",
        "municipality",
        "village",
        "city_district",
      ]),

    estado:
      findValue([
        "uf",
        "estado",
        "stateCode",
        "state_code",
        "state",
      ]),
  };
}

function getSupportedAudioMimeType() {
  if (
    typeof MediaRecorder ===
    "undefined"
  ) {
    return "";
  }

  const options = [
    "audio/mp4",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

  return (
    options.find(
      (type) =>
        MediaRecorder.isTypeSupported?.(
          type
        )
    ) || ""
  );
}

function blobToDataUrl(blob) {
  return new Promise(
    (resolve, reject) => {
      const reader =
        new FileReader();

      reader.onloadend = () =>
        resolve(
          reader.result
        );

      reader.onerror = () =>
        reject(
          new Error(
            "Não consegui preparar o áudio."
          )
        );

      reader.readAsDataURL(
        blob
      );
    }
  );
}

export default function RoutesPage({
  routes,
  deliveries,
  setDeliveries,
  createRoute,
  renameRoute,
  deleteRoute,
}) {
  const navigate =
    useNavigate();

  const importRouteRef =
    useRef(null);

  const neighborhoodImportRef =
    useRef(null);

  const mediaRecorderRef =
    useRef(null);

  const audioStreamRef =
    useRef(null);

  const audioChunksRef =
    useRef([]);

  const voiceLocationRef =
    useRef(null);

  const voiceRouteRef =
    useRef(null);

  const autoStopRef =
    useRef(null);

  const [
    showNewRoute,
    setShowNewRoute,
  ] = useState(false);

  const [
    newRouteName,
    setNewRouteName,
  ] = useState("");

  const [
    creating,
    setCreating,
  ] = useState(false);

  const [
    importingRouteId,
    setImportingRouteId,
  ] = useState(null);

  const [
    importingNeighborhoods,
    setImportingNeighborhoods,
  ] = useState(false);

  const [
    voiceRouteId,
    setVoiceRouteId,
  ] = useState(null);

  const [
    voiceMode,
    setVoiceMode,
  ] = useState("idle");

  function stopAudioStream() {
    if (
      audioStreamRef.current
    ) {
      audioStreamRef.current
        .getTracks()
        .forEach(
          (track) =>
            track.stop()
        );

      audioStreamRef.current =
        null;
    }
  }

  function clearVoiceTimer() {
    if (
      autoStopRef.current
    ) {
      clearTimeout(
        autoStopRef.current
      );

      autoStopRef.current =
        null;
    }
  }

  useEffect(() => {
    return () => {
      clearVoiceTimer();

      try {
        if (
          mediaRecorderRef.current
            ?.state ===
          "recording"
        ) {
          mediaRecorderRef.current.stop();
        }
      } catch {
        // nada
      }

      stopAudioStream();
    };
  }, []);

  // ==========================================
  // ENTREGAS DA PASTA
  // ==========================================

  function routeDeliveries(
    routeId
  ) {
    return deliveries.filter(
      (delivery) =>
        String(
          delivery.rotaId
        ) ===
        String(routeId)
    );
  }

  function countDeliveries(
    routeId
  ) {
    return routeDeliveries(
      routeId
    ).length;
  }

  function countPending(
    routeId
  ) {
    return routeDeliveries(
      routeId
    ).filter(
      (delivery) =>
        !delivery.completed
    ).length;
  }

  // ==========================================
  // CRIAR PASTA
  // ==========================================

  async function handleCreateRoute() {
    const nome =
      newRouteName.trim();

    if (!nome) {
      alert(
        "Digite o nome do bairro ou da pasta."
      );
      return;
    }

    setCreating(true);

    const route =
      await createRoute(
        nome
      );

    setCreating(false);

    if (!route) {
      return;
    }

    setNewRouteName("");
    setShowNewRoute(false);
  }

  // ==========================================
  // RENOMEAR
  // ==========================================

  async function handleRename(
    route
  ) {
    const novoNome =
      window.prompt(
        "Novo nome da pasta:",
        route.nome
      );

    if (
      !novoNome ||
      !novoNome.trim() ||
      novoNome.trim() ===
        route.nome
    ) {
      return;
    }

    await renameRoute(
      route.id,
      novoNome
    );
  }

  // ==========================================
  // EXCLUIR
  // ==========================================

  async function handleDelete(
    route
  ) {
    const total =
      countDeliveries(
        route.id
      );

    let mensagem =
      `Excluir a pasta "${route.nome}"?`;

    if (total > 0) {
      mensagem +=
        `\n\nEla possui ${total} ${
          total === 1
            ? "entrega"
            : "entregas"
        }.` +
        "\n\nAs entregas NÃO serão apagadas.";
    }

    if (
      !window.confirm(
        mensagem
      )
    ) {
      return;
    }

    const success =
      await deleteRoute(
        route.id
      );

    if (
      success &&
      typeof setDeliveries ===
        "function"
    ) {
      setDeliveries(
        (current) =>
          current.map(
            (delivery) =>
              String(
                delivery.rotaId
              ) ===
              String(
                route.id
              )
                ? {
                    ...delivery,
                    rotaId: null,
                  }
                : delivery
          )
      );
    }
  }

  function handleEditDelivery(
    delivery
  ) {
    navigate(
      `/editar-entrega/${delivery.id}`
    );
  }

  function handleDeleteDelivery(
    delivery
  ) {
    const label =
      delivery.address ||
      delivery.customer ||
      "esta entrega";

    if (
      !window.confirm(
        `Excluir ${label}?\n\nEssa ação retira a entrega desta rota.`
      )
    ) {
      return;
    }

    if (
      typeof setDeliveries ===
      "function"
    ) {
      setDeliveries(
        (current) =>
          current.filter(
            (item) =>
              String(item.id) !==
              String(delivery.id)
          )
      );
    }
  }

  // ==========================================
  // DIGITAR
  // ==========================================

  function handleType(
    route
  ) {
    navigate(
      "/nova-entrega",
      {
        state: {
          rotaId:
            route.id,

          rotaNome:
            route.nome,
        },
      }
    );
  }

  // ==========================================
  // ESCANEAR
  // ==========================================

  function handleScan(
    route
  ) {
    navigate(
      `/escanear?rota=${encodeURIComponent(
        route.id
      )}&nome=${encodeURIComponent(
        route.nome
      )}`
    );
  }

  // ==========================================
  // OTIMIZAR
  // ==========================================

  function handleOptimize(
    route
  ) {
    const pending =
      countPending(
        route.id
      );

    if (!pending) {
      alert(
        `A pasta "${route.nome}" não possui entregas pendentes.`
      );
      return;
    }

    navigate(
      `/mapa?rota=${encodeURIComponent(
        route.id
      )}&nome=${encodeURIComponent(
        route.nome
      )}&auto=1&nav=1`
    );
  }

  // ==========================================
  // PROCESSA ÁUDIO
  // ==========================================

  async function processVoiceAudio(
    route,
    blob
  ) {
    try {
      setVoiceMode(
        "processing"
      );

      const dataUrl =
        await blobToDataUrl(
          blob
        );

      const location =
        voiceLocationRef.current ||
        {};

      const response =
        await fetch(
          "/api/transcrever-endereco",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                audio:
                  dataUrl,

                mimeType:
                  blob.type,

                cidade:
                  location.cidade ||
                  "",

                estado:
                  location.estado ||
                  "",

                lat:
                  location.lat,

                lng:
                  location.lng,
              }),
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ||
            "Não consegui entender o endereço."
        );
      }

      const address =
        data?.endereco?.trim();

      if (!address) {
        throw new Error(
          "Não consegui identificar o endereço falado."
        );
      }

      navigate(
        "/nova-entrega",
        {
          state: {
            voiceAddress:
              address,

            rotaId:
              route.id,

            rotaNome:
              route.nome,
          },
        }
      );
    } catch (error) {
      console.error(
        "Erro na voz:",
        error
      );

      alert(
        error?.message ||
          "Não consegui entender o endereço. Tente novamente."
      );
    } finally {
      clearVoiceTimer();
      stopAudioStream();

      mediaRecorderRef.current =
        null;

      audioChunksRef.current =
        [];

      voiceLocationRef.current =
        null;

      voiceRouteRef.current =
        null;

      setVoiceRouteId(
        null
      );

      setVoiceMode(
        "idle"
      );
    }
  }

  function stopVoiceRecording() {
    clearVoiceTimer();

    const recorder =
      mediaRecorderRef.current;

    if (
      recorder &&
      recorder.state ===
        "recording"
    ) {
      recorder.stop();
    }
  }

  // ==========================================
  // FALAR
  // ==========================================

  async function handleVoice(
    route
  ) {
    if (
      voiceMode ===
        "recording" &&
      String(
        voiceRouteId
      ) ===
        String(
          route.id
        )
    ) {
      stopVoiceRecording();
      return;
    }

    if (
      voiceMode !==
      "idle"
    ) {
      return;
    }

    if (
      !navigator.mediaDevices
        ?.getUserMedia ||
      typeof MediaRecorder ===
        "undefined"
    ) {
      alert(
        "A gravação de voz não está disponível neste navegador."
      );
      return;
    }

    setVoiceRouteId(
      route.id
    );

    setVoiceMode(
      "preparing"
    );

    voiceRouteRef.current =
      route;

    try {
      const origin =
        await getCurrentLocation();

      let context =
        null;

      try {
        context =
          await getLocationContext(
            origin
          );
      } catch (error) {
        console.warn(
          "Não consegui identificar cidade pelo GPS:",
          error
        );
      }

      const {
        cidade,
        estado,
      } =
        extractCityState(
          context
        );

      console.log(
        "📍 Contexto da voz:",
        {
          cidade,
          estado,
          origin,
          context,
        }
      );

      voiceLocationRef.current =
        {
          cidade,
          estado,
          lat:
            origin.lat,
          lng:
            origin.lng,
        };

      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            audio: {
              echoCancellation:
                true,

              noiseSuppression:
                true,
            },

            video:
              false,
          }
        );

      audioStreamRef.current =
        stream;

      audioChunksRef.current =
        [];

      const mimeType =
        getSupportedAudioMimeType();

      let recorder;

      if (mimeType) {
        recorder =
          new MediaRecorder(
            stream,
            {
              mimeType,
            }
          );
      } else {
        recorder =
          new MediaRecorder(
            stream
          );
      }

      mediaRecorderRef.current =
        recorder;

      recorder.ondataavailable =
        (event) => {
          if (
            event.data &&
            event.data.size >
              0
          ) {
            audioChunksRef.current.push(
              event.data
            );
          }
        };

      recorder.onerror =
        (event) => {
          console.error(
            "Erro MediaRecorder:",
            event
          );
        };

      recorder.onstop =
        async () => {
          clearVoiceTimer();
          stopAudioStream();

          const chunks =
            audioChunksRef.current;

          if (
            !chunks.length
          ) {
            alert(
              "Nenhum áudio foi gravado. Tente novamente."
            );

            setVoiceMode(
              "idle"
            );

            setVoiceRouteId(
              null
            );

            return;
          }

          const finalMimeType =
            recorder.mimeType ||
            mimeType ||
            "audio/webm";

          const blob =
            new Blob(
              chunks,
              {
                type:
                  finalMimeType,
              }
            );

          await processVoiceAudio(
            route,
            blob
          );
        };

      recorder.start();

      setVoiceMode(
        "recording"
      );

      autoStopRef.current =
        setTimeout(
          () => {
            if (
              mediaRecorderRef.current
                ?.state ===
              "recording"
            ) {
              mediaRecorderRef.current.stop();
            }
          },
          12000
        );
    } catch (error) {
      console.error(
        "Erro ao iniciar voz:",
        error
      );

      clearVoiceTimer();
      stopAudioStream();

      mediaRecorderRef.current =
        null;

      setVoiceRouteId(
        null
      );

      setVoiceMode(
        "idle"
      );

      alert(
        error?.message ||
          "Não consegui acessar GPS ou microfone."
      );
    }
  }

  // ==========================================
  // IMPORTAR
  // ==========================================

  function normalizedRouteName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  async function handleReclassifyNeighborhoods() {
    const unknownRoute = routes.find(
      (route) => normalizedRouteName(route.nome) === "bairro nao identificado"
    );
    if (!unknownRoute) {
      alert("Não há pasta de bairros pendentes.");
      return;
    }

    const corrections = deliveries.flatMap((delivery) => {
      if (String(delivery.rotaId) !== String(unknownRoute.id)) return [];

      const city = String(delivery.address || "")
        .match(/,\s*([^,]+),\s*[A-Z]{2}\b/)?.[1]?.trim();
      const name = city ? extractNeighborhood(delivery.address, city) : "";
      const key = normalizedRouteName(name);

      if (
        normalizedRouteName(city) !== "uberlandia" ||
        !["minas gerais", "brasil"].includes(key)
      ) return [];

      return [{ id: String(delivery.id), name, key }];
    });

    if (!corrections.length) {
      alert("Nenhuma entrega desta planilha precisa de correção.");
      return;
    }

    const routeByName = new Map(
      routes.map((route) => [normalizedRouteName(route.nome), route])
    );
    for (const { name, key } of corrections) {
      if (!routeByName.has(key)) {
        const created = await createRoute(name);
        if (!created) return;
        routeByName.set(key, created);
      }
    }

    const targetById = new Map(
      corrections.map(({ id, key }) => [id, routeByName.get(key).id])
    );
    setDeliveries((current) =>
      current.map((delivery) =>
        targetById.has(String(delivery.id))
          ? { ...delivery, rotaId: targetById.get(String(delivery.id)) }
          : delivery
      )
    );
    alert(`${corrections.length} entregas movidas para os bairros corretos.`);
  }

  async function handleNeighborhoodSpreadsheetChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setImportingNeighborhoods(true);
      const result = await importSpreadsheet(file);
      const unresolved = result.deliveries.filter(
        (delivery) => !delivery.neighborhood ||
          delivery.neighborhood === "Bairro não identificado"
      );
      if (unresolved.length) {
        throw new Error(
          `${unresolved.length} entregas continuam sem bairro. ` +
          "Confira o endereço, bairro ou CEP na planilha e tente novamente. " +
          "Nenhuma entrega desta planilha foi importada."
        );
      }
      const routeByName = new Map(
        routes.map((route) => [normalizedRouteName(route.nome), route])
      );
      const neighborhoodNames = [];

      result.deliveries.forEach((delivery) => {
        const name = delivery.neighborhood || "Bairro não identificado";
        const key = normalizedRouteName(name);
        if (!neighborhoodNames.some((item) => item.key === key)) {
          neighborhoodNames.push({ key, name });
        }
      });

      let createdFolders = 0;
      for (const neighborhood of neighborhoodNames) {
        if (!routeByName.has(neighborhood.key)) {
          const created = await createRoute(neighborhood.name);
          if (!created) {
            throw new Error(`Não consegui criar a pasta "${neighborhood.name}".`);
          }
          routeByName.set(neighborhood.key, created);
          createdFolders += 1;
        }
      }

      const imported = result.deliveries.map((delivery) => ({
        ...delivery,
        rotaId: routeByName.get(
          normalizedRouteName(delivery.neighborhood || "Bairro não identificado")
        ).id,
      }));

      setDeliveries((current) => [...current, ...imported]);

      alert(
        `✅ ${imported.length} entregas importadas e separadas em ${neighborhoodNames.length} bairros.\n` +
          `${createdFolders} novas pastas foram criadas automaticamente.`
      );
    } catch (error) {
      console.error("Erro ao organizar planilha por bairros:", error);
      alert(error?.message || "Não foi possível importar e separar a planilha.");
    } finally {
      setImportingNeighborhoods(false);
      event.target.value = "";
    }
  }

  function handleImport(
    route
  ) {
    importRouteRef.current =
      route;
  }

  async function handleSpreadsheetChange(
    event
  ) {
    const file =
      event.target.files?.[0];

    const route =
      importRouteRef.current;

    if (
      !file ||
      !route
    ) {
      event.target.value =
        "";
      return;
    }

    try {
      setImportingRouteId(
        route.id
      );

      const result =
        await importSpreadsheet(
          file
        );

      if (
        typeof setDeliveries !==
        "function"
      ) {
        throw new Error(
          "Não foi possível salvar as entregas."
        );
      }

      let addedCount =
        0;

      let duplicateCount =
        0;

      setDeliveries(
        (current) => {
          const existingPackageCodes =
            new Set();

          current.forEach(
            (delivery) => {
              if (
                delivery.packageCode
              ) {
                existingPackageCodes.add(
                  String(
                    delivery.packageCode
                  )
                    .trim()
                    .toLowerCase()
                );
              }

              const packageMatch =
                delivery.notes?.match(
                  /Pacote:\s*([^•]+)/i
                );

              if (
                packageMatch?.[1]
              ) {
                existingPackageCodes.add(
                  packageMatch[1]
                    .trim()
                    .toLowerCase()
                );
              }
            }
          );

          const newDeliveries =
            result.deliveries
              .filter(
                (delivery) => {
                  const packageCode =
                    delivery.packageCode
                      ?.trim()
                      .toLowerCase();

                  if (
                    packageCode &&
                    existingPackageCodes.has(
                      packageCode
                    )
                  ) {
                    duplicateCount +=
                      1;

                    return false;
                  }

                  if (
                    packageCode
                  ) {
                    existingPackageCodes.add(
                      packageCode
                    );
                  }

                  addedCount +=
                    1;

                  return true;
                }
              )
              .map(
                (delivery) => ({
                  ...delivery,
                  rotaId:
                    route.id,
                })
              );

          return [
            ...current,
            ...newDeliveries,
          ];
        }
      );

      alert(
        [
          `✅ Importação concluída em "${route.nome}"!`,
          "",
          `${addedCount} novas entregas adicionadas.`,

          duplicateCount
            ? `${duplicateCount} repetidas foram ignoradas.`
            : "",

          result.ignoredRows >
          0
            ? `${result.ignoredRows} linhas foram ignoradas.`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (error) {
      console.error(
        "Erro ao importar:",
        error
      );

      alert(
        error?.message ||
          "Não foi possível importar a planilha."
      );
    } finally {
      setImportingRouteId(
        null
      );

      importRouteRef.current =
        null;

      event.target.value =
        "";
    }
  }

  // ==========================================
  // ESTILO DOS BOTÕES
  // ==========================================

  const actionStyle = {
    padding:
      "17px 10px",

    minHeight:
      105,

    borderRadius:
      16,

    border:
      "1px solid rgba(148,163,184,0.28)",

    background:
      "rgba(30,41,59,0.62)",

    color:
      "inherit",

    cursor:
      "pointer",

    display:
      "flex",

    flexDirection:
      "column",

    justifyContent:
      "center",

    alignItems:
      "center",

    gap:
      6,

    textAlign:
      "center",
  };

  return (
    <main className="page">
      <div
        style={{
          marginBottom:
            24,
        }}
      >
        <span className="eyebrow">
          ORGANIZAÇÃO
        </span>

        <h1>
          📁 Minhas Rotas
        </h1>

        <p
          style={{
            opacity:
              0.75,
          }}
        >
          Separe as encomendas
          por bairro e otimize
          cada rota.
        </p>
      </div>

      <section
        className="premium-card"
        style={{ padding: 18, marginBottom: 18 }}
      >
        <h2 style={{ margin: "0 0 6px" }}>Organizar planilha automaticamente</h2>
        <p style={{ margin: "0 0 14px", opacity: 0.75 }}>
          Importe a planilha da Shopee/SPX. O DaRota cria as pastas e
          coloca cada entrega no bairro correto.
        </p>
        <label
          style={{
            display: "block",
            position: "relative",
            padding: 16,
            borderRadius: 14,
            textAlign: "center",
            fontWeight: 800,
            cursor: importingNeighborhoods ? "wait" : "pointer",
            background: "#2563eb",
            color: "white",
            opacity: importingNeighborhoods ? 0.65 : 1,
          }}
        >
          {importingNeighborhoods
            ? "⏳ Separando entregas por bairro..."
            : "📊 Importar planilha e separar por bairros"}
          <input
            ref={neighborhoodImportRef}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={importingNeighborhoods}
            onChange={handleNeighborhoodSpreadsheetChange}
            aria-label="Importar planilha e separar por bairros"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: importingNeighborhoods ? "wait" : "pointer",
            }}
          />
        </label>
        {routes.some(
          (route) =>
            normalizedRouteName(route.nome) === "bairro nao identificado" &&
            deliveries.some(
              (delivery) => String(delivery.rotaId) === String(route.id)
            )
        ) && (
          <button
            type="button"
            onClick={handleReclassifyNeighborhoods}
            style={{ width: "100%", marginTop: 12, padding: 14, borderRadius: 12, background: "#16a34a", color: "white", fontWeight: 800 }}
          >
            Corrigir bairros Minas Gerais e Brasil
          </button>
        )}
      </section>

      <button
        type="button"
        onClick={() =>
          setShowNewRoute(
            (value) =>
              !value
          )
        }
        style={{
          width:
            "100%",

          padding:
            "16px 20px",

          border:
            "none",

          borderRadius:
            16,

          fontSize:
            17,

          fontWeight:
            800,

          cursor:
            "pointer",

          background:
            "#22c55e",

          color:
            "#052e16",

          marginBottom:
            20,
        }}
      >
        ➕ Criar pasta /
        bairro
      </button>

      {showNewRoute && (
        <section
          className="premium-card"
          style={{
            padding:
              18,

            marginBottom:
              20,
          }}
        >
          <label>
            Nome da pasta
          </label>

          <input
            autoFocus
            value={
              newRouteName
            }
            onChange={(
              event
            ) =>
              setNewRouteName(
                event.target.value
              )
            }
            placeholder="Ex.: Centro"
            style={{
              width:
                "100%",

              boxSizing:
                "border-box",

              padding:
                14,

              marginTop:
                8,

              marginBottom:
                12,

              borderRadius:
                12,
            }}
          />

          <div
            style={{
              display:
                "flex",

              gap:
                10,
            }}
          >
            <button
              type="button"
              onClick={() => {
                setNewRouteName(
                  ""
                );

                setShowNewRoute(
                  false
                );
              }}
              style={{
                flex:
                  1,

                padding:
                  13,
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              onClick={
                handleCreateRoute
              }
              disabled={
                creating
              }
              style={{
                flex:
                  1,

                padding:
                  13,

                background:
                  "#22c55e",
              }}
            >
              {creating
                ? "Criando..."
                : "✅ Criar"}
            </button>
          </div>
        </section>
      )}

      <div
        style={{
          display:
            "flex",

          flexDirection:
            "column",

          gap:
            18,
        }}
      >
        {routes.map(
          (route) => {
            const items =
              routeDeliveries(
                route.id
              );

            const total =
              items.length;

            const pending =
              items.filter(
                (delivery) =>
                  !delivery.completed
              ).length;

            const thisVoice =
              String(
                voiceRouteId
              ) ===
              String(
                route.id
              );

            return (
              <section
                key={
                  route.id
                }
                className="premium-card"
                style={{
                  padding:
                    18,
                }}
              >
                <div
                  style={{
                    display:
                      "flex",

                    alignItems:
                      "center",

                    gap:
                      14,

                    marginBottom:
                      18,
                  }}
                >
                  <div
                    style={{
                      fontSize:
                        42,
                    }}
                  >
                    📁
                  </div>

                  <div>
                    <h2
                      style={{
                        margin:
                          0,
                      }}
                    >
                      {
                        route.nome
                      }
                    </h2>

                    <p
                      style={{
                        margin:
                          "5px 0 0",

                        opacity:
                          0.7,
                      }}
                    >
                      {total > 0 &&
                      pending === 0
                        ? `✅ Rota concluída • ${total} ${
                            total === 1
                              ? "entrega"
                              : "entregas"
                          }`
                        : `${total} ${
                            total === 1
                              ? "entrega"
                              : "entregas"
                          }${
                            total > 0
                              ? ` • ${pending} pendente${
                                  pending === 1
                                    ? ""
                                    : "s"
                                }`
                              : ""
                          }`}
                    </p>
                  </div>
                </div>

                {/* ====================================== */}
                {/* LISTA DAS ENTREGAS DA PASTA */}
                {/* ====================================== */}

                {items.length >
                  0 && (
                  <div
                    style={{
                      marginBottom:
                        20,
                    }}
                  >
                    <div
                      style={{
                        marginBottom:
                          10,

                        fontSize:
                          12,

                        opacity:
                          0.7,

                        fontWeight:
                          800,

                        letterSpacing:
                          0.5,
                      }}
                    >
                      ENTREGAS DE{" "}
                      {route.nome.toUpperCase()}
                    </div>

                    <div
                      style={{
                        display:
                          "flex",

                        flexDirection:
                          "column",

                        gap:
                          8,
                      }}
                    >
                      {items.map(
                        (
                          delivery,
                          index
                        ) => (
                          <div
                            key={
                              delivery.id
                            }
                            style={{
                              display:
                                "flex",

                              alignItems:
                                "flex-start",

                              gap:
                                11,

                              padding:
                                "12px 13px",

                              borderRadius:
                                12,

                              background:
                                "rgba(15,23,42,0.55)",

                              border:
                                "1px solid rgba(148,163,184,0.18)",
                            }}
                          >
                            <div
                              style={{
                                width:
                                  29,

                                height:
                                  29,

                                borderRadius:
                                  "50%",

                                flexShrink:
                                  0,

                                display:
                                  "flex",

                                alignItems:
                                  "center",

                                justifyContent:
                                  "center",

                                background:
                                  delivery.completed
                                    ? "#22c55e"
                                    : "#2563eb",

                                color:
                                  "white",

                                fontSize:
                                  12,

                                fontWeight:
                                  900,
                              }}
                            >
                              {delivery.completed
                                ? "✓"
                                : index +
                                  1}
                            </div>

                            <div
                              style={{
                                flex:
                                  1,

                                minWidth:
                                  0,
                              }}
                            >
                              <div
                                style={{
                                  fontSize:
                                    14,

                                  fontWeight:
                                    700,

                                  lineHeight:
                                    1.4,

                                  textDecoration:
                                    delivery.completed
                                      ? "line-through"
                                      : "none",

                                  opacity:
                                    delivery.completed
                                      ? 0.55
                                      : 1,

                                  overflowWrap:
                                    "anywhere",
                                }}
                              >
                                {delivery.address ||
                                  "Endereço não informado"}
                              </div>

                              {delivery.customer && (
                                <div
                                  style={{
                                    marginTop:
                                      4,

                                    fontSize:
                                      12,

                                    opacity:
                                      0.65,
                                  }}
                                >
                                  👤{" "}
                                  {
                                    delivery.customer
                                  }
                                </div>
                              )}

                              <div
                                style={{
                                  marginTop:
                                    5,

                                  fontSize:
                                    10,

                                  fontWeight:
                                    800,

                                  opacity:
                                    0.55,

                                  letterSpacing:
                                    0.4,
                                }}
                              >
                                {delivery.completed
                                  ? "ENTREGUE"
                                  : "PENDENTE"}
                              </div>

                              <div
                                style={{
                                  display:
                                    "flex",

                                  flexWrap:
                                    "wrap",

                                  gap:
                                    8,

                                  marginTop:
                                    10,
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleEditDelivery(
                                      delivery
                                    )
                                  }
                                  style={{
                                    border:
                                      "1px solid rgba(96,165,250,0.38)",

                                    borderRadius:
                                      9,

                                    padding:
                                      "7px 11px",

                                    background:
                                      "rgba(37,99,235,0.14)",

                                    color:
                                      "#93c5fd",

                                    fontSize:
                                      12,

                                    fontWeight:
                                      800,
                                  }}
                                >
                                  ✏️ Editar
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    handleDeleteDelivery(
                                      delivery
                                    )
                                  }
                                  style={{
                                    border:
                                      "1px solid rgba(248,113,113,0.38)",

                                    borderRadius:
                                      9,

                                    padding:
                                      "7px 11px",

                                    background:
                                      "rgba(239,68,68,0.12)",

                                    color:
                                      "#fca5a5",

                                    fontSize:
                                      12,

                                    fontWeight:
                                      800,
                                  }}
                                >
                                  🗑️ Excluir
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                <div
                  style={{
                    marginBottom:
                      10,

                    fontSize:
                      13,

                    opacity:
                      0.7,

                    fontWeight:
                      700,
                  }}
                >
                  ADICIONAR EM{" "}
                  {route.nome.toUpperCase()}
                </div>

                <div
                  style={{
                    display:
                      "grid",

                    gridTemplateColumns:
                      "repeat(2, minmax(0, 1fr))",

                    gap:
                      10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      handleType(
                        route
                      )
                    }
                    style={
                      actionStyle
                    }
                  >
                    <span
                      style={{
                        fontSize:
                          28,
                      }}
                    >
                      ⌨️
                    </span>

                    <strong>
                      Digitar
                    </strong>

                    <small>
                      Novo endereço
                    </small>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleScan(
                        route
                      )
                    }
                    style={{
                      ...actionStyle,

                      border:
                        "1px solid #2563eb",

                      background:
                        "rgba(37,99,235,0.12)",
                    }}
                  >
                    <span
                      style={{
                        fontSize:
                          28,
                      }}
                    >
                      📷
                    </span>

                    <strong>
                      Escanear
                    </strong>

                    <small>
                      Ler etiqueta
                    </small>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleVoice(
                        route
                      )
                    }
                    disabled={
                      voiceMode !==
                        "idle" &&
                      !thisVoice
                    }
                    style={{
                      ...actionStyle,

                      ...(thisVoice &&
                      voiceMode ===
                        "recording"
                        ? {
                            border:
                              "1px solid #ef4444",

                            background:
                              "rgba(239,68,68,0.16)",
                          }
                        : {}),
                    }}
                  >
                    <span
                      style={{
                        fontSize:
                          28,
                      }}
                    >
                      {thisVoice &&
                      voiceMode ===
                        "recording"
                        ? "🔴"
                        : "🎤"}
                    </span>

                    <strong>
                      {!thisVoice
                        ? "Falar"
                        : voiceMode ===
                          "preparing"
                        ? "Preparando..."
                        : voiceMode ===
                          "recording"
                        ? "Parar e reconhecer"
                        : "Reconhecendo..."}
                    </strong>

                    <small>
                      {thisVoice &&
                      voiceMode ===
                        "recording"
                        ? "Fale rua e número"
                        : "Ditar endereço"}
                    </small>
                  </button>

                  <label
                    onClick={() =>
                      handleImport(
                        route
                      )
                    }
                    style={{
                      ...actionStyle,
                      position:
                        "relative",
                      overflow:
                        "hidden",
                      opacity:
                        importingRouteId ===
                        route.id
                          ? 0.65
                          : 1,
                      pointerEvents:
                        importingRouteId ===
                        route.id
                          ? "none"
                          : "auto",
                    }}
                  >
                    <span
                      style={{
                        fontSize:
                          28,
                      }}
                    >
                      📊
                    </span>

                    <strong>
                      {importingRouteId ===
                      route.id
                        ? "Importando..."
                        : "Importar"}
                    </strong>

                    <small>
                      Planilha
                    </small>

                    <input
                      type="file"
                      accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onClick={(event) => {
                        importRouteRef.current =
                          route;

                        event.currentTarget.value =
                          "";
                      }}
                      onChange={
                        handleSpreadsheetChange
                      }
                      aria-label={`Importar planilha para ${route.nome}`}
                      style={{
                        position:
                          "absolute",
                        inset: 0,
                        width:
                          "100%",
                        height:
                          "100%",
                        opacity: 0,
                        cursor:
                          "pointer",
                      }}
                    />
                  </label>
                </div>

                {pending >
                  0 && (
                  <button
                    type="button"
                    onClick={() =>
                      handleOptimize(
                        route
                      )
                    }
                    style={{
                      width:
                        "100%",

                      marginTop:
                        14,

                      padding:
                        "17px 18px",

                      border:
                        "none",

                      borderRadius:
                        15,

                      background:
                        "#22c55e",

                      color:
                        "#052e16",

                      fontSize:
                        17,

                      fontWeight:
                        900,
                    }}
                  >
                    ⚡ Otimizar
                    rota e navegar
                  </button>
                )}

                <div
                  style={{
                    display:
                      "flex",

                    gap:
                      8,

                    marginTop:
                      14,
                  }}
                >
                  <button
                    type="button"
                    onClick={() =>
                      handleRename(
                        route
                      )
                    }
                    style={{
                      flex:
                        1,

                      padding:
                        11,
                    }}
                  >
                    ✏️ Renomear
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleDelete(
                        route
                      )
                    }
                    style={{
                      flex:
                        1,

                      padding:
                        11,
                    }}
                  >
                    🗑️ Excluir
                  </button>
                </div>
              </section>
            );
          }
        )}
      </div>

    </main>
  );
}
