import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useDeliveries(userId) {
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
        alert(
          `Não foi possível carregar as entregas: ${error.message}`
        );
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
    const nextIds = new Set(
      next.map((delivery) => delivery.id)
    );

    const removedIds = previous
      .filter(
        (delivery) => !nextIds.has(delivery.id)
      )
      .map((delivery) => delivery.id);

    if (removedIds.length) {
      const { error } = await supabase
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
      const { error } = await supabase
        .from("entregas")
        .upsert(next.map(toDatabase), {
          onConflict: "id",
        });

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
    setDeliveriesState((previous) => {
      const next =
        typeof update === "function"
          ? update(previous)
          : update;

      void syncDeliveries(next, previous);

      return next;
    });
  }

  return [
    deliveries,
    setDeliveries,
    loadingDeliveries,
  ];
}