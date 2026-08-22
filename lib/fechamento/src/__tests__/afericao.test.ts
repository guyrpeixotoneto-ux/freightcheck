import { describe, expect, it } from "vitest";

import { aferir, porClasse, type Afericao } from "../afericao";
import { conferirDePara } from "../de-para";
import {
  descontoDeDisponibilidadeDoMes,
  type DiaDeDisponibilidade,
} from "../leitores/disponibilidade";
import { lerPagamento } from "../leitores/pagamento";
import { montarMapaDaQuinzena, type ParametrosDoCadastro } from "../mapa-rota";
import { basesDaQuinzena } from "../persistencia";
import { compararPaineis, painelDeUmaQuinzena, type CanalDoResumo } from "../resumo";
import { fixturePagamentoDoPainel } from "./fixtures";

/**
 * A AFERIÇÃO — os dois números que a tela mostra, e que ninguém digita.
 *
 * **O que esta suíte impede.** Um selo de qualidade escrito à mão. "Precisão:
 * 99%" num `<span>` envelhece no primeiro fechamento diferente e continua lá,
 * dizendo 99% sobre um mês que ninguém conferiu — e, pior, dizendo com a mesma
 * cara de número. Os testes abaixo prendem que os dois percentuais são
 * **derivados**: mudou a parcela, mudou a nota, sem ninguém tocar em nada.
 *
 * **Os dois medem coisas diferentes, e o teste central é esse.** Precisão é
 * sobre a conta; lastro é sobre a evidência. Uma linha cujos dois lados saem do
 * mesmo arquivo fecha em zero e sobe a precisão — e **não** sobe o lastro, que
 * é a única coisa que impede o painel de se elogiar por concordar consigo
 * mesmo.
 */

const PARAMETROS: ParametrosDoCadastro = {
  aliquotas: { pis: 0.0065, cofins: 0.086, icms: 0.1784, iss: 0.059 },
  parcelaDentroDoMunicipio: 0.0316,
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

const doMes = descontoDeDisponibilidadeDoMes(
  [
    {
      linha: 1,
      aba: "FF",
      tipoDeFrota: "FF",
      dia: "2026-07-20",
      canal: "ROTA",
      frotaTotal: 0,
      contratada: 0,
      realPrimeiraViagem: 0,
      realSegundaViagem: 0,
      gapTotal: 0,
      gapDaCia: 0,
      gapDaTransportadora: {
        frotaCancelada: 0,
        outrosCancelados: 0,
        frotaNaoCancelada: 0,
        outrosNaoCancelados: 0,
      },
      descontos: { custoFixo: 1000, equipe: 2300, indiretos: 500, fatorAjudante: 0, total: 3800 },
      percentualDeUtilizacao: null,
      percentualDeDisponibilidade: null,
    } satisfies DiaDeDisponibilidade,
  ],
  "ROTA",
);

const VAZIO = { primeira: null, segunda: null, total: null };

/** Um canal do resumo com o painel comparado da 2ª quinzena montado. */
function canalDaRota(): CanalDoResumo {
  const pagamento = lerPagamento(fixturePagamentoDoPainel());
  const bases = basesDaQuinzena(
    pagamento.descontos.map((d) => ({ canal: d.canal, tipo: d.tipo as string, valor: d.valor })),
    "ROTA",
    [],
    null,
    { quinzena: 2, disponibilidadeDoMes: doMes },
  );
  const mapa = montarMapaDaQuinzena({
    quinzena: 2,
    parametros: PARAMETROS,
    variavel: { frotaFixa: 100000, agregado: 50000, recargaENoturna: 8000, vans: 0 },
    bases,
  });
  const comparado = compararPaineis(
    "ROTA",
    { primeira: null, segunda: mapa },
    painelDeUmaQuinzena(2, conferirDePara(pagamento, { canal: "ROTA" })),
    { primeira: null, segunda: null },
  )!;
  return {
    canal: "ROTA",
    blocos: [],
    descontos: [],
    emitido: VAZIO,
    conferido: VAZIO,
    semFonte: VAZIO,
    demonstrativo: VAZIO,
    diferenca: VAZIO,
    painel: null,
    semPainel: null,
    comparado,
    cadastro: { primeira: null, segunda: null },
  } as unknown as CanalDoResumo;
}

const parcela = (a: Afericao, chave: string) => a.parcelas.find((p) => p.chave === chave)!;

describe("os dois números medem coisas diferentes", () => {
  const afericao = aferir(canalDaRota());

  it("nenhum dos dois é escrito — os dois saem das parcelas", () => {
    /*
      A afirmação estrutural: o denominador de cada razão é a soma das parcelas
      que a barra lateral lista. Se alguém trocasse um dos números por uma
      constante, esta igualdade quebraria.
    */
    const soma = (f: (p: (typeof afericao.parcelas)[number]) => number) =>
      afericao.parcelas.reduce((s, p) => s + f(p), 0);

    expect(afericao.movimentado.segunda).toBeCloseTo(soma((p) => p.valor.segunda ?? 0), 2);
    expect(afericao.comLastroCruzado.segunda).toBeCloseTo(
      soma((p) => p.comLastro.segunda ?? 0),
      2,
    );
    expect(afericao.naoExplicado.segunda).toBeCloseTo(
      soma((p) => p.naoExplicado.segunda ?? 0),
      2,
    );
  });

  it("precisão é `1 − não explicado ÷ com contrapartida`", () => {
    expect(afericao.precisao.segunda).toBeCloseTo(
      1 - afericao.naoExplicado.segunda! / afericao.comContrapartida.segunda!,
      6,
    );
  });

  it("lastro é `com lastro cruzado ÷ movimentado`", () => {
    expect(afericao.lastro.segunda).toBeCloseTo(
      afericao.comLastroCruzado.segunda! / afericao.movimentado.segunda!,
      6,
    );
  });

  it("a linha conferida contra a própria fonte sobe a precisão e não sobe o lastro", () => {
    /*
      **É o teste que dá sentido ao par.** A devolução é lida do 03.08.20 para
      montar a base do devido e lida do 03.08.20 outra vez para montar o
      demonstrado. Ela fecha em R$ 0,00 — entra no denominador da precisão sem
      nada no numerador — e não põe um centavo no lastro.
    */
    const devolucao = parcela(afericao, "desconto_devolucao_percentual");
    expect(devolucao.classe).toBe("MESMA_FONTE");
    expect(devolucao.valor.segunda).toBeGreaterThan(0);
    expect(devolucao.comLastro.segunda).toBe(0);
    expect(devolucao.naoExplicado.segunda).toBeNull();
  });

  it("a linha de dois documentos diferentes sobe os dois", () => {
    const disponibilidade = parcela(afericao, "desconto_disponibilidade");
    expect(disponibilidade.classe).toBe("CRUZADO");
    expect(disponibilidade.fonteDoDevido).toContain("03.08.18");
    expect(disponibilidade.comLastro.segunda).toBe(disponibilidade.valor.segunda);
  });
});

describe("o dinheiro é contado uma vez, e o quadro que abre outro não é dinheiro novo", () => {
  const afericao = aferir(canalDaRota());

  it("o quadro do variável não entra no movimentado — ele abre o DVS", () => {
    /*
      A planilha repete a devolução e a disponibilidade no quadro do variável, e
      as parcelas de lá já estão somadas no `DVS`. Aferir os quatro quadros
      contava o mesmo dinheiro duas vezes e a repetição uma terceira. A
      separação é do motor — `QuadroDoMapa.detalha` —, não desta conta.
    */
    expect(afericao.parcelas.map((p) => p.chave)).not.toContain("custo_variavel_frota_fixa");
    expect(afericao.parcelas.map((p) => p.chave)).not.toContain("desconto_devolucao");
    expect(afericao.parcelas.map((p) => p.chave)).not.toContain("indisponibilidade_variavel");
  });

  it("o DVS não tem demonstrado próprio e mesmo assim tem lastro", () => {
    /*
      O 03.08.20 não traz verba `DVS`. O lastro dela é o conjunto do quadro que
      a abre — e é **parcial**: o `DVS` inclui recarga, noturna e vans, que o
      conjunto do variável não cobre. Arredondar para "coberta" ou "descoberta"
      perderia exatamente essa diferença.
    */
    const dvs = parcela(afericao, "rota_dvs");
    expect(dvs.classe).toBe("CRUZADO_EM_CONJUNTO");
    expect(dvs.comLastro.segunda).toBeGreaterThan(0);
    expect(dvs.comLastro.segunda!).toBeLessThan(dvs.valor.segunda!);
    /*
      A recarga/noturna que o quadro de baixo não abre — exatamente os R$
      8.000,00 passados ao motor. Sem fator: o variável chega de `somarVariavel`
      já na moeda final, e o `DVS` o repassa como está.
    */
    expect(dvs.valor.segunda! - dvs.comLastro.segunda!).toBeCloseTo(8000, 2);
  });

  it("o descoberto aparece como limite, com a cifra", () => {
    const limite = afericao.limites.find((l) => l.titulo.includes("Sem contrapartida"));
    expect(limite).toBeDefined();
    expect(limite!.valor!.segunda).toBeGreaterThan(0);
  });
});

describe("o canal sem painel é não conferido, e não é conferido com nota zero", () => {
  const semPainel = aferir({
    canal: "AS",
    emitido: { primeira: 100, segunda: 200, total: 300 },
    semPainel: "CANAL_SEM_CATALOGO",
    comparado: null,
  } as unknown as CanalDoResumo);

  it("precisão é indefinida, não zero", () => {
    /*
      Zero afirmaria que a conta está errada. Ninguém fez conta nenhuma: os
      rótulos do painel do AS nunca foram transcritos. As duas afirmações pedem
      coisas opostas de quem lê.
    */
    expect(semPainel.precisao.total).toBeNull();
  });

  it("lastro é zero, e é uma afirmação — não há documento cruzado atrás daquele dinheiro", () => {
    expect(semPainel.lastro.total).toBe(0);
    expect(semPainel.movimentado.total).toBe(300);
  });

  it("o motivo vai escrito, e diz de quem é o trabalho", () => {
    const limite = semPainel.limites[0]!;
    expect(limite.titulo).toContain("AS");
    expect(limite.texto).toContain("trabalho nosso");
    expect(limite.valor!.total).toBe(300);
  });
});

describe("o detalhamento por classe fecha com os totais", () => {
  const afericao = aferir(canalDaRota());
  const classes = porClasse(afericao);

  it("a soma das classes que contam é o lastro", () => {
    const soma = classes
      .filter((c) => c.conta)
      .reduce((s, c) => s + (c.comLastro.segunda ?? 0), 0);
    expect(soma).toBeCloseTo(afericao.comLastroCruzado.segunda!, 2);
  });

  it("a soma de todas as classes é o movimentado", () => {
    const soma = classes.reduce((s, c) => s + (c.valor.segunda ?? 0), 0);
    expect(soma).toBeCloseTo(afericao.movimentado.segunda!, 2);
  });

  it("a classe sem parcela não aparece — a barra lateral não lista vazio", () => {
    expect(classes.every((c) => c.parcelas > 0)).toBe(true);
  });
});

describe("os limites são o que a aferição não mede", () => {
  it("o limite sem cifra é fixo, e é sobre o método", () => {
    /*
      O único texto desta suíte que não sai de número nenhum, e é de propósito:
      a afirmação é que uma competência não corrobora uma regra. Ela vale para
      todo fechamento, inclusive um que feche perfeito — e é justamente nesse
      que ela precisa aparecer.
    */
    const afericao = aferir(canalDaRota());
    const daRegra = afericao.limites.find((l) => l.valor === null);
    expect(daRegra).toBeDefined();
    expect(daRegra!.titulo).toContain("competência");
  });
});
