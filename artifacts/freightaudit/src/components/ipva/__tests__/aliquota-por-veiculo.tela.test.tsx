// @vitest-environment jsdom
//
// A PERGUNTA QUE ESTA TABELA EXISTE PARA RESPONDER.
//
// *"No lugar de mostrar veículos sem alteração, quero comparar % alíquotas — o
// IPVA de e o IPVA para em percentual da alíquota."*
//
// A coluna de reais não responde isso, e não por falta de precisão: uma queda
// de R$ 3.064,74 é economia quando a nota caiu na mesma proporção, e é troca de
// critério quando a nota ficou parada e o percentual caiu. As duas produzem a
// mesma célula em reais. O que se verifica aqui é que as duas alíquotas chegam
// lado a lado, com a terceira casa preservada, e que a tabela não inventa
// percentual onde falta o denominador.
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TabelaDeAliquotas } from "../aliquota-por-veiculo";
import type { AliquotaDoAtivo } from "@/lib/ipva";

afterEach(cleanup);

const ativo = (parcial: Partial<AliquotaDoAtivo>): AliquotaDoAtivo => ({
  entityLabel: "RPG0C44",
  entityType: "CAVALO",
  ipvaBase: 7210,
  nfBase: 721000,
  ipvaComparada: 4145.26,
  nfComparada: 636760,
  aliquotaBase: 1,
  aliquotaComparada: 0.651,
  diferenca: -0.349,
  estorno: false,
  ...parcial,
});

const linhaDe = (placa: string) => screen.getByText(placa).closest("tr")!;

const renderizar = (ativos: AliquotaDoAtivo[]) =>
  render(
    <TabelaDeAliquotas ativos={ativos} rotuloBase="junho/2026" rotuloComparada="julho/2026" />,
  );

describe("a comparação de alíquotas", () => {
  it("põe as duas pontas da placa lado a lado, com as três casas da alíquota", () => {
    renderizar([ativo({})]);
    const linha = within(linhaDe("RPG0C44"));
    /* Três casas obrigatórias: "1,00%" e "1,000%" parecem o mesmo número, e é
       a terceira que deixa ver a fórmula aplicada em bloco. */
    expect(linha.getByText("1,000%")).toBeTruthy();
    expect(linha.getByText("0,651%")).toBeTruthy();
    expect(linha.getByText("−0,349 p.p.")).toBeTruthy();
  });

  /* O denominador viaja junto porque é ele que torna o percentual conferível
     sem abrir outra tela — e porque é a nota, e não o tributo, que explica
     metade das quedas desta rubrica. */
  it("mostra o valor de nota que sustenta cada percentual", () => {
    renderizar([ativo({})]);
    const linha = within(linhaDe("RPG0C44"));
    expect(linha.getByText(/NF\s+R\$\s*721\.000,00/)).toBeTruthy();
    expect(linha.getByText(/NF\s+R\$\s*636\.760,00/)).toBeTruthy();
  });

  it("não escreve 0% onde falta a nota — o real fica, o percentual vira travessão", () => {
    renderizar([
      ativo({
        entityLabel: "SEMNOTA1",
        nfBase: null,
        aliquotaBase: null,
        diferenca: null,
      }),
    ]);
    const linha = within(linhaDe("SEMNOTA1"));
    expect(linha.getByText("sem nota")).toBeTruthy();
    expect(linha.getAllByText("—").length).toBeGreaterThan(0);
    expect(linha.getByText(/R\$\s*7\.210,00/)).toBeTruthy();
    expect(linha.queryByText("0,000%")).toBeNull();
  });

  it("marca o estorno em vez de escondê-lo", () => {
    renderizar([
      ativo({ entityLabel: "ESTORNO1", ipvaBase: -1709.86, aliquotaBase: -1, estorno: true }),
    ]);
    expect(within(linhaDe("ESTORNO1")).getByText("estorno")).toBeTruthy();
  });

  it("escreve a placa que não se moveu, porque ficar igual é resposta", () => {
    renderizar([
      ativo({
        entityLabel: "IGUAL123",
        ipvaComparada: 7210,
        nfComparada: 721000,
        aliquotaComparada: 1,
        diferenca: 0,
      }),
    ]);
    expect(within(linhaDe("IGUAL123")).getByText("0,000 p.p.")).toBeTruthy();
  });
});
