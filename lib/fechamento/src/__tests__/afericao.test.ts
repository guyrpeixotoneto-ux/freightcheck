import { describe, expect, it } from "vitest";

import { aferir, porClasse, type Afericao } from "../afericao";
import { conferirDePara } from "../de-para";
import { fontesDaQuinzena, TIPOS_DE_FONTE, type TipoDeFonte } from "../dominio";
import {
  descontoDeDisponibilidadeDoMes,
  type DiaDeDisponibilidade,
} from "../leitores/disponibilidade";
import { lerPagamento } from "../leitores/pagamento";
import { montarMapaDaQuinzena, type ParametrosDoCadastro } from "../mapa-rota";
import { basesDaQuinzena } from "../persistencia";
import {
  compararPaineis,
  painelDeUmaQuinzena,
  type CanalDoResumo,
  type ResumoDoMes,
} from "../resumo";
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
function canalDaRota(cadastro: CanalDoResumo["cadastro"] = { primeira: null, segunda: null }): CanalDoResumo {
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
    cadastro,
  } as unknown as CanalDoResumo;
}

const parcela = (a: Afericao, chave: string) => a.parcelas.find((p) => p.chave === chave)!;

/**
 * As duas quinzenas do mês, com o estado das fontes de cada uma.
 *
 * `recebidas` em `null` é a quinzena **não aberta** — sem competência, e por
 * isso sem documento. É o estado que produzia o falso 0,0%.
 */
function quinzenas(
  primeira: readonly TipoDeFonte[] | null,
  segunda: readonly TipoDeFonte[] | null,
): ResumoDoMes["quinzenas"] {
  return ([1, 2] as const).map((n) => {
    const recebidas = n === 1 ? primeira : segunda;
    return {
      quinzena: n,
      competenciaId: recebidas === null ? null : `id-${n}`,
      chave: recebidas === null ? null : `2026-07-Q${n}`,
      estado: recebidas === null ? null : "APURADA",
      apurada: recebidas !== null,
      temDemonstrativo: (recebidas ?? []).includes("PAGAMENTO"),
      fontes: fontesDaQuinzena(n, recebidas),
    };
  });
}

/** O mês inteiro completo: as duas quinzenas com tudo o que esperam. */
const COMPLETO = () => quinzenas([...TIPOS_DE_FONTE], [...TIPOS_DE_FONTE]);

describe("os dois números medem coisas diferentes", () => {
  const afericao = aferir(canalDaRota(), COMPLETO());

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
    /*
      Zero **medido**, e não nulo: a linha fecha, os dois lados existem e são
      iguais. A distinção decide a soma do mês — `somarNaoExplicado` trata nulo
      como "não se sabe" e apaga a precisão da coluna inteira, e uma linha que
      está certa não pode apagar a nota do mês.
    */
    expect(devolucao.naoExplicado.segunda).toBe(0);
  });

  it("a linha de dois documentos diferentes sobe os dois", () => {
    const disponibilidade = parcela(afericao, "desconto_disponibilidade");
    expect(disponibilidade.classe).toBe("CRUZADO");
    expect(disponibilidade.fonteDoDevido).toContain("03.08.18");
    expect(disponibilidade.comLastro.segunda).toBe(disponibilidade.valor.segunda);
  });
});

describe("o dinheiro é contado uma vez, e o quadro que abre outro não é dinheiro novo", () => {
  const afericao = aferir(canalDaRota(), COMPLETO());

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
  const semPainel = aferir(
    {
      canal: "AS",
      emitido: { primeira: 100, segunda: 200, total: 300 },
      semPainel: "CANAL_SEM_CATALOGO",
      comparado: null,
    } as unknown as CanalDoResumo,
    COMPLETO(),
  );

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
  const afericao = aferir(canalDaRota(), COMPLETO());
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
    const afericao = aferir(canalDaRota(), COMPLETO());
    const daRegra = afericao.limites.find((l) => l.valor === null);
    expect(daRegra).toBeDefined();
    expect(daRegra!.titulo).toContain("competência");
  });
});

/**
 * OS SEIS CENÁRIOS DA COMPLETUDE — e o falso 0,0% que motivou tudo.
 *
 * **O defeito, em uma frase.** A aferição calculava precisão sobre um
 * fechamento pela metade sem saber que estava pela metade. Faltando a 2ª
 * quinzena, as três parcelas de lastro cruzado — disponibilidade, outros custos
 * e equipe de entrega — valem zero, porque as três só existem lá. A razão
 * `1 − não explicado ÷ com contrapartida` ficava negativa, o `Math.max(0, …)`
 * a prendia em zero, e a tela imprimia **0,0% em vermelho**: quem lê entende
 * "a remuneração está toda errada" quando a verdade é "ainda não tenho os
 * documentos".
 *
 * O conserto não é trocar o clamp por `null`. É decidir **antes** se há base
 * para a pergunta — e é isso que estes testes prendem, cenário a cenário.
 */
describe("a aferição separa `não tenho dados` de `os dados não batem`", () => {
  const rota = canalDaRota();

  it("A — mês completo: precisão calculada, nenhum aviso de documento faltante", () => {
    const a = aferir(rota, COMPLETO());
    expect(a.aferibilidade.total.completude).toBe("COMPLETO");
    expect(a.aferibilidade.total.faltando).toEqual([]);
    /*
      O que A afirma é que a pergunta **foi feita** — um número em [0,1], não um
      número alto. Quanto ele vale é assunto de B: a fixture sintética diverge
      de propósito, e um mês completo que diverge continua sendo um mês completo.
    */
    expect(a.precisao.segunda).not.toBeNull();
    expect(a.precisao.segunda!).toBeGreaterThanOrEqual(0);
    expect(a.precisao.segunda!).toBeLessThanOrEqual(1);
    expect(a.limites.some((l) => l.titulo === "Faltam dados para aferir")).toBe(false);
  });

  it("B — mês completo com divergência: precisão calculada, e não é `incompleto`", () => {
    /*
      **É o teste que impede o conserto de virar desculpa.** Uma divergência
      real tem de continuar aparecendo como divergência: se "incompleto"
      passasse a absorver todo caso ruim, a tela deixaria de acusar erro.
    */
    const a = aferir(rota, COMPLETO());
    expect(a.aferibilidade.segunda.completude).toBe("COMPLETO");
    expect(a.naoExplicado.segunda!).toBeGreaterThan(0);
    expect(a.precisao.segunda).not.toBeNull();
    expect(a.precisao.segunda!).toBeLessThan(1);
  });

  it("C — falta a 2ª quinzena inteira: precisão `null` e a lista do que falta", () => {
    const a = aferir(rota, quinzenas([...TIPOS_DE_FONTE], null));

    expect(a.precisao.segunda).toBeNull();
    expect(a.precisao.total).toBeNull();
    expect(a.aferibilidade.segunda.completude).toBe("INCOMPLETO");
    expect(a.aferibilidade.total.completude).toBe("INCOMPLETO");

    /*
      As **seis** que a 2ª quinzena espera, o 03.08.18 entre elas. Ele é
      quinzenal como as outras: o relatório abre linha por dia, e os dias de
      16 a 31 só existem na remessa da 2ª. Ver `fontesDaQuinzena`.
    */
    const faltam = a.aferibilidade.segunda.faltando;
    expect(faltam.map((f) => f.rotina).sort()).toEqual(
      [
        "03.02.59.02",
        "03.08.12.09",
        "03.08.15",
        "03.08.18 FF",
        "03.08.18 Vans",
        "03.08.20",
        "2Art",
      ].sort(),
    );
    expect(faltam.every((f) => f.quinzena === 2)).toBe(true);
    expect(faltam.every((f) => f.motivo === "QUINZENA_NAO_ABERTA")).toBe(true);
  });

  it("D — o falso 0,0% não volta: sem base, é traço, nunca zero", () => {
    /*
      **O controle negativo desta suíte.** No código anterior esta asserção
      falhava com `0` — a razão saía negativa e o clamp a entregava como zero
      absoluto, que a tela pinta de vermelho. Aqui ela tem de ser `null`.
    */
    const a = aferir(rota, quinzenas([...TIPOS_DE_FONTE], null));
    expect(a.precisao.total).not.toBe(0);
    expect(a.precisao.total).toBeNull();
    expect(a.precisao.segunda).not.toBe(0);

    /* E o motivo vai escrito, para o traço não ser um mistério. */
    expect(a.aferibilidade.total.porque).toContain("incompleto");
    expect(a.limites[0]!.titulo).toBe("Faltam dados para aferir");
    expect(a.limites[0]!.texto).toContain("2Art · 2ª quinzena");
  });

  it("E — fonte não aplicável não vira documento faltante", () => {
    /*
      A 1ª quinzena não tem conciliação (03.02.59.02) e não cobra o 03.08.12.09
      — o primeiro não existe ali, o segundo é admitido sem ser esperado. Nenhum
      dos dois pode aparecer como pendência: seria mandar procurar um arquivo
      que ninguém emitiu.
    */
    const so5: TipoDeFonte[] = [
      "OPERACAO",
      "CTE",
      "PAGAMENTO",
      "DISPONIBILIDADE_FF",
      "DISPONIBILIDADE_VAN",
    ];
    const a = aferir(rota, quinzenas(so5, [...TIPOS_DE_FONTE]));

    expect(a.aferibilidade.primeira.faltando).toEqual([]);
    expect(a.aferibilidade.primeira.completude).not.toBe("INCOMPLETO");
    expect(a.aferibilidade.total.completude).toBe("COMPLETO");
  });

  it("F — documento importado sem a verba é diferente de documento não importado", () => {
    /*
      As duas coisas já se distinguem, e por caminhos diferentes: a **fonte**
      responde se o arquivo chegou; a **linha** responde se ele trouxe a verba.
      Um 03.08.20 importado sem bloco de disponibilidade dá fonte `PRESENTE` e
      linha sem demonstrado — e é assim que a tela manda conferir a verba em vez
      de mandar reenviar o arquivo.
    */
    const a = aferir(rota, COMPLETO());
    expect(a.aferibilidade.total.faltando).toEqual([]);

    const dvs = parcela(a, "rota_dvs");
    expect(dvs.classe).not.toBe("SEM_CONTRAPARTIDA");

    /* O 03.08.20 chegou; o que não veio nele foi a linha `DVS`. */
    const daFonte = quinzenas([...TIPOS_DE_FONTE], [...TIPOS_DE_FONTE])[1]!.fontes;
    expect(daFonte.find((f) => f.tipo === "PAGAMENTO")!.estado).toBe("PRESENTE");
  });

  it("o lastro continua sendo calculado no mês incompleto — ele mede cobertura, não acerto", () => {
    /*
      Zerar o lastro junto com a precisão esconderia que o que chegou **tem**
      documento atrás. São duas perguntas, e só uma delas fica sem resposta
      quando falta arquivo.
    */
    const a = aferir(rota, quinzenas([...TIPOS_DE_FONTE], null));
    expect(a.lastro.segunda).not.toBeNull();
    expect(a.precisao.segunda).toBeNull();
  });

  it("o canal sem painel é `NAO_APLICAVEL`, e não `INCOMPLETO`", () => {
    /*
      Incompleto pede arquivo; não aplicável pede transcrição. Mandar quem lê
      procurar um 03.08.20 do AS não resolveria nada — o que falta é o painel.
    */
    const a = aferir(
      { canal: "AS", emitido: { primeira: 100, segunda: 200, total: 300 }, semPainel: "CANAL_SEM_CATALOGO", comparado: null } as unknown as CanalDoResumo,
      COMPLETO(),
    );
    expect(a.aferibilidade.total.completude).toBe("NAO_APLICAVEL");
    expect(a.aferibilidade.total.faltando).toEqual([]);
  });
});


/**
 * SEM CONTRATO NÃO HÁ DEVIDO — e isso é fechamento incompleto, não fechamento errado.
 *
 * **O defeito, e como ele apareceu.** Uma competência real tinha as duas
 * quinzenas abertas, encerradas, com os seis relatórios importados nas duas — e
 * a coluna da 2ª quinzena inteira em traço. A aferição dizia `COMPLETO`, porque
 * só olhava relatórios; a tela não tinha uma palavra explicando o vazio, porque
 * `PorQueNaoTemDevido` só aparece quando **não há** painel comparado, e ali
 * havia (a 1ª quinzena respondera). Quem operava ficou olhando meia tela vazia
 * sem ter como saber por quê.
 *
 * **Por que é a mesma família do falso 0,0%.** Ausência de contrato não é
 * contrato zero. O devido sai dele; sem ele nenhuma linha da quinzena tem
 * número, e declarar o mês completo afirma uma conferência que não aconteceu.
 */
describe("a falta de contrato é uma pendência, e ela tem nome", () => {
  const semVigencia = (): CanalDoResumo["cadastro"][keyof CanalDoResumo["cadastro"]] =>
    ({
      estado: "SEM_VIGENCIA",
      unidade: { codigoProcurado: "0443", cadastradas: 1, candidatas: 1, comoCasou: "EXATO", codigoNoCadastro: "0443", codigosCadastrados: ["0443"], identidade: null, sugestoes: [] },
      vigencia: { doMes: ["2026-07-01"], todas: ["2026-07-01"], vigenteDe: null },
      contrato: null,
      destrava: {
        problema: "A unidade está cadastrada e nenhuma vigência **deste mês** tem aba digitada.",
        conserto: "Digite a aba da vigência desta quinzena.",
      },
    }) as unknown as CanalDoResumo["cadastro"]["primeira"];

  const respondeu = (): CanalDoResumo["cadastro"]["primeira"] =>
    ({ estado: "RESPONDEU", unidade: {}, vigencia: {}, contrato: {}, destrava: null }) as unknown as CanalDoResumo["cadastro"]["primeira"];

  it("o controle: com as duas quinzenas contratadas, o mês é completo", () => {
    const a = aferir(canalDaRota({ primeira: respondeu(), segunda: respondeu() }), COMPLETO());
    expect(a.aferibilidade.total.completude).toBe("COMPLETO");
    expect(a.aferibilidade.total.semContrato).toEqual([]);
  });

  it("a 2ª quinzena sem contrato deixa o mês incompleto — e a precisão em branco", () => {
    const a = aferir(canalDaRota({ primeira: respondeu(), segunda: semVigencia() }), COMPLETO());

    expect(a.aferibilidade.segunda.completude).toBe("INCOMPLETO");
    expect(a.aferibilidade.total.completude).toBe("INCOMPLETO");
    /* O conserto inteiro: sem base, traço — nunca zero, nunca um percentual baixo. */
    expect(a.precisao.segunda).toBeNull();
    expect(a.precisao.total).toBeNull();
    expect(a.precisao.total).not.toBe(0);
  });

  it("a falta de contrato NÃO vira relatório faltante", () => {
    /*
      O contraprova do modelo. Empurrar o contrato para dentro de `faltando`
      faria a tela mandar importar um arquivo que ninguém emitiu — e o gesto
      certo é digitar uma aba noutra tela.
    */
    const a = aferir(canalDaRota({ primeira: respondeu(), segunda: semVigencia() }), COMPLETO());

    expect(a.aferibilidade.total.faltando).toEqual([]);
    expect(a.aferibilidade.total.semContrato).toHaveLength(1);
    expect(a.aferibilidade.total.semContrato[0]).toMatchObject({
      quinzena: 2,
      estado: "SEM_VIGENCIA",
    });
  });

  it("o motivo vai escrito, com o conserto que o domínio já sabia", () => {
    const a = aferir(canalDaRota({ primeira: respondeu(), segunda: semVigencia() }), COMPLETO());

    expect(a.aferibilidade.total.porque).toContain("contratadas");
    expect(a.aferibilidade.segunda.porque).toContain("cadastro desta quinzena não respondeu");
    /* E o limite entra na frente do de relatórios: é ele que apaga a coluna. */
    expect(a.limites[0]!.titulo).toBe("Falta o cadastro de uma quinzena");
    expect(a.limites[0]!.texto).toContain("2ª quinzena");
    expect(a.limites[0]!.texto).toContain("não é zero");
    expect(a.aferibilidade.total.semContrato[0]!.conserto).toContain("Digite a aba");
  });

  it("quinzena não aberta não é cobrada de cadastro — a pendência dela é outra", () => {
    /*
      Sem competência não há período para o cadastro responder. Cobrar as duas
      pendências de uma vez mandaria digitar o cadastro de um mês que ainda não
      existe; a ordem é abrir, depois cadastrar.
    */
    const a = aferir(
      canalDaRota({ primeira: respondeu(), segunda: semVigencia() }),
      quinzenas([...TIPOS_DE_FONTE], null),
    );

    expect(a.aferibilidade.segunda.semContrato).toEqual([]);
    expect(a.aferibilidade.segunda.completude).toBe("INCOMPLETO");
    expect(a.aferibilidade.segunda.porque).toContain("ainda não foi aberta");
  });
});
