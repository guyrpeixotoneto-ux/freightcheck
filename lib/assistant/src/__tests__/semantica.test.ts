import { afterEach, describe, expect, it, vi } from "vitest";
import { sugerirSemantica } from "../semantica";

/**
 * A sugestão preenche os campos que destravam dinheiro.
 *
 * É o que a separa das outras duas chamadas de IA da Curadoria: o rascunho de
 * "O que é" cai num campo de prosa, a leitura da fórmula morre numa caixa — e
 * esta escolhe unidade, periodicidade, agregação e "entra em somas", que são
 * exatamente os quatro campos que o motor financeiro lê. Por isso as fronteiras
 * presas aqui valem mais do que nas outras:
 *
 * - **Nunca lança.** O formulário continua preenchível e confirmável à mão sem
 *   sugestão nenhuma, e uma exceção vinda daqui derrubaria um pedido que não
 *   depende dela.
 * - **Palpite só existe quando um modelo palpitou.** Todo desfecho que não é
 *   `IA` devolve `sugestao: null`. No dia em que um deles passar a devolver
 *   valores montados em código, eles cairiam nos selects com a mesma cara de uma
 *   escolha lida no dado — e é este arquivo que falha antes disso chegar à tela.
 * - **Sem valor importado, não se pergunta.** Um atributo sem fato nenhum
 *   curto-circuita antes da rede: o que sobraria para o modelo ler seria o nome
 *   da coluna, e adivinhar semântica por nome de coluna é o que esta tela existe
 *   para impedir.
 *
 * O caminho com chave configurada não é testado aqui de propósito: ele é uma
 * chamada de rede a um modelo, e um teste que precisa de crédito para passar não
 * roda no CI de ninguém.
 */

afterEach(() => vi.unstubAllEnvs());

/** Uma coluna qualquer, com dado suficiente para a pergunta fazer sentido. */
const COLUNA = {
  codigo: "equipamento.ipva",
  nomeDeOrigem: "ipva",
  entidade: "EQUIPAMENTO",
  tipoDeDado: "NUMERIC",
  valores: 120,
  ausentes: 3,
  amostras: [
    { vigencia: "2024-01", valor: "4210.55", original: "4.210,55", tipoDeOrigem: "NUMBER" },
    { vigencia: "2024-01", valor: "3980.10", original: "3.980,10", tipoDeOrigem: "NUMBER" },
  ],
  historico: [
    { vigencia: "2024-01", soma: 501234.5, quantidade: 120 },
    { vigencia: "2024-07", soma: 528901.2, quantidade: 126 },
  ],
};

describe("o que nem chega a virar chamada", () => {
  it("recusa atributo sem valor importado antes de gastar uma chamada", async () => {
    // A chave é falsa de propósito: se o atributo vazio não curto-circuitasse,
    // este teste tentaria a rede e falharia de outro jeito — que é o sinal
    // desejado.
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-nao-usada");

    const r = await sugerirSemantica({ ...COLUNA, valores: 0, ausentes: 40 });

    expect(r.motivo).toBe("SEM_DADOS");
    expect(r.sugestao).toBeNull();
  });

  it("diz que não há sugestão quando não há chave, em vez de inventar uma", async () => {
    /*
      Não há plano B aqui — e não é por falta de código. O motor determinístico
      de `@workspace/curation` já propõe pelo nome e pela estatística, e ele roda
      por conta própria; o que este botão acrescenta é a leitura do valor. Devolver
      a proposta do motor por baixo do rótulo "leitura da IA" atribuiria ao modelo
      uma escolha que ele não fez.
    */
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    const r = await sugerirSemantica(COLUNA);

    expect(r.motivo).toBe("SEM_CHAVE");
    expect(r.sugestao).toBeNull();
  });

  it("não lança nunca — a tela de curadoria não depende dela", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    await expect(sugerirSemantica(COLUNA)).resolves.toBeDefined();
  });
});

describe("só o modelo palpita", () => {
  it("todo desfecho que não é IA volta sem sugestão", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");

    for (const valores of [0, 1, 120]) {
      const r = await sugerirSemantica({ ...COLUNA, valores });
      expect(r.motivo).not.toBe("IA");
      expect(r.sugestao).toBeNull();
      // O modelo sai na resposta mesmo sem sugestão: a tela usa isso para dizer
      // qual modelo *palpitaria*, e não para afirmar que um palpitou.
      expect(r.modelo).toBeTruthy();
    }
  });
});
