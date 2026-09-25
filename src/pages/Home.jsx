import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
} from "react-leaflet";

import { importSpreadsheet } from "../services/importSpreadsheet";

const DEFAULT_CENTER = [-18.9186, -48.2772];

export default function Home({
  deliveries,
  setDeliveries,
}) {
  const navigate = useNavigate();

  const fileInputRef = useRef(null);

  const [origin, setOrigin] = useState(null);

  const [locationMessage, setLocationMessage] =
    useState("Obtendo sua localização...");

  const [listening, setListening] = useState(false);

  const [voiceMessage, setVoiceMessage] =
    useState("");

  const [importing, setImporting] =
    useState(false);

  const [importMessage, setImportMessage] =
    useState("");

  // ==========================================
  // HOME: SOMENTE ENTREGAS SEM PASTA
  // ==========================================

  const pending = deliveries.filter(
    (delivery) =>
      !delivery.completed &&
      !delivery.rotaId
  );

  function finishCurrentRoute() {
    const confirmed = window.confirm(
      `Finalizar esta rota e concluir ${pending.length} ${
        pending.length === 1 ? "entrega" : "entregas"
      }?`
    );

    if (!confirmed) return;

    const pendingIds = new Set(
      pending.map((delivery) => delivery.id)
    );

    setDeliveries((current) =>
      current.map((delivery) =>
        pendingIds.has(delivery.id)
          ? { ...delivery, completed: true }
          : delivery
      )
    );

    alert(
      pending.length === 1
        ? "✅ Rota finalizada! A entrega foi enviada para o Histórico."
        : "✅ Rota finalizada! As entregas foram enviadas para o Histórico."
    );
  }

  // ==========================================
  // FALAR
  // ==========================================

  function startVoice() {
    const SpeechRecognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      alert(
        "Reconhecimento de voz não disponível neste navegador."
      );
      return;
    }

    const recognition =
      new SpeechRecognition();

    recognition.lang = "pt-BR";
    recognition.interimResults = false;
    recognition.continuous = false;

    setListening(true);

    setVoiceMessage(
      "🎤 Pode falar o endereço..."
    );

    recognition.onresult = (event) => {
      const address =
        event.results[0][0].transcript.trim();

      setListening(false);
      setVoiceMessage("");

      navigate("/nova-entrega", {
        state: {
          voiceAddress: address,
        },
      });
    };

    recognition.onerror = () => {
      setListening(false);

      setVoiceMessage(
        "Não consegui entender. Tente novamente."
      );
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.start();
  }

  // ==========================================
  // IMPORTAR
  // ==========================================

  function openSpreadsheetPicker() {
    fileInputRef.current?.click();
  }

  async function handleSpreadsheetChange(
    event
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setImporting(true);

      setImportMessage(
        "📊 Lendo sua planilha..."
      );

      const result =
        await importSpreadsheet(file);

      if (
        typeof setDeliveries !==
        "function"
      ) {
        throw new Error(
          "A função para salvar as entregas ainda não foi conectada."
        );
      }

      let addedCount = 0;
      let duplicateCount = 0;

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
            result.deliveries.filter(
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
                  duplicateCount += 1;
                  return false;
                }

                if (
                  packageCode
                ) {
                  existingPackageCodes.add(
                    packageCode
                  );
                }

                addedCount += 1;

                return true;
              }
            );

          return [
            ...current,
            ...newDeliveries,
          ];
        }
      );

      const sourceLabel =
        result.source &&
        result.source !==
          "Planilha"
          ? ` da ${result.source}`
          : "";

      setImportMessage(
        `✅ ${addedCount} novas entregas${sourceLabel} importadas${
          duplicateCount
            ? ` • ${duplicateCount} repetidas ignoradas`
            : ""
        }.`
      );

      alert(
        [
          "✅ Planilha importada!",
          "",
          `${addedCount} novas entregas adicionadas.`,

          duplicateCount
            ? `${duplicateCount} entregas repetidas foram ignoradas.`
            : "",

          result.ignoredRows > 0
            ? `${result.ignoredRows} linhas ignoradas.`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (error) {
      console.error(
        "Erro ao importar planilha:",
        error
      );

      setImportMessage(
        "Não foi possível importar essa planilha."
      );

      alert(
        error?.message ||
          "Não foi possível importar a planilha."
      );
    } finally {
      setImporting(false);

      event.target.value =
        "";
    }
  }

  // ==========================================
  // LOCALIZAÇÃO
  // ==========================================

  useEffect(() => {
    if (
      !navigator.geolocation
    ) {
      setLocationMessage(
        "Localização não disponível."
      );

      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({
          lat:
            position.coords.latitude,

          lng:
            position.coords.longitude,
        });

        setLocationMessage(
          "Sua localização"
        );
      },

      () => {
        setLocationMessage(
          "Permita o acesso à localização para ver onde você está."
        );
      },

      {
        enableHighAccuracy:
          true,

        timeout:
          10000,
      }
    );
  }, []);

  return (
    <main className="page home-page">

      {/* ====================================== */}
      {/* MAPA DA HOME */}
      {/* ====================================== */}

      <section className="home-map-card">
        <div className="home-map-header">
          <div>
            <span className="eyebrow">
              ROTA CERTA PRO
            </span>

            <h1>
              Pronto para começar?
            </h1>

            <p>
              Adicione suas paradas
              e monte a melhor rota.
            </p>
          </div>
        </div>

        <div className="home-map-wrapper">
          <MapContainer
            key={
              origin
                ? `${origin.lat}-${origin.lng}`
                : "default"
            }
            center={
              origin
                ? [
                    origin.lat,
                    origin.lng,
                  ]
                : DEFAULT_CENTER
            }
            zoom={
              origin
                ? 15
                : 12
            }
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
          </MapContainer>

          <div className="home-location-status">
            📍{" "}
            {locationMessage}
          </div>
        </div>
      </section>

      {/* ====================================== */}
      {/* ADICIONAR PARADA AVULSA */}
      {/* ====================================== */}

      <section className="home-add-stop">
        <div className="home-section-title">
          <div>
            <span className="eyebrow">
              COMEÇAR
            </span>

            <h2>
              Como você quer adicionar?
            </h2>
          </div>

          <span className="home-stop-count">
            {pending.length}{" "}
            {pending.length ===
            1
              ? "parada"
              : "paradas"}
          </span>
        </div>

        <div className="home-add-options">

          <button
            type="button"
            className="home-add-button"
            onClick={() =>
              navigate(
                "/nova-entrega"
              )
            }
          >
            <span>
              ⌨️
            </span>

            <strong>
              Digitar
            </strong>

            <small>
              Digite o endereço
            </small>
          </button>

          <button
            type="button"
            className="home-add-button"
            onClick={() =>
              navigate(
                "/escanear"
              )
            }
          >
            <span>
              📷
            </span>

            <strong>
              Escanear
            </strong>

            <small>
              Leia a etiqueta
            </small>
          </button>

          <button
            type="button"
            className="home-add-button featured"
            onClick={
              startVoice
            }
          >
            <span>
              🎤
            </span>

            <strong>
              Falar
            </strong>

            <small>
              Dite o endereço
            </small>
          </button>

          <button
            type="button"
            className="home-add-button"
            onClick={
              openSpreadsheetPicker
            }
            disabled={
              importing
            }
          >
            <span>
              📊
            </span>

            <strong>
              {importing
                ? "Importando..."
                : "Importar"}
            </strong>

            <small>
              Planilha de entregas
            </small>
          </button>
        </div>

        {/* ====================================== */}
        {/* PASTAS / BAIRROS - RESTAURADO */}
        {/* ====================================== */}

        <button
          type="button"
          className="home-neighborhood-button"
          onClick={() =>
            navigate("/rotas")
          }
        >
          <span className="home-neighborhood-icon">
            📁
          </span>

          <div>
            <strong>
              Organizar por bairros
            </strong>

            <small>
              Importe tudo e crie as pastas automaticamente
            </small>
          </div>

          <span className="home-neighborhood-arrow">
            ›
          </span>
        </button>

        <input
          ref={
            fileInputRef
          }
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/tab-separated-values"
          onChange={
            handleSpreadsheetChange
          }
          style={{
            display:
              "none",
          }}
        />

        {(listening ||
          voiceMessage) && (
          <div className="home-voice-message">
            {voiceMessage}
          </div>
        )}

        {importMessage && (
          <div className="home-voice-message">
            {importMessage}
          </div>
        )}
      </section>

      {/* ====================================== */}
      {/* SOMENTE ENTREGAS SEM PASTA */}
      {/* ====================================== */}

      {pending.length >
        0 && (
        <section className="home-stops">

          <div className="home-section-title">
            <div>
              <span className="eyebrow">
                SUAS PARADAS
              </span>

              <h2>
                Entregas de hoje
              </h2>
            </div>
          </div>

          <div className="home-stop-list">
            {pending.map(
              (
                delivery,
                index
              ) => (
                <article
                  className="home-stop-item"
                  key={
                    delivery.id
                  }
                >
                  <span className="home-stop-number">
                    {index +
                      1}
                  </span>

                  <div>
                    <strong>
                      {delivery.customer ||
                        "Entrega"}
                    </strong>

                    <small>
                      {delivery.address ||
                        "Endereço não informado"}
                    </small>
                  </div>
                </article>
              )
            )}
          </div>

          <button
            type="button"
            className="home-continue-button"
            onClick={() =>
              navigate(
                "/mapa",
                {
                  state: {
                    autoPrepare:
                      true,
                  },
                }
              )
            }
          >
            ✅ Continuar com{" "}
            {pending.length}{" "}
            {pending.length ===
            1
              ? "parada"
              : "paradas"}
          </button>

          <button
            type="button"
            className="home-finish-route-button"
            onClick={finishCurrentRoute}
          >
            🏁 Finalizar esta rota
          </button>

        </section>
      )}
    </main>
  );
}
