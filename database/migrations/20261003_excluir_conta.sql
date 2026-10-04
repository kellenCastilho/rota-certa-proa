-- Configura a exclusão; não exclui nenhuma conta ao executar este arquivo.
BEGIN;

-- As tabelas precisam manter RLS ativa para bloquear sessões de contas excluídas.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'entregas' AND c.relrowsecurity)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = 'rotas' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'Parei sem alterar nada: confira RLS de entregas e rotas com a Margô.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.darota_account_active()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM auth.users WHERE id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.darota_account_active() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darota_account_active() TO authenticated;

-- Restrictive policies supplement the existing policies; they do not grant access.
DROP POLICY IF EXISTS darota_active_account_required ON public.entregas;
CREATE POLICY darota_active_account_required ON public.entregas AS RESTRICTIVE
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()) AND (SELECT public.darota_account_active()))
WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.darota_account_active()));
DROP POLICY IF EXISTS darota_active_account_required ON public.rotas;
CREATE POLICY darota_active_account_required ON public.rotas AS RESTRICTIVE
FOR ALL TO authenticated
USING (user_id = (SELECT auth.uid()) AND (SELECT public.darota_account_active()))
WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT public.darota_account_active()));

CREATE OR REPLACE FUNCTION public.darota_delete_own_account(confirmation text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Faça login para excluir sua conta.';
  END IF;
  IF confirmation IS DISTINCT FROM 'EXCLUIR' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Confirmação de exclusão inválida.';
  END IF;
  PERFORM 1 FROM auth.users WHERE id = caller FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Sua sessão não corresponde a uma conta ativa.';
  END IF;
  -- The app currently does not upload to Storage. Never delete only file metadata.
  IF EXISTS (SELECT 1 FROM storage.objects WHERE owner = caller OR owner_id = caller::text) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Há arquivos vinculados à conta. Solicite a exclusão ao atendimento DaRota.';
  END IF;
  -- Do not allow a route FK cascade to erase another person's delivery.
  IF EXISTS (
    SELECT 1 FROM public.entregas e JOIN public.rotas r ON r.id = e.rota_id
    WHERE r.user_id = caller AND e.user_id IS DISTINCT FROM caller
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Confira os vínculos das rotas com o atendimento DaRota.';
  END IF;
  DELETE FROM public.entregas WHERE user_id = caller;
  DELETE FROM public.rotas WHERE user_id = caller;
  DELETE FROM auth.users WHERE id = caller;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.darota_delete_own_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.darota_delete_own_account(text) TO authenticated;

COMMIT;

SELECT
  'Configuração concluída; nenhuma conta foi excluída.' AS resultado,
  has_function_privilege('authenticated', 'public.darota_delete_own_account(text)', 'EXECUTE') AS usuario_pode_excluir_a_propria_conta,
  NOT has_function_privilege('anon', 'public.darota_delete_own_account(text)', 'EXECUTE') AS acesso_anonimo_bloqueado;
