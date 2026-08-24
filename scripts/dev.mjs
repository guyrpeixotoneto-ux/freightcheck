#!/usr/bin/env node
/**
 * Subir o FreightCheck em desenvolvimento.
 *
 * O projeto são dois processos — a interface (Vite) e o api-server — e até aqui
 * nada no repositório dizia isso. As portas, o encaminhamento do `/api` e a
 * ordem de migrations viviam no estado que o Replit guarda fora do repositório,
 * então um workspace novo não subia, e o que subia servia o build anterior.
 *
 * Este arquivo é a fonte única dessa configuração. O `.replit` chama
 * `node scripts/dev.mjs api` e `node scripts/dev.mjs web` como dois workflows
 * separados, para o Replit gerenciar cada processo e mostrar os logs separados;
 * `node scripts/dev.mjs` sem argumento sobe os dois, que é o equivalente pelo
 * terminal. As portas ficam definidas uma vez só, aqui, e os dois caminhos não
 * podem divergir.
 *
 * O papel `api` sempre reconstrói antes de subir, e reconstrói de novo quando o
 * código muda. Um `dist/index.mjs` antigo convivendo com um frontend novo foi a
 * origem de uma tarde inteira de 502 sem explicação; não é um estado que valha
 * a pena continuar sendo possível.
 */
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApiSupervisor } from "./lib/api-supervisor.mjs";
import { diretoriosObservados } from "./lib/observados.mjs";
import {
  conferirArestas,
  explicarFalhaDeResolucao,
} from "./lib/arestas-do-workspace.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * As portas não são escolha deste arquivo: são o endereço para onde o roteador
 * do Replit encaminha cada caminho, declarado em `localPort` nos
 * `.replit-artifact/artifact.toml`. `/api` vai para a 8080 e `/` para a 25609,
 * e o roteador não pergunta a ninguém se tem alguém lá.
 *
 * Subir nas portas 5000/5001, como este arquivo fazia, deixava a stack inteira
 * de pé num endereço que o roteador não usa: quem abrisse a porta da interface
 * direto via tudo funcionando, e quem abrisse o app pelo roteador recebia 502
 * em toda chamada de API. Os dois estados coexistiam sem se contradizer.
 *
 * Mudar uma porta aqui exige mudar o `localPort` e o `PORT` do artifact
 * correspondente — e o `[[ports]]` do `.replit`. WEB_PORT/API_PORT
 * sobrescrevem, para rodar fora do Replit sem tocar em configuração.
 */
const WEB_PORT = process.env["WEB_PORT"] ?? "25609";
const API_PORT = process.env["API_PORT"] ?? "8080";

const children = new Set();

/** `cwd` só é passado por quem precisa rodar dentro de um artifact. */
function spawnChild(command, args, env = {}, cwd = root) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  return child;
}

/** Roda um comando até o fim e devolve o código de saída. */
function runToCompletion(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawnChild(command, args, env);
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

/**
 * O mesmo, guardando a saída além de imprimi-la.
 *
 * Quando migrations ou build falham, o motivo é a única coisa que importa — e
 * ele precisa sair do console e chegar à tela de quem está operando. Por isso
 * a saída é capturada e devolvida, não só ecoada.
 */
function runCaptured(command, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    children.add(child);
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        output += chunk;
        process.stdout.write(chunk);
      });
    }
    child.on("exit", (code) => {
      children.delete(child);
      resolve({ ok: code === 0, output });
    });
    child.on("error", (err) => {
      children.delete(child);
      resolve({ ok: false, output: `${output}\n${err.message}` });
    });
  });
}

/**
 * O build, precedido da conferência do grafo do workspace.
 *
 * **O defeito que esta ordem fecha.** O esbuild parou com
 * `Could not resolve "@workspace/coverage"` apontando para
 * `lib/assistant/src/aprofundar.ts`, num workspace onde a dependência estava
 * declarada como `workspace:*`, o lockfile íntegro, o
 * `pnpm install --frozen-lockfile` passando, o símbolo exportado e um symlink
 * `@workspace/coverage` presente — em `artifacts/api-server/node_modules/`. O
 * que faltava era `lib/assistant/node_modules/@workspace/coverage`: o pnpm liga
 * por pacote que declara, e aquele `node_modules` era anterior à aresta. Como
 * só uma aresta era nova, só um import falhava, e "só o coverage não resolve"
 * mandou procurar defeito no pacote importado — `exports`? falta um `dist`? o
 * bundler? — que é o lugar onde não havia nada errado.
 *
 * A mensagem do bundler nomeia o import; ela não tem como nomear um link
 * ausente a dois diretórios dali. Quem tem é a varredura de
 * `arestas-do-workspace.mjs`, que compara o que os `package.json` declaram com
 * o que está no disco. Ela roda **antes** do build porque, nesse estado, o
 * build não tem como terminar — e a recusa com o motivo certo vale mais do que
 * um erro verdadeiro apontando para o arquivo errado.
 *
 * Custa nada no caminho feliz: é leitura de diretório, sem rede e sem
 * gerenciador de pacotes. A regra da partida continua valendo — nada aqui
 * invoca o pnpm; o comando é **dito** a quem lê.
 */
async function construirApi() {
  const { frase } = conferirArestas(root);
  if (frase !== null) {
    console.error(`[api] ${frase}`);
    return { ok: false, output: frase };
  }

  const resultado = await runCaptured("node", ["artifacts/api-server/build.mjs"]);
  if (resultado.ok) return resultado;

  /*
    O build falhou mesmo com o grafo em dia. Se foi por resolução, a explicação
    ainda cabe — e ali ela é outra: com o link no lugar, o que falta num
    `@workspace/x/subcaminho` é a entrada em `exports` do pacote importado.
    Mandar rodar install nesse caso seria mandar repetir um comando que não
    muda nada.
  */
  const explicacao = explicarFalhaDeResolucao(resultado.output, root);
  if (explicacao === null) return resultado;
  console.error(`[api] ${explicacao}`);
  return { ok: false, output: `${resultado.output}\n${explicacao}` };
}

function shutdown(code = 0) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ---------------------------------------------------------------------------
// api-server
// ---------------------------------------------------------------------------

async function startApi() {
  const supervisor = createApiSupervisor({
    port: API_PORT,
    /**
     * Instalar dependência **não** é efeito colateral de subir o servidor.
     *
     * Aqui era: `pnpm install --frozen-lockfile` foi por muito tempo a primeira
     * coisa que `start()` fazia, e havia uma boa razão. Um merge que só
     * acrescenta uma dependência entre pacotes do workspace não muda nada
     * visível no repositório, mas muda o que precisa existir dentro de
     * `node_modules`: o esbuild resolve `@workspace/*` pelos symlinks que o
     * install cria, e sem eles o build para com
     * `Could not resolve "@workspace/..."`, que aponta para o `import` e não
     * para a causa. Foi assim que o Assistente de IA chegou quebrado num
     * workspace onde o código estava inteiro.
     *
     * A razão continua verdadeira; o remédio é que estava no lugar errado.
     * Instalar antes de abrir a porta põe o gerenciador de pacotes **entre o
     * workflow e a porta**. Num contêiner onde o pnpm não sobe — o bootstrap do
     * Replit em laço no `pnpm add pnpm@10.33.0`, que foi o que derrubou o build
     * da publicação — este passo não falha rápido: fica pendurado. E enquanto
     * pendura, ninguém escuta na 8080. Web e API ficaram mudos ao mesmo tempo,
     * e o que chega a quem opera é "o workflow não abriu a porta em 90
     * segundos" — que não se parece nem um pouco com "o pnpm não existe".
     *
     * A ordem certa é a inversa: **a porta abre primeiro**, e quem não
     * conseguir subir explica o motivo por ela — que é o que o explicador do
     * supervisor faz, e o que um 502 nunca fez.
     *
     * `node_modules` incompleto continua sendo um problema real, e agora
     * aparece onde dá para lê-lo: o build falha, o explicador ocupa a porta com
     * a mensagem, e o conserto é um comando — `pnpm install --frozen-lockfile`.
     * O `[postMerge]` do `.replit` continua rodando o install depois de cada
     * merge.
     */
    runInstall: null,
    /*
      O supervisor não migra — e isso continua sendo sobre camada, não sobre
      política. Quem abre conexão é o servidor, e é ele que decide
      (`deveMigrarNaPartida`) e registra a decisão no log. A política mudou de
      sinal: em NODE_ENV=development o servidor **converge** o schema pela fila
      versionada na partida, porque Development atrás é o que faz o Provision
      do Publishing propor remover de Production o que as migrations criaram —
      o diff destrutivo que apagou dado real em 17 e 18/08/2026. A história
      completa, incluindo por que a regra anterior existiu, está em
      docs/MIGRATIONS.md e no cabeçalho de `deveMigrarNaPartida`.
    */
    runMigrations: null,
    /*
      O mesmo comando que `@workspace/api-server` declara em `build`, invocado
      direto. Passar por `pnpm run` aqui só acrescentaria uma dependência do
      gerenciador de pacotes ao caminho que abre a porta — e é exatamente essa
      dependência que deixou os dois workflows mudos por 90 segundos.

      `scripts/__tests__/startup-sem-pnpm.test.mjs` prende os dois lados: que
      este caminho não invoca `pnpm`, e que o comando aqui continua sendo o
      mesmo que o `package.json` declara. Sem essa segunda prova, a duplicação
      viraria deriva na primeira vez que alguém mudasse o script.

      `construirApi` é esse mesmo comando com a conferência do grafo do
      workspace na frente — ver o cabeçalho dela. Ela não acrescenta pnpm
      nenhum ao caminho: lê diretório e diz o comando a quem lê.
    */
    runBuild: () => construirApi(),
    spawnServer: () =>
      spawnChild(
        "node",
        ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
        { PORT: API_PORT, NODE_ENV: "development" },
      ),
  });

  if (!process.env["DATABASE_URL"]) {
    console.warn(
      "[api] DATABASE_URL não está definido — subindo sem banco.",
    );
  } else {
    /*
      Esta linha já afirmou uma coisa que este arquivo não controla.

      Ela dizia "migrations NÃO são aplicadas na partida" — e o `runMigrations:
      null` acima é verdade sobre o supervisor, mas o supervisor não abre conexão
      com o banco. Quem abre é o servidor que ele sobe, e o servidor decidia
      sozinho, pela mera existência de `DATABASE_URL`. O console prometia uma
      coisa e o processo seguinte fazia outra, na mesma partida; foi assim que
      Development chegou à `0021` sem ninguém pedir.

      Agora quem decide é `deveMigrarNaPartida()`, dentro do servidor, e é o
      servidor que registra a decisão e o motivo dela. Aqui fica só o que este
      arquivo de fato sabe: que ele não migra, e por onde se migra à mão.
    */
    console.warn(
      "[api] este script não migra o banco; quem decide é o servidor " +
        "(`deveMigrarNaPartida`), e em NODE_ENV=development ele converge o " +
        "schema pela fila versionada, dizendo no log o que aplicou. Para " +
        "aplicar à mão: `pnpm --filter @workspace/db run migrate` — ver " +
        "docs/MIGRATIONS.md.",
    );
  }

  await supervisor.start();

  /*
    O que muda no repositório tem de chegar ao processo que está de pé — e isso
    inclui a fila versionada, não só o código. `diretoriosObservados` é quem diz
    quais são as pastas e por quê (ver `lib/observados.mjs`); aqui fica só o
    efeito, que é o mesmo para todas: reconstruir e reiniciar, uma vez.

    Reiniciar é o passo que importa para uma migration nova: quem aplica a fila
    é o servidor na partida (`deveMigrarNaPartida`), e sem partida não há
    aplicação. Este arquivo continua não migrando nada por conta própria.
  */
  let debounce = null;
  for (const dir of diretoriosObservados(root)) {
    watch(dir, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void supervisor.rebuild(), 250);
    });
  }
  console.log(`[api] escutando em http://localhost:${API_PORT}/api/healthz`);
}

// ---------------------------------------------------------------------------
// interface
// ---------------------------------------------------------------------------

/*
 * O mesmo comando que `@workspace/freightaudit` declara em `dev`, pelo binário
 * local em vez de `pnpm run`.
 *
 * A web não tem supervisor nem explicador: se o comando não sobe, ninguém
 * ocupa a 25609 e o roteador devolve 502. Enquanto isso passava por `pnpm`, um
 * gerenciador de pacotes quebrado no contêiner era suficiente para deixar a
 * interface inteira fora do ar sem nenhuma mensagem — foi o que aconteceu.
 * Chamando o `vite` direto, a única coisa entre o workflow e a porta é o vite.
 */
function startWeb() {
  /*
    A mesma conferência do lado da API, e aqui ela só **avisa**.

    A web não tem explicador: recusar subir deixaria a 25609 vazia, e o
    roteador devolve 502 sem corpo — a pior mensagem possível, e exatamente o
    estado que este arquivo existe para não produzir. Com o aviso, o Vite sobe,
    e quem for esbarrar num import que não resolve já tem a causa no console
    em vez de descobri-la pelo overlay de erro.
  */
  const { frase } = conferirArestas(root);
  if (frase !== null) console.error(`[web] ${frase}`);

  spawnChild("./node_modules/.bin/vite", ["--config", "vite.config.ts", "--host", "0.0.0.0"], {
    PORT: WEB_PORT,
    BASE_PATH: "/",
    // É isto que faz o `/api` da interface chegar ao api-server. Sem ele o
    // Vite devolve o index.html para chamadas de API, e o erro que aparece na
    // tela não tem relação nenhuma com a causa.
    API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
  }, path.join(root, "artifacts/freightaudit"));
  console.log(`[web] interface em http://localhost:${WEB_PORT}`);
}

// ---------------------------------------------------------------------------

const role = process.argv[2] ?? "all";

/**
 * O roteador encaminha para o `localPort` do artifact e o artifact injeta a
 * mesma porta em `PORT`. Se esse número e o que este script usa divergirem, o
 * processo sobe num endereço para onde nada é encaminhado — que é precisamente
 * o estado que produzia 502 sem nada aparecer quebrado. Divergiu, para tudo.
 */
function assertPortMatchesArtifact(expected) {
  const injected = process.env["PORT"];
  if (!injected || injected === expected) return;
  console.error(
    `[${role}] o ambiente pede PORT=${injected} e este script usa ${expected}. ` +
      `Alinhe o localPort/PORT do .replit-artifact/artifact.toml com scripts/dev.mjs ` +
      `antes de subir: nesta divergência o processo sobe e o roteador devolve 502.`,
  );
  process.exit(1);
}

if (role === "api") {
  assertPortMatchesArtifact(API_PORT);
  await startApi();
} else if (role === "web") {
  assertPortMatchesArtifact(WEB_PORT);
  startWeb();
} else if (role === "all") {
  // Meia stack de pé é pior do que nenhuma: a interface abre, o `/api` não
  // responde, e o erro que aparece na tela não tem relação com a causa. Se um
  // dos dois cair, os dois caem.
  for (const papel of ["api", "web"]) {
    // Sem `PORT`: aqui são dois processos com duas portas, e um PORT herdado
    // valeria para os dois. Cada papel resolve a sua logo abaixo.
    const child = spawnChild("node", ["scripts/dev.mjs", papel], { PORT: "" });
    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(`[${papel}] encerrou com código ${code}; derrubando o resto.`);
        shutdown(code ?? 1);
      }
    });
  }
} else {
  console.error(`Uso: node scripts/dev.mjs [api|web]  (recebi "${role}")`);
  process.exit(1);
}
