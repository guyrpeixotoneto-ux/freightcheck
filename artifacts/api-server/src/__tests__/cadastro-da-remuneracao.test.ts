import { describe, expect, it } from "vitest";
import type { Database } from "@workspace/db";
import { comoDestravar } from "@workspace/fechamento";
import { CHAVES_OBRIGATORIAS, linhaDoCadastro } from "@workspace/remuneracao";

import { cadastroDaRemuneracao } from "../lib/cadastro-da-remuneracao";

/**
 * A porta do cadastro, do lado da borda — com o banco fingido.
 *
 * O que se prova aqui não é aritmética: são **as três portas** que separam uma
 * competência do seu contrato — achar a unidade pelo código, achar a vigência
 * que responde pela quinzena, montar o contrato com as obrigatórias da aba. A
 * conta está provada duas vezes noutro lugar: a tradução em
 * `@workspace/remuneracao` (`contrato.test.ts`) e o motor em
 * `@workspace/fechamento` (`mapa-rota.test.ts`, contra a `.xlsb` real).
 *
 * O banco é fingido de propósito. Um Postgres aqui provaria que o `SELECT`
 * compila, e não provaria nenhuma das decisões abaixo; e o teste que precisa de
 * banco é o que ninguém roda na máquina antes de mandar o commit. O fingimento
 * é honesto onde importa: as três faixas de casamento de código são reproduzidas
 * em JavaScript com a mesma regra que o SQL aplica, e a que erra a regra erra o
 * teste junto.
 */

/** Uma aba completa de julho/2026, como a tela a guarda (percentual em pontos). */
const ABA = new Map<string, number>([
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
  ["marketing_sem_impostos", 0],
]);

/**
 * O texto e os parâmetros de uma consulta do drizzle, separados.
 *
 * A forma é a que o drizzle monta: cada pedaço literal do template é um
 * `StringChunk` — um objeto com `value: string[]` —, e cada interpolação entra
 * **crua**, como o valor que ela é. Um `sql` aninhado traz o `queryChunks` dele.
 *
 * A separação existe porque o banco fingido precisa saber **quem** chamou e
 * **com o quê**: as três consultas de unidade têm textos diferentes e o mesmo
 * papel, e sem o parâmetro nenhuma delas sabe qual código procurar.
 */
function partesDa(query: unknown): { texto: string; valores: unknown[] } {
  const texto: string[] = [];
  const valores: unknown[] = [];
  const visitar = (pedacos: unknown) => {
    if (!Array.isArray(pedacos)) return;
    for (const pedaco of pedacos) {
      if (pedaco != null && typeof pedaco === "object") {
        const registro = pedaco as Record<string, unknown>;
        if (Array.isArray(registro.queryChunks)) visitar(registro.queryChunks);
        else if (Array.isArray(registro.value)) texto.push(...(registro.value as string[]));
        continue;
      }
      /* O que não é objeto é interpolação — o parâmetro da consulta. */
      valores.push(pedaco);
    }
  };
  visitar((query as { queryChunks?: unknown }).queryChunks);
  return { texto: texto.join(" "), valores };
}

/** Uma unidade registrada no cadastro, como `remuneracao_unidade` a guarda. */
interface UnidadeRegistrada {
  scopeHash: string;
  canal: string;
  codigo: string;
  /** A unidade canônica que este cadastro descreve, quando já foi associada. */
  unidadeId?: string;
}

const SO_DIGITOS = (t: string) => t.replace(/\D/g, "");

/**
 * Um banco com unidades registradas e as abas de `porVigencia`.
 *
 * `unidades: []` é o cadastro em que ninguém registrou nada — o estado de toda
 * instalação antes de alguém abrir a tela.
 */
function bancoCom(opcoes: {
  unidades?: UnidadeRegistrada[];
  porVigencia: Record<string, ReadonlyMap<string, number>>;
  /** As abas de uma unidade específica, quando há mais de uma registrada. */
  scopeHashDaPlanilha?: string;
}): Database {
  const unidades = opcoes.unidades ?? [{ scopeHash: "sh1", canal: "", codigo: "0443" }];
  const daPlanilha = opcoes.scopeHashDaPlanilha ?? unidades[0]?.scopeHash ?? "sh1";
  const canalDaPlanilha = unidades.find((u) => u.scopeHash === daPlanilha)?.canal ?? "";

  const comoLinha = (u: UnidadeRegistrada) => ({
    scope_hash: u.scopeHash,
    canal: u.canal,
    codigo: u.codigo,
  });

  return {
    async execute(query: unknown) {
      const { texto, valores } = partesDa(query);
      const procurado = String(valores[0] ?? "");

      if (texto.includes("count(*)")) return { rows: [{ total: unidades.length }] };
      if (texto.includes("WHERE u.unidade_id =")) {
        return {
          rows: unidades.filter((u) => u.unidadeId === procurado).map(comoLinha),
        };
      }
      if (texto.includes("SELECT DISTINCT u.codigo")) {
        return {
          rows: [...new Set(unidades.map((u) => u.codigo).filter((c) => c.trim() !== ""))]
            .sort()
            .map((codigo) => ({ codigo })),
        };
      }

      /* As três faixas, com a mesma regra do SQL — ver `resolverUnidade`. */
      if (texto.includes("WHERE u.codigo =")) {
        return { rows: unidades.filter((u) => u.codigo === procurado && u.codigo.trim() !== "").map(comoLinha) };
      }
      if (texto.includes("WHERE btrim(u.codigo) =")) {
        return { rows: unidades.filter((u) => u.codigo.trim() === procurado && u.codigo.trim() !== "").map(comoLinha) };
      }
      if (texto.includes("lpad(regexp_replace")) {
        const alvo = SO_DIGITOS(procurado).padStart(14, "0");
        return {
          rows: unidades
            .filter((u) => SO_DIGITOS(u.codigo) !== "" && SO_DIGITOS(u.codigo).padStart(14, "0") === alvo)
            .map(comoLinha),
        };
      }
      if (texto.includes("DISTINCT")) {
        return { rows: Object.keys(opcoes.porVigencia).sort().map((d) => ({ effective_date: d })) };
      }
      /* O que sobra é a leitura da aba, em `lerPlanilhasEmLote`. */
      const rows = Object.entries(opcoes.porVigencia).flatMap(([data, valores2]) =>
        [...valores2].map(([chave, valor]) => ({
          scope_hash: daPlanilha,
          canal: canalDaPlanilha,
          effective_date: data,
          chave,
          valor: String(valor),
          observacao: null,
          autor_nome: null,
          atualizada_em: new Date("2026-07-20T12:00:00Z"),
        })),
      );
      return { rows };
    },
  } as unknown as Database;
}

const PRIMEIRA = { canal: "ROTA" as const, inicio: "2026-07-01", fim: "2026-07-15" };
const SEGUNDA = { canal: "ROTA" as const, inicio: "2026-07-16", fim: "2026-07-31" };
/*
  A competência histórica: só o texto legado, sem identidade canônica. É o
  estado de toda competência aberta antes da `0049`, e o que faz as três faixas
  de casamento por texto continuarem existindo.
*/
const UNIDADE = { unidadeId: null, unidadeCodigo: "0443", transportadoraCodigo: "36" };

const porta = (db: Database) => cadastroDaRemuneracao(db, { tipoDeOperacao: "ROTA" });

/* =========================================================================
 * Porta 2 — a vigência que responde pela quinzena
 * ====================================================================== */

describe("a vigência que responde", () => {
  it("uma aba na 1ª quinzena responde também pela 2ª, e diz de onde veio", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });

    const primeira = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });
    const segunda = await porta(db).resolver({ ...UNIDADE, ...SEGUNDA });

    expect(primeira.resposta?.vigenteDe).toBe("2026-07-01");
    expect(segunda.resposta?.vigenteDe).toBe("2026-07-01");
    /* Mesma aba, mesma identidade — é por ela que a tela diz que é uma só. */
    expect(segunda.resposta?.cadastroId).toBe(primeira.resposta?.cadastroId);
    expect(segunda.resposta?.parametros.frotaFixaAtiva).toBe(56);
  });

  it("a vigência da própria quinzena responde sem herança, e o diagnóstico diz", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA, "2026-07-16": ABA } });
    const { diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(diagnostico.estado).toBe("RESPONDEU");
    expect(diagnostico.vigencia?.vigenteDe).toBe("2026-07-01");
    expect(diagnostico.vigencia?.herdadaDaOutraQuinzena).toBe(false);
  });

  it("a herança da quinzena irmã aparece marcada, não silenciosa", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-16": ABA } });
    const { diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(diagnostico.estado).toBe("RESPONDEU");
    expect(diagnostico.vigencia?.vigenteDe).toBe("2026-07-16");
    expect(diagnostico.vigencia?.herdadaDaOutraQuinzena).toBe(true);
  });

  it("duas abas cadastradas: cada quinzena usa a sua", async () => {
    const segundaAba = new Map(ABA).set("frota_fixa_ativos", 60);
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA, "2026-07-16": segundaAba } });

    const primeira = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });
    const segunda = await porta(db).resolver({ ...UNIDADE, ...SEGUNDA });

    expect(primeira.resposta?.vigenteDe).toBe("2026-07-01");
    expect(primeira.resposta?.parametros.frotaFixaAtiva).toBe(56);
    expect(segunda.resposta?.vigenteDe).toBe("2026-07-16");
    expect(segunda.resposta?.parametros.frotaFixaAtiva).toBe(60);
    expect(segunda.resposta?.cadastroId).not.toBe(primeira.resposta?.cadastroId);
  });

  it("a herança não atravessa o mês: junho não responde por julho, e a tela diz o que existe", async () => {
    const db = bancoCom({ porVigencia: { "2026-06-01": ABA, "2026-06-16": ABA } });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).toBeNull();
    expect(diagnostico.estado).toBe("SEM_VIGENCIA");
    /* A distinção que faltava: não é "você não digitou", é "digitou noutro mês". */
    expect(diagnostico.vigencia?.doMes).toEqual([]);
    expect(diagnostico.vigencia?.todas).toEqual(["2026-06-01", "2026-06-16"]);
    expect(comoDestravar(diagnostico)?.problema).toContain("2026-06-01");
  });

  it("unidade cadastrada e nenhuma aba digitada é outro texto", async () => {
    const db = bancoCom({ porVigencia: {} });
    const { diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(diagnostico.estado).toBe("SEM_VIGENCIA");
    expect(diagnostico.vigencia?.todas).toEqual([]);
    expect(comoDestravar(diagnostico)?.conserto).toContain("digite a aba");
  });

  it("converte o percentual de pontos para fração — 17,84 % vira 0,1784", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });
    const { resposta } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta?.parametros.aliquotas.icms).toBeCloseTo(0.1784, 10);
    expect(resposta?.parametros.parcelaDentroDoMunicipio).toBeCloseTo(0.0316, 10);
    expect(resposta?.custoVariavelPrevistoPor25Viagens).toBe(5176.53);
  });
});

/* =========================================================================
 * Porta 1 — a unidade, e o código que a encontra
 * ====================================================================== */

describe("o código que encontra a unidade", () => {
  it("unidade sem cadastro registrado não responde com o contrato de outra", async () => {
    const db = bancoCom({ unidades: [], porVigencia: { "2026-07-01": ABA } });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).toBeNull();
    expect(diagnostico.estado).toBe("UNIDADE_NAO_ENCONTRADA");
    expect(diagnostico.unidade.cadastradas).toBe(0);
    /* Parou na primeira porta: não se avalia o que não se chegou a perguntar. */
    expect(diagnostico.vigencia).toBeNull();
    expect(diagnostico.contrato).toBeNull();
  });

  it("o código com outro valor não casa — nada aqui adivinha pelo nome", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "sh1", canal: "", codigo: "0444" }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });
    expect(diagnostico.estado).toBe("UNIDADE_NAO_ENCONTRADA");
    expect(diagnostico.unidade.cadastradas).toBe(1);
  });

  /**
   * O conserto do ponto de confusão: os **dois** lados na mesma frase.
   *
   * Antes a tela dizia "nenhuma das N unidades responde por X" — o que se
   * procurou, sem o que existe. A pergunta seguinte era sempre "então qual é o
   * código certo?", e nada respondia. Com os dois textos à vista não há regra a
   * decorar: eles precisam ser iguais.
   */
  it("mostra o que está cadastrado, e não só o que procurou", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "sh1", canal: "", codigo: "12.345.678/0001-99" }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      unidadeCodigo: "CDD Belém",
      ...PRIMEIRA,
    });

    expect(diagnostico.unidade.codigosCadastrados).toEqual(["12.345.678/0001-99"]);
    const destrava = comoDestravar(diagnostico)!;
    /* Os dois lados, nomeados, na mesma frase. */
    expect(destrava.problema).toContain("CDD Belém");
    expect(destrava.problema).toContain("12.345.678/0001-99");
    expect(destrava.conserto).toContain("precisam ser iguais");
  });

  it("a unidade cadastrada sem código não entra na lista de códigos", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "sh1", canal: "", codigo: "" }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      unidadeCodigo: "CDD Belém",
      ...PRIMEIRA,
    });

    expect(diagnostico.unidade.codigosCadastrados).toEqual([]);
    /* E a frase muda: não é "existe outro", é "não tem nenhum". */
    expect(comoDestravar(diagnostico)!.problema).toContain("nenhuma das 1 unidades");
  });

  /**
   * O defeito que o usuário apontou: a tela dizia "existe" e o backend não achava.
   */
  it("espaço sobrando no cadastro não impede o encontro, e a tela vê que foi por espaço", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "sh1", canal: "", codigo: " 0443 " }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).not.toBeNull();
    expect(diagnostico.unidade.comoCasou).toBe("ESPACO");
    /* O código do cadastro chega à tela como ele **é**, para alguém arrumá-lo. */
    expect(diagnostico.unidade.codigoNoCadastro).toBe(" 0443 ");
  });

  it("espaço sobrando na competência também não impede", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });
    const { resposta, diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      unidadeCodigo: "  0443  ",
      ...PRIMEIRA,
    });

    expect(resposta).not.toBeNull();
    expect(diagnostico.unidade.comoCasou).toBe("ESPACO");
  });

  it("o casamento exato tem precedência sobre o aproximado", async () => {
    const db = bancoCom({
      unidades: [
        { scopeHash: "aparada", canal: "", codigo: " 0443 " },
        { scopeHash: "exata", canal: "", codigo: "0443" },
      ],
      scopeHashDaPlanilha: "exata",
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(diagnostico.unidade.comoCasou).toBe("EXATO");
    expect(resposta?.cadastroId).toContain("exata");
  });

  it("o mesmo CNPJ com máscara e sem casa pela identidade canônica", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "sh1", canal: "", codigo: "12.345.678/0001-99" }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      unidadeCodigo: "12345678000199",
      ...PRIMEIRA,
    });

    expect(resposta).not.toBeNull();
    expect(diagnostico.unidade.comoCasou).toBe("DOCUMENTO");
  });

  /**
   * A razão de a identidade canônica **não** ser o critério único.
   *
   * `normalizeDocumento("CDD Belém")` é `""`, e `""` casaria com todo código sem
   * dígito do cadastro. É o caso da unidade da tela que originou este trabalho.
   */
  it("um código sem dígito nenhum não entra na faixa do documento", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "outra", canal: "", codigo: "CDD Ananindeua" }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      unidadeCodigo: "CDD Belém",
      ...PRIMEIRA,
    });

    expect(resposta).toBeNull();
    expect(diagnostico.estado).toBe("UNIDADE_NAO_ENCONTRADA");
  });

  it("dois cadastros com o mesmo código recusam, em vez de a primeira responder", async () => {
    const db = bancoCom({
      unidades: [
        { scopeHash: "sh1", canal: "", codigo: "0443" },
        { scopeHash: "sh2", canal: "", codigo: "0443" },
      ],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).toBeNull();
    expect(diagnostico.estado).toBe("UNIDADE_AMBIGUA");
    expect(diagnostico.unidade.candidatas).toBe(2);
    expect(comoDestravar(diagnostico)?.conserto).toContain("deixe uma só");
  });

  it("a mesma unidade com série de canal e sem canal não é ambiguidade", async () => {
    const db = bancoCom({
      unidades: [
        { scopeHash: "sh1", canal: "ROTA", codigo: "0443" },
        { scopeHash: "sh1", canal: "", codigo: "0443" },
      ],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(diagnostico.estado).toBe("RESPONDEU");
    expect(resposta).not.toBeNull();
  });

  it("o AS não é respondido com os parâmetros da Rota, e diz que é o canal", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });
    const { resposta, diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      ...PRIMEIRA,
      canal: "AS",
    });

    expect(resposta).toBeNull();
    expect(diagnostico.estado).toBe("CANAL_SEM_CONTRATO");
  });
});

/* =========================================================================
 * Porta 3 — o contrato completo
 * ====================================================================== */

/* =========================================================================
 * Porta 1, por identidade — o casamento que não compara texto
 * ====================================================================== */

/**
 * A faixa que aposenta as outras três.
 *
 * Quando a competência e o cadastro apontam para a mesma `unidade.id`, não há o
 * que casar: é a mesma linha da tabela `unidade`. Nenhuma grafia, máscara ou
 * espaço pode desalinhá-los — e nenhum texto parecido pode alinhá-los por
 * engano, que é o defeito oposto e o mais caro dos dois.
 */
describe("a identidade canônica", () => {
  const UNIDADE_ID = "11111111-1111-1111-1111-111111111111";
  const OUTRA_ID = "22222222-2222-2222-2222-222222222222";

  it("encontra o cadastro pela unidade, ignorando o texto dos dois lados", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "sh1", canal: "", codigo: "12.345.678/0001-99", unidadeId: UNIDADE_ID }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      /* O texto legado é um nome, e não importa mais. */
      unidadeCodigo: "CDD Belém",
      unidadeId: UNIDADE_ID,
      ...PRIMEIRA,
    });

    expect(resposta).not.toBeNull();
    expect(diagnostico.estado).toBe("RESPONDEU");
    expect(diagnostico.unidade.comoCasou).toBe("IDENTIDADE");
  });

  /**
   * A guarda que impede o defeito oposto: com identidade, **não** se cai no
   * texto. Cair reabriria a porta que a identidade fecha — a competência aponta
   * para a unidade A, o texto casa com o cadastro da unidade B, e o contrato
   * errado responde por um fechamento que ninguém conferiu.
   */
  it("com identidade e sem cadastro para ela, não cai no casamento por texto", async () => {
    const db = bancoCom({
      unidades: [
        /* Este cadastro casaria pelo texto — e é de **outra** unidade. */
        { scopeHash: "sh1", canal: "", codigo: "0443", unidadeId: OUTRA_ID },
      ],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({
      ...UNIDADE,
      unidadeCodigo: "0443",
      unidadeId: UNIDADE_ID,
      ...PRIMEIRA,
    });

    expect(resposta).toBeNull();
    expect(diagnostico.estado).toBe("UNIDADE_NAO_ENCONTRADA");
  });

  it("sem identidade, as três faixas de texto continuam servindo o histórico", async () => {
    const db = bancoCom({
      unidades: [{ scopeHash: "sh1", canal: "", codigo: " 0443 " }],
      porVigencia: { "2026-07-01": ABA },
    });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).not.toBeNull();
    expect(diagnostico.unidade.comoCasou).toBe("ESPACO");
  });
});

describe("o contrato completo", () => {
  it("a aba inteira responde, e o diagnóstico não tem nada faltando", async () => {
    const db = bancoCom({ porVigencia: { "2026-07-01": ABA } });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).not.toBeNull();
    expect(diagnostico.estado).toBe("RESPONDEU");
    expect(diagnostico.contrato?.faltam).toEqual([]);
    expect(comoDestravar(diagnostico)).toBeNull();
  });

  it("a opcional não digitada entra como zero — e isso é dito, não escondido", async () => {
    const semMarketing = new Map(ABA);
    semMarketing.delete("marketing_sem_impostos");
    const db = bancoCom({ porVigencia: { "2026-07-01": semMarketing } });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).not.toBeNull();
    expect(diagnostico.contrato?.assumidasComoZero.map((c) => c.chave)).toContain(
      "marketing_sem_impostos",
    );
  });

  /**
   * Cada obrigatória, uma por uma.
   *
   * Não é zelo: é o teste que impede uma chave nova de entrar em
   * `CHAVES_OBRIGATORIAS` sem que a tela saiba nomeá-la. Antes, faltar qualquer
   * uma das vinte produzia exatamente a mesma tela vazia.
   */
  it.each(CHAVES_OBRIGATORIAS)("faltando `%s`, o diagnóstico nomeia a linha", async (chave) => {
    const faltando = new Map(ABA);
    faltando.delete(chave);
    const db = bancoCom({ porVigencia: { "2026-07-01": faltando } });
    const { resposta, diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(resposta).toBeNull();
    expect(diagnostico.estado).toBe("CONTRATO_INCOMPLETO");
    expect(diagnostico.contrato?.faltam.map((f) => f.chave)).toEqual([chave]);
    /* O rótulo é o da tela de cadastro, e não a chave técnica. */
    expect(diagnostico.contrato?.faltam[0]?.rotulo).toBe(linhaDoCadastro(chave)?.rotulo);
    expect(comoDestravar(diagnostico)?.problema).toContain(linhaDoCadastro(chave)!.rotulo);
  });

  it("faltando várias, todas são nomeadas — não só a primeira", async () => {
    const faltando = new Map(ABA);
    faltando.delete("van_custo_fixo");
    faltando.delete("aliquota_icms");
    const db = bancoCom({ porVigencia: { "2026-07-01": faltando } });
    const { diagnostico } = await porta(db).resolver({ ...UNIDADE, ...PRIMEIRA });

    expect(diagnostico.contrato?.faltam.map((f) => f.chave).sort()).toEqual([
      "aliquota_icms",
      "van_custo_fixo",
    ]);
    /* A porta anterior abriu, e o diagnóstico mostra por qual aba ele passou. */
    expect(diagnostico.vigencia?.vigenteDe).toBe("2026-07-01");
  });
});
