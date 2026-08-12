import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { geocodeAddress as geocodeAddressService } from "../services/geocoding";

export default function DeliveryForm({ deliveries, onSave }) {
  const navigate = useNavigate();
  const { id } = useParams();

  const editing = id
    ? deliveries.find((delivery) => String(delivery.id) === id)
    : null;

  const [form, setForm] = useState({
    customer: editing?.customer || "",
    address: editing?.address || "",
    phone: editing?.phone || "",
    notes: editing?.notes || "",
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function update(event) {
    setForm((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  async function submit(event) {
    event.preventDefault();

    if (!form.address.trim()) {
      setError("Digite o endereço.");
      return;
    }

    setSaving(true);

    let coords = editing?.coords || null;

    try {
      coords = await geocodeAddressService(form.address.trim());
    } catch {
      // Se não localizar agora, a rota tenta novamente depois.
    }

    onSave({
      id: editing?.id || crypto.randomUUID(),
      customer: form.customer.trim(),
      address: form.address.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim(),
      completed: editing?.completed || false,
      createdAt: editing?.createdAt || new Date().toISOString(),
      coords,
    });

    navigate("/entregas");
  }

  return (
    <main className="page">
      <section className="form-card premium-card">
        <div className="form-heading">
          <button
            className="back-button"
            type="button"
            onClick={() => navigate(-1)}
          >
            ←
          </button>

          <div>
            <span className="eyebrow">
              {editing ? "EDIÇÃO" : "CADASTRO"}
            </span>

            <h1>{editing ? "Editar entrega" : "Nova entrega"}</h1>

            <p>Preencha os dados da próxima parada.</p>
          </div>
        </div>

        <form onSubmit={submit}>
          <label>
            Cliente
            <input
              name="customer"
              value={form.customer}
              onChange={update}
              placeholder="Nome do cliente"
            />
          </label>

          <label>
            Endereço completo *
            <input
              name="address"
              value={form.address}
              onChange={update}
              placeholder="Rua, número, bairro, cidade e estado"
            />
          </label>

          <label>
            Telefone
            <input
              name="phone"
              value={form.phone}
              onChange={update}
              placeholder="(34) 99999-9999"
            />
          </label>

          <label>
            Observações
            <textarea
              name="notes"
              value={form.notes}
              onChange={update}
              placeholder="Referência, horário ou instruções..."
            />
          </label>

          {error && <div className="error">{error}</div>}

          <button className="save-button" disabled={saving}>
            {saving ? "Salvando..." : "Salvar entrega"}
          </button>
        </form>
      </section>
    </main>
  );
}