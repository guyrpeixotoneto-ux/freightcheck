import { describe, expect, it } from "vitest";
import {
  fontesDaCompetencia,
  fontesParaEnviar,
  type Fonte,
  type TipoDeFonte,
} from "@/lib/fechamento";

/**
 * O recorte por quinzena — o que a tela pede e o que ela aceita.
 *
 * A regra é do processo: a 1ª quinzena **espera** quatro relatórios e a 2ª
 * espera os seis, porque a conciliação (03.02.59.02) chega com o fechamento do
 * mês. As requisições (03.08.12.09) são o caso do meio — podem existir na 1ª e
 * nem sempre existem —, e é por isso que são duas funções e não uma:
 *
 * - {@link fontesDaCompetencia} é o **denominador** de "3 de 4 relatórios", e
 *   por isso conta só as esperadas (mais o que já chegou);
 * - {@link fontesParaEnviar} é a lista de **casinhas de envio**, e por isso
 *   conta também as opcionais.
 *
 * As duas aparecem nas três telas — a competência aberta, a linha de
 * Importações e a de Apurações. Um recorte diferente em cada tela faria a mesma
 * quinzena parecer completa numa e incompleta na outra.
 */

const fonte = (
  tipo: TipoDeFonte,
  rotina: string,
  quinzenas: (1 | 2)[],
  quinzenasOpcionais: (1 | 2)[] = [],
): Fonte => ({
  tipo,
  rotina,
  nome: rotina,
  papel: "",
  extensoes: [".xlsx"],
  quinzenas,
  quinzenasOpcionais,
});

const CATALOGO: Fonte[] = [
  fonte("OPERACAO", "2Art", [1, 2]),
  fonte("CTE", "03.08.15", [1, 2]),
  fonte("PAGAMENTO", "03.08.20", [1, 2]),
  fonte("DISPONIBILIDADE_FF", "03.08.18 FF", [1, 2]),
  fonte("DISPONIBILIDADE_VAN", "03.08.18 Vans", [1, 2]),
  fonte("REQUISICOES", "03.08.12.09", [2], [1]),
  fonte("CONCILIACAO", "03.02.59.02", [2]),
];

describe("fontesDaCompetencia", () => {
  it("pede cinco relatórios na 1ª quinzena e sete na 2ª", () => {
    expect(fontesDaCompetencia(CATALOGO, 1).map((f) => f.rotina)).toEqual([
      "2Art",
      "03.08.15",
      "03.08.20",
      "03.08.18 FF",
      "03.08.18 Vans",
    ]);
    expect(fontesDaCompetencia(CATALOGO, 2)).toHaveLength(7);
  });

  it("mantém na lista o relatório enviado fora da quinzena dele", () => {
    /* Arquivo importado nunca some da tela por causa do recorte: sumindo, ele
       seria importado de novo — e o denominador diria "de 5" com seis
       enviados. */
    const lista = fontesDaCompetencia(CATALOGO, 1, ["CONCILIACAO"]);
    expect(lista.map((f) => f.rotina)).toEqual([
      "2Art",
      "03.08.15",
      "03.08.20",
      "03.08.18 FF",
      "03.08.18 Vans",
      "03.02.59.02",
    ]);
  });

  it("não repete o que já estava na quinzena", () => {
    expect(fontesDaCompetencia(CATALOGO, 2, ["CTE", "CONCILIACAO"])).toHaveLength(7);
  });

  it("devolve vazio enquanto o catálogo não chegou — vazio é 'ainda não sei'", () => {
    expect(fontesDaCompetencia([], 1, ["CTE"])).toEqual([]);
  });

  it("preserva a ordem do catálogo, que é a das casinhas da lista", () => {
    const embaralhado = [CATALOGO[3], CATALOGO[0], CATALOGO[1]];
    expect(fontesDaCompetencia(embaralhado, 1).map((f) => f.tipo)).toEqual([
      "DISPONIBILIDADE_FF",
      "OPERACAO",
      "CTE",
    ]);
  });

  it("não conta como pedido o 03.08.12.09 opcional da 1ª quinzena", () => {
    /* O denominador é o das esperadas: contar o opcional que ainda não chegou
       faria a primeira quinzena completa dizer "5 de 6" para sempre — e "falta
       um relatório" é uma frase que manda alguém procurar um arquivo. */
    expect(fontesDaCompetencia(CATALOGO, 1).map((f) => f.rotina)).not.toContain(
      "03.08.12.09",
    );

    /* Chegando, ele entra pelas duas pontas da fração, como qualquer enviado. */
    const comRequisicoes = fontesDaCompetencia(CATALOGO, 1, ["REQUISICOES"]);
    expect(comRequisicoes.map((f) => f.rotina)).toContain("03.08.12.09");
    expect(comRequisicoes).toHaveLength(6);
  });
});

describe("fontesParaEnviar", () => {
  it("oferece o 03.08.12.09 na 1ª quinzena antes de ele chegar", () => {
    /* A requisição aprovada entre os dias 1 e 15 sai no relatório daquela
       quinzena: ela pode existir ali. Sem casinha, o arquivo não tinha por onde
       entrar — e o complementar do período ficava de fora da conta em silêncio,
       porque uma fonte que a tela não oferece é uma fonte que ninguém sabe que
       falta. */
    expect(fontesParaEnviar(CATALOGO, 1).map((f) => f.rotina)).toEqual([
      "2Art",
      "03.08.15",
      "03.08.20",
      "03.08.18 FF",
      "03.08.18 Vans",
      "03.08.12.09",
    ]);
  });

  it("continua sem oferecer a conciliação na 1ª quinzena", () => {
    /* Opcional não é "tudo vale": o 03.02.59.02 é o fecho do mês e não existe
       na primeira. A casinha dele só aparece se alguém o tiver enviado. */
    expect(fontesParaEnviar(CATALOGO, 1).map((f) => f.rotina)).not.toContain(
      "03.02.59.02",
    );
    expect(fontesParaEnviar(CATALOGO, 1, ["CONCILIACAO"]).map((f) => f.rotina)).toContain(
      "03.02.59.02",
    );
  });

  it("dá as sete à 2ª quinzena, sem repetir o que já é esperado nela", () => {
    expect(fontesParaEnviar(CATALOGO, 2)).toHaveLength(7);
    expect(fontesParaEnviar(CATALOGO, 2, ["CTE", "REQUISICOES"])).toHaveLength(7);
  });

  it("oferece as duas casinhas do 03.08.18 nas duas quinzenas", () => {
    /* O pedido que separou o relatório: os dois arquivos chegam à parte, e
       enquanto disputavam uma casinha só o segundo apagava o primeiro. */
    for (const quinzena of [1, 2] as const) {
      const rotinas = fontesParaEnviar(CATALOGO, quinzena).map((f) => f.rotina);
      expect(rotinas).toContain("03.08.18 FF");
      expect(rotinas).toContain("03.08.18 Vans");
    }
  });

  it("devolve vazio enquanto o catálogo não chegou — vazio é 'ainda não sei'", () => {
    expect(fontesParaEnviar([], 1, ["CTE"])).toEqual([]);
  });
});
