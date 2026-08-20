import { centavos, type Canal } from "./dominio";
import type { Ausencia, DeParaConferido, Papel, Quadro, QuadroConferido } from "./de-para";
import type { NaturezaDaVerba } from "./verbas";

/**
 * O mês inteiro numa página — o `RESUMO GERAL` da planilha, sem planilha.
 *
 * A apuração responde por **uma** quinzena, que é o grão do fechamento. Mas o
 * documento que a transportadora discute com a Ambev é mensal: a aba `Resumo
 * Geral` da `.xlsb` põe 1ª quinzena, 2ª quinzena e TOTAL lado a lado, e é
 * olhando para as três colunas que alguém decide se o mês fecha. Sem esta
 * consolidação, comparar exigia abrir duas telas e somar à mão — e somar à mão
 * o que o sistema já sabe é exatamente o trabalho que ele existe para tirar.
 *
 * **Por que a aritmética mora aqui e não na tela.** Pela mesma razão de
 * `lib/fechamento-gerencial`: uma soma feita no navegador é uma segunda opinião
 * sobre remuneração, e o produto não pode ter duas. Este módulo é puro — recebe
 * o que o banco guardou e devolve as três colunas —, o que permite conferir o
 * mês inteiro num teste sem subir nada.
 *
 * **Por que `null` e não `0` na quinzena que não apurou.** Uma quinzena sem
 * competência aberta e uma quinzena que valeu zero são coisas diferentes, e a
 * planilha confunde as duas (a célula vazia e a célula com `R$ -` têm a mesma
 * cara). Aqui a coluna vazia é `null` até o fim, e o total de uma quinzena só
 * é a soma das duas quando as duas existem — a alternativa seria apresentar
 * meio mês com cara de mês inteiro.
 *
 * **Por que o fecho compara com o 03.08.20, e não com o que a planilha chama de
 * `TOTAL GERAL UNIDADE`.** Aquela coluna é a reconstrução da própria planilha,
 * feita com um fator de conversão digitado (1,366960) que não sai de nenhum dos
 * arquivos. Reproduzi-la seria reproduzir o erro. O que este resumo põe lado a
 * lado são os dois números que têm documento: o que a Ambev **emitiu** em CT-e
 * (03.08.15) e o que o demonstrativo **assinado** diz que ela pagaria
 * (03.08.20).
 */

/** Um valor nas três colunas da planilha. `null` é ausência, nunca zero. */
export interface TresColunas {
  primeira: number | null;
  segunda: number | null;
  /** A soma das que existem, ou `null` quando nenhuma existe. */
  total: number | null;
}

/** Uma verba no mês, nas três colunas. */
export interface LinhaDoResumo {
  vbz: number;
  nome: string;
  natureza: NaturezaDaVerba | string;
  emitido: TresColunas;
  apurado: TresColunas;
}

/** As verbas de uma natureza, somadas — os quadros da planilha. */
export interface BlocoDoResumo {
  natureza: NaturezaDaVerba | string;
  titulo: string;
  linhas: LinhaDoResumo[];
  emitido: TresColunas;
  apurado: TresColunas;
}

/**
 * Um desconto do 03.08.20 no mês.
 *
 * Eles entram no resumo porque são as linhas que o `RESUMO GERAL` da planilha
 * traz entre as verbas e o total — `DESCONTO DE DEVOLUÇÃO`, `DESCONTO DE
 * DISPONIBILIDADE`, `DESCONTO COMPLEMENTAR NEGATIVO`. E entram **fora** das
 * somas: o relatório diz, em cada linha, que o valor já foi subtraído da verba
 * correspondente. Somá-los ao emitido descontaria duas vezes.
 */
export interface DescontoDoResumo {
  tipo: string;
  /** O rótulo curto, o que a tela mostra na coluna da esquerda. */
  nome: string;
  valores: TresColunas;
}

/* ---------------------------------------------------------------------------
   O painel da planilha, nas mesmas três colunas
   ------------------------------------------------------------------------ */

/**
 * Uma linha do `RESUMO` da planilha, no mês.
 *
 * A diferença para {@link LinhaDoResumo} não é de formato, é de pergunta. A
 * linha do resumo é uma **verba** — o recorte com que o fechamento apura, e o
 * único que os arquivos sustentam um a um. Esta é uma **linha da planilha** —
 * o recorte com que a Ambev e a transportadora discutem, que corta a mesma
 * conta por tipo de frota e por atividade. As duas dizem o mesmo dinheiro e
 * não dizem as mesmas linhas, e é por isso que existem as duas.
 */
export interface LinhaDoPainel {
  chave: string;
  /** O rótulo como a planilha o grita — para conferir contra o arquivo. */
  rotulo: string;
  /** O mesmo rótulo escrito como se escreve — o que a tela mostra. */
  nome: string;
  papel: Papel;
  /** `null` quando o número é do conjunto, ou quando não há número. */
  valores: TresColunas;
  /** A chave do conjunto quando o número é de várias linhas juntas. */
  conjunto: string | null;
  /** Por que não há número. `null` quando há. */
  ausencia: Ausencia | null;
  porque: string;
}

/** Um número do 03.08.20 que vale para várias linhas da planilha ao mesmo tempo. */
export interface ConjuntoDoPainel {
  chave: string;
  nome: string;
  /** Os nomes das linhas que dividem este número, na ordem da planilha. */
  linhas: string[];
  valores: TresColunas;
  porque: string;
}

export interface QuadroDoPainel {
  quadro: Quadro;
  titulo: string;
  linhas: LinhaDoPainel[];
  conjuntos: ConjuntoDoPainel[];
  /** O que o 03.08.20 fecha para o quadro. */
  total: TresColunas;
  /** O que o de-para preencheu — parcelas menos descontos, conjunto uma vez. */
  somado: TresColunas;
  /** `total − somado`. Zero é o quadro fechando. */
  residuo: TresColunas;
  /** Os nomes das linhas da planilha entre as quais o resíduo se divide. */
  semLastro: string[];
  /**
   * As verbas que estão no total do quadro e que nenhuma linha da planilha
   * nomeia — a outra metade do resíduo.
   *
   * Sem ela, um resíduo teimoso manda procurar no lugar errado: `semLastro` diz
   * "falta enquadrar uma linha nossa" e esta diz "falta uma linha no painel
   * deles", que são problemas opostos com o mesmo sintoma.
   */
  verbasSemLinha: { vbz: number; nome: string; valores: TresColunas }[];
}

/**
 * O painel da planilha de um canal, no mês.
 *
 * **Por que ele carrega dois totais.** `soma` é a soma dos quadros na coluna
 * que o de-para lê — sem imposto, que é a moeda em que a planilha escreve. O
 * `demonstrativo` é o `Total Remuneração` que o relatório fecha, com imposto —
 * e é o mesmo número que a conferência por verba mostra no seu fecho. Ter os
 * dois lado a lado, com a diferença entre eles nomeada, é o que permite às duas
 * leituras baterem sem que nenhuma converta nada: a diferença é subtração de
 * dois números do mesmo arquivo, não um fator digitado.
 */
export interface PainelDaPlanilha {
  canal: Canal;
  quadros: QuadroDoPainel[];
  /** A soma dos quadros, na coluna que a planilha usa (sem imposto). */
  soma: TresColunas;
  /** O imposto — `demonstrativo − soma`, medido, nunca presumido. */
  imposto: TresColunas;
  /** O `Total Remuneração` do 03.08.20 — o número que as duas abas partilham. */
  demonstrativo: TresColunas;
}

export interface CanalDoResumo {
  canal: Canal;
  blocos: BlocoDoResumo[];
  /**
   * Os descontos do demonstrativo, sem imposto e já subtraídos das verbas.
   * Informativos: existem para conferir contra a planilha, não para somar.
   */
  descontos: DescontoDoResumo[];
  emitido: TresColunas;
  /** O que a apuração reconstruiu — a soma dos apurados. */
  conferido: TresColunas;
  /** O emitido que nenhuma fonte sustenta. */
  semFonte: TresColunas;
  /** `Total Remuneração` do 03.08.20 — o lado que a Ambev assina. */
  demonstrativo: TresColunas;
  /** `emitido − demonstrativo`. Positivo: emitiu-se mais do que o combinado. */
  diferenca: TresColunas;
  /**
   * O mesmo mês nas linhas da planilha. `null` quando não há painel deste canal.
   *
   * Hoje só a Rota tem: os rótulos do painel do AS não foram transcritos, e
   * escrevê-los por analogia com os da Rota inventaria a metade que falta.
   */
  painel: PainelDaPlanilha | null;
}

/** O que uma quinzena traz para o resumo — o que o banco guardou dela. */
export interface QuinzenaApurada {
  quinzena: 1 | 2;
  competenciaId: string;
  chave: string;
  estado: string;
  /** Nulo quando a competência existe e ainda não apurou. */
  verbas:
    | {
        vbz: number;
        canal: string;
        nome: string;
        natureza: string;
        emitido: number;
        esperado: number | null;
      }[]
    | null;
  /**
   * O `Total Remuneração` do 03.08.20, por canal.
   *
   * Vem da soma de `valor_faturado` dos itens gravados, que é como o próprio
   * relatório o fecha (frete + outros custos). Nulo quando o 03.08.20 não foi
   * importado — e aí a coluna do fecho fica vazia em vez de zerada.
   */
  demonstrativo: { canal: Canal; total: number }[] | null;
  /** Os descontos do 03.08.20, somados por canal e tipo. */
  descontos: { canal: Canal; tipo: string; valor: number }[] | null;
  /**
   * O painel da planilha desta quinzena, já conferido contra o 03.08.20.
   *
   * Nulo quando o demonstrativo não foi importado — e nulo é o certo: um painel
   * de zeros diria que a quinzena não pagou nada, que é outra afirmação.
   */
  paineis?: DeParaConferido[] | null;
}

export interface ResumoDoMes {
  ano: number;
  mes: number;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  /** As duas quinzenas do mês, existam elas ou não. */
  quinzenas: {
    quinzena: 1 | 2;
    competenciaId: string | null;
    chave: string | null;
    estado: string | null;
    apurada: boolean;
    temDemonstrativo: boolean;
  }[];
  canais: CanalDoResumo[];
}

/** Os quadros, na ordem em que a planilha os empilha. */
const BLOCOS: { natureza: string; titulo: string }[] = [
  { natureza: "FIXO", titulo: "Fixo — a parcela contratada da frota e da equipe" },
  { natureza: "ADMINISTRATIVO", titulo: "Administrativo — o repasse fixo" },
  { natureza: "VARIAVEL", titulo: "Variável — o que a operação rodou" },
  { natureza: "COMPLEMENTAR", titulo: "Complementar — a despesa extra aprovada" },
];

/**
 * Soma duas colunas que podem não existir.
 *
 * `null + 5` não é `5`: é `5` com a ressalva de que metade do mês não foi
 * apurada. A ressalva viaja no próprio dado — o total só some quando as duas
 * quinzenas somem —, porque uma tela que recebe um número não tem como saber
 * que ele é meio.
 */
function somar(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return centavos((a ?? 0) + (b ?? 0));
}

function tresColunas(primeira: number | null, segunda: number | null): TresColunas {
  return { primeira, segunda, total: somar(primeira, segunda) };
}

function acumular(alvo: TresColunas, parcela: TresColunas): TresColunas {
  return {
    primeira: somar(alvo.primeira, parcela.primeira),
    segunda: somar(alvo.segunda, parcela.segunda),
    total: somar(alvo.total, parcela.total),
  };
}

const VAZIO: TresColunas = { primeira: null, segunda: null, total: null };

function subtrair(a: TresColunas, b: TresColunas): TresColunas {
  const menos = (x: number | null, y: number | null) =>
    x === null || y === null ? null : centavos(x - y);
  return {
    primeira: menos(a.primeira, b.primeira),
    segunda: menos(a.segunda, b.segunda),
    total: menos(a.total, b.total),
  };
}

/**
 * O painel da planilha de um canal, com as duas quinzenas lado a lado.
 *
 * A estrutura — quais quadros, quais linhas, em que ordem — é do catálogo do
 * de-para e é a mesma nas duas quinzenas; o que muda de uma para a outra é só o
 * número. Por isso o esqueleto vem da quinzena que existir, e a que faltar
 * deixa a coluna dela vazia — igual ao resto desta tela, e pelo mesmo motivo:
 * meio mês importado é o estado normal de quem está trabalhando.
 */
function montarPainel(
  canal: Canal,
  primeira: DeParaConferido | null,
  segunda: DeParaConferido | null,
): PainelDaPlanilha | null {
  const esqueleto = primeira ?? segunda;
  if (!esqueleto) return null;

  /* A mesma chave nas duas quinzenas é a mesma linha — é para isso que ela existe. */
  const linhaDe = (painel: DeParaConferido | null, chave: string) =>
    painel?.quadros.flatMap((q) => q.linhas).find((l) => l.chave === chave) ?? null;
  const quadroDe = (painel: DeParaConferido | null, quadro: Quadro) =>
    painel?.quadros.find((q) => q.quadro === quadro) ?? null;

  const quadros: QuadroDoPainel[] = esqueleto.quadros.map((modelo) => {
    const q1 = quadroDe(primeira, modelo.quadro);
    const q2 = quadroDe(segunda, modelo.quadro);

    const linhas: LinhaDoPainel[] = modelo.linhas.map((modeloDaLinha) => {
      const l1 = linhaDe(primeira, modeloDaLinha.chave);
      const l2 = linhaDe(segunda, modeloDaLinha.chave);
      return {
        chave: modeloDaLinha.chave,
        rotulo: modeloDaLinha.rotulo,
        nome: modeloDaLinha.nome,
        papel: modeloDaLinha.papel,
        valores: tresColunas(l1?.valor ?? null, l2?.valor ?? null),
        conjunto: l1?.conjunto?.chave ?? l2?.conjunto?.chave ?? null,
        /* A ausência é a mesma nas duas quando as duas a têm; basta dizer uma vez. */
        ausencia: l1?.ausencia ?? l2?.ausencia ?? null,
        porque: modeloDaLinha.porque,
      };
    });

    /*
      Os conjuntos aparecem uma vez cada, na ordem da primeira linha que os
      cita — que é a ordem da planilha. Repeti-los por linha multiplicaria na
      tela um número que existe uma vez só.
    */
    const conjuntos: ConjuntoDoPainel[] = [];
    for (const linha of modelo.linhas) {
      const chave = linha.conjunto?.chave;
      if (!chave || conjuntos.some((c) => c.chave === chave)) continue;
      const c1 = linhaDe(primeira, linha.chave)?.conjunto ?? null;
      const c2 = linhaDe(segunda, linha.chave)?.conjunto ?? null;
      const modeloDoConjunto = c1 ?? c2;
      if (!modeloDoConjunto) continue;
      conjuntos.push({
        chave,
        nome: modeloDoConjunto.rotulo,
        linhas: modeloDoConjunto.linhas.map(
          (c) => linhas.find((l) => l.chave === c)?.nome ?? c,
        ),
        valores: tresColunas(c1?.valor ?? null, c2?.valor ?? null),
        porque: modeloDoConjunto.porque,
      });
    }

    /* O que uma quinzena não sustenta, a outra ainda pode: a lista é a união. */
    const semLastro = [...new Set([...(q1?.semLastro ?? []), ...(q2?.semLastro ?? [])])];

    /* Idem para a verba que o painel não nomeia: uma vez por VBZ, nas duas colunas. */
    const vbzsSemLinha = [
      ...new Map(
        [...(q1?.verbasSemLinha ?? []), ...(q2?.verbasSemLinha ?? [])].map((v) => [v.vbz, v]),
      ).values(),
    ].sort((a, b) => a.vbz - b.vbz);
    const valorSemLinha = (painel: QuadroConferido | null, vbz: number) =>
      painel?.verbasSemLinha.find((v) => v.vbz === vbz)?.valor ?? null;

    return {
      quadro: modelo.quadro,
      titulo: modelo.titulo,
      linhas,
      conjuntos,
      total: tresColunas(q1?.total ?? null, q2?.total ?? null),
      somado: tresColunas(q1?.somado ?? null, q2?.somado ?? null),
      residuo: tresColunas(q1?.residuo ?? null, q2?.residuo ?? null),
      semLastro,
      verbasSemLinha: vbzsSemLinha.map((v) => ({
        vbz: v.vbz,
        nome: v.nome,
        valores: tresColunas(valorSemLinha(q1, v.vbz), valorSemLinha(q2, v.vbz)),
      })),
    };
  });

  return {
    canal,
    quadros,
    soma: tresColunas(primeira?.totalDosQuadros ?? null, segunda?.totalDosQuadros ?? null),
    imposto: tresColunas(primeira?.diferenca ?? null, segunda?.diferenca ?? null),
    demonstrativo: tresColunas(
      primeira?.totalDoRelatorio ?? null,
      segunda?.totalDoRelatorio ?? null,
    ),
  };
}

/**
 * O painel de uma quinzena só, na mesma forma do mensal.
 *
 * A tela da competência aberta faz a mesma pergunta da tela do mês, com uma
 * coluna em vez de três — e uma forma só é o que garante que as duas mostrem a
 * mesma coisa. Reformatá-la no navegador seria pedir para as duas divergirem
 * no dia em que uma delas mudasse.
 */
export function painelDeUmaQuinzena(
  quinzena: 1 | 2,
  conferido: DeParaConferido,
): PainelDaPlanilha {
  return montarPainel(
    conferido.canal,
    quinzena === 1 ? conferido : null,
    quinzena === 2 ? conferido : null,
  )!;
}

/**
 * Monta o resumo do mês a partir do que o banco guardou de cada quinzena.
 *
 * Recebe zero, uma ou duas quinzenas: o mês em que só a segunda foi importada é
 * o caso comum de quem está no meio do trabalho, e ele tem de aparecer inteiro,
 * com a primeira coluna vazia e dizendo por quê — em vez de esperar as duas
 * para mostrar qualquer coisa.
 */
export function montarResumo(entrada: {
  ano: number;
  mes: number;
  unidade: { codigo: string; nome: string | null };
  transportadora: { codigo: string; nome: string | null };
  quinzenas: QuinzenaApurada[];
}): ResumoDoMes {
  const daQuinzena = (n: 1 | 2) => entrada.quinzenas.find((q) => q.quinzena === n) ?? null;
  const primeira = daQuinzena(1);
  const segunda = daQuinzena(2);

  const valorDe = (q: QuinzenaApurada | null, escolher: (v: NonNullable<QuinzenaApurada["verbas"]>[number]) => number | null, filtro: (v: NonNullable<QuinzenaApurada["verbas"]>[number]) => boolean) => {
    if (!q?.verbas) return null;
    const alvos = q.verbas.filter(filtro);
    if (alvos.length === 0) return null;
    const valores = alvos.map(escolher).filter((n): n is number => n !== null);
    if (valores.length === 0) return null;
    return centavos(valores.reduce((s, n) => s + n, 0));
  };

  /* O universo de verbas é a união das duas quinzenas: uma verba que só
     apareceu numa delas ainda é linha do mês, com a outra coluna vazia. */
  const canais = new Map<Canal, Map<number, { nome: string; natureza: string }>>();
  for (const q of entrada.quinzenas) {
    for (const v of q.verbas ?? []) {
      const canal = v.canal as Canal;
      const porVbz = canais.get(canal) ?? new Map();
      if (!porVbz.has(v.vbz)) porVbz.set(v.vbz, { nome: v.nome, natureza: v.natureza });
      canais.set(canal, porVbz);
    }
  }

  const montados: CanalDoResumo[] = [];
  for (const [canal, verbas] of [...canais].sort((a, b) => a[0].localeCompare(b[0]))) {
    const blocos: BlocoDoResumo[] = [];
    let emitidoDoCanal = VAZIO;
    let conferidoDoCanal = VAZIO;
    let semFonteDoCanal = VAZIO;

    for (const { natureza, titulo } of BLOCOS) {
      const daNatureza = [...verbas]
        .filter(([, v]) => v.natureza === natureza)
        .sort((a, b) => a[0] - b[0]);
      if (daNatureza.length === 0) continue;

      const linhas: LinhaDoResumo[] = [];
      let emitidoDoBloco = VAZIO;
      let apuradoDoBloco = VAZIO;

      for (const [vbz, { nome }] of daNatureza) {
        const mesma = (v: { vbz: number; canal: string }) => v.vbz === vbz && v.canal === canal;
        const emitido = tresColunas(
          valorDe(primeira, (v) => v.emitido, mesma),
          valorDe(segunda, (v) => v.emitido, mesma),
        );
        const apurado = tresColunas(
          valorDe(primeira, (v) => v.esperado, mesma),
          valorDe(segunda, (v) => v.esperado, mesma),
        );
        linhas.push({ vbz, nome, natureza, emitido, apurado });
        emitidoDoBloco = acumular(emitidoDoBloco, emitido);
        apuradoDoBloco = acumular(apuradoDoBloco, apurado);
      }

      blocos.push({ natureza, titulo, linhas, emitido: emitidoDoBloco, apurado: apuradoDoBloco });
      emitidoDoCanal = acumular(emitidoDoCanal, emitidoDoBloco);
      conferidoDoCanal = acumular(conferidoDoCanal, apuradoDoBloco);
    }

    /* O sem fonte é o emitido das verbas que a apuração não reconstruiu — e é
       contado sobre as verbas, não como `emitido − conferido`: a subtração
       daria o mesmo número por acaso e esconderia a verba que fecha com
       diferença. */
    const semFonte = (q: QuinzenaApurada | null) =>
      valorDe(q, (v) => v.emitido, (v) => v.canal === canal && v.esperado === null);
    semFonteDoCanal = tresColunas(semFonte(primeira), semFonte(segunda));

    /*
      Os descontos aparecem na ordem em que a planilha os empilha, e só os que
      alguma das duas quinzenas trouxe: uma linha de desconto zerada em todo o
      mês é ruído — o relatório traz as quatro de disponibilidade sempre, e
      três delas costumam ser zero.
    */
    const tiposDeDesconto = new Map<string, string>([
      ["DEVOLUCAO", "Desconto de devolução"],
      ["DISPONIBILIDADE_CUSTO_FIXO", "Disponibilidade — custo fixo"],
      ["DISPONIBILIDADE_EQUIPE", "Disponibilidade — equipe de entrega"],
      ["DISPONIBILIDADE_INDIRETO", "Disponibilidade — custo indireto"],
      ["DISPONIBILIDADE_FATOR_AJUDANTE", "Disponibilidade — fator ajudante"],
      ["FRETE_MINIMO", "Desconto de frete mínimo"],
    ]);
    const descontos: DescontoDoResumo[] = [];
    for (const [tipo, nome] of tiposDeDesconto) {
      const valorDoDesconto = (q: QuinzenaApurada | null) => {
        const achado = q?.descontos?.find((d) => d.canal === canal && d.tipo === tipo);
        return achado ? achado.valor : null;
      };
      const valores = tresColunas(valorDoDesconto(primeira), valorDoDesconto(segunda));
      if (valores.total === null || valores.total === 0) continue;
      descontos.push({ tipo, nome, valores });
    }

    const doDemonstrativo = (q: QuinzenaApurada | null) =>
      q?.demonstrativo?.find((d) => d.canal === canal)?.total ?? null;
    const demonstrativo = tresColunas(doDemonstrativo(primeira), doDemonstrativo(segunda));

    const doPainel = (q: QuinzenaApurada | null) =>
      q?.paineis?.find((p) => p.canal === canal) ?? null;

    montados.push({
      canal,
      blocos,
      descontos,
      emitido: emitidoDoCanal,
      conferido: conferidoDoCanal,
      semFonte: semFonteDoCanal,
      demonstrativo,
      diferenca: subtrair(emitidoDoCanal, demonstrativo),
      painel: montarPainel(canal, doPainel(primeira), doPainel(segunda)),
    });
  }

  return {
    ano: entrada.ano,
    mes: entrada.mes,
    unidade: entrada.unidade,
    transportadora: entrada.transportadora,
    quinzenas: ([1, 2] as const).map((n) => {
      const q = daQuinzena(n);
      return {
        quinzena: n,
        competenciaId: q?.competenciaId ?? null,
        chave: q?.chave ?? null,
        estado: q?.estado ?? null,
        apurada: !!q?.verbas,
        temDemonstrativo: !!q?.demonstrativo,
      };
    }),
    canais: montados,
  };
}
