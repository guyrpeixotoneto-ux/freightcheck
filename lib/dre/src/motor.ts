/**
 * O motor da DRE — **a autoridade única de §30**.
 *
 * Uma função pura, do material de uma vigência à demonstração. A API, a tela e
 * o Assistente chamam daqui; nenhum dos três soma nada por conta própria. Foi a
 * exigência mais explícita do pedido, e ela só se sustenta se o motor for puro:
 * uma função que precisa de banco acaba tendo uma "versão rápida" no frontend.
 *
 * **O que o motor se recusa a fazer**, e é a metade que importa:
 *
 * - não transforma ausência em zero — `valor` é `number | null`;
 * - não fecha subtotal cujo componente essencial esteja ausente — ele fica
 *   `INCONCLUSIVO`, com a lista do que o bloqueia;
 * - não soma periodicidades diferentes sem passar por `normalizarParaCompetencia`,
 *   e guarda a transformação junto do número;
 * - não deixa nenhum número sem origem: toda linha com valor carrega os
 *   atributos, os fatos e as células que a produziram.
 */

import type {
  AttributeClassification,
} from "@workspace/comparison";
import type { ValorAprovado } from "@workspace/composition";
import {
  aplicaAoEscopo,
  componentesDoEscopo,
  NOTA_DA_SECAO,
  ROTULO_DA_AUSENCIA,
  ROTULO_DO_SUBTOTAL,
  SECOES,
  SECOES_DO_SUBTOTAL,
  type ComponenteDaDRE,
  type EscopoDeAlocacao,
  type MotivoDeAusencia,
  type NaturezaDoValor,
  type SecaoId,
  type SubtotalId,
} from "./plano";
import {
  normalizarParaCompetencia,
  type CompetenciaDaDRE,
  type Transformacao,
} from "./normalizacao";

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

/** Um lado da unidade econômica: o cavalo, a carreta, ou os dois num conjunto. */
export interface LadoDaApuracao {
  entityId: string;
  entityType: "CAVALO" | "CARRETA";
  placa: string | null;
  /** O que passou no portão da semântica, vindo de `comporDeFatos`. */
  aprovados: Map<string, ValorAprovado>;
}

export interface InsumoDaDRE {
  escopo: EscopoDeAlocacao;
  competencia?: CompetenciaDaDRE;
  effectiveDate: string;
  periodLabel: string;
  lados: LadoDaApuracao[];
}

// ---------------------------------------------------------------------------
// Saída
// ---------------------------------------------------------------------------

/** De onde veio um número, até a célula da planilha (§5). */
export interface OrigemDoValor {
  attributeCode: string;
  titulo: string;
  entityType: string;
  entityId: string;
  placa: string | null;
  /** O valor como a fonte entregou, antes de qualquer conversão. */
  valorNaFonte: number;
  /** O valor já na competência da DRE. */
  valorNaDRE: number;
  unit: string | null;
  periodicity: string | null;
  aggregation: string | null;
  semanticsStatus: string;
  semanticsVersion: number | null;
  calculationBasis: string | null;
  costClass: string | null;
  taxonomyPath: string | null;
  transformacao: Transformacao;
  /** A célula da planilha. Nula quando o fato foi herdado de outra revisão. */
  celula: {
    sourceLabel: string;
    sheetName: string | null;
    rowIndex: number | null;
    columnLetter: string | null;
    columnHeader: string | null;
    rawValue: string | null;
  } | null;
  /** Por que ele não entra no total do próprio equipamento, quando não entra. */
  excluidoDaComposicaoPor: string | null;
}

export interface LinhaDaDRE {
  code: string;
  titulo: string;
  secao: SecaoId;
  sinal: 1 | -1;
  escopo: EscopoDeAlocacao;
  /** `null` é ausência, e nunca zero. */
  valor: number | null;
  natureza: NaturezaDoValor;
  /** `valor × sinal`, que é o que a cascata acumula. */
  contribuicao: number | null;
  /** Sobre a receita bruta. Nulo quando a receita é nula ou zero. */
  percentualDaReceita: number | null;
  origens: OrigemDoValor[];
  ausencia: {
    motivo: MotivoDeAusencia;
    rotulo: string;
    oQueFalta: string;
  } | null;
  essencial: boolean;
  evidencia: string;
}

export interface BloqueioDeSubtotal {
  code: string;
  titulo: string;
  motivo: MotivoDeAusencia;
  rotulo: string;
  oQueFalta: string;
}

export interface SubtotalDaDRE {
  id: SubtotalId;
  titulo: string;
  /** `null` quando inconclusivo — e aí `bloqueadoPor` diz por quê. */
  valor: number | null;
  /**
   * Se o número pode ser lido como o subtotal que o nome promete.
   *
   * Um EBITDA sem diesel, sem pneu e sem motorista é aritmeticamente
   * produzível e sai em 97% da receita. Exibi-lo seria o erro mais caro que
   * este módulo pode cometer, e por isso ele não sai: `conclusivo: false`,
   * `valor: null`, e a lista do que falta.
   */
  conclusivo: boolean;
  bloqueadoPor: BloqueioDeSubtotal[];
  percentualDaReceita: number | null;
  /**
   * O valor que **seria** obtido se as ausências valessem zero.
   *
   * Existe para a tela poder dizer "com o que se sabe hoje, seriam R$ X" sem
   * jamais chamar isso de EBITDA. Nunca é usado em nenhuma soma, nem em
   * consolidação, nem em ranking — só na frase que explica a lacuna.
   */
  valorParcial: number | null;
}

export interface SecaoDaDRE {
  id: SecaoId;
  titulo: string;
  nota: string;
  linhas: LinhaDaDRE[];
  /** A soma das contribuições da seção. Nulo quando nenhuma linha tem valor. */
  total: number | null;
  fecha: SubtotalId;
}

/** A qualidade da apuração (§22, §23). */
export interface CoberturaDaDRE {
  /** Quantos componentes do plano se aplicam a este escopo. */
  aplicaveis: number;
  /** Quantos deles produziram valor. */
  apurados: number;
  /** `apurados / aplicaveis`, em pontos percentuais. */
  percentual: number;
  /** A mesma razão restrita aos componentes marcados essenciais. */
  essenciaisAplicaveis: number;
  essenciaisApurados: number;
  percentualEssencial: number;
  /** Uma entrada por componente, para a lista ✅/⚠️ da tela. */
  itens: {
    code: string;
    titulo: string;
    secao: SecaoId;
    essencial: boolean;
    apurado: boolean;
    motivo: MotivoDeAusencia | null;
    rotulo: string | null;
  }[];
  /**
   * Por que a cobertura é contada por componente e não ponderada por valor.
   *
   * A pergunta óbvia — "92% do dinheiro está apurado?" — é irrespondível por
   * construção: ponderar por valor exigiria saber quanto valem as linhas que
   * faltam, e se soubéssemos elas não faltariam. Uma cobertura ponderada só
   * pelo que existe daria 100% sempre, porque o denominador seria o próprio
   * numerador. Contar componentes é a única medida que não mente.
   */
  metodo: string;
}

/** O veredito de §22, em três estados. */
export type EstadoDaDRE = "COMPLETA" | "PARCIALMENTE_APURADA" | "INCONCLUSIVA";

export interface ApuracaoDaDRE {
  escopo: EscopoDeAlocacao;
  competencia: CompetenciaDaDRE;
  effectiveDate: string;
  periodLabel: string;
  identidade: {
    entityId: string;
    entityType: string;
    placa: string | null;
  }[];
  secoes: SecaoDaDRE[];
  subtotais: SubtotalDaDRE[];
  cobertura: CoberturaDaDRE;
  estado: EstadoDaDRE;
  /**
   * Componentes que têm valor na fonte e ficaram de fora por semântica não
   * confirmada. Não somam; existem para o curador saber o que destravar.
   */
  aguardandoCuradoria: {
    code: string;
    titulo: string;
    oQueFalta: string;
  }[];
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

const TOLERANCIA = 0.01;

/**
 * A demonstração de uma unidade econômica numa vigência.
 *
 * Pura de propósito: os testes de cálculo, periodicidade, escopo e ausência a
 * exercitam com mapas montados à mão, sem banco e sem export.
 */
export function montarDRE(insumo: InsumoDaDRE): ApuracaoDaDRE {
  const competencia = insumo.competencia ?? "MENSAL";
  const componentes = componentesDoEscopo(insumo.escopo);

  const linhas: LinhaDaDRE[] = componentes.map((componente) =>
    montarLinha(componente, insumo, competencia),
  );

  /* A receita bruta é a base de todo percentual, e por isso é calculada antes. */
  const receitaBruta = somarSecoes(linhas, ["RECEITA_BRUTA"]);
  const base = receitaBruta !== null && Math.abs(receitaBruta) > TOLERANCIA ? receitaBruta : null;

  for (const linha of linhas) {
    linha.percentualDaReceita =
      base === null || linha.valor === null
        ? null
        : Number(((linha.valor / base) * 100).toFixed(2));
  }

  const porSecao = new Map<SecaoId, LinhaDaDRE[]>();
  for (const linha of linhas) {
    const lista = porSecao.get(linha.secao) ?? [];
    lista.push(linha);
    porSecao.set(linha.secao, lista);
  }

  const secoes: SecaoDaDRE[] = SECOES.filter((s) => (porSecao.get(s.id) ?? []).length > 0).map(
    (s) => ({
      id: s.id,
      titulo: s.titulo,
      nota: NOTA_DA_SECAO[s.id],
      linhas: porSecao.get(s.id)!,
      total: somarSecoes(linhas, [s.id]),
      fecha: s.fecha,
    }),
  );

  const subtotais = montarSubtotais(linhas, base);
  const cobertura = medirCobertura(componentes, linhas, insumo.escopo);

  return {
    escopo: insumo.escopo,
    competencia,
    effectiveDate: insumo.effectiveDate,
    periodLabel: insumo.periodLabel,
    identidade: insumo.lados.map((l) => ({
      entityId: l.entityId,
      entityType: l.entityType,
      placa: l.placa,
    })),
    secoes,
    subtotais,
    cobertura,
    estado: avaliarEstado(subtotais, cobertura),
    aguardandoCuradoria: linhas
      .filter((l) => l.ausencia?.motivo === "SEMANTICA_NAO_CONFIRMADA")
      .map((l) => ({ code: l.code, titulo: l.titulo, oQueFalta: l.ausencia!.oQueFalta })),
  };
}

function montarLinha(
  componente: ComponenteDaDRE,
  insumo: InsumoDaDRE,
  competencia: CompetenciaDaDRE,
): LinhaDaDRE {
  const vazia = (
    motivo: MotivoDeAusencia,
    oQueFalta: string,
  ): LinhaDaDRE => ({
    code: componente.code,
    titulo: componente.titulo,
    secao: componente.secao,
    sinal: componente.sinal,
    escopo: componente.escopo,
    valor: null,
    natureza: "NAO_DISPONIVEL",
    contribuicao: null,
    percentualDaReceita: null,
    origens: [],
    ausencia: { motivo, rotulo: ROTULO_DA_AUSENCIA[motivo], oQueFalta },
    essencial: componente.essencial,
    evidencia: componente.evidencia,
  });

  if (componente.fontes.length === 0) {
    return vazia(componente.ausencia!.motivo, componente.ausencia!.oQueFalta);
  }

  const origens: OrigemDoValor[] = [];
  const recusas: string[] = [];
  let houveConversao = false;

  for (const fonte of componente.fontes) {
    /*
      Só o lado que a fonte nomeia. É o que impede a amortização do implemento
      de entrar na DRE de um cavalo isolado — não há implemento naquela leitura,
      e inventar um seria atribuir ao cavalo dinheiro de outro ativo.
    */
    for (const lado of insumo.lados.filter((l) => l.entityType === fonte.entityType)) {
      const aprovado = lado.aprovados.get(fonte.attributeCode);
      if (!aprovado) continue;

      const normalizado = normalizarParaCompetencia(
        aprovado.valor,
        aprovado.classificacao.periodicity,
        competencia,
      );
      if (!normalizado.ok) {
        recusas.push(`${aprovado.titulo}: ${normalizado.explicacao}`);
        continue;
      }
      if (normalizado.transformacao.fator !== 1) houveConversao = true;

      origens.push({
        attributeCode: aprovado.code,
        titulo: aprovado.titulo,
        entityType: lado.entityType,
        entityId: lado.entityId,
        placa: lado.placa,
        valorNaFonte: aprovado.valor,
        valorNaDRE: normalizado.valor,
        unit: aprovado.classificacao.unit,
        periodicity: aprovado.classificacao.periodicity,
        aggregation: aprovado.classificacao.aggregation,
        semanticsStatus: aprovado.classificacao.semanticsStatus,
        semanticsVersion: aprovado.classificacao.semanticsVersion ?? null,
        calculationBasis: aprovado.classificacao.calculationBasis ?? null,
        costClass: aprovado.classificacao.costClass,
        taxonomyPath: aprovado.classificacao.taxonomyPath,
        transformacao: normalizado.transformacao,
        celula: celulaDe(aprovado),
        excluidoDaComposicaoPor: aprovado.excluidoPor,
      });
    }
  }

  if (origens.length === 0) {
    /*
      A fonte existe no plano e não produziu valor. Três motivos possíveis, e a
      ordem entre eles é a que explica melhor:

      1. A conversão de periodicidade foi recusada — o motivo vem dela.
      2. O plano declarou o que dizer neste caso (`ausencia`). É o que cobre a
         recusa no portão da semântica, que acontece antes deste motor e é
         invisível daqui: o atributo simplesmente não está entre os aprovados.
      3. Nada disso: o ativo não tem valor nesta vigência. É diferente de "o
         export não traz a coluna", e a tela precisa da diferença — um implemento
         sem aluguel não é uma frota sem dado de aluguel.
    */
    if (recusas.length > 0) return vazia("GRANDEZA_DE_AQUISICAO", recusas.join(" "));
    if (componente.ausencia) {
      return vazia(componente.ausencia.motivo, componente.ausencia.oQueFalta);
    }
    return vazia(
      "COLUNA_SEM_DADO",
      `Nenhum dos atributos declarados (${componente.fontes
        .map((f) => f.attributeCode)
        .join(", ")}) tem valor apurável neste ativo nesta vigência.`,
    );
  }

  const valor = Number(origens.reduce((soma, o) => soma + o.valorNaDRE, 0).toFixed(2));

  return {
    code: componente.code,
    titulo: componente.titulo,
    secao: componente.secao,
    sinal: componente.sinal,
    escopo: componente.escopo,
    valor,
    /*
      OBSERVADO é o valor que veio pronto; CALCULADO é o que passou por soma de
      mais de uma fonte ou por conversão de periodicidade. A distinção é do §4 e
      não é decorativa: um número CALCULADO tem uma premissa dentro, e a tela
      mostra qual.
    */
    natureza: origens.length > 1 || houveConversao ? "CALCULADO" : "OBSERVADO",
    contribuicao: Number((valor * componente.sinal).toFixed(2)),
    percentualDaReceita: null,
    origens,
    ausencia: null,
    essencial: componente.essencial,
    evidencia: componente.evidencia,
  };
}

function celulaDe(aprovado: ValorAprovado): OrigemDoValor["celula"] {
  const f = aprovado.fato;
  if (f.sheet_name === null && f.row_index === null && f.column_letter === null) {
    /* A listagem de frota lê sem proveniência; a ficha lê com. Nulo é honesto. */
    return f.source_label ? { sourceLabel: f.source_label, sheetName: null, rowIndex: null, columnLetter: null, columnHeader: null, rawValue: null } : null;
  }
  return {
    sourceLabel: f.source_label,
    sheetName: f.sheet_name,
    rowIndex: f.row_index,
    columnLetter: f.column_letter,
    columnHeader: f.column_header,
    rawValue: f.raw_value,
  };
}

/** A soma assinada das linhas de um conjunto de seções. `null` quando nenhuma tem valor. */
export function somarSecoes(linhas: LinhaDaDRE[], secoes: SecaoId[]): number | null {
  const alvo = new Set(secoes);
  let soma = 0;
  let alguma = false;
  for (const linha of linhas) {
    if (!alvo.has(linha.secao) || linha.contribuicao === null) continue;
    soma += linha.contribuicao;
    alguma = true;
  }
  return alguma ? Number(soma.toFixed(2)) : null;
}

export function montarSubtotais(linhas: LinhaDaDRE[], base: number | null): SubtotalDaDRE[] {
  const ids = Object.keys(SECOES_DO_SUBTOTAL) as SubtotalId[];
  return ids.map((id) => {
    const secoes = SECOES_DO_SUBTOTAL[id];
    const alvo = new Set(secoes);

    /*
      O bloqueio é acumulado: uma vez que o diesel falta, nada abaixo da margem
      de contribuição volta a ser conclusivo, por mais completas que sejam as
      seções seguintes. É a regra que impede um "resultado econômico" de parecer
      apurado quando o EBITDA acima dele não é.
    */
    const bloqueadoPor: BloqueioDeSubtotal[] = linhas
      .filter((l) => alvo.has(l.secao) && l.essencial && l.valor === null && l.ausencia)
      .map((l) => ({
        code: l.code,
        titulo: l.titulo,
        motivo: l.ausencia!.motivo,
        rotulo: l.ausencia!.rotulo,
        oQueFalta: l.ausencia!.oQueFalta,
      }));

    const parcial = somarSecoes(linhas, secoes);
    const conclusivo = bloqueadoPor.length === 0 && parcial !== null;

    return {
      id,
      titulo: ROTULO_DO_SUBTOTAL[id],
      valor: conclusivo ? parcial : null,
      conclusivo,
      bloqueadoPor,
      percentualDaReceita:
        conclusivo && base !== null && parcial !== null
          ? Number(((parcial / base) * 100).toFixed(2))
          : null,
      valorParcial: parcial,
    };
  });
}

export function medirCobertura(
  componentes: ComponenteDaDRE[],
  linhas: LinhaDaDRE[],
  escopo: EscopoDeAlocacao,
): CoberturaDaDRE {
  const porCodigo = new Map(linhas.map((l) => [l.code, l]));
  const itens = componentes
    .filter((c) => aplicaAoEscopo(c, escopo))
    .map((c) => {
      const linha = porCodigo.get(c.code);
      return {
        code: c.code,
        titulo: c.titulo,
        secao: c.secao,
        essencial: c.essencial,
        apurado: linha?.valor !== null && linha?.valor !== undefined,
        motivo: linha?.ausencia?.motivo ?? null,
        rotulo: linha?.ausencia?.rotulo ?? null,
      };
    });

  const apurados = itens.filter((i) => i.apurado).length;
  const essenciais = itens.filter((i) => i.essencial);
  const essenciaisApurados = essenciais.filter((i) => i.apurado).length;

  return {
    aplicaveis: itens.length,
    apurados,
    percentual: itens.length === 0 ? 0 : Number(((apurados / itens.length) * 100).toFixed(1)),
    essenciaisAplicaveis: essenciais.length,
    essenciaisApurados,
    percentualEssencial:
      essenciais.length === 0
        ? 0
        : Number(((essenciaisApurados / essenciais.length) * 100).toFixed(1)),
    itens,
    metodo:
      "Contagem de componentes do plano, não ponderação por valor. Ponderar por " +
      "valor exigiria conhecer o montante das linhas que faltam — se o " +
      "conhecêssemos, elas não faltariam — e ponderar só pelo que existe daria " +
      "100% sempre, porque o denominador seria o próprio numerador.",
  };
}

export function avaliarEstado(subtotais: SubtotalDaDRE[], cobertura: CoberturaDaDRE): EstadoDaDRE {
  const receita = subtotais.find((s) => s.id === "RECEITA_BRUTA");
  if (!receita?.conclusivo) return "INCONCLUSIVA";
  if (cobertura.apurados === cobertura.aplicaveis) return "COMPLETA";
  return "PARCIALMENTE_APURADA";
}

/** O subtotal de uma apuração, por id. Atalho para as telas e o Assistente. */
export function subtotal(apuracao: ApuracaoDaDRE, id: SubtotalId): SubtotalDaDRE {
  return apuracao.subtotais.find((s) => s.id === id)!;
}

/** A linha de uma apuração, por código. */
export function linha(apuracao: ApuracaoDaDRE, code: string): LinhaDaDRE | null {
  for (const secao of apuracao.secoes) {
    const encontrada = secao.linhas.find((l) => l.code === code);
    if (encontrada) return encontrada;
  }
  return null;
}

export type { AttributeClassification };
