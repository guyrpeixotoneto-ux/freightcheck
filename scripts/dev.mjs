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
import { existsSync, readdirSync, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function spawnChild(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
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

function shutdown(code = 0) {
  for (const child of children) child.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

// ---------------------------------------------------------------------------
// api-server
// ---------------------------------------------------------------------------

/**
 * Diretórios de código que, ao mudarem, tornam o bundle obsoleto.
 *
 * Só os `src/`: percorrer os pacotes inteiros arrastaria `node_modules` e
 * `dist` para o watcher, e o rebuild dispararia a si mesmo.
 */
function watchedSourceDirs() {
  const dirs = [];
  const apiSrc = path.join(root, "artifacts/api-server/src");
  if (existsSync(apiSrc)) dirs.push(apiSrc);

  const libRoot = path.join(root, "lib");
  if (!existsSync(libRoot)) return dirs;
  for (const entry of readdirSync(libRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const src = path.join(libRoot, entry.name, "src");
    if (existsSync(src)) dirs.push(src);
  }
  return dirs;
}

async function startApi() {
  // As migrations vêm antes do servidor: subir contra um schema desatualizado
  // é pior do que não subir, porque o erro aparece longe da causa.
  if (process.env["DATABASE_URL"]) {
    const code = await runToCompletion("pnpm", [
      "--filter",
      "@workspace/db",
      "run",
      "migrate",
    ]);
    if (code !== 0) {
      console.error("[api] as migrations falharam; o servidor não vai subir.");
      shutdown(code);
      return;
    }
  } else {
    console.warn(
      "[api] DATABASE_URL não está definido — subindo sem aplicar migrations.",
    );
  }

  let server = null;
  let building = false;
  let queued = false;
  let replacing = false;

  function restartServer() {
    if (server) {
      replacing = true;
      server.kill("SIGTERM");
      server = null;
    }
    const child = spawnChild(
      "node",
      ["--enable-source-maps", "artifacts/api-server/dist/index.mjs"],
      { PORT: API_PORT, NODE_ENV: "development" },
    );
    child.on("exit", (code) => {
      // Um servidor que morreu sozinho é a origem do 502 mais confuso que este
      // projeto já produziu: a interface continua no ar e parece atual. Se
      // acontecer, que apareça dito com todas as letras.
      if (child === server && !replacing && code !== 0) {
        console.error(
          `[api] o servidor encerrou sozinho (código ${code}). ` +
            `A interface vai responder 502 até ele voltar.`,
        );
      }
      replacing = false;
    });
    server = child;
  }

  async function rebuild() {
    if (building) {
      queued = true;
      return;
    }
    building = true;
    const code = await runToCompletion("pnpm", [
      "--filter",
      "@workspace/api-server",
      "run",
      "build",
    ]);
    building = false;

    if (code === 0) {
      restartServer();
    } else {
      // Um build quebrado não deve derrubar o que está de pé: o servidor
      // anterior continua servindo até o código voltar a compilar.
      console.error("[api] build falhou; mantendo o processo anterior.");
    }

    if (queued) {
      queued = false;
      void rebuild();
    }
  }

  await rebuild();

  let debounce = null;
  for (const dir of watchedSourceDirs()) {
    watch(dir, { recursive: true }, () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void rebuild(), 250);
    });
  }
  console.log(`[api] escutando em http://localhost:${API_PORT}/api/healthz`);
}

// ---------------------------------------------------------------------------
// interface
// ---------------------------------------------------------------------------

function startWeb() {
  spawnChild("pnpm", ["--filter", "@workspace/freightaudit", "run", "dev"], {
    PORT: WEB_PORT,
    BASE_PATH: "/",
    // É isto que faz o `/api` da interface chegar ao api-server. Sem ele o
    // Vite devolve o index.html para chamadas de API, e o erro que aparece na
    // tela não tem relação nenhuma com a causa.
    API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}`,
  });
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
