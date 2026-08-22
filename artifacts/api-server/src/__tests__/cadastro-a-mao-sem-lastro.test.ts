import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  cadastrarUnidade,
  createDb,
  remuneracaoPlanilhaTable,
  remuneracaoUnidadeTable,
  type Database,
} from "@workspace/db";
import { runMigrations } from "@workspace/db/migrate";
import {
  BLOCOS_DO_CADASTRO,
  CHAVES_OBRIGATORIAS,
  contratoDaPlanilha,
  lerSituacaoDasUnidades,
} from "@workspace/remuneracao";
import { linhasDoCustoFixo } from "@workspace/fechamento";

import { cadastroDaRemuneracao } from "../lib/cadastro-da-remuneracao";

/**
 * O CADASTRO À MÃO — `SEM LASTRO` não é `SEM CADASTRO`.
 *
 * **A confusão que este arquivo desfaz.** Uma unidade cadastrada à mão, sem
 * export nenhum importado, aparece na lista de Remuneração com o selo vermelho
 * `SEM LASTRO` e `0 de 30 linhas com lastro`. Lido de fora, isso parece dizer
 * que o cadastro não existe — e a leitura seguinte, natural, é que o devido não
 * sai por falta dele. As duas são falsas, e a distância entre elas é o assunto
 * daqui.
 *
 * São três perguntas independentes, e o produto responde cada uma num lugar:
 *
 * 1. **o cadastro existe?** — `remuneracao_unidade` mais a aba digitada em
 *    `remuneracao_planilha`. É o que a tela de Remuneração lista;
 * 2. **o cadastro tem lastro documental?** — `medirSituacao`, que conta só o
 *    que o **acervo** sustenta e deixa o digitado de fora de propósito. É o
 *    número do selo;
 * 3. **o cadastro basta para calcular o devido?** — `contratoDaPlanilha`, que
 *    lê a aba digitada e só ela. É a terceira porta de `cadastroDaRemuneracao`.
 *
 * A (3) não consulta a (2). O contrato sai de `lerPlanilha` — do que alguém
 * digitou —, e nenhum ponto do caminho pergunta se o acervo sustenta aquilo.
 * Um cadastro à mão inteiramente sem lastro produz devido ao centavo, e é o que
 * os casos abaixo prendem: se alguém acoplar proveniência a capacidade de
 * calcular, é aqui que quebra.
 *
 * Reproduz o caso real do CDD Belém em julho/2026: unidade cadastrada à mão,
 * duas quinzenas com aba própria, 29 das 30 linhas informadas, nenhum export.
 */

const ADMIN =
  process.env.TEST_ADMIN_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres@/postgres?host=/tmp/pgsock&port=5433";

const NOME_DO_BANCO = `fc_cadastro_a_mao_${process.pid}`;

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
const CNPJ = "11177288000190";
const ESCOPO = "escopo-belem-a-mao";

/**
 * A aba digitada — 29 das 30 linhas, como a tela do caso real mostra.
 *
 * As vinte obrigatórias, a opcional `marketing_sem_impostos` e as oito
 * calculadas. Fora fica `ativo_lucro_operacional`, que é a segunda opcional e
 * está em branco na `.xlsb` de julho/2026 — 30 menos uma dá as `29 de 30` que a
 * tela conta.
 *
 * As calculadas entram porque quem transcreve a aba inteira as digita: o motor
 * as refaz e usa o digitado como **conferência**, não como entrada.
 */
const ABA: [string, number][] = [
  /* ALÍQUOTAS — as quatro, obrigatórias. */
  ["aliquota_pis", 0.65],
  ["aliquota_cofins", 8.6],
  ["aliquota_icms", 17.84],
  ["aliquota_iss", 5.9],
  /* FROTA FIXA — duas obrigatórias e a soma, calculada. */
  ["frota_fixa_ativos", 56],
  ["frota_fixa_inativos", 8],
  ["frota_fixa_operacao", 64],
  /* ATIVOS. */
  ["ativo_remuneracao_fixa_frota", 1424.91],
  ["ativo_remuneracao_fixa_equipe", 8919.38],
  ["ativo_custo_variavel", 5176.53],
  ["ativo_remuneracao_fixa_qlp", 4427.53],
  ["ativo_outras_despesas", 4361.07],
  /* `ativo_lucro_operacional` — a linha em branco. */
  ["ativo_total_sem_imposto", 24309.42],
  /* INATIVOS. */
  ["inativo_remuneracao_fixa", 1650.97],
  /* VANS. */
  ["van_quantidade_ativas", 7],
  ["van_custo_fixo", 4693.85],
  ["van_custo_equipe", 4250.45],
  ["van_total_com_impostos", 8944.3],
  ["van_quantidade_inativas", 6],
  ["van_remuneracao_inativas", 3195.18],
  /* NOTURNA. */
  ["noturna_quantidade_rotas", 1],
  ["noturna_custo_sem_impostos", 8697.88],
  ["noturna_custo_com_impostos", 11475.55],
  /* MARKETING — a opcional digitada como zero, e a calculada dela. */
  ["marketing_sem_impostos", 0],
  ["marketing_com_impostos", 0],
  /* ROTA e RESUMO. */
  ["rota_percentual_iss", 3.16],
  ["rota_percentual_ctrc", 96.84],
  ["resumo_iss", 84.85],
  ["resumo_ctrc", 72.91],
];

/** A pergunta que o fechamento faz ao cadastro, por quinzena. */
function pergunta(quinzena: 1 | 2, unidadeId: string | null) {
  return {
    unidadeId,
    unidadeCodigo: "CDD Belém",
    transportadoraCodigo: "36",
    canal: "ROTA" as const,
    inicio: quinzena === 1 ? "2026-07-01" : "2026-07-16",
    fim: quinzena === 1 ? "2026-07-15" : "2026-07-31",
  };
}

describe.skipIf(!temBanco)("o cadastro à mão, sem lastro nenhum", () => {
  let fechar: () => Promise<void>;
  let db: Database;

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

    /*
      A unidade cadastrada à mão: identidade digitada, nenhum snapshot, nenhum
      export. É o "cadastrada à mão — sem export importado" da tela.
    */
    await db.insert(remuneracaoUnidadeTable).values({
      scopeHash: ESCOPO,
      scopeType: "UNIDADE",
      codigo: CNPJ_MASCARADO,
      nome: "CDD BELEM",
      canal: "ROTA",
      vigenciaInicial: "2026-07-01",
    });

    /* As duas abas do mês — cada quinzena com a sua, sem herança. */
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
  }, 180_000);

  afterAll(async () => {
    await fechar?.().catch(() => {});
    const admin = createDb(ADMIN);
    await admin.pool.query(`DROP DATABASE IF EXISTS "${NOME_DO_BANCO}"`).catch(() => {});
    await admin.pool.end().catch(() => {});
  });

  /* --- 1. o cadastro existe, e a tela o mede sem lastro ------------------ */

  it("a lista mostra as duas quinzenas: sem lastro, 29 de 30 informadas", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(db);
    const doEscopo = cadastros.filter((c) => c.scopeHash === ESCOPO);

    expect(doEscopo.map((c) => c.effectiveDate).sort()).toEqual(["2026-07-01", "2026-07-16"]);

    for (const c of doEscopo) {
      /* Sem lastro documental: o acervo não sustenta nenhuma linha. */
      expect(c.cadastro.estado).toBe("SEM_LASTRO");
      expect(c.cadastro.comLastro).toBe(0);
      expect(c.cadastro.linhas).toBe(30);
      /*
        E o denominador honesto do lastro é onze, não trinta: as outras
        dezenove não esperam arquivo nenhum. Ver `procedencia-das-linhas`.
      */
      expect(c.cadastro.verificaveis).toBe(11);
      /* E, ao lado dele, as 29 que alguém digitou. */
      expect(c.cadastro.informadas).toBe(29);
      /*
        **O indicador que a tela precisava ter.** Vinte de vinte obrigatórias:
        este cadastro calcula o devido, e a única linha em branco é opcional —
        a planilha a soma como zero, e isso é premissa, não falta.
      */
      expect(c.cadastro.obrigatoriasInformadas).toBe(20);
      expect(c.cadastro.obrigatorias).toBe(20);
      expect(c.cadastro.suficienteParaCalcular).toBe(true);
      expect(c.cadastro.opcionaisAssumidasComoZero).toBe(1);
      /* As duas metades que o acervo mediria — nenhuma entregue. */
      expect(c.cadastro.frota).toBe(false);
      expect(c.cadastro.aliquotas).toBe(false);
      expect(c.registradaAMao).toBe(true);
    }
  });

  /**
   * O RÓTULO QUE MENTE — "conferem com o acervo" sem acervo nenhum.
   *
   * A mesma linha da tela diz `0 de 30` com lastro e `N conferem com o acervo`.
   * Os dois não podem ser verdade ao mesmo tempo, e o que está errado é o
   * segundo: a conferência é entre a linha **calculada a partir do que foi
   * digitado** e o total **também digitado** — duas leituras da mesma aba, sem
   * acervo em nenhuma das pontas.
   */
  it("as conferências existem sem acervo — é a aba conferindo consigo mesma", async () => {
    const { cadastros } = await lerSituacaoDasUnidades(db);
    const primeira = cadastros.find(
      (c) => c.scopeHash === ESCOPO && c.effectiveDate === "2026-07-01",
    )!;

    expect(primeira.cadastro.comLastro).toBe(0);
    expect(primeira.cadastro.conferidas).toBe(2);

    /*
      E agora elas têm nome. Duas conferências, nenhuma com o acervo: são
      `resumo_iss` e `resumo_ctrc`, calculadas sobre alíquotas informadas e
      confrontadas com o percentual também informado. A tela dizia "2 conferem
      com o acervo" sobre exatamente isto, ao lado de "0 de 30 com lastro".
    */
    expect(primeira.cadastro.conferenciasComAcervo).toBe(0);
    expect(primeira.cadastro.conferenciasInternas).toBe(2);
    expect(primeira.cadastro.divergenciasComAcervo).toBe(0);
  });

  /* --- 2. a porta, e as duas identidades -------------------------------- */

  it("sem identidade, as duas quinzenas param na primeira porta", async () => {
    const porta = cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" });

    for (const quinzena of [1, 2] as const) {
      const { resposta, diagnostico } = await porta.resolver(pergunta(quinzena, null));
      expect(diagnostico.estado).toBe("UNIDADE_NAO_ENCONTRADA");
      expect(resposta).toBeNull();
      /* A vigência nem chega a ser perguntada — a porta parou antes. */
      expect(diagnostico.vigencia).toBeNull();
      /* E o que a tela mostra é a diferença entre os dois textos. */
      expect(diagnostico.unidade.codigosCadastrados).toEqual([CNPJ_MASCARADO]);
    }
  });

  it("com identidade nas duas pontas, as duas quinzenas respondem", async () => {
    const u = await cadastrarUnidade(db, { nome: "CDD BELEM", cnpj: CNPJ_MASCARADO });
    await db
      .update(remuneracaoUnidadeTable)
      .set({ unidadeId: u.id })
      .where(eq(remuneracaoUnidadeTable.scopeHash, ESCOPO));
    expect(u.cnpj).toBe(CNPJ);

    const porta = cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" });

    const primeira = await porta.resolver(pergunta(1, u.id));
    const segunda = await porta.resolver(pergunta(2, u.id));

    expect(primeira.diagnostico.estado).toBe("RESPONDEU");
    expect(segunda.diagnostico.estado).toBe("RESPONDEU");

    /* Cada quinzena pela sua aba — a herança entre metades não existe mais. */
    expect(primeira.resposta?.vigenteDe).toBe("2026-07-01");
    expect(segunda.resposta?.vigenteDe).toBe("2026-07-16");

    /* A linha em branco é opcional: entra como zero, e é dita. */
    expect(primeira.diagnostico.contrato?.faltam).toEqual([]);
    expect(primeira.diagnostico.contrato?.assumidasComoZero.map((c) => c.chave)).toEqual([
      "ativo_lucro_operacional",
    ]);
  });

  /* --- 3. o devido sai de um cadastro sem lastro ------------------------- */

  it("o devido é calculado com 0 de 30 linhas de lastro", async () => {
    const porta = cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" });
    const { cadastros } = await lerSituacaoDasUnidades(db);
    const situacao = cadastros.find(
      (c) => c.scopeHash === ESCOPO && c.effectiveDate === "2026-07-16",
    )!;
    /* A unidade é a do caso anterior — o cadastro mestre recusa uma segunda. */
    const [cadastro] = await db
      .select()
      .from(remuneracaoUnidadeTable)
      .where(eq(remuneracaoUnidadeTable.scopeHash, ESCOPO));

    const { resposta } = await porta.resolver(pergunta(2, cadastro!.unidadeId));
    expect(resposta).not.toBeNull();

    const linhas = linhasDoCustoFixo(resposta!.parametros);
    const padronizado = linhas.find((l) => l.chave === "custo_fixo_padronizado")!;

    /* O número existe, e a unidade não tem uma linha de lastro sequer. */
    expect(situacao.cadastro.comLastro).toBe(0);
    expect(padronizado.valor).not.toBeNull();
    expect(padronizado.valor).toBeGreaterThan(0);
    expect(padronizado.memoria).toContain("56 veículos ativos");
  });

  /* --- 4. o que de fato trava o contrato --------------------------------- */

  /**
   * A MATRIZ DAS TRINTA — qual linha em branco trava, e qual não.
   *
   * `29 de 30` só é um problema quando a que falta é uma das vinte
   * obrigatórias. As oito calculadas o motor refaz; as duas opcionais entram
   * como zero. É a diferença entre "faltou digitar" e "falta o que o contrato
   * lê".
   */
  it("das trinta linhas, só as vinte obrigatórias travam o contrato", () => {
    const todas = BLOCOS_DO_CADASTRO.flatMap((b) => b.linhas.map((l) => l.chave));
    expect(todas).toHaveLength(30);

    const travam = todas.filter((ausente) => {
      const valores = new Map(ABA.filter(([c]) => c !== ausente));
      return contratoDaPlanilha(valores).contrato === null;
    });

    expect(travam.sort()).toEqual([...CHAVES_OBRIGATORIAS].sort());
    expect(travam).toHaveLength(20);
  });
});
