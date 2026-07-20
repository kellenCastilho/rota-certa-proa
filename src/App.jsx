import { useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import Brand from './components/Brand'
import SplashScreen from './components/SplashScreen'

const STORAGE_KEY = 'rota-certa-entregas'
const THEME_KEY = 'rota-certa-tema'
const DEFAULT_CENTER = [-18.9186, -48.2772]

const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
})

function useDeliveries() {
  const [deliveries, setDeliveries] = useState(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [] }
    catch { return [] }
  })
  useEffect(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(deliveries)), [deliveries])
  return [deliveries, setDeliveries]
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

function routeUrl(deliveries) {
  const pending = deliveries.filter((d) => !d.completed && d.address)
  if (!pending.length) return ''
  const origin = pending[0].address
  const destination = pending[pending.length - 1].address
  const middle = pending.slice(1, -1).map((d) => d.address)
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`
  if (middle.length) url += `&waypoints=${encodeURIComponent(middle.join('|'))}`
  return url
}

async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(address)}`
  const response = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } })
  if (!response.ok) throw new Error('Falha ao localizar endereço')
  const data = await response.json()
  if (!data.length) throw new Error('Endereço não encontrado')
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) }
}

async function fetchRoadRoute(points) {
  if (points.length < 2) throw new Error('São necessários pelo menos 2 pontos.')
  const coords = points.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`
  const response = await fetch(url)
  if (!response.ok) throw new Error('Serviço de rota indisponível.')
  const data = await response.json()
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Rota não encontrada.')
  const route = data.routes[0]
  return {
    line: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceKm: route.distance / 1000,
    durationMin: route.duration / 60,
  }
}

function haversineKm(a, b) {
  const R = 6371
  const toRad = (value) => value * Math.PI / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function optimizeLocally(deliveries, origin) {
  const pending = deliveries.filter((d) => !d.completed && d.coords)
  const withoutCoords = deliveries.filter((d) => !d.completed && !d.coords)
  const completed = deliveries.filter((d) => d.completed)
  if (pending.length < 2) throw new Error('Localize pelo menos 2 entregas.')

  const remaining = [...pending]
  const ordered = []
  let current
  if (origin) current = origin
  else {
    const first = remaining.shift()
    ordered.push(first)
    current = first.coords
  }

  while (remaining.length) {
    let bestIndex = 0
    let bestDistance = Infinity
    remaining.forEach((delivery, index) => {
      const distance = haversineKm(current, delivery.coords)
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index }
    })
    const next = remaining.splice(bestIndex, 1)[0]
    ordered.push(next)
    current = next.coords
  }
  return [...ordered, ...withoutCoords, ...completed]
}

async function fetchOptimizedTrip(deliveries, origin) {
  const optimizedDeliveries = optimizeLocally(deliveries, origin)
  const pending = optimizedDeliveries.filter((d) => !d.completed && d.coords)
  const points = [...(origin ? [origin] : []), ...pending.map((d) => d.coords)]
  try {
    const route = await fetchRoadRoute(points)
    return { deliveries: optimizedDeliveries, ...route, usedFallback: false }
  } catch {
    const line = points.map((p) => [p.lat, p.lng])
    let distanceKm = 0
    for (let i = 0; i < points.length - 1; i += 1) distanceKm += haversineKm(points[i], points[i + 1])
    return { deliveries: optimizedDeliveries, line, distanceKm, durationMin: distanceKm / 30 * 60, usedFallback: true }
  }
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

function Dashboard({ deliveries }) {
  const navigate = useNavigate()
  const completed = deliveries.filter((d) => d.completed).length
  const pending = deliveries.length - completed
  const next = deliveries.find((d) => !d.completed)
  const progress = deliveries.length ? Math.round((completed / deliveries.length) * 100) : 0
  const stats = [
    ['📦', deliveries.length, 'Entregas hoje'],
    ['✅', completed, 'Concluídas'],
    ['📍', pending, 'Restantes'],
    ['⚡', `${progress}%`, 'Progresso'],
  ]

  function continueRoute() {
    if (!next) return navigate('/nova-entrega')
    window.open(mapsUrl(next.address), '_blank')
  }

  return <main className="page dashboard-page">
    <section className="hero premium-hero">
      <div className="hero-copy">
        <span className="eyebrow">PAINEL DO MOTORISTA</span>
        <h1>{greeting()}, Kellen! <span className="wave">👋</span></h1>
        <p>Seu dia de entregas está organizado e pronto para começar.</p>
        <div className="progress-block">
          <div className="progress-label"><span>Progresso do dia</span><strong>{progress}%</strong></div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <small>{completed} de {deliveries.length} entregas concluídas</small>
        </div>
        <div className="hero-actions">
          <button className="hero-primary" onClick={continueRoute}>{next ? '▶ Continuar rota' : '+ Criar primeira entrega'}</button>
          <button className="hero-secondary" onClick={() => navigate('/mapa')}>🗺️ Abrir mapa</button>
        </div>
      </div>
      <div className="hero-visual" aria-hidden="true"><div className="road-line" /><span className="floating-truck">🚚</span><span className="floating-box box-one">📦</span><span className="floating-box box-two">📦</span></div>
    </section>

    <section className="stats-grid">
      {stats.map(([icon, value, label], index) => <article className="stat-card" key={label} style={{ animationDelay: `${index * 70}ms` }}><span className="stat-icon">{icon}</span><strong>{value}</strong><small>{label}</small></article>)}
    </section>

    <section className="dashboard-grid">
      <div className="quick-panel">
        <div className="section-heading"><div><span className="eyebrow">ATALHOS</span><h2>Ações rápidas</h2></div></div>
        <div className="action-grid">
          <button className="action primary" onClick={() => navigate('/nova-entrega')}><span>➕</span><div><strong>Nova entrega</strong><small>Cadastrar uma parada</small></div></button>
          <button className="action" onClick={() => navigate('/entregas')}><span>📦</span><div><strong>Minhas entregas</strong><small>Editar e concluir</small></div></button>
          <button className="action" onClick={() => navigate('/mapa')}><span>🗺️</span><div><strong>Otimizar rota</strong><small>Ordenar as paradas</small></div></button>
          <button className="action" onClick={() => {
            const url = routeUrl(deliveries)
            if (!url) return alert('Cadastre uma entrega pendente.')
            window.open(url, '_blank')
          }}><span>🧭</span><div><strong>Google Maps</strong><small>Abrir navegação</small></div></button>
        </div>
      </div>

      <section className="next-stop premium-next">
        <div className="next-top"><span className="eyebrow">PRÓXIMA PARADA</span><span className={`status-pill ${next ? '' : 'muted'}`}>{next ? 'Pendente' : 'Livre'}</span></div>
        {next ? <>
          <div className="next-icon">📍</div>
          <h3>{next.address}</h3><p>{next.customer || 'Cliente não informado'}</p>
          <button onClick={() => window.open(mapsUrl(next.address), '_blank')}>🧭 Navegar agora</button>
        </> : <><div className="next-icon">🎉</div><h3>Nenhuma entrega pendente</h3><p>Você concluiu tudo ou ainda não cadastrou entregas.</p><button onClick={() => navigate('/nova-entrega')}>Adicionar entrega</button></>}
      </section>
    </section>
  </main>
}

function DeliveryForm({ deliveries, onSave }) {
  const navigate = useNavigate()
  const { id } = useParams()
  const editing = id ? deliveries.find((d) => String(d.id) === id) : null
  const [form, setForm] = useState({ customer: editing?.customer || '', address: editing?.address || '', phone: editing?.phone || '', notes: editing?.notes || '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function update(e) { setForm((current) => ({ ...current, [e.target.name]: e.target.value })) }
  async function submit(e) {
    e.preventDefault()
    if (!form.address.trim()) return setError('Digite o endereço.')
    setSaving(true)
    let coords = editing?.coords || null
    try { coords = await geocodeAddress(form.address.trim()) } catch {}
    onSave({ id: editing?.id || Date.now(), customer: form.customer.trim(), address: form.address.trim(), phone: form.phone.trim(), notes: form.notes.trim(), completed: editing?.completed || false, createdAt: editing?.createdAt || new Date().toISOString(), coords })
    navigate('/entregas')
  }
  return <main className="page"><section className="form-card premium-card">
    <div className="form-heading"><button className="back-button" type="button" onClick={() => navigate(-1)}>←</button><div><span className="eyebrow">{editing ? 'EDIÇÃO' : 'CADASTRO'}</span><h1>{editing ? 'Editar entrega' : 'Nova entrega'}</h1><p>Preencha os dados da próxima parada.</p></div></div>
    <form onSubmit={submit}>
      <label>Cliente<input name="customer" value={form.customer} onChange={update} placeholder="Nome do cliente" /></label>
      <label>Endereço completo *<input name="address" value={form.address} onChange={update} placeholder="Rua, número, bairro, cidade e estado" /></label>
      <label>Telefone<input name="phone" value={form.phone} onChange={update} placeholder="(34) 99999-9999" /></label>
      <label>Observações<textarea name="notes" value={form.notes} onChange={update} placeholder="Referência, horário ou instruções..." /></label>
      {error && <div className="error">{error}</div>}
      <button className="save-button" disabled={saving}>{saving ? 'Salvando...' : 'Salvar entrega'}</button>
    </form>
  </section></main>
}

function Deliveries({ deliveries, setDeliveries }) {
  const completed = deliveries.filter((d) => d.completed).length
  return <main className="page">
    <div className="page-title"><div><span className="eyebrow">SUAS PARADAS</span><h1>Entregas</h1>
          <div className="delivery-tools">
            <label className="delivery-search">
              <span>🔎</span>
              <input
                value={deliverySearch}
                onChange={(event) => setDeliverySearch(event.target.value)}
                placeholder="Buscar por endereço, cliente, telefone ou código"
              />
            </label>
            <select value={deliveryFilter} onChange={(event) => setDeliveryFilter(event.target.value)}>
              <option value="all">Todos os status</option>
              <option value="pending">Pendentes</option>
              <option value="completed">Concluídas</option>
            </select>
            <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
              <option value="all">Todas as prioridades</option>
              <option value="urgent">Urgente</option>
              <option value="high">Alta</option>
              <option value="normal">Normal</option>
              <option value="low">Baixa</option>
            </select>
          </div>
<p>{completed} concluídas de {deliveries.length}</p></div><NavLink className="mini-add" to="/nova-entrega">+ Adicionar</NavLink></div>
    {deliveries.length === 0 ? <section className="empty-card premium-card"><div>📦</div><h2>Nenhuma entrega</h2><p>Cadastre sua primeira parada para montar a rota.</p><NavLink to="/nova-entrega">Nova entrega</NavLink></section> :
      <section className="delivery-list">{filteredDeliveries.map((d, index) => <article className={`delivery-card premium-card ${d.completed ? 'completed' : ''}`} key={d.id}>
        <div className="delivery-number">{d.completed ? '✓' : index + 1}</div>
        <div className="delivery-content"><div className="delivery-title-row"><strong>{d.customer || 'Cliente não informado'}</strong><span className={`status-pill ${d.completed ? 'done' : ''}`}>{d.completed ? 'Entregue' : 'Pendente'}</span></div><p>{d.address}</p>{d.notes && <small className="delivery-note">📝 {d.notes}</small>}
          <div className="delivery-actions"><button onClick={() => window.open(mapsUrl(d.address), '_blank')}>🧭 Ir</button><NavLink className="edit-link" to={`/editar-entrega/${d.id}`}>✏️ Editar</NavLink><button className="complete-button" onClick={() => setDeliveries((list) => list.map((x) => x.id === d.id ? { ...x, completed: !x.completed } : x))}>{d.completed ? '↩ Reabrir' : '✓ Entregue'}</button><button className="danger" onClick={() => { if (window.confirm('Remover esta entrega?')) setDeliveries((list) => list.filter((x) => x.id !== d.id)) }}>Remover</button></div>
        </div>
      </article>)}</section>}
  </main>
}

function FitMap({ points }) {
  const map = useMap()
  useEffect(() => { if (points.length) map.fitBounds(points, { padding: [35, 35], maxZoom: 15 }) }, [map, points])
  return null
}

function MapPage({ deliveries, setDeliveries }) {
  const pending = deliveries.filter((d) => !d.completed)
  const [origin, setOrigin] = useState(null)
  const [routeLine, setRouteLine] = useState([])
  const [distance, setDistance] = useState(0)
  const [duration, setDuration] = useState(0)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const located = useMemo(() => pending.filter((d) => d.coords), [pending])
  const fitPoints = useMemo(() => {
    const pts = located.map((d) => [d.coords.lat, d.coords.lng])
    if (origin) pts.push([origin.lat, origin.lng])
    return routeLine.length ? routeLine : pts
  }, [located, origin, routeLine])

  async function locateMissing() {
    setBusy(true); setMessage('Localizando endereços...')
    const updated = [...deliveries]
    for (let i = 0; i < updated.length; i += 1) {
      if (updated[i].completed || updated[i].coords) continue
      try { updated[i] = { ...updated[i], coords: await geocodeAddress(updated[i].address) } } catch {}
      await new Promise((r) => setTimeout(r, 800))
    }
    setDeliveries(updated); setBusy(false); setMessage('Endereços atualizados.')
  }

  function getLocation() {
    if (!navigator.geolocation) return setMessage('Localização não suportada.')
    navigator.geolocation.getCurrentPosition(
      (pos) => { setOrigin({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setMessage('Localização adicionada.') },
      () => setMessage('Não foi possível obter sua localização. Abra no Chrome/Safari e permita o acesso ao GPS.'),
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  async function drawRoadRoute() {
    try {
      setBusy(true); setMessage('Calculando rota pelas ruas...')
      const points = [...(origin ? [origin] : []), ...located.map((d) => d.coords)]
      const result = await fetchRoadRoute(points)
      setRouteLine(result.line); setDistance(result.distanceKm); setDuration(result.durationMin); setMessage('Rota calculada pelas ruas.')
    } catch (e) { setMessage(e.message) } finally { setBusy(false) }
  }

  async function optimize() {
    try {
      setBusy(true); setMessage('Otimizando a ordem das entregas...')
      const result = await fetchOptimizedTrip(deliveries, origin)
      setDeliveries(result.deliveries); setRouteLine(result.line); setDistance(result.distanceKm); setDuration(result.durationMin)
      setMessage(result.usedFallback ? 'Rota otimizada no modo reserva. O serviço de ruas estava indisponível.' : 'Rota otimizada com sucesso pelas ruas.')
    } catch (e) { setMessage(e.message) } finally { setBusy(false) }
  }

  return <main className="page map-page">
    <div className="page-title map-title"><div><span className="eyebrow">ROTA INTELIGENTE</span><h1>Mapa da rota</h1><p>Localize, organize e abra a navegação.</p></div><div className="map-buttons"><button onClick={getLocation}>📍 Minha localização</button><button onClick={locateMissing} disabled={busy}>🔎 Localizar</button><button onClick={drawRoadRoute} disabled={busy}>🛣️ Traçar</button><button className="optimize-button" onClick={optimize} disabled={busy}>⚡ Otimizar</button></div></div>
    {message && <div className="map-message">{busy && <span className="spinner" />} {message}</div>}
    <section className="map-card premium-card"><MapContainer center={DEFAULT_CENTER} zoom={12} className="leaflet-map"><TileLayer attribution="&copy; OpenStreetMap &copy; CARTO" url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />{origin && <CircleMarker center={[origin.lat, origin.lng]} radius={9} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }}><Popup>Você está aqui</Popup></CircleMarker>}{located.map((d, index) => <Marker key={d.id} position={[d.coords.lat, d.coords.lng]} icon={markerIcon}><Popup><strong>{index + 1}. {d.customer || 'Entrega'}</strong><br />{d.address}</Popup></Marker>)}{routeLine.length > 1 && <Polyline positions={routeLine} pathOptions={{ color: '#fb923c', weight: 5 }} />}<FitMap points={fitPoints} /></MapContainer></section>
    <section className="map-summary premium-card"><div><strong>{located.length}</strong><span>paradas localizadas</span></div><div><strong>{distance ? `${distance.toFixed(1)} km` : '—'}</strong><span>distância estimada</span></div><div><strong>{duration ? `${Math.round(duration)} min` : '—'}</strong><span>tempo estimado</span></div><button onClick={() => { const url = routeUrl(deliveries); if (!url) return alert('Cadastre entregas.'); window.open(url, '_blank') }}>🧭 Abrir no Google Maps</button></section>
  </main>
}

function History({ deliveries, setDeliveries }) {
  const completed = deliveries.filter((d) => d.completed)
  return <main className="page"><div className="page-title"><div><span className="eyebrow">CONCLUÍDAS</span><h1>Histórico</h1><p>Entregas finalizadas no dispositivo.</p></div></div>{completed.length === 0 ? <section className="empty-card premium-card"><div>📊</div><h2>Nenhuma entrega concluída</h2><p>As entregas finalizadas aparecerão aqui.</p></section> : <section className="delivery-list">{completed.map((d) => <article className="delivery-card premium-card completed" key={d.id}><div className="delivery-number">✓</div><div className="delivery-content"><strong>{d.customer || 'Cliente'}</strong><p>{d.address}</p><div className="delivery-actions"><button onClick={() => setDeliveries((list) => list.map((x) => x.id === d.id ? { ...x, completed: false } : x))}>↩ Reabrir</button></div></div></article>)}</section>}</main>
}

function App() {
  const [deliveries, setDeliveries] = useDeliveries()
  const [dark, setDark] = useState(() => localStorage.getItem(THEME_KEY) !== 'light')
  const [deliverySearch, setDeliverySearch] = useState('')
  const [deliveryFilter, setDeliveryFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light')
  }, [dark])
  function saveDelivery(delivery) { setDeliveries((list) => list.some((d) => d.id === delivery.id) ? list.map((d) => d.id === delivery.id ? delivery : d) : [delivery, ...list]) }
  return <div className="app-shell">
    <SplashScreen /><header className="topbar"><NavLink to="/" className="brand"><Brand /></NavLink><div className="top-actions"><div className="online"><span /> Online</div><button className="theme-toggle" onClick={() => setDark((value) => !value)} title="Alternar tema">{dark ? '☀️' : '🌙'}</button></div></header>
    <Routes><Route path="/" element={<Dashboard deliveries={deliveries} />} /><Route path="/nova-entrega" element={<DeliveryForm deliveries={deliveries} onSave={saveDelivery} />} /><Route path="/editar-entrega/:id" element={<DeliveryForm deliveries={deliveries} onSave={saveDelivery} />} /><Route path="/entregas" element={<Deliveries deliveries={deliveries} setDeliveries={setDeliveries} />} /><Route path="/mapa" element={<MapPage deliveries={deliveries} setDeliveries={setDeliveries} />} /><Route path="/historico" element={<History deliveries={deliveries} setDeliveries={setDeliveries} />} /></Routes>
    <nav className="bottom-nav"><NavLink to="/" end><span>🏠</span><small>Início</small></NavLink><NavLink to="/entregas"><span>📦</span><small>Entregas</small></NavLink><NavLink to="/mapa"><span>🗺️</span><small>Mapa</small></NavLink><NavLink to="/historico"><span>📊</span><small>Histórico</small></NavLink></nav>
  </div>
}

export default App
