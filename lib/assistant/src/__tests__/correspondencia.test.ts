/**
 * Semelhança não é correspondência — provado nos três casos que a expuseram.
 *
 * A bateria de aceitação mediu, contra o export real promovido, que o assistente
 * respondia perguntas sobre entidades inexistentes com o vizinho mais próximo,
 * sem dizer que havia trocado: `lacunas` vazia, `desambiguacao` nula, e um texto
 * que se lê como resposta. Os três casos estão aqui, um a um, e cada um prova as
 * duas metades da mesma regra — que a troca é recusada, e que o vizinho é
 * oferecido em vez de usado.
 *
 * **Estes testes são de unidade, e é de propósito.** O portão é uma função pura
 * sobre "o que foi nomeado" e "o que voltou": exercitá-lo sem banco é o que
 * permite rodar os cinco casos em milissegundos e é o que garante que a prova
 * seja sobre a regra, e não sobre o conteúdo do banco de quem a rodou. A prova
 * de que a regra chega à resposta inteira — com banco, orquestração e redação —
 * é `correspondencia-real.test.ts`, ao lado.
 */
import { describe, expect, it } from "vitest";
import {
  conferirCorrespondencia,
  cobre,
  desambiguacaoDe,
  ehAbreviacaoOuExpansao,
  explicarFalta,
  placasNomeadas,
  tokensDeConteudo,
  tokensQueNomeiam,
  unidadesNomeadas,
} from "../correspondencia";

/** O vocabulário do produto, reduzido ao que estes casos precisam. */
const VOCABULARIO = new Set(["operacao", "transferencia", "carga", "manutencao", "consumo"]);

/** Um pedido em que nada foi nomeado e nada falta — a base de cada caso. */
const NADA = {
  termoNomeado: null,
  placasDesconhecidas: [],
  unidadesDesconhecidas: [],
  material: { identidades: [], vizinhos: [] },
};

describe("placa que não existe", () => {
  it("é reconhecida pela forma e recusada por não estar no banco", () => {
    expect(placasNomeadas("Qual o IPVA do cavalo XYZ9Z99?")).toEqual(["XYZ9Z99"]);
    // O padrão antigo continua valendo enquanto houver equipamento não replacado.
    expect(placasNomeadas("e a ABC1234?")).toEqual(["ABC1234"]);
    expect(placasNomeadas("Quanto mudou o IPVA?")).toEqual([]);
  });

  it("vira NAO_ENCONTREI sem nenhum vizinho para oferecer", () => {
    const falhas = conferirCorrespondencia({ ...NADA, placasDesconhecidas: ["XYZ9Z99"] });

    expect(falhas).toHaveLength(1);
    expect(falhas[0]!.entidade).toEqual({ tipo: "PLACA", citada: "XYZ9Z99" });
    /*
      Placa não ganha vizinho, e isto é a regra e não uma omissão: propor
      "você quis dizer XYZ9Z98?" é palpite sobre a identidade de um ativo, e um
      ativo errado numa apuração financeira é pior do que resposta nenhuma.
    */
    expect(falhas[0]!.vizinhos).toEqual([]);
    expect(desambiguacaoDe(falhas)).toBeNull();
  });

  it("a frase diz que a regra genérica do Book não é dado daquele veículo", () => {
    const texto = explicarFalta(
      conferirCorrespondencia({ ...NADA, placasDesconhecidas: ["XYZ9Z99"] }),
    );

    expect(texto).toMatch(/não encontrei a placa XYZ9Z99/i);
    expect(texto).toMatch(/regra geral do Book não é dado deste veículo/i);
  });
});

describe("unidade que não existe", () => {
  it("é reconhecida pela construção, e só quando nomeia algo fora do vocabulário", () => {
    expect(unidadesNomeadas("Como está a operação de Uberlândia?", VOCABULARIO)).toEqual([
      "Uberlândia",
    ]);
    // "operação de transferência" casa a construção e não nomeia lugar nenhum.
    expect(unidadesNomeadas("Como funciona a operação de transferência?", VOCABULARIO)).toEqual([]);
    expect(unidadesNomeadas("O que mudou na última vigência?", VOCABULARIO)).toEqual([]);
  });

  it("vira NAO_ENCONTREI e lista as unidades que existem", () => {
    const falhas = conferirCorrespondencia({
      ...NADA,
      unidadesDesconhecidas: [{ citada: "Uberlândia", existentes: ["CAMAÇARI", "OPERALOG"] }],
    });

    expect(falhas).toHaveLength(1);
    expect(falhas[0]!.entidade.tipo).toBe("UNIDADE");

    const texto = explicarFalta(falhas);
    expect(texto).toMatch(/não encontrei a unidade Uberlândia/i);
    expect(texto).toMatch(/CAMAÇARI/);
    expect(texto).toMatch(/OPERALOG/);
    /*
      Entre duas unidades não há vizinhança semântica — são lugares. Listar o
      que existe é informação; propor a mais parecida seria palpite.
    */
    expect(texto).not.toMatch(/quis dizer/i);
  });
});

describe("bloco pedido que não é o bloco recuperado", () => {
  const pedidoQLP = {
    ...NADA,
    termoNomeado: "qlp administrativo",
    material: {
      identidades: ["DESCONTO QLP ADM", "DESCONTO QLP ADM Escala", "QLP ADM Critérios"],
      vizinhos: ["DESCONTO QLP ADM", "QLP ADM"],
    },
  };

  it("QLP ADMINISTRATIVO DE FROTA não vira DESCONTO QLP ADM em silêncio", () => {
    const falhas = conferirCorrespondencia(pedidoQLP);

    expect(falhas).toHaveLength(1);
    expect(falhas[0]!.entidade).toEqual({ tipo: "BLOCO", citada: "qlp administrativo" });
  });

  it("o candidato próximo aparece só em desambiguacao, nunca como resposta", () => {
    const falhas = conferirCorrespondencia(pedidoQLP);

    expect(desambiguacaoDe(falhas)).toEqual({
      termo: "qlp administrativo",
      opcoes: ["DESCONTO QLP ADM", "QLP ADM"],
    });

    const texto = explicarFalta(falhas);
    expect(texto).toMatch(/não encontrei "qlp administrativo"/i);
    expect(texto).toMatch(/quis dizer/i);
    expect(texto).toMatch(/não é o que você pediu/i);
  });

  it("abreviação não é correspondência: `adm` não cobre `administrativo`", () => {
    /*
      É esta linha que separa este portão de um casador difuso. `QLP ADM` é, na
      vida real, a abreviação de QLP Administrativo — e mesmo assim não pode
      responder por ela, porque o bloco pedido não existe e quem decide se o
      abreviado serve é quem perguntou.
    */
    expect(cobre(["qlp", "administrativo"], ["desconto", "qlp", "adm"])).toBe(false);
    expect(ehAbreviacaoOuExpansao("administrativo", "adm")).toBe(true);
  });
});

describe("a correspondência válida continua passando", () => {
  it("o bloco cujo nome cobre o termo não é recusado", () => {
    expect(
      conferirCorrespondencia({
        ...NADA,
        termoNomeado: "consumo",
        material: { identidades: ["CONSUMO DE COMBUSTÍVEIS"], vizinhos: ["CONSUMO DE COMBUSTÍVEIS"] },
      }),
    ).toEqual([]);
  });

  it("a seção do bloco também é identidade — IPVA dentro de CUSTO FIXO", () => {
    expect(
      conferirCorrespondencia({
        ...NADA,
        termoNomeado: "ipva",
        material: {
          identidades: ["CUSTO FIXO DE EQUIPAMENTOS", "CUSTO FIXO DE EQUIPAMENTOS IPVA"],
          vizinhos: ["CUSTO FIXO DE EQUIPAMENTOS"],
        },
      }),
    ).toEqual([]);
  });

  it("cobertura zero é busca vazia, não troca — quem responde é a lacuna de sempre", () => {
    /*
      Sem nenhuma palavra em comum não houve substituição: houve uma busca que
      não achou nada, e a orquestração já tinha o `NAO_ENCONTREI` para isso.
      Disparar aqui produziria duas lacunas para o mesmo silêncio.
    */
    expect(
      conferirCorrespondencia({
        ...NADA,
        termoNomeado: "pedagio",
        material: { identidades: ["MANUTENÇÃO"], vizinhos: ["MANUTENÇÃO"] },
      }),
    ).toEqual([]);
  });

  /*
    Estes são os casos que reprovaram sete categorias da suíte quando o portão
    disparava só por cobertura parcial. Cada um é uma pergunta legítima em que
    sobra uma palavra que descreve **o que se pergunta sobre** a entidade — e
    nenhuma delas é abreviação de coisa nenhuma.
  */
  it.each([
    ["evolucao pneu", ["PNEU"]],
    ["evolucao financiamento", ["Financiamento"]],
    ["frequencia auditoria qlp adm", ["QLP ADM", "QLP ADM Critérios"]],
    ["prazo contestar desconto qlp adm", ["DESCONTO QLP ADM", "DESCONTO QLP ADM Prazo de contestação"]],
    ["nenhuma pneu", ["PNEU"]],
  ])("palavra de aspecto não é troca: %s", (termoNomeado, identidades) => {
    expect(
      conferirCorrespondencia({
        ...NADA,
        termoNomeado,
        material: { identidades, vizinhos: identidades },
      }),
    ).toEqual([]);
  });

  it("inflexão não é abreviação — `consumo` e `consumos` são a mesma coisa", () => {
    expect(ehAbreviacaoOuExpansao("consumo", "consumos")).toBe(false);
    expect(ehAbreviacaoOuExpansao("pneu", "pneus")).toBe(false);
  });
});

describe("o que, numa pergunta, nomeia alguma coisa", () => {
  it("verbo de pedido não nomeia — senão `fale manutenção` recusaria MANUTENÇÃO", () => {
    expect(tokensDeConteudo("fale manutencao")).toEqual(["manutencao"]);
  });

  it("data, ano e número não nomeiam coluna nenhuma", () => {
    /*
      É a origem do defeito de `orquestrador.ts`: a lacuna era montada com o
      resíduo da frase, e `agosto/2026` virava a afirmação de que o export não
      traz uma coluna chamada 2026.
    */
    expect(tokensDeConteudo("valor manutencao agosto 2026")).toEqual(["valor", "manutencao"]);
  });

  it("palavra de medida nomeia para a lacuna e não para a correspondência", () => {
    // A lacuna do qualificador precisa de "valor" para dizer que a gaveta não
    // tem coluna monetária; o portão não pode contá-la como nome de entidade.
    expect(tokensDeConteudo("valor manutencao")).toContain("valor");
    expect(tokensQueNomeiam("valor manutencao")).toEqual(["manutencao"]);
  });
});
