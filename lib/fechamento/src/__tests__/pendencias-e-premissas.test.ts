import { describe, expect, it } from "vitest";
import { aferir } from "../afericao";
import type { CadastroNaTela, CanalDoResumo, ResumoDoMes } from "../resumo";

/**
 * CADA PENDÊNCIA DIZ O QUE FALTA — e o que não falta não vira pendência.
 *
 * A caixa de pendências dizia a mesma frase para quatro situações diferentes:
 * *"Cadastro da 2ª quinzena — sem contrato não sai devido"*. É verdade nas
 * quatro e não serve em nenhuma. Quem não associou a unidade precisa de um
 * clique; quem tem a unidade e não tem a aba precisa abrir Remuneração; quem
 * tem a aba e deixou duas células em branco precisa saber **quais duas**.
 *
 * E havia o oposto: duas coisas verdadeiras que **não** são falta — a linha
 * opcional que a planilha soma como zero, e o devido que saiu de cadastro
 * digitado sem documento que o confirme. Postas na caixa âmbar viravam
 * cobrança; caladas, deixavam quem assina o fechamento sem saber o que assina.
 * Elas são `premissas`, e não bloqueiam a completude.
 */

/**
 * Um canal com painel comparado **vazio** — o mínimo que exercita a caixa.
 *
 * O painel precisa existir: sem ele a aferição inteira é `NAO_APLICAVEL` e a
 * pendência é outra (é `PorQueNaoTemDevido` quem fala). Vazio de linhas porque
 * o assunto aqui é a pendência do cadastro, e não a aritmética das parcelas —
 * essa está em `afericao.test.ts`, com o painel real.
 */
function canal(cadastro: CanalDoResumo["cadastro"]): CanalDoResumo {
  const VAZIO = { primeira: null, segunda: null, total: null };
  return {
    canal: "ROTA",
    blocos: [],
    descontos: [],
    emitido: VAZIO,
    conferido: VAZIO,
    semFonte: VAZIO,
    demonstrativo: VAZIO,
    diferenca: VAZIO,
    painel: null,
    semPainel: null,
    comparado: { quadros: [], fecho: null },
    cadastro,
  } as unknown as CanalDoResumo;
}

/** As duas quinzenas abertas, com todos os relatórios — só o cadastro varia. */
function quinzenas(estado: string | null = "APURADA"): ResumoDoMes["quinzenas"] {
  return ([1, 2] as const).map((n) => ({
    quinzena: n,
    competenciaId: `id-${n}`,
    chave: `2026-07-Q${n}`,
    estado,
    apurada: true,
    temDemonstrativo: true,
    fontes: [],
  })) as unknown as ResumoDoMes["quinzenas"];
}

const SUGESTAO = { id: "u-1", nome: "CDD BELEM", cnpj: "11177288000190" };

/** O diagnóstico de uma quinzena, como a porta do cadastro o devolve. */
function diagnostico(parcial: Partial<CadastroNaTela>): CadastroNaTela {
  return {
    estado: "RESPONDEU",
    unidade: {
      cadastradas: 1,
      codigoProcurado: "CDD Belém",
      codigosCadastrados: ["11.177.288/0001-90"],
      comoCasou: null,
      codigoNoCadastro: null,
      identidade: null,
      sugestoes: [],
    },
    vigencia: null,
    contrato: null,
    destrava: null,
    ...parcial,
  } as unknown as CadastroNaTela;
}

describe("a pendência de contrato diz qual porta fechou", () => {
  it("unidade não associada: a competência e as candidatas viajam com o aviso", () => {
    const afericao = aferir(
      canal({
        primeira: diagnostico({ estado: "RESPONDEU" }),
        segunda: diagnostico({
          estado: "UNIDADE_NAO_ENCONTRADA",
          unidade: { sugestoes: [SUGESTAO] } as never,
          destrava: { problema: "procura por CDD Belém", conserto: "associe a competência" },
        }),
      }),
      quinzenas(),
    );

    const [pendencia] = afericao.aferibilidade.segunda.semContrato;
    expect(pendencia?.estado).toBe("UNIDADE_NAO_ENCONTRADA");
    /*
      Os dois campos que faltavam para a caixa **agir** em vez de só descrever:
      sem eles o botão não tinha o que gravar nem o que oferecer.
    */
    expect(pendencia?.competenciaId).toBe("id-2");
    expect(pendencia?.sugestoes).toEqual([SUGESTAO]);
    expect(pendencia?.podeAssociar).toBe(true);
  });

  /**
   * A ENCERRADA NÃO GANHA BOTÃO — e a tela precisa saber disso antes de clicar.
   *
   * Associar faria o Resumo recalcular o devido de uma quinzena congelada, e o
   * servidor recusa. Oferecer o botão assim mesmo seria prometer um gesto que
   * termina em erro.
   */
  it("na quinzena encerrada, a associação é recusada de antemão", () => {
    const afericao = aferir(
      canal({
        primeira: null,
        segunda: diagnostico({
          estado: "UNIDADE_NAO_ENCONTRADA",
          unidade: { sugestoes: [SUGESTAO] } as never,
        }),
      }),
      quinzenas("ENCERRADA"),
    );

    expect(afericao.aferibilidade.segunda.semContrato[0]?.podeAssociar).toBe(false);
  });

  /**
   * `CONTRATO_INCOMPLETO` NOMEIA AS LINHAS.
   *
   * "Faltam 2 de 22" mandava abrir o cadastro e conferir vinte e duas células
   * uma a uma. Quem lê procura o rótulo impresso na aba.
   */
  it("contrato incompleto: as linhas que faltam vêm pelo rótulo", () => {
    const faltam = [
      { chave: "van_custo_fixo", rotulo: "Custo Fixo" },
      { chave: "noturna_quantidade_rotas", rotulo: "Quantidade de Rotas" },
    ];
    const afericao = aferir(
      canal({
        primeira: diagnostico({
          estado: "CONTRATO_INCOMPLETO",
          contrato: { faltam, assumidasComoZero: [], lidas: 22 } as never,
        }),
        segunda: null,
      }),
      quinzenas(),
    );

    expect(afericao.aferibilidade.primeira.semContrato[0]?.faltam).toEqual(faltam);
  });
});

describe("as premissas não são pendências", () => {
  /** O cadastro respondeu, com uma opcional em branco e nenhum documento. */
  const respondeu = (lastro: { comLastro: number; verificaveis: number; informadas: number }) =>
    diagnostico({
      estado: "RESPONDEU",
      contrato: {
        faltam: [],
        assumidasComoZero: [{ chave: "ativo_lucro_operacional", rotulo: "Lucro Operacional" }],
        lidas: 22,
        lastro,
      } as never,
    });

  it("a opcional em branco é dita como premissa, e não trava a completude", () => {
    const afericao = aferir(
      canal({
        primeira: respondeu({ comLastro: 11, verificaveis: 11, informadas: 29 }),
        segunda: null,
      }),
      quinzenas(),
    );

    const premissas = afericao.aferibilidade.primeira.premissas;
    expect(premissas.map((p) => p.tipo)).toEqual(["OPCIONAIS_COMO_ZERO"]);
    expect(premissas[0]?.texto).toContain("Lucro Operacional");
    /* E, sobretudo: nenhuma pendência foi criada por causa dela. */
    expect(afericao.aferibilidade.primeira.semContrato).toEqual([]);
  });

  /**
   * O DEVIDO SEM LASTRO É DITO, E CONTINUA VALENDO.
   *
   * É o caso real do CDD Belém: cadastro digitado, zero documentos, devido ao
   * centavo. A coluna fecha; o que a tela precisa acrescentar é que ninguém
   * conferiu aqueles números contra arquivo nenhum.
   */
  it("zero de onze verificáveis vira aviso de auditabilidade, não de falta", () => {
    const afericao = aferir(
      canal({
        primeira: respondeu({ comLastro: 0, verificaveis: 11, informadas: 29 }),
        segunda: null,
      }),
      quinzenas(),
    );

    const premissas = afericao.aferibilidade.primeira.premissas;
    expect(premissas.map((p) => p.tipo)).toEqual([
      "OPCIONAIS_COMO_ZERO",
      "SEM_LASTRO_DOCUMENTAL",
    ]);
    const lastro = premissas.find((p) => p.tipo === "SEM_LASTRO_DOCUMENTAL")!;
    expect(lastro.texto).toContain("O devido é calculado do mesmo jeito");
    expect(afericao.aferibilidade.primeira.semContrato).toEqual([]);
    expect(afericao.aferibilidade.primeira.completude).not.toBe("INCOMPLETO");
  });

  it("lastro parcial diz a fração, e não o zero nem o cheio", () => {
    const afericao = aferir(
      canal({
        primeira: respondeu({ comLastro: 4, verificaveis: 11, informadas: 29 }),
        segunda: null,
      }),
      quinzenas(),
    );

    const parcial = afericao.aferibilidade.primeira.premissas.find(
      (p) => p.tipo === "LASTRO_PARCIAL",
    );
    expect(parcial?.titulo).toBe("Lastro documental parcial: 4 de 11");
  });

  it("com as onze comprovadas, não há o que avisar sobre lastro", () => {
    const afericao = aferir(
      canal({
        primeira: respondeu({ comLastro: 11, verificaveis: 11, informadas: 29 }),
        segunda: null,
      }),
      quinzenas(),
    );

    expect(
      afericao.aferibilidade.primeira.premissas.some((p) => p.tipo !== "OPCIONAIS_COMO_ZERO"),
    ).toBe(false);
  });

  /* O mês herda o que as duas metades assumem — é a soma das duas colunas. */
  it("o total do mês reúne as premissas das duas quinzenas", () => {
    const afericao = aferir(
      canal({
        primeira: respondeu({ comLastro: 0, verificaveis: 11, informadas: 29 }),
        segunda: respondeu({ comLastro: 0, verificaveis: 11, informadas: 29 }),
      }),
      quinzenas(),
    );

    expect(afericao.aferibilidade.total.premissas).toHaveLength(4);
    expect(afericao.aferibilidade.total.premissas.map((p) => p.quinzena)).toEqual([1, 1, 2, 2]);
  });
});
