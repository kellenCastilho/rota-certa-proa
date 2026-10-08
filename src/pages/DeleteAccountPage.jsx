import { useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { deleteOwnAccount } from "../services/accountDeletion";

export default function DeleteAccountPage({ user, onDeleted }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);
  const running = useRef(false);
  async function submit(event) {
    event.preventDefault();
    if (running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      if (!user) {
        const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw new Error("Não foi possível entrar. Confira o e-mail e a senha.");
        setPassword(""); return;
      }
      if (confirmation !== "EXCLUIR" || !agreed) throw new Error("Leia o aviso e digite EXCLUIR para confirmar.");
      await deleteOwnAccount({ email: user.email, password, expectedUserId: user.id });
      setPassword(""); setDeleted(true); onDeleted?.();
    } catch (e) { setError(e.message || "Não foi possível concluir a solicitação."); }
    finally { running.current = false; setBusy(false); }
  }
  const button = { width: "100%", padding: 14, marginTop: 18, borderRadius: 12, border: 0, color: "white", fontWeight: 800 };
  return (
    <main className="page">
      <section className="premium-card" style={{ maxWidth: 520, margin: "24px auto", padding: 24 }}>
        <span className="eyebrow">DaRota • Minha conta</span>
        <h1>{deleted ? "Conta excluída" : "Excluir minha conta"}</h1>
        {deleted ? <>
          <p role="status">Sua conta e os dados vinculados foram excluídos. Você não poderá recuperar suas rotas e entregas.</p>
          <NavLink to="/">Voltar ao início</NavLink>
        </> : <>
          <p>Você pode excluir sua conta DaRota e seus dados por esta página, sem precisar instalar o aplicativo.</p>
          <p>Se você tem uma assinatura pela Apple, excluir a conta DaRota não cancela a renovação. Você pode <a href="https://apps.apple.com/account/subscriptions">gerenciar ou cancelar a assinatura na Apple</a> antes de excluir sua conta.</p>
          <p>A exclusão remove seu cadastro, entregas, endereços, pastas de rotas e histórico vinculados à conta. Ela é permanente.</p>
          {!user ? <p>Entre na conta que deseja excluir. Entrar não apaga nenhum dado.</p> : <p><strong>Conta:</strong> {user.email}</p>}
          <form onSubmit={submit}>
            {!user && <label>E-mail da conta
              <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} disabled={busy} />
            </label>}
            <label style={{ display: "block", marginTop: 14 }}>{user ? "Confirme sua senha" : "Senha"}
              <input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />
            </label>
            {user && <>
              <label style={{ display: "block", marginTop: 14 }}>Digite EXCLUIR para confirmar
                <input autoComplete="off" spellCheck={false} required value={confirmation} onChange={e => setConfirmation(e.target.value)} disabled={busy} />
              </label>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 18 }}>
                <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} disabled={busy} style={{ width: 20, marginTop: 3 }} />
                <span>Entendo que minha conta, rotas, entregas e histórico serão apagados permanentemente.</span>
              </label>
            </>}
            {error && <p className="error" role="alert">{error}</p>}
            <button type="submit" disabled={busy || (user && (!agreed || confirmation !== "EXCLUIR"))} style={{ ...button, background: user ? "#b91c1c" : "#2563eb" }}>
              {busy ? "Aguarde..." : user ? "Excluir definitivamente minha conta" : "Entrar para continuar"}
            </button>
          </form>
          <p style={{ marginTop: 20 }}>Não consegue acessar sua conta? Solicite a exclusão pelo <a href="mailto:darotapro@gmail.com?subject=Excluir%20conta%20DaRota">atendimento DaRota</a>, informando o e-mail cadastrado. O atendimento confirmará sua identidade e informará o prazo para concluir o pedido. Não envie sua senha.</p>
          <NavLink to="/" style={{ display: "inline-block", marginTop: 12 }}>Cancelar e voltar</NavLink>
        </>}
      </section>
    </main>
  );
}

