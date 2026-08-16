/**
 * A autoridade sobre agregação — quem responde "posso somar isto?".
 *
 * Antes deste arquivo a pergunta não tinha dono. `aggregation` era um campo, e
 * cada módulo compunha à mão a expressão que o transformava em permissão: seis
 * lugares, cinco respostas diferentes. A auditoria de 16/08/2026 mediu a
 * divergência — o cockpit somava com `aggregation === 'SUM'` e mais nada, o
 * impacto exigia CONFIRMED + monetário + SUM, a composição acrescentava a base
 * ausente e a gaveta — e nenhum deles importava a decisão do outro.
 *
 * **São duas perguntas, e confundi-las é o erro que este módulo evita.**
 *
 * - {@link podeSomar} é aritmética: a soma entre ativos *significa* alguma
 *   coisa? Depende do tipo e da unidade, e não de alguém ter confirmado.
 * - {@link viraDinheiro} é financeira: isto entra num total que alguém vai
 *   auditar? Exige, além da aritmética, a confirmação humana.
 *
 * O cockpit precisa da primeira (soma o arquivo para mostrar o que mudou, com
 * tarja quando a semântica é só proposta); o impacto, o panorama e a composição
 * precisam da segunda. Unificar as duas numa só faria o cockpit perder os
 * totais de tudo que ainda não foi confirmado — ou faria dinheiro presumido
 * vazar para a apuração. As duas continuam existindo; o que deixou de existir é
 * cada módulo escrever a sua.
 *
 * Uma regra é nova aqui, e é o motivo de a autoridade não ser uma cópia
 * mecânica do que havia: **uma razão não soma nem que o campo diga SUM.** A
 * auditoria provou que o banco aceita `KM_L + SUM + is_monetary`, e enquanto a
 * constraint não existe, este arquivo é o que impede que um km/l vire reais.
 */

/**
 * O que a autoridade precisa saber sobre um atributo.
 *
 * Campos soltos, e não a linha inteira do banco, porque quem pergunta tem o
 * atributo em cinco formatos diferentes — `AttributeClassification`, linha crua
 * de `db.execute`, projeção de versão. Todos têm estes cinco campos, e nenhum
 * precisa converter nada para perguntar.
 */
export interface SemanticaDoAtributo {
  unit: string | null;
  aggregation: string | null;
  isMonetary: boolean | null;
  semanticsStatus: string | null;
  /** Opcional: quem não tem o tipo à mão continua protegido pela unidade. */
  dataType?: string | null;
  periodicity?: string | null;
}

/**
 * Uma resposta com o porquê junto.
 *
 * O motivo não é decoração: as telas já escreviam essas frases à mão, cada uma
 * com a sua redação, e é assim que "não é somável" virava seis textos para o
 * mesmo fato.
 */
export interface Veredito {
  ok: boolean;
  /** Frase pronta para a tela. Vazia quando `ok`. */
  motivo: string;
}

const SIM: Veredito = { ok: true, motivo: "" };
const nao = (motivo: string): Veredito => ({ ok: false, motivo });

/**
 * Unidades que são razão entre duas grandezas.
 *
 * Somar km/l de 62 cavalos dá um número sem referente, e a média simples deles
 * também não é o km/l da frota — essa é `Σkm / Σlitros`, e o denominador não
 * vem neste export.
 */
const RAZOES = new Set(["KM_L", "BRL_KM", "PERCENT"]);

/**
 * Tipos que não admitem aritmética nenhuma.
 *
 * `UNKNOWN` está na lista, e o `guessAggregation` que não o incluía propôs
 * "média simples" para `prazoPagamento` — uma coluna sem tipo e sem uma única
 * linha preenchida.
 */
const TIPOS_NAO_NUMERICOS = new Set(["TEXT", "BOOLEAN", "DATE", "MIXED", "UNKNOWN"]);

/**
 * A base que faltaria para transformar uma razão em dinheiro.
 *
 * `Custo Variável Simulado = 3,66 R$/km` é o caso: o número existe, a unidade
 * existe, e o impacto financeiro não existe porque a quilometragem do período
 * não vem neste export. Dizer *o que destravaria* é mais útil do que dizer que
 * não dá — é uma pergunta para a Ambev, e não um beco sem saída.
 *
 * Mora aqui, e não em `@workspace/composition`, porque a pergunta é sobre a
 * semântica do atributo e não sobre a composição da remuneração: a curadoria e
 * o cockpit querem a mesma frase.
 */
export const BASE_QUE_FALTA: Record<string, string> = {
  BRL_KM: "quilometragem rodada por ativo no período",
  KM_L: "quilometragem rodada e preço do litro no período",
  PERCENT: "o montante sobre o qual o percentual incide",
};

/**
 * O que faltaria para este atributo virar dinheiro, quando o que falta é dado.
 *
 * `null` quando a unidade não é razão — aí o que falta não é dado da fonte.
 */
export function baseQueFalta(attr: SemanticaDoAtributo): string | null {
  return attr.unit ? (BASE_QUE_FALTA[attr.unit] ?? null) : null;
}

/**
 * A soma entre ativos significa alguma coisa?
 *
 * Aritmética pura: não pergunta se alguém confirmou, porque somar uma coluna
 * para mostrar o que mudou no arquivo é leitura legítima mesmo sobre semântica
 * presumida — o que não é legítimo é chamar isso de dinheiro apurado, e essa é
 * a outra pergunta.
 */
export function podeSomar(attr: SemanticaDoAtributo): Veredito {
  if (attr.dataType && TIPOS_NAO_NUMERICOS.has(attr.dataType)) {
    return nao(`Valor ${attr.dataType === "TEXT" ? "textual" : "não numérico"} — não há o que somar.`);
  }
  if (attr.unit && RAZOES.has(attr.unit)) {
    const base = BASE_QUE_FALTA[attr.unit];
    return nao(
      `${attr.unit} é uma razão: somar entre ativos não produz grandeza nenhuma. ` +
        `O total da frota exigiria ${base}.`,
    );
  }
  if (attr.aggregation !== "SUM") {
    return nao(
      `Agregação "${attr.aggregation ?? "indefinida"}": o atributo não é somável, ` +
        `então a variação por ativo não se acumula em um total.`,
    );
  }
  return SIM;
}

/** Como uma média pode ser tirada, quando pode. */
export interface VereditoDeMedia extends Veredito {
  tipo?: "SIMPLES";
}

/**
 * A média por ativo é leitura legítima?
 *
 * `WEIGHTED_AVG` é recusado de propósito. O enum oferece o valor, a tela o
 * lista, e o cálculo que existe é `total ÷ veículos` — média simples com nome
 * de ponderada. Enquanto o peso não for um campo do modelo, prometer ponderação
 * e entregar média simples é pior do que recusar: o número sairia errado sem
 * que ninguém tivesse como perceber.
 */
export function podeTirarMedia(attr: SemanticaDoAtributo): VereditoDeMedia {
  if (attr.dataType && TIPOS_NAO_NUMERICOS.has(attr.dataType)) {
    return nao("Valor não numérico — não há média a tirar.");
  }
  if (attr.unit && RAZOES.has(attr.unit)) {
    return nao(
      `${attr.unit} é uma razão: a média das razões de cada ativo não é a razão da frota. ` +
        `A leitura correta exigiria ${BASE_QUE_FALTA[attr.unit]}.`,
    );
  }
  if (attr.aggregation === "WEIGHTED_AVG") {
    return nao(
      "Média ponderada não está implementada: o peso não é um campo do modelo, e o " +
        "cálculo disponível é a média simples. Publicá-la como ponderada seria simular a ponderação.",
    );
  }
  if (attr.aggregation === "SUM" || attr.aggregation === "AVG") {
    return { ok: true, motivo: "", tipo: "SIMPLES" };
  }
  return nao(
    `Agregação "${attr.aggregation ?? "indefinida"}": este atributo não admite soma nem média.`,
  );
}

/**
 * Isto entra num total que alguém vai auditar?
 *
 * A ordem das perguntas é a que explica melhor, e é a mesma que `impact.ts`
 * usava: primeiro a confirmação — porque mandar o curador confirmar é a ação
 * que destrava —, depois a natureza monetária, e só então a aritmética.
 */
export function viraDinheiro(attr: SemanticaDoAtributo): Veredito {
  if (attr.semanticsStatus !== "CONFIRMED") {
    return nao(
      `Semântica ${attr.semanticsStatus === "PRESUMED" ? "presumida" : "desconhecida"}: ` +
        `o atributo ainda não foi confirmado na curadoria, então somar sua variação seria adivinhação.`,
    );
  }
  if (attr.isMonetary !== true) {
    return nao("Não é um montante financeiro — a variação existe, mas não vira dinheiro por si só.");
  }
  return podeSomar(attr);
}
