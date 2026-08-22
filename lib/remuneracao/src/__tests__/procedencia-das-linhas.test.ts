import { describe, expect, it } from "vitest";
import {
  BLOCOS_DO_CADASTRO,
  documentoQueSustenta,
  LINHAS_DO_CADASTRO,
  LINHAS_VERIFICAVEIS_NO_ACERVO,
  procedenciaPossivel,
  type ProcedenciaPossivel,
} from "../catalogo";
import { CHAVES_DO_CONTRATO, CHAVES_OBRIGATORIAS, CHAVES_OPCIONAIS } from "../contrato";

/**
 * AS TRINTA LINHAS, UMA A UMA — a prova antes de trocar o denominador.
 *
 * A tela dizia `0 de 30 linhas com lastro`, e quem lia entendia que faltavam
 * trinta arquivos. Trocar 30 por 11 porque "fica melhor" seria substituir um
 * número errado por outro sem justificativa. Este arquivo é a justificativa: as
 * trinta linhas classificadas por escrito, com o teste a recusar qualquer
 * mudança silenciosa.
 *
 * Duas classificações independentes, e confundi-las é o defeito que este
 * produto vinha cometendo:
 *
 * - **procedência possível** — o que pode comprovar a linha. É sobre
 *   auditoria, e é o denominador do lastro;
 * - **papel no contrato** — se o motor do devido lê a linha, e se ela trava o
 *   cálculo faltando. É sobre capacidade de calcular.
 *
 * Uma linha pode ser calculada pelo motor e verificável no acervo ao mesmo
 * tempo (`frota_fixa_operacao`), ou obrigatória para o contrato e impossível de
 * comprovar por documento (as treze linhas de preço dos blocos ATIVOS,
 * INATIVOS, VANS e NOTURNA). Não há hierarquia entre as duas perguntas.
 */

/** A classificação declarada — linha a linha, na ordem da planilha. */
const ESPERADO: Record<string, ProcedenciaPossivel> = {
  /* ALÍQUOTAS — o export de frete declara o imposto de cada trecho. */
  aliquota_pis: "DOCUMENTO",
  aliquota_cofins: "DOCUMENTO",
  aliquota_icms: "DOCUMENTO",
  aliquota_iss: "DOCUMENTO",

  /* FROTA FIXA — o export de equipamento conta os cavalos. */
  frota_fixa_ativos: "DOCUMENTO",
  frota_fixa_inativos: "DOCUMENTO",
  frota_fixa_operacao: "DOCUMENTO",

  /* ATIVOS — preço contratado. Nenhum arquivo do acervo diz quanto vale. */
  ativo_remuneracao_fixa_frota: "SO_INFORMADA",
  ativo_remuneracao_fixa_equipe: "SO_INFORMADA",
  ativo_custo_variavel: "SO_INFORMADA",
  ativo_remuneracao_fixa_qlp: "SO_INFORMADA",
  ativo_outras_despesas: "SO_INFORMADA",
  ativo_lucro_operacional: "SO_INFORMADA",
  ativo_total_sem_imposto: "DERIVADA_DO_CADASTRO",

  /* INATIVOS. */
  inativo_remuneracao_fixa: "SO_INFORMADA",

  /* VANS — o export de equipamento não distingue van de cavalo. */
  van_quantidade_ativas: "SO_INFORMADA",
  van_custo_fixo: "SO_INFORMADA",
  van_custo_equipe: "SO_INFORMADA",
  van_total_com_impostos: "SO_INFORMADA",
  van_quantidade_inativas: "SO_INFORMADA",
  van_remuneracao_inativas: "SO_INFORMADA",

  /* NOTURNA. */
  noturna_quantidade_rotas: "SO_INFORMADA",
  noturna_custo_sem_impostos: "SO_INFORMADA",
  noturna_custo_com_impostos: "SO_INFORMADA",

  /* MARKETING. */
  marketing_sem_impostos: "SO_INFORMADA",
  marketing_com_impostos: "SO_INFORMADA",

  /* ROTA — a proporção sai da série de trechos. */
  rota_percentual_iss: "DOCUMENTO",
  rota_percentual_ctrc: "DOCUMENTO",

  /* RESUMO — aritmética sobre as alíquotas acima, e herda a fonte delas. */
  resumo_iss: "DERIVADA_DE_DOCUMENTO",
  resumo_ctrc: "DERIVADA_DE_DOCUMENTO",
};

describe("a procedência possível de cada linha do cadastro", () => {
  it("as trinta estão classificadas, e nenhuma a mais", () => {
    expect(LINHAS_DO_CADASTRO).toHaveLength(30);
    expect(Object.keys(ESPERADO).sort()).toEqual(LINHAS_DO_CADASTRO.map((l) => l.chave).sort());
  });

  it("cada linha tem a procedência declarada aqui", () => {
    for (const linha of LINHAS_DO_CADASTRO) {
      expect(`${linha.chave}=${procedenciaPossivel(linha)}`).toBe(
        `${linha.chave}=${ESPERADO[linha.chave]}`,
      );
    }
  });

  /**
   * O DENOMINADOR DO LASTRO — onze, e a conta que dá onze.
   *
   * Nove com fonte documental independente (três de frota, quatro de alíquota,
   * duas de proporção) e duas que derivam delas. As duas derivadas entram
   * porque o lastro delas é real: com as alíquotas medidas pelo export,
   * `resumo_iss` é aritmética sobre número medido, e a montagem a marca como
   * apurada. É por isso que o denominador é onze e não nove — ele conta o que o
   * acervo **pode sustentar**, que é exatamente o que `comLastro` conta em cima.
   */
  it("onze linhas podem ter lastro do acervo — nove diretas e duas derivadas", () => {
    const porClasse = (classe: ProcedenciaPossivel) =>
      LINHAS_DO_CADASTRO.filter((l) => procedenciaPossivel(l) === classe).map((l) => l.chave);

    expect(porClasse("DOCUMENTO")).toHaveLength(9);
    expect(porClasse("DERIVADA_DE_DOCUMENTO")).toEqual(["resumo_iss", "resumo_ctrc"]);
    expect(porClasse("DERIVADA_DO_CADASTRO")).toEqual(["ativo_total_sem_imposto"]);
    expect(porClasse("SO_INFORMADA")).toHaveLength(18);

    expect(LINHAS_VERIFICAVEIS_NO_ACERVO).toHaveLength(11);
    /* E as dezenove restantes não esperam arquivo nenhum — nunca esperaram. */
    expect(30 - LINHAS_VERIFICAVEIS_NO_ACERVO.length).toBe(19);
  });

  it("cada linha de documento diz qual arquivo a mede", () => {
    const porDocumento = (doc: string) =>
      LINHAS_DO_CADASTRO.filter((l) => documentoQueSustenta(l) === doc).map((l) => l.chave);

    expect(porDocumento("EXPORT_DE_EQUIPAMENTO")).toEqual([
      "frota_fixa_ativos",
      "frota_fixa_inativos",
      "frota_fixa_operacao",
    ]);
    expect(porDocumento("SERIE_DE_TRECHOS")).toEqual([
      "aliquota_pis",
      "aliquota_cofins",
      "aliquota_icms",
      "aliquota_iss",
      "rota_percentual_iss",
      "rota_percentual_ctrc",
    ]);
    /* As derivadas não têm arquivo próprio, e dizer que têm seria mentir. */
    expect(documentoQueSustenta(LINHAS_DO_CADASTRO.find((l) => l.chave === "resumo_iss")!)).toBeNull();
  });
});

describe("o papel de cada linha no contrato — a outra pergunta", () => {
  it("vinte obrigatórias, duas opcionais e oito calculadas pelo motor", () => {
    expect(CHAVES_OBRIGATORIAS).toHaveLength(20);
    expect(CHAVES_OPCIONAIS.sort()).toEqual(["ativo_lucro_operacional", "marketing_sem_impostos"]);
    expect(30 - CHAVES_DO_CONTRATO.length).toBe(8);
  });

  /**
   * AS DUAS PERGUNTAS SE CRUZAM, E NÃO SE CONTÊM.
   *
   * `frota_fixa_operacao` é calculada pelo motor **e** medida pelo export: o
   * contrato não a lê, e o acervo a comprova. Treze das vinte obrigatórias são
   * o contrário: o contrato não sai sem elas, e documento nenhum as confirma —
   * são preço contratado, e preço não se mede num export.
   *
   * Quem tratar lastro como "quanto do cadastro está pronto" vai errar nas
   * duas pontas — e foi o que a tela vinha fazendo.
   */
  it("há linha calculada com fonte documental, e obrigatória sem nenhuma", () => {
    const operacao = LINHAS_DO_CADASTRO.find((l) => l.chave === "frota_fixa_operacao")!;
    expect(CHAVES_DO_CONTRATO).not.toContain("frota_fixa_operacao");
    expect(procedenciaPossivel(operacao)).toBe("DOCUMENTO");

    const semDocumento = CHAVES_OBRIGATORIAS.filter(
      (chave) =>
        procedenciaPossivel(LINHAS_DO_CADASTRO.find((l) => l.chave === chave)!) === "SO_INFORMADA",
    );
    expect(semDocumento).toHaveLength(13);
  });

  /* A classificação é do catálogo, e o catálogo é a mesma lista da tela. */
  it("nenhuma linha fica de fora dos blocos que a tela desenha", () => {
    expect(BLOCOS_DO_CADASTRO.flatMap((b) => b.linhas)).toHaveLength(30);
  });
});
