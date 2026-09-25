import { NavLink } from "react-router-dom";

export default function MenuDrawer({
  open,
  onClose,
  onLogout,
}) {
  if (!open) return null;

  return (
    <div
      className="menu-overlay"
      onClick={onClose}
    >
      <aside
        className="menu-drawer"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="menu-drawer-header">
          <div>
            <span className="eyebrow">ROTA CERTA PRO</span>
            <h2>Menu</h2>
          </div>

          <button
            type="button"
            className="menu-close"
            onClick={onClose}
            aria-label="Fechar menu"
          >
            ×
          </button>
        </div>

        <nav className="menu-links">
          <NavLink to="/" onClick={onClose}>
            🏠 Início
          </NavLink>

          <NavLink to="/painel" onClick={onClose}>
            📊 Painel
          </NavLink>

          <NavLink to="/entregas" onClick={onClose}>
            📦 Entregas
          </NavLink>

          <NavLink to="/historico" onClick={onClose}>
            📈 Histórico
          </NavLink>
        </nav>

        <button
          type="button"
          className="menu-logout"
          onClick={onLogout}
        >
          🚪 Sair
        </button>
      </aside>
    </div>
  );
}