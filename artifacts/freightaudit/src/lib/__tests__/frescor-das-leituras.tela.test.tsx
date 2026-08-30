// @vitest-environment jsdom
//
// Um DOM só neste arquivo, e a razão está no bloco abaixo: o que se prova aqui
// é o que a tela mostra **entre** duas respostas, e isso é `useQuery` com
// histórico de observador — histórico exige efeitos, efeitos exigem um DOM. O
// resto da suíte continua em Node, na velocidade em que roda.
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APURACAO_FECHADA,
  LEITURA_DE_APURACAO,
  invalidarApuracao,
} from "../frescor-das-leituras";
import { EmAtualizacao, classeDeAtualizacao } from "@/components/ui/em-atualizacao";

/**
 * O comportamento da **tela** entre duas respostas — não o do hook.
 *
 * A diferença importa. Um teste do hook afirmaria que `useQuery` devolve
 * `isPlaceholderData: true`, que é uma propriedade da biblioteca e não uma
 * promessa do produto. O que o produto promete é outra coisa, e é o que estes
 * testes exercitam contra um DOM de verdade:
 *
 *   1. o conteúdo existente **permanece** durante a troca de recorte;
 *   2. o conteúdo novo **substitui** o anterior quando chega;
 *   3. mudar a chave dispara a consulta **da chave nova**, e não outra;
 *   4. um erro **não** deixa o dado anterior passando por atual;
 *   5. a tela **diz** que o que está à vista é o anterior;
 *   6. o `staleTime` não refaz a chamada na revisita — e a invalidação refaz.
 *
 * A montagem é a mesma do produto: as opções exercitadas são o objeto
 * `LEITURA_DE_APURACAO` exportado, não uma cópia dele escrita aqui. Uma
 * política cuja prova é uma reescrita da política não prova nada.
 */

/**
 * Uma tela com a forma das cinco que receberam a política: um recorte na
 * chave, um cabeçalho que nomeia **a resposta em tela**, um corpo, um loader
 * que só vale para a primeira leitura e um aviso de erro.
 */
function TelaDeRecorte({
  recorte,
  buscar,
}: {
  recorte: string;
  buscar: (recorte: string) => Promise<{ unidade: string; total: number }>;
}) {
  const consulta = useQuery({
    queryKey: ["families", "tela", recorte],
    queryFn: () => buscar(recorte),
    retry: false,
    ...LEITURA_DE_APURACAO,
  });

  return (
    <div>
      <h1>
        {/* Nomeia a resposta em tela, nunca o recorte pedido. É o que impede a
            tela de afirmar que os números são da unidade nova. */}
        {consulta.data ? `Unidade — ${consulta.data.unidade}` : "Unidade — "}
        <EmAtualizacao ativo={consulta.isPlaceholderData} />
      </h1>
      {consulta.isLoading && <p>Carregando o Dashboard…</p>}
      {consulta.error && <p role="alert">Não foi possível montar o Dashboard.</p>}
      {consulta.data && (
        <div data-testid="corpo" className={classeDeAtualizacao(consulta.isPlaceholderData)}>
          <span data-testid="total">{consulta.data.total}</span>
        </div>
      )}
    </div>
  );
}

function comCliente(no: React.ReactNode, cliente: QueryClient) {
  return <QueryClientProvider client={cliente}>{no}</QueryClientProvider>;
}

function novoCliente() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** Uma resposta que só resolve quando o teste mandar. */
function respostaControlada<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((ok, falha) => {
    resolver = ok;
    rejeitar = falha;
  });
  return { promessa, resolver, rejeitar };
}

afterEach(() => cleanup());

describe("a tela durante a troca de recorte", () => {
  it("mantém o conteúdo anterior em tela enquanto a nova unidade não responde", async () => {
    const cliente = novoCliente();
    const camacari = respostaControlada<{ unidade: string; total: number }>();
    const jaguariuna = respostaControlada<{ unidade: string; total: number }>();
    const buscar = vi
      .fn<(r: string) => Promise<{ unidade: string; total: number }>>()
      .mockImplementationOnce(() => camacari.promessa)
      .mockImplementationOnce(() => jaguariuna.promessa);

    const tela = render(comCliente(<TelaDeRecorte recorte="A" buscar={buscar} />, cliente));

    // Primeira leitura: não há o que preservar, então o loader é legítimo.
    expect(screen.getByText("Carregando o Dashboard…")).toBeTruthy();
    expect(screen.queryByTestId("em-atualizacao")).toBeNull();

    camacari.resolver({ unidade: "CAMAÇARI", total: 10 });
    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("10"));

    // Troca de unidade: a chave muda e a resposta ainda não chegou.
    tela.rerender(comCliente(<TelaDeRecorte recorte="B" buscar={buscar} />, cliente));

    await waitFor(() => expect(screen.getByTestId("em-atualizacao")).toBeTruthy());

    // O conteúdo NÃO sumiu, e o loader NÃO tomou a tela.
    expect(screen.getByTestId("total").textContent).toBe("10");
    expect(screen.queryByText("Carregando o Dashboard…")).toBeNull();
    // E o cabeçalho continua nomeando a unidade cujos números estão à vista.
    expect(screen.getByRole("heading").textContent).toContain("CAMAÇARI");
    // O corpo está atenuado — o segundo sinal, para quem não olha o cabeçalho.
    expect(screen.getByTestId("corpo").className).toContain("opacity-60");

    // Quando a nova chega, tudo vira junto: números, nome e indicador.
    jaguariuna.resolver({ unidade: "JAGUARIÚNA", total: 42 });
    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("42"));
    expect(screen.getByRole("heading").textContent).toContain("JAGUARIÚNA");
    expect(screen.queryByTestId("em-atualizacao")).toBeNull();
    expect(screen.getByTestId("corpo").className).not.toContain("opacity-60");
  });

  it("dispara a consulta da chave nova, e só dela", async () => {
    const cliente = novoCliente();
    const buscar = vi.fn(async (r: string) => ({ unidade: r, total: r.length }));

    const tela = render(comCliente(<TelaDeRecorte recorte="A" buscar={buscar} />, cliente));
    await waitFor(() => expect(screen.getByTestId("total")).toBeTruthy());
    expect(buscar).toHaveBeenCalledTimes(1);
    expect(buscar).toHaveBeenLastCalledWith("A");

    tela.rerender(comCliente(<TelaDeRecorte recorte="B" buscar={buscar} />, cliente));
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));
    expect(buscar).toHaveBeenLastCalledWith("B");

    // E o resultado final é o da chave nova — nunca o da anterior.
    await waitFor(() =>
      expect(screen.getByRole("heading").textContent).toContain("Unidade — B"),
    );
    expect(cliente.getQueryData(["families", "tela", "B"])).toEqual({
      unidade: "B",
      total: 1,
    });
    // O dado de A continua no cache, sob a chave de A, e não vazou para B.
    expect(cliente.getQueryData(["families", "tela", "A"])).toEqual({
      unidade: "A",
      total: 1,
    });
  });

  it("não apresenta o dado anterior como atual quando a nova chave falha", async () => {
    const cliente = novoCliente();
    const erro = respostaControlada<{ unidade: string; total: number }>();
    const buscar = vi
      .fn<(r: string) => Promise<{ unidade: string; total: number }>>()
      .mockImplementationOnce(async () => ({ unidade: "CAMAÇARI", total: 10 }))
      .mockImplementationOnce(() => erro.promessa);

    const tela = render(comCliente(<TelaDeRecorte recorte="A" buscar={buscar} />, cliente));
    await waitFor(() => expect(screen.getByTestId("total").textContent).toBe("10"));

    tela.rerender(comCliente(<TelaDeRecorte recorte="B" buscar={buscar} />, cliente));
    await waitFor(() => expect(screen.getByTestId("em-atualizacao")).toBeTruthy());
    expect(screen.getByTestId("total").textContent).toBe("10");

    erro.rejeitar(new Error("503"));

    // O placeholder vale enquanto o status é `pending`. No erro ele acaba: o
    // corpo sai de cena e o aviso entra. É a garantia de que uma chamada que
    // falhou nunca fica representada por um número que veio de outro recorte.
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByTestId("total")).toBeNull();
    expect(screen.queryByTestId("em-atualizacao")).toBeNull();
  });
});

describe("o staleTime da apuração fechada", () => {
  it("não refaz a chamada ao voltar para um recorte já visitado", async () => {
    const cliente = novoCliente();
    const buscar = vi.fn(async (r: string) => ({ unidade: r, total: 1 }));

    const tela = render(comCliente(<TelaDeRecorte recorte="A" buscar={buscar} />, cliente));
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));

    tela.rerender(comCliente(<TelaDeRecorte recorte="B" buscar={buscar} />, cliente));
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));

    // Voltar para A dentro do minuto: nenhuma chamada nova, e o conteúdo de A
    // já está em tela no primeiro quadro — é a revisita instantânea medida.
    tela.rerender(comCliente(<TelaDeRecorte recorte="A" buscar={buscar} />, cliente));
    expect(screen.getByRole("heading").textContent).toContain("Unidade — A");
    expect(screen.queryByTestId("em-atualizacao")).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(buscar).toHaveBeenCalledTimes(2);
  });

  it("declara um minuto — o teto do atraso de quem não fez a mudança", () => {
    expect(APURACAO_FECHADA).toBe(60_000);
    expect(LEITURA_DE_APURACAO.staleTime).toBe(APURACAO_FECHADA);
  });

  it("é refeito quando a apuração muda, e não quando o relógio anda", async () => {
    const cliente = novoCliente();
    const buscar = vi.fn(async (r: string) => ({ unidade: r, total: 1 }));

    render(comCliente(<TelaDeRecorte recorte="A" buscar={buscar} />, cliente));
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));

    // Uma semântica confirmada na Curadoria muda o impacto apurado. É esta
    // chamada — e não a expiração do `staleTime` — que faz a tela reler.
    await invalidarApuracao(cliente);
    await waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));
  });

  it("alcança as chaves de todas as telas de apuração", async () => {
    const cliente = novoCliente();
    const chaves = [
      ["families", "dashboard", "?period=2026-08-01"],
      ["families", "overview", "2026-08-01", false],
      ["families", "visao-geral", ""],
      ["grouped", "2026-08-01", ""],
      ["composition", "fleet", "entityType=CAVALO"],
      ["changes-range", "from=…"],
      ["linha-do-tempo-overview", "from=…"],
      ["gerencial", "vigencias"],
    ];
    for (const chave of chaves) cliente.setQueryData(chave, { marcado: true });

    await invalidarApuracao(cliente);

    for (const chave of chaves) {
      const estado = cliente.getQueryState(chave);
      expect(estado?.isInvalidated, `chave não invalidada: ${JSON.stringify(chave)}`).toBe(
        true,
      );
    }
  });
});

describe("o indicador de atualização", () => {
  it("não aparece quando não há nada a declarar", () => {
    render(<EmAtualizacao ativo={false} />);
    expect(screen.queryByTestId("em-atualizacao")).toBeNull();
  });

  it("é anunciado para leitores de tela", () => {
    render(<EmAtualizacao ativo />);
    const no = screen.getByTestId("em-atualizacao");
    expect(no.getAttribute("role")).toBe("status");
    expect(no.getAttribute("aria-live")).toBe("polite");
    expect(no.textContent).toContain("atualizando");
  });
});
