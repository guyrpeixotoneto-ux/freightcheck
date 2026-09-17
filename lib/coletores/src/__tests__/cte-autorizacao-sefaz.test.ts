import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
  type FluxoCompleto,
} from "@workspace/fluxos";
import { CHAVE, coletorDeAutorizacaoSefaz } from "../cte-autorizacao-sefaz";

/**
 * O PRIMEIRO COLETOR REAL, SOBRE O BANCO REAL.
 *
 * A bateria roda sobre as migrations de verdade, o fluxo CTe→Recebimento
 * semeado pelo caminho normal (`importarFluxo`) e linhas de `fechamento_cte`
 * com a forma que o 03.08.15 tem. O que ela prova não é a cor: é que o contrato
 * do motor aguenta um coletor de verdade sem precisar de emenda.
 *
 * As sete afirmações: a leitura válida pinta; a vencida apaga sem se perder; a
 * ausência apaga com motivo; a falha e o tempo esgotado apagam com o nome do
 * culpado; o coletor não alcança chave que não declarou; e **a empresa B não
 * pinta a etapa da empresa A**.
 *
 * Precisa de um Postgres, como as outras onze — na máquina de quem desenvolve,
 * pula; no CI, não.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_coletores_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function bancoAlcancavel(): Promise<boolean> {
  const pool = new pg.Pool({
    connectionString: ADMIN,
    connectionTimeoutMillis: 1500,
  });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const noCi = process.env.CI === "true" || process.env.CI === "1";
const temBanco = noCi || (await bancoAlcancavel());

const AUTOR = { email: "guy@exemplo.com" };
const CHAVE_DE_ACESSO = "3".repeat(44);

describe.skipIf(!temBanco)(
  "cte.autorizacao_sefaz sobre o extrato fiscal",
  () => {
    let pool: pg.Pool;
    let db: Database;
    let empresaA: string;
    let empresaB: string;
    let fluxoA: string;
    let fluxoB: string;

    beforeAll(async () => {
      const admin = new pg.Pool({ connectionString: ADMIN });
      await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
      await admin.query(`CREATE DATABASE "${NOME}"`);
      await admin.end();
      const url = apontarPara(ADMIN, NOME);
      await runMigrations(url);
      pool = new pg.Pool({ connectionString: url });
      db = drizzle(pool) as unknown as Database;

      const [a] = await db
        .insert(unidadeTable)
        .values({ nome: "Transportes A", cnpj: "11111111000191" })
        .returning();
      const [b] = await db
        .insert(unidadeTable)
        .values({ nome: "Transportes B", cnpj: "22222222000172" })
        .returning();
      empresaA = a.id;
      empresaB = b.id;

      /* O mesmo caminho do cadastro à mão e da semeadura: `importarFluxo`. */
      fluxoA = (await importarFluxo(db, empresaA, CTE_ATE_RECEBIMENTO, AUTOR))
        .id;
      fluxoB = (await importarFluxo(db, empresaB, CTE_ATE_RECEBIMENTO, AUTOR))
        .id;
    }, 300_000);

    afterAll(async () => {
      await pool?.end().catch(() => {});
      const admin = new pg.Pool({ connectionString: ADMIN });
      await admin.query(`DROP DATABASE IF EXISTS "${NOME}"`);
      await admin.end();
    });

    /** Um extrato 03.08.15 com as chaves de acesso que se pedir. */
    async function semearExtrato(opcoes: {
      empresaId: string;
      chave: string;
      inicio: string;
      enviadoEm: Date;
      controles: (string | null)[];
    }): Promise<void> {
      const [competencia] = await db
        .insert(fechamentoCompetenciaTable)
        .values({
          chave: opcoes.chave,
          ano: Number(opcoes.chave.slice(0, 4)),
          mes: Number(opcoes.chave.slice(5, 7)),
          quinzena: 1,
          inicio: opcoes.inicio,
          fim: opcoes.inicio,
          /* A chave única da competência é o código legado, e não a unidade
           canônica — duas empresas na mesma quinzena precisam de códigos
           diferentes para caberem no banco. */
          unidadeCodigo: opcoes.empresaId.slice(0, 8),
          unidadeId: opcoes.empresaId,
          transportadoraCodigo: "36",
        })
        .returning();
      const [documento] = await db
        .insert(fechamentoDocumentoTable)
        .values({
          competenciaId: competencia.id,
          tipo: "CTE",
          nomeDoArquivo: `03.08.15 ${opcoes.chave}.xlsx`,
          sha256: `${opcoes.chave}-${opcoes.empresaId}`,
          tamanhoEmBytes: 1024,
          enviadoEm: opcoes.enviadoEm,
        })
        .returning();
      await db.insert(fechamentoCteTable).values(
        opcoes.controles.map((controle, i) => ({
          documentoId: documento.id,
          competenciaId: competencia.id,
          linhaNoArquivo: i + 1,
          vbz: 5,
          verbaNome: "FRETE VARIAVEL",
          verbaNatureza: "VARIAVEL",
          canal: "ROTA",
          numero: String(1000 + i),
          valorCte: "1234.56",
          controle,
        })),
      );
    }

    async function completo(
      fluxoId: string,
      empresaId: string,
    ): Promise<FluxoCompleto> {
      const lido = await lerFluxo(db, empresaId, fluxoId);
      if (!lido) throw new Error("o fluxo semeado sumiu");
      return lido;
    }

    function registro(...extras: Coletor[]) {
      return registroDeColetores(coletorDeAutorizacaoSefaz(db), ...extras);
    }

    /** A etapa do fluxo real que carrega a chave — o alvo de toda afirmação. */
    function etapaDaSefaz(fluxo: FluxoCompleto) {
      const etapa = fluxo.etapas.find((e) => e.chaveMonitoramento === CHAVE);
      if (!etapa)
        throw new Error("o fluxo CTe→Recebimento não tem a etapa da SEFAZ");
      return etapa;
    }

    it("acha a etapa `Autorização SEFAZ` no fluxo semeado, e ela é a única com a chave", async () => {
      const fluxo = await completo(fluxoA, empresaA);
      const comAChave = fluxo.etapas.filter(
        (e) => e.chaveMonitoramento === CHAVE,
      );
      expect(comAChave).toHaveLength(1);
      expect(comAChave[0]!.nome).toBe("Autorização SEFAZ");
    });

    it("VERDE: extrato da quinzena com todos os CT-es rastreáveis", async () => {
      await semearExtrato({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
        enviadoEm: new Date("2026-08-16T09:00:00.000Z"),
        controles: [CHAVE_DE_ACESSO, CHAVE_DE_ACESSO, CHAVE_DE_ACESSO],
      });
      const fluxo = await completo(fluxoA, empresaA);
      const resultado = await monitorarFluxo(registro(), empresaA, fluxo, {
        agora: new Date("2026-08-17T09:00:00.000Z"),
      });
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("VERDE");
      expect(estado.leitura).toMatchObject({
        chave: CHAVE,
        valor: 100,
        unidade: "%",
        medidoEm: "2026-08-16T09:00:00.000Z",
        validadeEmSegundos: 16 * 24 * 60 * 60,
      });
      expect(estado.leitura?.texto).toContain("todos com chave de acesso");
      /* A frase diz o que NÃO mediu — é o que impede a tela de prometer demais. */
      expect(estado.leitura?.texto).toContain("Não mede rejeição da SEFAZ");
      expect(resultado.falhas).toEqual([]);
    });

    it("AMARELO: emitiu, mas há documento sem chave de acesso", async () => {
      await semearExtrato({
        empresaId: empresaA,
        chave: "2026-08-Q2",
        inicio: "2026-08-16",
        enviadoEm: new Date("2026-08-31T09:00:00.000Z"),
        controles: [CHAVE_DE_ACESSO, null, "123", CHAVE_DE_ACESSO],
      });
      const fluxo = await completo(fluxoA, empresaA);
      const resultado = await monitorarFluxo(registro(), empresaA, fluxo, {
        agora: new Date("2026-09-01T09:00:00.000Z"),
      });
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("AMARELO");
      expect(estado.leitura?.valor).toBe(50);
      expect(estado.leitura?.texto).toContain("2 sem chave de acesso");
    });

    it("VERMELHO: o extrato existe e não evidencia autorização de nada", async () => {
      await semearExtrato({
        empresaId: empresaB,
        chave: "2026-08-Q2",
        inicio: "2026-08-16",
        enviadoEm: new Date("2026-08-31T09:00:00.000Z"),
        controles: [null, null],
      });
      const fluxo = await completo(fluxoB, empresaB);
      const resultado = await monitorarFluxo(registro(), empresaB, fluxo, {
        agora: new Date("2026-09-01T09:00:00.000Z"),
      });
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("VERMELHO");
      expect(estado.leitura?.valor).toBe(0);
      expect(estado.leitura?.texto).toContain("nenhum com chave de acesso");
    });

    it("VENCIDA: o extrato de dezoito dias atrás apaga o farol sem apagar o valor", async () => {
      const fluxo = await completo(fluxoA, empresaA);
      const resultado = await monitorarFluxo(registro(), empresaA, fluxo, {
        agora: new Date("2026-09-18T09:00:00.000Z"),
      });
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("SEM_DADO");
      expect(estado.motivo).toBe("vencida");
      expect(estado.vencida).toBe(true);
      /* O que a etapa mostra: "sem dado — o último era amarelo, há 18 dias". */
      expect(estado.leitura?.farol).toBe("AMARELO");
      expect(estado.idadeEmSegundos).toBe(18 * 24 * 60 * 60);
    });

    it("SEM DADO: empresa sem extrato nenhum — silêncio do coletor, e não verde", async () => {
      const [c] = await db
        .insert(unidadeTable)
        .values({ nome: "Transportes C", cnpj: "33333333000153" })
        .returning();
      const semeado = await importarFluxo(db, c.id, CTE_ATE_RECEBIMENTO, AUTOR);
      const fluxo = await completo(semeado.id, c.id);
      const resultado = await monitorarFluxo(registro(), c.id, fluxo, {
        agora: new Date("2026-09-01T09:00:00.000Z"),
      });
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("SEM_DADO");
      expect(estado.motivo).toBe("sem_resposta");
      expect(estado.leitura).toBeNull();
      expect(resultado.falhas).toEqual([]);
    });

    it("FALHA: o banco fora do ar apaga o farol e nomeia o coletor", async () => {
      const quebrado: Coletor = {
        nome: "extrato-fiscal-03.08.15",
        prefixos: [CHAVE],
        ler: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      };
      const fluxo = await completo(fluxoA, empresaA);
      const resultado = await monitorarFluxo(
        registroDeColetores(quebrado),
        empresaA,
        fluxo,
        {
          agora: new Date("2026-08-17T09:00:00.000Z"),
        },
      );
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("SEM_DADO");
      expect(estado.motivo).toBe("coletor_falhou");
      expect(resultado.falhas[0]).toMatchObject({
        coletor: "extrato-fiscal-03.08.15",
        motivo: "erro_do_coletor",
        mensagem: "connect ECONNREFUSED",
      });
    });

    it("TEMPO ESGOTADO: a consulta lenta apaga o farol em vez de travar a tela", async () => {
      const real = coletorDeAutorizacaoSefaz(db);
      const lento: Coletor = {
        ...real,
        ler: async (pedido) => {
          await new Promise((r) => setTimeout(r, 200));
          return real.ler(pedido);
        },
      };
      const fluxo = await completo(fluxoA, empresaA);
      const resultado = await monitorarFluxo(
        registroDeColetores(lento),
        empresaA,
        fluxo,
        {
          agora: new Date("2026-08-17T09:00:00.000Z"),
          tempoLimiteEmMs: 20,
        },
      );
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("SEM_DADO");
      expect(estado.motivo).toBe("coletor_falhou");
      expect(resultado.falhas[0]?.motivo).toBe("tempo_esgotado");
    });

    it("não alcança as outras dezessete chaves do mesmo fluxo", async () => {
      const fluxo = await completo(fluxoA, empresaA);
      const resultado = await monitorarFluxo(registro(), empresaA, fluxo, {
        agora: new Date("2026-09-01T09:00:00.000Z"),
      });
      const acesas = resultado.etapas.filter((e) => e.farol !== "SEM_DADO");

      expect(acesas.map((e) => e.chave)).toEqual([CHAVE]);
      /* As demais não são falha nem defeito: ninguém as reivindicou ainda. */
      expect(resultado.semColetor.length).toBeGreaterThan(10);
      expect(resultado.semColetor).not.toContain(CHAVE);
    });

    it("ISOLAMENTO: o extrato da empresa B não pinta a etapa da empresa A", async () => {
      const [d] = await db
        .insert(unidadeTable)
        .values({ nome: "Transportes D", cnpj: "44444444000134" })
        .returning();
      const semeado = await importarFluxo(db, d.id, CTE_ATE_RECEBIMENTO, AUTOR);
      /* A empresa D não tem extrato; B tem um, e é o mais recente do banco. */
      await semearExtrato({
        empresaId: empresaB,
        chave: "2026-09-Q1",
        inicio: "2026-09-01",
        enviadoEm: new Date("2026-09-16T09:00:00.000Z"),
        controles: [CHAVE_DE_ACESSO],
      });
      const fluxo = await completo(semeado.id, d.id);
      const resultado = await monitorarFluxo(registro(), d.id, fluxo, {
        agora: new Date("2026-09-17T09:00:00.000Z"),
      });
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      expect(estado.farol).toBe("SEM_DADO");
      expect(estado.leitura).toBeNull();

      /* E a de B, com o mesmo registro e a mesma chamada, acende. */
      const deB = await monitorarFluxo(
        registro(),
        empresaB,
        await completo(fluxoB, empresaB),
        {
          agora: new Date("2026-09-17T09:00:00.000Z"),
        },
      );
      expect(deB.etapas.find((e) => e.chave === CHAVE)?.farol).toBe("VERDE");
    });

    it("competência sem unidade associada não pinta o farol de ninguém", async () => {
      const [competencia] = await db
        .insert(fechamentoCompetenciaTable)
        .values({
          chave: "2026-10-Q1",
          ano: 2026,
          mes: 10,
          quinzena: 1,
          inicio: "2026-10-01",
          fim: "2026-10-15",
          unidadeCodigo: "443",
          transportadoraCodigo: "36",
        })
        .returning();
      const [documento] = await db
        .insert(fechamentoDocumentoTable)
        .values({
          competenciaId: competencia.id,
          tipo: "CTE",
          nomeDoArquivo: "03.08.15 orfao.xlsx",
          sha256: "orfao",
          tamanhoEmBytes: 10,
          enviadoEm: new Date("2026-10-16T09:00:00.000Z"),
        })
        .returning();
      await db.insert(fechamentoCteTable).values({
        documentoId: documento.id,
        competenciaId: competencia.id,
        linhaNoArquivo: 1,
        vbz: 5,
        verbaNome: "FRETE VARIAVEL",
        verbaNatureza: "VARIAVEL",
        canal: "ROTA",
        valorCte: "10.00",
        controle: CHAVE_DE_ACESSO,
      });

      const fluxo = await completo(fluxoA, empresaA);
      const resultado = await monitorarFluxo(registro(), empresaA, fluxo, {
        agora: new Date("2026-10-17T09:00:00.000Z"),
      });
      const estado = resultado.etapas.find(
        (e) => e.etapaId === etapaDaSefaz(fluxo).id,
      )!;

      /* O extrato órfão é o mais recente do banco — e continua sem dono. */
      expect(estado.farol).toBe("SEM_DADO");
      expect(estado.motivo).toBe("vencida");
      expect(estado.leitura?.medidoEm).toBe("2026-08-31T09:00:00.000Z");
    });
  },
);
