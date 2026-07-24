import { useEffect, useState } from "react"

export default function SplashScreen() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVisible(false)
    }, 2200)

    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="splash-screen" aria-label="Carregando Rota Certa PRO">
      <div className="splash-content">
        <img
          src="/rota-certa-splash-768.png"
          alt="Rota Certa PRO - Planeje. Navegue. Entregue."
          className="splash-logo-premium"
        />

        <div className="splash-loading">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}