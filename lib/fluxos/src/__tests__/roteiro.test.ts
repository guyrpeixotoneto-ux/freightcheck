import { describe, expect, it } from "vitest";
import { etapasDoRoteiro, interpretarRoteiro, tipoDeEtapaEscrito } from "../roteiro";
import { RecusaDeFluxo } from "../validacao";

/**
 * O ROTEIRO — o atalho que faz um processo de treze etapas custar uma colagem.
 *
 * Tudo aqui é função pura, e é onde a gramática do texto realmente é decidida:
 * o que vira etapa, o que vira seta, e o que é recusado com nome antes de
 * qualquer gravação. A prova que mais importa é a última — o macrofluxo da
 * operação empurrada escrito como texto produz o mesmo desenho que a declaração
 * do modelo, incluindo a bifurcação das integrações.
 */
describe("interpretarRoteiro", () => {
  it("uma linha vira uma etapa, e a ordem do texto é a ordem do processo", () => {
    const { etapas, conexoes } = interpretarRoteiro("Primeira\nSegunda\nTerceira");

    expect(etapas.map((e) => e.nome)).toEqual(["Primeira", "Segunda", "Terceira"]);
    expect(etapas.map((e) => e.ordem)).toEqual([0, 1, 2]);
    expect(etapas.every((e) => e.tipo === "PROCESSO")).toBe(true);
    expect(conexoes.map((c) => `${c.de}→${c.para}`)).toEqual([
      "linha-1→linha-2",
      "linha-2→linha-3",
    ]);
  });

  it("ignora linha em branco e comentário, e não os conta como etapa", () => {
    const { etapas } = interpretarRoteiro("# o processo\n\nPrimeira\n\n  \n# outra nota\nSegunda\n");
    expect(etapas.map((e) => e.nome)).toEqual(["Primeira", "Segunda"]);
  });

  it("os campos separados por barra são nome, área e sistema", () => {
    const { etapas } = interpretarRoteiro("Validação da tarifa | Ambev / Operação | SAP");
    expect(etapas[0]).toMatchObject({
      nome: "Validação da tarifa",
      area: "Ambev / Operação",
      sistemaPrincipal: "SAP",
    });
  });

  it("área e sistema são opcionais, e o que falta vira nulo — nunca string vazia", () => {
    const { etapas } = interpretarRoteiro("Só o nome\nCom área | Fiscal\nVazio no meio |  | SAP");
    expect(etapas[0]).toMatchObject({ area: null, sistemaPrincipal: null });
    expect(etapas[1]).toMatchObject({ area: "Fiscal", sistemaPrincipal: null });
    expect(etapas[2]).toMatchObject({ area: null, sistemaPrincipal: "SAP" });
  });

  it("o marcador entre colchetes escolhe o tipo, com ou sem acento e em qualquer caixa", () => {
    const { etapas } = interpretarRoteiro("[inicio] Começo\n[DECISÃO] Autorizado?\n[Fim] Acabou");
    expect(etapas.map((e) => e.tipo)).toEqual(["INICIO", "DECISAO", "FIM"]);
  });

  it('"+" põe a etapa em paralelo: as duas nascem da mesma anterior e a próxima recebe as duas', () => {
    const { etapas, conexoes } = interpretarRoteiro(
      "Emissão\nIntegração com Rodopar\n+ Integração com Connect\nAuditoria fiscal",
    );

    expect(etapas).toHaveLength(4);
    expect(conexoes.map((c) => `${c.de}→${c.para}`)).toEqual([
      /* as duas integrações saem da emissão, e não uma da outra */
      "linha-1→linha-2",
      "linha-1→linha-3",
      /* e a auditoria recebe as duas */
      "linha-2→linha-4",
      "linha-3→linha-4",
    ]);
  });

  it("três ramos em paralelo abrem e fecham juntos", () => {
    const { conexoes } = interpretarRoteiro("Fonte\nA\n+ B\n+ C\nJunta");
    expect(conexoes.map((c) => `${c.de}→${c.para}`)).toEqual([
      "linha-1→linha-2",
      "linha-1→linha-3",
      "linha-1→linha-4",
      "linha-2→linha-5",
      "linha-3→linha-5",
      "linha-4→linha-5",
    ]);
  });

  it("o prefixo das chaves é escolhido por quem chama — é o que evita colisão ao acrescentar", () => {
    const { etapas, conexoes } = interpretarRoteiro("Uma\nOutra", {
      prefixoDaChave: "nova",
      ordemInicial: 7,
    });
    expect(etapas.map((e) => e.chave)).toEqual(["nova-1", "nova-2"]);
    expect(etapas.map((e) => e.ordem)).toEqual([7, 8]);
    expect(conexoes[0]).toMatchObject({ de: "nova-1", para: "nova-2" });
  });

  describe("as recusas — todas com nome, e antes de qualquer gravação", () => {
    it("recusa texto sem nenhuma etapa", () => {
      expect(() => interpretarRoteiro("\n\n# só comentário\n")).toThrow(
        expect.objectContaining({ codigo: "ROTEIRO_VAZIO" }),
      );
    });

    it("recusa etapa sem nome", () => {
      expect(() => interpretarRoteiro("Primeira\n| Fiscal | SAP")).toThrow(
        expect.objectContaining({ codigo: "ROTEIRO_ETAPA_SEM_NOME" }),
      );
    });

    it("recusa um tipo que não está no catálogo, e diz quais valem", () => {
      try {
        interpretarRoteiro("[carimbo] Alguma coisa");
        expect.unreachable("deveria ter recusado");
      } catch (erro) {
        expect(erro).toBeInstanceOf(RecusaDeFluxo);
        expect((erro as RecusaDeFluxo).codigo).toBe("ROTEIRO_TIPO_DESCONHECIDO");
        expect((erro as Error).message).toContain("decisao");
      }
    });

    it("recusa mais de três campos na linha", () => {
      expect(() => interpretarRoteiro("Nome | Área | Sistema | sobra")).toThrow(
        expect.objectContaining({ codigo: "ROTEIRO_CAMPOS_DEMAIS" }),
      );
    });

    it('recusa "+" na primeira linha — não há com o que paralelizar', () => {
      expect(() => interpretarRoteiro("+ Sozinha")).toThrow(
        expect.objectContaining({ codigo: "ROTEIRO_PARALELA_SEM_ANTERIOR" }),
      );
    });

    it("recusa um roteiro longo demais em vez de gravar uma colagem acidental", () => {
      const texto = Array.from({ length: 200 }, (_, i) => `Etapa ${i}`).join("\n");
      expect(() => interpretarRoteiro(texto)).toThrow(
        expect.objectContaining({ codigo: "ROTEIRO_LONGO_DEMAIS" }),
      );
    });

    it("a mensagem cita o número da linha original, contando as ignoradas", () => {
      try {
        interpretarRoteiro("# nota\nPrimeira\n\n[nada] Terceira");
        expect.unreachable("deveria ter recusado");
      } catch (erro) {
        expect((erro as Error).message).toContain("Linha 4");
      }
    });

    it("um texto que não é texto é recusado como vazio, e não derruba nada", () => {
      expect(() => interpretarRoteiro(undefined)).toThrow(
        expect.objectContaining({ codigo: "ROTEIRO_VAZIO" }),
      );
    });
  });

  it("o macrofluxo da operação empurrada cabe num roteiro, bifurcação incluída", () => {
    const { etapas, conexoes } = interpretarRoteiro(`
# Operação empurrada — do faturamento ao recebimento
[inicio] Origem da tarifa / trecho | Operação / Faturamento | Freitec / TMS
[validacao] Validação da tarifa | Ambev / Operação | SAP
[sistema] Solicitação de emissão | Ambev / Operação | SAP → Unidox
[documento] Emissão do documento | Ambev / Sistema | Unidox
[sistema] Integração com Rodopar | Sistemas / TI | Rodopar
+ [sistema] Integração com Connect | Sistemas / TI | Connect
[validacao] Auditoria fiscal | Fiscal | Rodopar × Unidox × SEFAZ
Status de pagamento | Contas a receber / Operação | Connect
Encontro de contas | Operação / Contas a receber | Connect
[pendencia] Pendências | Operação / Contas a receber | Rodopar
Fechamento / classificação | Operação | Planilha
Provisão de recebimento | Contas a receber / Financeiro | Automação Ambev
Crédito e baixa | Financeiro / Contas a receber | Banco + Rodopar
[fim] Conciliação bancária | Contas a receber / Financeiro | Extrato bancário
`);

    expect(etapas).toHaveLength(14);
    expect(etapas[0].tipo).toBe("INICIO");
    expect(etapas.at(-1)?.tipo).toBe("FIM");

    /* A auditoria fiscal só começa depois dos dois ramos da integração. */
    const paraAuditoria = conexoes.filter((c) => c.para === "linha-7");
    expect(paraAuditoria.map((c) => c.de).sort()).toEqual(["linha-5", "linha-6"]);
  });
});

describe("tipoDeEtapaEscrito", () => {
  it("aceita o valor do catálogo e o rótulo, e devolve nulo para o resto", () => {
    expect(tipoDeEtapaEscrito("VALIDACAO")).toBe("VALIDACAO");
    expect(tipoDeEtapaEscrito("validação")).toBe("VALIDACAO");
    expect(tipoDeEtapaEscrito("Pendência")).toBe("PENDENCIA");
    expect(tipoDeEtapaEscrito("qualquer outra coisa")).toBeNull();
  });
});

describe("etapasDoRoteiro", () => {
  /*
    A contagem é o que a tela mostra enquanto se digita, e ela existe em dois
    lugares — aqui e em `artifacts/freightaudit/src/lib/fluxos.ts`, porque o
    pacote da tela não importa o motor. Os dois testes afirmam a mesma regra:
    linha vazia e comentário não contam, e a contagem é igual ao número de
    etapas que a interpretação cria.
  */
  it("conta o que a interpretação vai criar, e nada mais", () => {
    const texto = "# nota\n\nPrimeira\nSegunda\n+ Paralela\n";
    expect(etapasDoRoteiro(texto)).toBe(3);
    expect(interpretarRoteiro(texto).etapas).toHaveLength(3);
  });

  it("texto vazio conta zero, sem recusar — a caixa começa vazia", () => {
    expect(etapasDoRoteiro("")).toBe(0);
    expect(etapasDoRoteiro("   \n\n")).toBe(0);
  });
});
