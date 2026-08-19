import { describe, expect, it } from "vitest";
import { montarCadastro, type MaterialDoCadastro } from "../montagem";
import type { CavaloDaVigencia, TrechoDaVigencia } from "../medicao";
import { medirSituacao } from "../situacao";

/**
 * A situação do cadastro — o que a lista de unidades destaca.
 *
 * A promessa desta medição é que ela nunca diz "esta unidade está em dia" a
 * partir de um arquivo que chegou: ela diz a partir de uma linha que **mediu**.
 * A diferença aparece no caso do meio deste arquivo — a vigência que entregou
 * trechos sem as colunas em reais —, em que a leitura ingênua ("tem trecho,
 * logo tem alíquota") acertaria a lista e contradiria a tela do cadastro, que
 * mostra as alíquotas sem número. Duas telas discordando sobre a mesma unidade
 * é o defeito que separar esta função da montagem existiria para causar, e é
 * por isso que ela recebe o cadastro montado em vez do material cru.
 */

const trecho = (t: Partial<TrechoDaVigencia>): TrechoDaVigencia => ({
  tributo: null,
  percentualDeclarado: null,
  freteCtrc: null,
  imposto: null,
  pisCofins: null,
  previsaoViagens: null,
  ...t,
});

const cavalos = (quantos: number, ativo: boolean | null = true): CavaloDaVigencia[] =>
  Array.from({ length: quantos }, (_, i) => ({ entityId: `cavalo-${i}`, ativo }));

const DENTRO = trecho({
  tributo: "ISS",
  freteCtrc: 1_000,
  imposto: 59,
  pisCofins: 92.5,
  previsaoViagens: 2,
});

const FORA = trecho({
  tributo: "ICMS",
  freteCtrc: 10_000,
  imposto: 1_784,
  pisCofins: 925,
  previsaoViagens: 62,
});

const situacao = (material: MaterialDoCadastro) => medirSituacao(montarCadastro(material));

describe("a situação do cadastro de uma unidade", () => {
  it("reconhece as duas metades quando a vigência entregou as duas séries", () => {
    const medida = situacao({
      cavalos: cavalos(62),
      trechos: [DENTRO, FORA],
      trechosEntregues: true,
    });

    expect(medida.estado).toBe("FROTA_E_ALIQUOTAS");
    expect(medida.frota).toBe(true);
    expect(medida.aliquotas).toBe(true);
  });

  /*
    O caso de CAMAÇARI em agosto de 2026: 62 cavalos, nenhum trecho. A frota
    está contada e as alíquotas, as proporções e o resumo de impostos não têm
    lastro — e é essa a diferença que a lista existe para mostrar sem obrigar
    ninguém a abrir a unidade.
  */
  it("separa a unidade que entregou a frota e não entregou os trechos", () => {
    const medida = situacao({ cavalos: cavalos(62), trechos: [], trechosEntregues: false });

    expect(medida.estado).toBe("SO_FROTA");
    expect(medida.frota).toBe(true);
    expect(medida.aliquotas).toBe(false);
  });

  it("separa a unidade que entregou os trechos e não entregou os cavalos", () => {
    const medida = situacao({ cavalos: [], trechos: [DENTRO, FORA], trechosEntregues: true });

    expect(medida.estado).toBe("SO_ALIQUOTAS");
    expect(medida.frota).toBe(false);
    expect(medida.aliquotas).toBe(true);
  });

  it("chama de sem lastro a unidade que entregou vigência e nada que o cadastro leia", () => {
    const medida = situacao({ cavalos: [], trechos: [], trechosEntregues: false });

    expect(medida.estado).toBe("SEM_LASTRO");
    expect(medida.comLastro).toBe(0);
    expect(medida.semLastro).toBe(medida.linhas);
  });

  /*
    A razão de a medição ler o cadastro montado, e não o material. Os trechos
    chegaram — a série foi entregue e há duzentas linhas —, mas sem as colunas
    em reais nenhuma alíquota se mede. Contar "tem trecho, logo tem alíquota"
    marcaria esta unidade como em dia enquanto a tela do cadastro mostra as
    quatro alíquotas em branco.
  */
  it("não confunde série entregue com alíquota medida", () => {
    const medida = situacao({
      cavalos: cavalos(62),
      trechos: [trecho({ tributo: "ICMS", previsaoViagens: 40 })],
      trechosEntregues: true,
    });

    expect(medida.aliquotas).toBe(false);
    expect(medida.estado).toBe("SO_FROTA");
  });

  /*
    O mesmo do outro lado: os cavalos existem e nenhum diz se está ativo. A
    contagem se recusa a tratar silêncio como frota parada, e a situação
    acompanha a recusa em vez de contar as cabeças.
  */
  it("não confunde cavalo entregue com frota contada", () => {
    const medida = situacao({
      cavalos: cavalos(62, null),
      trechos: [DENTRO, FORA],
      trechosEntregues: true,
    });

    expect(medida.frota).toBe(false);
    expect(medida.estado).toBe("SO_ALIQUOTAS");
  });

  /*
    Uma quinzena em que nada saiu por dentro do município é uma quinzena
    comum, e não uma unidade sem cadastro: o ISS não tem o que medir porque não
    houve documento de ISS. Exigir as três alíquotas mandaria procurar um export
    de frete que está lá.
  */
  it("basta uma alíquota medida — a unidade sem ISS na quinzena não fica incompleta", () => {
    const medida = situacao({ cavalos: cavalos(62), trechos: [FORA], trechosEntregues: true });

    expect(medida.aliquotas).toBe(true);
    expect(medida.estado).toBe("FROTA_E_ALIQUOTAS");
  });

  /*
    Os números vêm do resumo da montagem, e não de uma contagem própria: são os
    mesmos que a tela do cadastro mostra no topo, e é essa identidade que
    impede a lista e o detalhe de discordarem sobre quantas linhas têm número.
  */
  it("conta as linhas pelo mesmo resumo que a tela do cadastro mostra", () => {
    const material: MaterialDoCadastro = {
      cavalos: cavalos(62),
      trechos: [DENTRO, FORA],
      trechosEntregues: true,
    };
    const montado = montarCadastro(material);
    const medida = medirSituacao(montado);

    expect(medida.linhas).toBe(montado.resumo.linhas);
    expect(medida.comLastro).toBe(montado.resumo.apuradas + montado.resumo.emConjunto);
    expect(medida.semLastro).toBe(montado.resumo.semLastro);
    expect(medida.comLastro + medida.semLastro).toBe(medida.linhas);
    // O placar de hoje sobre um acervo completo — ver `montagem.test.ts`.
    expect(medida.comLastro).toBe(11);
  });
});
