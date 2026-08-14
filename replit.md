# FreightCheck

Audita os modelos de remuneração que a Ambev entrega pelo Freightec, mostrando o
que mudou entre vigências e quanto isso custa — sem nunca exibir um número que
não consiga sustentar até a célula da planilha de origem.

## Run & Operate

**Botão Run do Replit.** É o caminho inteiro, e é o único. O workflow `Project`
do `.replit` sobe os dois processos em paralelo, com os mesmos comandos que os
`.replit-artifact/artifact.toml` declaram em `[services.development]` e nas
mesmas portas, os dois implementados por `scripts/dev.mjs`:

| service | porta | o que faz |
| --- | --- | --- |
| `web` (freightaudit) | 25609 | Vite, encaminhando `/api` para a 8080 |
| `API Server` | 8080 | aplica migrations, reconstrói o bundle, sobe, e reconstrói a cada alteração no código |

Nada disso exige terminal: `PORT` e `BASE_PATH` vêm do `[services.env]` de cada
artifact e o `API_PROXY_TARGET` do próprio script. Um workspace novo funciona
só apertando Run.

**Uma forma só de subir, e o que a distingue é a porta.** O workflow roda os
mesmos comandos dos artifacts, em 8080 e 25609 — os endereços para onde o
roteador encaminha. O que já quebrou aqui foi um workflow em 5000/5001: uma
segunda stack, em portas para onde nada é encaminhado, e o efeito foi um 502
sobreviver a duas correções, porque pela porta paralela tudo respondia e pela
URL do app nenhuma chamada de API chegava. Fora do Replit e em CI, `pnpm dev` é
o mesmo script e as mesmas portas; dentro do Replit ele colide com o Run, o que
é o comportamento desejado — a colisão aparece na hora.

O `.replit` **precisa** do bloco `[workflows]`: os `artifact.toml` descrevem
como cada service sobe e para onde o roteador manda, mas não disparam nada
sozinhos. Sem `runButton` e sem workflow, apertar Run não inicia processo
nenhum, e a tela fica em "Your app is not running" — foi exatamente o estado em
que este projeto ficou por um dia.

**As portas não são escolha nossa.** Quem serve o app é o roteador do Replit,
que encaminha por caminho — `/` para a interface, `/api` para o api-server — e
o destino de cada um é o `localPort` declarado no `.replit-artifact/artifact.toml`
do artifact. O roteador não verifica se tem alguém escutando: se não tiver,
devolve 502 sem corpo, e só as chamadas de API falham enquanto a tela abre
normalmente. Porta é contrato, e muda em dois lugares ao mesmo tempo:
`artifact.toml` (`localPort` e `[services.env] PORT`) e `scripts/dev.mjs`. O
script recusa subir se o `PORT` que o ambiente injeta não bater com o que usa.

`node scripts/doctor.mjs [url-do-app]` responde, em uma tela, quem está em cada
porta, se há mais de um processo disputando alguma, e o que a URL do app devolve
em `/api` — que é o aceite desta configuração.

- `pnpm dev` — o mesmo, pelo terminal (útil fora do Replit e em CI)
- `pnpm run typecheck` — typecheck de todos os pacotes
- `pnpm run build` — typecheck + build de todos os pacotes
- `pnpm --filter @workspace/db run migrate` — aplica as migrations à mão
- `pnpm dev:seed` — ferramenta de desenvolvimento; **não** é o caminho do produto
- Única env obrigatória: `DATABASE_URL`
- Opcional: `ANTHROPIC_API_KEY` liga a redação por modelo no Assistente de IA.
  Sem ela o assistente **continua respondendo**, com a redação montada em código
  sobre o mesmo material; a tela diz em qual dos dois modos está.
  `ASSISTENTE_MODELO` e `ASSISTENTE_ESFORCO` ajustam modelo e esforço.

Importar planilha é feito **pela interface**, em Importações. Nenhum passo do
produto depende de terminal. **Excluir também**: cada importação da lista tem um
botão Excluir que apaga o que ela produziu — fatos, vigências, comparações e a
evidência RAW —, mostrando antes a conta do que sai e liberando o arquivo para
ser reenviado. O registro da exclusão fica (`import_deletion`); os dados não.

## Acesso

**Nada do produto aparece sem login.** Toda rota da API exige sessão, com cinco
exceções que existem por motivo declarado — `/api/healthz` e `/api/build`
(o health check do deployment não pode depender de credencial) e
`/api/auth/session`, `/login` e `/logout`. A lista está em `isPublicPath`, num
lugar só: rota nova nasce protegida sem ninguém precisar lembrar de protegê-la.

**Contas nascem em Configurações, por quem já tem acesso.** A tela de login
só entra — não cadastra, e não tem link para cadastro. Em Configurações, quem
está logado cria conta para outra pessoa, desativa e reativa acesso, e redefine
a senha de quem esqueceu. É o que existe no lugar de recuperação por e-mail:
este produto não manda e-mail, e fingir que manda seria pior.

**A primeira conta de um ambiente novo é do terminal.** Com o banco vazio não há
quem crie a primeira pela tela — o "primeiro acesso" que existia foi removido de
propósito, porque deixava a porta aberta entre o deploy e o primeiro cadastro:

```
echo "a-senha" | pnpm --filter @workspace/api-server run create-user "Nome" email@empresa.com
```

**Não há papéis.** Quem entra pode tudo, inclusive dar e tirar acesso, e a tela
diz isso em vez de sugerir uma hierarquia que o servidor não tem. O que fica
registrado é *quem fez*: `app_user.created_by` e `disabled_by` guardam o e-mail
de quem deu e de quem tirou o acesso.

**Ninguém é apagado, só desativado.** O `actor` das confirmações já feitas
aponta para essas linhas; apagar uma transformaria um histórico auditável num
e-mail órfão. Desativar tira o acesso, derruba as sessões abertas na hora, e
preserva o histórico. Duas recusas protegem o desfecho pior: não dá para
desativar a própria conta, nem a última que ainda está ativa.

**Trocar de senha derruba as outras sessões.** A própria troca exige a senha
atual e mantém viva só a aba onde foi feita; a redefinição por outra pessoa
derruba todas.

**O que a sessão mudou no produto:** `actor` deixou de ser campo digitado. Quem
confirma uma semântica, quem envia uma planilha e quem promove uma vigência é
lido da sessão, e o servidor ignora o que o corpo do pedido disser. Antes disso
o histórico sustentava "alguém digitou este nome"; agora sustenta quem fez.

Não existe nesta versão: papéis ou permissões por tela, recuperação de senha por
e-mail, e exclusão de conta.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + pino, empacotado com esbuild
- DB: PostgreSQL 16 + Drizzle ORM
- UI: React + wouter + TanStack Query + shadcn/ui + Tailwind
- Testes: Vitest; verificação de navegador com Playwright

## Where things live

- `lib/db` — schema e migrations (fonte da verdade do modelo)
- `lib/ingest` — recebimento do arquivo, RAW, staging, promoção
- `lib/curation` — semântica dos atributos, taxonomia, confirmações humanas
- `lib/comparison` — motor de alterações, visão consolidada
- `artifacts/api-server` — HTTP; autenticação em `src/lib/auth.ts` (as
  primitivas, sem banco), `src/lib/session.ts` (sessões e contas) e
  `src/middlewares/require-session.ts` (o portão)
- `artifacts/freightaudit` — interface; a sessão vive em `src/lib/auth.tsx`, o
  portão em `App.tsx`, e as contas em `src/pages/configuracoes.tsx`
- **Book do Operador** — o contraponto do export, que traz o cadastro
  remunerado da frota e nenhuma regra. O índice dos blocos é transcrição da tela
  do Freightech e mora em `artifacts/freightaudit/src/lib/book-operador.ts`; a
  regra de cada bloco é registrada aqui, em `book_entry`
  (`lib/db/src/schema/book.ts`, rotas em `artifacts/api-server/src/routes/book.ts`),
  de dois tipos — `TEXTO` escrito na tela ou `DOCUMENTO` anexado. Substituir
  cria a revisão seguinte; **não existe DELETE**, e os bytes ficam no Postgres
  porque aqui a entrada *é* o conteúdo e o disco da plataforma é efêmero.
- **Assistente de IA** — `lib/assistant`, rotas em
  `artifacts/api-server/src/routes/assistant.ts`, tela em
  `artifacts/freightaudit/src/pages/assistente.tsx`. É a única superfície sem
  dado próprio: responde a partir do conhecimento do produto escrito em código
  (`src/conhecimento.ts`) e de consultas às **mesmas funções que as telas usam**
  (`src/dados.ts`), e devolve as duas coisas junto com o texto. Ver a seção
  *Assistente de IA* abaixo.
- `docs/ARQUITETURA.md` — as decisões estruturais em prosa
- `docs/PROPOSTA-NAVEGACAO-FREIGHTECH.md` — o mapeamento Freightech → FreightCheck

## Assistente de IA

**Recuperar primeiro, escrever depois.** O material é fechado antes de existir
uma frase — os artigos aprovados neste repositório e as consultas que o banco
respondeu, no recorte de quem perguntou — e só então alguém redige sobre ele: o
modelo, quando há chave configurada; o código, quando não há. Os dois escrevem
do mesmo dossiê, e o dossiê vai junto para a tela. A inversão dessa ordem —
gerar a frase e depois procurar com que sustentá-la — é o defeito clássico do
gênero e produz exatamente o que este produto existe para não exibir.

**O conhecimento mora em código, não num índice vetorial.** Mesma razão de
`labels.ts` e `families.ts`: é decisão de produto, precisa existir com o banco
vazio, passa por revisão quando muda, e é conferível linha a linha por quem
discordar de uma resposta. Nenhum artigo contém número — números vêm de
`dados.ts`, do banco, e envelheceriam ali dentro sendo ditos com a mesma
segurança.

**Toda resposta diz quem a escreveu.** `redacao` é `IA` ou `DETERMINISTICA`, e a
tela mostra isso ao lado do texto. Quando a API de linguagem falha ou recusa, a
resposta sai pela redação em código e o selo muda — o produto não fica sem
responder uma pergunta que sabe responder.

**Não achar é um desfecho.** Abaixo do limiar de relevância a resposta é dizer
que não sabe, com o que perguntar em vez disso. Um assistente que sempre
responde soa igual quando sabe e quando não sabe.

**O denominador do Book não é contado no servidor.** O índice dos blocos é
transcrição da tela do Freightech e vive na interface; o assistente conhece o
que foi registrado em `book_entry` e diz isso, em vez de manter uma segunda
cópia do índice que sairia de sincronia no primeiro rename.

## Architecture decisions

- Camadas separadas: RAW é imutável (garantido por trigger), STAGING é
  descartável, CANONICAL é o grão `(snapshot, entidade, atributo) → valor`, e
  COMPARISON é derivado — pode ser recalculado a qualquer momento.
- **A imutabilidade tem uma porta, e ela abre por dentro.** Excluir uma
  importação é a única operação que apaga RAW e vigência fechada, e as triggers
  da `0001` só a aceitam quando a transação declara
  `freightcheck.purge_import_run` (local à transação, morre no COMMIT — ver
  `0010_import_deletion.sql`). UPDATE em RAW e edição de snapshot fechado
  continuam proibidos em qualquer circunstância: o que passou a existir foi
  desfazer uma importação inteira, não corrigir um número no lugar. Sai o que só
  aquela importação sustentava; o que outra vigência também sustenta fica. Uma
  correção não pode ser apagada antes do que ela corrigiu — a mais recente sai
  primeiro, e apagá-la devolve a revisão anterior a CLOSED. O rastro fica em
  `import_deletion`, que é append-only sem exceção.
- Identidade da entidade é um UUID interno; a placa é um identificador com
  histórico, não a chave. Comparação nunca é por posição de linha.
- Semântica é versionada (`attribute_semantics`) com vigência por data.
  `attribute` guarda a versão corrente como projeção.
- Mudança na fonte cria versão nova; correção da nossa interpretação reescreve a
  versão existente. São ações distintas e nunca compartilham botão.
- Impacto financeiro é acumulado **por periodicidade**. Nunca existe um total
  único somando R$/mês com R$/ano.
- Carreta e Cavalo são séries independentes. O consolidado é projeção da API e
  da interface, não uma entidade de snapshot.
- **Toda leitura acontece dentro de um contexto: `(unidade, canal)`.** Uma
  vigência não é uma data, é uma data *de alguém*. Chavear por data só — que era
  o que `listPeriods` e a visão agrupada faziam — somaria duas unidades que
  entregam no mesmo dia num total que nenhuma das duas reconhece. O contexto é
  resolvido em `lib/comparison/src/series.ts`, e a resposta **sempre diz qual
  contexto ela está descrevendo** e quais outros existem: escolher por padrão
  não pode ser escolher em silêncio.
- **Família operacional e classe de custo são eixos diferentes, e os dois
  valem.** A taxonomia (`taxonomy_node`) responde "custo fixo ou variável?" e
  alimenta o impacto; as famílias do Freightech (Frota, Dimensões, Parâmetros
  Gerais) respondem "de que assunto isto trata?" e servem para reconhecer.
  O segundo eixo vive em `lib/comparison/src/families.ts` — em código, pelo
  mesmo motivo que `labels.ts` — e **não** toca em `attribute.taxonomy_node_id`:
  reclassificar mudaria a classe de custo das comparações futuras e as faria
  divergir do `taxonomy_path` já gravado nas antigas.
- **A soma das famílias fecha com o total da vigência**, dentro de cada
  periodicidade. O índice de composição é montado sobre a vigência inteira e
  passado para cada fatia — um titular e a sua parcela podem estar em famílias
  diferentes (`custo_fixo` e `lucro_fixomodelo_novo_ciclo` estão), e uma fatia
  que montasse o próprio índice traria a dupla contagem de volta.
- **O canal é o prefixo do rótulo da vigência** (`EMPURRADA_1_8_2026`,
  `ROTA_1_8_2026`), derivado e não persistido: `snapshot` é congelado por
  trigger quando fecha, então uma coluna nova não seria preenchível nas
  vigências já importadas. A derivação existe em TypeScript
  (`lib/ingest/src/vigencia.ts`) e em SQL (`series.ts`), e um teste roda as duas
  sobre os mesmos rótulos para que não divirjam. Vigências de canais diferentes
  não se comparam, e a recusa é escrita.

## Product

Importar os exports do Freightec, conferir antes de promover, e então responder:
o que mudou, entre quais vigências, em qual célula da planilha, quanto vale, e
quando a comparação não é confiável — dizendo por quê em vez de inventar um
número.

## User preferences

- Nada de mudança silenciosa por efeito colateral de heurística: toda
  reclassificação precisa ser listada com antes, depois e motivo.
- Não presumir semântica sem evidência suficiente. `UNKNOWN` é uma resposta
  aceitável; certeza fabricada não é.
- O caminho oficial é a interface. `bootstrap` e `dev:seed` são ferramentas de
  desenvolvimento e não devem ser apresentados como o fluxo do produto.

## Gotchas

- **502 em toda chamada de API, com a tela abrindo normalmente, é sempre a
  mesma coisa: não há ninguém na porta para onde o roteador encaminha `/api`.**
  O 502 vem do roteador, não do servidor — nada da sua requisição chegou a
  código nosso. Não adianta mexer em como o navegador envia (já se tentou
  binário, JSON, upload em segundo plano): confira antes se a 8080 está viva.
  Foi assim que o api-server passou de scaffold: o `artifact.toml` dele nunca
  teve `[services.env] PORT`, `src/index.ts` exige `PORT` e morria na primeira
  linha, e a 8080 nunca teve ninguém.
- **Se a API não puder subir, quem ocupa a porta é um explicador.** Migrations
  que falham, build que quebra sem processo anterior, servidor que morre
  sozinho: em todos, `scripts/dev.mjs` deixa na porta um servidor que responde
  503 com o motivo em JSON, e a interface mostra esse motivo. Porta vazia é o
  estado a ser evitado — 502 sem corpo não diz nem de que camada veio. Os
  testes em `scripts/__tests__` existem para que os três caminhos não voltem a
  terminar em silêncio.
- **Nunca subir o api-server com `node dist/index.mjs` direto.** Isso serve o
  bundle que estiver em disco, que pode ser de antes da sua alteração — um
  frontend novo conversando com um servidor velho responde 404 numa rota que
  você acabou de escrever. `scripts/dev.mjs` sempre reconstrói primeiro, e é
  ele que os artifacts rodam em desenvolvimento.
- `curl -s localhost:8080/api/healthz` responde pelo api-server;
  `curl -s localhost:25609/api/healthz` confirma o caminho inteiro pela
  interface. Um proxy do Vite sem servidor atrás responde **500**, não 502 — a
  diferença entre os dois números diz em qual camada procurar.
- Dependências entre pacotes do workspace mudam sem que o `package.json` da raiz
  mude, e o que falta depois de um `git pull` não é código: são os symlinks de
  `@workspace/*` dentro de `node_modules`, que só o install cria. Sem eles o
  build para com `Could not resolve "@workspace/..."`, apontando para o `import`
  em vez da causa — foi assim que o Assistente de IA chegou quebrado num
  workspace onde o código estava inteiro. **O Run não depende mais de ninguém
  lembrar disso**: `scripts/dev.mjs` roda `pnpm install --frozen-lockfile` antes
  de construir, e se ele falhar quem ocupa a porta diz que foi o install. O hook
  em `scripts/post-merge.sh` continua fazendo o mesmo e aplicando as migrations.
- `TEST_ADMIN_DATABASE_URL` precisa ter query string (`…/postgres?sslmode=disable`).
  `lib/ingest/src/testing.ts` deriva o banco de cada teste substituindo
  `"/postgres?"`; sem o `?` todos os testes caem no mesmo banco e falham com
  `SKIPPED_DUPLICATE`.
- `pnpm run typecheck` passa limpo, e passa a valer como porta: erro que aparecer
  ali é de agora, não herança. Eram 9 pontos vindos do scaffold, zerados em três
  etapas. Três apontavam para o `cn` de `src/lib/utils.ts`, que descartava o
  objeto `{ classe: condição }` que todo componente do shadcn passa — o efeito
  visível era **todo botão do produto sem cor, sem altura e sem padding**, em
  todas as telas; `cn` agora é `twMerge(clsx(...))`, que é o contrato que esses
  componentes já assumiam. Quatro estavam em `alert-dialog`, `calendar`,
  `command` e `pagination`, que o scaffold trouxe importando um `buttonVariants`
  e um `DialogContent` que o `button.tsx` e o `dialog.tsx` deste projeto — dois
  componentes escritos à mão, sem `cva` e sem Radix — nunca exportaram. Nenhuma
  tela os importava: foram removidos, porque componente que não compila e ninguém
  usa só ensina a ignorar o typecheck. Os dois últimos estavam em
  `src/pages/snapshots/[id].tsx` (ver o comentário lá, sobre o `queryKey`).
- **`pnpm run build` precisa de `PORT` e `BASE_PATH`.** Não é o typecheck: o
  `vite.config.ts` do `mockup-sandbox` exige as duas e para o build da raiz sem
  elas. No Replit cada artifact injeta as suas pelo `[services.env]`; pelo
  terminal, `PORT=8081 BASE_PATH=/__mockup pnpm run build`. Os dois artifacts do
  produto (`api-server` e `freightaudit`) constroem sem nada disso.
- **401 em toda chamada de API é sessão, não infraestrutura.** A interface leva
  para a tela de login por conta própria; se isso acontecer no meio de um
  trabalho, a sessão expirou (sete dias, absolutos) ou alguém saiu em outra aba.
  É diferente do 502 e do 503: o 503 de `SESSION_CHECK_FAILED` quer dizer que o
  banco não respondeu para *verificar* a sessão, e aí o problema não é a senha
  de ninguém.
- **O assistente sem `ANTHROPIC_API_KEY` não está quebrado.** Ele responde do
  mesmo conhecimento e das mesmas consultas; o que muda é quem redige, e a tela
  diz qual dos dois foi. Um relato de "o assistente não usa IA" quase sempre é a
  chave ausente, não um defeito — confira `GET /api/assistant/capabilities`.
- O limite do `express.json` fica em `app.ts`, não na rota de upload — o parser
  global roda antes e rejeitaria o corpo com 413 antes da rota ver.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
