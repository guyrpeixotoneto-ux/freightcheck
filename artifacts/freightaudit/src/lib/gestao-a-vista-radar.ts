/**
 * O que o Radar lê de uma unidade — e é tudo o que ele lê.
 *
 * Era `Movimentos`, o contrato inteiro de `/changes/range`: `entries` com o
 * grupo completo em cada uma, `byParameter`, `context`, `periods`, `totals`.
 * A grade usa dois campos. Medido no seed do produto, a resposta grande tinha
 * 517.238 B e estes dois somavam 6.388 — a grade consumia 1,2% do que recebia,
 * uma vez por unidade.
 *
 * Tipar pelo que se usa é o que torna a rota mínima (`/changes/radar`)
 * verificável: se amanhã a grade precisar de mais um campo, ele entra aqui e o
 * compilador cobra a rota. Enquanto isso, nada que a rota não mande pode ser
 * lido por engano.
 */
export interface LeituraDoRadar {
  movements: {
    period: string;
    label: string;
    changes: number;
    impact: { byPeriodicity: Record<string, number>; notCalculable: number };
  }[];
  gaps: { period: string; label: string }[];
}

/**
 * Um atributo de uma vigência, como `/changes/radar?period=` devolve.
 *
 * Espelha `EntradaDaCelula` no servidor (`lib/comparison/src/radar.ts`) — sete
 * campos, contra o `RangeEntry` que carregava o `GroupView` inteiro.
 */
export interface EntradaDaCelula {
  period: string;
  parameterKey: string;
  parameterName: string;
  family: string;
  attributeCode: string | null;
  amount: number | null;
  periodicity: string | null;
}

/**
 * O Radar de Alterações — a terceira leitura da Gestão à Vista, em matriz.
 *
 * O Financeiro responde "quanto" e o Alertas responde "quem mexeu"; nenhum dos
 * dois responde **quando**. O Radar é a grade unidade × vigência: cada célula
 * diz quantas alterações aquela unidade teve naquela competência, o impacto
 * apurado ali, e quantas alterações ficaram sem impacto apurado. Lido de
 * longe, é onde se vê que uma unidade concentrou tudo numa vigência só, ou que
 * o prejuízo veio pingando.
 *
 * Três recusas sustentam a grade, e as três estão neste arquivo e não na tela:
 *
 * 1. **Periodicidade não soma.** A grade inteira é desenhada numa
 *    periodicidade de cada vez (`montarRadar` recebe qual), porque somar
 *    R$/mês com R$/ano numa célula de wallboard produziria o número mais
 *    lido e menos verdadeiro do produto. `periodicidadesDoRadar` devolve
 *    quais existem no intervalo, na ordem do que pesa mais.
 * 2. **Vazio não é zero.** Uma célula sem vigência (`"sem-vigencia"`) e uma
 *    vigência importada sem comparação calculada (`"sem-comparacao"`, os
 *    `gaps` de `/changes/range`) são estados distintos de "0 alterações
 *    apuradas" — e cada um sai com um desenho próprio, nunca como `R$ 0`.
 * 3. **Sem impacto apurado continua visível.** `notCalculable` viaja até a
 *    célula: uma competência com dez alterações sem preço não pode aparecer
 *    como uma competência calma.
 *
 * Nada aqui lê a rede nem o React. A entrada é exatamente o JSON que
 * `/changes/range` devolve por contexto (`Movimentos`), o que deixa cada conta
 * conferível ao lado do contrato que a alimenta — a mesma separação de
 * `gestao-a-vista-autoplay.ts`.
 */

// ---------------------------------------------------------------------------
// A janela de vigências
// ---------------------------------------------------------------------------

/** Quantas colunas o Radar mostra por padrão — sete competências e o total. */
export const COLUNAS_PADRAO = 7;

/**
 * As vigências que viram coluna, da mais antiga à mais recente, e o `from` que
 * `/changes/range` precisa para produzi-las.
 *
 * `/changes/range` conta as transições que **vão** de `from` até `to` — a ponta
 * inicial é ponto de partida, não período somado (ver `families-view.ts`). Por
 * isso o `from` devolvido aqui é a vigência **anterior** à primeira coluna:
 * pedir `from` igual à primeira coluna devolveria uma coluna a menos, sempre.
 *
 * Sem vigência anterior à primeira coluna (o histórico inteiro cabe na janela),
 * `from` é a própria primeira vigência da série — e a coluna dela fica com
 * "sem comparação", que é a verdade: não há de onde comparar.
 */
export function janelaDoRadar(
  periodosDisponiveis: string[],
  ate: string | null,
  colunas = COLUNAS_PADRAO,
): { from: string | null; to: string | null; periodos: string[] } {
  const ordenados = [...new Set(periodosDisponiveis)].sort();
  const fim = ate ?? ordenados[ordenados.length - 1] ?? null;
  if (fim === null) return { from: null, to: null, periodos: [] };

  const ateOFim = ordenados.filter((p) => p <= fim);
  const periodos = ateOFim.slice(-colunas);
  const anterior = ateOFim[ateOFim.length - periodos.length - 1] ?? null;

  return { from: anterior ?? periodos[0] ?? null, to: fim, periodos };
}

/**
 * A query de `/changes/range` para um contexto — e a chave de cache dela.
 *
 * Existe como função porque a tela precisa da **mesma** string em dois
 * momentos: ao montar a lista de `useQueries` (onde ela vira `queryKey`) e ao
 * procurar o resultado de um contexto para preencher a linha da unidade. Eram
 * dois trechos gêmeos escritos à mão, e gêmeos que precisam ser idênticos para
 * o produto funcionar são gêmeos que uma hora deixam de ser: bastaria um dos
 * dois ordenar os parâmetros diferente, ou omitir o canal nulo de outro jeito,
 * para toda unidade ficar pendente para sempre — sem erro, sem log, só uma
 * grade que nunca fecha.
 *
 * Uma função, um teste, dois chamadores.
 *
 * @param intervalo  o `from`/`to` da janela, já montado
 */
export function chaveDaLeitura(
  intervalo: URLSearchParams,
  contexto: { scopeHash: string; canal: string | null },
): string {
  const query = new URLSearchParams(intervalo);
  query.set("scopeHash", contexto.scopeHash);
  if (contexto.canal !== null) query.set("canal", contexto.canal);
  return query.toString();
}

// ---------------------------------------------------------------------------
// A grade
// ---------------------------------------------------------------------------

/**
 * O que a tela sabe de uma unidade antes de montar a linha dela.
 *
 * `movimentos` vem um por contexto, na mesma ordem de `contextos`, porque
 * `/changes/range` responde por um `scopeHash`/`canal` de cada vez. Uma
 * unidade com dois canais tem duas leituras, e a linha dela é a soma das duas
 * — a mesma régua da Visão Geral, que soma os contextos de uma unidade e nunca
 * unidades entre si sem dizer.
 */
export interface UnidadeDoRadar {
  unidade: string;
  label: string;
  contextos: { scopeHash: string; canal: string | null }[];
  movimentos: (LeituraDoRadar | null | undefined)[];
  /**
   * Se a leitura desta unidade já chegou — e o campo é **obrigatório** de
   * propósito.
   *
   * `/changes/range` responde uma unidade de cada vez, e antes deste campo o
   * Radar não tinha como distinguir "ainda não respondeu" de "respondeu e não
   * havia nada": as duas chegavam aqui como `movimentos: [undefined]` e saíam
   * de `montarRadar` como uma linha de zeros. O efeito na tela era uma unidade
   * pendente desenhada com a mesma cara de uma unidade calma — `0 alt. ·
   * R$ 0,00` —, e os quatro cartões do topo somando esse zero como se fosse
   * apuração fechada. Medido: com cinco unidades, a grade passava 477 ms
   * exibindo zeros que ainda iam mudar.
   *
   * Opcional com padrão `"pronta"` teria sido menos invasivo e teria trazido o
   * defeito de volta na primeira vez que alguém montasse a lista sem pensar
   * nisso. Obrigatório, o compilador pergunta.
   */
  estado: EstadoDaUnidade;
  /**
   * Quantas tentativas desta leitura já falharam.
   *
   * Existe por causa de um número medido: uma unidade que responde 500 leva
   * **13,2 s** para virar `"erro"`, porque a política de repetição do produto
   * (`resiliencia.ts`) gasta cinco tentativas antes de desistir — orçamento
   * deliberado, que existe para cobrir cold start e é global.
   *
   * Encurtá-lo só para o Radar seria criar uma segunda política, que é
   * exatamente o defeito que `resiliencia.ts` foi escrito para fechar. O que dá
   * para consertar sem tocar nela é o silêncio: durante esses 13,2 s a linha
   * dizia "carregando…", indistinguível de uma unidade só lenta. Com este
   * número a tela diz que já falhou e está insistindo — a política decide
   * quando parar, a linha conta o que está acontecendo.
   *
   * `0` numa linha pendente é uma leitura que ainda não falhou nenhuma vez.
   */
  tentativas: number;
}

/**
 * O que se sabe da leitura de uma unidade.
 *
 * `"erro"` é separado de `"pendente"` porque as duas terminam diferente: uma
 * pendente vira número, uma com erro não vira — e a linha precisa dizer qual
 * das duas é, em vez de ficar para sempre num "carregando" que não vai chegar.
 */
export type EstadoDaUnidade = "pendente" | "pronta" | "erro";

export type EstadoDaCelula =
  /** A unidade não tem essa vigência — nada aconteceu porque nada foi entregue. */
  | "sem-vigencia"
  /** Vigência importada sem comparação calculada — o que houve ali não está somado. */
  | "sem-comparacao"
  /** Houve comparação: `alteracoes` e `impacto` são fato apurado, inclusive quando zero. */
  | "apurado"
  /** A leitura desta unidade ainda está em voo. **Não é zero**, e não pode ser somada. */
  | "pendente"
  /** A leitura desta unidade falhou. Também não é zero, e também não soma. */
  | "erro";

export interface CelulaDoRadar {
  periodo: string;
  label: string;
  estado: EstadoDaCelula;
  alteracoes: number;
  /** Na periodicidade escolhida. `0` quando a comparação existiu e não achou dinheiro nela. */
  impacto: number;
  /** Alterações que a comparação viu e não conseguiu precificar. */
  semApuracao: number;
}

export interface LinhaDoRadar {
  unidade: string;
  label: string;
  contextos: { scopeHash: string; canal: string | null }[];
  celulas: CelulaDoRadar[];
  /** As somas da janela inteira — a última coluna da grade. */
  totalDeAlteracoes: number;
  totalDeImpacto: number;
  totalSemApuracao: number;
  /**
   * O estado da unidade, repetido na linha para a tela não ter de voltar à
   * lista de entrada para saber se desenha número ou espera.
   *
   * Numa linha "pendente" ou "erro" os três totais acima são `0` porque não há
   * o que somar — e é justamente por isso que a tela **não** pode imprimi-los:
   * o zero aqui é ausência de leitura, não resultado de leitura.
   */
  estado: EstadoDaUnidade;
  /** Tentativas já falhadas desta leitura. Ver `UnidadeDoRadar.tentativas`. */
  tentativas: number;
}

/**
 * As periodicidades presentes na janela, a que pesa mais primeiro.
 *
 * É o que a tela oferece como abas: uma grade por periodicidade, nunca as duas
 * misturadas. A ordem é por módulo do total, e não por sinal — o que decide a
 * atenção de quem lê de longe é o tamanho do número, e a janela pode muito bem
 * ter o maior movimento a favor.
 */
export function periodicidadesDoRadar(unidades: UnidadeDoRadar[]): string[] {
  const totais = new Map<string, number>();
  for (const unidade of unidades) {
    for (const movimentos of unidade.movimentos) {
      for (const movimento of movimentos?.movements ?? []) {
        for (const [periodicidade, valor] of Object.entries(movimento.impact.byPeriodicity)) {
          totais.set(periodicidade, (totais.get(periodicidade) ?? 0) + valor);
        }
      }
    }
  }
  return [...totais.entries()]
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([periodicidade]) => periodicidade);
}

/**
 * A grade: uma linha por unidade, uma célula por vigência da janela.
 *
 * A ordem das linhas é a mesma do pódio da Visão Geral — maior módulo de
 * impacto primeiro, e o volume de alterações desempata. Unidade sem nenhuma
 * vigência na janela continua na grade, com a linha inteira vazia: sumir com
 * ela faria o telão dizer que a unidade não existe quando o que houve é que
 * ela não mexeu em nada.
 */
export function montarRadar(
  periodos: string[],
  unidades: UnidadeDoRadar[],
  periodicidade: string | null,
): LinhaDoRadar[] {
  const linhas = unidades.map((unidade) => {
    const movimentosPorPeriodo = new Map<string, { changes: number; impacto: number; semApuracao: number }>();
    const rotulos = new Map<string, string>();
    const semComparacao = new Set<string>();

    for (const movimentos of unidade.movimentos) {
      for (const movimento of movimentos?.movements ?? []) {
        rotulos.set(movimento.period, movimento.label);
        const acumulado = movimentosPorPeriodo.get(movimento.period) ?? {
          changes: 0,
          impacto: 0,
          semApuracao: 0,
        };
        acumulado.changes += movimento.changes;
        acumulado.impacto +=
          periodicidade === null ? 0 : (movimento.impact.byPeriodicity[periodicidade] ?? 0);
        acumulado.semApuracao += movimento.impact.notCalculable;
        movimentosPorPeriodo.set(movimento.period, acumulado);
      }
      for (const lacuna of movimentos?.gaps ?? []) {
        rotulos.set(lacuna.period, lacuna.label);
        semComparacao.add(lacuna.period);
      }
    }

    /*
      Unidade que ainda não respondeu (ou que falhou) não tem célula apurada
      nenhuma — a linha inteira sai no estado dela. Sem este desvio, o `map`
      abaixo cairia em `sem-vigencia` para toda coluna, que é o desenho de
      "esta unidade não entregou nada nesta competência": a afirmação mais
      forte que a grade sabe fazer, feita sobre uma leitura que não aconteceu.
    */
    if (unidade.estado !== "pronta") {
      // O estado sai para uma constante porque o `map` abaixo é um fechamento:
      // dentro dele o TypeScript já não sabe que `unidade.estado` foi
      // estreitado por este `if`, e voltaria a ser o tipo inteiro.
      const estado: Extract<EstadoDaCelula, "pendente" | "erro"> = unidade.estado;
      const celulas: CelulaDoRadar[] = periodos.map((periodo) => ({
        periodo,
        label: rotulos.get(periodo) ?? periodo,
        estado,
        alteracoes: 0,
        impacto: 0,
        semApuracao: 0,
      }));
      return {
        unidade: unidade.unidade,
        label: unidade.label,
        contextos: unidade.contextos,
        celulas,
        totalDeAlteracoes: 0,
        totalDeImpacto: 0,
        totalSemApuracao: 0,
        estado,
        tentativas: unidade.tentativas,
      };
    }

    const celulas: CelulaDoRadar[] = periodos.map((periodo) => {
      const apurado = movimentosPorPeriodo.get(periodo);
      if (apurado) {
        return {
          periodo,
          label: rotulos.get(periodo) ?? periodo,
          estado: "apurado" as const,
          alteracoes: apurado.changes,
          impacto: apurado.impacto,
          semApuracao: apurado.semApuracao,
        };
      }
      return {
        periodo,
        label: rotulos.get(periodo) ?? periodo,
        estado: semComparacao.has(periodo) ? ("sem-comparacao" as const) : ("sem-vigencia" as const),
        alteracoes: 0,
        impacto: 0,
        semApuracao: 0,
      };
    });

    return {
      unidade: unidade.unidade,
      label: unidade.label,
      contextos: unidade.contextos,
      celulas,
      totalDeAlteracoes: celulas.reduce((soma, c) => soma + c.alteracoes, 0),
      totalDeImpacto: celulas.reduce((soma, c) => soma + c.impacto, 0),
      totalSemApuracao: celulas.reduce((soma, c) => soma + c.semApuracao, 0),
      estado: "pronta" as const,
      tentativas: unidade.tentativas,
    };
  });

  /*
    Enquanto falta unidade, a grade fica em ordem de nome. O pódio só é montado
    quando ele existe.

    Isto começou como um problema de agitação — medido, a grade se reordenava 2
    a 3 vezes durante a carga, e cada resposta que chegava movia linhas debaixo
    de quem estava lendo. Mas o argumento que decidiu não é o incômodo: é que
    **um pódio com unidades faltando não é um pódio.** Ordenar por impacto com
    três das cinco lidas ranqueia por quem respondeu primeiro, e apresenta esse
    acaso com a mesma autoridade visual da ordem final. É a mesma família do
    zero falso que a Parte V tirou da célula: um número (aqui, uma posição) que
    parece resposta e é artefato de carregamento.

    Em ordem de nome nada disso é afirmado, a ordem é previsível para quem
    procura uma unidade, e a grade se reordena **uma vez só** — no momento em
    que a faixa "N de M unidades carregadas" some, que é o aviso de que agora há
    pódio.

    Com todas prontas esta função devolve **exatamente** o que devolvia antes do
    progressivo: o mesmo comparador de sempre, sobre as mesmas linhas.
  */
  const porImpacto = (a: LinhaDoRadar, b: LinhaDoRadar) =>
    Math.abs(b.totalDeImpacto) - Math.abs(a.totalDeImpacto) ||
    b.totalDeAlteracoes - a.totalDeAlteracoes ||
    a.label.localeCompare(b.label);
  const porNome = (a: LinhaDoRadar, b: LinhaDoRadar) => a.label.localeCompare(b.label);

  const parcial = linhas.some((l) => l.estado !== "pronta");
  return [...linhas].sort(parcial ? porNome : porImpacto);
}

export interface ResumoDoRadar {
  alteracoes: number;
  /** Unidades com ao menos uma alteração na janela — não o tamanho da grade. */
  unidadesAfetadas: number;
  impacto: number;
  semApuracao: number;
  /** Quantas unidades da grade já responderam. */
  unidadesProntas: number;
  /** Quantas ainda estão em voo. */
  unidadesPendentes: number;
  /** Quantas falharam — não vão chegar sozinhas, e não entram na soma. */
  unidadesComErro: number;
  /** O tamanho da grade: prontas + pendentes + com erro. */
  unidades: number;
  /**
   * `true` enquanto faltar alguma unidade.
   *
   * É o campo que obriga a tela a dizer que o número ainda vai mudar. Os quatro
   * números acima continuam sendo a soma do que já chegou — o que não se pode
   * é apresentá-los como fechados enquanto isto for `true`.
   */
  parcial: boolean;
}

/**
 * Os quatro números do topo, somados da mesma grade que a tabela desenha — mais
 * quanto da grade eles cobrem.
 *
 * Somar só as linhas prontas não é uma escolha de conveniência: uma linha
 * pendente tem totais `0` (ver `montarRadar`), então incluí-la ou não dá o
 * mesmo número. O que muda é `parcial`, e é ele que separa "R$ 25 mil" de
 * "R$ 25 mil até agora".
 */
export function resumoDoRadar(linhas: LinhaDoRadar[]): ResumoDoRadar {
  const prontas = linhas.filter((l) => l.estado === "pronta");
  const pendentes = linhas.filter((l) => l.estado === "pendente").length;
  const comErro = linhas.filter((l) => l.estado === "erro").length;
  return {
    alteracoes: prontas.reduce((soma, l) => soma + l.totalDeAlteracoes, 0),
    unidadesAfetadas: prontas.filter((l) => l.totalDeAlteracoes > 0).length,
    impacto: prontas.reduce((soma, l) => soma + l.totalDeImpacto, 0),
    semApuracao: prontas.reduce((soma, l) => soma + l.totalSemApuracao, 0),
    unidadesProntas: prontas.length,
    unidadesPendentes: pendentes,
    unidadesComErro: comErro,
    unidades: linhas.length,
    parcial: pendentes > 0 || comErro > 0,
  };
}

/**
 * A intensidade da célula, de 0 a 1 — quanto ela pesa contra a mais pesada da
 * grade.
 *
 * O telão é lido a metros de distância, onde o número não se lê e a cor sim.
 * A régua é o **módulo do impacto**, não a contagem de alterações: cinquenta
 * alterações de centavos não podem gritar mais alto que uma que custou o mês.
 * Sem nenhum impacto apurado na grade, tudo fica no piso — pintar por contagem
 * ali seria trocar a régua no meio da leitura, sem avisar.
 */
export function intensidadeDaCelula(impacto: number, maiorDaGrade: number): number {
  if (maiorDaGrade <= 0) return 0;
  return Math.min(1, Math.abs(impacto) / maiorDaGrade);
}

/** O maior módulo de impacto de uma célula da grade — a referência da escala. */
export function maiorImpactoDaGrade(linhas: LinhaDoRadar[]): number {
  return linhas.reduce(
    (maior, linha) =>
      linha.celulas.reduce((m, celula) => Math.max(m, Math.abs(celula.impacto)), maior),
    0,
  );
}

// ---------------------------------------------------------------------------
// A abertura de uma célula
// ---------------------------------------------------------------------------

/**
 * Um atributo dentro de uma célula — o degrau entre "esta unidade perdeu
 * R$ 32,6 mil em agosto" e a Planilha de alterações.
 *
 * `alteracoes` conta **tudo** o que aquele parâmetro mexeu na vigência;
 * `impacto` soma só o que foi apurado na periodicidade que a grade está
 * desenhando. Os dois números não se derivam um do outro de propósito: é o que
 * impede a linha de parecer calma quando as dez alterações dela estão em
 * `semApuracao`, ou de parecer apurada quando o dinheiro dela é anual e a
 * grade está em mensal.
 */
export interface AtributoDaCelula {
  parameterKey: string;
  parameterName: string;
  familia: string;
  attributeCode: string | null;
  alteracoes: number;
  /** Na periodicidade da grade. `0` quando nada ali foi apurado nela. */
  impacto: number;
  /** Alterações do parâmetro que a comparação viu e não conseguiu precificar. */
  semApuracao: number;
  /** Alterações precificadas em **outra** periodicidade — dinheiro que existe e não está nesta grade. */
  outraPeriodicidade: number;
}

export interface AberturaDaCelula {
  /** Atributos que empurraram o número para cima, o maior primeiro. */
  favoraveis: AtributoDaCelula[];
  /** Atributos que empurraram o número para baixo, o maior primeiro. */
  desfavoraveis: AtributoDaCelula[];
  /** Mexeu e não moveu dinheiro nesta grade — sem preço, ou preço em outra periodicidade. */
  semDinheiro: AtributoDaCelula[];
  /** A soma dos atributos apurados, para conferir contra a célula da grade. */
  impacto: number;
}

/**
 * Os atributos por trás de uma célula, separados por lado do impacto.
 *
 * As entradas chegam **já recortadas na vigência**, de `/changes/radar?period=`,
 * pedidas quando a célula é aberta.
 *
 * Antes elas vinham de graça: `entries` viajava na resposta que desenhava a
 * grade. "De graça" custava 517 KB por unidade para desenhar 45 células, e a
 * gaveta é aberta em uma delas, às vezes. O recorte por vigência mudou de lugar
 * — saiu daqui e foi para o servidor —, e o agrupamento por parâmetro, que é a
 * régua de leitura, ficou.
 *
 * A unidade entra inteira: quem chama passa as entradas dos dois canais de uma
 * linha somada concatenadas, porque a célula que foi clicada é a soma deles.
 *
 * **Três lados, não dois.** Favorável e desfavorável são o que o clique
 * pergunta; o terceiro grupo existe porque a alternativa a mostrá-lo era
 * escondê-lo, e um parâmetro que mexeu trinta veículos sem preço apurado
 * sumindo da abertura faria a soma dos itens não bater com a contagem de
 * alterações da célula — que é exatamente a pergunta que a tela deve
 * aguentar responder.
 */
export function atributosDaCelula(
  entradas: EntradaDaCelula[],
  periodicidade: string | null,
): AberturaDaCelula {
  const porParametro = new Map<string, AtributoDaCelula>();

  for (const entrada of entradas) {
    const atual = porParametro.get(entrada.parameterKey) ?? {
      parameterKey: entrada.parameterKey,
      parameterName: entrada.parameterName,
      familia: entrada.family,
      attributeCode: entrada.attributeCode,
      alteracoes: 0,
      impacto: 0,
      semApuracao: 0,
      outraPeriodicidade: 0,
    };

    atual.alteracoes += 1;
    if (entrada.amount === null) atual.semApuracao += 1;
    else if (periodicidade !== null && entrada.periodicity === periodicidade)
      atual.impacto += entrada.amount;
    else atual.outraPeriodicidade += 1;

    porParametro.set(entrada.parameterKey, atual);
  }

  const ordenar = (a: AtributoDaCelula, b: AtributoDaCelula) =>
    Math.abs(b.impacto) - Math.abs(a.impacto) ||
    b.alteracoes - a.alteracoes ||
    a.parameterName.localeCompare(b.parameterName);

  const atributos = [...porParametro.values()];
  return {
    favoraveis: atributos.filter((a) => a.impacto > 0).sort(ordenar),
    desfavoraveis: atributos.filter((a) => a.impacto < 0).sort(ordenar),
    semDinheiro: atributos.filter((a) => a.impacto === 0).sort(ordenar),
    impacto: atributos.reduce((soma, a) => soma + a.impacto, 0),
  };
}
