#!/usr/bin/env node
/**
 * O AMBIENTE DE PROVA — subir o FreightCheck inteiro para olhar a tela.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo existe
 * ---------------------------------------------------------------------------
 * Porque a Evolução anual do FINAME foi entregue com typecheck limpo, build
 * limpo e 1.929 testes de tela verdes — e tinha **dois defeitos** que só
 * apareceram quando alguém abriu a página: o cartão da variação ponta a ponta
 * vinha vazio (o recorte por `parameterKey` não casava nenhum código do
 * financiamento) e o cabeçalho continuava prometendo a outra tela. Nenhum dos
 * dois é pegável por teste de unidade: o primeiro mora na fronteira entre duas
 * funções que, isoladas, estão corretas.
 *
 * A conclusão não é "escrevam mais testes". É que **abrir a tela precisa custar
 * um comando**, ou não vai acontecer na próxima vez. Da primeira vez custou:
 * subir um cluster de Postgres à mão, descobrir que `initdb` recusa rodar como
 * root, criar o banco, semear, descobrir que o seed **não** calcula os
 * `change_set` (as telas de intervalo abriam com oito lacunas e zero
 * alterações), criar um usuário porque a API recusa anônimo, e só então
 * navegar.
 *
 * Tudo isso está aqui dentro, e é idempotente: rodar de novo sobre um ambiente
 * de pé não quebra nada e não refaz o que já está feito.
 *
 * ---------------------------------------------------------------------------
 * O que ele **não** é
 * ---------------------------------------------------------------------------
 * Não é o caminho de importação do produto. Ele chama `dev:seed`, que lê
 * planilhas de `attached_assets` — fixturas do repositório, que nenhuma entrega
 * real vai usar. Serve para desenvolvimento e para conferência visual, e o
 * cabeçalho de `dev-seed.ts` já diz isso em letra grande.
 *
 * Também não substitui `scripts/dev.mjs`: quem já tem um `DATABASE_URL` de pé
 * continua usando aquele direto. Este existe para quem **não tem banco nenhum**
 * — o caso de um container novo, que é onde a conferência visual costuma morrer
 * antes de começar.
 *
 * ---------------------------------------------------------------------------
 * Uso
 * ---------------------------------------------------------------------------
 *   node scripts/prova-local.mjs subir     # banco + dados + usuário + servidores
 *   node scripts/prova-local.mjs estado    # o que está de pé, e o que falta
 *   node scripts/prova-local.mjs cookie    # imprime o cookie de sessão
 *   node scripts/prova-local.mjs parar     # derruba servidores e cluster
 *
 * `subir` aceita `--sem-servidores` para preparar só o banco (útil em CI, ou
 * para rodar as suítes que precisam de Postgres).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/*
  As portas e os caminhos.

  A porta 5433 e o socket em `/tmp/pgsock` não são escolha deste arquivo: é o
  endereço que `lib/ingest/src/testing.ts` usa como `TEST_ADMIN_DATABASE_URL`
  padrão. Um cluster noutro lugar sobe, serve este script, e deixa as suítes de
  teste sem banco — dois estados que coexistem sem se contradizer, que é a
  forma mais cara de errar.
*/
const PGDATA = process.env.PROVA_PGDATA ?? "/tmp/pgdata";
const PGSOCK = process.env.PROVA_PGSOCK ?? "/tmp/pgsock";
const PGPORT = process.env.PROVA_PGPORT ?? "5433";
const BANCO = process.env.PROVA_DB ?? "freightcheck_dev";
const PGBIN = process.env.PROVA_PGBIN ?? "/usr/lib/postgresql/16/bin";

const WEB_PORT = process.env.WEB_PORT ?? "25609";
const API_PORT = process.env.API_PORT ?? "8080";

const USUARIO = process.env.PROVA_EMAIL ?? "dev@freightcheck.dev";
const SENHA = process.env.PROVA_SENHA ?? "prova-local-2026";
const NOME = "Dev Local";

const DATABASE_URL = `postgresql://postgres@localhost/${BANCO}?host=${PGSOCK}&port=${PGPORT}`;
const PID_DOS_SERVIDORES = "/tmp/prova-local-servidores.pid";
const LOG = "/tmp/prova-local.log";

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const passo = (n, texto) => console.log(`\n[${n}] ${texto}`);
const ok = (texto) => console.log(`    ✓ ${texto}`);
const jaEstava = (texto) => console.log(`    · ${texto} (já estava)`);

function rodar(comando, args, opcoes = {}) {
  const r = spawnSync(comando, args, {
    cwd: root,
    encoding: "utf8",
    ...opcoes,
    env: { ...process.env, DATABASE_URL, ...(opcoes.env ?? {}) },
  });
  return { codigo: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/**
 * O mesmo comando, mas como o usuário `postgres`.
 *
 * `initdb` e `pg_ctl` **recusam** rodar como root, e num container o processo
 * costuma ser root. Descobrir isso custa uma mensagem de erro que não diz o que
 * fazer; aqui já vem resolvido, e o `chown` junto — sem ele o cluster é criado
 * e o servidor não consegue ler o próprio diretório.
 */
function comoPostgres(linha) {
  const souRoot = typeof process.getuid === "function" && process.getuid() === 0;
  if (!souRoot) return rodar("sh", ["-c", `PATH=${PGBIN}:$PATH ${linha}`]);
  return rodar("su", ["postgres", "-c", `PATH=${PGBIN}:$PATH ${linha}`]);
}

function clusterDePe() {
  return comoPostgres(`pg_isready -h ${PGSOCK} -p ${PGPORT}`).codigo === 0;
}

function bancoExiste() {
  const r = comoPostgres(
    `psql -h ${PGSOCK} -p ${PGPORT} -d postgres -At -c "SELECT 1 FROM pg_database WHERE datname='${BANCO}'"`,
  );
  return r.codigo === 0 && r.saida.trim() === "1";
}

function consultar(sql) {
  const r = comoPostgres(
    `psql -h ${PGSOCK} -p ${PGPORT} -d ${BANCO} -At -c "${sql.replace(/"/g, '\\"')}"`,
  );
  return r.codigo === 0 ? r.saida.trim() : null;
}

async function esperar(condicao, { tentativas = 60, intervalo = 2000, oQue }) {
  for (let i = 0; i < tentativas; i++) {
    if (await condicao()) return true;
    await new Promise((r) => setTimeout(r, intervalo));
  }
  throw new Error(`Desisti de esperar por ${oQue} (${(tentativas * intervalo) / 1000}s).`);
}

async function respondeHttp(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Os passos
// ---------------------------------------------------------------------------

/**
 * O cluster.
 *
 * `max_connections=200` não é zelo: a suíte de `lib/comparison` sobe um banco
 * por arquivo de teste, e com o padrão de 100 o cluster **cai no meio da
 * suíte** — 47 arquivos falhando com `ECONNREFUSED`, que se parece com um
 * defeito de código e não é.
 */
function subirCluster() {
  passo(1, "Cluster de Postgres");
  if (clusterDePe()) {
    jaEstava(`aceitando conexões em ${PGSOCK}:${PGPORT}`);
    return;
  }

  if (!existsSync(path.join(PGDATA, "PG_VERSION"))) {
    mkdirSync(PGDATA, { recursive: true });
    mkdirSync(PGSOCK, { recursive: true });
    rodar("chown", ["-R", "postgres:postgres", PGDATA, PGSOCK]);
    const r = comoPostgres(`initdb -D ${PGDATA} -U postgres --auth=trust`);
    if (r.codigo !== 0) throw new Error(`initdb falhou:\n${r.saida}`);
    ok(`cluster criado em ${PGDATA}`);
  }

  mkdirSync(PGSOCK, { recursive: true });
  rodar("chown", ["-R", "postgres:postgres", PGSOCK]);
  const r = comoPostgres(
    `pg_ctl -D ${PGDATA} -o "-k ${PGSOCK} -p ${PGPORT} -c listen_addresses= -c max_connections=200" -l /tmp/pg.log -w start`,
  );
  if (!clusterDePe()) throw new Error(`pg_ctl falhou:\n${r.saida}`);
  ok(`de pé em ${PGSOCK}:${PGPORT}`);
}

function criarBanco() {
  passo(2, `Banco ${BANCO}`);
  if (bancoExiste()) {
    jaEstava("existe");
    return;
  }
  const r = comoPostgres(`createdb -h ${PGSOCK} -p ${PGPORT} ${BANCO}`);
  if (r.codigo !== 0) throw new Error(`createdb falhou:\n${r.saida}`);
  ok("criado");
}

/**
 * As vigências.
 *
 * `dev:seed` roda as migrations, importa os workbooks de `attached_assets` e
 * cura a semântica. É idempotente por construção — a segunda importação é
 * recusada como duplicada —, então reexecutar é barato.
 */
function semear() {
  passo(3, "Vigências importadas e curadas");
  const jaTem = Number(consultar("SELECT count(*) FROM snapshot") ?? "0");
  if (jaTem > 0) {
    jaEstava(`${jaTem} snapshots`);
    return;
  }
  const r = rodar("pnpm", ["run", "dev:seed"], { stdio: "inherit" });
  if (r.codigo !== 0) throw new Error("dev:seed falhou — veja a saída acima.");
  ok(`${consultar("SELECT count(*) FROM snapshot")} snapshots`);
}

/**
 * Os `change_set`.
 *
 * **O passo que falta em `dev:seed`**, e o que mais custou a descobrir: sem
 * ele, toda tela de intervalo — Linha do Tempo, Evolução por Placa, Evolução
 * anual do FINAME — abre com as vigências viradas em lacunas e zero alterações.
 * Não é tela quebrada, é tela honesta sobre um banco em que comparação nenhuma
 * foi calculada; mas quem está conferindo uma mudança lê como defeito.
 */
function calcularComparacoes() {
  passo(4, "Comparações entre vigências");
  const jaTem = Number(consultar("SELECT count(*) FROM change_set") ?? "0");
  if (jaTem > 0) {
    jaEstava(`${jaTem} change sets`);
    return;
  }
  const r = rodar("npx", ["tsx", "src/cli/prova-dados.ts"], {
    cwd: path.join(root, "artifacts", "api-server"),
    stdio: "inherit",
  });
  if (r.codigo !== 0) throw new Error("O cálculo das comparações falhou.");
  ok(`${consultar("SELECT count(*) FROM change_set")} change sets`);
}

/**
 * A conta de desenvolvimento — a API recusa anônimo em toda rota de produto.
 *
 * O endereço tem domínio de verdade (`@freightcheck.dev`) porque
 * `describeEmailProblem` recusa `dev@local`: o validador é o do produto, e não
 * vale a pena afrouxá-lo para um script de conferência.
 */
function criarUsuario() {
  passo(5, `Usuário ${USUARIO}`);
  const jaTem = consultar(`SELECT 1 FROM app_user WHERE email='${USUARIO}'`);
  if (jaTem === "1") {
    jaEstava("existe");
    return;
  }
  const r = rodar(
    "sh",
    [
      "-c",
      `printf '%s' '${SENHA}' | pnpm --filter @workspace/api-server run create-user '${NOME}' '${USUARIO}'`,
    ],
    { stdio: "inherit" },
  );
  if (r.codigo !== 0) throw new Error("create-user falhou.");
  ok(`${USUARIO} / ${SENHA}`);
}

async function subirServidores() {
  passo(6, "Interface e API");
  if (await respondeHttp(`http://localhost:${WEB_PORT}/`)) {
    jaEstava(`web em :${WEB_PORT}`);
    return;
  }
  const filho = spawn("node", ["scripts/dev.mjs"], {
    cwd: root,
    detached: true,
    /* O log vai para arquivo, e não para o terminal de quem chamou: o processo
       é desanexado e sobrevive ao comando, então herdar o stdio o prenderia. */
    stdio: ["ignore", openSync(LOG, "a"), openSync(LOG, "a")],
    env: { ...process.env, DATABASE_URL, WEB_PORT, API_PORT },
  });
  filho.unref();
  writeFileSync(PID_DOS_SERVIDORES, String(filho.pid));
  await esperar(() => respondeHttp(`http://localhost:${WEB_PORT}/`), {
    oQue: `a interface em :${WEB_PORT}`,
  });
  ok(`web :${WEB_PORT} · api :${API_PORT} · log em ${LOG}`);
}

/** O cookie de sessão, para um script de navegador entrar sem passar pelo form. */
async function cookie() {
  const r = await fetch(`http://localhost:${WEB_PORT}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: USUARIO, password: SENHA }),
  });
  if (!r.ok) throw new Error(`Login falhou (${r.status}).`);
  const bruto = r.headers.get("set-cookie") ?? "";
  const token = /freightcheck_session=([^;]+)/.exec(bruto)?.[1];
  if (!token) throw new Error("O login respondeu 200 sem cookie de sessão.");
  return token;
}

// ---------------------------------------------------------------------------
// Os comandos
// ---------------------------------------------------------------------------

async function estado() {
  const linhas = [
    ["cluster", clusterDePe() ? `de pé em ${PGSOCK}:${PGPORT}` : "parado"],
    ["banco", bancoExiste() ? BANCO : "ausente"],
  ];
  if (bancoExiste()) {
    linhas.push(["snapshots", consultar("SELECT count(*) FROM snapshot") ?? "?"]);
    linhas.push(["change sets", consultar("SELECT count(*) FROM change_set") ?? "?"]);
    linhas.push(["usuários", consultar("SELECT count(*) FROM app_user") ?? "?"]);
  }
  linhas.push([
    "web",
    (await respondeHttp(`http://localhost:${WEB_PORT}/`)) ? `:${WEB_PORT}` : "parado",
  ]);
  for (const [k, v] of linhas) console.log(`${k.padEnd(14)} ${v}`);
  console.log(`\nDATABASE_URL=${DATABASE_URL}`);
}

function parar() {
  passo(1, "Servidores");
  rodar("pkill", ["-f", "scripts/dev.mjs"]);
  if (existsSync(PID_DOS_SERVIDORES)) rmSync(PID_DOS_SERVIDORES);
  ok("derrubados");
  passo(2, "Cluster");
  comoPostgres(`pg_ctl -D ${PGDATA} -m fast -w stop`);
  ok(clusterDePe() ? "ainda de pé (alguém mais o usa?)" : "parado");
}

async function subir({ comServidores }) {
  subirCluster();
  criarBanco();
  semear();
  calcularComparacoes();
  criarUsuario();
  if (comServidores) {
    await subirServidores();
    console.log(
      `\nPronto. Abra http://localhost:${WEB_PORT} e entre com ${USUARIO} / ${SENHA}.`,
    );
  } else {
    console.log(`\nPronto (sem servidores).\nDATABASE_URL=${DATABASE_URL}`);
  }
}

const comando = process.argv[2] ?? "subir";
try {
  if (comando === "subir") {
    await subir({ comServidores: !process.argv.includes("--sem-servidores") });
  } else if (comando === "estado") {
    await estado();
  } else if (comando === "cookie") {
    console.log(await cookie());
  } else if (comando === "parar") {
    parar();
  } else {
    console.error(
      `Comando desconhecido: ${comando}\n\nUse: subir | estado | cookie | parar`,
    );
    process.exit(1);
  }
} catch (erro) {
  console.error(`\n✗ ${erro instanceof Error ? erro.message : String(erro)}`);
  process.exit(1);
}
