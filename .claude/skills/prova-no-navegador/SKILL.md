---
name: prova-no-navegador
description: Subir o FreightCheck inteiro (Postgres, vigências, comparações, usuário, interface e API) e conferir uma tela no navegador de verdade. Use quando pedirem para rodar o app, tirar print, ou confirmar que uma mudança funciona na tela — não só nos testes.
---

# Conferir uma tela do FreightCheck no navegador

## Por que esta skill existe

A Evolução anual do FINAME foi entregue com typecheck limpo, build limpo e
1.929 testes de tela verdes — e tinha **dois defeitos** que só apareceram
quando alguém abriu a página:

- o cartão da variação ponta a ponta vinha vazio, porque
  `getEndToEndAnalysis` recorta por `parameterKey` (`FAMÍLIA|parâmetro`) e a
  tela mandava código de atributo. As duas funções estavam corretas
  isoladamente; o defeito morava na fronteira entre elas;
- o cabeçalho continuava prometendo a outra tela.

Nenhum dos dois é pegável por teste de unidade. A conclusão não foi "escrevam
mais testes" — foi que **abrir a tela precisa custar um comando**.

## Subir o ambiente

```bash
node scripts/prova-local.mjs subir
```

Um comando, do zero, num container sem nada. Ele é idempotente: rodar de novo
sobre um ambiente de pé não refaz o que já está feito.

Os seis passos, e por que cada um existe:

1. **Cluster de Postgres** em `/tmp/pgsock:5433`. Esse endereço não é escolha
   do script: é o `TEST_ADMIN_DATABASE_URL` padrão de
   `lib/ingest/src/testing.ts`, então o mesmo cluster serve as suítes de teste.
   Sobe com `max_connections=200` — com o padrão de 100 o cluster **cai no meio
   da suíte** de `lib/comparison` (47 arquivos com `ECONNREFUSED`, que parece
   defeito de código e não é). Roda como o usuário `postgres`, porque `initdb`
   recusa root.
2. **Banco** `freightcheck_dev`.
3. **Vigências**, via `pnpm run dev:seed` — 18 snapshots dos workbooks de
   `attached_assets`.
4. **Comparações**, via `artifacts/api-server/src/cli/prova-dados.ts`. **É o
   passo que falta em `dev:seed`**, e o que mais custa a descobrir: sem ele,
   toda tela de intervalo (Linha do Tempo, Evolução por Placa, Evolução anual
   do FINAME) abre com as vigências viradas em lacunas e zero alterações. A
   tela está certa — ela diz que não há comparação calculada, em vez de contar
   zero —, mas quem está conferindo lê como defeito.
5. **Usuário** `dev@freightcheck.dev` / `prova-local-2026`, via o
   `create-user` que já existia. A API recusa anônimo em toda rota de produto.
   O e-mail tem domínio de verdade porque o validador do produto recusa
   `dev@local`; a senha tem 10+ caracteres pela mesma razão.
6. **Interface e API**, via `scripts/dev.mjs`, em `:25609` e `:8080`.

Outros comandos:

```bash
node scripts/prova-local.mjs estado   # o que está de pé, com as contagens
node scripts/prova-local.mjs cookie   # o cookie de sessão, para o navegador
node scripts/prova-local.mjs parar    # derruba servidores e cluster
node scripts/prova-local.mjs subir --sem-servidores   # só o banco
```

## Dirigir o navegador

Chromium já está no container. **Não rode `playwright install`.** Só falta o
cliente:

```bash
npm install playwright-core@1.50.1 --no-save --prefix /tmp/pw
```

O binário fica em `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.

Entre pelo **cookie**, não pelo formulário: o login por formulário não navega
de forma confiável em script, e o cookie vem pronto de `prova-local.mjs
cookie`.

```js
import { chromium } from "/tmp/pw/node_modules/playwright-core/index.mjs";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const ctx = await browser.newContext({
  viewport: { width: 1500, height: 1000 },
  deviceScaleFactor: 2,
});
await ctx.addCookies([
  { name: "freightcheck_session", value: TOKEN, domain: "localhost", path: "/" },
]);
const page = await ctx.newPage();

// Erros de console são parte do resultado, não ruído de fundo.
const erros = [];
page.on("pageerror", (e) => erros.push(String(e)));
page.on("console", (m) => m.type() === "error" && erros.push(m.text()));
```

Duas coisas que economizam uma hora:

- **Espere de verdade.** `networkidle` não basta: as telas fazem consultas
  encadeadas (a matriz e a ponta a ponta saem juntas, e uma troca de recorte
  refaz as duas). Depois de cada clique que muda recorte, dê
  `waitForTimeout(6000)` antes de ler a tela.
- **Olhe o print.** Um frame em branco é falha de carga, não sucesso. Os dois
  defeitos citados lá em cima estavam **visíveis** no primeiro print e não
  apareciam em asserção nenhuma.

## Dirigir, não só abrir

Abrir a página prova que a rota resolve. O que interessa é o que um usuário
faria. Para uma tela de auditoria, o roteiro mínimo:

1. abrir a tela e conferir o cabeçalho (título, pastilha, descrição);
2. trocar cada recorte e **ler os números**, não só o print — dois recortes
   complementares têm de particionar o total:
   `Cavalo + Carreta = Cavalo + Carreta`, em **cada** cartão. Foi essa soma que
   provou que o filtro interno recorta as duas leituras, e não só uma;
3. abrir uma linha e conferir o painel lateral;
4. sair da tela e conferir que o endereço volta limpo;
5. conferir que `erros` está vazio no fim.

Um exemplo completo desse roteiro, para a Evolução anual do FINAME, está em
`docs/PROVA-DA-EVOLUCAO-DE-FINAME.md`.

## Quando terminar

`node scripts/prova-local.mjs parar`. O cluster em `/tmp` some com o
container; o comando existe para liberar as portas numa sessão longa.
