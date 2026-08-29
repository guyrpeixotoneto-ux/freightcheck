import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  fechamentoCompetenciaTable,
  fechamentoCteTable,
  fechamentoDocumentoTable,
  fechamentoViagemTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  CTE_ATE_RECEBIMENTO,
  conferirCobertura,
  importarFluxo,
  lerFluxo,
  monitorarFluxo,
  registroDeColetores,
  type EstadoDaEtapa,
  type FluxoCompleto,
} from "@workspace/fluxos";
import { coletorDeAutorizacaoSefaz } from "../cte-autorizacao-sefaz";
import { CHAVE_DA_EMISSAO, coletorDeEmissaoDeCte } from "../cte-emissao";
import { CHAVE_DO_TRANSPORTE, coletorDeTransporte } from "../operacao-transporte";
import { VALIDADE_DA_QUINZENA_EM_SEGUNDOS } from "../fonte-da-quinzena";

/**
 * OS DOIS COLETORES DA PRIORIDADE 1, SOBRE O BANCO REAL.
 *
 * Mesma disciplina do primeiro coletor: migrations de verdade, o fluxo
 * CTe→Recebimento semeado por `importarFluxo` (sem atalho), e linhas com a forma
 * que o 03.08.15 e o 2Art têm.
 *
 * O que esta bateria prova, e por que cada afirmação está aqui:
 *
 * - **leitura válida** — o arquivo da quinzena acende a etapa que está no banco,
 *   com valor, unidade e a frase que diz o que foi medido;
 * - **ausência** — sem competência, sem documento vigente e com documento vazio,
 *   o coletor cala, e o motor apaga a etapa com o motivo certo. Em nenhum desses
 *   casos a etapa fica verde;
 * - **staleness** — passada a validade da quinzena, a medição apaga **sem se
 *   perder**: `vencida`, com a leitura e a idade guardadas;
 * - **isolamento por empresa** — o arquivo da empresa B não acende etapa nenhuma
 *   da empresa A, e vice-versa;
 * - **nenhuma escrita** — colher três vezes não muda uma linha do banco;
 * - **falha isolada** — o coletor cuja fonte quebrou apaga só a etapa dele; os
 *   outros dois continuam acesos, e a falha vai na resposta com o nome do
 *   culpado;
 * - **cobertura antes × depois** — a conta de quantas chaves do fluxo têm dono,
 *   medida com o registro de antes e com o de agora.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME = `fc_prioridade1_${process.pid}`;

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
const DIA = 24 * 60 * 60 * 1000;

describe.skipIf(!temBanco)("os coletores da Prioridade 1", () => {
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

    fluxoA = (await importarFluxo(db, empresaA, CTE_ATE_RECEBIMENTO, AUTOR)).id;
    fluxoB = (await importarFluxo(db, empresaB, CTE_ATE_RECEBIMENTO, AUTOR)).id;
  }, 300_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    const admin = new pg.Pool({ connectionString: ADMIN });
    await admin.query(`DROP DATABASE IF EXISTS "${NOME}" WITH (FORCE)`);
    await admin.end();
  });

  // -------------------------------------------------------------------------
  // A semeadura: uma quinzena de uma empresa, com os arquivos que se pedir
  // -------------------------------------------------------------------------

  /** Abre a competência da quinzena para uma empresa. */
  async function abrirCompetencia(opcoes: {
    empresaId: string;
    chave: string;
    inicio: string;
  }): Promise<string> {
    const [competencia] = await db
      .insert(fechamentoCompetenciaTable)
      .values({
        chave: opcoes.chave,
        ano: Number(opcoes.chave.slice(0, 4)),
        mes: Number(opcoes.chave.slice(5, 7)),
        quinzena: opcoes.chave.endsWith("Q1") ? 1 : 2,
        inicio: opcoes.inicio,
        fim: opcoes.inicio,
        /* A chave única da competência é o código legado, e não a unidade
           canônica: duas empresas na mesma quinzena precisam de códigos
           diferentes para caberem no banco. */
        unidadeCodigo: `${opcoes.empresaId.slice(0, 8)}-${opcoes.chave}`,
        unidadeId: opcoes.empresaId,
        transportadoraCodigo: "36",
      })
      .returning();
    return competencia.id;
  }

  /** Um 03.08.15 com o número de CT-es pedido. */
  async function gravarExtratoCte(opcoes: {
    competenciaId: string;
    sufixo: string;
    enviadoEm: Date;
    ctes: number;
    recusas?: unknown[];
  }): Promise<void> {
    const [documento] = await db
      .insert(fechamentoDocumentoTable)
      .values({
        competenciaId: opcoes.competenciaId,
        tipo: "CTE",
        nomeDoArquivo: `03.08.15 ${opcoes.sufixo}.txt`,
        sha256: `cte-${opcoes.sufixo}`,
        tamanhoEmBytes: 4096,
        linhasLidas: opcoes.ctes,
        recusas: opcoes.recusas ?? [],
        enviadoEm: opcoes.enviadoEm,
      })
      .returning();
    if (opcoes.ctes === 0) return;
    await db.insert(fechamentoCteTable).values(
      Array.from({ length: opcoes.ctes }, (_, i) => ({
        documentoId: documento.id,
        competenciaId: opcoes.competenciaId,
        linhaNoArquivo: i + 1,
        vbz: 5,
        verbaNome: "FRETE VARIAVEL",
        verbaNatureza: "VARIAVEL",
        canal: "ROTA",
        numero: String(90_000 + i),
        valorCte: "1000.00",
        controle: "3".repeat(44),
      })),
    );
  }

  /** Um 2Art com o número de viagens pedido. */
  async function gravarDiario(opcoes: {
    competenciaId: string;
    sufixo: string;
    enviadoEm: Date;
    viagens: number;
    recusas?: unknown[];
  }): Promise<void> {
    const [documento] = await db
      .insert(fechamentoDocumentoTable)
      .values({
        competenciaId: opcoes.competenciaId,
        tipo: "OPERACAO",
        nomeDoArquivo: `2Art ${opcoes.sufixo}.txt`,
        sha256: `op-${opcoes.sufixo}`,
        tamanhoEmBytes: 8192,
        linhasLidas: opcoes.viagens,
        recusas: opcoes.recusas ?? [],
        enviadoEm: opcoes.enviadoEm,
      })
      .returning();
    if (opcoes.viagens === 0) return;
    await db.insert(fechamentoViagemTable).values(
      Array.from({ length: opcoes.viagens }, (_, i) => ({
        documentoId: documento.id,
        competenciaId: opcoes.competenciaId,
        linhaNoArquivo: i + 1,
        dia: i % 2 === 0 ? "2026-08-03" : "2026-08-04",
        canal: "ROTA",
        frota: "FF",
        placa: `ABC1D${i}`,
        entregas: 10,
        valorFaturado: "500.00",
      })),
    );
  }

  /** Apaga tudo o que a semeadura escreveu — cada caso monta o seu cenário. */
  async function limparFechamento(): Promise<void> {
    await pool.query("delete from fechamento_competencia");
  }

  // -------------------------------------------------------------------------
  // A apuração
  // -------------------------------------------------------------------------

  const registroDaPrioridade1 = () =>
    registroDeColetores(
      coletorDeAutorizacaoSefaz(db),
      coletorDeEmissaoDeCte(db),
      coletorDeTransporte(db),
    );

  async function fluxo(empresaId: string, id: string): Promise<FluxoCompleto> {
    const completo = await lerFluxo(db, empresaId, id);
    if (!completo) throw new Error("o fluxo do cenário sumiu");
    return completo;
  }

  async function apurar(
    empresaId: string,
    fluxoId: string,
    registro = registroDaPrioridade1(),
  ) {
    return monitorarFluxo(registro, empresaId, await fluxo(empresaId, fluxoId));
  }

  function etapaDe(
    estados: readonly EstadoDaEtapa[],
    chave: string,
  ): EstadoDaEtapa {
    const achada = estados.find((e) => e.chave === chave);
    if (!achada) throw new Error(`a etapa de ${chave} não está no fluxo`);
    return achada;
  }

  // -------------------------------------------------------------------------
  // 1. Leitura válida
  // -------------------------------------------------------------------------

  describe("leitura válida", () => {
    beforeAll(async () => {
      await limparFechamento();
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-valido",
        enviadoEm: new Date(),
        ctes: 412,
      });
      await gravarDiario({
        competenciaId: competencia,
        sufixo: "a-valido",
        enviadoEm: new Date(),
        viagens: 37,
      });
    });

    it("cte.emissao acende com o número de CT-es do extrato da quinzena", async () => {
      const etapa = etapaDe((await apurar(empresaA, fluxoA)).etapas, CHAVE_DA_EMISSAO);
      expect(etapa.farol).toBe("VERDE");
      expect(etapa.etapaNome).toBe("Emissão do CTe");
      expect(etapa.leitura).toMatchObject({ valor: 412, unidade: "CT-e" });
      expect(etapa.leitura?.validadeEmSegundos).toBe(VALIDADE_DA_QUINZENA_EM_SEGUNDOS);
      expect(etapa.vencida).toBe(false);
      expect(etapa.motivo).toBeNull();
    });

    it("operacao.transporte acende com as viagens do diário da quinzena", async () => {
      const etapa = etapaDe((await apurar(empresaA, fluxoA)).etapas, CHAVE_DO_TRANSPORTE);
      expect(etapa.farol).toBe("VERDE");
      expect(etapa.etapaNome).toBe("Transporte / acompanhamento");
      expect(etapa.leitura).toMatchObject({ valor: 37, unidade: "viagens" });
      expect(etapa.leitura?.texto).toContain("370 entregas");
      expect(etapa.leitura?.texto).toContain("2 dia(s)");
    });

    it("a frase diz o que foi medido e o que não foi — a tela não promete mais", async () => {
      const estados = (await apurar(empresaA, fluxoA)).etapas;
      expect(etapaDe(estados, CHAVE_DA_EMISSAO).leitura?.texto).toContain(
        "Mede emissão registrada, não prazo nem cancelamento.",
      );
      expect(etapaDe(estados, CHAVE_DO_TRANSPORTE).leitura?.texto).toContain(
        "Mede operação registrada, não pontualidade nem ocorrência.",
      );
    });

    it("linha recusada na leitura é AMARELO, e nunca some da frase", async () => {
      /*
        O limiar não é um percentual escolhido: é "existe recusa". Uma linha que
        o leitor recusou ou está lá ou não está, e o Fechamento já chama esse
        estado de `COM_RECUSA` (`pages/fechamento/status-da-etapa.ts`).
      */
      await limparFechamento();
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q2",
        inicio: "2026-08-16",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-recusa",
        enviadoEm: new Date(),
        ctes: 100,
        recusas: [{ linha: 7, texto: "coluna VBZ ilegível" }],
      });

      const etapa = etapaDe((await apurar(empresaA, fluxoA)).etapas, CHAVE_DA_EMISSAO);
      expect(etapa.farol).toBe("AMARELO");
      expect(etapa.leitura?.texto).toContain("1 linha(s) do arquivo recusada(s)");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Ausência — e a regra que nunca pode cair: ausência não vira VERDE
  // -------------------------------------------------------------------------

  describe("ausência de dado", () => {
    it("sem competência nenhuma, as duas etapas ficam sem_resposta — nunca verdes", async () => {
      await limparFechamento();
      const estados = (await apurar(empresaA, fluxoA)).etapas;
      for (const chave of [CHAVE_DA_EMISSAO, CHAVE_DO_TRANSPORTE]) {
        expect(etapaDe(estados, chave)).toMatchObject({
          farol: "SEM_DADO",
          leitura: null,
          motivo: "sem_resposta",
        });
      }
    });

    it("competência aberta e arquivo que não chegou: silêncio, e não verde", async () => {
      await limparFechamento();
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      /* Só o 03.08.15 chegou. O 2Art não. */
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-so-cte",
        enviadoEm: new Date(),
        ctes: 5,
      });

      const estados = (await apurar(empresaA, fluxoA)).etapas;
      expect(etapaDe(estados, CHAVE_DA_EMISSAO).farol).toBe("VERDE");
      expect(etapaDe(estados, CHAVE_DO_TRANSPORTE)).toMatchObject({
        farol: "SEM_DADO",
        motivo: "sem_resposta",
      });
    });

    it("arquivo vigente e vazio é ausência do fato, e não fato ruim", async () => {
      /*
        A recusa do vermelho, provada: um extrato sem CT-e não acusa a emissão.
        Ele diz que a quinzena não trouxe emissão registrada — que é `SEM_DADO`.
      */
      await limparFechamento();
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-vazio",
        enviadoEm: new Date(),
        ctes: 0,
      });
      await gravarDiario({
        competenciaId: competencia,
        sufixo: "a-vazio",
        enviadoEm: new Date(),
        viagens: 0,
      });

      const estados = (await apurar(empresaA, fluxoA)).etapas;
      for (const chave of [CHAVE_DA_EMISSAO, CHAVE_DO_TRANSPORTE]) {
        const etapa = etapaDe(estados, chave);
        expect(etapa.farol).toBe("SEM_DADO");
        expect(etapa.farol).not.toBe("VERDE");
        expect(etapa.motivo).toBe("sem_resposta");
      }
    });

    it("nenhum destes coletores é capaz de devolver VERMELHO", async () => {
      /*
        A afirmação negativa não existe no acervo: não há denominador do que
        deveria ter sido emitido nem do que deveria ter rodado. A prova é a
        varredura dos cenários montados acima — em nenhum deles sai vermelho.
      */
      await limparFechamento();
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-cores",
        enviadoEm: new Date(),
        ctes: 3,
        recusas: [{ linha: 1 }, { linha: 2 }],
      });
      await gravarDiario({
        competenciaId: competencia,
        sufixo: "a-cores",
        enviadoEm: new Date(),
        viagens: 3,
      });

      const estados = (await apurar(empresaA, fluxoA)).etapas;
      const nossas = [CHAVE_DA_EMISSAO, CHAVE_DO_TRANSPORTE].map((c) =>
        etapaDe(estados, c),
      );
      expect(nossas.map((e) => e.farol)).toEqual(["AMARELO", "VERDE"]);
      expect(nossas.some((e) => e.farol === "VERMELHO")).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Staleness
  // -------------------------------------------------------------------------

  describe("staleness", () => {
    it("passada a quinzena + 1 dia, apaga sem perder a medição", async () => {
      await limparFechamento();
      const velho = new Date(Date.now() - 20 * DIA);
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-07-Q2",
        inicio: "2026-07-16",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-velho",
        enviadoEm: velho,
        ctes: 88,
      });
      await gravarDiario({
        competenciaId: competencia,
        sufixo: "a-velho",
        enviadoEm: velho,
        viagens: 12,
      });

      const monitoramento = await apurar(empresaA, fluxoA);
      for (const [chave, valor] of [
        [CHAVE_DA_EMISSAO, 88],
        [CHAVE_DO_TRANSPORTE, 12],
      ] as const) {
        const etapa = etapaDe(monitoramento.etapas, chave);
        expect(etapa.farol).toBe("SEM_DADO");
        expect(etapa.vencida).toBe(true);
        expect(etapa.motivo).toBe("vencida");
        /* A medição fica: é dela que sai "o último era verde, há 20 dias". */
        expect(etapa.leitura?.valor).toBe(valor);
        expect(etapa.leitura?.farol).toBe("VERDE");
        expect(etapa.idadeEmSegundos).toBeGreaterThan(VALIDADE_DA_QUINZENA_EM_SEGUNDOS);
      }
      /*
        Três, e não duas: o coletor da autorização SEFAZ lê o mesmo 03.08.15 e
        tem a mesma validade de quinzena, então ele envelhece junto. É o retrato
        certo — quando o extrato atrasa, as três etapas que dependem dele apagam
        ao mesmo tempo, e nenhuma delas finge normalidade.
      */
      expect(monitoramento.resumo).toMatchObject({ respondidas: 3, vencidas: 3, medidas: 0 });
    });

    it("dentro da validade, o mesmo arquivo continua aceso", async () => {
      await limparFechamento();
      const recente = new Date(Date.now() - 10 * DIA);
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-10dias",
        enviadoEm: recente,
        ctes: 88,
      });

      const etapa = etapaDe((await apurar(empresaA, fluxoA)).etapas, CHAVE_DA_EMISSAO);
      expect(etapa.farol).toBe("VERDE");
      expect(etapa.vencida).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Isolamento por empresa
  // -------------------------------------------------------------------------

  describe("isolamento por empresa", () => {
    beforeAll(async () => {
      await limparFechamento();
      const daB = await abrirCompetencia({
        empresaId: empresaB,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      await gravarExtratoCte({
        competenciaId: daB,
        sufixo: "b",
        enviadoEm: new Date(),
        ctes: 999,
      });
      await gravarDiario({
        competenciaId: daB,
        sufixo: "b",
        enviadoEm: new Date(),
        viagens: 99,
      });
    });

    it("o arquivo da B não acende nenhuma etapa da A", async () => {
      const estados = (await apurar(empresaA, fluxoA)).etapas;
      for (const chave of [CHAVE_DA_EMISSAO, CHAVE_DO_TRANSPORTE]) {
        expect(etapaDe(estados, chave)).toMatchObject({
          farol: "SEM_DADO",
          leitura: null,
          motivo: "sem_resposta",
        });
      }
    });

    it("e acende as da B, com os números dela", async () => {
      const estados = (await apurar(empresaB, fluxoB)).etapas;
      expect(etapaDe(estados, CHAVE_DA_EMISSAO).leitura?.valor).toBe(999);
      expect(etapaDe(estados, CHAVE_DO_TRANSPORTE).leitura?.valor).toBe(99);
    });

    it("competência sem unidade associada não é de ninguém", async () => {
      /*
        O legado que `fechamento_competencia` descreve: `unidade_id` nulo. Ela
        não pode pintar o farol de ninguém — associar por semelhança de nome é
        exatamente o que a `0049` desfez.
      */
      await limparFechamento();
      const [orfa] = await db
        .insert(fechamentoCompetenciaTable)
        .values({
          chave: "2026-08-Q1",
          ano: 2026,
          mes: 8,
          quinzena: 1,
          inicio: "2026-08-01",
          fim: "2026-08-15",
          unidadeCodigo: "orfa",
          unidadeId: null,
          transportadoraCodigo: "36",
        })
        .returning();
      await gravarExtratoCte({
        competenciaId: orfa.id,
        sufixo: "orfa",
        enviadoEm: new Date(),
        ctes: 500,
      });

      for (const [empresaId, fluxoId] of [
        [empresaA, fluxoA],
        [empresaB, fluxoB],
      ] as const) {
        const etapa = etapaDe((await apurar(empresaId, fluxoId)).etapas, CHAVE_DA_EMISSAO);
        expect(etapa.farol).toBe("SEM_DADO");
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. Nenhuma escrita
  // -------------------------------------------------------------------------

  describe("colher não escreve", () => {
    const TABELAS = [
      "fluxo_operacional",
      "fluxo_etapa",
      "fechamento_competencia",
      "fechamento_documento",
      "fechamento_cte",
      "fechamento_viagem",
    ];

    async function retrato(): Promise<string> {
      const partes: string[] = [];
      for (const tabela of TABELAS) {
        const { rows } = await pool.query<{ n: string }>(
          `select count(*)::text as n from ${tabela}`,
        );
        partes.push(`${tabela}=${rows[0]!.n}`);
      }
      return partes.join(" ");
    }

    it("três colheitas não mudam uma linha do banco", async () => {
      await limparFechamento();
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-escrita",
        enviadoEm: new Date(),
        ctes: 10,
      });
      await gravarDiario({
        competenciaId: competencia,
        sufixo: "a-escrita",
        enviadoEm: new Date(),
        viagens: 4,
      });

      const antes = await retrato();
      for (let i = 0; i < 3; i += 1) await apurar(empresaA, fluxoA);
      expect(await retrato()).toBe(antes);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Falha isolada
  // -------------------------------------------------------------------------

  describe("a falha de um não derruba os outros", () => {
    it("o coletor cuja fonte quebrou apaga só a etapa dele, e é nomeado", async () => {
      /*
        A falha é de verdade, e não simulada por um coletor de mentira: o
        `coletorDeEmissaoDeCte` recebe uma conexão que recusa consulta, que é o
        que acontece quando o banco de uma fonte cai. Os outros dois recebem a
        conexão boa e continuam medindo.
      */
      await limparFechamento();
      const competencia = await abrirCompetencia({
        empresaId: empresaA,
        chave: "2026-08-Q1",
        inicio: "2026-08-01",
      });
      await gravarExtratoCte({
        competenciaId: competencia,
        sufixo: "a-falha",
        enviadoEm: new Date(),
        ctes: 20,
      });
      await gravarDiario({
        competenciaId: competencia,
        sufixo: "a-falha",
        enviadoEm: new Date(),
        viagens: 6,
      });

      const bancoQuebrado = new Proxy({} as Database, {
        get() {
          throw new Error("connect ECONNREFUSED — a fonte do 03.08.15 caiu");
        },
      });

      const monitoramento = await apurar(
        empresaA,
        fluxoA,
        registroDeColetores(
          coletorDeAutorizacaoSefaz(db),
          coletorDeEmissaoDeCte(bancoQuebrado),
          coletorDeTransporte(db),
        ),
      );

      expect(etapaDe(monitoramento.etapas, CHAVE_DA_EMISSAO)).toMatchObject({
        farol: "SEM_DADO",
        motivo: "coletor_falhou",
      });
      /* O vizinho continua aceso — a falha não contaminou a colheita. */
      expect(etapaDe(monitoramento.etapas, CHAVE_DO_TRANSPORTE)).toMatchObject({
        farol: "VERDE",
      });
      expect(etapaDe(monitoramento.etapas, "cte.autorizacao_sefaz").farol).toBe("VERDE");

      /* E a falha vai na resposta, com nome e chave — nunca só no log. */
      expect(monitoramento.falhas).toHaveLength(1);
      expect(monitoramento.falhas[0]).toMatchObject({
        coletor: "emissao-no-extrato-03.08.15",
        motivo: "erro_do_coletor",
        chaves: [CHAVE_DA_EMISSAO],
      });
      expect(monitoramento.falhas[0]?.mensagem).toContain("ECONNREFUSED");
    });
  });

  // -------------------------------------------------------------------------
  // 7. Cobertura antes × depois
  // -------------------------------------------------------------------------

  describe("cobertura antes × depois", () => {
    it("o fluxo do CTe sai de 1 chave com dono para 3", async () => {
      const completo = await fluxo(empresaA, fluxoA);

      const antes = conferirCobertura(
        completo,
        registroDeColetores(coletorDeAutorizacaoSefaz(db)),
      );
      const depois = conferirCobertura(completo, registroDaPrioridade1());

      expect(antes).toMatchObject({ etapas: 18, etapasComChave: 18, etapasCobertas: 1 });
      expect(antes.semColetor).toHaveLength(17);

      expect(depois).toMatchObject({ etapas: 18, etapasComChave: 18, etapasCobertas: 3 });
      expect(depois.semColetor).toHaveLength(15);
      expect(depois.malFormadas).toEqual([]);

      const comDono = depois.chaves
        .filter((c) => c.coletor !== null)
        .map((c) => [c.chave, c.coletor]);
      expect(comDono).toEqual(
        expect.arrayContaining([
          ["cte.emissao", "emissao-no-extrato-03.08.15"],
          ["cte.autorizacao_sefaz", "extrato-fiscal-03.08.15"],
          ["operacao.transporte", "diario-operacional-2art"],
        ]),
      );
    });

    it("cada coletor responde só pela chave que declarou", async () => {
      const registro = registroDaPrioridade1();
      expect(registro.responsavelPor(CHAVE_DA_EMISSAO)?.nome).toBe(
        "emissao-no-extrato-03.08.15",
      );
      expect(registro.responsavelPor(CHAVE_DO_TRANSPORTE)?.nome).toBe(
        "diario-operacional-2art",
      );
      expect(registro.responsavelPor("cte.autorizacao_sefaz")?.nome).toBe(
        "extrato-fiscal-03.08.15",
      );
      /* Vizinhas de prefixo que continuam órfãs — não há coletor de espaço. */
      expect(registro.responsavelPor("cte.autorizado")).toBeNull();
      expect(registro.responsavelPor("operacao.encerramento")).toBeNull();
    });
  });
});
