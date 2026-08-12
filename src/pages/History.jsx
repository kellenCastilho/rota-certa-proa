export default function History({ deliveries, setDeliveries }) {
  const completed = deliveries.filter((delivery) => delivery.completed);

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <span className="eyebrow">CONCLUÍDAS</span>
          <h1>Histórico</h1>
          <p>Entregas finalizadas no dispositivo.</p>
        </div>
      </div>

      {completed.length === 0 ? (
        <section className="empty-card premium-card">
          <div>📊</div>
          <h2>Nenhuma entrega concluída</h2>
          <p>As entregas finalizadas aparecerão aqui.</p>
        </section>
      ) : (
        <section className="delivery-list">
          {completed.map((delivery) => (
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
                    onClick={() =>
                      setDeliveries((list) =>
                        list.map((item) =>
                          item.id === delivery.id
                            ? { ...item, completed: false }
                            : item
                        )
                      )
                    }
                  >
                    ↩ Reabrir
                  </button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
