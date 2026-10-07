# DaRota: preparação do plano mensal

Base: c46fa4e, branch gps-android-profissional. Proposta: cinco novos cadastros de entrega por dia por conta; plano mensal previsto de R$ 25,90.

## O que está pronto nesta etapa

O cadastro por formulário, voz, scanner e importação usa o mesmo ponto de gravação. Importações acima do saldo abrem seleção de entregas, apresentação do plano ou cancelamento. Cada pacote é uma entrega, inclusive quando vários vão ao mesmo prédio. Editar e concluir não consomem nova unidade; excluir não devolve unidades. A renovação diária usa meia-noite em America/Sao_Paulo.

O banco controla a contagem por usuário, com trava por conta para pedidos simultâneos. Lotes acima do saldo são recusados integralmente. O cliente não pode conceder premium nem apagar a contagem. A importação por bairros escolhe as entregas antes de criar as pastas.

## Esta etapa não ativa cobrança nem bloqueios

A variável VITE_DAROTA_QUOTA_ENABLED fica ausente ou false. Todas as contas começam com enforced=false no banco. A aplicação normal não chama as novas funções de limite enquanto a variável está desligada. Não execute a migração no servidor nem ative contas nesta etapa.

A tela do plano informa que a assinatura está em preparação. Não existe checkout, compra, renovação ou restauração implementada. R$ 25,90 é o preço proposto, não um produto cadastrado na Apple. Esta alteração não publica uma atualização nas lojas e não atualiza os aplicativos já instalados.

## Aplicar no Mac

Na raiz do projeto, com árvore limpa e base c46fa4e:

```sh
git apply --check ~/Downloads/DaRota-plano-mensal-preparacao.patch
git apply ~/Downloads/DaRota-plano-mensal-preparacao.patch
node --test tests/subscriptionQuota.test.js
npm run build
```

Não copie arquivos inteiros por cima do projeto. Se a verificação falhar, pare e confira o commit/base antes de aplicar. Não use --reject. Para desfazer antes de novas edições: git apply -R ~/Downloads/DaRota-plano-mensal-preparacao.patch.

## Validação feita

Cinco testes de seleção/contagem, 14 verificações de SQL em PostgreSQL embarcado (PGlite) e três verificações do hook React passaram. A build Vite passou, mantendo o aviso já existente de tamanho do bundle. Nenhuma migração foi executada no Supabase de produção. Os testes SQL usam esquema mínimo equivalente, não uma cópia do banco real.

Para repetir as verificações completas, as dependências de teste ficam separadas das dependências do aplicativo:

```sh
npm install --prefix tests/quota-validation --package-lock=false
npm test --prefix tests/quota-validation
```

## Próxima etapa após ativação da inscrição Apple

Criar a assinatura no App Store Connect e integrar compras nativas, validação das transações no servidor, renovação, expiração e restauração. O preço exibido na compra deve vir da loja, com termos e política. Validar esses fluxos e a migração em ambiente de teste com o esquema real antes de ligar qualquer limite. Preservar contas dos testadores Android enquanto a integração de cobrança Android não estiver pronta.

Atenção: os limites são por CADASTROS novos de entregas, não pelo ato de marcar uma entrega como concluída. Os cadastros feitos enquanto a proteção está desativada não são debitados retroativamente.
