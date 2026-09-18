import { SEM_PERIODICIDADE, type ResumoDeImpacto } from "./deduplicacao";

/**
 * O CONTRATO DE IMPACTO — uma leitura financeira que **declara o que ela é**.
 *
 * ---------------------------------------------------------------------------
 * A pergunta que este arquivo responde
 * ---------------------------------------------------------------------------
 * Em 18/09/2026 uma tela do Panorama publicava, ao mesmo tempo e sobre a mesma
 * unidade:
 *
 * - no seletor de vigências, `R$ 43.556`;
 * - no cartão do resultado, "Nenhum valor apurado";
 * - no gráfico, seis vigências coladas no zero;
 * - e, embaixo, "300 alterações detectadas".
 *
 * Nenhum dos quatro números estava errado. Eles respondiam a **quatro perguntas
 * diferentes** — cada vigência contra a anterior dela, o par que a pessoa
 * montou, uma periodicidade escolhida por uma régua própria, e a contagem de
 * linhas — e nenhum deles dizia qual pergunta estava respondendo. Quem lê não
 * tinha como saber que ali havia quatro recortes: via uma tela que se
 * contradizia.
 *
 * A prova está em `docs/AUDITORIA-CONTRATO-DE-IMPACTO.md`, reproduzida sobre o
 * export real: com julho/2026 aberto, o seletor publica `−R$ 11.712,30/mês` e o
 * gráfico publica `−R$ 144.874,50/ano` — **as duas metades do mesmo dinheiro**,
 * cada uma invisível na superfície da outra, porque o seletor escolhe a
 * periodicidade por presença e o gráfico escolhe por magnitude.
 *
 * ---------------------------------------------------------------------------
 * A regra deste arquivo
 * ---------------------------------------------------------------------------
 * **Nenhum número financeiro circula sozinho neste produto.** Ele circula
 * dentro de uma {@link LeituraDeImpacto}, que carrega junto:
 *
 * - o **recorte** ({@link TipoDeRecorte}) — de que pergunta ele é resposta;
 * - as **duas pontas**, com rótulo, e se o par é consecutivo ou salteado;
 * - **todas** as periodicidades, nunca uma escolhida em silêncio;
 * - o **estado** ({@link EstadoDaApuracao}) — que separa o zero medido do zero
 *   que ninguém mediu;
 * - a **cobertura** e as **pendências** que a explicam.
 *
 * Quem publica um valor sem esses campos está afirmando mais do que sabe.
 *
 * ---------------------------------------------------------------------------
 * O que este arquivo **não** faz
 * ---------------------------------------------------------------------------
 * Não soma um centavo. A aritmética do dinheiro é de `deduplicacao.ts`
 * (`resumirImpacto`) e o portão do que vira dinheiro é de `viraDinheiro`
 * (`@workspace/curation`) — os dois continuam sendo a autoridade única, e este
 * contrato é uma **projeção** sobre o que eles já decidiram. Se ele somasse,
 * seria a quinta resposta para "qual foi o impacto?", que é exatamente o
 * defeito que ele existe para não ter.
 */

// ---------------------------------------------------------------------------
// 1. O recorte — de que pergunta este número é resposta
// ---------------------------------------------------------------------------

/**
 * Os três recortes que o produto sabe ler. Não há um quarto, e nenhuma
 * superfície inventa um: se a leitura não é um destes, ela não existe.
 *
 * - **`VIGENCIA_VS_ANTERIOR`** — o passo que esta vigência deu em relação à
 *   anterior imediata dela. É o que a coluna do seletor publica, uma linha por
 *   vigência, e é por isso que aquele número **não** é o do par aberto.
 * - **`PAR_SELECIONADO`** — as duas pontas que a pessoa montou. Pode ser
 *   consecutivo, salteado (com vigências no meio) ou invertido.
 * - **`INTERVALO_ACUMULADO`** — a soma dos passos de um intervalo, movimento a
 *   movimento. Não é o mesmo que o par das duas pontas: o par compara dois
 *   retratos e o intervalo soma o caminho entre eles.
 */
export type TipoDeRecorte =
  | "VIGENCIA_VS_ANTERIOR"
  | "PAR_SELECIONADO"
  | "INTERVALO_ACUMULADO";

/** A frase curta de cada recorte — a mesma em toda superfície que a escreve. */
export const ROTULO_DO_RECORTE: Record<TipoDeRecorte, string> = {
  VIGENCIA_VS_ANTERIOR: "vs. vigência anterior",
  PAR_SELECIONADO: "par selecionado",
  INTERVALO_ACUMULADO: "intervalo acumulado",
};

// ---------------------------------------------------------------------------
// 2. O estado — e por que `R$ 0` não pode responder por quatro coisas
// ---------------------------------------------------------------------------

/**
 * Em que pé está a apuração deste recorte.
 *
 * Os quatro estados existem porque **três deles viravam `R$ 0` na tela**, e um
 * zero que significa quatro coisas não significa nenhuma:
 *
 * - **`SEM_ALTERACAO`** — não há alteração nenhuma. Não há o que apurar, e não
 *   há cobertura a medir.
 * - **`NAO_CALCULAVEL`** — há alterações e **nenhuma** tem preço. O líquido não
 *   é zero: ele é desconhecido. Escrever `R$ 0` aqui afirma que o dinheiro não
 *   se moveu numa comparação que não olhou para ele.
 * - **`PARCIALMENTE_CALCULADO`** — parte virou dinheiro, parte não. O valor é
 *   verdadeiro e **incompleto**, e publicá-lo sem a cobertura ao lado o
 *   apresenta como se fosse o total.
 * - **`CALCULADO`** — toda alteração foi decidida. Só aqui `R$ 0,00` é notícia:
 *   a conta aconteceu e deu zero.
 *
 * A falha técnica (API fora, timeout, resposta vazia) **não** é um destes: ela
 * não é um estado do dado, é a ausência dele. Quem transporta a leitura a
 * representa como ausência (`null`) e nunca como um destes quatro — ver
 * `EstadoEmTela` no adaptador da interface.
 */
export type EstadoDaApuracao =
  | "SEM_ALTERACAO"
  | "NAO_CALCULAVEL"
  | "PARCIALMENTE_CALCULADO"
  | "CALCULADO";

// ---------------------------------------------------------------------------
// 3. As partes da leitura
// ---------------------------------------------------------------------------

/** Uma das pontas do recorte, com o nome pelo qual a casa a chama. */
export interface PontaDaLeitura {
  /** A data da vigência — o identificador que viaja no endereço. */
  date: string;
  /** `agosto/2026 · 1ª quinzena`, como o servidor a nomeia em toda tela. */
  label: string;
}

/**
 * O dinheiro de **uma** periodicidade, com os dois lados separados.
 *
 * Nunca se soma com outra: R$/mês e R$/ano não são a mesma grandeza, aqui nem
 * em lugar nenhum do produto. Uma superfície que precise de um número só
 * escolhe por {@link periodicidadePrincipal} e **diz** qual escolheu.
 */
export interface PeriodicidadeApurada {
  /** `MENSAL`, `ANUAL`, `PONTUAL`, ou `SEM_PERIODICIDADE` quando não declarada. */
  periodicity: string;
  /** O que subiu a remuneração. Sempre ≥ 0. */
  positivo: number;
  /** O que a reduziu. Sempre ≤ 0 — o sinal é do dado, não da tela. */
  negativo: number;
  /** `positivo + negativo`. Zero aqui pode ser compensação: ver `temMovimento`. */
  liquido: number;
  /** Alterações que somaram neste balde. Exclui as apuradas em R$ 0,00. */
  alteracoes: number;
  /**
   * `|positivo| + |negativo|` — o quanto de dinheiro se mexeu, nos dois sentidos.
   *
   * É esta a grandeza que decide qual periodicidade manda, e não o líquido: um
   * balde com R$ 120 mil de ganho contra R$ 120 mil de perda tem líquido zero e
   * é o mais movimentado do semestre. Escolher pelo líquido o descartaria em
   * favor de um balde de R$ 4 — que foi exatamente o que a bateria de testes
   * pegou na primeira versão deste arquivo.
   */
  movimentoBruto: number;
  /**
   * Houve dinheiro se movendo neste balde — em qualquer direção.
   *
   * É o campo que impede o defeito do gráfico: um balde apurado inteiramente em
   * R$ 0,00 **existe** (ele tem linha com preço) e não tem movimento, e era
   * exatamente ele que ganhava o eixo e escondia o balde que tinha o dinheiro
   * todo. `liquido === 0` não basta para saber isso — um balde com ganho e
   * perda que se anularam também dá zero, e esse moveu tudo o que moveu.
   */
  temMovimento: boolean;
}

/**
 * Um grupo de alterações que não virou dinheiro, com o motivo do motor.
 *
 * O motivo é a frase que `assessImpact` escreveu (`impact.ts`), e não uma
 * tradução feita na tela: "semântica presumida", "não é montante financeiro",
 * "um dos lados não é numérico" pedem ações diferentes de quem opera, e um
 * "sem preço" genérico apaga essa diferença.
 */
export interface PendenciaDaApuracao {
  motivo: string;
  alteracoes: number;
  /** Os códigos de atributo desse motivo, para a Curadoria saber onde mexer. */
  atributos: string[];
}

/** A régua de severidade da cobertura — uma só, para não haver duas cores. */
export function qualidadeDaCobertura(percentual: number): {
  palavra: string;
  tom: "ok" | "atencao" | "grave";
} {
  if (percentual >= 99) return { palavra: "Excelente", tom: "ok" };
  if (percentual >= 95) return { palavra: "Alta", tom: "ok" };
  if (percentual >= 85) return { palavra: "Parcial", tom: "atencao" };
  return { palavra: "Baixa", tom: "grave" };
}

/** Quanto deste recorte já está financeiramente coberto. */
export interface CoberturaDaApuracao {
  /** Alterações com valor apurado — inclusive as de R$ 0,00 e as deduplicadas. */
  apuradas: number;
  /** Alterações sem preço. `apuradas + semPreco = total`, identidade do motor. */
  semPreco: number;
  total: number;
  percentual: number;
  qualidade: { palavra: string; tom: "ok" | "atencao" | "grave" };
  /** Ainda há alteração sem preço — o que torna o valor publicado incompleto. */
  parcial: boolean;
}

// ---------------------------------------------------------------------------
// 4. O contrato
// ---------------------------------------------------------------------------

/**
 * Uma leitura financeira do FreightCheck — **a única forma** de um valor em
 * dinheiro sair do domínio para uma superfície.
 */
export interface LeituraDeImpacto {
  recorte: TipoDeRecorte;
  /**
   * A ponta de partida. `null` na primeira vigência de um histórico, que não
   * tem anterior contra a qual se comparar, e na leitura consolidada — ver
   * {@link LeituraDeImpacto.pontaDePorUnidade}.
   */
  de: PontaDaLeitura | null;
  /**
   * A ponta De existe, mas **não é uma só**: cada unidade foi comparada com a
   * anterior dela.
   *
   * É o caso da Visão Geral, que soma unidades numa competência. Sem este
   * campo, o `de: null` dessa leitura seria lido como "primeira vigência do
   * histórico", que é outra coisa — e a tela escreveria a frase errada sobre
   * por que não há par a mostrar.
   */
  pontaDePorUnidade: boolean;
  /** A ponta de chegada — a vigência que a leitura publica. */
  para: PontaDaLeitura;
  /**
   * As duas pontas se sucedem no histórico.
   *
   * `false` é o par salteado, e a tela precisa dizê-lo: o número é o que dois
   * ou mais passos somaram, e não "o que esta vigência custou".
   */
  consecutivo: boolean;
  /** A ponta De é posterior à Para — a volta. A variação não é o inverso da ida. */
  invertido: boolean;
  /** As vigências que ficaram no meio de um par salteado, em ordem. */
  intermediarias: string[];
  estado: EstadoDaApuracao;
  /**
   * **Todas** as periodicidades deste recorte, maior movimento primeiro.
   *
   * Nunca filtrada: é aqui que mora a recusa de esconder dinheiro. Uma
   * superfície que só tem espaço para uma escolhe por
   * {@link periodicidadePrincipal} e escreve a unidade ao lado do número.
   */
  periodicidades: PeriodicidadeApurada[];
  totais: {
    alteracoes: number;
    calculadas: number;
    naoCalculaveis: number;
    /** Apuradas em R$ 0,00 — a conta aconteceu e não moveu nada. */
    semEfeitoFinanceiro: number;
    /** Fora da soma por já estarem contadas noutra parcela. */
    excluidasPorDuplaContagem: number;
    veiculos: number;
  };
  cobertura: CoberturaDaApuracao | null;
  pendencias: PendenciaDaApuracao[];
}

// ---------------------------------------------------------------------------
// 5. A montagem
// ---------------------------------------------------------------------------

/** Um lado do impacto como `families-view.ts` o entrega — só a forma de que precisamos. */
export interface LadosPorPeriodicidade {
  periodicity: string;
  net: number;
  gains: { total: number; changes: number };
  losses: { total: number; changes: number };
}

export interface EntradaDaLeitura {
  recorte: TipoDeRecorte;
  de: PontaDaLeitura | null;
  para: PontaDaLeitura;
  /**
   * O histórico do contexto, em ordem crescente — o que decide se o par é
   * consecutivo e quais vigências ficaram no meio.
   *
   * Sem ela, `consecutivo` sai `true` por omissão, que é a afirmação errada a
   * fazer: seria a tela prometendo um passo sobre uma comparação salteada.
   * Por isso a ausência da lista produz `consecutivo: false` quando as pontas
   * não são conhecidamente vizinhas — nunca o contrário.
   */
  vigencias?: readonly string[];
  /** O que `resumirImpacto` apurou. A aritmética é dele, não daqui. */
  impact: ResumoDeImpacto;
  /** Os dois lados por periodicidade, quando a leitura os tem. */
  sides?: readonly LadosPorPeriodicidade[];
  totais: { alteracoes: number; veiculos: number };
  pendencias?: readonly PendenciaDaApuracao[];
  /** Ver {@link LeituraDeImpacto.pontaDePorUnidade}. */
  pontaDePorUnidade?: boolean;
}

/**
 * Monta a leitura canônica — a única porta.
 *
 * Toda decisão de "o que esta tela pode afirmar" acontece aqui, uma vez. As
 * superfícies leem o resultado; nenhuma refaz a conta, e nenhuma acrescenta uma
 * regra própria sobre zero, periodicidade ou cobertura.
 */
export function montarLeituraDeImpacto(entrada: EntradaDaLeitura): LeituraDeImpacto {
  const { impact, totais } = entrada;

  const periodicidades = periodicidadesDaLeitura(impact, entrada.sides);
  const estado = estadoDaApuracao(totais.alteracoes, impact);
  const { consecutivo, invertido, intermediarias } = posicaoDoPar(
    entrada.de?.date ?? null,
    entrada.para.date,
    entrada.vigencias,
  );

  return {
    recorte: entrada.recorte,
    de: entrada.de,
    pontaDePorUnidade: entrada.pontaDePorUnidade ?? false,
    para: entrada.para,
    consecutivo,
    invertido,
    intermediarias,
    estado,
    periodicidades,
    totais: {
      alteracoes: totais.alteracoes,
      calculadas: impact.calculatedChanges,
      naoCalculaveis: impact.notCalculable,
      semEfeitoFinanceiro: impact.zeroChanges,
      excluidasPorDuplaContagem: impact.excludedChanges,
      veiculos: totais.veiculos,
    },
    cobertura: coberturaDaApuracao(totais.alteracoes, impact.notCalculable),
    pendencias: [...(entrada.pendencias ?? [])].sort(
      (a, b) => b.alteracoes - a.alteracoes || a.motivo.localeCompare(b.motivo, "pt-BR"),
    ),
  };
}

/**
 * O estado, pela identidade do motor.
 *
 * `calculatedChanges + notCalculable = alterações`, exata porque as duas saem
 * das **mesmas** linhas em `resumirImpacto` — cada linha incrementa uma das
 * duas, nunca as duas e nunca nenhuma. É essa identidade que permite decidir o
 * estado sem reabrir linha nenhuma.
 */
export function estadoDaApuracao(
  alteracoes: number,
  impact: Pick<ResumoDeImpacto, "calculatedChanges" | "notCalculable">,
): EstadoDaApuracao {
  if (alteracoes === 0) return "SEM_ALTERACAO";
  if (impact.calculatedChanges === 0) return "NAO_CALCULAVEL";
  if (impact.notCalculable > 0) return "PARCIALMENTE_CALCULADO";
  return "CALCULADO";
}

/**
 * As periodicidades, todas, com os dois lados quando eles existem.
 *
 * A fonte é `byPeriodicity` — e não `sides` — porque `sides` descarta de
 * propósito o balde apurado inteiramente em R$ 0,00 ("zero não é lado nenhum",
 * `families-view.ts`). Esse balde precisa continuar existindo aqui: é ele que
 * distingue "apurado em zero" de "não apurado", e era a sua ausência que fazia
 * uma vigência apurada em zero chegar às telas com a mesma cara de uma sem
 * preço nenhum.
 */
export function periodicidadesDaLeitura(
  impact: Pick<ResumoDeImpacto, "byPeriodicity">,
  sides?: readonly LadosPorPeriodicidade[],
): PeriodicidadeApurada[] {
  const porBalde = new Map((sides ?? []).map((s) => [s.periodicity, s]));
  const baldes = new Set([
    ...Object.keys(impact.byPeriodicity),
    ...porBalde.keys(),
  ]);

  return [...baldes]
    .map((periodicity) => {
      const lado = porBalde.get(periodicity);
      const liquido = impact.byPeriodicity[periodicity] ?? lado?.net ?? 0;
      const positivo = lado?.gains.total ?? 0;
      const negativo = lado?.losses.total ?? 0;
      /*
        Sem `sides` não há os dois lados, e o único movimento observável é o
        módulo do líquido. É menos informação, e não uma informação diferente:
        a régua continua sendo "quanto se mexeu", medida com o que se tem.
      */
      const movimentoBruto =
        lado !== undefined
          ? Math.abs(lado.gains.total) + Math.abs(lado.losses.total)
          : Math.abs(liquido);
      return {
        periodicity,
        positivo,
        negativo,
        liquido,
        movimentoBruto,
        alteracoes: (lado?.gains.changes ?? 0) + (lado?.losses.changes ?? 0),
        /*
          Movimento é qualquer dinheiro tendo se mexido, e não o líquido ser
          diferente de zero. Sem `sides` o único sinal disponível é o líquido —
          e aí um balde compensado passa por parado, que é uma perda de
          informação honesta: melhor do que afirmar movimento que não se pode
          conferir.
        */
        temMovimento: movimentoBruto !== 0,
      };
    })
    .sort(
      (a, b) =>
        Number(b.temMovimento) - Number(a.temMovimento) ||
        b.movimentoBruto - a.movimentoBruto ||
        a.periodicity.localeCompare(b.periodicity),
    );
}

/**
 * A periodicidade que uma superfície de **um número só** deve publicar.
 *
 * ---------------------------------------------------------------------------
 * A régua, e o defeito que ela corrige
 * ---------------------------------------------------------------------------
 * Manda **quem tem movimento**. Depois, a magnitude. O empate final é o nome,
 * para a escolha ser estável entre dois desenhos do mesmo dado.
 *
 * A magnitude é a **bruta** (`movimentoBruto`), e não o líquido — ver o campo.
 *
 * O primeiro critério não é detalhe: era a sua falta que produzia o gráfico
 * chapado no zero. Uma vigência com `ANUAL: 0` e `MENSAL: −11.712,30` tem o
 * balde anual **existindo** (houve linha com preço nele), e uma régua que
 * ordenasse só por magnitude ou que respeitasse uma "preferida" pela mera
 * existência do balde escolhia o anual — seis pontos no zero ao lado de um
 * seletor que anunciava dezenas de milhares de reais.
 *
 * Uma superfície que escolhe também precisa dizer que escolheu: quem tem mais
 * de uma periodicidade com movimento deve mostrar as duas
 * ({@link temMaisDeUmaPeriodicidade}), e nunca somá-las.
 */
export function periodicidadePrincipal(
  periodicidades: readonly PeriodicidadeApurada[],
  /**
   * A periodicidade que a superfície preferiria — a da vigência aberta, a da
   * aba escolhida.
   *
   * Ela só vence **se tiver movimento**. Uma preferência por um balde parado
   * não é uma escolha de leitura: é o dinheiro sumindo da tela sem que nada
   * diga que ele existe.
   */
  preferida?: string | null,
): string | null {
  if (periodicidades.length === 0) return null;
  const comMovimento = periodicidades.filter((p) => p.temMovimento);
  const elegiveis = comMovimento.length > 0 ? comMovimento : periodicidades;
  if (preferida != null) {
    const escolhida = elegiveis.find((p) => p.periodicity === preferida);
    if (escolhida) return escolhida.periodicity;
  }
  return elegiveis[0]?.periodicity ?? null;
}

/** Há dinheiro se movendo em mais de uma grandeza — a tela não pode publicar uma só calada. */
export function temMaisDeUmaPeriodicidade(
  periodicidades: readonly PeriodicidadeApurada[],
): boolean {
  return periodicidades.filter((p) => p.temMovimento).length > 1;
}

/** A leitura de uma periodicidade específica — `null` quando o recorte não a tem. */
export function periodicidadeDaLeitura(
  leitura: Pick<LeituraDeImpacto, "periodicidades">,
  periodicity: string | null,
): PeriodicidadeApurada | null {
  if (periodicity === null) return null;
  return leitura.periodicidades.find((p) => p.periodicity === periodicity) ?? null;
}

/**
 * A cobertura — `null` sem alteração nenhuma, porque `0/0` não é zero por
 * cento: é uma vigência que não tem o que cobrir.
 */
export function coberturaDaApuracao(
  total: number,
  semPreco: number,
): CoberturaDaApuracao | null {
  if (total <= 0) return null;
  const apuradas = total - semPreco;
  const percentual = (apuradas / total) * 100;
  return {
    apuradas,
    semPreco,
    total,
    percentual,
    qualidade: qualidadeDaCobertura(percentual),
    parcial: semPreco > 0,
  };
}

/**
 * Onde as duas pontas estão uma em relação à outra.
 *
 * Sem a lista de vigências não há como afirmar vizinhança, e o padrão é o
 * conservador: `consecutivo: false`. Prometer um passo sobre uma comparação que
 * pode ter três no meio é o erro caro; dizer "não sei se é consecutivo" e
 * mostrar as duas pontas é o barato.
 */
export function posicaoDoPar(
  de: string | null,
  para: string,
  vigencias?: readonly string[],
): { consecutivo: boolean; invertido: boolean; intermediarias: string[] } {
  if (de === null) {
    // Sem ponta de partida não há par: é a primeira vigência de um histórico,
    // ou uma leitura que não é de par. Nada a sinalizar.
    return { consecutivo: true, invertido: false, intermediarias: [] };
  }
  const invertido = de > para;
  if (!vigencias || vigencias.length === 0) {
    return { consecutivo: false, invertido, intermediarias: [] };
  }
  const ordenadas = [...vigencias].sort();
  const iDe = ordenadas.indexOf(de);
  const iPara = ordenadas.indexOf(para);
  if (iDe < 0 || iPara < 0) {
    return { consecutivo: false, invertido, intermediarias: [] };
  }
  const menor = Math.min(iDe, iPara);
  const maior = Math.max(iDe, iPara);
  return {
    consecutivo: maior - menor === 1,
    invertido,
    intermediarias: ordenadas.slice(menor + 1, maior),
  };
}

/**
 * As pendências, agrupadas por motivo — a partir das linhas que o motor marcou.
 *
 * Existe aqui, e não em cada rota, porque a frase é do motor e a agregação é
 * sempre a mesma: por motivo, com os atributos que caíram nele. Uma segunda
 * versão desta contagem numa rota qualquer voltaria a produzir um "sem preço"
 * que não diz o que destrava.
 */
export function agruparPendencias(
  linhas: readonly {
    impact_confidence?: string | null;
    impact_reason?: string | null;
    attribute_code?: string | null;
  }[],
): PendenciaDaApuracao[] {
  const porMotivo = new Map<string, { alteracoes: number; atributos: Set<string> }>();
  for (const linha of linhas) {
    if (linha.impact_confidence === "CALCULATED") continue;
    const motivo = linha.impact_reason?.trim();
    if (!motivo) continue;
    const grupo = porMotivo.get(motivo) ?? { alteracoes: 0, atributos: new Set<string>() };
    grupo.alteracoes++;
    if (linha.attribute_code) grupo.atributos.add(linha.attribute_code);
    porMotivo.set(motivo, grupo);
  }
  return [...porMotivo.entries()]
    .map(([motivo, g]) => ({
      motivo,
      alteracoes: g.alteracoes,
      atributos: [...g.atributos].sort(),
    }))
    .sort((a, b) => b.alteracoes - a.alteracoes || a.motivo.localeCompare(b.motivo, "pt-BR"));
}

/** O balde de quem tem preço e não tem periodicidade declarada — reexportado para as telas. */
export { SEM_PERIODICIDADE };
