import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cadastrarUnidade,
  createDb,
  fechamentoCompetenciaTable,
  remuneracaoPlanilhaTable,
  remuneracaoUnidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import { linhasDoCustoFixo } from "@workspace/fechamento";
import {
  abrirCompetencia,
  associarUnidadeDaCompetencia,
} from "@workspace/fechamento/persistencia";

import { cadastroDaRemuneracao } from "../lib/cadastro-da-remuneracao";

/**
 * AS DUAS QUINZENAS, DA ABERTURA AO DEVIDO — os seis passos do caso real.
 *
 * O arquivo percorre o caminho de quem opera, na ordem em que ele acontece:
 * abrir a 1ª quinzena, cadastrar a unidade canônica, abrir a 2ª, recarregar
 * tudo, e conferir que as duas chegam ao contrato **pela identidade** — sem que
 * nenhum texto seja comparado em ponto nenhum.
 *
 * **Por que os códigos são deliberadamente diferentes.** A competência carrega
 * `CDD Belém` e o cadastro de Remuneração carrega o CNPJ com máscara. Nenhuma
 * das três faixas de texto do casamento antigo (exato, espaço, documento)
 * aproxima os dois: `CDD Belém` não tem dígito nenhum. Se o contrato responde,
 * responde por identidade — e é isso que se quer provar, não que "funciona".
 *
 * O que **não** está aqui, de propósito: nenhum documento é importado, e o
 * cadastro é o digitado à mão. O devido sai mesmo assim. A prova de que lastro
 * e capacidade de calcular são independentes está em `cadastro-a-mao-sem-lastro`.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_duas_quinzenas_${process.pid}`;

function apontarPara(url: string, banco: string): string {
  const alvo = new URL(url);
  alvo.pathname = `/${banco}`;
  return alvo.toString();
}

async function alcancavel(): Promise<boolean> {
  const { pool } = createDb(ADMIN);
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const temBanco = await alcancavel();
const noCi = process.env.CI === "true" || process.env.CI === "1";
if (!temBanco && noCi) throw new Error("O CI declara um Postgres e ele não respondeu.");

const CNPJ_MASCARADO = "11.177.288/0001-90";
const ESCOPO = "escopo-belem-duas";

/** As 20 obrigatórias e mais nada — o mínimo que produz contrato. */
const ABA: [string, number][] = [
  ["aliquota_pis", 0.65],
  ["aliquota_cofins", 8.6],
  ["aliquota_icms", 17.84],
  ["aliquota_iss", 5.9],
  ["rota_percentual_iss", 3.16],
  ["frota_fixa_ativos", 56],
  ["frota_fixa_inativos", 8],
  ["ativo_remuneracao_fixa_frota", 1424.91],
  ["ativo_remuneracao_fixa_equipe", 8919.38],
  ["ativo_custo_variavel", 5176.53],
  ["ativo_remuneracao_fixa_qlp", 4427.53],
  ["ativo_outras_despesas", 4361.07],
  ["inativo_remuneracao_fixa", 1650.97],
  ["van_quantidade_ativas", 7],
  ["van_custo_fixo", 4693.85],
  ["van_custo_equipe", 4250.45],
  ["van_quantidade_inativas", 6],
  ["van_remuneracao_inativas", 3195.18],
  ["noturna_quantidade_rotas", 1],
  ["noturna_custo_sem_impostos", 8697.88],
];

const pergunta = (quinzena: 1 | 2, unidadeId: string | null, unidadeCodigo: string) => ({
  unidadeId,
  unidadeCodigo,
  transportadoraCodigo: "36",
  canal: "ROTA" as const,
  inicio: quinzena === 1 ? "2026-07-01" : "2026-07-16",
  fim: quinzena === 1 ? "2026-07-15" : "2026-07-31",
});

describe.skipIf(!temBanco)("as duas quinzenas, da abertura ao devido", () => {
  let fechar: () => Promise<void>;
  let db: Database;
  let primeiraId: string;
  let segundaId: string;
  let unidadeId: string;

  beforeAll(async () => {
    const admin = createDb(ADMIN);
    await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`);
    await admin.pool.query(`CREATE DATABASE "${NOME_DO_BANCO}"`);
    await admin.pool.end();
    const url = apontarPara(ADMIN, NOME_DO_BANCO);
    await runMigrations(url);
    const alvo = createDb(url);
    db = alvo.db;
    fechar = () => alvo.pool.end();
  }, 180_000);

  afterAll(async () => {
    await fechar?.().catch(() => {});
    const admin = createDb(ADMIN);
    await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`).catch(() => {});
    await admin.pool.end().catch(() => {});
  });

  const doBanco = (id: string) =>
    db
      .select()
      .from(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, id))
      .then(([c]) => c!);

  /* --- 1 --------------------------------------------------------------- */

  it("1. a 1ª quinzena é aberta antes de a unidade existir, e nasce sem identidade", async () => {
    const c = await abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 1,
      tipoDeOperacao: "ROTA",
      unidade: { codigo: "CDD Belém", nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });
    primeiraId = c.id;

    /*
      Nula, e é o certo: não há unidade canônica nenhuma no banco, e inventar
      uma a partir do texto é exatamente o que este produto recusa.
    */
    expect(c.unidadeId).toBeNull();
  });

  /* --- 2 --------------------------------------------------------------- */

  it("2. CDD BELEM é cadastrada, com o CNPJ e a aba das duas quinzenas", async () => {
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });
    unidadeId = u.id;

    /* O cadastro de Remuneração aponta para a mesma unidade canônica. */
    await db.insert(remuneracaoUnidadeTable).values({
      scopeHash: ESCOPO,
      scopeType: "UNIDADE",
      codigo: CNPJ_MASCARADO,
      nome: "CDD BELEM",
      canal: "ROTA",
      unidadeId: u.id,
      vigenciaInicial: "2026-07-01",
    });
    for (const vigencia of ["2026-07-01", "2026-07-16"]) {
      await db.insert(remuneracaoPlanilhaTable).values(
        ABA.map(([chave, valor]) => ({
          scopeHash: ESCOPO,
          canal: "ROTA",
          effectiveDate: vigencia,
          chave,
          valor: String(valor),
        })),
      );
    }

    /*
      O nome da unidade é o texto da competência, e mesmo assim ela continua
      sem identidade: quem cadastra uma unidade não está dizendo nada sobre o
      texto `CDD Belém` de um fechamento. É uma pessoa que diz, com um clique,
      e é o passo seguinte.
    */
    expect((await doBanco(primeiraId)).unidadeId).toBeNull();
  });

  /* --- 3 --------------------------------------------------------------- */

  /**
   * A associação da 1ª — o único ato humano do caminho inteiro.
   *
   * Antes desta correção ele resolvia uma competência. Agora resolve o texto:
   * a 2ª quinzena, aberta a seguir com o mesmo `CDD Belém`, nasce apontando
   * para a unidade — sem segundo clique, e sem que a tela precise oferecer um.
   */
  it("3. associada a 1ª, a 2ª quinzena nasce já associada", async () => {
    await associarUnidadeDaCompetencia(db, primeiraId, unidadeId);

    const segunda = await abrirCompetencia(db, {
      ano: 2026,
      mes: 7,
      quinzena: 2,
      tipoDeOperacao: "ROTA",
      unidade: { codigo: "CDD Belém", nome: "CDD BELÉM" },
      transportadora: { codigo: "36", nome: "HORIZONTE" },
    });
    segundaId = segunda.id;

    expect(segunda.unidadeId).toBe(unidadeId);
  });

  /* --- 4 e 5 ------------------------------------------------------------ */

  it("4-5. recarregado do banco, o par tem a mesma unidade canônica", async () => {
    /* Lidas de novo, sem cache nenhum: é o "recarregar tudo". */
    const primeira = await doBanco(primeiraId);
    const segunda = await doBanco(segundaId);

    expect(primeira.unidadeId).toBe(unidadeId);
    expect(segunda.unidadeId).toBe(unidadeId);
    /* E o texto legado continua onde estava — nada foi reescrito. */
    expect(primeira.unidadeCodigo).toBe("CDD Belém");
    expect(segunda.unidadeCodigo).toBe("CDD Belém");
  });

  /* --- 6 ---------------------------------------------------------------- */

  it("6. as duas chegam ao contrato pela identidade, sem casamento textual", async () => {
    const porta = cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" });

    for (const [quinzena, vigenteDe] of [
      [1, "2026-07-01"],
      [2, "2026-07-16"],
    ] as const) {
      const { resposta, diagnostico } = await porta.resolver(
        pergunta(quinzena, unidadeId, "CDD Belém"),
      );

      expect(diagnostico.estado).toBe("RESPONDEU");
      /*
        A prova de que nenhum texto foi comparado: `IDENTIDADE` é a única faixa
        que não olha código. As outras três nem poderiam casar — `CDD Belém` não
        tem dígito, e o cadastro guarda um CNPJ.
      */
      expect(diagnostico.unidade.comoCasou).toBe("IDENTIDADE");
      expect(resposta?.vigenteDe).toBe(vigenteDe);

      const linhas = linhasDoCustoFixo(resposta!.parametros);
      expect(linhas.find((l) => l.chave === "custo_fixo_padronizado")?.valor).toBeGreaterThan(0);
    }
  });

  /**
   * IDEMPOTÊNCIA — salvar de novo não muda nada, e não estraga nada.
   *
   * Reabrir o mesmo endereço é o gesto de quem clicou duas vezes ou voltou à
   * tela. Devolve a mesma competência, com a mesma identidade, e sem uma linha
   * escrita a mais.
   */
  it("salvar de novo é idempotente nas duas quinzenas", async () => {
    for (const [quinzena, id] of [
      [1, primeiraId],
      [2, segundaId],
    ] as const) {
      const denovo = await abrirCompetencia(db, {
        ano: 2026,
        mes: 7,
        quinzena,
        tipoDeOperacao: "ROTA",
        unidade: { codigo: "CDD Belém", nome: "CDD BELÉM" },
        transportadora: { codigo: "36", nome: "HORIZONTE" },
      });
      expect(denovo.id).toBe(id);
      expect(denovo.unidadeId).toBe(unidadeId);
    }

    /* Associar de novo, a mesma unidade, também não é erro nem mudança. */
    const outra = await associarUnidadeDaCompetencia(db, segundaId, unidadeId);
    expect(outra.unidadeId).toBe(unidadeId);
  });
});
