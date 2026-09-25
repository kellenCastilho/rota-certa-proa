export default function History({
  deliveries,
  setDeliveries,
  routes = [],
}) {
  const completed = deliveries.filter(
    (delivery) => delivery.completed
  );

  const routeNameById = new Map(
    routes.map((route) => [String(route.id), route.nome])
  );

  const groups = completed.reduce((result, delivery) => {
    const routeId = delivery.rotaId
      ? String(delivery.rotaId)
      : "avulsas";

    if (!result.has(routeId)) {
      result.set(routeId, {
        id: routeId,
        name:
          routeId === "avulsas"
            ? "Entregas avulsas"
            : routeNameById.get(routeId) || "Bairro / pasta",
        deliveries: [],
      });
    }

    result.get(routeId).deliveries.push(delivery);
    return result;
  }, new Map());

  const historyGroups = Array.from(groups.values());

  function reopenDelivery(deliveryId) {
    setDeliveries((list) =>
      list.map((item) =>
        item.id === deliveryId
          ? { ...item, completed: false }
          : item
      )
    );
  }

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <span className="eyebrow">CONCLUÍDAS</span>
          <h1>Histórico</h1>
          <p>Rotas finalizadas organizadas por bairro ou pasta.</p>
        </div>
      </div>

      {completed.length === 0 ? (
        <section className="empty-card premium-card">
          <div>📊</div>
          <h2>Nenhuma entrega concluída</h2>
          <p>As entregas finalizadas aparecerão aqui.</p>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {historyGroups.map((group) => (
            <section
              key={group.id}
              className="premium-card"
              style={{ padding: 18 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 15,
                }}
              >
                <span style={{ fontSize: 34 }}>📁</span>
                <div>
                  <h2 style={{ margin: 0 }}>Rota • {group.name}</h2>
                  <p style={{ margin: "4px 0 0", opacity: 0.7 }}>
                    {group.deliveries.length}{" "}
                    {group.deliveries.length === 1
                      ? "entrega concluída"
                      : "entregas concluídas"}
                  </p>
                </div>
              </div>

              <div className="delivery-list">
                {group.deliveries.map((delivery) => (
                  <article
                    className="delivery-card premium-card completed"
                    key={delivery.id}
                  >
                    <div className="delivery-number">✓</div>
                    <div className="delivery-content">
                      <strong>{delivery.customer || "Cliente"}</strong>
                      <p>{delivery.address}</p>
                      <div className="delivery-actions">
                        <button
                          type="button"
                          onClick={() => reopenDelivery(delivery.id)}
                        >
                          ↩ Reabrir
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
