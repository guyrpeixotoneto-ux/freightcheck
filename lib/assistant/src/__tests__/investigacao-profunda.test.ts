/**
 * A descida — provada contra o banco real, passo a passo.
 *
 * **O que se mede aqui, e por que não é "número de consultas".** Uma
 * investigação de três consultas disparadas juntas e uma de três consultas em
 * que cada argumento saiu da anterior somam o mesmo três e não são a mesma
 * coisa. O que este arquivo mede é a segunda: para cada passo, que valor
 * **não existia** antes da consulta anterior voltar, e de qual consulta ele
 * saiu. Ver `encadeamento.ts`.
 *
 * **O controle negativo mora no primeiro caso.** "Quanto está o consumo
 * negociado?" é uma pergunta de valor, não de causa, e ela **não** desce — o
 * mesmo código, a mesma vigência, o mesmo banco, e zero encadeamento. Se a
 * descida rodasse para tudo, ela apareceria ali, e o número deste arquivo
 * mediria custo em vez de profundidade.
 *
 * **O que ele não prova.** Que a prosa ficou boa. A redação depende do modelo,
 * e nenhuma asserção aqui é sobre texto: são todas sobre o **dossiê** — qual
 * consulta, com que argumento, tirado de onde.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { createDb, type Database } from "@workspace/db";
import { orquestrar } from "../orquestrador";
import { avancarEstado, ESTADO_VAZIO, type EstadoDaConversa } from "../conversa";
import { interpretar } from "../interpretacao";
import { INVESTIGACAO } from "./perguntas-de-investigacao";
import {
  comBancoDeAvaliacao as rodar,
  URL_DO_BANCO_DE_AVALIACAO as URL_DO_BANCO,
} from "./banco-de-avaliacao";

describe("a leitura de causalidade — a forma da pergunta, não o conteúdo dela", () => {
  it("«por que caiu» e «quanto caiu» têm o mesmo conteúdo e não a mesma pergunta", () => {
    expect(interpretar("Por que a remuneração caiu?").pedeCausa).toBe(true);
    expect(interpretar("Quanto a remuneração caiu?").pedeCausa).toBe(false);
  });

  it("causa, motivo, razão e explicar são as formas de pedir o porquê", () => {
    for (const p of [
      "Qual foi a principal causa da queda?",
      "Qual o motivo dessa diferença?",
      "O que explica esse movimento?",
      "O que causou a queda?",
    ]) {
      expect(interpretar(p).pedeCausa, p).toBe(true);
    }
  });

  it("pedir ordenação não é pedir causa — «qual o maior» fica de fora", () => {
    /*
      A fronteira que impede a descida de virar custo fixo: "qual o maior?" é
      uma ordenação, e o plano já sabe fazê-la num nível só. Tratá-la como causa
      faria toda pergunta executiva descer três níveis.
    */
    expect(interpretar("Qual o maior impacto de agosto?").pedeCausa).toBe(false);
    expect(interpretar("O que mais pesou?").pedeCausa).toBe(false);
  });
});

rodar("a descida, contra o banco real", () => {
  let db: Database;
  beforeAll(() => {
    ({ db } = createDb(URL_DO_BANCO!));
  });

  it("uma pergunta causal desce do agregado ao grupo, à linha e à célula", async () => {
    const d = await orquestrar(db, "Por que a remuneração caiu?");

    expect(d.encadeamentos.length, "a descida não aconteceu").toBeGreaterThanOrEqual(2);
    const ferramentas = d.encadeamentos.map((p) => p.ferramenta);
    expect(ferramentas).toEqual(["grupoQueMaisPesou", "veiculosDoGrupo", "proveniencia"]);

    /*
      A prova de que é encadeamento e não largura: o argumento de cada passo
      saiu do resultado do anterior, e é dito qual.
    */
    expect(d.encadeamentos[1]!.descoberto).toEqual({
      campo: "atributo",
      valor: expect.any(String),
    });
    expect(d.encadeamentos[1]!.derivaDe).toBe(0);
    expect(d.encadeamentos[2]!.descoberto?.campo).toBe("placa");
    expect(d.encadeamentos[2]!.derivaDe).toBe(1);

    // E a cadeia chega ao arquivo: o nível mais fundo que existe.
    const origem = d.evidencias.find((e) => e.ferramenta === "proveniencia");
    expect(origem, "a descida parou antes da planilha").toBeTruthy();
    expect(origem!.fatos.map((f) => f.rotulo)).toContain("Arquivo");
    expect(origem!.fatos.find((f) => f.rotulo === "Célula")!.valor).toMatch(
      /aba .+, linha \d+, coluna/,
    );
  }, 180_000);

  it("CONTROLE NEGATIVO: uma pergunta que não é de causa não desce", async () => {
    /*
      O mesmo código, o mesmo banco, a mesma vigência. Se a descida rodasse
      sempre, o encadeamento apareceria aqui — e o número do relatório mediria
      custo em vez de profundidade.
    */
    const d = await orquestrar(db, "Quantas vigências existem?");
    expect(d.encadeamentos).toEqual([]);
  }, 120_000);

  it("a profundidade é proporcional: quem pergunta por veículos para na linha", async () => {
    const causal = await orquestrar(db, "Por que a remuneração caiu?");
    const porVeiculos = await orquestrar(db, "Quais veículos explicam essa queda?");

    expect(causal.encadeamentos.map((p) => p.ferramenta)).toContain("proveniencia");
    expect(
      porVeiculos.encadeamentos.map((p) => p.ferramenta),
      "a planilha é o passo seguinte, não a resposta a «quais veículos»",
    ).not.toContain("proveniencia");
    expect(porVeiculos.encadeamentos.length).toBeGreaterThanOrEqual(2);
  }, 180_000);

  it("«o que piorou» não pode devolver o que mais melhorou", async () => {
    /*
      **O defeito, e ele é de resposta errada.** A descida ordenava por módulo do
      impacto. Numa vigência em que o maior movimento é um ganho, "o que mais
      impactou negativamente?" nomeava esse ganho — com número certo, fonte ao
      lado, e a palavra "negativamente" na pergunta. Verdadeiro sobre outra
      coisa, e indistinguível do certo na leitura.
    */
    const perda = await orquestrar(db, "O que mais impactou negativamente?");
    const grupo = perda.evidencias.find((e) => e.ferramenta === "grupoQueMaisPesou");
    expect(grupo, "a descida não abriu grupo nenhum").toBeTruthy();
    expect(grupo!.titulo).toContain("reduziu a remuneração");

    /*
      A asserção que prova o lado: todo valor em dinheiro apurado do grupo
      escolhido é negativo. Um `+R$` aqui é o defeito de volta.
    */
    const valorPrincipal = grupo!.fatos[0]!.valor;
    expect(valorPrincipal, `o grupo escolhido é um ganho: ${valorPrincipal}`).toMatch(/^−R\$/);
  }, 180_000);

  it("«o que ajudou» é o espelho, e não o mesmo grupo", async () => {
    const ganho = await orquestrar(db, "Onde a remuneração subiu mais?");
    const grupo = ganho.evidencias.find((e) => e.ferramenta === "grupoQueMaisPesou");
    if (grupo) {
      expect(grupo.titulo).toContain("aumentou a remuneração");
      expect(grupo.fatos[0]!.valor).toMatch(/^\+R\$/);
    }
  }, 180_000);

  it("a bateria funda inteira: nove casos, cada um com a descida que pede", async () => {
    let estado: EstadoDaConversa = ESTADO_VAZIO;
    const falhas: string[] = [];

    for (const caso of INVESTIGACAO) {
      const d = await orquestrar(db, caso.pergunta, { estado });
      estado = avancarEstado(estado, d);
      if (d.encadeamentos.length < caso.encadeamentosMinimos) {
        falhas.push(
          `"${caso.pergunta}" → ${d.encadeamentos.length} encadeamento(s), ` +
            `mínimo ${caso.encadeamentosMinimos} · ${d.evidencias.map((e) => e.ferramenta).join(" → ")}`,
        );
      }
    }

    expect(falhas, falhas.join("\n  ")).toEqual([]);
  }, 600_000);

  it("o fio continua no grupo que já estava aberto — não redescobre o maior", async () => {
    /*
      O defeito que isto fecha: sem o foco estruturado, a segunda pergunta de
      uma investigação recomeça pelo agregado e responde sobre o grupo que mais
      pesa **hoje** — que pode não ser o que se estava discutindo. A pista disso
      é o número mudar sem ninguém ter trocado de assunto.
    */
    let estado: EstadoDaConversa = ESTADO_VAZIO;
    const primeiro = await orquestrar(db, "Por que a remuneração caiu?");
    estado = avancarEstado(estado, primeiro);

    expect(estado.foco, "a investigação não fixou foco nenhum").toBeTruthy();
    expect(estado.foco!.grupo?.codigo, "o foco tem de ser uma referência, não um rótulo").toMatch(
      /\w/,
    );

    const segundo = await orquestrar(db, "O que mudou nesses veículos?", { estado });
    expect(segundo.encadeamentos[0]!.porque).toContain("já tinha aberto");
    expect(
      segundo.encadeamentos[1]!.descoberto?.valor,
      "o segundo turno abriu outro grupo — a conversa trocou de assunto sozinha",
    ).toBe(estado.foco!.grupo!.codigo);
  }, 240_000);
});
