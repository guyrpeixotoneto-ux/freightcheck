/**
 * Onde vão os segundos de uma importação — medido, e não estimado.
 *
 * ---------------------------------------------------------------------------
 * Por que isto mora no repositório
 * ---------------------------------------------------------------------------
 * Toda decisão de desempenho tomada nesta leitura saiu de um número: o INSERT
 * em massa por `unnest`, o tamanho do bloco de células, o passo da barra de
 * progresso. Um número que não pode ser refeito não é evidência, é lembrança
 * — e a próxima pessoa que mexer no pipeline vai precisar responder à mesma
 * pergunta ("ficou mais rápido ou mais lento, e onde?") sem ter estado aqui.
 *
 * Este arquivo é a resposta reproduzível. Ele mede, por etapa: tempo de
 * relógio, CPU do Node, tempo de execução dentro do Postgres
 * (`pg_stat_statements`), tempo dentro do driver, quantas idas ao banco, e o
 * que o banco esperou (`pg_stat_activity`, `pg_locks`). Roda contra um banco
 * descartável criado das migrations, como as suítes.
 *
 * ---------------------------------------------------------------------------
 * O que ele sabe fazer, e por que cada coisa está aqui
 * ---------------------------------------------------------------------------
 * **Latência artificial.** O banco de produção não está no mesmo socket. Cada
 * ida ao banco espera `--rtt` milissegundos antes de sair, o que transforma o
 * número de statements — invisível localmente — na grandeza que ele é lá.
 *
 * **Importações simultâneas.** Uma leitura sozinha não mostra disputa de pool
 * nem lock. `--simultaneas 2` roda duas de ponta a ponta ao mesmo tempo, no
 * mesmo pool, e relata o pico de conexões e o de pedidos na fila.
 *
 * **Repetições.** Uma medição é uma anedota. `--repeticoes` roda o cenário N
 * vezes e relata p50 e p95 por etapa.
 *
 * **Cenários.** As afinações da leitura leem variáveis de ambiente com o nome
 * delas (`IMPORT_LINHAS_POR_BLOCO`, `IMPORT_PASSOS_DE_PROGRESSO`,
 * `IMPORT_CONEXOES_DE_ESCRITA`), então `--cenario` monta o conjunto anterior
 * ou o atual sem trocar de commit no meio da comparação. `paralelo2` e
 * `paralelo` são o atual com duas e com quatro conexões de escrita.
 *
 * ---------------------------------------------------------------------------
 * O que ele **não** mede, e por que não
 * ---------------------------------------------------------------------------
 * `COPY FROM STDIN` foi medido uma vez, com `pg-copy-streams`, contra as
 * mesmas tabelas: 140 mil células em 1,97–2,10 s contra 2,20–2,44 s do
 * `unnest` (−10%), e 112 mil fatos em 3,71 s contra 3,67–3,73 s (empate). Com
 * índices e chaves estrangeiras no meio, o caminho de transferência não é o
 * gargalo — e um ganho de 3% no total não paga uma dependência nova no
 * caminho de escrita mais quente do produto, com escaping próprio e sem
 * `ON CONFLICT`. Por isso o arm de COPY não ficou: para refazê-lo, instale
 * `pg-copy-streams` temporariamente e troque `porUnnest` por um `copyFrom` com
 * as mesmas colunas. O resultado está aqui para não precisar refazer.
 *
 * ---------------------------------------------------------------------------
 * Uso
 * ---------------------------------------------------------------------------
 *     pnpm --filter @workspace/ingest exec tsx src/cli/perfil-de-importacao.ts \
 *       [--linhas 14000] [--rtt 0] [--simultaneas 1] [--repeticoes 3] \
 *       [--cenario atual|anterior|paralelo] [--json]
 *
 * Precisa de um Postgres para criar bancos descartáveis — o mesmo
 * `TEST_ADMIN_DATABASE_URL` das suítes. `pg_stat_statements` é opcional: sem a
 * extensão, a coluna de tempo de Postgres sai vazia e o resto continua válido.
 */
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { captureRaw, preview, receiveFile, stage } from "../pipeline";
import { createTestDatabase, type TestDb } from "../testing";
import { escreverPlanilha, type LinhaSpec } from "../__tests__/planilha-sintetica";

/*
  O driver é pedido em runtime, e não importado no topo.

  `pg` é dependência de `@workspace/db`, que é quem fala com o banco; este
  pacote não o usa em lugar nenhum a não ser aqui, para instrumentar. Pedi-lo
  assim deixa isso escrito: a ferramenta conhece o driver, a biblioteca não.
*/
const exigir = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pg: any = exigir("pg");

// ---------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------
type Cenario = "anterior" | "atual" | "paralelo2" | "paralelo";

interface Opcoes {
  linhas: number;
  rtt: number;
  simultaneas: number;
  repeticoes: number;
  cenario: Cenario;
  json: boolean;
}

function lerOpcoes(argv: string[]): Opcoes {
  const valor = (nome: string, padrao: string): string => {
    const i = argv.indexOf(`--${nome}`);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
  };
  const cenario = valor("cenario", "atual") as Cenario;
  if (!["anterior", "atual", "paralelo2", "paralelo"].includes(cenario)) {
    throw new Error(`cenário desconhecido: ${cenario}`);
  }
  return {
    linhas: Number(valor("linhas", "14000")),
    rtt: Number(valor("rtt", "0")),
    simultaneas: Number(valor("simultaneas", "1")),
    repeticoes: Number(valor("repeticoes", "3")),
    cenario,
    json: argv.includes("--json"),
  };
}

/**
 * As afinações de cada cenário, aplicadas ao ambiente antes de importar nada.
 *
 * `anterior` é o que o pipeline fazia antes desta medição: bloco de 200 linhas,
 * cem publicações de progresso por trecho, escrita em série. `atual` é o
 * padrão do código. `paralelo` é `atual` mais quatro conexões de escrita — a
 * hipótese que este arquivo existe para aprovar ou reprovar.
 */
const CENARIOS: Record<Cenario, Record<string, string>> = {
  anterior: {
    IMPORT_LINHAS_POR_BLOCO: "200",
    IMPORT_PASSOS_DE_PROGRESSO: "100",
    IMPORT_CONEXOES_DE_ESCRITA: "1",
  },
  atual: {
    IMPORT_LINHAS_POR_BLOCO: "2000",
    IMPORT_PASSOS_DE_PROGRESSO: "20",
    IMPORT_CONEXOES_DE_ESCRITA: "1",
  },
  paralelo2: {
    IMPORT_LINHAS_POR_BLOCO: "2000",
    IMPORT_PASSOS_DE_PROGRESSO: "20",
    IMPORT_CONEXOES_DE_ESCRITA: "2",
  },
  paralelo: {
    IMPORT_LINHAS_POR_BLOCO: "2000",
    IMPORT_PASSOS_DE_PROGRESSO: "20",
    IMPORT_CONEXOES_DE_ESCRITA: "4",
  },
};

// ---------------------------------------------------------------------------
// Instrumentação do driver: latência artificial e contagem de idas
// ---------------------------------------------------------------------------
interface Ida {
  etapa: string;
  texto: string;
  ms: number;
}

const idas: Ida[] = [];
let etapaAtual = "preparo";
let rttMs = 0;

/** O que o observador e a própria medição perguntam — nunca é a importação. */
const DE_FORA = /pg_stat_activity|pg_locks|pg_stat_statements|pg_extension/;

/*
  O pool do `pg` chama `client.query(texto, valores, callback)` — estilo
  callback, que devolve um `Query` e não uma promessa. Um wrapper que só
  encadeasse `.then` mediria zero: o retorno vem antes da resposta. Quem sabe
  quando a resposta chegou é o callback, e é ele que carimba o tempo.
*/
function instrumentarDriver(): void {
  const original = pg.Client.prototype.query;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pg.Client.prototype.query = function (this: unknown, ...args: any[]) {
    const texto =
      typeof args[0] === "string" ? args[0] : (args[0]?.text ?? String(args[0]));
    /*
      O observador não é a importação, e não pode entrar na conta dela.

      Ele pergunta ao banco a cada poucos milissegundos o que está acontecendo,
      pela conexão dele. Contá-lo como ida da leitura inflaria o número que
      esta ferramenta existe para medir — e atrasá-lo com a latência artificial
      mediria a rede do observador, não a do pipeline. Uma matriz inteira já
      saiu errada por isto.
    */
    if (DE_FORA.test(texto)) {
      return original.apply(this as never, args as never);
    }
    const t0 = performance.now();
    const etapa = etapaAtual;
    const registrar = (): void => {
      idas.push({ etapa, texto, ms: performance.now() - t0 });
    };

    const ultimo = args[args.length - 1];
    if (typeof ultimo === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args[args.length - 1] = (...resposta: any[]) => {
        registrar();
        return ultimo(...resposta);
      };
      const disparar = (): unknown => original.apply(this as never, args as never);
      if (rttMs > 0) {
        setTimeout(disparar, rttMs);
        return undefined as never;
      }
      return disparar();
    }

    const disparar = (): Promise<unknown> =>
      (original.apply(this as never, args as never) as Promise<unknown>).then((r) => {
        registrar();
        return r;
      });
    return rttMs > 0
      ? new Promise((r) => setTimeout(r, rttMs)).then(disparar)
      : disparar();
  };
}

// ---------------------------------------------------------------------------
// Observadores: pool, espera e lock
// ---------------------------------------------------------------------------
interface Picos {
  conexoes: number;
  naFila: number;
  ativosNoBanco: number;
  esperas: Map<string, number>;
  locksNaoConcedidos: number;
}

/**
 * O que o pool e o banco estavam fazendo enquanto a leitura corria.
 *
 * O pool é lido do próprio objeto (`totalCount`, `waitingCount`): é ele que
 * diz se uma importação deixou a API esperando por conexão. O banco é lido de
 * fora, por uma conexão só dele — usar o pool medido para medir o pool seria
 * mudar o que se mede.
 */
function observar(ctx: TestDb, intervaloMs = 25): { parar: () => Promise<Picos> } {
  const picos: Picos = {
    conexoes: 0,
    naFila: 0,
    ativosNoBanco: 0,
    esperas: new Map(),
    locksNaoConcedidos: 0,
  };
  let vivo = true;
  const espiao = new pg.Client({ connectionString: ctx.url });
  const pronto = espiao.connect();

  const laco = (async () => {
    await pronto;
    while (vivo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pool = ctx.pool as any;
      picos.conexoes = Math.max(picos.conexoes, pool.totalCount ?? 0);
      picos.naFila = Math.max(picos.naFila, pool.waitingCount ?? 0);
      try {
        const { rows } = await espiao.query(
          `select count(*) filter (where state = 'active') as ativos,
                  count(*) filter (where wait_event is not null and state = 'active') as esperando,
                  coalesce(string_agg(distinct wait_event_type || ':' || wait_event, ','), '') as eventos,
                  (select count(*) from pg_locks where not granted) as travados
             from pg_stat_activity
            where datname = current_database() and pid <> pg_backend_pid()`,
        );
        const linha = rows[0];
        picos.ativosNoBanco = Math.max(picos.ativosNoBanco, Number(linha.ativos));
        picos.locksNaoConcedidos = Math.max(
          picos.locksNaoConcedidos,
          Number(linha.travados),
        );
        for (const evento of String(linha.eventos).split(",").filter(Boolean)) {
          picos.esperas.set(evento, (picos.esperas.get(evento) ?? 0) + 1);
        }
      } catch {
        // O espião nunca derruba a medição: se o banco recusou a pergunta,
        // esta amostra simplesmente não existe.
      }
      await new Promise((r) => setTimeout(r, intervaloMs));
    }
  })();

  return {
    async parar() {
      vivo = false;
      await laco;
      await espiao.end().catch(() => {});
      return picos;
    },
  };
}

// ---------------------------------------------------------------------------
// Uma importação medida
// ---------------------------------------------------------------------------
interface MedidaDeEtapa {
  etapa: string;
  parede: number;
  postgres: number;
  idas: number;
}

interface MedidaDeImportacao {
  etapas: MedidaDeEtapa[];
  total: number;
  cpuNode: number;
}

async function temStatStatements(ctx: TestDb): Promise<boolean> {
  const { rows } = await ctx.db.execute(
    sql`select count(*)::int as n from pg_extension where extname = 'pg_stat_statements'`,
  );
  return Number((rows[0] as { n: number }).n) > 0;
}

async function tempoNoPostgres(ctx: TestDb, ativo: boolean): Promise<number> {
  if (!ativo) return 0;
  const { rows } = await ctx.db.execute(
    sql`select coalesce(sum(total_exec_time), 0)::float8 as ms
          from pg_stat_statements
         where query not like '%pg_stat_statements%'`,
  );
  return Number((rows[0] as { ms: number }).ms);
}

/**
 * Uma planilha sintética com o formato do export real: uma aba, dez colunas.
 *
 * Seis de escopo, duas de identidade e duas de fato — a mesma proporção do
 * arquivo do cliente, que é o que faz o número de células e o de fatos
 * baterem com a produção.
 */
function planilhaDe(linhas: number, semente: number): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const placa = (i: number): string =>
    `${letras[i % 26]}${letras[Math.floor(i / 26) % 26]}${letras[Math.floor(i / 676) % 26]}${i % 10}${letras[Math.floor(i / 7) % 26]}${String(i % 100).padStart(2, "0")}`;

  const spec: LinhaSpec[] = Array.from({ length: linhas }, (_, i) => ({
    placa: placa(i),
    valores: { "Custo Fixo": 1000 + i, "Custo Variavel": 2000 + i },
  }));
  // Cada importação simultânea precisa da sua vigência: duas leituras da mesma
  // vigência disputariam a mesma identidade, e o que se quer medir é disputa
  // de recurso, não recusa de negócio.
  const dia = 1 + (semente % 28);
  return escreverPlanilha({
    vigencia: `EMPURRADA_${dia}_8_2030`,
    abas: [{ nome: "cavalos", linhas: spec }],
  });
}

async function importarMedindo(
  ctx: TestDb,
  caminho: string,
  comStats: boolean,
  rotulo: string,
): Promise<MedidaDeImportacao> {
  const etapas: MedidaDeEtapa[] = [];
  const cpu0 = process.cpuUsage();
  const inicio = performance.now();

  const medir = async <T>(nome: string, fn: () => Promise<T>): Promise<T> => {
    if (comStats) await ctx.db.execute(sql`select pg_stat_statements_reset()`);
    const antes = idas.length;
    etapaAtual = `${rotulo}${nome}`;
    const t0 = performance.now();
    const saida = await fn();
    const parede = performance.now() - t0;
    etapaAtual = "medindo";
    etapas.push({
      etapa: nome,
      parede,
      postgres: await tempoNoPostgres(ctx, comStats),
      idas: idas.slice(antes).filter((i) => i.etapa === `${rotulo}${nome}`).length,
    });
    return saida;
  };

  const recebido = await medir("receiveFile", () =>
    receiveFile(ctx.db, { filePath: caminho }),
  );
  await medir("captureRaw", () => captureRaw(ctx.db, recebido.importRunId));
  await medir("stage", () => stage(ctx.db, recebido.importRunId));
  await medir("preview", () => preview(ctx.db, recebido.importRunId));

  const cpu = process.cpuUsage(cpu0);
  return {
    etapas,
    total: performance.now() - inicio,
    cpuNode: (cpu.user + cpu.system) / 1000,
  };
}

// ---------------------------------------------------------------------------
// Percentis
// ---------------------------------------------------------------------------
function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const i = Math.min(
    ordenados.length - 1,
    Math.ceil((p / 100) * ordenados.length) - 1,
  );
  return ordenados[Math.max(0, i)];
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
const opcoes = lerOpcoes(process.argv.slice(2));

/*
  O cenário precisa estar no ambiente **antes** de o pipeline ser carregado.

  As afinações são constantes de módulo: elas leem `process.env` uma vez, na
  carga, que em ESM acontece antes da primeira linha deste bloco. Escrever a
  variável aqui não mudaria nada — e a primeira matriz que rodei mediu, sem
  dizer, três vezes o mesmo cenário. Então o processo se re-executa uma vez com
  o ambiente montado, e é o filho que mede.
*/
if (!process.env.PERFIL_CENARIO_APLICADO) {
  const filho = spawnSync(
    process.execPath,
    [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ...CENARIOS[opcoes.cenario],
        PERFIL_CENARIO_APLICADO: "1",
      },
    },
  );
  process.exit(filho.status ?? 1);
}

instrumentarDriver();

const rodadas: {
  total: number;
  cpuNode: number;
  postgres: number;
  idas: number;
  picos: Picos;
  etapas: MedidaDeEtapa[];
}[] = [];

for (let volta = 0; volta < opcoes.repeticoes; volta++) {
  const ctx = await createTestDatabase(
    `perfil_${opcoes.cenario}_${opcoes.simultaneas}x_${volta}`,
  );
  const comStats = await (async () => {
    try {
      await ctx.db.execute(sql`create extension if not exists pg_stat_statements`);
      return await temStatStatements(ctx);
    } catch {
      return false;
    }
  })();

  const caminhos = Array.from({ length: opcoes.simultaneas }, (_, i) =>
    planilhaDe(opcoes.linhas, volta * opcoes.simultaneas + i),
  );

  idas.length = 0;
  rttMs = opcoes.rtt;
  /*
    Com duas leituras ao mesmo tempo, o tempo de Postgres é medido da rodada
    inteira, e não por etapa: os contadores do servidor são do banco, não do
    processo, e as duas importações se sobrepõem neles. Por etapa só faz
    sentido quando há uma leitura só.
  */
  if (comStats && opcoes.simultaneas > 1) {
    await ctx.db.execute(sql`select pg_stat_statements_reset()`);
  }
  const olho = observar(ctx);
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();

  const medidas = await Promise.all(
    caminhos.map((caminho, i) =>
      importarMedindo(
        ctx,
        caminho,
        // Com duas simultâneas os contadores do servidor se misturam: só a
        // primeira zera e lê, e o número dela é o do banco inteiro naquele
        // trecho. Dizer isso é melhor que somar dois números que se somam
        // sozinhos.
        comStats && i === 0 && opcoes.simultaneas === 1,
        `${i}:`,
      ),
    ),
  );

  const total = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  rttMs = 0;
  const picos = await olho.parar();

  rodadas.push({
    total,
    cpuNode: (cpu.user + cpu.system) / 1000,
    postgres:
      opcoes.simultaneas > 1
        ? await tempoNoPostgres(ctx, comStats)
        : medidas[0].etapas.reduce((s, e) => s + e.postgres, 0),
    idas: idas.filter((i) => i.etapa !== "medindo" && i.etapa !== "preparo").length,
    picos,
    etapas: medidas[0].etapas,
  });

  await ctx.drop();
}

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------
const nomesDasEtapas = rodadas[0].etapas.map((e) => e.etapa);
const porEtapa = nomesDasEtapas.map((nome) => {
  const paredes = rodadas.map(
    (r) => r.etapas.find((e) => e.etapa === nome)?.parede ?? 0,
  );
  const primeira = rodadas[0].etapas.find((e) => e.etapa === nome)!;
  return {
    etapa: nome,
    p50: percentil(paredes, 50),
    p95: percentil(paredes, 95),
    postgres: primeira.postgres,
    idas: primeira.idas,
  };
});

const resumo = {
  cenario: opcoes.cenario,
  afinacoes: CENARIOS[opcoes.cenario],
  linhas: opcoes.linhas,
  rttMs: opcoes.rtt,
  simultaneas: opcoes.simultaneas,
  repeticoes: opcoes.repeticoes,
  totalP50: percentil(
    rodadas.map((r) => r.total),
    50,
  ),
  totalP95: percentil(
    rodadas.map((r) => r.total),
    95,
  ),
  cpuNodeP50: percentil(
    rodadas.map((r) => r.cpuNode),
    50,
  ),
  postgresP50: percentil(
    rodadas.map((r) => r.postgres),
    50,
  ),
  idasP50: percentil(
    rodadas.map((r) => r.idas),
    50,
  ),
  picoDeConexoes: Math.max(...rodadas.map((r) => r.picos.conexoes)),
  picoNaFilaDoPool: Math.max(...rodadas.map((r) => r.picos.naFila)),
  picoAtivosNoBanco: Math.max(...rodadas.map((r) => r.picos.ativosNoBanco)),
  picoDeLocksNaoConcedidos: Math.max(
    ...rodadas.map((r) => r.picos.locksNaoConcedidos),
  ),
  esperasNoBanco: Object.fromEntries(
    rodadas
      .flatMap((r) => [...r.picos.esperas])
      .reduce(
        (mapa, [evento, vezes]) => mapa.set(evento, (mapa.get(evento) ?? 0) + vezes),
        new Map<string, number>(),
      )
      .entries(),
  ) as Record<string, number>,
  etapas: porEtapa,
};

if (opcoes.json) {
  console.log(JSON.stringify(resumo, null, 2));
} else {
  const s = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;
  console.log(
    `\n=== ${opcoes.cenario} · ${opcoes.linhas} linhas · RTT ${opcoes.rtt}ms · ${opcoes.simultaneas} simultânea(s) · ${opcoes.repeticoes} repetição(ões) ===`,
  );
  console.log(
    `    ${Object.entries(CENARIOS[opcoes.cenario])
      .map(([k, v]) => `${k.replace("IMPORT_", "").toLowerCase()}=${v}`)
      .join("  ")}\n`,
  );
  console.log(
    "etapa".padEnd(14) +
      "p50".padStart(9) +
      "p95".padStart(9) +
      "Postgres".padStart(10) +
      "idas".padStart(7),
  );
  for (const e of porEtapa) {
    console.log(
      e.etapa.padEnd(14) +
        s(e.p50).padStart(9) +
        s(e.p95).padStart(9) +
        s(e.postgres).padStart(10) +
        String(e.idas).padStart(7),
    );
  }
  console.log(
    "TOTAL".padEnd(14) +
      s(resumo.totalP50).padStart(9) +
      s(resumo.totalP95).padStart(9) +
      s(resumo.postgresP50).padStart(10) +
      String(resumo.idasP50).padStart(7),
  );
  console.log(
    `\nCPU Node ${s(resumo.cpuNodeP50)} · pico de conexões ${resumo.picoDeConexoes}` +
      ` · pico na fila do pool ${resumo.picoNaFilaDoPool}` +
      ` · pico de backends ativos ${resumo.picoAtivosNoBanco}` +
      ` · locks não concedidos ${resumo.picoDeLocksNaoConcedidos}`,
  );
  const esperas = Object.entries(resumo.esperasNoBanco)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  console.log(
    `esperas no banco (amostras): ${esperas.length ? esperas.map(([k, v]) => `${k}×${v}`).join("  ") : "nenhuma"}`,
  );
}
