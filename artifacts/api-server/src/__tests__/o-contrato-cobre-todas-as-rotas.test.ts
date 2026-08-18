/**
 * A constante não volta, e o contrato continua cobrindo todo mundo.
 *
 * Os outros arquivos provam o que a API **responde**. Este prova o que ela
 * **é** — e existe porque o defeito consertado aqui não foi um bug: foi uma
 * forma que se copiava. Cinquenta e quatro `catch` idênticos não nasceram de
 * uma decisão; nasceram de alguém colando o handler anterior. Um teste de
 * comportamento não pega o quinquagésimo quinto: ele pega a rota que já existe,
 * não a que será escrita na semana que vem.
 *
 * As três afirmações abaixo são a régua sobre o texto-fonte que impede a volta:
 *
 * 1. nenhuma rota responde a constante;
 * 2. nenhuma rota responde 5xx por conta própria — o 5xx é do contrato;
 * 3. o contrato está montado, e por último.
 *
 * Se um dia uma rota precisar mesmo de um 5xx próprio, o lugar de dizer isso é
 * a lista de exceções aqui embaixo, com o motivo escrito ao lado — e não um
 * `catch` a mais que ninguém revisa.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ROTAS = path.join(AQUI, "..", "routes");

function arquivosDeRota(): string[] {
  return readdirSync(ROTAS)
    .filter((nome) => nome.endsWith(".ts") && !nome.startsWith("index"))
    .sort();
}

function fonte(nome: string): string {
  return readFileSync(path.join(ROTAS, nome), "utf8");
}

/**
 * Os 5xx que uma rota ainda escreve, e por que cada um continua lá.
 *
 * A lista está vazia de propósito, e vazia é o estado que se quer manter. Ela
 * existe para que acrescentar um seja uma decisão visível — com nome de arquivo
 * e motivo — em vez de mais uma linha dentro de um `catch`.
 */
const EXCECOES: Record<string, string> = {
  /*
    A checagem de sessão responde 503 com `code` próprio quando não consegue
    falar com o banco. Fica: é a única rota cuja falha de banco não é "esta
    tela não carregou", e sim "não sabemos quem é você" — e a interface trata
    as duas de formas diferentes.
  */
  "auth.ts": "SESSION_CHECK_FAILED — indisponibilidade da checagem de sessão",
  /*
    O Assistente é o caso em que a forma daqui **já** estava certa antes deste
    trabalho: o `falhou` responde com `code` próprio e `requestId`, e não com a
    constante. O `code` separado existe porque metade das respostas desta
    superfície é `text/event-stream`, e a tela precisa distinguir "o Assistente
    falhou" de "a chamada não chegou". Fica, e é o modelo — não a exceção.
  */
  "assistant.ts": "ASSISTENTE_FALHOU — já responde com code e requestId",
};

describe("a constante que sumiu", () => {
  it('nenhuma rota responde "Internal server error"', () => {
    const culpados = arquivosDeRota().filter((nome) =>
      /res\s*\.\s*status\([^)]*\)\s*\.\s*json\(\s*\{\s*error:\s*"Internal server error"/.test(
        fonte(nome),
      ),
    );

    expect(culpados).toEqual([]);
  });

  it("a frase não sobrevive nem como texto de resposta em lugar nenhum", () => {
    /*
      A busca é pela frase inteira num literal de resposta, e não pela
      expressão: ela continua aparecendo — e deve continuar — nos comentários
      que contam por que ela existiu. Uma régua que proibisse a palavra
      apagaria a explicação junto com o defeito.
    */
    for (const nome of arquivosDeRota()) {
      const linhas = fonte(nome)
        .split("\n")
        .filter(
          (l) =>
            l.includes('"Internal server error"') &&
            !l.trimStart().startsWith("*"),
        );

      expect(linhas, `${nome} ainda responde a constante`).toEqual([]);
    }
  });
});

describe("o 5xx é do contrato, e não das rotas", () => {
  it("nenhuma rota escreve um status 5xx por conta própria", () => {
    const culpados: string[] = [];

    for (const nome of arquivosDeRota()) {
      if (nome in EXCECOES) continue;
      const achados = [
        ...fonte(nome).matchAll(/res\s*\.\s*status\(\s*(5\d\d)\s*\)/g),
      ];
      for (const achado of achados) culpados.push(`${nome}: ${achado[1]}`);
    }

    expect(culpados).toEqual([]);
  });

  it("as exceções continuam sendo as declaradas, e não mais que elas", () => {
    /* Uma exceção que deixou de ser necessária tem de sair da lista: uma lista
       que só cresce deixa de ser régua e vira decoração. */
    for (const [nome, motivo] of Object.entries(EXCECOES)) {
      expect(
        /res\s*\.\s*status\(\s*5\d\d\s*\)/.test(fonte(nome)),
        `${nome} não tem mais 5xx próprio (${motivo}) — tire-o da lista`,
      ).toBe(true);
    }
  });
});

describe("o contrato está montado", () => {
  it("o app monta o 404 e o handler de erro, nesta ordem e por último", () => {
    const app = readFileSync(path.join(AQUI, "..", "app.ts"), "utf8");

    const rota404 = app.indexOf("app.use(rotaDesconhecida)");
    const erro = app.indexOf("app.use(erroEmJson)");
    const router = app.indexOf('app.use("/api", router)');

    expect(rota404).toBeGreaterThan(-1);
    expect(erro).toBeGreaterThan(-1);
    /* O Express só reconhece um handler de quatro parâmetros como handler de
       erro se ele vier depois de tudo o que pode falhar — inclusive do 404. */
    expect(router).toBeLessThan(rota404);
    expect(rota404).toBeLessThan(erro);
  });
});
