import { Capacitor } from "@capacitor/core";
import { supabase } from "../lib/supabase.js";
import { geoapifyCandidates } from "./geoapifyResults.js";

const configuredBase = String(import.meta.env?.VITE_API_BASE || "").replace(/\/+$/, "");
const API_BASE = configuredBase || (Capacitor.isNativePlatform() ? "https://rota-certa-proa.vercel.app" : "");

export async function requestGeoapify(payload) {
  const { data, error } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new Error("Entre na sua conta para localizar endereços.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${API_BASE}/api/geocodificar`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result?.error || "Serviço de localização indisponível.");
    const candidates = geoapifyCandidates(result);
    return payload.operation === "reverse" ? candidates[0] || null : candidates;
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("O serviço de localização demorou para responder.");
    throw error;
  } finally { clearTimeout(timeout); }
}

