/**
 * A autoridade única sobre o que **não** entra na soma de impacto.
 *
 * Este módulo existe por um defeito medido, e a medição fica escrita porque ela
 * é o argumento. Em agosto/2026 o produto respondia a pergunta "qual foi o
 * impacto líquido das alterações?" com quatro números diferentes, conforme a
 * tela por onde se entrava:
 *
 * | caminho                          | agosto/2026     | regra aplicada             |
 * |----------------------------------|-----------------|----------------------------|
 * | `engine.ts` → cartão de Planilha  | R$ 39.936,28/mês | nenhuma                    |
 * | `grouped.ts` → cartão da Visão geral | R$ 28.511,24/mês | só `isCoveredByParts`   |
 * | `panorama.ts` → ranking econômico | R$ 11.916,70/mês | parcela **e** conjunto, por código |
 * | `composition/motor.ts` → ficha    | (por ativo)      | parcela e conjunto         |
 *
 * Não eram quatro opiniões: eram quatro cópias da mesma intenção, escritas em
 * momentos diferentes, que divergiram sem que ninguém decidisse divergir. O
 * `engine.ts` acumulava o impacto **dentro** do laço que descobre as alterações,
 * antes de existir o índice "que atributos mudaram em cada ativo" — então não
 * tinha como aplicar uma regra que é por ativo, e não aplicava nenhuma.
 *
 * Aqui a regra é uma só, e quem quiser um total passa por ela.
 *
 * ---------------------------------------------------------------------------
 * As três leituras, e por que as três existem
 * ---------------------------------------------------------------------------
 *
 * Um número só não resolveria: o bruto tem uso, e escondê-lo faria a auditoria
 * perder a conferência de que nada sumiu. O que não pode existir é um bruto
 * **sem nome**, publicado como se fosse o total.
 *
 * - **bruto** — a soma de tudo que tem preço, sem regra nenhuma. É a conferência
 *   técnica: `bruto = oficial + foraDoTotal`, sempre, em toda periodicidade.
 *   Nunca é "Impacto apurado" numa tela.
 * - **oficial** — o dinheiro, uma vez só. É o que toda tela, cartão,
 *   consolidado e exportação publica.
 * - **porComposicao** — estágio intermediário, com a regra de parcelas aplicada
 *   e a de conjunto ainda não. Existe para a auditoria conseguir localizar em
 *   qual das duas regras um número mudou, em vez de olhar para um salto de
 *   R$ 23 mil e ter de adivinhar.
 *
 * ---------------------------------------------------------------------------
 * As duas regras
 * ---------------------------------------------------------------------------
 *
 * **1. Coberto pelas parcelas** (`COMPOSITIONS`). Um total cujas parcelas
 * mudaram **no mesmo ativo** já está contado nelas. A decisão é por ativo, e é
 * isto que preserva a cobertura parcial: em agosto `cavalo.finame_cavalo` mudou
 * em cinco cavalos e só em QYP3G72 alguma parcela mudou junto — excluir o
 * atributo inteiro apagaria R$ 17.086,20 que parcela nenhuma explica, e não
 * excluir nada contaria R$ 5.169,50 duas vezes.
 *
 * **2. Escopo de conjunto** (`ESCOPOS_DE_CONJUNTO`). Uma coluna da carreta que
 * embute o cavalo vinculado já contém o dinheiro dele. A decisão também é por
 * ativo — e por vínculo: só sai a linha da carreta cujo cavalo mudou a coluna
 * embutida **nesta mesma comparação**. Uma carreta cujo cavalo não mexeu teve
 * variação própria (o implemento), e ela conta.
 *
 * ---------------------------------------------------------------------------
 * As duas regras se sobrepõem, e o que a ordem decide
 * ---------------------------------------------------------------------------
 *
 * Esta seção já afirmou que "nenhum código está nos dois conjuntos". **É
 * falso**, e a frase estava aqui como suposição, sem medição — exatamente o
 * defeito que este módulo existe para corrigir do outro lado.
 *
 * `carreta.custo_fixo` está nos dois registros: é total em `COMPOSITIONS`
 * (`finame + lucroFixomodeloNovoCiclo`) e é coluna de conjunto em
 * `ESCOPOS_DE_CONJUNTO` (embute o `finame_cavalo` do cavalo vinculado). Uma
 * linha dele pode satisfazer as duas regras ao mesmo tempo, e em agosto/2026
 * **cinco das dezenove linhas com preço satisfazem** — todas as cinco são
 * `carreta.custo_fixo`.
 *
 * O que a ordem altera, e o que ela não altera, medido em 18/08/2026 sobre a
 * vigência de agosto (19 linhas com preço, bruto R$ 39.936,28/mês):
 *
 * | ordem                  | degrau 1     | subtotal     | degrau 2     | oficial      |
 * |------------------------|--------------|--------------|--------------|--------------|
 * | composição → conjunto  | 11.425,04    | 28.511,24    | 11.916,69    | **16.594,55** |
 * | conjunto → composição  | 28.511,23    | 11.425,05    | −5.169,50    | **16.594,55** |
 *
 * **O total é invariante**: as cinco linhas ambíguas saem em qualquer ordem, e
 * nenhuma linha é descontada duas vezes — as exclusões continuam sendo uma
 * partição (6 + 5 + 8 = 19). O que depende da ordem é a **atribuição entre os
 * degraus**, e portanto o subtotal do rastro.
 *
 * `COBERTO_POR_PARCELAS` é testada primeiro por ser a mais específica: ela
 * nomeia quais parcelas cobrem aquele total naquele ativo, enquanto a de
 * conjunto nomeia só o equipamento vinculado. Quem lê o rastro recebe a
 * explicação mais estreita das duas — mas ela é uma escolha de redação, não uma
 * propriedade do dado, e o subtotal intermediário precisa ser lido com isso em
 * mente. É mais uma razão para ele viver dentro de `rastro` e não como campo.
 */

import {
  COMPOSITIONS,
  ESCOPOS_DE_CONJUNTO,
  compositionOf,
  escopoDeConjunto,
  isCoveredByParts,
  type Composition,
  type EscopoDeConjunto,
} from "./composition";

// ---------------------------------------------------------------------------
// O que entra
// ---------------------------------------------------------------------------

/**
 * O mínimo que uma linha de alteração precisa expor para ser deduplicada.
 *
 * Deliberadamente estrutural, e não o tipo de uma tabela: `engine.ts` decide
 * sobre linhas que ainda não foram gravadas, `grouped.ts` sobre linhas lidas do
 * banco, e a regra tem de ser a mesma para as duas. `impactAmount` aceita
 * string porque é assim que o `pg` devolve `numeric` — converter na borda
 * seria uma segunda oportunidade de divergir.
 */
export interface LinhaDeMudanca {
  attributeCode: string | null;
  entityId: string | null;
  /**
   * A comparação a que esta linha pertence.
   *
   * As duas regras são **internas a uma comparação**: um total e as parcelas
   * dele, um cavalo e a carreta dele, sempre dentro do mesmo par de vigências.
   * Sem esta chave, uma leitura de intervalo indexaria dezesseis comparações
   * como se fossem uma, e um total que se moveu sozinho em junho sairia da soma
   * porque uma parcela dele se moveu em julho — perdendo dinheiro que nenhuma
   * outra linha explica.
   *
   * `undefined` quer dizer "tudo isto é uma comparação só", que é o caso de
   * quem lê uma vigência.
   */
  comparacaoId?: string | null;
  impactConfidence?: string | null;
  impactAmount?: string | number | null;
  impactPeriodicity?: string | null;
}

/**
 * A mesma linha, como o banco a devolve.
 *
 * Adaptador de **forma**, e não de regra: existe para que as quatro leituras
 * que partem de `change` não escrevam cada uma o seu `snake_case → camelCase`,
 * e para que nenhuma delas precise tocar nos campos que a decisão usa.
 */
export function daLinhaDoBanco(row: {
  attribute_code: string | null;
  entity_id: string | null;
  change_set_id?: string | null;
  impact_confidence?: string | null;
  impact_amount?: string | number | null;
  impact_periodicity?: string | null;
}): LinhaDeMudanca {
  return {
    attributeCode: row.attribute_code,
    entityId: row.entity_id,
    comparacaoId: row.change_set_id ?? null,
    impactConfidence: row.impact_confidence ?? null,
    impactAmount: row.impact_amount ?? null,
    impactPeriodicity: row.impact_periodicity ?? null,
  };
}

/** O balde de quem tem preço mas não tem periodicidade declarada. */
export const SEM_PERIODICIDADE = "SEM_PERIODICIDADE";

// ---------------------------------------------------------------------------
// Os vínculos do conjunto
// ---------------------------------------------------------------------------

/**
 * Quem embute quem, por ativo — o insumo da regra de escopo de conjunto.
 *
 * A chave é o ativo que **recebe** o número embutido (a carreta), e o valor são
 * os ativos cujo dinheiro ele carrega (os cavalos que a apontam em
 * `cavalo.placa_carreta`). Um índice, e não uma consulta, porque quem decide é
 * síncrono e é chamado uma vez por linha.
 */
export interface VinculosDeConjunto {
  embutidos: Map<string, string[]>;
}

/**
 * A ausência de vínculo, dita em voz alta.
 *
 * Um `Map` vazio implícito seria a porta pela qual a divergência voltaria: um
 * chamador que esquecesse de carregar os vínculos veria a regra de conjunto
 * silenciosamente não disparar e publicaria um total inflado, que é exatamente
 * o defeito que este módulo fecha. Quem passa isto está afirmando que a leitura
 * não tem lado de conjunto — não que se esqueceu dele.
 */
export const SEM_VINCULOS: VinculosDeConjunto = { embutidos: new Map() };

/** Constrói o índice a partir dos pares (quem recebe, quem está embutido). */
export function indexarVinculos(
  pares: { entityId: string; embuteEntityId: string }[],
): VinculosDeConjunto {
  const embutidos = new Map<string, string[]>();
  for (const par of pares) {
    const atuais = embutidos.get(par.entityId);
    if (atuais) atuais.push(par.embuteEntityId);
    else embutidos.set(par.entityId, [par.embuteEntityId]);
  }
  return { embutidos };
}

// ---------------------------------------------------------------------------
// A decisão
// ---------------------------------------------------------------------------

export type MotivoForaDoTotal = "COBERTO_POR_PARCELAS" | "ESCOPO_DE_CONJUNTO";

/**
 * Por que uma linha não entra na soma — com o texto que vai para a tela.
 *
 * A frase viaja junto com a decisão, e não é montada no componente, porque uma
 * exclusão sem motivo escrito é indistinguível de um sumiço. A linha continua
 * na lista; o que muda é que ela diz onde o dinheiro dela está sendo contado.
 */
export interface ForaDoTotal {
  motivo: MotivoForaDoTotal;
  /** O código cujo valor já representa este dinheiro. */
  representadoPor: string;
  explicacao: string;
  composicao?: Composition;
  escopo?: EscopoDeConjunto;
}

/** O rótulo curto, para o selo da lista. */
export const ROTULO_FORA_DO_TOTAL: Record<MotivoForaDoTotal, string> = {
  COBERTO_POR_PARCELAS: "Fora do total — impacto já representado pelas parcelas",
  ESCOPO_DE_CONJUNTO: "Fora do total — impacto já representado no conjunto",
};

/**
 * A única coisa do produto que decide se uma linha entra na soma.
 *
 * `null` quer dizer "conta". Qualquer outra resposta traz o motivo e a
 * explicação, e o chamador é obrigado a fazer alguma coisa com ela — nem que
 * seja publicá-la ao lado do número.
 */
export interface Deduplicador {
  foraDoTotal(linha: LinhaDeMudanca): ForaDoTotal | null;
}

/*
  Não há um `foraPorComposicao` público, e a ausência é deliberada.

  Ele existiu por algumas horas, e era a porta pela qual o subtotal técnico
  voltaria a virar um número de primeira classe: bastava alguém somar as linhas
  que só a regra de parcelas deixa passar para reconstruir os R$ 28.511,24 e
  publicá-los como impacto. O subtotal existe — em `rastro.degraus`, ao lado do
  que o produziu e do rótulo que diz que ele não é um impacto. Quem quiser
  auditar a escada lê o rastro; quem quiser dinheiro lê `byPeriodicity`. Não há
  terceira porta.
*/

const PARTES_POR_TOTAL = new Map(COMPOSITIONS.map((c) => [c.total, c.parts]));
const ESCOPO_POR_CODIGO = new Map(ESCOPOS_DE_CONJUNTO.map((e) => [e.code, e]));

/** Os códigos que alguma regra pode tirar da soma — para filtros e telas. */
export const CODIGOS_COM_REGRA: ReadonlySet<string> = new Set([
  ...PARTES_POR_TOTAL.keys(),
  ...ESCOPO_POR_CODIGO.keys(),
]);

/**
 * Monta o deduplicador sobre um conjunto de linhas.
 *
 * Recebe as linhas todas de uma vez, e não uma a uma, porque as duas regras
 * dependem do conjunto: "as parcelas mudaram neste ativo?" e "o cavalo
 * vinculado mudou a coluna embutida?" só têm resposta depois que se sabe tudo o
 * que mudou. Foi exatamente esta dependência que o `engine.ts` não tinha como
 * satisfazer no laço, e é por isso que ele passou a decidir num segundo passo.
 *
 * As linhas podem vir de várias comparações — uma leitura de intervalo carrega
 * nove vigências —, e é `comparacaoId` que as mantém separadas: as regras nunca
 * atravessam de uma comparação para outra.
 */
export function criarDeduplicador(
  linhas: LinhaDeMudanca[],
  vinculos: VinculosDeConjunto,
): Deduplicador {
  /*
    Indexado por (comparação, ativo), e não só por ativo. Ver `comparacaoId`:
    uma leitura de intervalo carrega dezesseis comparações, e tratá-las como uma
    faria a regra atravessar vigências que nada têm a ver entre si.
  */
  const chaveDoAtivo = (linha: LinhaDeMudanca) =>
    `${linha.comparacaoId ?? ""}\u001f${linha.entityId}`;

  const mudouNoAtivo = new Map<string, Set<string>>();
  for (const linha of linhas) {
    if (linha.entityId === null || linha.attributeCode === null) continue;
    const chave = chaveDoAtivo(linha);
    let codigos = mudouNoAtivo.get(chave);
    if (!codigos) mudouNoAtivo.set(chave, (codigos = new Set()));
    codigos.add(linha.attributeCode);
  }

  const porComposicao = (linha: LinhaDeMudanca): ForaDoTotal | null => {
    if (linha.entityId === null) return null;
    if (!isCoveredByParts(linha.attributeCode, chaveDoAtivo(linha), mudouNoAtivo)) {
      return null;
    }
    const composicao = compositionOf(linha.attributeCode);
    const partes = PARTES_POR_TOTAL.get(linha.attributeCode!) ?? [];
    const mudaram = mudouNoAtivo.get(chaveDoAtivo(linha)) ?? new Set<string>();
    const cobertas = partes.filter((p) => mudaram.has(p));
    return {
      motivo: "COBERTO_POR_PARCELAS",
      representadoPor: cobertas.join(", "),
      explicacao:
        `Este atributo é o total de ${partes.length} ` +
        `${partes.length === 1 ? "parcela" : "parcelas"}, e neste veículo ` +
        `${cobertas.length === 1 ? "a parcela" : "as parcelas"} ${cobertas.join(", ")} ` +
        `também mudou. A variação já está contada nela — somar o total de novo ` +
        `contaria o mesmo dinheiro duas vezes. A alteração continua na lista e ` +
        `continua rastreável.`,
      ...(composicao ? { composicao } : {}),
    };
  };

  const porConjunto = (linha: LinhaDeMudanca): ForaDoTotal | null => {
    const escopo = escopoDeConjunto(linha.attributeCode);
    if (!escopo || linha.entityId === null) return null;
    const embutidos = vinculos.embutidos.get(linha.entityId);
    if (!embutidos) return null;
    // Só sai quando o ativo embutido mexeu **nesta** comparação: sem isso a
    // regra viraria "esta coluna nunca conta", e apagaria a variação própria do
    // implemento nas carretas cujo cavalo não mudou.
    const mexeu = embutidos.some((id) =>
      mudouNoAtivo
        .get(`${linha.comparacaoId ?? ""}\u001f${id}`)
        ?.has(escopo.contem),
    );
    if (!mexeu) return null;
    return {
      motivo: "ESCOPO_DE_CONJUNTO",
      representadoPor: escopo.contem,
      explicacao:
        `Esta coluna remunera o conjunto: ela já embute o \`${escopo.contem}\` do ` +
        `equipamento vinculado, que mudou nesta mesma comparação e está contado ` +
        `na linha dele. Somar as duas contaria o mesmo dinheiro duas vezes. ` +
        `A alteração continua na lista e continua rastreável.`,
      escopo,
    };
  };

  return { foraDoTotal: (linha) => porComposicao(linha) ?? porConjunto(linha) };
}

/**
 * A mesma regra, na granularidade de **código** — para quem não tem o ativo.
 *
 * `panorama.ts` lê `fact` e não `change`: ele sabe que uma coluna mudou na
 * série, mas não monta a linha "este ativo, este atributo, este delta". Sem
 * ativo não há decisão por ativo, e forçar uma daria a ilusão de precisão que
 * o dado não sustenta.
 *
 * O que **não** pode divergir é a direção, e era exatamente ela que divergia:
 * o panorama derrubava a **parcela** quando o total também mudava, e a leitura
 * por ativo derrubava o **total** quando a parcela mudava. Duas respostas
 * opostas para a mesma pergunta, cada uma internamente coerente, e nenhuma das
 * duas errada por si — mas juntas faziam o produto ranquear
 * `carreta.custo_fixo` como a maior linha econômica de agosto/2026 enquanto a
 * soma oficial já a tinha tirado por dupla contagem.
 *
 * A direção é uma só, e é esta: **o total desce, a parcela fica.** Uma parcela
 * é medição direta; um total é a soma dela com outras, e quando as parcelas
 * estão à vista o total é redundante. Ver `COMPOSITIONS`.
 *
 * O preço de decidir por código está escrito: onde a decisão por ativo preserva
 * cobertura parcial — `cavalo.finame_cavalo` sai em QYP3G72 e fica nos outros
 * quatro —, esta decide pelo código inteiro. É por isso que ela responde por
 * ordenação e visibilidade, e nunca por dinheiro.
 */
export function ehLinhaEconomica(
  code: string,
  codigosAlterados: ReadonlySet<string>,
): boolean {
  const escopo = escopoDeConjunto(code);
  if (escopo && codigosAlterados.has(escopo.contem)) return false;
  const partes = PARTES_POR_TOTAL.get(code);
  if (partes && partes.some((parte) => codigosAlterados.has(parte))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// O resumo — dois números, e um rastro que explica a distância entre eles
// ---------------------------------------------------------------------------

/**
 * As etapas da escada, na ordem em que o dinheiro sai.
 *
 * A ordem não é estética: `COMPOSICAO` primeiro porque decide sobre totais
 * **dentro** de um equipamento, e `ESCOPO` depois porque decide **entre** dois
 * equipamentos. Invertê-las daria o mesmo total final — nenhum código está nos
 * dois conjuntos — mas contaria a história ao contrário de como um auditor a
 * reconstrói.
 */
export const ETAPAS = ["COMPOSICAO", "ESCOPO_DE_CONJUNTO"] as const;
export type EtapaDaDeducao = (typeof ETAPAS)[number];

export const ROTULO_DA_ETAPA: Record<EtapaDaDeducao, string> = {
  COMPOSICAO: "duplicidades por composição",
  ESCOPO_DE_CONJUNTO: "duplicidades entre escopos cavalo↔carreta",
};

/** Um degrau: o que ele removeu, e onde o número ficou depois dele. */
export interface DegrauDaDeducao {
  etapa: EtapaDaDeducao;
  rotulo: string;
  /** O que **este** degrau tirou da soma, por periodicidade. */
  removidoByPeriodicity: Record<string, number>;
  mudancasRemovidas: number;
  /**
   * O subtotal **depois** deste degrau, por periodicidade.
   *
   * É número de auditoria, e o tipo não o esconde — mas o domínio não o
   * publica: nenhuma tela, consolidado ou exportação lê um subtotal como
   * "impacto". Em agosto/2026 o subtotal após `COMPOSICAO` é R$ 28.511,24/mês,
   * que por oito meses foi publicado como o impacto líquido da vigência e não
   * é: ele ainda conta o `finame` do cavalo duas vezes.
   */
  subtotalByPeriodicity: Record<string, number>;
}

/**
 * A escada inteira, do bruto ao oficial.
 *
 * Existe para que a pergunta "por que este número mudou?" tenha resposta sem
 * ninguém reabrir o código: cada degrau diz quanto tirou, por qual regra, e
 * onde o número ficou. `explicarRastro` a escreve em texto.
 */
export interface RastroDaDeducao {
  brutoByPeriodicity: Record<string, number>;
  degraus: DegrauDaDeducao[];
  oficialByPeriodicity: Record<string, number>;
}

/**
 * O impacto de um conjunto de linhas.
 *
 * **Dois números, e só dois.** `byPeriodicity` é a verdade financeira — o que
 * toda tela, cartão, consolidado e exportação publica. `brutoByPeriodicity` é
 * conferência técnica, nunca rotulado "Impacto apurado". Tudo entre os dois
 * mora em `rastro`, que é explicação e não valor.
 *
 * Sempre por periodicidade: um valor mensal e um anual não se somam, e um
 * escalar afirmaria que sim.
 */
export interface ResumoDeImpacto {
  /** A verdade financeira. É este o "Impacto apurado". */
  byPeriodicity: Record<string, number>;
  /** Sem regra nenhuma. Auditoria técnica; `bruto = oficial + tudo que o rastro removeu`. */
  brutoByPeriodicity: Record<string, number>;
  /** A escada que explica a distância entre os dois. Não é valor consumível. */
  rastro: RastroDaDeducao;
  excludedChanges: number;
  calculatedChanges: number;
  notCalculable: number;
}

const somar = (baldes: Record<string, number>, balde: string, valor: number) => {
  baldes[balde] = (baldes[balde] ?? 0) + valor;
};

const arredondar = (baldes: Record<string, number>): Record<string, number> =>
  Object.fromEntries(Object.entries(baldes).map(([k, v]) => [k, Number(v.toFixed(2))]));

/** Impacto declarado e numérico, ou `null` quando a linha não tem preço. */
function precoDe(linha: LinhaDeMudanca): number | null {
  if (linha.impactConfidence !== "CALCULATED") return null;
  if (linha.impactAmount === null || linha.impactAmount === undefined) return null;
  const valor = Number(linha.impactAmount);
  return Number.isFinite(valor) ? valor : null;
}

/** A etapa a que um motivo pertence — a ponte entre a decisão e a escada. */
const ETAPA_DO_MOTIVO: Record<MotivoForaDoTotal, EtapaDaDeducao> = {
  COBERTO_POR_PARCELAS: "COMPOSICAO",
  ESCOPO_DE_CONJUNTO: "ESCOPO_DE_CONJUNTO",
};

/**
 * Soma as linhas e monta a escada, numa passada só.
 *
 * `bruto − Σ(removido de cada degrau) = oficial` é invariante e está sob teste.
 * Se deixar de valer, alguma linha está sendo contada duas vezes ou nenhuma — e
 * as duas possibilidades são defeito, não arredondamento.
 */
export function resumirImpacto(
  linhas: LinhaDeMudanca[],
  dedup: Deduplicador,
): ResumoDeImpacto {
  const bruto: Record<string, number> = {};
  const oficial: Record<string, number> = {};
  const removido: Record<EtapaDaDeducao, Record<string, number>> = {
    COMPOSICAO: {},
    ESCOPO_DE_CONJUNTO: {},
  };
  const removidas: Record<EtapaDaDeducao, number> = {
    COMPOSICAO: 0,
    ESCOPO_DE_CONJUNTO: 0,
  };
  let calculatedChanges = 0;
  let notCalculable = 0;

  for (const linha of linhas) {
    const valor = precoDe(linha);
    if (valor === null) {
      notCalculable++;
      continue;
    }
    calculatedChanges++;
    const balde = linha.impactPeriodicity ?? SEM_PERIODICIDADE;
    somar(bruto, balde, valor);

    const fora = dedup.foraDoTotal(linha);
    if (fora === null) {
      somar(oficial, balde, valor);
      continue;
    }
    const etapa = ETAPA_DO_MOTIVO[fora.motivo];
    somar(removido[etapa], balde, valor);
    removidas[etapa]++;
  }

  // Os subtotais saem por subtração sucessiva sobre o bruto, e não de uma
  // segunda varredura com meia regra ligada: duas varreduras seriam duas
  // implementações da mesma escada, e a segunda divergiria.
  const corrente = { ...bruto };
  const degraus: DegrauDaDeducao[] = ETAPAS.map((etapa) => {
    for (const [balde, valor] of Object.entries(removido[etapa])) {
      corrente[balde] = (corrente[balde] ?? 0) - valor;
    }
    return {
      etapa,
      rotulo: ROTULO_DA_ETAPA[etapa],
      removidoByPeriodicity: arredondar(removido[etapa]),
      mudancasRemovidas: removidas[etapa],
      subtotalByPeriodicity: arredondar(corrente),
    };
  });

  return {
    byPeriodicity: arredondar(oficial),
    brutoByPeriodicity: arredondar(bruto),
    rastro: {
      brutoByPeriodicity: arredondar(bruto),
      degraus,
      oficialByPeriodicity: arredondar(oficial),
    },
    excludedChanges: ETAPAS.reduce((n, e) => n + removidas[e], 0),
    calculatedChanges,
    notCalculable,
  };
}

/**
 * A escada em texto, uma periodicidade por vez.
 *
 * Vai para a tela de auditoria e para o `--verbose` do CLI. É a mesma frase que
 * este módulo usa para se explicar na revisão:
 *
 * ```
 * 39.936,28 bruto
 * − 11.425,04 duplicidades por composição
 * = 28.511,24 subtotal técnico
 * − 16.594,54 duplicidades entre escopos cavalo↔carreta
 * = 11.916,70 impacto oficial
 * ```
 */
export function explicarRastro(
  rastro: RastroDaDeducao,
  periodicidade: string,
): string[] {
  const brl = (v: number) =>
    v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const linhas = [`${brl(rastro.brutoByPeriodicity[periodicidade] ?? 0)} bruto`];
  for (const degrau of rastro.degraus) {
    const saiu = degrau.removidoByPeriodicity[periodicidade] ?? 0;
    linhas.push(`− ${brl(saiu)} ${degrau.rotulo}`);
    const ultimo = degrau === rastro.degraus[rastro.degraus.length - 1];
    linhas.push(
      ultimo
        ? `= ${brl(degrau.subtotalByPeriodicity[periodicidade] ?? 0)} impacto oficial`
        : `= ${brl(degrau.subtotalByPeriodicity[periodicidade] ?? 0)} subtotal técnico`,
    );
  }
  return linhas;
}
