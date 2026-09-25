import { useNavigate } from "react-router-dom";

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    address
  )}`;
}

function routeUrl(deliveries) {
  const pending = deliveries.filter(
    (delivery) => !delivery.completed && delivery.address
  );

  if (!pending.length) return "";

  const origin = pending[0].address;
  const destination = pending[pending.length - 1].address;

  const middle = pending
    .slice(1, -1)
    .map((delivery) => delivery.address);

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
}

export default function Dashboard({ deliveries }) {
  const navigate = useNavigate();

  const completed = deliveries.filter(
    (delivery) => delivery.completed
  ).length;

  const pending = deliveries.length - completed;

  const next = deliveries.find(
    (delivery) => !delivery.completed
  );

  const progress = deliveries.length
    ? Math.round(
        (completed / deliveries.length) * 100
      )
    : 0;

  const stats = [
    ["📦", deliveries.length, "Entregas hoje"],
    ["✅", completed, "Concluídas"],
    ["📍", pending, "Restantes"],
    ["⚡", `${progress}%`, "Progresso"],
  ];
    return (
    <main className="page dashboard-page">
      <section className="hero premium-hero">
        <div className="hero-copy">
          <h1>🚚 ROTA CERTA PRO</h1>

          <p className="hero-slogan">
            Todas as suas entregas.
            <br />
            Uma única rota.
          </p>

          <div className="hero-actions">
            <button
              className="hero-primary scan-button"
              onClick={() => navigate("/escanear")}
            >
              <span className="scan-icon">📷</span>

              <span className="scan-text">
                <strong>ESCANEAR ETIQUETA</strong>
                <small>
                  A forma mais rápida de adicionar entregas
                </small>
              </span>
            </button>

            <button
              className="hero-secondary"
              onClick={() => navigate("/nova-entrega")}
            >
              ⌨️ Digitar endereço
            </button>
          </div>

          <div className="progress-block">
            <div className="progress-label">
              <span>Progresso do dia</span>
              <strong>{progress}%</strong>
            </div>

            <div className="progress-track">
              <span style={{ width: `${progress}%` }} />
            </div>

            <small>
              {completed} de {deliveries.length} entregas concluídas
            </small>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <div className="road-line" />
          <span className="floating-truck">🚚</span>
          <span className="floating-box box-one">📦</span>
          <span className="floating-box box-two">📦</span>
        </div>
      </section>

      <section className="stats-grid">
        {stats.map(([icon, value, label], index) => (
          <article
            className="stat-card"
            key={label}
            style={{ animationDelay: `${index * 70}ms` }}
          >
            <span className="stat-icon">{icon}</span>
            <strong>{value}</strong>
            <small>{label}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <div className="quick-panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">ATALHOS</span>
              <h2>Ações rápidas</h2>
            </div>
          </div>

          <div className="action-grid">
            <button
              className="action primary"
              onClick={() => navigate("/nova-entrega")}
            >
              <span>➕</span>
              <div>
                <strong>Nova entrega</strong>
                <small>Cadastrar uma parada</small>
              </div>
            </button>

            <button
              className="action"
              onClick={() => navigate("/entregas")}
            >
              <span>📦</span>
              <div>
                <strong>Minhas entregas</strong>
                <small>Editar e concluir</small>
              </div>
            </button>

            <button
              className="action"
              onClick={() => navigate("/mapa")}
            >
              <span>🗺️</span>
              <div>
                <strong>Otimizar rota</strong>
                <small>Ordenar as paradas</small>
              </div>
            </button>

            <button
              className="action"
              onClick={() => {
                const url = routeUrl(deliveries);

                if (!url) {
                  alert("Cadastre uma entrega pendente.");
                  return;
                }

                window.open(url, "_blank");
              }}
            >
              <span>🧭</span>
              <div>
                <strong>Google Maps</strong>
                <small>Abrir navegação</small>
              </div>
            </button>
          </div>
        </div>

        <section className="next-stop premium-next">
          <div className="next-top">
            <span className="eyebrow">PRÓXIMA PARADA</span>

            <span className={`status-pill ${next ? "" : "muted"}`}>
              {next ? "Pendente" : "Livre"}
            </span>
          </div>

          {next ? (
            <>
              <div className="next-icon">📍</div>

              <h3>{next.address}</h3>

              <p>
                {next.customer || "Cliente não informado"}
              </p>

              <button
                onClick={() =>
                  window.open(
                    mapsUrl(next.address),
                    "_blank"
                  )
                }
              >
                🧭 Navegar agora
              </button>
            </>
          ) : (
            <>
              <div className="next-icon">🎉</div>

              <h3>Nenhuma entrega pendente</h3>

              <p>
                Você concluiu tudo ou ainda não cadastrou
                entregas.
              </p>

              <button
                onClick={() => navigate("/nova-entrega")}
              >
                Adicionar entrega
              </button>
            </>
          )}
        </section>
      </section>
    </main>
  );
}