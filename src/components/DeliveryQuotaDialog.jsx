import { useEffect, useRef, useState } from "react";

export default function DeliveryQuotaDialog({ request, onResolve }) {
  const [selected, setSelected] = useState([]);
  const [showPlan, setShowPlan] = useState(false);
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  useEffect(() => {
    if (!request) return;
    setSelected([]);
    setShowPlan(false);
    const before = document.activeElement;
    closeRef.current?.focus();
    function key(event) {
      if (event.key === "Escape") { event.preventDefault(); onResolve(null); }
      if (event.key !== "Tab") return;
      const buttons = [...dialogRef.current.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href]')];
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); before?.focus?.(); };
  }, [request, onResolve]);
  if (!request) return null;
  const { candidates, status } = request;
  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < status.remaining ? [...current, id] : current);
  }
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.75)", display: "grid", placeItems: "center", padding: 20 }}>
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="quota-title" style={{ width: "100%", maxWidth: 560, maxHeight: "85vh", overflow: "auto", padding: 24, borderRadius: 20, background: "#0f172a", color: "#f8fafc" }}>
        <button ref={closeRef} type="button" onClick={() => onResolve(null)}>Cancelar</button>
        <h2 id="quota-title">{showPlan ? "DaRota Mensal" : "Escolha suas entregas"}</h2>
        {showPlan ? <>
          <p>Plano previsto: R$ 25,90 por mês para ampliar seu uso do DaRota.</p>
          <p>A assinatura ainda está em preparação. Nenhuma cobrança será feita nesta tela.</p>
          <button type="button" onClick={() => setShowPlan(false)}>Voltar à seleção</button>
        </> : <>
          <p>{candidates.length === 1 ? "Você quer adicionar uma entrega." : `Esta lista tem ${candidates.length} novas entregas.`} Você ainda pode adicionar <strong>{status.remaining}</strong> hoje no plano gratuito.</p>
          <p>O limite é de cinco entregas por dia, por conta. Editar, concluir ou excluir não devolve uma entrega utilizada. O dia renova à meia-noite, no horário de Brasília.</p>
          {status.remaining > 0 && <>
            <p>Selecione até {status.remaining}. As outras não serão adicionadas.</p>
            <div style={{ maxHeight: "35vh", overflow: "auto", border: "1px solid #475569", borderRadius: 12 }}>
              {candidates.map((item) => {
                const id = String(item.id), checked = selected.includes(id);
                return <label key={id} style={{ display: "flex", gap: 12, padding: 12, borderBottom: "1px solid #334155", lineHeight: 1.4 }}>
                  <input type="checkbox" checked={checked} disabled={!checked && selected.length >= status.remaining} onChange={() => toggle(id)} />
                  <span style={{ whiteSpace: "pre-line" }}>{item.address || "Endereço sem identificação"}{item.packageCode ? ` — Pacote ${item.packageCode}` : ""}</span>
                </label>;
              })}
            </div>
            <button type="button" disabled={!selected.length} onClick={() => onResolve(selected)} style={{ marginTop: 16, width: "100%" }}>Adicionar {selected.length} {selected.length === 1 ? "entrega" : "entregas"}</button>
          </>}
          <button type="button" onClick={() => setShowPlan(true)} style={{ marginTop: 12, width: "100%" }}>Conhecer o plano mensal</button>
        </>}
      </section>
    </div>
  );
}
