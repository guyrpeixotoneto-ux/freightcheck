/**
 * O que sobra no banco quando o processo morre no meio da leitura.
 *
 * ---------------------------------------------------------------------------
 * A pergunta que este arquivo responde
 * ---------------------------------------------------------------------------
 * `captureRaw` e `stage` escrevem **fora de transação** — só a promoção abre
 * uma. Dito assim, soa como um buraco; a pergunta certa não é "é atômico?",
 * é "que estado parcial existe, quem o reconhece, e quem o limpa?". Este
 * arquivo responde matando o processo de verdade (SIGKILL, sem catch, sem
 * `finally`, sem rollback do cliente) em três pontos, e olhando o que ficou:
 *
 *   1. no meio da gravação das células;
 *   2. no meio da gravação dos fatos preparados;
 *   3. entre uma etapa e a outra.
 *
 * E, em cada um, mostra as duas defesas funcionando: a varredura de leituras
 * órfãs (`varrerLeiturasOrfas`), que dá desfecho a quem ficou preso, e a
 * exclusão (`deleteImportRun`), que apaga o parcial e libera o arquivo.
 *
 * ---------------------------------------------------------------------------
 * E a segunda pergunta: paralelizar cria estado que hoje não existe?
 * ---------------------------------------------------------------------------
 * Cada INSERT em massa é, hoje, a sua própria transação implícita: o driver
 * manda um statement, o Postgres o comita sozinho. Escrever em série significa
 * "um comitado por vez"; escrever em quatro conexões significa "até quatro
 * comitando ao mesmo tempo". Nos dois casos o que o processo morto deixa é
 * **um subconjunto das células, sem contador escrito e com o run em READING**
 * — a diferença é qual subconjunto, e disso nada depende: nenhum leitor deste
 * esquema conta com ordem de células, e `raw_cell_count` só é escrito depois
 * de toda escrita ter voltado do banco.
 *
 * A prova roda os três cenários duas vezes — em série e com quatro conexões —
 * e compara o estado resultante campo a campo. É isso que a última seção do
 * relatório mostra.
 *
 * ---------------------------------------------------------------------------
 * Uso
 * ---------------------------------------------------------------------------
 *     pnpm --filter @workspace/ingest exec tsx src/cli/prova-de-atomicidade.ts \
 *       [--linhas 14000]
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { eq, sql } from "drizzle-orm";
import { createDb } from "@workspace/db";
import {
  importRunTable,
  rawCellTable,
  rawRowTable,
  rawSheetTable,
  stagedFactTable,
} from "@workspace/db";
import { captureRaw, receiveFile, stage } from "../pipeline";
import { deleteImportRun } from "../deletion";
import { varrerLeiturasOrfas } from "../recuperacao";
import { createTestDatabase } from "../testing";
import { escreverPlanilha, type LinhaSpec } from "../__tests__/planilha-sintetica";

type Ponto = "celulas" | "fatos" | "entre-etapas";

// ---------------------------------------------------------------------------
// O filho: uma importação de verdade, que não espera sobreviver
// ---------------------------------------------------------------------------
if (process.env.PROVA_PAPEL === "filho") {
  const { db } = createDb(process.env.PROVA_URL!);
  const recebido = await receiveFile(db, { filePath: process.env.PROVA_ARQUIVO! });
  console.log(`RUN ${recebido.importRunId}`);
  await captureRaw(db, recebido.importRunId);
  console.log("CAPTURA-PRONTA");
  if (process.env.PROVA_PONTO === "entre-etapas") {
    // A janela em que o pai mata: a captura terminou, o preparo não começou.
    await new Promise((r) => setTimeout(r, 3_000));
  }
  await stage(db, recebido.importRunId);
  console.log("PREPARO-PRONTO");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// O pai: mata pelo que vê no banco, e não pelo relógio
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const linhas = Number(
  argv[argv.indexOf("--linhas") + 1] ?? (argv.includes("--linhas") ? 0 : 14_000),
);

function planilha(semente: number): string {
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const placa = (i: number): string =>
    `${letras[i % 26]}${letras[Math.floor(i / 26) % 26]}${letras[Math.floor(i / 676) % 26]}${i % 10}${letras[Math.floor(i / 7) % 26]}${String(i % 100).padStart(2, "0")}`;
  const spec: LinhaSpec[] = Array.from({ length: linhas }, (_, i) => ({
    placa: placa(i),
    valores: { "Custo Fixo": 1000 + i, "Custo Variavel": 2000 + i },
  }));
  return escreverPlanilha({
    vigencia: `EMPURRADA_${1 + (semente % 28)}_8_2030`,
    abas: [{ nome: "cavalos", linhas: spec }],
  });
}

interface EstadoParcial {
  status: string;
  rawSheetCount: number;
  rawRowCount: number;
  rawCellCount: number;
  stagedFactCount: number;
  progressStep: string | null;
  celulasNoBanco: number;
  fatosNoBanco: number;
  linhasNoBanco: number;
  abasNoBanco: number;
}

const esteArquivo = fileURLToPath(import.meta.url);

/**
 * Roda uma importação num processo separado e a mata no ponto pedido.
 *
 * O gatilho não é o relógio: é o próprio banco. O pai fica perguntando quantas
 * células (ou fatos) já existem e manda o SIGKILL na primeira resposta maior
 * que zero e menor que o fim — o que garante que a morte aconteceu **no meio**
 * da gravação, e não antes nem depois dela.
 */
async function matarNoMeio(
  url: string,
  arquivo: string,
  ponto: Ponto,
  conexoes: number,
): Promise<{ importRunId: string; morreuEm: string; chegaramDepoisDaMorte: number }> {
  const { db, pool } = createDb(url);
  const filho = spawn(
    process.execPath,
    [...process.execArgv, esteArquivo],
    {
      env: {
        ...process.env,
        PROVA_PAPEL: "filho",
        PROVA_URL: url,
        PROVA_ARQUIVO: arquivo,
        PROVA_PONTO: ponto,
        IMPORT_CONEXOES_DE_ESCRITA: String(conexoes),
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );

  let importRunId = "";
  let capturaPronta = false;
  filho.stdout.setEncoding("utf8");
  filho.stdout.on("data", (bloco: string) => {
    for (const linha of bloco.split("\n")) {
      if (linha.startsWith("RUN ")) importRunId = linha.slice(4).trim();
      if (linha.startsWith("CAPTURA-PRONTA")) capturaPronta = true;
    }
  });

  const contar = async (
    tabela: "raw_cell" | "staged_fact",
  ): Promise<number> => {
    const { rows } = await db.execute(
      sql`select count(*)::int as n from ${sql.raw(tabela)}`,
    );
    return Number((rows[0] as { n: number }).n);
  };

  let morreuEm = "";
  const limite = Date.now() + 120_000;
  while (Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 20));
    if (filho.exitCode !== null) break;

    if (ponto === "celulas") {
      const n = await contar("raw_cell");
      if (n > 0 && !capturaPronta) {
        morreuEm = `${n} células gravadas`;
        break;
      }
    } else if (ponto === "fatos") {
      const n = await contar("staged_fact");
      if (n > 0) {
        morreuEm = `${n} fatos gravados`;
        break;
      }
    } else if (capturaPronta) {
      morreuEm = "captura terminada, preparo não começado";
      break;
    }
  }

  const antesDoTiro = await contar(ponto === "fatos" ? "staged_fact" : "raw_cell");
  filho.kill("SIGKILL");
  await new Promise((r) => filho.on("exit", r));

  /*
    Matar o processo não mata o statement.

    O Postgres não sabe que o cliente morreu enquanto está executando: ele
    termina o INSERT, **comita** — cada INSERT em massa é a sua própria
    transação implícita — e só descobre o cano quebrado ao tentar responder.
    Então há uma janela, do tamanho de um statement, em que dado ainda entra
    depois da morte de quem o mandou. Isso vale para uma conexão e para
    quatro; a diferença é quantos statements estavam em voo.

    A prova espera essa janela fechar antes de olhar o estado — senão ela
    mediria uma corrida, e não o que ficou. Foi assim que este arquivo
    descobriu a janela: a primeira versão excluía a importação um segundo
    depois do tiro e batia na chave estrangeira, porque células nasciam entre
    o `DELETE FROM raw_cell` e o `DELETE FROM raw_row`.
  */
  const limiteDeAssentar = Date.now() + 30_000;
  while (Date.now() < limiteDeAssentar) {
    const { rows } = await db.execute(
      sql`select count(*)::int as n from pg_stat_activity
           where datname = current_database()
             and pid <> pg_backend_pid()
             and state = 'active'`,
    );
    if (Number((rows[0] as { n: number }).n) === 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const depoisDeAssentar = await contar(
    ponto === "fatos" ? "staged_fact" : "raw_cell",
  );

  await pool.end();
  return {
    importRunId,
    morreuEm,
    chegaramDepoisDaMorte: depoisDeAssentar - antesDoTiro,
  };
}

async function lerEstado(
  url: string,
  importRunId: string,
): Promise<EstadoParcial> {
  const { db, pool } = createDb(url);
  const [run] = await db
    .select()
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));
  const um = async (t: "raw_cell" | "staged_fact" | "raw_row" | "raw_sheet") => {
    const { rows } = await db.execute(
      sql`select count(*)::int as n from ${sql.raw(t)}`,
    );
    return Number((rows[0] as { n: number }).n);
  };
  const estado: EstadoParcial = {
    status: run.status,
    rawSheetCount: run.rawSheetCount,
    rawRowCount: run.rawRowCount,
    rawCellCount: run.rawCellCount,
    stagedFactCount: run.stagedFactCount,
    progressStep: run.progressStep,
    celulasNoBanco: await um("raw_cell"),
    fatosNoBanco: await um("staged_fact"),
    linhasNoBanco: await um("raw_row"),
    abasNoBanco: await um("raw_sheet"),
  };
  await pool.end();
  return estado;
}

interface Desfecho {
  ponto: Ponto;
  conexoes: number;
  morreuEm: string;
  chegaramDepoisDaMorte: number;
  antes: EstadoParcial;
  varredura: string;
  depoisDaVarredura: string;
  depoisDaExclusao: { celulas: number; linhas: number; abas: number; fatos: number };
}

async function provar(ponto: Ponto, conexoes: number, semente: number): Promise<Desfecho> {
  const ctx = await createTestDatabase(
    `atomicidade_${ponto.replace("-", "_")}_${conexoes}`,
  );
  const arquivo = planilha(semente);
  const { importRunId, morreuEm, chegaramDepoisDaMorte } = await matarNoMeio(
    ctx.url,
    arquivo,
    ponto,
    conexoes,
  );
  const antes = await lerEstado(ctx.url, importRunId);

  // A varredura com limite zero é a mesma que roda na partida, adiantada: sem
  // isto seria preciso esperar quinze minutos para ver o que ela faz.
  const relatorio = await varrerLeiturasOrfas(ctx.db, 0);
  const [depois] = await ctx.db
    .select({
      status: importRunTable.status,
      motivo: importRunTable.failureReason,
      progresso: importRunTable.progressStep,
    })
    .from(importRunTable)
    .where(eq(importRunTable.id, importRunId));

  await deleteImportRun(ctx.db, importRunId, { deletedBy: "prova-de-atomicidade", reason: "estado parcial de um processo morto" });

  const contar = async (t: typeof rawCellTable | typeof stagedFactTable | typeof rawRowTable | typeof rawSheetTable) =>
    Number(
      (
        (await ctx.db.select({ n: sql<number>`count(*)::int` }).from(t as never))[0] as {
          n: number;
        }
      ).n,
    );

  const desfecho: Desfecho = {
    ponto,
    conexoes,
    morreuEm,
    chegaramDepoisDaMorte,
    antes,
    varredura: `${relatorio.importacoes.length} leitura(s) marcada(s)`,
    depoisDaVarredura: `${depois.status}${depois.progresso ? ` (progresso ${depois.progresso})` : " (progresso limpo)"} · ${(depois.motivo ?? "").slice(0, 60)}…`,
    depoisDaExclusao: {
      celulas: await contar(rawCellTable),
      linhas: await contar(rawRowTable),
      abas: await contar(rawSheetTable),
      fatos: await contar(stagedFactTable),
    },
  };

  await ctx.drop();
  return desfecho;
}

const pontos: Ponto[] = ["celulas", "fatos", "entre-etapas"];
const desfechos: Desfecho[] = [];
let semente = 0;
for (const conexoes of [1, 4]) {
  for (const ponto of pontos) {
    desfechos.push(await provar(ponto, conexoes, semente++));
  }
}

console.log(`\n=== o que o SIGKILL deixou, com ${linhas} linhas ===\n`);
for (const d of desfechos) {
  console.log(
    `── ${d.ponto} · ${d.conexoes} conexão(ões) de escrita — morto com ${d.morreuEm}`,
  );
  console.log(
    `   entraram depois do SIGKILL (statements em voo): ${d.chegaramDepoisDaMorte}`,
  );
  console.log(
    `   run: ${d.antes.status}  ·  contadores gravados: abas=${d.antes.rawSheetCount} linhas=${d.antes.rawRowCount} células=${d.antes.rawCellCount} fatos=${d.antes.stagedFactCount}`,
  );
  console.log(
    `   no banco de fato: abas=${d.antes.abasNoBanco} linhas=${d.antes.linhasNoBanco} células=${d.antes.celulasNoBanco} fatos=${d.antes.fatosNoBanco}`,
  );
  console.log(`   varredura: ${d.varredura} → ${d.depoisDaVarredura}`);
  console.log(
    `   depois de excluir: células=${d.depoisDaExclusao.celulas} linhas=${d.depoisDaExclusao.linhas} abas=${d.depoisDaExclusao.abas} fatos=${d.depoisDaExclusao.fatos}\n`,
  );
}

console.log("=== em série × em paralelo: o mesmo estado? ===\n");
for (const ponto of pontos) {
  const serie = desfechos.find((d) => d.ponto === ponto && d.conexoes === 1)!;
  const paralelo = desfechos.find((d) => d.ponto === ponto && d.conexoes === 4)!;
  const iguais = (a: EstadoParcial, b: EstadoParcial): string[] => {
    const diferencas: string[] = [];
    for (const campo of [
      "status",
      "rawSheetCount",
      "rawRowCount",
      "rawCellCount",
      "stagedFactCount",
    ] as const) {
      if (a[campo] !== b[campo]) {
        diferencas.push(`${campo}: ${a[campo]} × ${b[campo]}`);
      }
    }
    return diferencas;
  };
  const diferencas = iguais(serie.antes, paralelo.antes);
  console.log(
    `${ponto.padEnd(14)} ${diferencas.length === 0 ? "mesmo estado (só muda quantas células/fatos parciais ficaram)" : `DIFERENÇA: ${diferencas.join(", ")}`}`,
  );
}
