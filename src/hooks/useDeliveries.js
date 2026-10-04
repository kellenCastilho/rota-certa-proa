import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useDeliveries(userId) {
  const [deliveries, setDeliveriesState] = useState([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(true);

  const syncQueue = useRef(Promise.resolve());
  const deletedRoutes = useRef(new Set());
  const deletedDeliveries = useRef(new Set());

  function enqueueSync(work) {
    const task = syncQueue.current.then(work);
    syncQueue.current = task.catch((error) => console.error("Falha na sincronização:", error));
    return task;
  }

  function fromDatabase(row) {
    const phoneMatch = row.observacoes?.match(/Telefone:\s*([^•]+)/i);

    return {
      id: row.id,
      customer: row.cliente || "",
      address: row.endereco || "",
      phone: phoneMatch?.[1]?.trim() || "",
      notes: row.observacoes || "",

      completed: row.status === "concluida",

      createdAt: row.created_at,

      coords:
        typeof row.latitude === "number" &&
        typeof row.longitude === "number"
          ? {
              lat: row.latitude,
              lng: row.longitude,
            }
          : null,

      priority: "normal",

      // 📁 Pasta / rota à qual a entrega pertence
      rotaId: row.rota_id || null,
    };
  }

  function toDatabase(delivery) {
    return {
      id: delivery.id,

      cliente: delivery.customer || "",

      endereco: delivery.address || "",

      status: delivery.completed
        ? "concluida"
        : "pendente",

      observacoes: delivery.notes || "",

      created_at:
        delivery.createdAt ||
        new Date().toISOString(),

      latitude:
        delivery.coords?.lat ?? null,

      longitude:
        delivery.coords?.lng ?? null,

      user_id: userId,

      // 📁 Salva a pasta da entrega no Supabase
      rota_id: delivery.rotaId || null,
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

      const { data, error } =
        await supabase
          .from("entregas")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", {
            ascending: false,
          });

      if (!active) return;

      if (error) {
        console.error(
          "Erro ao carregar entregas:",
          error
        );

        alert(
          `Não foi possível carregar as entregas: ${error.message}`
        );
      } else {
        setDeliveriesState(
          (data || []).map(fromDatabase).filter((delivery) => !deletedRoutes.current.has(String(delivery.rotaId)) && !deletedDeliveries.current.has(String(delivery.id)))
        );
      }

      setLoadingDeliveries(false);
    }

    loadDeliveries();

    return () => {
      active = false;
    };
  }, [userId]);

  async function syncDeliveries(
    next,
    previous
  ) {
    next = next.filter((delivery) => !deletedRoutes.current.has(String(delivery.rotaId)) && !deletedDeliveries.current.has(String(delivery.id)));
    const nextIds = new Set(
      next.map(
        (delivery) => delivery.id
      )
    );

    const removedIds = previous
      .filter(
        (delivery) =>
          !nextIds.has(delivery.id)
      )
      .map(
        (delivery) => delivery.id
      );

    if (removedIds.length) {
      const { error } =
        await supabase
          .from("entregas")
          .delete()
          .in("id", removedIds);

      if (error) {
        console.error(
          "Erro ao remover entrega:",
          error
        );

        alert(
          `Não foi possível remover a entrega: ${error.message}`
        );

        return;
      }
    }

    // Salva somente o que mudou; snapshots antigos não recriam outras entregas.
    const previousById = new Map(previous.map((delivery) => [String(delivery.id), delivery]));
    const changed = next.filter((delivery) => {
      const old = previousById.get(String(delivery.id));
      return !old || JSON.stringify(toDatabase(old)) !== JSON.stringify(toDatabase(delivery));
    });
    if (!changed.length) return;

    try {
      const routeIds = [...new Set(changed.filter((delivery) => delivery.rotaId).map((delivery) => String(delivery.rotaId)))];
      for (let offset = 0; offset < routeIds.length; offset += 40) {
        const batch = routeIds.slice(offset, offset + 40);
        const { data, error } = await supabase.from("rotas").select("id").eq("user_id", userId).in("id", batch);
        if (error) throw error;
        const available = new Set((data || []).map((row) => String(row.id)));
        for (const id of batch) if (!available.has(id)) deletedRoutes.current.add(id);
      }
      setDeliveriesState((current) => current.filter((delivery) => !deletedRoutes.current.has(String(delivery.rotaId))));
      for (const delivery of changed) {
        if (deletedRoutes.current.has(String(delivery.rotaId)) || deletedDeliveries.current.has(String(delivery.id))) continue;
        const row = toDatabase(delivery);
        if (previousById.has(String(delivery.id))) {
          // UPDATE não recria uma entrega que outro aparelho já apagou.
          const { data, error } = await supabase.from("entregas").update(row).eq("user_id", userId).eq("id", delivery.id).select("id");
          if (error) throw error;
          if (!data?.length) {
            deletedDeliveries.current.add(String(delivery.id));
            setDeliveriesState((current) => current.filter((item) => String(item.id) !== String(delivery.id)));
          }
        } else {
          const { error } = await supabase.from("entregas").upsert(row, { onConflict: "id" });
          if (error) throw error;
        }
      }
    } catch (error) {
      console.error("Erro ao salvar alterações:", error);
      alert(`Não foi possível salvar as alterações: ${error.message}`);
    }
  }

  function setDeliveries(update) {
    setDeliveriesState(
      (previous) => {
        const next =
          typeof update ===
          "function"
            ? update(previous)
            : update;

        const retained = next.filter((delivery) => !deletedRoutes.current.has(String(delivery.rotaId)) && !deletedDeliveries.current.has(String(delivery.id)));
        void enqueueSync(() => syncDeliveries(retained, previous));

        return retained;
      }
    );
  }

  async function deleteRouteAndDeliveries(rotaId) {
    if (!userId || !rotaId) return false;
    try {
      return await enqueueSync(async () => {
        const { data, error } = await supabase.rpc("darota_delete_own_route", { p_route_id: rotaId });
        if (error) throw error;
        if (data !== true) throw new Error("A exclusão não foi confirmada.");
        deletedRoutes.current.add(String(rotaId));
        // O banco já apagou tudo. Atualiza a tela sem gravar novamente as entregas.
        setDeliveriesState((current) => current.filter((delivery) => String(delivery.rotaId) !== String(rotaId)));
        return true;
      });
    } catch (error) {
      alert(`Não foi possível excluir a pasta completa: ${error.message}`);
      return false;
    }
  }

  async function deleteTodayRoute(ids) {
    if (!userId || !ids.length) return false;
    const uniqueIds = [...new Set(ids)];
    let confirmedCount = 0;
    try {
      return await enqueueSync(async () => {
        // Mantém cada URL curta, inclusive para centenas de UUIDs.
        for (let offset = 0; offset < uniqueIds.length; offset += 40) {
          const batch = uniqueIds.slice(offset, offset + 40);
          const { data, error } = await supabase.from("entregas")
            .delete().eq("user_id", userId).is("rota_id", null)
            .eq("status", "pendente").in("id", batch).select("id");
          if (error) throw error;
          const removed = new Set((data || []).map((row) => String(row.id)));
          for (const id of removed) deletedDeliveries.current.add(id);
          confirmedCount += removed.size;
          setDeliveriesState((current) => current.filter((delivery) => !removed.has(String(delivery.id))));
          if (removed.size !== batch.length) {
            throw new Error("Algumas entregas mudaram. Confira a lista antes de tentar novamente.");
          }
        }
        return true;
      });
    } catch (error) {
      const progress = confirmedCount ? `${confirmedCount} entregas foram apagadas. As restantes continuam na lista. ` : "";
      alert(`${progress}Não foi possível concluir a exclusão: ${error.message}`);
      return false;
    }
  }

  async function deleteHistoryGroup(ids) {
    if (!userId || !ids.length) return false;
    const uniqueIds = [...new Set(ids)];
    let confirmedCount = 0;
    try {
      return await enqueueSync(async () => {
        // Mantém cada URL curta, inclusive para centenas de UUIDs.
        for (let offset = 0; offset < uniqueIds.length; offset += 40) {
          const batch = uniqueIds.slice(offset, offset + 40);
          const { data, error } = await supabase.from("entregas")
            .delete().eq("user_id", userId)
            .eq("status", "concluida").in("id", batch).select("id");
          if (error) throw error;
          const removed = new Set((data || []).map((row) => String(row.id)));
          for (const id of removed) deletedDeliveries.current.add(id);
          confirmedCount += removed.size;
          setDeliveriesState((current) => current.filter((delivery) => !removed.has(String(delivery.id))));
          if (removed.size !== batch.length) {
            throw new Error("Algumas entregas mudaram. Confira a lista antes de tentar novamente.");
          }
        }
        return true;
      });
    } catch (error) {
      const progress = confirmedCount ? `${confirmedCount} entregas foram apagadas. As restantes continuam na lista. ` : "";
      alert(`${progress}Não foi possível concluir a exclusão: ${error.message}`);
      return false;
    }
  }

  return [
    deliveries,
    setDeliveries,
    loadingDeliveries,
    deleteRouteAndDeliveries,
    deleteTodayRoute,
    deleteHistoryGroup,
  ];
}
