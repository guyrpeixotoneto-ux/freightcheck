import { describe, expect, it } from "vitest";
import {
  motivoSemNumeros,
  resumirIntervalo,
  tambemEmOutraPeriodicidade,
} from "@/hooks/use-resumo-por-vigencia";

/**
 * A coluna de números do seletor "Trocar vigência".
 *
 * O menu listava data e contagem, e a contagem sozinha não separa a vigência
 * que mudou o contrato da que mexeu em muita linha barata: 402 alterações em
 * abril e 400 em março são o mesmo número até que o dinheiro apareça ao lado.
 *
 * Duas recusas atravessam o arquivo, e são as mesmas do resto do produto:
 * periodicidades não somam, e zero não é ausência.
 */

const linha = (period: string, changes: number, byPeriodicity: Record<string, number>) => ({
  period,
  changes,
  impact: { byPeriodicity },
});

describe("resumirIntervalo", () => {
  it("escreve a coluna na periodicidade que mais moveu no intervalo", () => {
    const resumo = resumirIntervalo([
      linha("2026-07-01", 400, { MENSAL: -12_000, ANUAL: -900 }),
      linha("2026-08-01", 402, { MENSAL: 3_000, ANUAL: -400 }),
    ]);

    expect(resumo.periodicidade).toBe("MENSAL");
    /*
      `outrasPeriodicidades` traz o anual **mesmo com número na coluna**.

      Era vazio aqui, com o argumento de que o número publicado já era a
      resposta. O dado real desmentiu o argumento: julho/2026 tem
      −R$ 11.712,30/mês na coluna e −R$ 144.874,50/ano fora dela — dez vezes
      mais dinheiro, invisível na lista inteira. A coluna continua sendo de uma
      periodicidade só; o que mudou é que a outra deixou de sumir.
    */
    expect(resumo.porVigencia.get("2026-07-01")).toEqual({
      alteracoes: 400,
      impacto: -12_000,
      outrasPeriodicidades: ["ANUAL"],
    });
    expect(resumo.porVigencia.get("2026-08-01")).toEqual({
      alteracoes: 402,
      impacto: 3_000,
      outrasPeriodicidades: ["ANUAL"],
    });
  });

  it("a dominante é a que aparece em mais vigências, e não a que moveu mais dinheiro", () => {
    /*
      Camaçari, 17/09/2026. Uma vigência com −R$ 590.438/ano contra oito com
      dezenas de milhares por mês cada. Pelo volume a coluna saía em R$/ano e
      ficava muda em oito das nove linhas — e o menu do FINAME, na tela ao
      lado, mostrava as oito com dinheiro. Um menu em branco não diz "esta
      régua não se aplica aqui"; diz "não teve nada".
    */
    const resumo = resumirIntervalo([
      linha("2026-01-16", 560, { ANUAL: -590_438 }),
      linha("2026-02-16", 350, { MENSAL: -45_292 }),
      linha("2026-03-16", 400, { MENSAL: -17_545 }),
      linha("2026-04-16", 402, { MENSAL: -34_133 }),
      linha("2026-05-16", 383, { MENSAL: -61_886 }),
      linha("2026-06-16", 269, { MENSAL: -17_171 }),
    ]);

    expect(resumo.periodicidade).toBe("MENSAL");
    expect(resumo.porVigencia.get("2026-05-16")?.impacto).toBe(-61_886);
  });

  it("empatadas na presença, decide o que moveu", () => {
    /*
      O volume não saiu de cena: ele é o desempate, e continua sendo a soma
      dos módulos e não do líquido — ver o caso abaixo.
    */
    const resumo = resumirIntervalo([
      linha("2026-07-01", 10, { MENSAL: 1_000, ANUAL: 90_000 }),
      linha("2026-08-01", 10, { MENSAL: 2_000, ANUAL: 80_000 }),
    ]);

    expect(resumo.periodicidade).toBe("ANUAL");
  });

  it("a vigência sem dinheiro na régua da coluna diz em qual régua ele está", () => {
    const resumo = resumirIntervalo([
      linha("2026-07-01", 400, { MENSAL: -12_000 }),
      linha("2026-08-01", 402, { MENSAL: -3_000 }),
      linha("2026-09-01", 560, { ANUAL: -590_438 }),
    ]);

    expect(resumo.periodicidade).toBe("MENSAL");
    expect(resumo.porVigencia.get("2026-09-01")).toEqual({
      alteracoes: 560,
      impacto: null,
      outrasPeriodicidades: ["ANUAL"],
    });

    const nota = motivoSemNumeros("2026-09-01", resumo);
    expect(nota?.curto).toBe("sem R$/mês");
    expect(nota?.porque).toContain("R$/ano");
  });

  it("quem tem número na coluna não ganha a nota de ausência — ganha a de grandeza", () => {
    /*
      Duas notas diferentes, e é essa distinção que o teste trava:

      - `motivoSemNumeros` responde "por que esta linha está vazia", e continua
        `null` aqui: a linha **tem** número;
      - `tambemEmOutraPeriodicidade` responde "o que a coluna não publica", e é
        a correção de 18/09/2026 — sem ela, a maior parte do dinheiro de uma
        vigência mista não aparecia em lugar nenhum do seletor.
    */
    const resumo = resumirIntervalo([
      linha("2026-07-01", 400, { MENSAL: -12_000, ANUAL: -900 }),
      linha("2026-08-01", 402, { MENSAL: -3_000 }),
    ]);

    expect(resumo.porVigencia.get("2026-07-01")?.outrasPeriodicidades).toEqual(["ANUAL"]);
    expect(motivoSemNumeros("2026-07-01", resumo)).toBeNull();

    const tambem = tambemEmOutraPeriodicidade("2026-07-01", resumo);
    expect(tambem?.curto).toBe("+ R$/ano");
    expect(tambem?.porque).toContain("a coluna não publica");

    // A vigência que só tem a grandeza da coluna não ganha nota nenhuma.
    expect(resumo.porVigencia.get("2026-08-01")?.outrasPeriodicidades).toEqual([]);
    expect(tambemEmOutraPeriodicidade("2026-08-01", resumo)).toBeNull();
  });

  it("vigência que não apurou nada em régua nenhuma continua sem nota de régua", () => {
    /*
      Ela não tem dinheiro noutra periodicidade — ela não tem dinheiro. Dizer
      "sem R$/mês" aqui sugeriria que o valor está noutro lugar da tela, e não
      está em lugar nenhum: é o que a coluna "sem impacto calculável" conta.
    */
    const resumo = resumirIntervalo([
      linha("2026-07-01", 400, { MENSAL: -12_000 }),
      linha("2026-08-01", 6, {}),
    ]);

    expect(motivoSemNumeros("2026-08-01", resumo)).toBeNull();
  });

  it("a dominante é a que mais moveu, e não a de maior saldo", () => {
    /*
      MENSAL move R$ 100.000 e termina em zero; ANUAL move R$ 900 e termina em
      R$ 900. Escolher pelo líquido faria a coluna falar da periodicidade que
      quase não se mexeu e calar a que virou o mês do avesso.
    */
    const resumo = resumirIntervalo([
      linha("2026-07-01", 10, { MENSAL: 50_000, ANUAL: 900 }),
      linha("2026-08-01", 10, { MENSAL: -50_000 }),
    ]);

    expect(resumo.periodicidade).toBe("MENSAL");
    expect(resumo.porVigencia.get("2026-07-01")?.impacto).toBe(50_000);
  });

  it("vigência sem valor apurado na periodicidade da coluna fica sem número, e não com zero", () => {
    const resumo = resumirIntervalo([
      linha("2026-07-01", 400, { MENSAL: -12_000 }),
      // Alterações houve; preço nenhum saiu delas.
      linha("2026-08-01", 6, {}),
      // E aqui saiu, e deu exatamente zero: ganhos e perdas se anularam.
      linha("2026-09-01", 40, { MENSAL: 0 }),
    ]);

    expect(resumo.porVigencia.get("2026-08-01")).toEqual({
      alteracoes: 6,
      impacto: null,
      outrasPeriodicidades: [],
    });
    expect(resumo.porVigencia.get("2026-09-01")).toEqual({
      alteracoes: 40,
      impacto: 0,
      outrasPeriodicidades: [],
    });
  });

  it("sem impacto apurado em lugar nenhum, a coluna não existe — mas a contagem continua", () => {
    const resumo = resumirIntervalo([linha("2026-07-01", 400, {}), linha("2026-08-01", 6, {})]);

    expect(resumo.periodicidade).toBeNull();
    expect(resumo.porVigencia.get("2026-07-01")).toEqual({
      alteracoes: 400,
      impacto: null,
      outrasPeriodicidades: [],
    });
  });

  it("um intervalo vazio não inventa periodicidade", () => {
    expect(resumirIntervalo([])).toEqual({
      periodicidade: null,
      porVigencia: new Map(),
      semComparacao: new Set(),
      primeira: null,
    });
  });

  it("a escolha é estável no empate — a mesma lista não muda de coluna entre renderizações", () => {
    const linhas = [linha("2026-07-01", 10, { ANUAL: -1_000, MENSAL: 1_000 })];
    expect(resumirIntervalo(linhas).periodicidade).toBe("ANUAL");
    expect(resumirIntervalo([...linhas].reverse()).periodicidade).toBe("ANUAL");
  });
});

/**
 * A linha em branco do menu — e por que ela não podia continuar em branco.
 *
 * Uma vigência sem números tinha três causas possíveis e uma aparência só. A
 * leitura que sobrava para quem abre o menu era a única impossível: "esse mês
 * não teve importação". Vigência não importada não entra na lista — a lista é
 * feita das vigências importadas do contexto.
 */
describe("motivoSemNumeros", () => {
  const resumo = resumirIntervalo(
    [linha("2026-07-01", 400, { MENSAL: -12_000 }), linha("2026-08-01", 6, { MENSAL: -40 })],
    { gaps: [{ period: "2026-06-01" }], inicio: "2026-05-01" },
  );

  it("cala na vigência que tem números — a nota é só para a linha vazia", () => {
    expect(motivoSemNumeros("2026-07-01", resumo)).toBeNull();
  });

  it("diz 'sem comparação' na vigência importada que ninguém comparou", () => {
    expect(motivoSemNumeros("2026-06-01", resumo)?.curto).toBe("sem comparação");
  });

  it("diz 'primeira do histórico' na ponta de partida da leitura", () => {
    expect(motivoSemNumeros("2026-05-01", resumo)?.curto).toBe("primeira do histórico");
  });

  it("cala enquanto a leitura não chegou — 'não sei ainda' não vira 'sem comparação'", () => {
    /*
      É o estado da tela recém-aberta, e também o da Visão Geral servida por
      uma resposta antiga de cache, sem `gaps`. Escrever a nota aqui trocaria
      uma ausência ambígua por uma afirmação falsa que some um segundo depois.
    */
    const semLeitura = resumirIntervalo([]);
    expect(motivoSemNumeros("2026-06-01", semLeitura)).toBeNull();
  });

  it("cala na vigência fora do intervalo lido — ela não é lacuna nem ponta", () => {
    expect(motivoSemNumeros("2026-09-01", resumo)).toBeNull();
  });
});
