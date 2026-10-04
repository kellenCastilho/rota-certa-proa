-- Configura o botão; executar este arquivo NÃO apaga nenhuma pasta ou entrega.
BEGIN;
CREATE OR REPLACE FUNCTION public.darota_delete_own_route(p_route_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_route_id uuid;
  v_deleted integer;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Entre na sua conta antes de excluir uma pasta.'; END IF;
  SELECT id INTO v_route_id FROM public.rotas
    WHERE id = p_route_id AND user_id = v_user_id FOR UPDATE;
  IF v_route_id IS NULL THEN RAISE EXCEPTION 'Pasta não encontrada na sua conta.'; END IF;
  DELETE FROM public.entregas WHERE rota_id = p_route_id AND user_id = v_user_id;
  IF EXISTS (SELECT 1 FROM public.entregas WHERE rota_id = p_route_id AND user_id = v_user_id) THEN
    RAISE EXCEPTION 'Não foi possível apagar todas as entregas. A pasta foi preservada.';
  END IF;
  DELETE FROM public.rotas WHERE id = p_route_id AND user_id = v_user_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted <> 1 THEN RAISE EXCEPTION 'Não foi possível excluir a pasta completa.'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.darota_delete_own_route(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darota_delete_own_route(uuid) TO authenticated;
COMMIT;
SELECT 'Configuração concluída. Nenhuma pasta ou entrega foi apagada.' AS resultado;
