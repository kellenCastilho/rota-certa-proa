import { useEffect, useState } from 'react'
import Brand from './Brand'

export default function SplashScreen() {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), 1500)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="splash-screen" aria-label="Carregando Rota Certa PRO">
      <div className="splash-content">
        <Brand />
        <div className="splash-road"><span>🚚</span></div>
        <p>Organize. Entregue. Evolua.</p>
      </div>
    </div>
  )
}
