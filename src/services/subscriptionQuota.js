export const FREE_DAILY_DELIVERIES = 5;

export function normalizeQuotaStatus(value) {
  if (!value || typeof value.enforced !== "boolean" || typeof value.premium !== "boolean") {
    throw new Error("Não foi possível confirmar seu plano. Tente novamente.");
  }
  const used = value.used;
  if (!Number.isInteger(used) || used < 0) throw new Error("Contagem de entregas indisponível.");
  return { ...value, used, remaining: Math.max(0, FREE_DAILY_DELIVERIES - used) };
}

export function getNewDeliveries(previous, next) {
  const existing = new Set(previous.map((item) => String(item.id)));
  const seen = new Set();
  return next.filter((item) => {
    const id = String(item.id || "");
    if (!id || existing.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function selectQuotaDeliveries(candidates, ids, remaining) {
  if (!Number.isInteger(remaining) || remaining < 0) throw new Error("Limite inválido.");
  const allowed = new Set(ids.map(String));
  const selected = candidates.filter((item) => allowed.has(String(item.id)));
  if (selected.length > remaining) throw new Error("Selecione somente as entregas disponíveis hoje.");
  return selected;
}

export function quotaNeedsSelection(status, count) {
  return status.enforced && !status.premium && count > status.remaining;
}
