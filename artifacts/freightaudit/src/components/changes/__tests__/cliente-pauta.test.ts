import { describe, expect, it } from "vitest";
import {
  categoriasNaoPropor,
  categoriasPendentes,
  classificar,
  divisaoDeAtivos,
  equipamentoSingular,
  leituraDoAtivo,
  prioridadeDaPauta,
  racionalDeApoio,
  type Recomendacao,
} from "../cliente-recomendacoes";
import { formatBrlCompacto } from "@/lib/format";

/**
 * O que a aba Cliente decide antes de desenhar a pauta.
 *
 * Quatro coisas, e as quatro já erraram em produtos parecidos: a etiqueta de
 * prioridade — que não pode virar "quanto é o número", senão a tela manda
 * propor o que ainda é pergunta —, a partição dos painéis do rodapé — que
 * precisa somar exatamente a população, senão o ladrilho do topo discorda da
 * lista logo abaixo dele —, o racional de apoio, que sem denominador vira uma
 * afirmação que ninguém confere, e a divisão entre prejudicados e favorecidos,
 * que é a única coisa do cartão que declara perda no nome.
 */

const rec = (patch: Partial<Recomendacao>): Recomendacao => ({
  code: "taxaFiname",
  title: "Taxa FINAME",
  entityType: "CAVALO",
  equipment: "Cavalo",
  situacao: "PROPOR_AJUSTE",
  confianca: "MEDIA",
  papel: "TAXA",
  sentido: "DIRETO",
  acionavel: "NEGOCIAVEL",
  mecanismo: "",
  efeito: "REDUZ",
  direcoesMistas: false,
  oQueAconteceu: null,
  porque: "",
  impacto: null,
  impactoMotivo: "",
  valorAtual: null,
  valorRecomendado: null,
  diferenca: null,
  fonte: null,
  oQuePerguntar: null,
  veiculosAfetados: 0,
  veiculosNaSerie: 0,
  alteracoes: 0,
  alimenta: [],
  dependeDe: [],
  evidencia: "",
  noAtivo: null,
  ...patch,
});

/** O par do próprio ativo, como o motor o entrega sob escopo de placa. */
const noAtivo = (antes: number, depois: number, effectiveDate = "2026-03-01") => ({
  placa: "QYP3G72",
  antes,
  depois,
  effectiveDate,
  sourceLabel: `EMPURRADA_${effectiveDate}`,
});

const impacto = (valor: number) => ({
  valor,
  periodicidade: "MENSAL",
  mensal: valor,
  anual: valor * 12,
  projetado: false,
  explicacao: "",
});

describe("prioridadeDaPauta", () => {
  it("só uma proposta de confiança alta vira prioridade alta", () => {
    expect(
      prioridadeDaPauta(rec({ situacao: "PROPOR_AJUSTE", confianca: "ALTA" })),
    ).toBe("ALTA");
    expect(
      prioridadeDaPauta(rec({ situacao: "PROPOR_AJUSTE", confianca: "MEDIA" })),
    ).toBe("MEDIA");
  });

  it("investigação não vira prioridade, por maior que seja o dinheiro", () => {
    expect(
      prioridadeDaPauta(
        rec({
          situacao: "INVESTIGAR",
          confianca: "ALTA",
          impacto: impacto(-731_000),
        }),
      ),
    ).toBe("ATENCAO");
  });
});

describe("classificar", () => {
  const regras = [
    { chave: "A", rotulo: "primeira", quando: (n: number) => n > 10 },
    { chave: "B", rotulo: "segunda", quando: (n: number) => n > 5 },
  ];
  const sobra = { chave: "C", rotulo: "resto" };

  it("conta cada item uma vez só — vence a primeira regra que casa", () => {
    const categorias = classificar([20, 7, 8], regras, sobra);
    expect(categorias).toEqual([
      { chave: "A", rotulo: "primeira", quantidade: 1 },
      { chave: "B", rotulo: "segunda", quantidade: 2 },
    ]);
  });

  it("o que não casa com nenhuma regra aparece, e não some", () => {
    const categorias = classificar([20, 1, 2], regras, sobra);
    expect(categorias.find((c) => c.chave === "C")?.quantidade).toBe(2);
  });

  it("categoria vazia não ocupa linha", () => {
    expect(classificar([1], regras, sobra).map((c) => c.chave)).toEqual(["C"]);
  });
});

describe("categoriasNaoPropor", () => {
  it("separa o que nos favoreceu do que não mexeu na remuneração", () => {
    const categorias = categoriasNaoPropor([
      rec({ situacao: "NAO_PROPOR", efeito: "AUMENTA" }),
      rec({ situacao: "NAO_PROPOR", efeito: "AUMENTA" }),
      rec({ situacao: "NAO_PROPOR", efeito: "SEM_EFEITO" }),
      rec({ situacao: "NAO_PROPOR", efeito: "REDUZ" }),
    ]);

    expect(categorias.map((c) => [c.chave, c.quantidade])).toEqual([
      ["AUMENTA", 2],
      ["SEM_EFEITO", 1],
      ["MECANISMO", 1],
    ]);
  });

  it("a soma das categorias é a população — nada fica fora da conta", () => {
    const recs = [
      rec({ situacao: "NAO_PROPOR", efeito: "AUMENTA" }),
      rec({ situacao: "NAO_PROPOR", efeito: "INDETERMINADO" }),
      rec({ situacao: "NAO_PROPOR", efeito: "REDUZ" }),
    ];
    const total = categoriasNaoPropor(recs).reduce((s, c) => s + c.quantidade, 0);
    expect(total).toBe(recs.length);
  });
});

describe("categoriasPendentes", () => {
  it("a semântica não confirmada vem antes de tudo, mesmo sem impacto", () => {
    const categorias = categoriasPendentes([
      rec({ situacao: "NAO_CALCULAVEL", impacto: null, direcoesMistas: true }),
    ]);
    expect(categorias).toEqual([
      {
        chave: "SEMANTICA",
        rotulo: "Validar a semântica de parâmetros ainda não confirmados",
        quantidade: 1,
      },
    ]);
  });

  it("particiona as pendências: cada item numa frente só", () => {
    const recs = [
      rec({ situacao: "NAO_CALCULAVEL" }),
      rec({ situacao: "INVESTIGAR", direcoesMistas: true, impacto: impacto(-10) }),
      rec({ situacao: "INVESTIGAR", impacto: null }),
      rec({ situacao: "INVESTIGAR", impacto: impacto(-20) }),
    ];
    const categorias = categoriasPendentes(recs);

    expect(categorias.map((c) => [c.chave, c.quantidade])).toEqual([
      ["SEMANTICA", 1],
      ["DIRECOES", 1],
      ["IMPACTO", 1],
      ["REFERENCIA", 1],
    ]);
    expect(categorias.reduce((s, c) => s + c.quantidade, 0)).toBe(recs.length);
  });
});

describe("racionalDeApoio", () => {
  it("dá o denominador junto — “64 veículos” sozinho não se confere", () => {
    expect(
      racionalDeApoio(
        rec({ veiculosAfetados: 64, veiculosNaSerie: 71, equipment: "Cavalo" }),
      ),
    ).toBe("64 de 71 cavalos afetados");
  });

  it("os ativos que foram para o lado contrário viajam junto", () => {
    expect(
      racionalDeApoio(
        rec({
          veiculosAfetados: 12,
          veiculosNaSerie: 62,
          oQueAconteceu: {
            antes: 1,
            depois: 2,
            unidade: null,
            effectiveDate: "2026-08-01",
            sourceLabel: "EMPURRADA_1_8_2026",
            entidades: 8,
            entidadesEmSentidoOposto: 4,
            padroes: 2,
            cobertura: 0.66,
          },
        }),
      ),
    ).toBe("12 de 62 cavalos afetados · 4 para o lado contrário");
  });
});

describe("divisaoDeAtivos", () => {
  const caso = (patch: Partial<Recomendacao["oQueAconteceu"] & {}> = {}) => ({
    antes: 3.11,
    depois: 3.71,
    unidade: null,
    effectiveDate: "2026-03-02",
    sourceLabel: "EMPURRADA_2_3_2026",
    entidades: 29,
    entidadesEmSentidoOposto: 7,
    padroes: 79,
    cobertura: 0.45,
    ...patch,
  });

  it("sem o par antes → depois não há divisão a mostrar", () => {
    expect(divisaoDeAtivos(rec({ oQueAconteceu: null }))).toBeNull();
  });

  it("num parâmetro de sentido inverso, subir é perder", () => {
    const d = divisaoDeAtivos(
      rec({ sentido: "INVERSO", oQueAconteceu: caso(), veiculosAfetados: 64 }),
    );
    expect(d!.predominante).toEqual({
      quantidade: 29,
      rotulo: "prejudicados",
      tom: "PERDA",
    });
    expect(d!.oposto).toEqual({
      quantidade: 7,
      rotulo: "favorecidos",
      tom: "GANHO",
    });
  });

  it("no sentido direto a mesma subida é ganho, e quem desceu é que perdeu", () => {
    const d = divisaoDeAtivos(
      rec({ sentido: "DIRETO", oQueAconteceu: caso(), veiculosAfetados: 64 }),
    );
    expect(d!.predominante.tom).toBe("GANHO");
    expect(d!.oposto.tom).toBe("PERDA");
  });

  /*
    A regra que este arquivo inteiro defende, aplicada ao cartão: sem sentido
    declarado o movimento é um fato medido e mais nada. Chamar de prejudicado
    quem talvez tenha ganhado é o palpite com aparência de conta.
  */
  it("sem sentido declarado, ninguém é chamado de prejudicado", () => {
    for (const sentido of [null, "DESCONHECIDO", "NAO_MONOTONICO", "DEPENDE_DE_FORMULA"]) {
      const d = divisaoDeAtivos(rec({ sentido, oQueAconteceu: caso() }));
      expect(d!.predominante).toEqual({
        quantidade: 29,
        rotulo: "no padrão principal",
        tom: "NEUTRO",
      });
      expect(d!.oposto.rotulo).toBe("em sentido oposto");
    }
  });

  it("um par que não se moveu não vira queda", () => {
    const d = divisaoDeAtivos(
      rec({ sentido: "DIRETO", oQueAconteceu: caso({ antes: 3.11, depois: 3.11 }) }),
    );
    expect(d!.predominante.tom).toBe("NEUTRO");
  });

  it("conta quantos afetados sobraram fora dos dois grupos", () => {
    const d = divisaoDeAtivos(
      rec({ sentido: "INVERSO", oQueAconteceu: caso(), veiculosAfetados: 64 }),
    );
    expect(d!.restantes).toBe(28);
  });

  it("não inventa sobra quando os dois grupos já cobrem os afetados", () => {
    const d = divisaoDeAtivos(
      rec({
        sentido: "INVERSO",
        oQueAconteceu: caso({ entidades: 57, entidadesEmSentidoOposto: 7 }),
        veiculosAfetados: 64,
      }),
    );
    expect(d!.restantes).toBe(0);
  });

  /*
    O cartão que não tem divisão a mostrar não pode ganhar três ladrilhos: eles
    diriam "62 · 62 · 0", e o leitor gastaria a atenção procurando a diferença
    entre dois números iguais.
  */
  it("frota inteira na mesma transição não é divisão nenhuma", () => {
    expect(
      divisaoDeAtivos(
        rec({
          sentido: "DIRETO",
          oQueAconteceu: caso({ entidades: 62, entidadesEmSentidoOposto: 0, padroes: 1 }),
          veiculosAfetados: 62,
        }),
      ),
    ).toBeNull();
  });

  it("ninguém no sentido oposto ainda é divisão, se sobraram afetados fora do par", () => {
    const d = divisaoDeAtivos(
      rec({
        sentido: "DIRETO",
        oQueAconteceu: caso({ entidades: 29, entidadesEmSentidoOposto: 0 }),
        veiculosAfetados: 64,
      }),
    );
    expect(d!.oposto.quantidade).toBe(0);
    expect(d!.restantes).toBe(35);
  });
});

/**
 * A camada do ativo — a linha "neste cavalo" do cartão.
 *
 * O cartão dizia "29 favorecidos · 7 prejudicados" e não dizia de que lado o
 * cavalo aberto caiu. É a primeira pergunta de quem entra por `Cavalo 360°`, e
 * a única que a leitura de frota não responde por construção.
 *
 * O que estes testes protegem é que a resposta use **a mesma régua** da divisão
 * da frota. Duas cópias da regra dariam, dentro do mesmo cartão, um cavalo
 * "favorecido" desenhado dentro de um grupo de prejudicados — e nenhum dos dois
 * números pareceria errado sozinho.
 */
describe("leituraDoAtivo", () => {
  it("sem placa aberta não há camada de ativo", () => {
    expect(leituraDoAtivo(rec({ noAtivo: null }))).toBeNull();
  });

  it("num parâmetro direto, cair é ser prejudicado", () => {
    const l = leituraDoAtivo(rec({ sentido: "DIRETO", noAtivo: noAtivo(7.7, 7.26) }));
    expect(l!.rotulo).toBe("prejudicado");
    expect(l!.tom).toBe("PERDA");
  });

  it("num parâmetro inverso, a mesma queda é ganho", () => {
    const l = leituraDoAtivo(rec({ sentido: "INVERSO", noAtivo: noAtivo(7.7, 7.26) }));
    expect(l!.rotulo).toBe("favorecido");
    expect(l!.tom).toBe("GANHO");
  });

  it("sem sentido declarado, o cavalo mudou — e nada além disso", () => {
    /*
      O palpite com cara de conta que a aba inteira existe para não dar: chamar
      de prejudicado quem talvez tenha ganhado, porque o número caiu.
    */
    const l = leituraDoAtivo(rec({ sentido: null, noAtivo: noAtivo(21_259, 7_210) }));
    expect(l!.rotulo).toBe("mudou");
    expect(l!.tom).toBe("NEUTRO");
  });

  it("o cavalo e o grupo em que ele cai são pintados pela mesma regra", () => {
    /*
      A frota foi de 3,11 para 3,71 num parâmetro direto — subiu, então o padrão
      predominante é o dos favorecidos. O cavalo que fez a mesma transição tem
      de sair favorecido também.
    */
    const r = rec({
      sentido: "DIRETO",
      oQueAconteceu: {
        antes: 3.11,
        depois: 3.71,
        unidade: null,
        effectiveDate: "2026-03-02",
        sourceLabel: "EMPURRADA_2_3_2026",
        entidades: 29,
        entidadesEmSentidoOposto: 7,
        padroes: 79,
        cobertura: 0.45,
      },
      veiculosAfetados: 64,
      noAtivo: noAtivo(3.11, 3.71, "2026-03-02"),
    });

    expect(divisaoDeAtivos(r)!.predominante.tom).toBe("GANHO");
    expect(leituraDoAtivo(r)!.tom).toBe("GANHO");
  });

  it("marca quando o cavalo mexeu em outra vigência que a da evidência", () => {
    const base = {
      antes: 3.11,
      depois: 3.71,
      unidade: null,
      effectiveDate: "2026-03-02",
      sourceLabel: "EMPURRADA_2_3_2026",
      entidades: 29,
      entidadesEmSentidoOposto: 7,
      padroes: 79,
      cobertura: 0.45,
    };

    expect(
      leituraDoAtivo(rec({ oQueAconteceu: base, noAtivo: noAtivo(3.11, 3.71, "2026-03-02") }))!
        .outraVigencia,
    ).toBe(false);
    expect(
      leituraDoAtivo(rec({ oQueAconteceu: base, noAtivo: noAtivo(2.9, 3.11, "2026-01-02") }))!
        .outraVigencia,
    ).toBe(true);
  });
});

describe("equipamentoSingular", () => {
  it("nomeia o ativo para as frases da tela", () => {
    expect(equipamentoSingular("CAVALO")).toBe("cavalo");
    expect(equipamentoSingular("CARRETA")).toBe("carreta");
    // Um equipamento que este produto ainda não nomeia não vira "ativo": vira
    // ele mesmo, que é sempre melhor do que um rótulo genérico.
    expect(equipamentoSingular("REBOQUE")).toBe("reboque");
    expect(equipamentoSingular(null)).toBe("ativo");
  });
});

describe("formatBrlCompacto", () => {
  it("escala o número sem esconder o sinal", () => {
    expect(formatBrlCompacto(38_412)).toBe("R$ 38,4 mil");
    expect(formatBrlCompacto(-18_400)).toBe("−R$ 18,4 mil");
    expect(formatBrlCompacto(-1_240_000)).toBe("−R$ 1,2 mi");
  });

  it("abaixo de mil sai por extenso — “R$ 0,8 mil” seria pior", () => {
    expect(formatBrlCompacto(812)).toBe("R$ 812");
    expect(formatBrlCompacto(-812)).toBe("−R$ 812");
  });
});
