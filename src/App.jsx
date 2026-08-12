import DashboardPage from "./pages/Dashboard";
import MapPagePage from "./pages/MapPage";
import DeliveriesPage from "./pages/Deliveries";
import HistoryPage from "./pages/History";
import DeliveryFormPage from "./pages/DeliveryForm";
import {
  fetchRoadRoute as fetchRoadRouteService,
  fetchOptimizedTrip as fetchOptimizedTripService,
} from "./services/routing";
import { geocodeAddress as geocodeAddressService } from "./services/geocoding";
import { useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useNavigate,
  useParams,
} from "react-router-dom";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import Brand from "./components/Brand";
import SplashScreen from "./components/SplashScreen";
import AuthPage from "./auth/AuthPage";
import { supabase } from "./lib/supabase";
import ScanPage from "./pages/ScanPage";
import ConfirmAddress from "./pages/ConfirmAddress";

const THEME_KEY = "rota-certa-tema";
const DEFAULT_CENTER = [-18.9186, -48.2772];

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [34, 50],
  iconAnchor: [17, 50],
  popupAnchor: [0, -48],
  shadowSize: [41, 41],
});
function numberedMarkerIcon(number, isNext) {
  return L.divIcon({
    className: "",
    html: `
      <div style="
        width: 38px;
        height: 38px;
        border-radius: 50%;
        background: ${isNext ? "#ef4444" : "#2563eb"};
        color: white;
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        font-weight: 800;
      ">
        ${number}
      </div>
    `,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -23],
  });
}
function useDeliveries(userId) {
  const [deliveries, setDeliveriesState] = useState([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(true);

  function fromDatabase(row) {
    return {
      id: row.id,
      customer: row.cliente || "",
      address: row.endereco || "",
      phone: "",
      notes: row.observacoes || "",
      completed: row.status === "concluida",
      createdAt: row.created_at,
      coords: null,
      priority: "normal",
    };
  }

  function toDatabase(delivery) {
    return {
      id: delivery.id,
      cliente: delivery.customer || "",
      endereco: delivery.address || "",
      status: delivery.completed ? "concluida" : "pendente",
      observacoes: delivery.notes || "",
      created_at: delivery.createdAt || new Date().toISOString(),
      user_id: userId,
    };
  }

  useEffect(() => {
    let active = true;
    if (!userId) {
  setDeliveriesState([]);
  setLoadingDeliveries(false);
  return;
}
    async function loadDeliveries() {
      setLoadingDeliveries(true);
      const { data, error } = await supabase
        .from("entregas")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        console.error("Erro ao carregar entregas:", error);
        alert(`Não foi possível carregar as entregas: ${error.message}`);
      } else {
        setDeliveriesState((data || []).map(fromDatabase));
      }
      setLoadingDeliveries(false);
    }
    loadDeliveries();
    return () => {
      active = false;
    };
}, [userId]);

  async function syncDeliveries(next, previous) {
    const nextIds = new Set(next.map((delivery) => delivery.id));
    const removedIds = previous
      .filter((delivery) => !nextIds.has(delivery.id))
      .map((delivery) => delivery.id);
    if (removedIds.length) {
      const { error } = await supabase
        .from("entregas")
        .delete()
        .in("id", removedIds);
      if (error) {
        console.error("Erro ao remover entrega:", error);
        alert(`Não foi possível remover a entrega: ${error.message}`);
        return;
      }
    }
    if (next.length) {
      const { error } = await supabase
        .from("entregas")
        .upsert(next.map(toDatabase), { onConflict: "id" });
      if (error) {
        console.error("Erro ao salvar entregas:", error);
        alert(`Não foi possível salvar no Supabase: ${error.message}`);
      }
    }
  }

  function setDeliveries(update) {
    setDeliveriesState((previous) => {
      const next = typeof update === "function" ? update(previous) : update;
      void syncDeliveries(next, previous);
      return next;
    });
  }

  return [deliveries, setDeliveries, loadingDeliveries];
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function routeUrl(deliveries) {
  const pending = deliveries.filter((d) => !d.completed && d.address);
  if (!pending.length) return "";
  const origin = pending[0].address;
  const destination = pending[pending.length - 1].address;
  const middle = pending.slice(1, -1).map((d) => d.address);
  let url = `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
  if (middle.length)
    url += `&waypoints=${encodeURIComponent(middle.join("|"))}`;
  return url;
}


function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function App() {
  const [session, setSession] = useState(null);
  const user = session?.user
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setCheckingSession(false);
    });

    return () => subscription.unsubscribe();
  }, []);
  const [deliveries, setDeliveries, loadingDeliveries] = useDeliveries(session?.user?.id);
  const [dark, setDark] = useState(
    () => localStorage.getItem(THEME_KEY) !== "light",
  );
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  }, [dark]);
  function saveDelivery(delivery) {
    setDeliveries((list) =>
      list.some((d) => d.id === delivery.id)
        ? list.map((d) => (d.id === delivery.id ? delivery : d))
        : [delivery, ...list],
    );
  }

  if (checkingSession) {
    return (
      <div className="app-shell">
        <main className="page">
          <section className="empty-card premium-card">
            <div>🔐</div>
            <h2>Verificando acesso</h2>
            <p>Aguarde um instante...</p>
          </section>
        </main>
      </div>
    );
  }

  if (!session) {
    return <AuthPage />;
  }
  if (loadingDeliveries) {
    return (
      <div className="app-shell">
        <main className="page">
          <section className="empty-card premium-card">
            <div>☁️</div>
            <h2>Carregando entregas</h2>
            <p>Buscando os dados no Supabase...</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <SplashScreen />
      <header className="topbar">
        <NavLink to="/" className="brand">
          <Brand />
        </NavLink>
        <div className="top-actions">
          <div className="online">
            <span /> Online
          </div>
          <button onClick={() => supabase.auth.signOut()}>Sair</button>
          <button
            className="theme-toggle"
            onClick={() => setDark((value) => !value)}
            title="Alternar tema"
          >
            {dark ? "☀️" : "🌙"}
          </button>
        </div>
      </header>
      <Routes>
        <Route path="/login" element={<AuthPage />} />

<Route
  path="/"
  element={
    <DashboardPage
      deliveries={deliveries}
    />
  }
/>
        
       <Route
         path="/escanear"
         element={<ScanPage onSave={saveDelivery} />}
       />

        <Route
          path="/escanear"
          element={<ScanPage />}
        />

<Route
  path="/nova-entrega"
  element={
    <DeliveryFormPage
      deliveries={deliveries}
      onSave={saveDelivery}
    />
  }
/>

    

<Route
  path="/editar-entrega/:id"
  element={
    <DeliveryFormPage
      deliveries={deliveries}
      onSave={saveDelivery}
    />
  }
/>
      
<Route
  path="/entregas"
  element={
    <DeliveriesPage
      deliveries={deliveries}
      setDeliveries={setDeliveries}
    />
  }
/>
<Route
  path="/mapa"
  element={
    <MapPagePage
      deliveries={deliveries}
      setDeliveries={setDeliveries}
    />
  }
/>
<Route
  path="/historico"
  element={
    <HistoryPage
      deliveries={deliveries}
      setDeliveries={setDeliveries}
    />
  }
/>
        <Route
          path="/confirmar-endereco"
          element={<ConfirmAddress />}
      />
      </Routes>
      <nav className="bottom-nav">
        <NavLink to="/" end>
          <span>🏠</span>
          <small>Início</small>
        </NavLink>
        <NavLink to="/entregas">
          <span>📦</span>
          <small>Entregas</small>
        </NavLink>
        <NavLink to="/mapa">
          <span>🗺️</span>
          <small>Mapa</small>
        </NavLink>
        <NavLink to="/historico">
          <span>📊</span>
          <small>Histórico</small>
        </NavLink>
      </nav>
    </div>
  );
}

export default App;
