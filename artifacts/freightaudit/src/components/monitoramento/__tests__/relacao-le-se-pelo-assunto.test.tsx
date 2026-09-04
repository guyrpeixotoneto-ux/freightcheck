// @vitest-environment jsdom
//
// Precisa de DOM porque o que se prova aqui é a ordem em que a tabela escreve
// as colunas e o que a linha aberta traz — as duas só existem depois do render,
// e nenhuma delas é pixel: o que se lê é o texto e a sequência dele.
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListaDeChamados } from "../lista-de-chamados";
import type { ChamadoNaFila } from "@/lib/monitoramento-de-chamados";

/**
 * O assunto é a informação mais importante da relação.
 *
 * É a única frase que a fonte escreve sobre o chamado — o motivo pelo qual ele
 * existe — e todo o resto da linha qualifica o que ela diz. A tela tinha as
 * duas formas de escondê-la: a coluna vinha atrás do status, e ela era a única
 * elástica numa tabela sem sobra, então encolhia até `Ajuste …` enquanto as
 * datas e o e-mail do solicitante ficavam inteiros.
 *
 * O corte na célula continua — o assunto é texto livre e uma coluna que
 * crescesse com ele empurraria as outras para fora da tela —, e é por isso que
 * a linha aberta tem de trazer a frase inteira: sem isso, a promessa do corte
 * (o texto está a um clique) seria falsa e o dado não estaria em lugar nenhum.
 */
const ASSUNTO =
  "Ajuste de valor de frete conforme negociação da unidade de Camaçari para o trecho de Feira de Santana";

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
  assunto: ASSUNTO,
  entidade: "ABC1D23",
  item: "ABC1D23",
  categoria: "Frete",
  vigencia: "2026-08",
  sla: "5 dias",
  prazoPrevisto: "2026-09-05",
  abertoEm: "2026-08-31T12:00:00.000Z",
  encerradoEm: "2026-08-31T18:00:00.000Z",
  alteradoEmFonte: "2026-08-31T18:00:00.000Z",
  parametros: 1,
  alteracoes: [
    { parametro: "freteReaisViagem", operacao: "SET", de: "4", para: "7" },
  ],
  linhaDoArquivo: 12,
  movimentou: false,
};

const relacao = () =>
  render(
    <ListaDeChamados
      chamados={[CHAMADO]}
      carregando={false}
      dia="2026-08-31"
      pagina={1}
      porPagina={50}
      total={1}
      onPagina={() => {}}
      onPorPagina={() => {}}
      tamanhos={[50]}
      procedencia="Chamados 082026.xlsx"
    />,
  );

afterEach(cleanup);

describe("a relação de chamados se lê pelo assunto", () => {
  it("o assunto é a primeira coluna depois do número do chamado", () => {
    relacao();
    const cabecalhos = screen
      .getAllByRole("columnheader")
      .map((th) => th.textContent?.trim())
      .filter((t) => t !== "");
    expect(cabecalhos.slice(0, 2)).toEqual(["Chamado", "Assunto"]);
  });

  it("a célula do assunto oferece o texto inteiro no `title`", () => {
    // O corte é visual, e o `title` é o que o corte deve ao leitor: sem ele,
    // reticências seriam o fim da informação e não o começo dela.
    relacao();
    expect(screen.getByTitle(ASSUNTO)).toHaveProperty("textContent", ASSUNTO);
  });

  it("a linha aberta traz o assunto inteiro, fora das reticências", () => {
    relacao();
    // Abrir a linha é o gesto de quem quer ler o que a coluna cortou — quase
    // sempre é por isso que se clica.
    fireEvent.click(screen.getByText("31182143"));

    // O outro "Assunto" da tela é o cabeçalho da coluna; o do detalhe é o
    // rótulo do campo, e o que vem depois dele é a frase inteira, sem corte.
    const rotulo = screen
      .getAllByText("Assunto")
      .filter((el) => el.tagName !== "TH");
    expect(rotulo).toHaveLength(1);
    expect(rotulo[0].nextElementSibling?.textContent).toBe(ASSUNTO);
  });
});
