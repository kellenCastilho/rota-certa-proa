import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function useRoutes(userId) {
  const [routes, setRoutes] = useState([]);
  const [loadingRoutes, setLoadingRoutes] =
    useState(true);

  useEffect(() => {
    let active = true;

    if (!userId) {
      setRoutes([]);
      setLoadingRoutes(false);
      return;
    }

    async function loadRoutes() {
      setLoadingRoutes(true);

      const { data, error } = await supabase
        .from("rotas")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", {
          ascending: false,
        });

      if (!active) return;

      if (error) {
        console.error(
          "Erro ao carregar rotas:",
          error
        );

        alert(
          `Não foi possível carregar as rotas: ${error.message}`
        );
      } else {
        setRoutes(data || []);
      }

      setLoadingRoutes(false);
    }

    loadRoutes();

    return () => {
      active = false;
    };
  }, [userId]);

  async function createRoute(nome) {
    const nomeLimpo = nome.trim();

    if (!nomeLimpo || !userId) {
      return null;
    }

    const { data, error } = await supabase
      .from("rotas")
      .insert({
        nome: nomeLimpo,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      console.error(
        "Erro ao criar rota:",
        error
      );

      alert(
        `Não foi possível criar a pasta: ${error.message}`
      );

      return null;
    }

    setRoutes((list) => [
      data,
      ...list,
    ]);

    return data;
  }

  async function renameRoute(
    rotaId,
    novoNome
  ) {
    const nomeLimpo =
      novoNome.trim();

    if (!nomeLimpo) return false;

    const { error } = await supabase
      .from("rotas")
      .update({
        nome: nomeLimpo,
      })
      .eq("id", rotaId)
      .eq("user_id", userId);

    if (error) {
      console.error(
        "Erro ao renomear rota:",
        error
      );

      alert(
        `Não foi possível renomear a pasta: ${error.message}`
      );

      return false;
    }

    setRoutes((list) =>
      list.map((rota) =>
        rota.id === rotaId
          ? {
              ...rota,
              nome: nomeLimpo,
            }
          : rota
      )
    );

    return true;
  }

  async function deleteRoute(rotaId) {
    const { error } = await supabase
      .from("rotas")
      .delete()
      .eq("id", rotaId)
      .eq("user_id", userId);

    if (error) {
      console.error(
        "Erro ao excluir rota:",
        error
      );

      alert(
        `Não foi possível excluir a pasta: ${error.message}`
      );

      return false;
    }

    setRoutes((list) =>
      list.filter(
        (rota) =>
          rota.id !== rotaId
      )
    );

    return true;
  }

  return {
    routes,
    loadingRoutes,
    createRoute,
    renameRoute,
    deleteRoute,
  };
}