// @vitest-environment jsdom
//
// Precisa de DOM porque o que se prova é o que a linha aberta escreve, e isso
// só existe depois do render — não é pixel, é o rótulo e o valor ao lado dele.
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListaDeChamados } from "../lista-de-chamados";
import type { ChamadoNaFila } from "@/lib/monitoramento-de-chamados";

/**
 * A coluna `Item` do export não é um fato: é uma caixa.
 *
 * Num chamado de veículo ela vem `Placa: QYW2D78 | Placa Carreta: QYW4C69`, e a
 * segunda placa é o implemento acoplado — o dado que a conciliação mais procura
 * e o que a frase escondia. Cada pedaço já vem rotulado pela fonte; o detalhe
 * só precisa parar de repassar a frase inteira sob um rótulo só.
 */
const CHAMADO: ChamadoNaFila = {
  id: "c1",
  externalId: "31182143",
  serie: "082026",
  unidade: "Camaçari",
  area: "Empurrada",
  responsavel: "Operalog",
  solicitante: "99848302@ab-inbev.com",
  operador: "Operalog",
  statusRaw: "Aprovado",
  statusBucket: "APROVADO",
  assunto: "Troca de conjunto",
  entidade: "QYW2D78",
  item: "Placa: QYW2D78 | Placa Carreta: QYW4C69",
  categoria: "Frete",
  vigencia: "2026-08",
  sla: "5 dias",
  prazoPrevisto: "2026-09-05",
  abertoEm: "2026-08-31T12:00:00.000Z",
  encerradoEm: null,
  alteradoEmFonte: "2026-08-31T18:00:00.000Z",
  parametros: 0,
  alteracoes: [],
  linhaDoArquivo: 12,
  movimentou: false,
};

const relacao = (chamado: ChamadoNaFila) =>
  render(
    <ListaDeChamados
      chamados={[chamado]}
      carregando={false}
      dia="2026-08-31"
      pagina={1}
      porPagina={50}
      total={1}
      onPagina={() => {}}
      onPorPagina={() => {}}
      tamanhos={[50]}
      procedencia="Chamados 082026.xlsx"
      linhasNaEspera={1}
    />,
  );

const valorDoCampo = (rotulo: string) =>
  screen
    .getAllByText(rotulo)
    .filter((el) => el.tagName !== "TH")[0]
    ?.nextElementSibling?.textContent;

afterEach(cleanup);

describe("o item do chamado abre em campos", () => {
  it("cada fato da caixa vira um campo com o nome que a fonte deu", () => {
    relacao(CHAMADO);
    fireEvent.click(screen.getByText("31182143"));
    expect(valorDoCampo("Placa")).toBe("QYW2D78");
    expect(valorDoCampo("Placa Carreta")).toBe("QYW4C69");
  });

  it("o de mão de obra abre em cargo e classificação, sem o prefixo repetido", () => {
    relacao({
      ...CHAMADO,
      item: "Cargo: Manobrista | Classificação: Classificação: CARREGAMENTO",
    });
    fireEvent.click(screen.getByText("31182143"));
    expect(valorDoCampo("Cargo")).toBe("Manobrista");
    expect(valorDoCampo("Classificação")).toBe("CARREGAMENTO");
  });

  /* Sem rótulo dentro, a caixa é o fato: um item que é só a placa continua "Item". */
  it("o item sem rótulo nenhum continua um campo só", () => {
    relacao({ ...CHAMADO, item: "QYW2D78" });
    fireEvent.click(screen.getByText("31182143"));
    expect(valorDoCampo("Item")).toBe("QYW2D78");
  });
});
