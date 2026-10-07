import { useState } from "react";

import {
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  geocodeAddress as geocodeAddressService,
  getLocationContext,
} from "../services/geocoding";

export default function DeliveryForm({
  deliveries,
  onSave,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  const editing = id
    ? deliveries.find(
        (delivery) =>
          String(delivery.id) === id
      )
    : null;

  /*
   * 📁 Pasta / rota
   *
   * Pode vir:
   * - de uma entrega já existente
   * - da tela "Minhas Rotas"
   */
  const rotaId =
    editing?.rotaId ||
    location.state?.rotaId ||
    null;

  const rotaNome =
    location.state?.rotaNome ||
    "";

  const [form, setForm] =
    useState({
      customer:
        editing?.customer || "",

      address:
        editing?.address ||
        location.state
          ?.voiceAddress ||
        "",

      phone:
        editing?.phone || "",

      notes:
        editing?.notes || "",
    });

  const [
    saving,
    setSaving,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState("");

  function update(event) {
    setForm((current) => ({
      ...current,

      [event.target.name]:
        event.target.value,
    }));

    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    if (saving) return;

    if (!form.address.trim()) {
      setError(
        "Digite o endereço."
      );

      return;
    }

    if (
      typeof onSave !==
      "function"
    ) {
      setError(
        "Não foi possível salvar a entrega."
      );

      return;
    }

    setSaving(true);
    setError("");

    let origin = null;
    let locationContext =
      null;

    /*
     * Tenta obter a localização
     * atual para melhorar a
     * geocodificação.
     */
    if (
      navigator.geolocation
    ) {
      try {
        origin =
          await new Promise(
            (
              resolve,
              reject
            ) => {
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

                reject,

                {
                  enableHighAccuracy:
                    true,

                  timeout: 5000,

                  maximumAge:
                    60000,
                }
              );
            }
          );

        locationContext =
          await getLocationContext(
            origin
          );
      } catch (error) {
        console.warn(
          "Não foi possível obter a localização atual:",
          error
        );
      }
    }

    const addressChanged =
      Boolean(editing) &&
      form.address.trim() !==
        (editing.address || "").trim();

    let coords = addressChanged
      ? null
      : editing?.coords || null;

    try {
      coords =
        await geocodeAddressService(
          form.address.trim(),

          {
            context:
              locationContext,

            origin,
          }
        );
    } catch (error) {
      console.warn(
        "Não foi possível localizar o endereço agora:",
        error
      );

      /*
       * Não impede o cadastro.
       * O mapa poderá tentar
       * localizar novamente.
       */
    }

    const delivery = {
      ...(editing || {}),

      id:
        editing?.id ||
        crypto.randomUUID(),

      customer:
        form.customer.trim(),

      address:
        form.address.trim(),

      phone:
        form.phone.trim(),

      notes:
        form.notes.trim(),

      completed:
        editing?.completed ||
        false,

      createdAt:
        editing?.createdAt ||
        new Date().toISOString(),

      coords,

      priority:
        editing?.priority ||
        "normal",

      /*
       * 📁 IMPORTANTE
       *
       * Mantém a entrega dentro
       * da pasta escolhida.
       */
      rotaId,
    };

    let saved;
    try {
      saved = await onSave(delivery);
    } catch {
      setError("Não foi possível salvar a entrega. Tente novamente.");
      return;
    } finally {
      setSaving(false);
    }
    if (!saved?.ok) return;

    /*
     * Se veio de uma pasta,
     * volta para Minhas Rotas.
     *
     * Se foi cadastro normal,
     * volta para Início.
     */
    if (rotaId) {
      navigate("/rotas");
    } else {
      navigate("/");
    }
  }

  return (
    <main className="page">
      <section className="form-card premium-card">
        <div className="form-heading">
          <button
            className="back-button"
            type="button"
            onClick={() =>
              navigate(-1)
            }
          >
            ←
          </button>

          <div>
            <span className="eyebrow">
              {editing
                ? "EDIÇÃO"
                : rotaId
                ? "ADICIONAR À ROTA"
                : "CADASTRO"}
            </span>

            <h1>
              {editing
                ? "Editar entrega"
                : "Nova entrega"}
            </h1>

            {rotaId &&
            rotaNome ? (
              <p>
                📁 Esta entrega
                será adicionada em{" "}
                <strong>
                  {rotaNome}
                </strong>
              </p>
            ) : (
              <p>
                Preencha os dados
                da próxima parada.
              </p>
            )}
          </div>
        </div>

        {rotaId &&
          rotaNome && (
            <div
              style={{
                marginBottom: 20,

                padding:
                  "14px 16px",

                borderRadius: 14,

                background:
                  "rgba(37, 99, 235, 0.12)",

                border:
                  "1px solid rgba(59, 130, 246, 0.45)",
              }}
            >
              <small
                style={{
                  display:
                    "block",

                  opacity: 0.7,

                  marginBottom:
                    4,
                }}
              >
                📁 PASTA
                SELECIONADA
              </small>

              <strong
                style={{
                  fontSize: 18,
                }}
              >
                {rotaNome}
              </strong>
            </div>
          )}

        <form
          onSubmit={submit}
        >
          <label>
            Cliente

            <input
              name="customer"
              value={
                form.customer
              }
              onChange={update}
              placeholder="Nome do cliente"
            />
          </label>

          <label>
            Endereço completo *

            <input
              name="address"
              value={
                form.address
              }
              onChange={update}
              placeholder="Rua, número, bairro, cidade e estado"
            />
          </label>

          <label>
            Telefone

            <input
              name="phone"
              value={
                form.phone
              }
              onChange={update}
              placeholder="(34) 99999-9999"
            />
          </label>

          <label>
            Observações

            <textarea
              name="notes"
              value={
                form.notes
              }
              onChange={update}
              placeholder="Referência, horário ou instruções..."
            />
          </label>

          {error && (
            <div className="error">
              {error}
            </div>
          )}

          <button
            className="save-button"
            disabled={saving}
          >
            {saving
              ? "Salvando..."
              : rotaId &&
                rotaNome
              ? `Salvar em ${rotaNome}`
              : "Salvar entrega"}
          </button>
        </form>
      </section>
    </main>
  );
}
