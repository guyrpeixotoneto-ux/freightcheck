/**
 * JUSTIFICAR EM LOTE — o que o lote é, antes de ser tela ou rota.
 *
 * ---------------------------------------------------------------------------
 * Por que o escopo é um tipo, e não uma lista de ids
 * ---------------------------------------------------------------------------
 * Justificar em lote é, na prática, duas operações com a mesma frase, e
 * confundi-las é o defeito que este módulo existe para impedir:
 *
 * · **SELECAO** — quem marcou as caixas escolheu, uma a uma, as alterações que
 *   está explicando. O universo é a lista, e a lista é o registro: são dezenas,
 *   e mandá-las por extenso é a forma mais honesta de dizer o que foi feito.
 * · **FILTRO** — quem clicou em "Selecionar todos os 206 resultados" não
 *   escolheu 206 alterações: escolheu **um recorte**. Mandar os ids seria
 *   mandar o retrato que o navegador tinha do recorte, que pode já não ser o
 *   que o recorte é — e, num acervo maior, seriam milhares de números no fio
 *   para dizer o que cinco campos dizem. O universo é o filtro, o servidor o
 *   reabre com a mesma função que a tela usou para desenhar a tabela
 *   ({@link filtrarLinhasDeIpva}), e o que fica gravado é o filtro, não o
 *   retrato.
 *
 * ---------------------------------------------------------------------------
 * O que nunca é silencioso
 * ---------------------------------------------------------------------------
 * **Uma justificativa gravada não é sobrescrita por acidente.** O padrão do
 * lote é não tocar no que já está explicado: quem selecionou 206 linhas das
 * quais 31 já têm justificativa está, quase sempre, resolvendo as 175 que
 * faltam — e regravar as 31 apagaria da tela decisões que outra pessoa tomou,
 * uma a uma, com o nome dela. Substituir continua possível, mas é outra ação:
 * pede confirmação, pede permissão de administrador, e fica registrada como
 * substituição (ver `justificativa_lote.sobrescritas`).
 *
 * Nada aqui grava nada. Este módulo é a regra — o servidor a aplica, a tela a
 * anuncia antes do clique, e as duas leem a mesma função para que a frase da
 * tela não possa divergir do que a rota faz.
 */

/**
 * Os filtros de uma rubrica, como eles viajam — um registro raso.
 *
 * As oito rubricas filtram por coisas diferentes: todas têm busca, tipo de
 * ativo, variável e estado, e cada uma tem as suas — o tributo nos Impostos, o
 * papel na Aquisição, "só alugados", "só viradas", "só R$/km". Este módulo não
 * conhece nenhuma delas, e é de propósito: ele decide o que um **lote** é, e
 * quem sabe ler e aplicar o filtro de cada rubrica é o recorte dela
 * (`recortes-do-lote.ts`), que é o único lugar onde as oito se encontram.
 *
 * Raso porque é o que o filtro de uma tela é: cinco ou seis caixas, cada uma
 * com um texto ou um alternador. Um tipo mais frouxo — `unknown` — deixaria
 * passar para `justificativa_lote.recorte` um objeto aninhado que ninguém
 * saberia reabrir, e é justamente esse registro que precisa continuar legível
 * daqui a seis meses.
 *
 * É por causa deste tipo que os oito `FiltrosDeX` são declarados com `type` e
 * não com `interface`: só o alias ganha a index signature implícita que os
 * torna atribuíveis aqui. Com `interface`, cada tela teria de converter o
 * próprio filtro para mandá-lo — uma conversão por chamada, em oito telas, para
 * dizer o que a forma já diz.
 */
export type FiltrosDoLote = Record<string, string | boolean>;

/**
 * O universo de um lote — a lista escolhida, ou o recorte que a define.
 *
 * `FILTRO` carrega o par de vigências junto do filtro, e não por redundância:
 * é o par que diz de qual comparação o recorte é, e é ele que fica gravado
 * quando alguém for perguntar, daqui a seis meses, o que foi que aquela frase
 * alcançou. A rubrica vai junto pelo mesmo motivo: o mesmo `estado: ALTERADO`
 * quer dizer coisas diferentes no IPVA e no FINAME, porque as colunas lidas
 * são outras.
 */
export type EscopoDoLote =
  | { tipo: "SELECAO"; changeIds: number[] }
  | {
      tipo: "FILTRO";
      rubrica: string;
      /** O par aberto quando o recorte foi escolhido. */
      base: string;
      comparada: string;
      filtros: FiltrosDoLote;
      /** O alternador "Mostrar veículos sem alteração" estava ligado? */
      semAlteracao: boolean;
    };

/** A recusa de um corpo que não descreve um universo. */
export interface EscopoRecusado {
  ok: false;
  erro: string;
}

export interface EscopoLido {
  ok: true;
  valor: EscopoDoLote;
}

/**
 * O escopo como o corpo da requisição o traz — nunca confiado como chega.
 *
 * A lista vem filtrada a inteiros finitos porque ela vira `IN (…)` no banco, e
 * o teto existe pela razão oposta à do `FILTRO`: uma seleção de trinta mil ids
 * não é seleção, é um recorte disfarçado, e quem tem um recorte manda o
 * recorte.
 */
export const TETO_DA_SELECAO = 1000;

export function lerEscopoDoLote(
  bruto: unknown,
  /**
   * As rubricas cujo recorte o servidor sabe reabrir, e como cada uma lê o
   * filtro dela — `RECORTES_DO_LOTE`, em `recortes-do-lote.ts`.
   *
   * Vem de fora, e não de um import aqui, para que este módulo continue sem
   * conhecer rubrica nenhuma: é o que permite ao navegador carregar as regras
   * do lote sem arrastar junto o catálogo das oito.
   */
  recortes: Record<string, { lerFiltros: (bruto: unknown) => FiltrosDoLote }>,
): EscopoLido | EscopoRecusado {
  const objeto = (bruto ?? {}) as Record<string, unknown>;

  if (objeto.tipo === "FILTRO") {
    const rubrica = typeof objeto.rubrica === "string" ? objeto.rubrica : "";
    const recorte = recortes[rubrica];
    if (!recorte) {
      return {
        ok: false,
        erro: `Não sei reabrir o recorte de ${rubrica || "—"} — o lote por filtro existe para ${Object.keys(recortes).sort().join(", ")}.`,
      };
    }
    const base = typeof objeto.base === "string" ? objeto.base : "";
    const comparada = typeof objeto.comparada === "string" ? objeto.comparada : "";
    if (!base || !comparada) {
      return {
        ok: false,
        erro: "O recorte precisa dizer de qual par de vigências ele é.",
      };
    }
    return {
      ok: true,
      valor: {
        tipo: "FILTRO",
        rubrica,
        base,
        comparada,
        filtros: recorte.lerFiltros(objeto.filtros),
        semAlteracao: objeto.semAlteracao === true,
      },
    };
  }

  const changeIds = Array.isArray(objeto.changeIds)
    ? [
        ...new Set(
          (objeto.changeIds as unknown[]).filter(
            (v): v is number => typeof v === "number" && Number.isFinite(v),
          ),
        ),
      ]
    : [];
  if (changeIds.length === 0) {
    return { ok: false, erro: "Selecione ao menos uma alteração." };
  }
  if (changeIds.length > TETO_DA_SELECAO) {
    return {
      ok: false,
      erro: `Uma seleção vai até ${TETO_DA_SELECAO} alterações. Acima disso, use “Selecionar todos os resultados”, que grava o filtro em vez da lista.`,
    };
  }
  return { ok: true, valor: { tipo: "SELECAO", changeIds } };
}

/**
 * Como cada chave de filtro se lê em português.
 *
 * Uma tabela só para as oito rubricas, e não uma por rubrica, porque o que ela
 * resolve é a **leitura do registro de auditoria**: quem for conferir, daqui a
 * seis meses, o que aquela frase alcançou vai ler `justificativa_lote.descricao`
 * — e "soReaisKm true" não é uma resposta, é um campo de banco.
 *
 * As quatro primeiras são de todas as rubricas; as demais são as caixas
 * próprias de cada uma. Uma chave que não esteja aqui continua aparecendo, com
 * o próprio nome: o registro fica feio e continua verdadeiro, que é a ordem
 * certa de prioridades quando alguém acrescentar um filtro e esquecer desta
 * linha.
 */
export const ROTULO_DO_FILTRO: Record<string, string> = {
  busca: "busca",
  tipo: "tipo",
  variavel: "variável",
  estado: "estado",
  tributo: "tributo",
  papel: "papel",
  soNegativos: "só valores negativos",
  soAlugados: "só os que declaram aluguel",
  soNota: "só o valor de nota",
  soAliquotas: "só as alíquotas",
  soViradas: "só quem virou de ciclo",
  soReaisKm: "só o que é R$/km",
  soSeguro: "só o seguro",
};

/**
 * O universo dito por extenso — o que fica gravado para quem for auditar.
 *
 * Não é decoração: `justificativa_lote.recorte` guarda o objeto, que é exato e
 * ilegível, e esta frase guarda o que uma pessoa consegue conferir contra a
 * tela. As duas juntas respondem "o que esta frase alcançou", que é a pergunta
 * que a justificativa em lote inevitavelmente provoca.
 *
 * Só entra o que foi **de fato filtrado**: com os padrões em mãos, "variável
 * TODAS" fica de fora, porque escrevê-lo seria inventar um recorte no registro
 * de auditoria — e um registro que afirma mais do que aconteceu é pior do que
 * um lacônico. Sem os padrões, entra tudo o que não é vazio, que é o mais
 * próximo da verdade que dá para chegar sem eles.
 */
export function descreverEscopoDoLote(
  escopo: EscopoDoLote,
  /** Os filtros vazios da rubrica — `FILTROS_DE_X_VAZIOS`. */
  padroes?: FiltrosDoLote,
): string {
  if (escopo.tipo === "SELECAO") {
    return escopo.changeIds.length === 1
      ? "1 alteração escolhida a dedo"
      : `${escopo.changeIds.length} alterações escolhidas a dedo`;
  }
  const partes: string[] = [
    `rubrica ${escopo.rubrica}`,
    `par ${escopo.base} → ${escopo.comparada}`,
  ];
  for (const [chave, valor] of Object.entries(escopo.filtros)) {
    const padrao = padroes?.[chave];
    if (padrao !== undefined ? valor === padrao : valor === "" || valor === false) {
      continue;
    }
    const rotulo = ROTULO_DO_FILTRO[chave] ?? chave;
    /* O alternador é o próprio rótulo: "só valores negativos true" seria o
       campo do banco vazando para a frase. Ligado, ele se diz; desligado, já
       saiu acima. */
    if (typeof valor === "boolean") {
      partes.push(rotulo);
      continue;
    }
    /* A busca vem entre aspas porque ela é texto de quem digitou, e sem elas
       um espaço no fim vira uma frase que não bate com o que se vê na tela. */
    partes.push(chave === "busca" ? `${rotulo} “${valor.trim()}”` : `${rotulo} ${valor}`);
  }
  if (escopo.semAlteracao) partes.push("incluindo o que não mudou");
  return `todos os resultados do recorte: ${partes.join(", ")}`;
}

/**
 * O que o lote de fato vai gravar, separado do que ele deliberadamente não
 * toca.
 *
 * `candidatos` são as alterações do universo que **podem** receber
 * justificativa — a regra de sempre, e não uma segunda: o motor afirmou que
 * houve alteração (ver `justificavel`, na coluna). Um conflito ou um dado
 * incompleto não entra aqui por nenhum caminho, nem quando alguém marca a
 * caixa da placa inteira.
 */
export interface ReparticaoDoLote {
  /** O que recebe a justificativa agora. */
  aplicar: number[];
  /** O que já tinha justificativa e **não** foi tocado. */
  preservadas: number[];
  /** O que já tinha justificativa e foi substituído — só com `sobrescrever`. */
  sobrescritas: number[];
}

export function repartirAlvosDoLote(
  candidatos: readonly number[],
  jaJustificadas: ReadonlySet<number>,
  sobrescrever: boolean,
): ReparticaoDoLote {
  const aplicar: number[] = [];
  const preservadas: number[] = [];
  const sobrescritas: number[] = [];
  for (const id of candidatos) {
    if (!jaJustificadas.has(id)) {
      aplicar.push(id);
      continue;
    }
    if (sobrescrever) {
      aplicar.push(id);
      sobrescritas.push(id);
    } else {
      preservadas.push(id);
    }
  }
  return { aplicar, preservadas, sobrescritas };
}

// ---------------------------------------------------------------------------
// As alterações iguais
// ---------------------------------------------------------------------------

/**
 * O contexto de uma alteração — o que faz duas delas serem "a mesma coisa".
 *
 * A seleção rápida "Selecionar alterações iguais" precisa de um critério que
 * não minta, e o critério é a **identidade do fato**, não a semelhança dele:
 * mesma variável, mesmo tipo de ativo, mesmo valor anterior, mesmo valor novo,
 * dentro do mesmo par de vigências. A placa é justamente o que fica de fora —
 * é ela que varia entre as linhas iguais.
 *
 * O par não entra na chave porque a tela inteira é de um par só: duas linhas
 * comparadas nesta tabela são, por construção, das mesmas duas vigências. Ele
 * entra no **escopo gravado**, onde é a metade que torna o registro
 * verificável.
 *
 * Valor nulo e valor ausente não são a mesma coisa que zero, e a chave os
 * distingue: `∅` é "não havia", e `0` é zero medido. Igualar os dois faria a
 * seleção rápida juntar uma entrada de ativo com uma queda a zero.
 */
export interface ContextoDaAlteracao {
  variavel: string;
  entityType: string;
  base: string | null;
  comparada: string | null;
}

export function chaveDoContexto(c: ContextoDaAlteracao): string {
  const valor = (v: string | null) => (v === null || v === "" ? "∅" : v);
  return [c.variavel, c.entityType, valor(c.base), valor(c.comparada)].join("|");
}


// ---------------------------------------------------------------------------
// O resumo do conjunto
// ---------------------------------------------------------------------------

/** O mínimo que o resumo precisa de cada alteração selecionada. */
export interface AlteracaoDoLote extends ContextoDaAlteracao {
  id: number;
  entityLabel: string | null;
  rotuloDaVariavel: string;
  /**
   * Os dois valores **como a tabela os escreve** — `R$ 21.259,89`, e não
   * `21259.89`.
   *
   * Separado do valor cru, e não no lugar dele, porque os dois respondem
   * perguntas diferentes: a igualdade entre duas alterações é decidida pelo
   * valor cru (formatar primeiro juntaria `7210,001` e `7210,004` sob o mesmo
   * `R$ 7.210,00`), e o resumo mostra o escrito, porque um número em reais
   * escrito sem reais numa caixa que pergunta a fórmula dele é o convite ao
   * engano que este produto documenta em toda parte.
   *
   * Opcional: quem não tiver como escrever mostra o cru, que continua sendo
   * verdade.
   */
  escrito?: { base: string; comparada: string };
}

/**
 * O que se está prestes a justificar, dito antes do clique.
 *
 * O campo que **só aparece quando é verdade** é o ponto deste tipo: `variavel`,
 * `entityType`, `base` e `comparada` são nulos assim que o conjunto tem mais de
 * um valor. Escrever "R$ 7.210,00 → R$ 4.145,26" no cabeçalho de uma seleção em
 * que metade das linhas tem outros valores seria a frase mais perigosa desta
 * tela: ela convida a explicar um fato que só vale para parte do que vai ser
 * gravado.
 *
 * `veiculos` conta placas distintas, e `total` conta alterações — são dois
 * números diferentes de propósito, como em toda tela deste produto: cinco
 * alterações podem ser de duas placas.
 */
export interface ResumoDoLote {
  /** Quantas alterações. */
  total: number;
  /** Quantas placas distintas. */
  veiculos: number;
  /** Quantas já têm justificativa gravada. */
  jaJustificadas: number;
  /** O rótulo da variável, quando é uma só no conjunto. */
  variavel: string | null;
  /** O tipo de ativo, quando é um só. */
  entityType: string | null;
  /** O valor anterior, quando é o mesmo em todas. */
  base: string | null;
  /** O valor novo, quando é o mesmo em todas. */
  comparada: string | null;
  /** Os mesmos dois, como a tabela os escreve. Nulos quando ninguém os escreveu. */
  baseEscrita: string | null;
  comparadaEscrita: string | null;
  /** O conjunto inteiro tem o mesmo contexto — o caso do agrupamento. */
  mesmoContexto: boolean;
}

export function resumirConjuntoDoLote(
  alteracoes: readonly AlteracaoDoLote[],
  jaJustificadas: ReadonlySet<number>,
): ResumoDoLote {
  const unico = <T,>(valores: readonly T[]): T | null => {
    const distintos = new Set(valores);
    const [primeiro] = [...distintos];
    return distintos.size === 1 ? (primeiro ?? null) : null;
  };
  const base = unico(alteracoes.map((a) => a.base));
  const comparada = unico(alteracoes.map((a) => a.comparada));
  const primeira = alteracoes[0];
  return {
    total: alteracoes.length,
    veiculos: new Set(alteracoes.map((a) => a.entityLabel ?? "—")).size,
    jaJustificadas: alteracoes.filter((a) => jaJustificadas.has(a.id)).length,
    variavel: unico(alteracoes.map((a) => a.rotuloDaVariavel)),
    entityType: unico(alteracoes.map((a) => a.entityType)),
    base,
    comparada,
    /* Escrito só quando o cru é único: é o cru que decide a igualdade, e
       escrever o do primeiro sob um conjunto de valores diferentes seria a
       frase que esta caixa inteira existe para não dizer. */
    baseEscrita: base === null ? null : (primeira?.escrito?.base ?? null),
    comparadaEscrita: comparada === null ? null : (primeira?.escrito?.comparada ?? null),
    mesmoContexto:
      alteracoes.length > 0 && new Set(alteracoes.map(chaveDoContexto)).size === 1,
  };
}

/**
 * As alterações **iguais** às que já estão selecionadas — a seleção rápida.
 *
 * Só responde quando o que está selecionado tem um contexto só: com duas
 * fórmulas diferentes em jogo, "iguais a quê?" não tem resposta, e inventar uma
 * (a da primeira? a da maioria?) selecionaria em nome de quem clicou um
 * critério que ninguém viu. Devolve a lista inteira das iguais, incluindo as já
 * selecionadas — é ela que a tela marca.
 */
export function alteracoesIguais(
  universo: readonly AlteracaoDoLote[],
  selecionadas: ReadonlySet<number>,
): AlteracaoDoLote[] {
  const marcadas = universo.filter((a) => selecionadas.has(a.id));
  if (marcadas.length === 0) return [];
  const chaves = new Set(marcadas.map(chaveDoContexto));
  if (chaves.size !== 1) return [];
  const [chave] = [...chaves];
  return universo.filter((a) => chaveDoContexto(a) === chave);
}
