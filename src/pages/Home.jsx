import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
} from "react-leaflet";

const DEFAULT_CENTER = [-18.9186, -48.2772];

export default function Home({ deliveries }) {
  const navigate = useNavigate();

  const [origin, setOrigin] = useState(null);
  const [locationMessage, setLocationMessage] =
    useState("Obtendo sua localização...");
  const [listening, setListening] = useState(false);
const [voiceMessage, setVoiceMessage] = useState("");  
function startVoice() {
  const SpeechRecognition =
    window.SpeechRecognition ||
    window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    alert("Reconhecimento de voz não disponível neste navegador.");
    return;
  }

  const recognition = new SpeechRecognition();

  recognition.lang = "pt-BR";
  recognition.interimResults = false;
  recognition.continuous = false;

  setListening(true);
  setVoiceMessage("🎤 Pode falar o endereço...");

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
  const pending = deliveries.filter(
    (delivery) => !delivery.completed
  );

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationMessage("Localização não disponível.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrigin({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });

        setLocationMessage("Sua localização");
      },
      () => {
        setLocationMessage(
          "Permita o acesso à localização para ver onde você está."
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      }
    );
  }, []);
    return (
    <main className="page home-page">
      <section className="home-map-card">
        <div className="home-map-header">
          <div>
            <span className="eyebrow">ROTA CERTA PRO</span>
            <h1>Pronto para começar?</h1>
            <p>Adicione suas paradas e monte a melhor rota.</p>
          </div>
        </div>

        <div className="home-map-wrapper">
          <MapContainer
            key={origin ? `${origin.lat}-${origin.lng}` : "default"}
            center={
              origin
                ? [origin.lat, origin.lng]
                : DEFAULT_CENTER
            }
            zoom={origin ? 15 : 12}
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
          </MapContainer>

          <div className="home-location-status">
            📍 {locationMessage}
          </div>
        </div>
      </section>

      <section className="home-add-stop">
        <div className="home-section-title">
          <div>
            <span className="eyebrow">NOVA ROTA</span>
            <h2>+ Adicionar parada</h2>
          </div>

          <span className="home-stop-count">
            {pending.length}{" "}
            {pending.length === 1 ? "parada" : "paradas"}
          </span>
        </div>

        <div className="home-add-options">
          <button
            type="button"
            className="home-add-button"
            onClick={() => navigate("/nova-entrega")}
          >
            <span>⌨️</span>
            <strong>Digitar</strong>
            <small>Digite o endereço</small>
          </button>

          <button
            type="button"
            className="home-add-button featured"
            onClick={() => navigate("/escanear")}
          >
            <span>📷</span>
            <strong>Escanear</strong>
            <small>Leia a etiqueta</small>
          </button>

          <button
       onClick={startVoice}
          >
            <span>🎤</span>
            <strong>Falar</strong>
            <small>Dite o endereço</small>
          </button>
        </div>
        {(listening || voiceMessage) && (
  <div className="home-voice-message">
    {voiceMessage}
  </div>
)}
      </section>

      {pending.length > 0 && (
        <section className="home-stops">
          <div className="home-section-title">
            <div>
              <span className="eyebrow">SUAS PARADAS</span>
              <h2>Entregas de hoje</h2>
            </div>
          </div>

          <div className="home-stop-list">
            {pending.map((delivery, index) => (
              <article
                className="home-stop-item"
                key={delivery.id}
              >
                <span className="home-stop-number">
                  {index + 1}
                </span>

                <div>
                  <strong>
                    {delivery.customer || "Entrega"}
                  </strong>

                  <small>
                    {delivery.address ||
                      "Endereço não informado"}
                  </small>
                </div>
              </article>
            ))}
          </div>

          <button
            type="button"
            className="home-continue-button"
            onClick={() =>
  navigate("/mapa", {
    state: { autoPrepare: true },
  })
}
          >
            ✅ Continuar com {pending.length}{" "}
            {pending.length === 1 ? "parada" : "paradas"}
          </button>
        </section>
      )}
    </main>
  );
}