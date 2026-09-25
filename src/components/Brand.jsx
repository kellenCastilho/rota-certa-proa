import logo from '../assets/logo.svg'

export default function Brand({ compact = false }) {
  return (
    <span className="official-brand">
      <img src={logo} alt="" className="official-logo" />
      {!compact && (
        <span className="official-brand-text">
          <strong>Rota Certa <b>PRO</b></strong>
          <small>Organize. Entregue. Evolua.</small>
        </span>
      )}
    </span>
  )
}
