import { describe, expect, it } from "vitest";

import { somarVariavel, type ParametrosDoCadastro, type ViagemDoMapa } from "../mapa-rota";

/**
 * O CORTE DO CANAL — três casos, e o do meio é o único que sai.
 *
 * O 2Art traz as viagens da Rota e as do AS numa lista só. Separá-las custou
 * duas correções, e a segunda é o motivo deste arquivo existir: a regra
 * verificada contra as abas diárias da `.xlsb` sempre foi uma **conjunção** —
 * sai quem tem `CxRota = 0` **e** `CxAS > 0` —, e o código implementava só o
 * primeiro termo. `ViagemDoMapa` nem carregava `CxAS`, de modo que a regra
 * verificada era impossível de escrever.
 *
 * O termo que faltava separa dois casos opostos:
 *
 * | caso | `CxRota` | `CxAS` | entra? |
 * | --- | ---: | ---: | --- |
 * | viagem de Rota que entregou | `> 0` | qualquer | **sim** |
 * | viagem de AS | `0` | `> 0` | **não** |
 * | viagem de Rota que rodou vazia | `0` | `0` | **sim** |
 *
 * O terceiro caso é o que o corte largo perdia, e ele é dinheiro: seis viagens
 * de julho/2026 valendo R$ 1.727,06 no `CUSTO VARIÁVEL (FROTA FIXA)` da 2ª
 * quinzena. Ver `docs/MAPA-ROTA.md`.
 */

/* Os parâmetros reais da 2ª quinzena de julho/2026 — CDD Belém · Horizonte. */
const JULHO_2A: ParametrosDoCadastro = {
  aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
  parcelaDentroDoMunicipio: 0.0238,
  frotaFixaAtiva: 56,
  frotaFixaInativa: 8,
  remuneracaoFixaDaFrotaAtiva: 1424.91,
  remuneracaoDaEquipeDeEntrega: 8919.38,
  remuneracaoDoQlpAdministrativo: 4427.53,
  remuneracaoDeOutrasDespesas: 4361.07,
  remuneracaoDaFrotaInativa: 1650.97,
  vansAtivas: 7,
  custoFixoDaVan: 4693.85,
  custoDaEquipeDeEntregaDaVan: 4250.45,
  vansInativas: 6,
  remuneracaoDasVansInativas: 3195.18,
  rotasNoturnas: 1,
  custoDaNoturnaSemImposto: 8697.88,
  custoDeMarketingSemImposto: 0,
};
const PREVISTO_2A = 5246.67;
/** `1 − (PIS + COFINS + ICMS)` — o divisor de fora do município. */
const FORA = 1 - (0.0065 + 0.086 + 0.1784);

const viagem = (p: Partial<ViagemDoMapa> = {}): ViagemDoMapa => ({
  frota: "Padrao",
  cargaAtual: "Roteriz",
  tipoDeImposto: "CTRC-ICMS",
  valorFaturado: 289.02,
  caixasDeRota: 100,
  caixasDeAs: 0,
  tipoDeIndisponibilidade: "",
  ...p,
});

/** O valor de um mapa de frota fixa que saiu como CT-e — o caso das seis. */
const umMapaPorIcms = (PREVISTO_2A / 25) / FORA;

describe("os três casos do corte do canal", () => {
  it("CxRota > 0 → entra: é viagem de Rota que entregou", () => {
    const r = somarVariavel(
      [{ viagens: [viagem({ caixasDeRota: 100, caixasDeAs: 0 })] }],
      JULHO_2A,
      PREVISTO_2A,
    );
    expect(r.frotaFixa).toBeCloseTo(umMapaPorIcms, 2);
  });

  it("CxRota = 0 e CxAS > 0 → sai: é viagem do outro canal", () => {
    const r = somarVariavel(
      [{ viagens: [viagem({ caixasDeRota: 0, caixasDeAs: 586 })] }],
      JULHO_2A,
      PREVISTO_2A,
    );
    /* Nenhum mapa fechado da Rota neste dia — a parcela não soma. */
    expect(r.frotaFixa).toBe(0);
  });

  /*
    O caso que o corte largo perdia. O veículo saiu, o mapa fechou e a viagem
    foi paga; ela só não entregou caixa nenhuma. A remuneração da frota fixa é
    por mapa fechado, não por caixa entregue.
  */
  it("CxRota = 0 e CxAS = 0 → entra: é viagem de Rota que rodou vazia", () => {
    const r = somarVariavel(
      [{ viagens: [viagem({ caixasDeRota: 0, caixasDeAs: 0 })] }],
      JULHO_2A,
      PREVISTO_2A,
    );
    expect(r.frotaFixa).toBeCloseTo(umMapaPorIcms, 2);
  });

  it("uma viagem de Rota que entregou e uma de AS no mesmo dia contam um mapa", () => {
    const r = somarVariavel(
      [
        {
          viagens: [
            viagem({ caixasDeRota: 100, caixasDeAs: 0 }),
            viagem({ caixasDeRota: 0, caixasDeAs: 586 }),
          ],
        },
      ],
      JULHO_2A,
      PREVISTO_2A,
    );
    expect(r.frotaFixa).toBeCloseTo(umMapaPorIcms, 2);
  });

  it("coluna ausente não exclui: `null` nos dois termos mantém a viagem", () => {
    const r = somarVariavel(
      [{ viagens: [viagem({ caixasDeRota: null, caixasDeAs: null })] }],
      JULHO_2A,
      PREVISTO_2A,
    );
    expect(r.frotaFixa).toBeCloseTo(umMapaPorIcms, 2);
  });

  /*
    O caso ambíguo, e a escolha registrada: `CxAS` ausente com `CxRota = 0` não
    é excluído. `null` é "não se sabe", e o desconhecido não exclui — a mesma
    regra que vale para `caixasDeRota` sozinho.
  */
  it("CxRota = 0 com CxAS ausente entra — o desconhecido não exclui", () => {
    const r = somarVariavel(
      [{ viagens: [viagem({ caixasDeRota: 0, caixasDeAs: null })] }],
      JULHO_2A,
      PREVISTO_2A,
    );
    expect(r.frotaFixa).toBeCloseTo(umMapaPorIcms, 2);
  });
});

describe("as seis viagens dos dias 23 e 28 de julho/2026", () => {
  /**
   * O caso real, reconstruído.
   *
   * Dia 23: 60 mapas de frota fixa, dos quais 2 `NF-ISS` e 58 `CTRC-ICMS`; três
   * deles são viagens de Rota que rodaram vazias. Dia 28: 48 mapas, todos
   * `CTRC-ICMS`, três deles vazios. Os números são os das abas diárias da
   * `.xlsb`, conferidos contra o 2Art real.
   */
  const dia = (mapas: number, iss: number, vazias: number) => ({
    viagens: [
      ...Array.from({ length: iss }, () => viagem({ tipoDeImposto: "NF-ISS" })),
      ...Array.from({ length: mapas - iss - vazias }, () => viagem()),
      ...Array.from({ length: vazias }, () => viagem({ caixasDeRota: 0, caixasDeAs: 0 })),
    ],
  });

  const comAsVazias = [dia(60, 2, 3), dia(48, 0, 3)];
  const semAsVazias = [dia(57, 2, 0), dia(45, 0, 0)];

  it("as três de cada dia entram, e a diferença é R$ 1.727,06", () => {
    const com = somarVariavel(comAsVazias, JULHO_2A, PREVISTO_2A);
    const sem = somarVariavel(semAsVazias, JULHO_2A, PREVISTO_2A);
    expect(com.frotaFixa! - sem.frotaFixa!).toBeCloseTo(1727.06, 2);
  });

  /*
    A identidade fechada: as seis são todas CT-e, então o efeito é exatamente
    seis mapas pelo lado do ICMS. É a mesma conta por outro caminho — se as duas
    divergirem, uma das duas está errada.
  */
  it("o efeito é 6 × (1 ÷ divisor de fora) × valor médio do veículo", () => {
    const com = somarVariavel(comAsVazias, JULHO_2A, PREVISTO_2A);
    const sem = somarVariavel(semAsVazias, JULHO_2A, PREVISTO_2A);
    expect(com.frotaFixa! - sem.frotaFixa!).toBeCloseTo(6 * umMapaPorIcms, 2);
    expect(6 * umMapaPorIcms).toBeCloseTo(1727.06, 2);
  });

  /*
    Por que a 1ª quinzena nunca acusou o defeito: não há nenhuma viagem de Rota
    com CxRota = 0 e CxAS = 0 nos dias 1 a 15. Ela fechava por ausência do caso,
    não por acerto da regra — o modo de falhar mais caro que existe.
  */
  it("sem viagem vazia no dia, as duas regras dão o mesmo número", () => {
    const soCheias = [dia(47, 2, 0)];
    const r = somarVariavel(soCheias, JULHO_2A, PREVISTO_2A);
    const mesmasComAsExcluidas = somarVariavel(
      [
        {
          viagens: [
            ...soCheias[0]!.viagens,
            viagem({ caixasDeRota: 0, caixasDeAs: 586 }),
          ],
        },
      ],
      JULHO_2A,
      PREVISTO_2A,
    );
    expect(mesmasComAsExcluidas.frotaFixa).toBe(r.frotaFixa);
  });
});
