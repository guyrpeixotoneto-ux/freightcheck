# FreightCheck

Audita os modelos de remuneração que a Ambev entrega pelo Freightec, mostrando o
que mudou entre vigências e quanto isso custa — sem nunca exibir um número que
não consiga sustentar até a célula da planilha de origem.

## Run & Operate

**Botão Run do Replit.** É o caminho inteiro, e é o único. O que sobe são os
dois services declarados nos `.replit-artifact/artifact.toml`, um por artifact,
os dois implementados por `scripts/dev.mjs`:

| service | porta | o que faz |
| --- | --- | --- |
| `web` (freightaudit) | 25609 | Vite, encaminhando `/api` para a 8080 |
| `API Server` | 8080 | aplica migrations, reconstrói o bundle, sobe, e reconstrói a cada alteração no código |

Nada disso exige terminal: `PORT` e `BASE_PATH` vêm do `[services.env]` de cada
artifact e o `API_PROXY_TARGET` do próprio script. Um workspace novo funciona
só apertando Run.

**Uma forma só de subir.** O `.replit` não declara workflow nem `[[ports]]` de
propósito: um workflow subindo os mesmos dois processos por fora seria uma
segunda stack, em portas próprias, e foi assim que um 502 sobreviveu a duas
correções — pela porta da stack paralela tudo respondia, e pela URL do app
nenhuma chamada de API chegava. Se você precisar rodar fora do Replit ou em CI,
`pnpm dev` é o mesmo script e as mesmas portas; dentro do Replit ele colide com
os services, o que é o comportamento desejado — a colisão aparece na hora.

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

Importar planilha é feito **pela interface**, em Importações. Nenhum passo do
produto depende de terminal.

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
- `artifacts/api-server` — HTTP
- `artifacts/freightaudit` — interface
- `docs/ARQUITETURA.md` — as decisões estruturais em prosa

## Architecture decisions

- Camadas separadas: RAW é imutável (garantido por trigger), STAGING é
  descartável, CANONICAL é o grão `(snapshot, entidade, atributo) → valor`, e
  COMPARISON é derivado — pode ser recalculado a qualquer momento.
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
- Sempre `pnpm install` depois de um `git pull`: dependências entre pacotes do
  workspace mudam sem que o `package.json` da raiz mude. O hook em
  `scripts/post-merge.sh` faz isso e aplica as migrations.
- `TEST_ADMIN_DATABASE_URL` precisa ter query string (`…/postgres?sslmode=disable`).
  `lib/ingest/src/testing.ts` deriva o banco de cada teste substituindo
  `"/postgres?"`; sem o `?` todos os testes caem no mesmo banco e falham com
  `SKIPPED_DUPLICATE`.
- `pnpm run typecheck` falha em 9 pontos herdados do scaffold
  (`src/components/ui/*` do shadcn e `src/pages/snapshots/[id].tsx`). São
  anteriores a qualquer código deste projeto e não afetam o Run, que não passa
  por `tsc`.
- O limite do `express.json` fica em `app.ts`, não na rota de upload — o parser
  global roda antes e rejeitaria o corpo com 413 antes da rota ver.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
