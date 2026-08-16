/**
 * O vocabulário da disponibilidade.
 *
 * Este arquivo não consulta nada. Ele existe para que as palavras que o produto
 * usa para dizer "esse dado existe?" tenham **um** significado, escrito num
 * lugar só — porque a auditoria mostrou que o defeito não estava nas consultas,
 * estava em cada módulo ter inventado a sua resposta para a mesma pergunta.
 */

/**
 * A chave de um contexto: uma unidade num canal.
 *
 * É o que a pessoa escolhe na tela. Opaca de propósito: o consumidor não a
 * remonta a partir de `scope_hash` nem de coisa nenhuma — ele a recebe da
 * autoridade e a devolve. Foi remontá-la por conta própria que partiu a mesma
 * unidade em duas quando o CNPJ chegou mascarado.
 */
export type ChaveDeContexto = string;

/**
 * A chave de uma série: o contexto mais a família do dataset.
 *
 * Série é o conjunto de vigências que **se sucedem**. Dentro dela a ordem é
 * `effective_date`, e o banco garante no máximo uma vigência disponível por
 * data — o índice `snapshot_canonical_live_uq` é único sobre a identidade
 * canônica, que inclui a data. É por isso que "a anterior" não precisa de
 * critério de desempate.
 */
export type ChaveDeSerie = string;

/** Uma entrada do escopo canônico, com o nome legível quando existe. */
export interface EscopoDaVigencia {
  scopeType: string;
  code: string;
  name: string | null;
}

/**
 * O que uma vigência entregou de um equipamento.
 *
 * Sai de `snapshot_entity_type`, que a promoção grava contando os fatos — não
 * de `entity_type_set`, que é rótulo e cresce com entrega parcial.
 */
export interface EquipamentoDaVigencia {
  entityType: string;
  entidades: number;
  atributos: number;
  fatos: number;
  comValor: number;
  vazios: number;
  herdados: number;
}

/** Uma vigência disponível: promovida, fechada, e não substituída. */
export interface VigenciaDisponivel {
  snapshotId: string;
  sourceLabel: string;
  effectiveDate: string;
  revision: number;
  importRunId: string;
  sourceSystem: string;
  datasetFamily: string;
  canal: string;
  serie: ChaveDeSerie;
  contexto: ChaveDeContexto;
  /** "CAMAÇARI · EMPURRADA" — o que a tela mostra. */
  rotulo: string;
  escopo: EscopoDaVigencia[];
  equipamentos: EquipamentoDaVigencia[];
  /** Contados na promoção. `fatos = 0` é possível em tese e nunca foi visto. */
  entidades: number;
  fatos: number;
}

/** Um contexto disponível: a unidade e o canal que já entregaram vigência. */
export interface ContextoDisponivel {
  chave: ChaveDeContexto;
  canal: string;
  escopo: EscopoDaVigencia[];
  rotulo: string;
  series: ChaveDeSerie[];
  periodos: number;
  primeiraVigencia: string;
  ultimaVigencia: string;
}

/** Uma série disponível, com as datas que ela cobre. */
export interface SerieDisponivel {
  chave: ChaveDeSerie;
  contexto: ChaveDeContexto;
  datasetFamily: string;
  canal: string;
  rotulo: string;
  /** As datas, em ordem. Buracos são visíveis: elas não são consecutivas. */
  periodos: string[];
}

/** O recorte de uma pergunta. Sem nenhum campo, a pergunta é sobre tudo. */
export interface Recorte {
  contexto?: ChaveDeContexto;
  serie?: ChaveDeSerie;
  datasetFamily?: string;
  entityType?: string;
  /** Exclusivo: usado para "o que existia antes desta data". */
  antesDe?: string;
}

// ---------------------------------------------------------------------------
// O veredito
// ---------------------------------------------------------------------------

/**
 * A resposta à única pergunta que importa: **esse dado existe?**
 *
 * Três estados, e a distinção entre os dois últimos é a razão de este módulo
 * existir. Um módulo que recebe `VAZIO_NO_RECORTE` e escreve "não há dados"
 * está mentindo, e agora ele tem como saber disso — porque a resposta **diz**
 * onde o dado está.
 *
 * O que este veredito deliberadamente não cobre é elegibilidade: "existe e não
 * se aplica a esta análise" é decisão do módulo, não da autoridade. Ela
 * responde pela existência; quem responde pelo significado é quem tem o
 * domínio. Ver `docs/AUDITORIA-COMPLEMENTO-BASELINE.md`, Parte F.
 */
export type VeredictoDeDisponibilidade =
  | { estado: "DISPONIVEL"; vigencias: VigenciaDisponivel[] }
  /** Não há vigência promovida no sistema inteiro. É o único "não há dados". */
  | { estado: "VAZIO_GLOBAL" }
  /** Há vigência no sistema, e nenhuma neste recorte. **Não** é "não há dados". */
  | {
      estado: "VAZIO_NO_RECORTE";
      /** Onde o dado está, para que a tela possa dizer. */
      existemEm: ContextoDisponivel[];
      /** A frase do porquê, escrita para quem opera. */
      motivo: string;
    };

/** Por que não há vigência anterior. `null` mudo é o que esta união substitui. */
export type MotivoSemAnterior =
  /** É a mais antiga da série. Estado legítimo, e não falta de dado. */
  | "PRIMEIRA_DA_SERIE"
  /** O identificador não corresponde a vigência disponível nenhuma. */
  | "VIGENCIA_DESCONHECIDA";

export type ResultadoDaAnterior =
  | { encontrada: true; vigencia: VigenciaDisponivel }
  | { encontrada: false; motivo: MotivoSemAnterior; frase: string };

// ---------------------------------------------------------------------------
// O valor de uma célula
// ---------------------------------------------------------------------------

/**
 * O que há na interseção de uma vigência, um ativo e um atributo.
 *
 * Cinco estados, e nenhum deles é o outro. Colapsá-los é o defeito mais caro
 * que este produto pode cometer, porque o resultado *parece* um número: uma
 * célula vazia somada como zero baixa a média da frota inteira e não deixa
 * rastro.
 */
export type EstadoDoValor =
  /** Há valor. */
  | "VALOR"
  /** Há valor, e ele é zero. Zero econômico — o ativo custa zero, não falta dado. */
  | "ZERO"
  /** O fato existe e declara ausência, com motivo (`EMPTY`, `VALUE_MISSING`, …). */
  | "NULO"
  /** A coluna não veio no layout desta vigência. Não é ausência do ativo. */
  | "NAO_ENTREGUE"
  /** A coluna veio, e este ativo não tem linha nela. */
  | "INEXISTENTE"
  /** O atributo não pertence a este equipamento. Não se aplica. */
  | "NAO_APLICAVEL";

export interface ValorClassificado {
  estado: EstadoDoValor;
  /** O número, e só quando há um. Nunca 0 no lugar de ausência. */
  valor: number | null;
  /** O motivo do banco (`null_reason`) ou a explicação do estado. */
  motivo: string | null;
}

/** O que a classificação precisa saber, sem depender de como foi lido. */
export interface EntradaDaClassificacao {
  /** O atributo pertence ao equipamento deste ativo? */
  atributoDoEquipamento: boolean;
  /** A vigência trouxe esta coluna no layout? */
  colunaNoLayout: boolean;
  /** O fato, quando existe. */
  fato: {
    isNull: boolean;
    nullReason: string | null;
    valueNumeric: string | null;
  } | null;
}

/**
 * A classificação, pura.
 *
 * A ordem das perguntas é o desenho, e ela vai do mais estrutural ao mais
 * particular: não se aplica vence não entregue, que vence não existe, que vence
 * o valor. Inverter a ordem faria um atributo de cavalo pedido para uma carreta
 * responder "esta vigência não trouxe a coluna" — verdadeiro e irrelevante.
 */
export function classificarValor(entrada: EntradaDaClassificacao): ValorClassificado {
  if (!entrada.atributoDoEquipamento) {
    return {
      estado: "NAO_APLICAVEL",
      valor: null,
      motivo: "O atributo não pertence a este equipamento.",
    };
  }
  if (!entrada.colunaNoLayout) {
    return {
      estado: "NAO_ENTREGUE",
      valor: null,
      motivo: "Esta vigência não trouxe a coluna.",
    };
  }
  if (entrada.fato === null) {
    return {
      estado: "INEXISTENTE",
      valor: null,
      motivo: "A coluna veio, e este ativo não tem linha nela.",
    };
  }
  if (entrada.fato.isNull) {
    return {
      estado: "NULO",
      valor: null,
      motivo: entrada.fato.nullReason,
    };
  }
  const numero =
    entrada.fato.valueNumeric === null ? null : Number(entrada.fato.valueNumeric);
  if (numero !== null && numero === 0) {
    return { estado: "ZERO", valor: 0, motivo: null };
  }
  return { estado: "VALOR", valor: numero, motivo: null };
}
