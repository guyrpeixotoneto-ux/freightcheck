// @vitest-environment jsdom
//
// OS DOIS ALVOS DE UMA LINHA DA MATRIZ.
//
// A linha da matriz responde a duas perguntas diferentes, e elas não têm a
// mesma profundidade: "quanto deu, no todo?" é o resumo, e "o que mudou neste
// veículo?" é o histórico, vigência a vigência. Enquanto havia um alvo só, a
// segunda custava sempre um clique a mais — o de abrir o histórico dentro da
// gaveta que tinha acabado de abrir.
//
// O que estes casos prendem é o contrato entre a matriz e quem a desenha: o
// clique no **nome** da placa pede `historico`, o clique no **resto da linha**
// não pede nada. A gaveta obedece a esse sinal; se a matriz parar de mandá-lo,
// o atalho some sem que nada quebre — e é justamente isso que estes casos
// impedem de passar despercebido.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatrizDaEvolucao } from "../matriz";
import type { AtivoNaEvolucao, EvolucaoPorPlaca } from "@/lib/evolucao-por-placa";

afterEach(cleanup);

const ATIVO = {
  entityId: "ativo-1",
  plate: "QYX1E78",
  rotulo: "QYX1E78",
  entityType: "TRACTOR",
  placasAnteriores: [],
  celulas: [{ period: "2026-01-16", label: "jan", impacto: -79, alteracoes: 1 }],
  acumulado: -79,
  ganho: 0,
  perda: -79,
  alteracoes: 1,
  semValoracao: 0,
  foraDoTotal: 0,
  outraPeriodicidade: 0,
  vigenciasAfetadas: 1,
  vigenciasNegativas: 1,
  vigenciasPositivas: 0,
  pioraConsecutiva: 0,
  rubricasRecorrentes: 0,
  ultimaVigencia: "2026-01-16",
  tendencia: "PIORANDO",
  score: 50,
  prioridade: "CRITICA",
  motivos: [],
  rubricas: [],
  componentes: null,
  vigenciasJuntos: 0,
  composicao: [],
} as unknown as AtivoNaEvolucao;

const EVOLUCAO = {
  periodicidade: "MENSAL",
  grao: "ATIVO",
  fromLabel: "dezembro/2025",
  toLabel: "janeiro/2026",
  colunas: [{ period: "2026-01-16", label: "jan", comparisons: 1, alteracoes: 1 }],
  ativos: [ATIVO],
  gaps: [],
} as unknown as EvolucaoPorPlaca;

function desenhar(onEscolherPlaca: (id: string, opcoes?: { historico?: boolean }) => void) {
  render(
    <MatrizDaEvolucao
      evolucao={EVOLUCAO}
      filtro="todos"
      ordem="prioridade"
      busca=""
      insight={null}
      selecionada={null}
      onFiltro={() => undefined}
      onOrdem={() => undefined}
      onBusca={() => undefined}
      onLimparInsight={() => undefined}
      onEscolherPlaca={onEscolherPlaca}
    />,
  );
}

describe("os dois alvos de uma linha", () => {
  it("o nome da placa pede o histórico", () => {
    const escolher = vi.fn();
    desenhar(escolher);

    fireEvent.click(screen.getByRole("button", { name: "QYX1E78" }));

    expect(escolher).toHaveBeenCalledWith("ativo-1", { historico: true });
  });

  it("o resto da linha abre no resumo", () => {
    const escolher = vi.fn();
    desenhar(escolher);

    /*
      A célula da vigência, e não a linha inteira: clicar no `<tr>` pelo teste
      passaria mesmo que o clique real caísse sempre no botão da placa. É o
      caminho do usuário que interessa aqui.
    */
    fireEvent.click(screen.getByText("−R$ 79"));

    expect(escolher).toHaveBeenCalledWith("ativo-1", undefined);
  });

  it("o clique no nome não borbulha para a linha", () => {
    const escolher = vi.fn();
    desenhar(escolher);

    fireEvent.click(screen.getByRole("button", { name: "QYX1E78" }));

    /*
      Sem `stopPropagation`, o mesmo clique chegaria ao `<tr>` e chamaria de
      novo — com `undefined` —, desfazendo o pedido de histórico que o primeiro
      tinha acabado de fazer.
    */
    expect(escolher).toHaveBeenCalledTimes(1);
  });
});
