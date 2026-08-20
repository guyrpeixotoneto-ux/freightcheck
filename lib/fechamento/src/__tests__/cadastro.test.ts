import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import {
  CadastroNaoEncontrado,
  RotuloDoCadastroNaoEncontrado,
  lerCadastro,
} from "../leitores/cadastro";
import { linhasDoCustoFixo } from "../mapa-rota";

/**
 * A aba `Cadastro` como a planilha real a monta: rótulo em `B` com o valor em
 * `C` para a 1ª quinzena, rótulo em `E` com o valor em `F` para a 2ª.
 *
 * Os números são os de julho/2026 — CDD Belém · Horizonte —, para que o teste
 * do leitor feche nos mesmos valores que o do motor. O arquivo real tem 3 MB e
 * 44 abas; o que importa dele para este leitor são estas vinte linhas.
 */
const LINHAS_DE_JULHO: [string, unknown, unknown][] = [
  ["Alíquota PIS no Estado =>", 0.0065, 0.0065],
  ["Alíquota COFINS no Estado =>", 0.086, 0.086],
  ["Alíquota ICMS no Estado =>", 0.1784, 0.1784],
  ["Alíquota ISS no Município =>", 0.059, 0.059],
  ["Total Frota Fixa Ativos =>", 56, 56],
  ["Total Frota Fixa Inativos =>", 8, 8],
  ["Remuneração Fixa - Frota Fixa Ativa", 1424.91, 1038.03],
  ["Remuneração Fixa - Equipe Entrega", 8919.38, 8919.38],
  ["Custo Variável (para 25 viagens previstas)", 5176.53, 5246.67],
  ["Remuneração Fixa - QLP Adm.", 4427.53, 4425.56],
  ["Remuneração - Outras Despesas", 4361.07, 4935.23],
  ["Lucro Operacional Variável (previsto)", null, null],
  ["Remuneração Fixa - Frota Fixa Inativa", 1650.97, 4359.09],
  ["Quantidade de Vans Ativas", 7, 7],
  ["Custo Fixo", 4693.85, 4693.85],
  ["Custo Equipe Entrega", 4250.45, 4250.45],
  ["Quantidade de Vans Inativas", 6, 6],
  ["Remuneração Vans - Frota Vans Inativas", 3195.18, 3195.18],
  ["Quantidade de Rotas Noturnas", 1, 1],
  ["Custo Fixo sem impostos - Noturna", 8697.88, 8697.88],
  ["Custo Fixo sem impostos - Marketing", null, null],
  ["% de viagens dentro do Município - ISS", 0.0316, 0.0238],
];

function planilhaDeCadastro(
  ajustes: { linhas?: [string, unknown, unknown][]; nomeDaAba?: string } = {},
): Buffer {
  const linhas = ajustes.linhas ?? LINHAS_DE_JULHO;
  /* Coluna A vazia, B rótulo, C valor, D vazia, E rótulo, F valor. */
  const grade = [
    ["", "CADASTRO DA PLANILHA DE REMUNERAÇÃO", "", "", "", ""],
    ...linhas.map(([rotulo, primeira, segunda]) => ["", rotulo, primeira, "", rotulo, segunda]),
  ];

  const pasta = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    pasta,
    XLSX.utils.aoa_to_sheet(grade),
    ajustes.nomeDaAba ?? "Cadastro",
  );
  return XLSX.write(pasta, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("o leitor do Cadastro", () => {
  it("lê as duas quinzenas de blocos diferentes da mesma aba", () => {
    const [primeira, segunda] = lerCadastro(planilhaDeCadastro());
    expect(primeira?.quinzena).toBe(1);
    expect(segunda?.quinzena).toBe(2);
    /* O que muda entre as colunas C e F é o que separa as duas quinzenas. */
    expect(primeira?.parametros.remuneracaoFixaDaFrotaAtiva).toBe(1424.91);
    expect(segunda?.parametros.remuneracaoFixaDaFrotaAtiva).toBe(1038.03);
    expect(primeira?.parametros.parcelaDentroDoMunicipio).toBe(0.0316);
    expect(segunda?.parametros.parcelaDentroDoMunicipio).toBe(0.0238);
  });

  it("reconstrói o custo fixo de julho/2026 ao centavo", () => {
    const [primeira] = lerCadastro(planilhaDeCadastro());
    const linhas = linhasDoCustoFixo(primeira!.parametros);
    const valor = (chave: string) => linhas.find((l) => l.chave === chave)?.valor;
    expect(valor("custo_fixo_padronizado")).toBe(731502.84);
    expect(valor("custo_fixo_inativos")).toBe(9017.3);
    expect(valor("custo_vans_inativas")).toBe(13088.62);
    expect(valor("custo_fixo_especiais")).toBe(5938.28);
    expect(valor("custo_fixo_vans")).toBe(42745.64);
  });

  it("soma o lucro previsto ao custo variável previsto, como a planilha faz", () => {
    const [primeira] = lerCadastro(planilhaDeCadastro());
    /* O lucro vem em branco no arquivo real, e branco ali é zero de verdade. */
    expect(primeira?.custoVariavelPrevistoPor25Viagens).toBe(5176.53);
  });

  it("acha o rótulo mesmo com acento, caixa e `=>` diferentes", () => {
    const linhas = LINHAS_DE_JULHO.map((l): [string, unknown, unknown] =>
      l[0] === "Alíquota PIS no Estado =>" ? ["ALIQUOTA PIS NO ESTADO", l[1], l[2]] : l,
    );
    const [primeira] = lerCadastro(planilhaDeCadastro({ linhas }));
    expect(primeira?.parametros.aliquotas.pis).toBe(0.0065);
  });

  describe("quando o cadastro não sustenta a conta, recusa alto", () => {
    it("aba ausente", () => {
      expect(() => lerCadastro(planilhaDeCadastro({ nomeDaAba: "Menu" }))).toThrow(
        CadastroNaoEncontrado,
      );
    });

    it("rótulo ausente — e diz qual e de que quinzena", () => {
      const linhas: [string, unknown, unknown][] = [["Alíquota PIS no Estado =>", 0.0065, 0.0065]];
      try {
        lerCadastro(planilhaDeCadastro({ linhas }));
        expect.unreachable("devia ter recusado");
      } catch (erro) {
        expect(erro).toBeInstanceOf(RotuloDoCadastroNaoEncontrado);
        expect((erro as RotuloDoCadastroNaoEncontrado).quinzena).toBe(1);
        expect((erro as Error).message).toContain("1ª quinzena");
      }
    });

    /**
     * Um rótulo repetido é o modo de errar mais perigoso desta aba: a primeira
     * ocorrência venceria, a segunda sumiria, e a conta rodaria com o número de
     * outra linha sem dizer nada.
     */
    it("rótulo repetido no mesmo bloco", () => {
      const linhas: [string, unknown, unknown][] = [
        ...LINHAS_DE_JULHO,
        ["Total Frota Fixa Ativos =>", 999, 999],
      ];
      expect(() => lerCadastro(planilhaDeCadastro({ linhas }))).toThrow(
        RotuloDoCadastroNaoEncontrado,
      );
    });
  });
});
