/**
 * ETAPA 1 — a trava para de punir a investigação funda, sem afrouxar.
 *
 * **O defeito, dito com precisão.** `numerosSemLastro` extrai todo token
 * numérico do texto e o confere contra os valores que as consultas devolveram.
 * Uma placa é um nome próprio com dígitos dentro: `ZZZ9Z99` entrava nesse
 * extrator como `99` e era conferida contra a lista de valores em reais. O
 * veredito passava a depender de uma coincidência aritmética — a placa passava
 * quando algum valor apurado terminava naqueles dígitos e reprovava quando não.
 * Como cada recusa poda a frase, e um terço de frases podadas descarta a
 * resposta inteira, o efeito era proporcional à profundidade: quanto mais
 * veículos a resposta nomeasse, maior a chance de ela ser jogada fora.
 *
 * **O que a correção faz.** Separa as duas afirmações. Número continua sendo
 * conferido contra número. Identificador passa a ser conferido contra a lista de
 * identificadores que as consultas devolveram — e essa lista é declarada pela
 * ferramenta (`Evidencia.identificadores`), não inferida do texto dos fatos.
 *
 * **Por que isto aperta em vez de afrouxar.** Antes, uma placa inventada só era
 * pega por acidente. `ZZZ1Z11` passava em qualquer dossiê que tivesse o número
 * 11 em algum lugar — e todo dossiê de vigência tem. Agora ela é recusada
 * sempre, e recusada **pelo nome**, que é o que permite a quem lê o painel
 * técnico entender o motivo em vez de procurar um valor de noventa e nove reais.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@workspace/db";
import { buildFixture, type AttributeSpec } from "@workspace/comparison/testing";
import { createTestDatabase, type TestDb } from "@workspace/ingest/testing";
import { computeMissingChangeSets } from "@workspace/comparison";
import { executar, evidenciasDe, registroPadrao } from "../ferramentas/registro";
import type { Evidencia } from "../ferramentas";
import {
  identificadoresSemLastro,
  numerosSemLastro,
  sanear,
  type Dossie,
} from "../orquestrador";

/** Um dossiê mínimo — só o que as três travas leem. */
function dossieDe(evidencias: Evidencia[]): Dossie {
  return {
    evidencias,
    trechos: [],
    documentos: [],
    anexos: [],
    lacunas: [],
  } as unknown as Dossie;
}

describe("Etapa 1 — identificador é conferido como identificador", () => {
  /*
    A evidência que reproduz a classe do defeito: a placa é autorizada **só**
    por `identificadores`, e os dígitos dela não aparecem em nenhum valor.

    Esta é a forma que uma ferramenta devolve quando a página mostrada é maior
    que a lista de fatos, ou quando o identificador não é o rótulo do fato. Com
    a régua antiga, `99` não estava entre os valores e a frase caía — apesar de
    o caminhão ter voltado da consulta.
  */
  const consultada: Evidencia = {
    ferramenta: "alteracoes:linhas",
    titulo: "FINAME cavalo — veículo a veículo",
    fatos: [{ rotulo: "linha 1", valor: "1.000,00 → 1.200,00" }],
    numeros: [1000, 1200, 200],
    identificadores: ["ZZZ9Z99"],
    origem: "getGroupVehicles(teste)",
  };

  const dossie = dossieDe([consultada]);

  it("a placa consultada não é decomposta em token financeiro", () => {
    expect(numerosSemLastro("O veículo ZZZ9Z99 subiu.", dossie)).toEqual([]);
  });

  it("a placa consultada passa pela régua de identificador", () => {
    expect(identificadoresSemLastro("O veículo ZZZ9Z99 subiu.", dossie)).toEqual([]);
  });

  it("a frase inteira sobrevive — é a poda que este defeito causava", () => {
    const s = sanear("O veículo ZZZ9Z99 passou de R$ 1.000,00 para R$ 1.200,00.", dossie);
    expect(s.removidas).toBe(0);
    expect(s.texto).toContain("ZZZ9Z99");
  });

  /*
    O outro lado, e ele é o que impede esta mudança de ser um afrouxamento.
    `ABC1D11` nunca voltou de consulta nenhuma; com a régua antiga ela passaria,
    porque `11` não é difícil de encontrar num dossiê de vigência.
  */
  it("a placa inventada é recusada — e recusada pelo nome", () => {
    const comOnze = dossieDe([{ ...consultada, numeros: [11, 1000, 1200] }]);
    expect(identificadoresSemLastro("O veículo ABC1D11 caiu.", comOnze)).toEqual(["ABC1D11"]);
    const s = sanear("O veículo ABC1D11 caiu.", comOnze);
    expect(s.removidas).toBe(1);
    expect(s.recusados).toContain("ABC1D11");
    /*
      O motivo aparece com o nome do caminhão, e não com dois dígitos soltos.
      É a diferença entre "a resposta citou uma placa que não consultamos" e
      "a resposta citou o número 11", que mandam procurar coisas diferentes.
    */
    expect(s.recusados.some((r) => /^\d+$/.test(r))).toBe(false);
  });

  it("número inventado continua derrubando a frase", () => {
    const s = sanear("O impacto foi de R$ 91.234,56 no veículo ZZZ9Z99.", dossie);
    expect(s.removidas).toBe(1);
    expect(s.recusados).toContain("91.234,56");
  });

  it("uma placa citada com dossiê vazio não passa", () => {
    expect(identificadoresSemLastro("Veja o ZZZ9Z99.", dossieDe([]))).toEqual(["ZZZ9Z99"]);
  });

  it("o lastro do identificador não vem do texto dos números", () => {
    /*
      A asserção que fixa a separação: uma evidência que contenha os dígitos da
      placa entre os seus valores **não** autoriza a placa. Se autorizasse,
      estaríamos de volta à coincidência aritmética, com outro nome.
    */
    const soNumeros: Evidencia = {
      ferramenta: "alteracoes:total",
      titulo: "Total da vigência",
      fatos: [{ rotulo: "Alterações", valor: "99" }],
      numeros: [99, 9],
      origem: "teste",
    };
    expect(identificadoresSemLastro("O veículo ZZZ9Z99 caiu.", dossieDe([soNumeros]))).toEqual([
      "ZZZ9Z99",
    ]);
  });
});

describe("Etapa 1 — uma resposta funda, contra dado real, não é podada", () => {
  let ctx: TestDb;
  let db: Database;

  const ATRIBUTOS: AttributeSpec[] = [
    {
      code: "cavalo.finame",
      dataType: "NUMERIC",
      semanticsStatus: "CONFIRMED",
      unit: "BRL",
      periodicity: "MENSAL",
      aggregation: "SUM",
      isMonetary: true,
    },
  ];

  /*
    Vinte veículos com placas cujos dígitos **não** aparecem nos valores — que é
    a condição em que a régua antiga reprovava. Um fixture com placas que casam
    os valores por acaso não distinguiria as duas implementações.
  */
  const PLACAS = Array.from({ length: 20 }, (_, i) => {
    const n = String(i + 41).padStart(2, "0"); // 41..60
    return `KLM${(i % 9) + 1}N${n}`;
  });

  beforeAll(async () => {
    ctx = await createTestDatabase("lastro_identificador");
    db = ctx.db;
    const antes: Record<string, Record<string, number>> = {};
    const depois: Record<string, Record<string, number>> = {};
    PLACAS.forEach((placa, i) => {
      antes[placa] = { "cavalo.finame": 9847.35 + i };
      depois[placa] = { "cavalo.finame": 4677.85 + i };
    });
    await buildFixture(
      db,
      ATRIBUTOS,
      [
        { label: "antes", effectiveDate: "2026-07-02", data: antes },
        { label: "depois", effectiveDate: "2026-08-01", data: depois },
      ],
      { entityType: "CAVALO", scopeHash: "hash-fundo", canal: "EMPURRADA" },
    );
    /*
      As comparações são estado derivado e não nascem com a fixture. Em produção
      quem as materializa é `garantirRecorte`, antes de qualquer resposta; aqui
      as ferramentas são chamadas direto, sem passar por lá — que é exatamente o
      buraco que a auditoria de integridade já encontrou uma vez, aprovando
      dezessete casos sobre conteúdo vazio.
    */
    await computeMissingChangeSets(db, "teste:lastro");
  }, 120_000);

  afterAll(async () => {
    await ctx?.drop();
  });

  it("vinte veículos nomeados, valores em pt-BR, zero frases podadas", async () => {
    const reg = registroPadrao();
    const ferramentas = { db, recorte: { scopeHash: "hash-fundo" } };

    const grupos = await executar(reg, "alteracoes", { nivel: "grupos", limite: 5 }, ferramentas);
    const g = (grupos.conteudo as { grupos: { atributo: string; equipamento: string }[] }).grupos[0]!;
    const linhas = await executar(
      reg,
      "alteracoes",
      { nivel: "linhas", atributo: g.atributo, equipamento: g.equipamento, limite: 20 },
      ferramentas,
    );
    const conteudo = linhas.conteudo as {
      linhas: { placa: string; antesNumerico: number; depoisNumerico: number; impacto: number | null }[];
    };
    expect(conteudo.linhas.length).toBe(20);

    const brl = (n: number) =>
      n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    /*
      O texto é escrito como o prompt manda escrever — português do Brasil,
      vírgula decimal, uma frase por veículo. Cada número sai do que a consulta
      devolveu; nada aqui é inventado, e é por isso que zero frases podadas é a
      asserção certa.
    */
    const texto = conteudo.linhas
      .map(
        (l) =>
          `O ${l.placa} passou de R$ ${brl(l.antesNumerico)} para R$ ${brl(l.depoisNumerico)}, ` +
          `um efeito de R$ ${brl(l.impacto ?? 0)} por mês [1].`,
      )
      .join(" ");

    const dossie = dossieDe(evidenciasDe([grupos, linhas]));
    const s = sanear(texto, dossie);

    expect(s.recusados, `recusados: ${s.recusados.join(", ")}`).toEqual([]);
    expect(s.removidas).toBe(0);
    expect(s.irrecuperavel).toBe(false);
    // Todos os vinte continuam nomeados no texto que chega à tela.
    for (const linha of conteudo.linhas) expect(s.texto).toContain(linha.placa);
  }, 60_000);

  it("uma placa inventada no meio da lista derruba só a frase dela", async () => {
    const reg = registroPadrao();
    const ferramentas = { db, recorte: { scopeHash: "hash-fundo" } };
    const grupos = await executar(reg, "alteracoes", { nivel: "grupos", limite: 5 }, ferramentas);
    const g = (grupos.conteudo as { grupos: { atributo: string; equipamento: string }[] }).grupos[0]!;
    const linhas = await executar(
      reg,
      "alteracoes",
      { nivel: "linhas", atributo: g.atributo, equipamento: g.equipamento, limite: 20 },
      ferramentas,
    );
    const dossie = dossieDe(evidenciasDe([grupos, linhas]));
    const conteudo = linhas.conteudo as { linhas: { placa: string }[] };

    const texto =
      `O ${conteudo.linhas[0]!.placa} caiu. ` +
      "O WWW8X88 também caiu. " +
      `O ${conteudo.linhas[1]!.placa} caiu.`;
    const s = sanear(texto, dossie);

    expect(s.removidas).toBe(1);
    expect(s.recusados).toEqual(["WWW8X88"]);
    expect(s.texto).not.toContain("WWW8X88");
    expect(s.texto).toContain(conteudo.linhas[0]!.placa);
    expect(s.texto).toContain(conteudo.linhas[1]!.placa);
  }, 60_000);
});
