# DaRota: integração iOS da assinatura

Base: 208e290. Produto: com.kellencastilho.darota.premium.mensal. Preço de lançamento no Brasil: R$ 29,90/mês; o preço exibido na compra vem do StoreKit.

Esta branch implementa compra StoreKit 2, restauração, recuperação de compras não finalizadas, preço localizado, termos, política e gerenciamento pela Apple. O usuário da conta Supabase é enviado como appAccountToken. O servidor verifica a assinatura JWS com a biblioteca oficial da Apple e consulta o estado atual na App Store Server API. Não aceita premium informado pelo cliente. Notificações V2 renovam/revogam o acesso. Cancelar renovação mantém acesso até a expiração; cobrança em tentativa sem período de tolerância não libera acesso.

## Estado e limites

Integração preparada para testes, ainda não validada com uma compra Apple. A parte Swift precisa compilar no Mac. Não enviar à revisão antes desses testes. Nenhuma migração ou chave foi aplicada pelo assistente ao servidor.

O limite permanece desligado. A migração 20261008_apple_subscriptions.sql cria apenas armazenamento de assinatura, sem alterar entregas, rotas ou contagem. Todas as contas começam com enforced=false. A migração anterior 20261007_delivery_quota.sql deve ser validada e aplicada separadamente antes de ativar limite de cinco novos cadastros/dia/conta, no horário de São Paulo. Não ativar limites dos testadores Android.

O build number iOS passa a 2. Compilação 1 já enviada continua disponível. Configurações de assinatura e manifesto são preservadas.

## Variáveis somente do servidor na Vercel

- APPLE_IAP_PRIVATE_KEY: conteúdo PEM do .p8; nunca VITE_, Git ou app.
- APPLE_IAP_KEY_ID e APPLE_IAP_ISSUER_ID: conferir na página de chaves da Apple.
- SUPABASE_URL e SUPABASE_SECRET_KEY: chave secreta somente no servidor.
- DAROTA_IAP_ENABLED=true: habilita endpoints apenas após a migração de assinatura.
- DAROTA_IAP_SANDBOX_USERS: UUIDs Supabase das contas de testes/revisão, separados por vírgula. Somente essas contas têm recibos Sandbox aceitos. Produção sempre usa Environment.PRODUCTION.

Para conceder o acesso de teste Sandbox, marcar sandbox_enabled=true SOMENTE nessas contas de teste no banco. Recibos Sandbox não dão acesso por padrão. Não habilitar em todas as contas.

## Variável da interface para testes iOS

VITE_DAROTA_IOS_SUBSCRIPTIONS_ENABLED=true habilita a tela somente em Capacitor iOS. Em Android e web o menu de compra não aparece. Sem variável, a compra permanece desativada. Não alterar VITE_DAROTA_QUOTA_ENABLED nesta etapa.

## Notificações Apple

Configurar App Store Server Notifications V2, produção e sandbox, com:
https://rota-certa-proa.vercel.app/api/notificacoes-apple

O endpoint verifica a assinatura antes de atualizar o banco. Eventos atrasados consultam novamente o estado atual; updates com checked_at mais antigo não substituem o estado mais recente. O aplicativo também atualiza ao abrir/voltar ao primeiro plano e ao restaurar.

## Verificações

```sh
npm ci
node --test tests/appleSubscription.test.js tests/subscriptionQuota.test.js
npm install --prefix tests/quota-validation --package-lock=false
node tests/quota-validation/apple-sql-test.mjs
npm run build
npx cap sync ios
```

Validação local: 11 testes Node, 10 verificações de SQL embarcado (estrutura de entregas/rotas conforme exportação fornecida), importação dos módulos de API, bloqueio por origem e endpoints desligados. Build web passou com aviso existente de tamanho do bundle. Não houve compilação Xcode neste ambiente Linux nem transação Apple real.

No Mac/iPhone testar: carregamento do preço correto, compra, cancelamento da janela de compra, pendência, restaurar após reinstalação, conta DaRota diferente, rede indisponível após pagamento e recuperação ao reabrir, renovação, expiração, reembolso e notificações. Confirmar que a conta ganha acesso somente após validação no servidor. Testar recebimento de notificação V2 e estados no Sandbox antes de liberar produção.

Depois: aplicar/validar quota separadamente para contas iOS escolhidas, preparar captura real do paywall para revisão, atualizar notas e declaração de histórico de compras conforme dados desta versão, selecionar build 2 e anexar a primeira assinatura à versão. Descrever as cinco entregas como novos cadastros por dia, e não como cinco entregas concluídas. Não ativar a cobrança Android nesta branch.
