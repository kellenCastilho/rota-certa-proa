# DaRota Premium no Google Play

Implementação preparada na branch `android-assinatura-20261009`. Ainda requer configuração, compilação nativa e testes físicos antes de publicar. Nenhuma migração é aplicada automaticamente. Nenhuma configuração de cota existente é alterada por esta migração.

## Produto e plano

No Play Console do DaRota, criar assinatura:

- ID do produto: `darota_premium_mensal`
- Nome: DaRota Premium Mensal
- Descrição: Organize mais entregas e otimize suas rotas.
- Plano básico: `mensal`, com renovação automática, período de 1 mês.
- Brasil: R$ 29,90. Ativar o plano após revisar disponibilidade e preços.
- A primeira implementação usa somente o preço regular, sem ofertas introdutórias e sem planos pré-pagos.

O Android usa o preço localizado e o token de oferta retornados pelo Google Play. Não utiliza um preço fixo para efetuar a compra. O ID do produto Android é diferente do ID Apple.

## Servidor

Criar uma conta de serviço Google Cloud com acesso apropriado ao aplicativo no Play Console e habilitar Google Play Android Developer API. Usar os privilégios mínimos que permitam consultar e confirmar compras de assinaturas. Nunca colocar a chave JSON no frontend, Git, arquivos VITE ou mensagens de suporte.

Configurar no servidor Vercel, somente depois de revisar o código e preparar a migração:

- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: JSON completo da conta de serviço (segredo).
- `DAROTA_GOOGLE_IAP_ENABLED=true`: habilita o endpoint Google; manter ausente/false até concluir a configuração.
- `DAROTA_GOOGLE_IAP_TEST_USERS`: UUIDs das contas DaRota autorizadas para compras de teste, separados por vírgula.
- Reutiliza `SUPABASE_URL` e `SUPABASE_SECRET_KEY` existentes.

A validação verifica o produto, plano mensal, estado, vencimento e identificador de conta ofuscado. O hash SHA-256 de `darota:<UUID em minúsculas>` vincula a compra à conta DaRota. Compras de outras contas são recusadas. Compras pendentes não liberam Premium.

O servidor confirma a compra com o Google após persistir o resultado verificado. Restauração, abertura do app e notificações consultam o estado atual. Cancelamento conserva o acesso até o vencimento; pausa, suspensão e expiração não concedem acesso.

## Banco

Aplicar `supabase/migrations/20261009_google_subscriptions.sql` primeiro em ambiente de teste. A migração cria armazenamento privado das compras Google e mantém a assinatura do RPC Apple usado pelo iOS enviado à revisão. O Premium é calculado pela maior validade elegível entre as duas lojas. Uma loja não apaga o benefício válido da outra.

Compras de teste precisam também de `google_test_enabled=true` no registro `darota_plan_accounts` da conta DaRota de teste. O backend exige a lista de UUIDs e o banco exige essa autorização separada. Não ativar para contas reais indiscriminadamente.

Não reexecutar migrações antigas com CREATE TABLE sem verificar se já foram aplicadas. Esta migração não modifica `enforced`, entregas, histórico nem contagens diárias.

## Notificações

Configurar Real-time Developer Notifications (RTDN) com Google Cloud Pub/Sub e assinatura push autenticada:

- Endpoint: `https://rota-certa-proa.vercel.app/api/notificacoes-google`
- `GOOGLE_RTDN_AUDIENCE`: audience exata configurada na assinatura push (usar a URL acima).
- `GOOGLE_RTDN_PUSH_EMAIL`: email da conta de serviço usada para autenticar o push.
- Permitir ao serviço Google Play publicar no tópico conforme documentação oficial.

O endpoint verifica o token OIDC Google, audience, email verificado e pacote do app. Nenhum token de compra ou credencial é registrado nos logs. Notificações de compras ainda desconhecidas são reconhecidas sem estabelecer vínculo de conta; o vínculo é criado pelo endpoint de compra autenticado.

## Termos e build Android

Publicar e revisar os termos de uso do DaRota para Android. O contrato padrão da Apple não deve ser usado como contrato do Google Play. A assinatura Android permanece oculta até existir uma URL HTTPS em `VITE_DAROTA_ANDROID_TERMS_URL`.

Após configurar servidor, banco e plano Google, compilar com:

```bash
VITE_DAROTA_QUOTA_ENABLED=true \
VITE_DAROTA_ANDROID_SUBSCRIPTIONS_ENABLED=true \
VITE_DAROTA_ANDROID_TERMS_URL="URL_HTTPS_DOS_TERMOS" \
npm run build
npx cap sync android
npx cap open android
```

Substituir a URL de exemplo por termos efetivamente publicados. Conferir o maior versionCode já enviado ao Play Console e incrementar antes de gerar o AAB. A preparação não altera versionCode automaticamente.

A versão debug mantém sufixo `.gpsteste`; compras são configuradas para `com.kellencastilho.darota`. Usar uma versão release assinada do pacote correto, distribuída por faixa de teste do Google Play. Adicionar a conta Google do aparelho aos testadores de licença e aos testadores da faixa. Não publicar para todos antes de testar.

## Verificação

```bash
npm ci
node --test tests/googleSubscription.test.js tests/googleSubscriptionApi.test.js tests/appleSubscription.test.js tests/subscriptionQuota.test.js
npm --prefix tests/quota-validation ci
node tests/quota-validation/google-sql-test.mjs
node tests/quota-validation/apple-sql-test.mjs
npm run build
```

Foi realizada compilação de tipos do plugin Java contra o artefato real Billing 9.1.0, com stubs mínimos Capacitor/Android. Isso não substitui a compilação Gradle completa no Android Studio.

No Android físico: cadastro/login; scanner consentido; importar mais de 5 entregas em conta com cota ativada; seleção legível; compra aprovada; compra pendente; cancelamento; restauração com mesma conta; rejeição de outra conta; renovação de teste; vencimento; RTDN; exclusão da conta. Conferir também que os usuários de teste existentes mantêm o comportamento configurado.

O APK/AAB, teste físico de cobrança e implantação do backend/banco permanecem pendentes. A integração Apple nativa não foi alterada.

## Referências oficiais

- https://developer.android.com/google/play/billing/integrate
- https://developer.android.com/google/play/billing/release-notes
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptionsv2
- https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions/acknowledge
- https://cloud.google.com/pubsub/docs/authenticate-push-subscriptions
