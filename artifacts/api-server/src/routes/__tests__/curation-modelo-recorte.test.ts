/**
 * O modelo baixado sai no recorte da aba aberta.
 *
 * A tela mostra as abas de equipamento e o botão de baixar lado a lado, e até
 * aqui o botão ignorava a aba: quem estava em `Carreta` e clicava recebia o
 * arquivo da frota inteira, com as abas do cavalo e do trecho junto. O que este
 * arquivo trava é a ponte entre as duas pontas — a tela põe o tipo em
 * `?equipamento=` e o servidor escreve só aquela aba.
 *
 * Os dois casos que não são o feliz importam tanto quanto ele:
 *
 * - **O recorte vazio tem frase própria.** A Curadoria mostra a aba mesmo
 *   zerada, de propósito, então dá para clicar em baixar estando nela. Mandar
 *   "importe a planilha do Freightec primeiro" para quem já importou uma base
 *   com 73 atributos de cavalo manda a pessoa refazer um trabalho pronto.
 * - **O recorte é só do equipamento.** O modelo continua saindo com os
 *   atributos já confirmados: ele é o arquivo de quem vai revisar descrição no
 *   Excel, e não um retrato da fila pendente que estava na tela.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { erroEmJson } from "../../middlewares/contrato-json";
import * as XLSX from "xlsx";

const getCurationQueue = vi.hoisted(() => vi.fn());
const listarCategorias = vi.hoisted(() => vi.fn());

vi.mock("@workspace/curation", async (original) => ({
  ...(await original<typeof import("@workspace/curation")>()),
  getCurationQueue,
  listarCategorias,
}));

const { default: router } = await import("../curation");

/** Um atributo da fila, com só o que o modelo lê de cada um. */
function atributo(code: string, entityType: string) {
  return {
    code,
    sourceName: code.split(".")[1],
    entityType,
    semanticsStatus: "PRESUMED",
    displayName: null,
    definition: null,
    taxonomyCode: null,
  };
}

const FILA = [
  atributo("cavalo.ipva", "CAVALO"),
  atributo("cavalo.seguro", "CAVALO"),
  atributo("carreta.seguro", "CARRETA"),
  atributo("trecho.pedagio", "TRECHO"),
];

let servidor: Server;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      log: { warn: () => {}, error: () => {} },
      id: "req-de-teste",
      user: { email: "curador@ambev.com.br" },
    });
    next();
  });
  app.use(router);
  /*
    O contrato JSON, montado como no `app.ts`. Não é cerimônia de teste: desde
    que a tradução das recusas e o diagnóstico de schema saíram dos `catch` das
    rotas, é ele quem responde 404, 400, 422, 503 e 500 — e um app de teste sem
    ele mede o `finalhandler` do Express, que devolve HTML.
  */
  app.use(erroEmJson);
  await new Promise<void>((resolve) => {
    servidor = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => servidor.close(() => resolve())));

beforeEach(() => {
  vi.clearAllMocks();
  getCurationQueue.mockResolvedValue(FILA);
  listarCategorias.mockResolvedValue([
    { code: "cv_pneus", caminho: "Custo Variável › Pneus" },
  ]);
});

/** As abas de equipamento do arquivo — sem as de serviço, que não são recorte. */
async function abasDoArquivo(resposta: Response): Promise<string[]> {
  const bytes = Buffer.from(await resposta.arrayBuffer());
  const workbook = XLSX.read(bytes, { type: "buffer" });
  return workbook.SheetNames.filter((n) => n !== "Instruções" && n !== "Listas");
}

describe("o modelo de atributos no recorte da aba", () => {
  it("sem o parâmetro, escreve uma aba por equipamento", async () => {
    const resposta = await fetch(`${base}/curation/atributos/modelo.xlsx`);

    expect(resposta.status).toBe(200);
    expect(await abasDoArquivo(resposta)).toEqual(["Carreta", "Cavalo", "Trecho"]);
  });

  it("com o equipamento, escreve só a aba dele", async () => {
    const resposta = await fetch(
      `${base}/curation/atributos/modelo.xlsx?equipamento=CARRETA`,
    );

    expect(resposta.status).toBe(200);
    expect(await abasDoArquivo(resposta)).toEqual(["Carreta"]);
  });

  it("lê o tipo como ele viaja no endereço, e não só em maiúsculas", async () => {
    // A aba escolhida vira `?equipamento=` a partir do endereço da tela, e um
    // link escrito à mão com `cavalo` tem de baixar o mesmo arquivo do clique.
    const resposta = await fetch(
      `${base}/curation/atributos/modelo.xlsx?equipamento=%20cavalo%20`,
    );

    expect(resposta.status).toBe(200);
    expect(await abasDoArquivo(resposta)).toEqual(["Cavalo"]);
  });

  it("o nome do arquivo diz o recorte, para os dois não se confundirem na pasta", async () => {
    const inteiro = await fetch(`${base}/curation/atributos/modelo.xlsx`);
    const so = await fetch(`${base}/curation/atributos/modelo.xlsx?equipamento=TRECHO`);

    expect(inteiro.headers.get("content-disposition")).toContain(
      "curadoria-atributos.xlsx",
    );
    expect(so.headers.get("content-disposition")).toContain(
      "curadoria-atributos-trecho.xlsx",
    );
  });

  it("o parâmetro vazio é a aba Todos, e não um equipamento que não existe", async () => {
    const resposta = await fetch(`${base}/curation/atributos/modelo.xlsx?equipamento=`);

    expect(resposta.status).toBe(200);
    expect(await abasDoArquivo(resposta)).toEqual(["Carreta", "Cavalo", "Trecho"]);
  });

  it("não recorta pela fila da tela: o confirmado continua saindo", async () => {
    getCurationQueue.mockResolvedValue([
      { ...atributo("carreta.seguro", "CARRETA"), semanticsStatus: "CONFIRMED" },
    ]);

    const resposta = await fetch(
      `${base}/curation/atributos/modelo.xlsx?equipamento=CARRETA`,
    );

    expect(resposta.status).toBe(200);
    expect(await abasDoArquivo(resposta)).toEqual(["Carreta"]);
  });

  describe("quando não há o que escrever", () => {
    it("manda trocar de aba quando é o recorte que está vazio", async () => {
      const resposta = await fetch(
        `${base}/curation/atributos/modelo.xlsx?equipamento=REBOQUE`,
      );

      expect(resposta.status).toBe(404);
      const { error } = (await resposta.json()) as { error: string };
      expect(error).toContain("Nenhum atributo de Reboque");
      // A frase da base vazia mandaria refazer uma importação que já foi feita.
      expect(error).not.toContain("Importe a planilha do Freightec");
    });

    it("manda importar quando é a base inteira que está vazia", async () => {
      getCurationQueue.mockResolvedValue([]);

      const resposta = await fetch(`${base}/curation/atributos/modelo.xlsx`);

      expect(resposta.status).toBe(404);
      const { error } = (await resposta.json()) as { error: string };
      expect(error).toContain("Importe a planilha do Freightec");
    });
  });
});
