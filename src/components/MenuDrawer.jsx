import { subscriptionsEnabled } from "../services/subscriptionPurchases";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { Home, LayoutDashboard, Package, History, UserRound, LogOut, X, ChevronRight } from "lucide-react";

const entries = [
  { to: "/", label: "Início", icon: Home },
  { to: "/painel", label: "Painel", icon: LayoutDashboard },
  { to: "/entregas", label: "Entregas", icon: Package },
  { to: "/historico", label: "Histórico", icon: History },
];

const styles = `
.darota-menu-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.65);backdrop-filter:blur(4px);display:flex;justify-content:flex-end;padding:12px;padding-top:max(12px,env(safe-area-inset-top));padding-bottom:max(12px,env(safe-area-inset-bottom))}
.darota-menu-panel{width:min(340px,100%);height:100%;overflow:auto;border-radius:24px;background:var(--panel-solid,#0f172a);color:var(--text,#f8fafc);border:1px solid var(--line,rgba(255,255,255,.1));box-shadow:-12px 0 60px rgba(0,0,0,.3);padding:24px 18px;display:flex;flex-direction:column;gap:26px}
.darota-menu-header{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:0 6px}
.darota-menu-brand{font-size:12px;font-weight:800;letter-spacing:2px;color:var(--orange2,#2563eb)}
.darota-menu-header h2{margin:6px 0 0;font-size:26px;line-height:1.2;letter-spacing:-.5px}
.darota-menu-close{display:grid;place-items:center;flex-shrink:0;width:44px;height:44px;padding:0;border-radius:14px;border:1px solid var(--line,rgba(255,255,255,.1));background:var(--panel-soft,#111c2e);color:inherit}
.darota-menu-nav{display:flex;flex-direction:column;gap:8px}
.darota-menu-item{display:flex;align-items:center;gap:14px;min-height:60px;padding:12px;border-radius:16px;color:var(--text,#f8fafc);text-decoration:none;border:1px solid transparent;font-size:16px;font-weight:600}
.darota-menu-icon{display:grid;place-items:center;width:40px;height:40px;flex-shrink:0;border-radius:12px;background:var(--panel-soft,#111c2e);color:var(--muted,#94a3b8)}
.darota-menu-item.active{background:rgba(37,99,235,.14);border-color:rgba(37,99,235,.25)}
.darota-menu-item.active .darota-menu-icon{background:#2563eb;color:white}
.darota-menu-arrow{margin-left:auto;color:var(--muted,#94a3b8);flex-shrink:0}
.darota-menu-account{border-top:1px solid var(--line,rgba(255,255,255,.1));padding-top:20px}
.darota-menu-caption{display:block;font-size:11px;font-weight:700;letter-spacing:1.5px;color:var(--muted,#94a3b8);padding:0 12px 10px}
.darota-menu-label{display:flex;flex-direction:column;gap:4px}
.darota-menu-label small{font-size:12px;font-weight:400;color:var(--muted,#94a3b8)}
.darota-menu-footer{margin-top:auto;border-top:1px solid var(--line,rgba(255,255,255,.1));padding-top:18px}
.darota-menu-logout{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:52px;border-radius:16px;border:1px solid var(--line,rgba(255,255,255,.1));background:var(--panel-soft,#111c2e);color:var(--text,#f8fafc);font-weight:600}
.darota-menu-item:hover,.darota-menu-close:hover,.darota-menu-logout:hover{background:rgba(37,99,235,.12)}
.darota-menu-panel :focus-visible{outline:3px solid #60a5fa;outline-offset:3px}
`;

export default function MenuDrawer({ open, onClose, onLogout }) {
  const panelRef = useRef(null);
  const closeRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = panelRef.current?.querySelectorAll('a[href],button:not([disabled])');
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="darota-menu-backdrop" onClick={onClose}>
      <style>{styles}</style>
      <aside ref={panelRef} className="darota-menu-panel" role="dialog" aria-modal="true" aria-labelledby="darota-menu-title" onClick={(event) => event.stopPropagation()}>
        <header className="darota-menu-header">
          <div><span className="darota-menu-brand">DaRota</span><h2 id="darota-menu-title">Seu caminho</h2></div>
          <button ref={closeRef} type="button" className="darota-menu-close" aria-label="Fechar menu" onClick={onClose}><X size={22} /></button>
        </header>
        <nav className="darota-menu-nav" aria-label="Menu principal">
          {entries.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === "/"} className="darota-menu-item" onClick={onClose}>
            <span className="darota-menu-icon"><Icon size={21} aria-hidden="true" /></span><span>{label}</span><ChevronRight className="darota-menu-arrow" size={18} aria-hidden="true" />
          </NavLink>)}
        </nav>
        {subscriptionsEnabled() && <NavLink to="/assinatura" className="darota-menu-item" onClick={onClose}>DaRota Premium</NavLink>}
        <section className="darota-menu-account" aria-label="Sua conta">
          <span className="darota-menu-caption">SUA CONTA</span>
          <NavLink to="/excluir-conta" className="darota-menu-item" onClick={onClose}>
            <span className="darota-menu-icon"><UserRound size={21} aria-hidden="true" /></span><span className="darota-menu-label">Minha conta<small>Opção de excluir conta</small></span><ChevronRight className="darota-menu-arrow" size={18} aria-hidden="true" />
          </NavLink>
        </section>
        <section className="darota-menu-account" aria-label="Privacidade">
          <a href="https://sites.google.com/view/darota-poltica-de-privacidade/home" target="_blank" rel="noopener noreferrer" className="darota-menu-item" onClick={onClose}>
            <span className="darota-menu-icon"><UserRound size={21} aria-hidden="true" /></span>
            <span className="darota-menu-label">Política de Privacidade<small>Como seus dados são utilizados</small></span>
            <ChevronRight className="darota-menu-arrow" size={18} aria-hidden="true" />
          </a>
        </section>
        <footer className="darota-menu-footer"><button type="button" className="darota-menu-logout" onClick={() => { onClose(); onLogout(); }}><LogOut size={19} aria-hidden="true" />Sair da conta</button></footer>
      </aside>
    </div>, document.body
  );
}

