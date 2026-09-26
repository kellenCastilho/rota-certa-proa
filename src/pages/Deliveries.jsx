import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

export default function Deliveries({
  deliveries,
  setDeliveries,
}) {
  const navigate = useNavigate();
  const [
    deliverySearch,
    setDeliverySearch,
  ] = useState("");

  const [
    deliveryFilter,
    setDeliveryFilter,
  ] = useState("all");

  const [
    priorityFilter,
    setPriorityFilter,
  ] = useState("all");

  // ==========================================
  // SOMENTE ENTREGAS QUE NÃO ESTÃO EM PASTA
  // ==========================================

  const looseDeliveries =
    deliveries.filter(
      (delivery) =>
        !delivery.rotaId
    );

  const completed =
    looseDeliveries.filter(
      (delivery) =>
        delivery.completed
    ).length;

  const query =
    deliverySearch
      .trim()
      .toLowerCase();

  const filteredDeliveries =
    looseDeliveries.filter(
      (delivery) => {
        const matchesSearch =
          !query ||
          delivery.customer
            ?.toLowerCase()
            .includes(query) ||
          delivery.address
            ?.toLowerCase()
            .includes(query) ||
          delivery.phone
            ?.toLowerCase()
            .includes(query) ||
          delivery.notes
            ?.toLowerCase()
            .includes(query) ||
          String(
            delivery.id
          )
            .toLowerCase()
            .includes(query);

        const matchesStatus =
          deliveryFilter ===
            "all" ||
          (deliveryFilter ===
            "completed" &&
            delivery.completed) ||
          (deliveryFilter ===
            "pending" &&
            !delivery.completed);

        const priority =
          delivery.priority ||
          "normal";

        const matchesPriority =
          priorityFilter ===
            "all" ||
          priority ===
            priorityFilter;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesPriority
        );
      }
    );

  function toggleCompleted(
    deliveryId
  ) {
    setDeliveries(
      (list) =>
        list.map(
          (delivery) =>
            delivery.id ===
            deliveryId
              ? {
                  ...delivery,
                  completed:
                    !delivery.completed,
                }
              : delivery
        )
    );
  }

  function removeDelivery(
    deliveryId
  ) {
    if (
      !window.confirm(
        "Remover esta entrega?"
      )
    ) {
      return;
    }

    setDeliveries(
      (list) =>
        list.filter(
          (delivery) =>
            delivery.id !==
            deliveryId
        )
    );
  }

  return (
    <main className="page">
      <div className="page-title">
        <div>
          <span className="eyebrow">
            SUAS PARADAS
          </span>

          <h1>
            Entregas
          </h1>

          <div className="delivery-tools">
            <label className="delivery-search">
              <span>
                🔎
              </span>

              <input
                value={
                  deliverySearch
                }
                onChange={(
                  event
                ) =>
                  setDeliverySearch(
                    event
                      .target
                      .value
                  )
                }
                placeholder="Buscar por endereço, cliente, telefone ou código"
              />
            </label>

            <select
              value={
                deliveryFilter
              }
              onChange={(
                event
              ) =>
                setDeliveryFilter(
                  event
                    .target
                    .value
                )
              }
            >
              <option value="all">
                Todos os status
              </option>

              <option value="pending">
                Pendentes
              </option>

              <option value="completed">
                Concluídas
              </option>
            </select>

            <select
              value={
                priorityFilter
              }
              onChange={(
                event
              ) =>
                setPriorityFilter(
                  event
                    .target
                    .value
                )
              }
            >
              <option value="all">
                Todas as prioridades
              </option>

              <option value="urgent">
                Urgente
              </option>

              <option value="high">
                Alta
              </option>

              <option value="normal">
                Normal
              </option>

              <option value="low">
                Baixa
              </option>
            </select>
          </div>

          <p>
            {completed}{" "}
            concluídas de{" "}
            {
              looseDeliveries.length
            }
          </p>
        </div>

        <NavLink
          className="mini-add"
          to="/nova-entrega"
        >
          + Adicionar
        </NavLink>
      </div>

      {looseDeliveries.length ===
      0 ? (
        <section className="empty-card premium-card">
          <div>
            📦
          </div>

          <h2>
            Nenhuma entrega
            avulsa
          </h2>

          <p>
            As entregas organizadas
            em bairros ficam dentro
            das respectivas pastas.
          </p>

          <NavLink to="/nova-entrega">
            Nova entrega
          </NavLink>
        </section>
      ) : filteredDeliveries.length ===
        0 ? (
        <section className="empty-card premium-card">
          <div>
            🔎
          </div>

          <h2>
            Nenhum resultado
          </h2>

          <p>
            Altere a busca ou os
            filtros.
          </p>
        </section>
      ) : (
        <section className="delivery-list">
          {filteredDeliveries.map(
            (
              delivery,
              index
            ) => (
              <article
                className={`delivery-card premium-card ${
                  delivery.completed
                    ? "completed"
                    : ""
                }`}
                key={
                  delivery.id
                }
              >
                <div className="delivery-number">
                  {delivery.completed
                    ? "✓"
                    : index +
                      1}
                </div>

                <div className="delivery-content">
                  <div className="delivery-title-row">
                    <strong>
                      {delivery.customer ||
                        "Cliente não informado"}
                    </strong>

                    <span
                      className={`status-pill ${
                        delivery.completed
                          ? "done"
                          : ""
                      }`}
                    >
                      {delivery.completed
                        ? "Entregue"
                        : "Pendente"}
                    </span>
                  </div>

                  <p>
                    {
                      delivery.address
                    }
                  </p>

                  {delivery.notes && (
                    <small className="delivery-note">
                      📝{" "}
                      {
                        delivery.notes
                      }
                    </small>
                  )}

                  <div className="delivery-actions">
                    <button
                      type="button"
                      onClick={() => navigate(`/mapa?auto=1&nav=1&entrega=${encodeURIComponent(delivery.id)}`)}
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
                      type="button"
                      className="complete-button"
                      onClick={() =>
                        toggleCompleted(
                          delivery.id
                        )
                      }
                    >
                      {delivery.completed
                        ? "↩ Reabrir"
                        : "✓ Entregue"}
                    </button>

                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        removeDelivery(
                          delivery.id
                        )
                      }
                    >
                      Remover
                    </button>
                  </div>
                </div>
              </article>
            )
          )}
        </section>
      )}
    </main>
  );
}