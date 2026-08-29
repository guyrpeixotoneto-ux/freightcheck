/**
 * A MATRIZ DA FROTA — a frota inteira de um lado, o que se compra do outro.
 *
 * O balcão de `frota.ts` responde por placa, e responde bem à pergunta que
 * chega com um pedido de compra na mão: *quanto a Ambev remunera pneu neste
 * cavalo?*. Ele não responde à outra, que chega com a mesma frequência e não
 * tem placa nenhuma: **quanto a Ambev remunera pneu na frota?** Perguntá-la ao
 * balcão significa digitar sessenta e quatro placas e somar à mão — e somar à
 * mão é onde o número de auditoria vira o número de alguém.
 *
 * Este módulo vira o eixo: **linha é veículo, coluna é produto.**
 *
 * **Ele não calcula nada de novo, e a regra vale literalmente.** Cada célula
 * sai de `agruparPorProduto` + `destaqueDe` de `frota.ts` — as mesmas duas
 * funções que montam a ficha de uma placa — sobre a composição que
 * `comporDeFatos` devolve, que é a mesma que a Composição e a Frota 360° leem.
 * A célula de uma placa e a ficha dela são, por construção, o mesmo número.
 * O que este arquivo acrescenta é a travessia da frota e as somas de coluna;
 * o que ele deliberadamente não acrescenta é um segundo caminho até o valor.
 *
 * **Três regras herdadas do balcão, que a inversão do eixo poderia ter
 * perdido:**
 *
 * 1. **A ressalva vem antes do número.** Numa matriz ela não cabe célula a
 *    célula, então ela viaja na *coluna* — {@link ColunaDaMatriz.produto} traz
 *    a ressalva do catálogo, e a tela pinta o cabeçalho com ela. *Pneus* nasce
 *    com a coluna inteira ressalvada, em vez de sessenta e quatro `R$ 0,00`
 *    que fariam a frota parecer não remunerar pneu.
 * 2. **Periodicidades não se somam.** O total de uma coluna só existe quando
 *    todas as células com número caem na **mesma gaveta**; se convivem um valor
 *    mensal e um de aquisição, a coluna sai sem total e diz por quê. Ver
 *    {@link ColunaDaMatriz.semTotal}.
 * 3. **A soma nunca parece o todo.** As rubricas que não pertencem a produto
 *    nenhum saem contadas em {@link MatrizDaFrota.foraDoCatalogo}, como no
 *    balcão.
 *
 * **E uma regra que só existe aqui: a célula vazia diz de qual vazio se trata.**
 * "Sem coluna na fonte", "a coluna veio sem número" e "há duas colunas e elas
 * medem coisas diferentes" são três respostas distintas, e um traço só para as
 * três faria a matriz parecer esburacada onde ela está apenas sendo honesta.
 * Ver {@link MotivoDaCelulaVazia}.
 */

import type { Database } from "@workspace/db";
import { resolveContext, type SeriesContext } from "@workspace/comparison";
import {
  comporDeFatos,
  lerIdentidades,
  lerVigencia,
  listarVigencias,
  regraDe,
  unidadeDe,
  type Gaveta,
} from "@workspace/composition";
import {
  produtosDoBalcao,
  type EscopoDaConsulta,
  type ProdutoDeCompra,
} from "./catalogo";
import {
  agruparPorProduto,
  destaqueDe,
  type ForaDoCatalogo,
  type LinhaDoProduto,
} from "./frota";

/**
 * Os equipamentos que a matriz percorre por padrão.
 *
 * Cavalo e carreta, e não `TIPOS_COM_REGRA`: a matriz é a lista de **veículos**
 * que recebem compra, e a terceira entrada daquela lista é `TRECHO`, que é a
 * perna da rota — não tem placa, não recebe pneu e não passa por pedido de
 * compra. Incluí-lo encheria a tela de linhas sem identificador para uma
 * pergunta que ninguém faz sobre trecho.
 *
 * Quem quiser outro tipo pede em `entityTypes`: a lista é o padrão, não a
 * fronteira.
 */
export const TIPOS_DA_MATRIZ = ["CAVALO", "CARRETA"];

/**
 * Por que uma célula não tem número.
 *
 * Vocabulário fechado, como `MotivoDaRessalva` no catálogo e `MotivoDeExclusao`
 * na composição — e pela mesma razão: a tela precisa poder pintar cada vazio de
 * um jeito, e frases escritas à mão em cada célula não se agrupam nem se
 * contam.
 */
export type MotivoDaCelulaVazia =
  /** Nenhuma coluna da fonte alimenta este produto neste veículo. */
  | "SEM_COLUNA"
  /** As colunas existem e nenhuma trouxe número nesta vigência. */
  | "SEM_NUMERO"
  /** Há coluna com número, e nenhuma delas é dinheiro apurado deste ativo. */
  | "NAO_SOMAVEL"
  /** Mais de uma coluna responde, e elas medem coisas diferentes. */
  | "VARIAS_COLUNAS";

export const ROTULO_DA_CELULA_VAZIA: Record<MotivoDaCelulaVazia, string> = {
  SEM_COLUNA: "Sem coluna na fonte",
  SEM_NUMERO: "Coluna sem número",
  NAO_SOMAVEL: "Não somável",
  VARIAS_COLUNAS: "Várias colunas",
};

/** O cruzamento de um veículo com um produto. */
export interface CelulaDaMatriz {
  /** O remunerado, quando exatamente uma coluna responde. Nulo com `vazio`. */
  valor: number | null;
  unit: string | null;
  gaveta: Gaveta | null;
  /** Quantas colunas da fonte alimentam este produto neste veículo. */
  colunas: number;
  /** Por que não há número, quando não há. Nulo quando `valor` existe. */
  vazio: MotivoDaCelulaVazia | null;
}

export interface LinhaDaMatriz {
  entityId: string;
  /** Nula quando o ativo não tem identificador corrente — ver `frota/panorama`. */
  placa: string | null;
  chassi: string | null;
  entityType: string;
  rotuloDoTipo: string;
  /** As células na ordem de {@link MatrizDaFrota.colunas}, uma para cada. */
  celulas: CelulaDaMatriz[];
}

/** Por que uma coluna não tem total. */
export type MotivoSemTotal =
  /** Nenhum veículo tem número neste produto. */
  | "SEM_VALOR"
  /** As células caem em gavetas diferentes — somá-las misturaria mensal e anual. */
  | "GAVETAS_DIFERENTES";

export interface ColunaDaMatriz {
  /** O produto do catálogo, com a ressalva que a tela mostra no cabeçalho. */
  produto: ProdutoDeCompra;
  /** A gaveta das células com número, quando todas caem na mesma. */
  gaveta: Gaveta | null;
  /** Quantos veículos têm número neste produto. */
  veiculosComValor: number;
  /** A soma da coluna — só quando ela é legítima. Ver {@link semTotal}. */
  total: number | null;
  semTotal: MotivoSemTotal | null;
}

export interface ResumoDaMatriz {
  veiculos: number;
  /** Quantos têm número em ao menos um produto. */
  comAlgumValor: number;
  /** Quantos veículos de cada tipo entraram. */
  porTipo: { entityType: string; rotulo: string; veiculos: number }[];
}

export interface MatrizDaFrota {
  effectiveDate: string;
  periodLabel: string;
  contextLabel: string;
  unidade: string | null;
  operacao: string | null;
  /** Todas as vigências deste contexto, para o seletor. */
  vigencias: { effectiveDate: string; periodLabel: string }[];
  colunas: ColunaDaMatriz[];
  linhas: LinhaDaMatriz[];
  resumo: ResumoDaMatriz;
  /**
   * As rubricas da frota que não pertencem a produto nenhum, contadas.
   *
   * Mesma razão do balcão: sem esta lista, a matriz pareceria o todo do que a
   * fonte traz sobre um veículo, quando é o recorte do que se compra.
   */
  foraDoCatalogo: ForaDoCatalogo[];
}

/**
 * A célula de um produto, a partir das colunas que o alimentam neste ativo.
 *
 * O número só sai quando `destaqueDe` aponta exatamente uma coluna monetária
 * apurada — a mesmíssima regra da ficha, e pela mesma razão que ela documenta:
 * duas colunas de um produto quase nunca são parcelas de um mesmo número (a
 * manutenção tem a taxa do contrato *ou* a do BID; a aquisição tem a nota *e* o
 * tributo sobre ela), e somá-las produziria um valor que a Ambev não paga em
 * hipótese nenhuma.
 */
function celulaDe(linhas: LinhaDoProduto[]): CelulaDaMatriz {
  if (linhas.length === 0) {
    return { valor: null, unit: null, gaveta: null, colunas: 0, vazio: "SEM_COLUNA" };
  }

  const destaque = destaqueDe(linhas);
  if (destaque !== null) {
    return {
      valor: destaque.valor,
      unit: destaque.unit,
      gaveta: destaque.gaveta,
      colunas: linhas.length,
      vazio: null,
    };
  }

  const monetarias = linhas.filter((l) => l.apurado && l.unit === "BRL");
  const vazio: MotivoDaCelulaVazia =
    monetarias.length > 1
      ? "VARIAS_COLUNAS"
      : linhas.every((l) => l.valor === null)
        ? "SEM_NUMERO"
        : "NAO_SOMAVEL";

  return { valor: null, unit: null, gaveta: null, colunas: linhas.length, vazio };
}

/**
 * A soma de uma coluna — quando ela é legítima.
 *
 * Duas recusas, e as duas são de conteúdo e não de forma. A primeira é a que o
 * produto inteiro repete: **gavetas não se somam.** Uma coluna em que um
 * veículo traz o mensal do aluguel e outro o valor de aquisição não tem soma
 * nenhuma que signifique algo — e um número ali, com o rótulo "total", seria
 * lido como orçamento. A segunda é o zero que não é resposta: coluna sem
 * nenhum veículo com valor sai sem total, e não com `R$ 0,00`.
 */
function totalizar(celulas: CelulaDaMatriz[]): {
  gaveta: Gaveta | null;
  veiculosComValor: number;
  total: number | null;
  semTotal: MotivoSemTotal | null;
} {
  const comValor = celulas.filter((c) => c.valor !== null);
  if (comValor.length === 0) {
    return { gaveta: null, veiculosComValor: 0, total: null, semTotal: "SEM_VALOR" };
  }

  const gavetas = new Set(comValor.map((c) => c.gaveta));
  if (gavetas.size > 1) {
    return {
      gaveta: null,
      veiculosComValor: comValor.length,
      total: null,
      semTotal: "GAVETAS_DIFERENTES",
    };
  }

  const soma = comValor.reduce((s, c) => s + (c.valor ?? 0), 0);
  return {
    gaveta: comValor[0]!.gaveta,
    veiculosComValor: comValor.length,
    total: Number(soma.toFixed(2)),
    semTotal: null,
  };
}

/**
 * A matriz da frota numa vigência.
 *
 * Devolve `null` quando o contexto não tem vigência nenhuma — a rota traduz em
 * 404, como as irmãs dela.
 *
 * O custo é o mesmo da Frota 360°: **duas consultas por tipo de equipamento**
 * (as classificações e os fatos da vigência, dentro de `lerVigencia`), mais uma
 * das identidades, independentemente do tamanho da frota. Uma travessia por
 * placa — sessenta e quatro chamadas a `montarComposicao` — daria o mesmo
 * número por cento e vinte e oito idas ao banco.
 */
export async function matrizDaFrota(
  db: Database,
  opcoes: {
    period?: string;
    context?: EscopoDaConsulta;
    entityTypes?: string[];
  } = {},
): Promise<MatrizDaFrota | null> {
  const context = await resolveContext(db, opcoes.context);
  if (!context) return null;

  const vigencias = await listarVigencias(db, context);
  if (vigencias.length === 0) return null;

  const alvo =
    opcoes.period !== undefined
      ? vigencias.find((v) => v.effectiveDate === opcoes.period)
      : vigencias[vigencias.length - 1];
  if (!alvo) return null;

  const tipos =
    opcoes.entityTypes && opcoes.entityTypes.length > 0
      ? opcoes.entityTypes
      : TIPOS_DA_MATRIZ;

  const produtos = produtosDoBalcao("FROTA");
  const identidades = await lerIdentidades(db, tipos);

  const linhas: LinhaDaMatriz[] = [];
  const foraDoCatalogo = new Map<string, ForaDoCatalogo>();
  const porTipo: ResumoDaMatriz["porTipo"] = [];

  for (const entityType of tipos) {
    const material = await lerVigencia(
      db,
      entityType,
      alvo.effectiveDate,
      context as SeriesContext,
    );
    const regra = regraDe(entityType);
    let veiculos = 0;

    for (const [entityId, fatos] of material.fatosPorAtivo) {
      const composicao = comporDeFatos(entityType, fatos, material.classificacoes);
      const agrupado = agruparPorProduto(composicao.linhas, composicao.naoApurados);

      for (const rubrica of agrupado.foraDoCatalogo.values()) {
        const atual = foraDoCatalogo.get(rubrica.rubrica);
        if (atual) atual.colunas += rubrica.colunas;
        else foraDoCatalogo.set(rubrica.rubrica, { ...rubrica });
      }

      const identidade = identidades.get(entityId);
      linhas.push({
        entityId,
        placa: identidade?.placa ?? null,
        chassi: identidade?.chassi ?? null,
        entityType,
        rotuloDoTipo: regra.rotulo,
        celulas: produtos.map((produto) =>
          celulaDe(agrupado.porProduto.get(produto.chave) ?? []),
        ),
      });
      veiculos += 1;
    }

    porTipo.push({ entityType, rotulo: regra.rotulo, veiculos });
  }

  /*
    A ordem é a da placa, e não a do banco: quem procura um veículo na matriz
    procura por placa, e uma lista em ordem de `entity_id` obriga a varrer.
    O tipo vem antes porque a matriz mistura cavalos e carretas, e as duas
    frotas lidas juntas em ordem alfabética embaralhariam duas populações que
    a pessoa lê separadas.
  */
  linhas.sort(
    (a, b) =>
      tipos.indexOf(a.entityType) - tipos.indexOf(b.entityType) ||
      (a.placa ?? "").localeCompare(b.placa ?? "", "pt-BR", { numeric: true }),
  );

  const colunas: ColunaDaMatriz[] = produtos.map((produto, i) => ({
    produto,
    ...totalizar(linhas.map((l) => l.celulas[i]!)),
  }));

  return {
    effectiveDate: alvo.effectiveDate,
    periodLabel: alvo.periodLabel,
    contextLabel: context.label,
    unidade: unidadeDe(context),
    operacao: context.channel,
    vigencias: vigencias.map((v) => ({
      effectiveDate: v.effectiveDate,
      periodLabel: v.periodLabel,
    })),
    colunas,
    linhas,
    resumo: {
      veiculos: linhas.length,
      comAlgumValor: linhas.filter((l) => l.celulas.some((c) => c.valor !== null)).length,
      porTipo,
    },
    foraDoCatalogo: [...foraDoCatalogo.values()].sort((a, b) => b.colunas - a.colunas),
  };
}
