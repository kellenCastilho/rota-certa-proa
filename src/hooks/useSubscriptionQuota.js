import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { normalizeQuotaStatus, quotaNeedsSelection, selectQuotaDeliveries } from "../services/subscriptionQuota";

export default function useSubscriptionQuota(userId) {
  // Only activate after the SQL migration, store integration and purchase tests.
  const enabled = import.meta.env.VITE_DAROTA_QUOTA_ENABLED === "true";
  const [request, setRequest] = useState(null);
  const resolver = useRef(null);
  const currentUser = useRef(userId);
  currentUser.current = userId;
  const resolve = useCallback((ids) => {
    const done = resolver.current;
    resolver.current = null;
    setRequest(null);
    done?.(ids);
  }, []);
  useEffect(() => () => {
    resolver.current?.(null);
    resolver.current = null;
  }, [userId]);
  useEffect(() => { setRequest(null); }, [userId]);

  const prepareAdditions = useCallback(async (candidates) => {
    if (!enabled || !candidates.length) return candidates;
    const owner = userId;
    const { data, error } = await supabase.rpc("darota_quota_status");
    if (error) throw new Error("Não foi possível consultar seu limite. Tente novamente.");
    if (!owner || currentUser.current !== owner) return null;
    const status = normalizeQuotaStatus(data);
    if (!quotaNeedsSelection(status, candidates.length)) return candidates;
    const ids = await new Promise((done) => {
      resolver.current?.(null);
      resolver.current = done;
      setRequest({ candidates, status });
    });
    if (ids === null || currentUser.current !== owner) return null;
    return selectQuotaDeliveries(candidates, ids, status.remaining);
  }, [enabled, userId]);
  return { enabled, prepareAdditions, request, resolve };
}
