import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  fechamentoCompetenciaTable,
  fechamentoCteTable,
  fechamentoDocumentoTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  CTE_ATE_RECEBIMENTO,
  importarFluxo,
  lerFluxo,
} from "@workspace/fluxos";
import {
  monitorarFluxo,
  registroDeColetores,
  type Coletor,
} from "@workspace/fluxos";
import { CHAVE, coletorDeAutorizacaoSefaz } from "./cte-autorizacao-sefaz";

/**
 * A PROVA DO PRIMEIRO COLETOR — o farol de uma etapa de verdade, impresso.
 *
 * A bateria de `__tests__` afirma; esta prova **mostra**. Ela monta um banco
 * descartável a partir das migrations reais, cadastra o fluxo CTe→Recebimento
 * pelo caminho normal (`importarFluxo`), grava um extrato 03.08.15 com a forma
 * que o Promax tem, e imprime a `Leitura` e o `EstadoDaEtapa` nos quatro
 * estados — para que a régua de cores possa ser conferida por quem entende do
 * processo, e não só por quem lê teste.
 *
 * Roda com um Postgres à mão, como a `prova-ponta-a-ponta` do fechamento:
 *
 *     DATABASE_URL=postgresql://… pnpm --filter @workspace/coletores exec tsx src/prova-cli.ts
 */

const ADMIN =
  process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5433/postgres";
const NOME = `fc_prova_coletor_${process.pid}`;
const CHAVE_DE_ACESSO = "3".repeat(44);

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function main(): Promise<void> {
  const admin = new pg.Pool({ connectionString: ADMIN });
  await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
  await admin.query(`CREATE DATABASE "${NOME}"`);
  await admin.end();
  const url = apontarPara(ADMIN, NOME);
  await runMigrations(url);
  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool) as unknown as Database;

  try {
    const [unidade] = await db
      .insert(unidadeTable)
      .values({ nome: "Horizonte Logística", cnpj: "11111111000191" })
      .returning();
    const fluxo = await importarFluxo(db, unidade.id, CTE_ATE_RECEBIMENTO, {
      email: "prova@exemplo.com",
    });

    const completo = await lerFluxo(db, unidade.id, fluxo.id);
    if (!completo) throw new Error("o fluxo cadastrado sumiu");
    const etapa = completo.etapas.find((e) => e.chaveMonitoramento === CHAVE);
    if (!etapa) throw new Error("o fluxo não tem a etapa da SEFAZ");

    console.log("═".repeat(78));
    console.log("1. A ETAPA");
    console.log("═".repeat(78));
    console.log(
      `fluxo   ${completo.fluxo.nome} (${completo.etapas.length} etapas)`,
    );
    console.log(
      `etapa   ${etapa.ordem}. ${etapa.nome} — ${etapa.tipo}, ${etapa.area}`,
    );
    console.log(`chave   ${etapa.chaveMonitoramento}`);
    console.log(`id      ${etapa.id}`);

    await gravarExtrato(
      db,
      unidade.id,
      "2026-08-Q1",
      "2026-08-01",
      new Date("2026-08-16T09:00:00Z"),
      [CHAVE_DE_ACESSO, CHAVE_DE_ACESSO, CHAVE_DE_ACESSO],
    );

    const registro = registroDeColetores(coletorDeAutorizacaoSefaz(db));

    await mostrar(
      "2. LEITURA VÁLIDA — extrato íntegro, um dia depois do envio",
      async () =>
        monitorarFluxo(registro, unidade.id, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
    );

    await gravarExtrato(
      db,
      unidade.id,
      "2026-08-Q2",
      "2026-08-16",
      new Date("2026-08-31T09:00:00Z"),
      [CHAVE_DE_ACESSO, null, "123", CHAVE_DE_ACESSO],
    );

    await mostrar(
      "3. AMARELO — dois documentos sem chave de acesso",
      async () =>
        monitorarFluxo(registro, unidade.id, completo, {
          agora: new Date("2026-09-01T09:00:00Z"),
        }),
    );

    await mostrar(
      "4. VENCIDA — dezoito dias depois, sem extrato novo",
      async () =>
        monitorarFluxo(registro, unidade.id, completo, {
          agora: new Date("2026-09-18T09:00:00Z"),
        }),
    );

    const [outra] = await db
      .insert(unidadeTable)
      .values({ nome: "Transportes Sem Extrato", cnpj: "22222222000172" })
      .returning();
    const fluxoDaOutra = await importarFluxo(
      db,
      outra.id,
      CTE_ATE_RECEBIMENTO,
      {
        email: "prova@exemplo.com",
      },
    );
    const completoDaOutra = (await lerFluxo(db, outra.id, fluxoDaOutra.id))!;

    await mostrar(
      "5. ISOLAMENTO — outra empresa, o mesmo registro, nenhum extrato dela",
      async () =>
        monitorarFluxo(registro, outra.id, completoDaOutra, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
    );

    const quebrado: Coletor = {
      nome: "extrato-fiscal-03.08.15",
      prefixos: [CHAVE],
      ler: async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      },
    };
    await mostrar(
      "6. FALHA — o coletor quebrado apaga o farol e se identifica",
      async () =>
        monitorarFluxo(registroDeColetores(quebrado), unidade.id, completo, {
          agora: new Date("2026-08-17T09:00:00Z"),
        }),
    );

    await mostrar(
      "7. TEMPO ESGOTADO — a consulta lenta não trava a tela",
      async () => {
        const real = coletorDeAutorizacaoSefaz(db);
        const lento: Coletor = {
          ...real,
          ler: async (pedido) => {
            await new Promise((r) => setTimeout(r, 200));
            return real.ler(pedido);
          },
        };
        return monitorarFluxo(
          registroDeColetores(lento),
          unidade.id,
          completo,
          {
            agora: new Date("2026-08-17T09:00:00Z"),
            tempoLimiteEmMs: 20,
          },
        );
      },
    );

    async function mostrar(
      titulo: string,
      apurar: () => Promise<Awaited<ReturnType<typeof monitorarFluxo>>>,
    ): Promise<void> {
      const resultado = await apurar();
      const alvo =
        resultado.etapas.find((e) => e.chave === CHAVE) ??
        resultado.etapas.find((e) => e.etapaId === etapa!.id)!;
      console.log("");
      console.log("═".repeat(78));
      console.log(titulo);
      console.log("═".repeat(78));
      console.log(
        "Leitura      ",
        JSON.stringify(alvo.leitura, null, 2)?.replace(
          /\n/g,
          "\n              ",
        ),
      );
      console.log(
        "EstadoDaEtapa",
        JSON.stringify(
          {
            etapaNome: alvo.etapaNome,
            chave: alvo.chave,
            farol: alvo.farol,
            motivo: alvo.motivo,
            vencida: alvo.vencida,
            idadeEmSegundos: alvo.idadeEmSegundos,
          },
          null,
          2,
        ).replace(/\n/g, "\n              "),
      );
      console.log("Resumo       ", JSON.stringify(resultado.resumo));
      if (resultado.falhas.length)
        console.log("Falhas       ", JSON.stringify(resultado.falhas));
    }
  } finally {
    await pool.end().catch(() => {});
    const limpeza = new pg.Pool({ connectionString: ADMIN });
    await limpeza.query(`DROP DATABASE IF EXISTS "${NOME}"`);
    await limpeza.end();
  }
}

async function gravarExtrato(
  db: Database,
  empresaId: string,
  chave: string,
  inicio: string,
  enviadoEm: Date,
  controles: (string | null)[],
): Promise<void> {
  const [competencia] = await db
    .insert(fechamentoCompetenciaTable)
    .values({
      chave,
      ano: Number(chave.slice(0, 4)),
      mes: Number(chave.slice(5, 7)),
      quinzena: chave.endsWith("Q1") ? 1 : 2,
      inicio,
      fim: inicio,
      unidadeCodigo: empresaId.slice(0, 8),
      unidadeId: empresaId,
      transportadoraCodigo: "36",
    })
    .returning();
  const [documento] = await db
    .insert(fechamentoDocumentoTable)
    .values({
      competenciaId: competencia.id,
      tipo: "CTE",
      nomeDoArquivo: `03.08.15 ${chave}.xlsx`,
      sha256: `${chave}-${empresaId}`,
      tamanhoEmBytes: 4096,
      enviadoEm,
    })
    .returning();
  await db.insert(fechamentoCteTable).values(
    controles.map((controle, i) => ({
      documentoId: documento.id,
      competenciaId: competencia.id,
      linhaNoArquivo: i + 1,
      vbz: 5,
      verbaNome: "FRETE VARIAVEL",
      verbaNatureza: "VARIAVEL",
      canal: "ROTA",
      numero: String(90_000 + i),
      valorCte: "1234.56",
      controle,
    })),
  );
}

await main();
