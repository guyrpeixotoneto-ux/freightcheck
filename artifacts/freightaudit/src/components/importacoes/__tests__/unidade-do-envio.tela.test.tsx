// @vitest-environment jsdom
//
// A UNIDADE DO ENVIO DE CHAMADOS — declarar na chegada, reparar depois.
//
// O defeito que estes casos prendem tem nome e número: `Chamados Agosto
// Camaçari.xlsx`, 2.349 chamados, coluna `Unidade` vazia em todas as linhas,
// série indeterminada — e o Monitoramento mostrando o envio inteiro para quem
// tinha PERNAMBUCO aberto na lateral, porque um acervo em que nenhum envio
// nomeia unidade não recorta, soma.
//
// A tela não conserta isso sozinha; quem conserta é a série, no motor. O que
// esta aba passa a ter são os dois caminhos por onde uma pessoa dá a resposta
// que o arquivo não deu: o seletor antes do upload, e o conserto no cartão do
// envio que já entrou. É o que está preso aqui — inclusive a parte que é
// recusa: o envio cuja série já é uma unidade do cadastro não oferece conserto
// nenhum, porque não há o que consertar e o convite seria para estragar.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChamadosRecebidos } from "../chamados-recebidos";
import type { TicketImportSummary } from "@/lib/chamados-recebidos";

class ObservadorDeTamanho {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ObservadorDeTamanho as unknown as typeof ResizeObserver;

/* O jsdom desta versão não traz `Blob.arrayBuffer`, que é como o upload lê o
   arquivo antes de codificá-lo. É andaime de ambiente, como o ResizeObserver
   acima: o que o caso prova continua sendo o corpo que a tela monta. */
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function () {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const leitor = new FileReader();
      leitor.onload = () => resolve(leitor.result as ArrayBuffer);
      leitor.onerror = () => reject(leitor.error);
      leitor.readAsArrayBuffer(this);
    });
  };
}

/* O Radix mede e ancora o menu com APIs que o jsdom não traz. Nenhuma delas é
   o que estes casos provam — o que eles provam é o que o seletor lista e o que
   a escolha faz com o corpo da requisição. */
globalThis.DOMRect ??= class {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0,
  ) {}
  top = 0;
  left = 0;
  right = 0;
  bottom = 0;
  toJSON() {
    return this;
  }
} as unknown as typeof DOMRect;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json", "X-FreightCheck-API": "1" },
  });

/** Duas unidades no cadastro — é esse o vocabulário que os seletores oferecem. */
const CONTEXTOS = [
  {
    scopeHash: "hash-pe",
    channel: "EMPURRADA",
    label: "PERNAMBUCO",
    scopes: [{ scopeType: "UNIDADE", code: "PE", name: "PERNAMBUCO" }],
    latestPeriod: "2026-08-01",
    periods: 1,
    periodosDisponiveis: ["2026-08-01"],
  },
  {
    scopeHash: "hash-ca",
    channel: "EMPURRADA",
    label: "CAMAÇARI",
    scopes: [{ scopeType: "UNIDADE", code: "CA", name: "CAMAÇARI" }],
    latestPeriod: "2026-08-01",
    periods: 1,
    periodosDisponiveis: ["2026-08-01"],
  },
];

const envio = (parcial: Partial<TicketImportSummary> = {}): TicketImportSummary => ({
  id: "envio-1",
  filename: "Chamados Agosto Camaçari.xlsx",
  status: "READ",
  contentSha256: "a".repeat(64),
  byteSize: 12345,
  receivedAt: "2026-09-04T21:19:00.000Z",
  receivedBy: "guy@exemplo.com",
  finishedAt: "2026-09-04T21:19:30.000Z",
  rowCount: 2349,
  ticketCount: 2349,
  ignoredRowCount: 0,
  unmappedColumns: [],
  parameterColumns: [],
  columnMapping: {},
  failureReason: null,
  serie: null,
  serieOrigem: "INDETERMINADA",
  serieDeclarada: null,
  ...parcial,
});

/** O servidor mínimo desta aba, guardando o que foi pedido e com que corpo. */
function servidor(envios: TicketImportSummary[]) {
  const pedidos: { url: string; corpo: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      pedidos.push({
        url,
        corpo: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      if (url.includes("/contexts")) return resposta(CONTEXTOS);
      if (url.includes("/serie"))
        return resposta({ serie: "CAMAÇARI", enviosRecalculados: 1 });
      if (url.includes("/ticket-imports")) return resposta(envios);
      return resposta({});
    }),
  );
  return pedidos;
}

function montar(envios: TicketImportSummary[]) {
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cliente}>
      <ChamadosRecebidos />
    </QueryClientProvider>,
  );
}

/** O corpo do POST que levou o arquivo — o GET da lista não tem corpo. */
const corpoDoUpload = (pedidos: { url: string; corpo: unknown }[]) =>
  pedidos.find((p) => p.url.includes("/ticket-imports") && p.corpo !== null)?.corpo;

/** Escolher o arquivo pela entrada escondida, que é o caminho do botão. */
async function enviarArquivo() {
  const arquivo = new File(["chamado"], "export (3).csv", { type: "text/csv" });
  const entrada = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(entrada, "files", { value: [arquivo], configurable: true });
  fireEvent.change(entrada);
}

/** Escolher uma unidade no seletor. O Radix abre o menu pelo teclado no jsdom. */
async function escolher(unidade: string) {
  fireEvent.keyDown(screen.getAllByRole("combobox")[0]!, { key: "Enter" });
  fireEvent.click(await screen.findByRole("option", { name: unidade }));
}

describe("declarar a unidade na chegada do arquivo", () => {
  it("o seletor abre em \"deixar o arquivo dizer\", e não numa unidade", async () => {
    servidor([]);
    montar([]);

    await screen.findByText("Unidade deste envio (opcional)");
    // Declarar é escolha: um seletor que já viesse preenchido atribuiria o
    // arquivo à unidade que estivesse por cima na lista.
    expect(screen.getByText("Deixar o arquivo dizer")).toBeTruthy();
  });

  it("sem cadastro não há seletor — um vazio promete uma escolha que não existe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("/contexts")) return resposta([]);
        return resposta([]);
      }),
    );
    montar([]);

    await screen.findByText("Nenhum export de chamados recebido");
    expect(screen.queryByText("Unidade deste envio (opcional)")).toBeNull();
  });

  it("sem escolha, o corpo do envio não carrega o campo unidade", async () => {
    // Não é "leva vazio": o corpo não carrega a chave. Mandar `unidade: null`
    // faria o servidor ter de distinguir dois silêncios iguais.
    const pedidos = servidor([]);
    montar([]);
    await screen.findByText("Unidade deste envio (opcional)");

    await enviarArquivo();

    await waitFor(() => expect(corpoDoUpload(pedidos)).toBeTruthy());
    expect(corpoDoUpload(pedidos)).not.toHaveProperty("unidade");
  });

  it("a unidade escolhida viaja no envio, e é o texto do cadastro", async () => {
    // O texto, e não um código nosso: é sobre ele que o Monitoramento casa a
    // unidade aberta na lateral com a série do envio.
    const pedidos = servidor([]);
    montar([]);
    await screen.findByText("Unidade deste envio (opcional)");

    await escolher("CAMAÇARI");
    await enviarArquivo();

    await waitFor(() => expect(corpoDoUpload(pedidos)).toBeTruthy());
    expect(corpoDoUpload(pedidos)).toMatchObject({ unidade: "CAMAÇARI" });
  });
});

describe("consertar o envio que já entrou", () => {
  it("o envio sem série oferece o conserto, dizendo o que está acontecendo", async () => {
    servidor([envio()]);
    montar([envio()]);

    await screen.findByText(/não diz de que unidade veio/);
    expect(screen.getByRole("button", { name: /Recalcular a série/ })).toBeTruthy();
  });

  it("a série que não é do cadastro também oferece — ela não chega a ninguém", async () => {
    // `Agosto Camaçari` é uma série: separa este envio dos outros. E não casa
    // com unidade nenhuma da lateral, então o recorte que sai dela é um que
    // ninguém alcança. Tecnicamente particionado, praticamente invisível.
    servidor([envio({ serie: "Agosto Camaçari", serieOrigem: "NOME_DO_ARQUIVO" })]);
    montar([envio({ serie: "Agosto Camaçari", serieOrigem: "NOME_DO_ARQUIVO" })]);

    await screen.findByText(/não é nenhuma das unidades cadastradas/);
  });

  it("a série que já é uma unidade do cadastro não oferece conserto nenhum", async () => {
    servidor([envio({ serie: "CAMAÇARI", serieOrigem: "ARQUIVO" })]);
    montar([envio({ serie: "CAMAÇARI", serieOrigem: "ARQUIVO" })]);

    await screen.findByText(/lida da coluna Unidade das linhas/);
    expect(screen.queryByRole("button", { name: /Recalcular a série/ })).toBeNull();
  });

  it("sem cadastro nenhum, a série existente não é acusada de não chegar a ninguém", async () => {
    // O casamento falharia por não haver com quem casar, e a tira acusaria de
    // quebrado todo envio do acervo. O envio SEM série continua sendo caso —
    // ele está quebrado com cadastro ou sem.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: RequestInfo | URL) => {
        const url = String(entrada);
        if (url.includes("/contexts")) return resposta([]);
        if (url.includes("/ticket-imports"))
          return resposta([envio({ serie: "Agosto Camaçari", serieOrigem: "NOME_DO_ARQUIVO" })]);
        return resposta({});
      }),
    );
    montar([]);

    await screen.findByText(/lida do nome do arquivo/);
    expect(screen.queryByRole("button", { name: /Recalcular a série/ })).toBeNull();
  });

  it("o envio MISTA não é um envio que calou, e não entra no conserto", async () => {
    // Ele nomeou várias unidades, e o motor já sabe o que fazer com isso.
    // Oferecer o conserto escreveria "não diz de que unidade veio" sobre um
    // arquivo que disse de mais.
    servidor([envio({ serie: null, serieOrigem: "MISTA" })]);
    montar([envio({ serie: null, serieOrigem: "MISTA" })]);

    await screen.findByText(/indeterminada/);
    expect(screen.queryByRole("button", { name: /Recalcular a série/ })).toBeNull();
  });

  it("recalcular sem declarar não manda unidade, e a tela diz o que saiu", async () => {
    const pedidos = servidor([envio()]);
    montar([envio()]);

    fireEvent.click(await screen.findByRole("button", { name: /Recalcular a série/ }));

    await screen.findByText(/Série "CAMAÇARI"/);
    const reparo = pedidos.find((p) => p.url.includes("/serie"));
    expect(reparo!.corpo).toEqual({});
  });
});
