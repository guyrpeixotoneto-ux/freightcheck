/**
 * O vocabulário da cobertura, num lugar só.
 *
 * Este arquivo não consulta banco e não decide nada. Ele existe porque a
 * cobertura tem seis estados, três criticidades e quatro origens de
 * expectativa, e cada um deles significa uma coisa diferente para quem lê a
 * tela. Espalhar essas palavras por consultas, rotas e componentes é como a
 * cobertura antiga acabou tendo uma definição só — `medirCobertura` dentro de
 * `pages/dados.tsx` — e nenhuma que o servidor pudesse repetir.
 *
 * **A distinção que sustenta tudo o que vem depois.** Ausência, nulo, zero e
 * não aplicável são quatro coisas, e o banco já as separa:
 *
 * - **presente** — existe `fact` com `is_null = false`. Pode valer zero: zero é
 *   um valor econômico, não uma ausência.
 * - **vazio** — existe `fact` com `is_null = true` e um `null_reason`. O
 *   arquivo trouxe a coluna e não trouxe o número para aquela entidade.
 * - **não aplicável** — o mesmo, com `null_reason = 'NOT_APPLICABLE'`, ou uma
 *   dispensa registrada em `coverage_expectation`. Não conta como lacuna e não
 *   reduz cobertura.
 * - **ausente** — não existe `fact` nenhum. A coluna não veio para aquela
 *   entidade, ou não veio de todo.
 */

/**
 * Como está a cobertura de um recorte.
 *
 * Os seis são excludentes e a ordem abaixo é a de gravidade que a tela usa para
 * ordenar. `NOVO` e `ALTERADO` não são graus de completude — são avisos sobre o
 * universo ter mudado —, e por isso vêm depois dos três primeiros.
 */
export type EstadoDeCobertura =
  /** Tudo o que era esperado está presente. */
  | "COMPLETO"
  /** A família existe; faltam atributos, entidades ou valores. */
  | "PARCIAL"
  /** Nada do que era esperado chegou neste recorte. */
  | "AUSENTE"
  /** Apareceu o que não fazia parte do universo conhecido. */
  | "NOVO"
  /** Há evidência forte de que um campo conhecido mudou de nome ou de forma. */
  | "ALTERADO"
  /** A ausência é legítima aqui, por decisão registrada ou por natureza. */
  | "NAO_APLICAVEL";

export const ORDEM_DO_ESTADO: Record<EstadoDeCobertura, number> = {
  AUSENTE: 0,
  ALTERADO: 1,
  PARCIAL: 2,
  NOVO: 3,
  COMPLETO: 4,
  NAO_APLICAVEL: 5,
};

/** O rótulo que a tela escreve. Nunca só a cor — ver o comentário em `matriz`. */
export const ROTULO_DO_ESTADO: Record<EstadoDeCobertura, string> = {
  COMPLETO: "Completo",
  PARCIAL: "Parcial",
  AUSENTE: "Ausente",
  NOVO: "Novo",
  ALTERADO: "Alterado",
  NAO_APLICAVEL: "Não aplicável",
};

/**
 * Quanto uma lacuna machuca.
 *
 * `CRITICO` não é "importante": é **compromete uma análise que o FreightCheck
 * publica**. A lista de quem é crítico não é escrita aqui nem em nenhum
 * componente — ela vem do plano da DRE, onde cada componente já declara as suas
 * `fontes` e se é `essencial`, com a medição que sustenta a declaração escrita
 * ao lado. Ver `contrato.ts`.
 */
export type Criticidade = "CRITICO" | "RELEVANTE" | "INFORMATIVO";

export const ORDEM_DA_CRITICIDADE: Record<Criticidade, number> = {
  CRITICO: 0,
  RELEVANTE: 1,
  INFORMATIVO: 2,
};

/**
 * De onde vem a afirmação "isto deveria existir".
 *
 * A separação entre as três primeiras e as duas últimas é a regra que este
 * módulo mais protege: **contrato, catálogo e curadoria são declaração;
 * histórico e estrutura são inferência.** As três primeiras viram linha em
 * `coverage_expectation`; as duas últimas são recalculadas a cada leitura e
 * chegam à tela dizendo que são inferência. Nada promove uma na outra sem uma
 * pessoa clicar.
 */
export type OrigemDoEsperado =
  /** O sistema sabe formalmente, com evidência medida. Hoje: o plano da DRE. */
  | "CONTRATO"
  /**
   * O catálogo declarado — as três planilhas de curadoria, em
   * `@workspace/curation/catalogo-declarado`.
   *
   * É declaração como o contrato, e está separada dele por uma razão que a tela
   * precisa poder dizer: o contrato cita a linha da DRE que o atributo alimenta
   * e a contagem que sustenta a citação; o catálogo afirma, mais simplesmente,
   * que a fonte deveria mandar aquela coluna. As duas são afirmações humanas —
   * nenhuma é estatística —, mas a primeira carrega evidência e a segunda
   * carrega autoridade, e quem lê uma lacuna merece saber qual das duas a criou.
   */
  | "CATALOGO"
  /** Uma pessoa decidiu, com nome e motivo. */
  | "CURADORIA"
  /** O atributo veio nas vigências anteriores para estas entidades. */
  | "HISTORICO"
  /** O atributo veio para quase todas as entidades desta mesma vigência. */
  | "ESTRUTURA";

/** Declaração ou inferência — a pergunta que a tela precisa responder sempre. */
export function ehDeclarado(origem: OrigemDoEsperado): boolean {
  return origem === "CONTRATO" || origem === "CATALOGO" || origem === "CURADORIA";
}

/**
 * Por que o FreightCheck acha que isto deveria existir.
 *
 * `motivo` é uma frase pronta, escrita para quem opera; `medicao` são os
 * números que a sustentam, para quem quiser conferir. As duas juntas são o que
 * substitui um percentual misterioso — e o motivo é obrigatório: uma
 * expectativa sem explicação é um palpite com aparência de regra.
 */
export interface Justificativa {
  origem: OrigemDoEsperado;
  declarado: boolean;
  motivo: string;
  medicao: Record<string, number | string | null>;
}

/** Um atributo esperado num recorte, com a razão de sê-lo. */
export interface Esperado {
  attributeCode: string;
  entityType: string;
  criticidade: Criticidade;
  justificativa: Justificativa;
  /**
   * Quantas entidades daquele tipo deveriam ter este atributo.
   *
   * Igual ao total de entidades do tipo na vigência, salvo quando o esperado é
   * inferido de um subconjunto — o caso do atributo que sempre veio para 60 dos
   * 64 cavalos, em que esperar 64 inventaria quatro lacunas.
   */
  entidadesEsperadas: number;
}

/** O que uma vigência de fato entregou, para um atributo. */
export interface Observado {
  attributeCode: string;
  entityType: string;
  /** Entidades com `fact.is_null = false`. */
  comValor: number;
  /** Entidades com `fact.is_null = true`. */
  vazias: number;
  /** Destas, as que declaram NOT_APPLICABLE. Não são lacuna. */
  naoAplicaveis: number;
  /** A coluna veio no layout desta vigência? */
  noLayout: boolean;
}

/**
 * Uma lacuna: a diferença entre o esperado e o observado, já classificada.
 *
 * Note que `entidadesFaltando` conta entidades, não fatos. Uma coluna que não
 * veio para nenhuma das 144 entidades é uma lacuna de 144, e não 144 lacunas —
 * a tela mostra exceções, não despeja linhas.
 */
export interface Lacuna {
  attributeCode: string;
  attributeLabel: string;
  entityType: string;
  estado: EstadoDeCobertura;
  criticidade: Criticidade;
  entidadesEsperadas: number;
  entidadesPresentes: number;
  entidadesFaltando: number;
  justificativa: Justificativa;
  /** Preenchido quando existe candidato a renomeação. Ver `descoberta.ts`. */
  possivelSucessor: { attributeCode: string; confianca: number } | null;
}

/** A conta de cobertura de um recorte qualquer, do resumo à célula. */
export interface Contagem {
  entidadesEsperadas: number;
  entidadesEncontradas: number;
  atributosEsperados: number;
  atributosEncontrados: number;
  /** Entidades × atributos. É o denominador honesto de "quanto temos". */
  combinacoesEsperadas: number;
  combinacoesEncontradas: number;
  /** Combinações que não contam em nenhum dos dois lados, por dispensa. */
  combinacoesNaoAplicaveis: number;
  /** `combinacoesEncontradas / combinacoesEsperadas`, em pontos percentuais. */
  percentual: number;
}

/**
 * A conta, feita do mesmo jeito em toda parte.
 *
 * Existe uma função só porque existir duas é como o produto acaba com dois
 * números diferentes para a mesma pergunta em duas telas. O denominador exclui
 * o não aplicável dos dois lados: contá-lo como esperado faria uma dispensa
 * legítima derrubar a cobertura, que é o oposto do que dispensar significa.
 */
export function contar(entrada: {
  entidadesEsperadas: number;
  entidadesEncontradas: number;
  atributosEsperados: number;
  atributosEncontrados: number;
  combinacoesEsperadas: number;
  combinacoesEncontradas: number;
  combinacoesNaoAplicaveis: number;
}): Contagem {
  const denominador = Math.max(
    0,
    entrada.combinacoesEsperadas - entrada.combinacoesNaoAplicaveis,
  );
  return {
    ...entrada,
    percentual:
      denominador === 0
        ? 100
        : Number(((entrada.combinacoesEncontradas / denominador) * 100).toFixed(1)),
  };
}

/**
 * O estado de um recorte, a partir da sua conta e das suas lacunas.
 *
 * A ordem das perguntas é a ordem da gravidade, e a primeira delas é a que a
 * cobertura antiga não fazia: **nada chegou** é diferente de **chegou pela
 * metade**, e mostrar 0% num lugar onde a resposta é "esta família não existe
 * nesta vigência" manda procurar o que não sumiu.
 */
export function classificar(
  conta: Contagem,
  sinais: { temNovo: boolean; temAlterado: boolean; tudoDispensado: boolean },
): EstadoDeCobertura {
  /*
    Sem nada esperado não há cobertura a medir — nem mesmo NOVO.

    "Novo" quer dizer *fora do universo conhecido*, e na primeira vigência de um
    escopo não existe universo conhecido: tudo estaria fora dele. Marcar a
    célula inteira como NOVO ali é verdadeiro e inútil, e treina quem lê a
    ignorar a cor justamente quando ela passar a significar alguma coisa. Os
    atributos continuam contados em `novos` e listados em Descobertas; o que não
    acontece é a célula mudar de estado por causa deles.
  */
  if (conta.combinacoesEsperadas === 0) return "NAO_APLICAVEL";
  if (sinais.tudoDispensado) return "NAO_APLICAVEL";
  if (conta.combinacoesEncontradas === 0 && conta.combinacoesEsperadas > 0) {
    return "AUSENTE";
  }
  if (sinais.temAlterado) return "ALTERADO";
  if (conta.percentual < 100) return "PARCIAL";
  if (sinais.temNovo) return "NOVO";
  return "COMPLETO";
}

/**
 * A conta de **um** atributo, numa vigência — o átomo de que a célula é feita.
 *
 * `medirCelula` somava isto em linha, dentro do laço, e por isso a única forma
 * de saber "como está o `cavalo.seguro` em Jun/26" era refazer a aritmética num
 * segundo lugar. Um segundo lugar é como um produto acaba dizendo 88,1% na
 * matriz e listando um atributo completo que a matriz conta como lacuna: os
 * dois números estariam certos nos seus próprios termos, e a tela estaria
 * mentindo em um deles.
 *
 * A função é pura e serve os dois: a célula soma o que ela devolve, e a matriz
 * de atributos mostra o que ela devolve, atributo a atributo. Uma definição só.
 *
 * **O que cada entrada ausente significa** — e as três são casos reais:
 *
 * - sem `esperado` — ninguém cobra este atributo aqui. Ele pode ter chegado
 *   assim mesmo (o caso do que veio para toda a frota e por isso nem entra na
 *   inferência estrutural, ver `esperado.ts`), e chegar sem ser cobrado não é
 *   defeito nenhum.
 * - sem `observado` — a coluna não veio no layout desta vigência. Diferente de
 *   ter vindo e não trazer valor, que é `vazias`.
 * - `dispensado` — há decisão humana registrada. Sai dos dois lados da fração,
 *   que é o que dispensar quer dizer.
 */
export interface MedidaDoAtributo {
  /** Quantas entidades deveriam ter o dado. Nunca menor do que as que têm. */
  entidadesEsperadas: number;
  /** Entidades com valor de verdade. Zero é valor; ausência não é. */
  entidadesPresentes: number;
  /** Entidades para as quais a coluna veio e não trouxe número. */
  entidadesVazias: number;
  /** Destas, as que declaram NOT_APPLICABLE. Não são lacuna. */
  naoAplicaveis: number;
  /** `esperadas - presentes - naoAplicaveis`, nunca negativo. */
  entidadesFaltando: number;
  /** `presentes / (esperadas - naoAplicaveis)`, em pontos percentuais. */
  percentual: number;
  estado: EstadoDeCobertura;
  /** Alguma origem cobra este atributo nesta vigência? */
  esperado: boolean;
  /** A coluna veio no layout desta vigência? */
  noLayout: boolean;
  dispensado: boolean;
  /** O atributo estreou nesta vigência? Vem de `descobertas`, nunca daqui. */
  novo: boolean;
}

export function medirAtributo(entrada: {
  esperado?: Pick<Esperado, "entidadesEsperadas"> | undefined;
  observado?:
    | Pick<Observado, "comValor" | "vazias" | "naoAplicaveis" | "noLayout">
    | undefined;
  dispensado?: boolean;
  novo?: boolean;
}): MedidaDoAtributo {
  const presentes = entrada.observado?.comValor ?? 0;
  const vazias = entrada.observado?.vazias ?? 0;
  const naoAplicaveis = entrada.observado?.naoAplicaveis ?? 0;
  const dispensado = entrada.dispensado ?? false;
  const novo = entrada.novo ?? false;

  /*
    A expectativa sobe quando a realidade a supera, e nunca desce.

    O esperado inferido do histórico é um **piso**: "veio para 100 carretas nas
    vigências anteriores". Se a vigência de hoje traz 144, não faltou nada — o
    universo cresceu. Sem este `max`, o numerador passava o denominador e a
    célula exibia 144% de cobertura, que é o tipo de número que faz o leitor
    deixar de acreditar na tela inteira.

    Uma dispensa zera o esperado em vez de somá-lo: uma decisão humana de não
    cobrar não pode virar cobrança porque o dado chegou assim mesmo.
  */
  const entidadesEsperadas = dispensado
    ? presentes + naoAplicaveis
    : Math.max(entrada.esperado?.entidadesEsperadas ?? 0, presentes + naoAplicaveis);

  /*
    A conta e a classificação são as mesmas de qualquer outro recorte — `contar`
    e `classificar`, sem cópia. Aqui as "combinações" são entidades, porque o
    recorte é um atributo só: entidades × 1 atributo.
  */
  const conta = contar({
    entidadesEsperadas,
    entidadesEncontradas: presentes,
    atributosEsperados: entrada.esperado || dispensado ? 1 : 0,
    atributosEncontrados: presentes > 0 ? 1 : 0,
    combinacoesEsperadas: entidadesEsperadas,
    combinacoesEncontradas: presentes,
    combinacoesNaoAplicaveis: naoAplicaveis,
  });

  return {
    entidadesEsperadas,
    entidadesPresentes: presentes,
    entidadesVazias: vazias,
    naoAplicaveis,
    entidadesFaltando: Math.max(0, entidadesEsperadas - presentes - naoAplicaveis),
    percentual: conta.percentual,
    estado: classificar(conta, {
      temNovo: novo,
      temAlterado: false,
      tudoDispensado: dispensado,
    }),
    esperado: entrada.esperado !== undefined && !dispensado,
    noLayout: entrada.observado?.noLayout ?? false,
    dispensado,
    novo,
  };
}
