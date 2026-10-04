import { Capacitor, registerPlugin } from "@capacitor/core";
import { supabase } from "../lib/supabase";
const navigation = registerPlugin("DaRotaNavigation");

export async function deleteOwnAccount({ email, password, expectedUserId }) {
  if (!email || !password || !expectedUserId) throw new Error("Confirme o e-mail e a senha da sua conta.");
  // Reauthenticate before deletion; never send an arbitrary user's ID to the database.
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || data?.user?.id !== expectedUserId) throw new Error("Não foi possível confirmar sua conta. Confira sua senha.");
  if (["android", "ios"].includes(Capacitor.getPlatform())) {
    try { await navigation.stop(); }
    catch { throw new Error("Encerre a navegação e tente novamente antes de excluir sua conta."); }
  }
  const result = await supabase.rpc("darota_delete_own_account", { confirmation: "EXCLUIR" });
  if (result.error) throw new Error("Não foi possível concluir a exclusão. Tente novamente ou fale com darotapro@gmail.com.");
  if (result.data !== true) throw new Error("O servidor não confirmou a exclusão. Fale com darotapro@gmail.com antes de tentar novamente.");
  // Clear local remnants only after the database confirms the transactional deletion.
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith("rota-certa-") && key !== "rota-certa-tema") localStorage.removeItem(key);
    }
    sessionStorage.removeItem("capturedImage");
  } catch { /* Local storage may be disabled by the browser. */ }
  try { await supabase.auth.signOut({ scope: "local" }); } catch { /* The account is already deleted. */ }
  return true;
}
