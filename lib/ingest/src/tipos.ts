/**
 * Os tipos que a importação recebe — e o grão de cada um.
 *
 * ---------------------------------------------------------------------------
 * Por que a importação passou a perguntar o tipo
 * ---------------------------------------------------------------------------
 * Ela não perguntava. O tipo saía do conteúdo da aba (`identity.ts`), com o
 * nome de desempate, e isso resolve o caso em que o dicionário já conhece o
 * equipamento. O que ele não resolve é o primeiro arquivo de um tipo novo: sem
 * dicionário não há evidência, e sem evidência a decisão vira pendência ou,
 * pior, um equipamento inventado a partir do nome do arquivo.
 *
 * A declaração é a resposta: quem envia sabe o que está enviando, e a aba da
 * tela é onde ele diz. Só que declarar não é o mesmo que decidir — a
 * declaração é **promessa**, e a importação a **confere** contra o que o
 * arquivo traz. Uma planilha de carreta enviada pela aba do Cavalo é recusada
 * com a conta na mão, e não aceita porque alguém clicou na aba errada.
 *
 * ---------------------------------------------------------------------------
 * O grão, e por que ele é do tipo
 * ---------------------------------------------------------------------------
 * O leitor exigia `vigencia` **e** `placa` para uma aba virar fonte de fatos, e
 * essa regra tinha o formato do equipamento que ela nasceu para ler. O trecho
 * não tem placa: ele é uma perna de rota, e a planilha de curadoria diz qual é
 * a chave dele com todas as letras — `chaveTrecho`, "Chave do trecho - campo
 * chave" (`lib/curation/src/catalogo-declarado.ts`).
 *
 * A consequência de tratar a placa como universal não era um erro na tela: era
 * silêncio. Uma aba sem placa era rebaixada a PIVOT, os fatos dela não eram
 * produzidos, e a importação terminava com zero fato, zero erro e zero aviso —
 * aprovada. O arquivo entrava e não dizia nada. É por isso que o identificador
 * mora aqui, ao lado do tipo, e não numa constante que vale para todos.
 *
 * ---------------------------------------------------------------------------
 * Duas normalizações, e as duas escritas
 * ---------------------------------------------------------------------------
 * O mesmo cabeçalho é comparado de dois jeitos no pipeline: `foldText` (que só
 * tira acento e caixa) decide o papel da aba e acha a coluna do grão;
 * `slugifyColumn` (que também separa camelCase) é o que vira `attribute.code`.
 * `chaveTrecho` fica `chavetrecho` no primeiro e `chave_trecho` no segundo. As
 * duas formas estão escritas porque derivar uma da outra aqui seria repetir
 * `workbook.ts` num arquivo que não pode importá-lo — ver abaixo.
 *
 * ---------------------------------------------------------------------------
 * Por que este arquivo não importa nada
 * ---------------------------------------------------------------------------
 * Pelo mesmo motivo de `@workspace/curation/equipamento`: a tela precisa da
 * mesma lista, e pedi-la pelo índice de `@workspace/ingest` arrastaria `xlsx`,
 * `drizzle-orm` e o `pg` inteiro para o bundle do navegador. Sem import, o
 * subcaminho `@workspace/ingest/tipos` é publicável para os dois lados — e a
 * fileira de abas da tela e a recusa do servidor passam a ler a mesma lista,
 * que é a única forma de elas nunca discordarem sobre o que é importável.
 */

/** Os tipos que a tela de Importações oferece, na ordem em que aparecem. */
export type TipoDeImportacao =
  | "CAVALO"
  | "CARRETA"
  | "TRECHO"
  | "QLP_ADMINISTRATIVO"
  | "QLP_OPERACIONAL";

/** A coluna que diz *de quem* é a linha. */
export interface ColunaIdentificadora {
  /** Como `foldText` a escreve — a forma que acha a coluna no cabeçalho. */
  folded: string;
  /** Como `slugifyColumn` a escreve — a forma que vira código de atributo. */
  slug: string;
  /** O cabeçalho literal, como a planilha o escreve. Vai para a tela. */
  sourceName: string;
}

export interface DefinicaoDeTipo {
  code: TipoDeImportacao;
  /** O nome na aba e nas frases: "Cavalo", "QLP Administrativo". */
  rotulo: string;
  /** Uma linha sobre o que se importa por aqui. */
  descricao: string;
  /**
   * A coluna identificadora do tipo, ou `null` quando o grão ainda não é
   * conhecido. `null` e {@link aindaNaoEntra} andam juntos, sempre.
   */
  identificador: ColunaIdentificadora | null;
  /**
   * Por que o pipeline ainda não ingere este tipo — `null` quando ingere.
   *
   * Existe para a recusa ser uma frase, e não um arquivo que entra e produz
   * nada. Uma aba na tela sem esta frase seria exatamente a armadilha que a
   * declaração veio desfazer.
   */
  aindaNaoEntra: string | null;
}

/** A coluna de vigência — a metade do grão que todo tipo compartilha. */
export const COLUNA_DE_VIGENCIA = "vigencia";

const PLACA: ColunaIdentificadora = {
  folded: "placa",
  slug: "placa",
  sourceName: "Placa",
};

const CHAVE_TRECHO: ColunaIdentificadora = {
  folded: "chavetrecho",
  slug: "chave_trecho",
  sourceName: "chaveTrecho",
};

/**
 * A lista. Uma só, e esta.
 *
 * A tela recorta o histórico por ela, o servidor recusa por ela, e o leitor
 * decide o papel da aba por ela. Uma segunda lista dos mesmos tipos concordaria
 * no dia em que fosse escrita e discordaria no dia do sexto — como aconteceu
 * com os três equipamentos até `lib/frota.ts` virar a autoridade deles.
 */
export const TIPOS_DE_IMPORTACAO: DefinicaoDeTipo[] = [
  {
    code: "CAVALO",
    rotulo: "Cavalo",
    descricao: "O export de remuneração do cavalo mecânico, por placa e quinzena.",
    identificador: PLACA,
    aindaNaoEntra: null,
  },
  {
    code: "CARRETA",
    rotulo: "Carreta",
    descricao: "O export de remuneração da carreta, por placa e quinzena.",
    identificador: PLACA,
    aindaNaoEntra: null,
  },
  {
    code: "TRECHO",
    rotulo: "Trecho",
    descricao:
      "O export do lado variável da remuneração — origem, destino e quilometragem —, " +
      "identificado pela chave do trecho e não por placa.",
    identificador: CHAVE_TRECHO,
    aindaNaoEntra: null,
  },
  {
    code: "QLP_ADMINISTRATIVO",
    rotulo: "QLP Administrativo",
    descricao: "O quadro de lotação de pessoal da estrutura administrativa.",
    identificador: null,
    aindaNaoEntra:
      "O QLP não é frota: a linha dele não é uma placa nem um trecho, e o pipeline " +
      "ainda não sabe o que identifica uma linha de quadro de pessoal. Aceitar o " +
      "arquivo agora o faria entrar sem produzir fato nenhum — que é o silêncio que " +
      "esta tela existe para não repetir. Falta o modelo da planilha para o grão ser " +
      "declarado aqui.",
  },
  {
    code: "QLP_OPERACIONAL",
    rotulo: "QLP Operacional",
    descricao: "O quadro de lotação de pessoal da operação.",
    identificador: null,
    aindaNaoEntra:
      "O QLP não é frota: a linha dele não é uma placa nem um trecho, e o pipeline " +
      "ainda não sabe o que identifica uma linha de quadro de pessoal. Aceitar o " +
      "arquivo agora o faria entrar sem produzir fato nenhum — que é o silêncio que " +
      "esta tela existe para não repetir. Falta o modelo da planilha para o grão ser " +
      "declarado aqui.",
  },
];

const POR_CODIGO = new Map<string, DefinicaoDeTipo>(
  TIPOS_DE_IMPORTACAO.map((tipo) => [tipo.code, tipo]),
);

/** A definição de um código, ou `null` quando ele não é um tipo desta lista. */
export function tipoDeImportacao(code: string | null | undefined): DefinicaoDeTipo | null {
  if (code === null || code === undefined) return null;
  return POR_CODIGO.get(code.trim().toUpperCase()) ?? null;
}

/** O tipo entra hoje? Falso para quem tem {@link DefinicaoDeTipo.aindaNaoEntra}. */
export function tipoEntra(code: string | null | undefined): boolean {
  const tipo = tipoDeImportacao(code);
  return tipo !== null && tipo.identificador !== null;
}

/**
 * Todas as colunas que identificam alguma linha, na forma de `foldText`.
 *
 * É o que permite o leitor reconhecer uma aba de fatos sem saber ainda de que
 * tipo ela é: o papel da aba é decidido antes da identidade, e continua sendo.
 */
export const COLUNAS_IDENTIFICADORAS: ColunaIdentificadora[] = [
  ...new Map(
    TIPOS_DE_IMPORTACAO.flatMap((tipo) =>
      tipo.identificador ? [[tipo.identificador.folded, tipo.identificador] as const] : [],
    ),
  ).values(),
];

/**
 * As colunas que são chave, e por isso não descrevem equipamento nenhum.
 *
 * `identity.ts` as tira da pontuação: contá-las aproximaria todos os tipos
 * entre si sem informar nada. A forma aqui é a de `slugifyColumn`, porque é
 * com slugs que a pontuação trabalha.
 */
export const SLUGS_DE_GRAO: string[] = [
  COLUNA_DE_VIGENCIA,
  ...COLUNAS_IDENTIFICADORAS.map((coluna) => coluna.slug),
];

/** A coluna identificadora encontrada num cabeçalho já passado por `foldText`. */
export function identificadorNoCabecalho(
  cabecalhoFolded: Iterable<string>,
): ColunaIdentificadora | null {
  const presentes = new Set(cabecalhoFolded);
  return COLUNAS_IDENTIFICADORAS.find((coluna) => presentes.has(coluna.folded)) ?? null;
}
