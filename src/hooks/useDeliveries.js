import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useDeliveries(userId) {
  const [deliveries, setDeliveriesState] = useState([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(true);

  const syncQueue = useRef(Promise.resolve());
  const deletedRoutes = useRef(new Set());

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
          (data || []).map(fromDatabase).filter((delivery) => !deletedRoutes.current.has(String(delivery.rotaId)))
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
    next = next.filter((delivery) => !deletedRoutes.current.has(String(delivery.rotaId)));
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

    if (next.length) {
      const { error } =
        await supabase
          .from("entregas")
          .upsert(
            next.map(toDatabase),
            {
              onConflict: "id",
            }
          );

      if (error) {
        console.error(
          "Erro ao salvar entregas:",
          error
        );

        alert(
          `Não foi possível salvar no Supabase: ${error.message}`
        );
      }
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

        const retained = next.filter((delivery) => !deletedRoutes.current.has(String(delivery.rotaId)));
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

  return [
    deliveries,
    setDeliveries,
    loadingDeliveries,
    deleteRouteAndDeliveries,
  ];
}
