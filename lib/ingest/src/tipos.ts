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
 * essa regra tinha o formato do equipamento que ela nasceu para ler. Os outros
 * tipos não têm placa:
 *
 * - o **trecho** é uma perna de rota, e a planilha de curadoria diz qual é a
 *   chave dele com todas as letras — `chaveTrecho`, "Chave do trecho - campo
 *   chave" (`lib/curation/src/catalogo-declarado.ts`);
 * - o **QLP** é quadro de pessoal: a linha é um cargo dentro de uma unidade,
 *   e no operacional também dentro de um turno.
 *
 * A consequência de tratar a placa como universal não era um erro na tela: era
 * silêncio. Uma aba sem placa era rebaixada a PIVOT, os fatos dela não eram
 * produzidos, e a importação terminava com zero fato, zero erro e zero aviso —
 * aprovada. O arquivo entrava e não dizia nada.
 *
 * ---------------------------------------------------------------------------
 * Por que a identidade é uma **lista** de colunas
 * ---------------------------------------------------------------------------
 * Porque a do QLP não cabe em uma. `entity_identifier` tem índice único sobre
 * (tipo, valor) **global**, e os fatos de uma vigência inteira — o arquivo
 * todo, todas as unidades — moram no mesmo snapshot: o promote agrupa por
 * rótulo de vigência, e o escopo do snapshot é o conjunto das unidades do
 * arquivo. Uma chave "MOTORISTA" seria a mesma linha para Camaçari e para
 * Jaguariúna dentro da mesma vigência — duas linhas para a mesma entidade,
 * discordando, que é exatamente o conflito que `ENTIDADE_DUPLICADA_CONFLITANTE`
 * recusa. A unidade entra na chave por isso.
 *
 * **O operador não entra**, e isso é uma escolha, não um esquecimento. O
 * produto já declara em `REQUIRED_SCOPE_TYPES` que a unidade é o que diz *de
 * quem* é a remuneração; o operador é escopo. Se um dia dois operadores
 * servirem a mesma unidade com o mesmo cargo, o conflito aparece como recusa
 * nomeada na pré-visualização — e aí ele se acrescenta aqui, com a evidência na
 * mão, em vez de por precaução.
 *
 * ---------------------------------------------------------------------------
 * Duas normalizações de cabeçalho, e as duas escritas
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
  | "CAMINHAO"
  | "CARROCERIA"
  | "EMPILHADEIRA"
  | "QLP_ADMINISTRATIVO"
  | "QLP_OPERACIONAL";

/**
 * Como o valor de uma coluna de identidade vira chave.
 *
 * `DOCUMENTO` existe porque o Excel entrega CNPJ ora mascarado, ora como
 * número — e como número ele perde o zero da frente. Reduzido a dígitos e
 * completado a 14, os dois viram a mesma unidade; reduzido como identificador
 * comum, `07.526.557/0015-05` e `7526557001505` seriam duas unidades
 * diferentes, e o quadro de pessoal de Camaçari existiria em duplicidade.
 */
export type NormalizacaoDeChave = "IDENTIFICADOR" | "DOCUMENTO";

/** Uma coluna que participa da identidade da linha. */
export interface ColunaIdentificadora {
  /** Como `foldText` a escreve — a forma que acha a coluna no cabeçalho. */
  folded: string;
  /** Como `slugifyColumn` a escreve — a forma que vira código de atributo. */
  slug: string;
  /** O cabeçalho literal, como a planilha o escreve. Vai para a tela. */
  sourceName: string;
  normalizacao: NormalizacaoDeChave;
  /**
   * A coluna continua sendo fato, mesmo participando da identidade.
   *
   * Verdadeiro só para as colunas de escopo. `Unidade - CNPJ` identifica a
   * linha do QLP **e** é de onde `resolveScopes` tira a unidade da vigência —
   * e ele lê escopo dos fatos. Tirá-la dos fatos por ela virar chave faria a
   * promoção recusar por `ESCOPO_OBRIGATORIO_AUSENTE` uma vigência cuja unidade
   * está escrita em toda linha do arquivo.
   *
   * Falso é o caso comum: a placa é chave e não é fato, como sempre foi.
   */
  tambemEhFato?: boolean;
}

export interface DefinicaoDeTipo {
  code: TipoDeImportacao;
  /** O nome na aba e nas frases: "Cavalo", "QLP Administrativo". */
  rotulo: string;
  /** Uma linha sobre o que se importa por aqui. */
  descricao: string;
  /**
   * As colunas que, juntas, identificam uma linha — na ordem em que compõem a
   * chave.
   *
   * Vazia é o estado de um tipo que a tela nomeia e o pipeline ainda não sabe
   * ingerir. Nenhum dos cinco está assim hoje; o que sustenta a lista é
   * `exigirTipoDeclarado`, que recusa a declaração de um tipo sem grão em vez
   * de deixar o arquivo entrar e não produzir fato nenhum — o silêncio que a
   * primeira planilha de trecho custou.
   */
  identidade: ColunaIdentificadora[];
}

/** A coluna de vigência — a metade do grão que todo tipo compartilha. */
export const COLUNA_DE_VIGENCIA = "vigencia";

const PLACA: ColunaIdentificadora = {
  folded: "placa",
  slug: "placa",
  sourceName: "Placa",
  normalizacao: "IDENTIFICADOR",
};

const CHAVE_TRECHO: ColunaIdentificadora = {
  folded: "chavetrecho",
  slug: "chave_trecho",
  sourceName: "chaveTrecho",
  normalizacao: "IDENTIFICADOR",
};

/** A unidade, que no QLP identifica além de situar. Ver `tambemEhFato`. */
const UNIDADE_CNPJ: ColunaIdentificadora = {
  folded: "unidade - cnpj",
  slug: "unidade_cnpj",
  sourceName: "Unidade - CNPJ",
  normalizacao: "DOCUMENTO",
  tambemEhFato: true,
};

const CARGO: ColunaIdentificadora = {
  folded: "cargo",
  slug: "cargo",
  sourceName: "Cargo",
  normalizacao: "IDENTIFICADOR",
};

const CARGO_EQUIPE: ColunaIdentificadora = {
  folded: "cargoequipeempurrada",
  slug: "cargo_equipe_empurrada",
  sourceName: "cargoEquipeEmpurrada",
  normalizacao: "IDENTIFICADOR",
};

const TURNO: ColunaIdentificadora = {
  folded: "turnoempurrada",
  slug: "turno_empurrada",
  sourceName: "turnoEmpurrada",
  normalizacao: "IDENTIFICADOR",
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
    identidade: [PLACA],
  },
  {
    code: "CARRETA",
    rotulo: "Carreta",
    descricao: "O export de remuneração da carreta, por placa e quinzena.",
    identidade: [PLACA],
  },
  {
    code: "TRECHO",
    rotulo: "Trecho",
    descricao:
      "O export do lado variável da remuneração — origem, destino e quilometragem —, " +
      "identificado pela chave do trecho e não por placa.",
    identidade: [CHAVE_TRECHO],
  },
  /*
    Os três ativos das outras operações.

    Cavalo, carreta e trecho são o que a **empurrada** roda; a rota e o AS rodam
    com caminhão e carroceria, e o apoio, com empilhadeira. Eles entram aqui
    porque a auditoria daquelas operações existe (`lib/ambiente.ts`, no cliente)
    e a importação precisava poder **receber** o export delas — enquanto não
    podia, a única forma de aquelas telas mostrarem alguma coisa seria chamar o
    cavalo de caminhão, que é o oposto do que este produto faz.

    **Nenhum deles inventa dado.** `entity_type` é texto livre no banco, então
    não há migration: o que muda é o contrato da importação, que passa a aceitar
    a declaração desses tipos e a conferi-la contra o que o arquivo traz — a
    mesma promessa/conferência dos três primeiros. Até chegar o primeiro arquivo,
    a tela 360° de cada um diz que aquele tipo não existe neste contexto, que é a
    verdade.

    A identidade é a placa nos dois primeiros, como no cavalo e na carreta. A
    empilhadeira também entra por placa: é o que o cadastro de pátio usa como
    chave hoje, e trocá-la por número de série exigiria saber qual coluna o
    export traz — o que só o primeiro arquivo dirá. Se vier diferente, muda-se
    aqui, num lugar só.
  */
  {
    code: "CAMINHAO",
    rotulo: "Caminhão",
    descricao:
      "O export de remuneração do caminhão — o ativo que tração e AS rodam no " +
      "lugar do cavalo mecânico —, por placa e quinzena.",
    identidade: [PLACA],
  },
  {
    code: "CARROCERIA",
    rotulo: "Carroceria",
    descricao:
      "O export de remuneração da carroceria — o implemento do caminhão, no " +
      "lugar da carreta —, por placa e quinzena.",
    identidade: [PLACA],
  },
  {
    code: "EMPILHADEIRA",
    rotulo: "Empilhadeira",
    descricao:
      "O export de remuneração da empilhadeira, o ativo da operação de apoio: " +
      "trabalha dentro do pátio, não puxa implemento e não roda trecho.",
    identidade: [PLACA],
  },
  {
    code: "QLP_ADMINISTRATIVO",
    rotulo: "QLP Administrativo",
    descricao:
      "O quadro de lotação de pessoal da estrutura administrativa: um cargo por " +
      "unidade, com as despesas de ordenados, encargos, benefícios, frota leve, " +
      "telefonia e uniformes.",
    identidade: [UNIDADE_CNPJ, CARGO],
  },
  {
    code: "QLP_OPERACIONAL",
    rotulo: "QLP Operacional",
    descricao:
      "O quadro de lotação de pessoal da operação: um cargo por unidade e turno, " +
      "com piso, adicional noturno, benefícios, encargos e a quantidade por caminhão.",
    identidade: [UNIDADE_CNPJ, CARGO_EQUIPE, TURNO],
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


/** Toda coluna que participa da identidade de algum tipo, sem repetição. */
export const COLUNAS_IDENTIFICADORAS: ColunaIdentificadora[] = [
  ...new Map(
    TIPOS_DE_IMPORTACAO.flatMap((tipo) =>
      tipo.identidade.map((coluna) => [coluna.folded, coluna] as const),
    ),
  ).values(),
];

/**
 * As colunas que são chave e **só** chave, e por isso não descrevem tipo nenhum.
 *
 * `identity.ts` as tira da pontuação por sobreposição de colunas: contá-las
 * aproximaria os tipos entre si sem informar nada. A coluna de escopo fica de
 * fora desta lista porque ela continua sendo fato — ela descreve a linha tanto
 * quanto qualquer outra, e some da pontuação seria tirar informação real.
 *
 * A forma aqui é a de `slugifyColumn`, porque é com slugs que a pontuação
 * trabalha.
 */
export const SLUGS_DE_GRAO: string[] = [
  COLUNA_DE_VIGENCIA,
  ...COLUNAS_IDENTIFICADORAS.filter((c) => c.tambemEhFato !== true).map((c) => c.slug),
];

/**
 * A identidade que um cabeçalho sustenta — a mais específica que ele completa.
 *
 * Responde a pergunta anterior à do tipo: *isto é uma aba de fatos?*. Um
 * cabeçalho serve quando traz **todas** as colunas de identidade de algum tipo.
 *
 * "A mais específica" resolve o único empate possível: o QLP traz `Unidade -
 * CNPJ` como parte da chave, e toda aba de equipamento também traz essa coluna
 * — só que como escopo. Preferir a identidade maior faz uma aba de QLP
 * Operacional ser lida com as três colunas dela, e não com um prefixo de outra.
 * Com tipo declarado esse desempate nem chega a acontecer: a aba da tela diz
 * qual é, e a conferência só verifica se as colunas dela estão lá.
 */
export function identidadeNoCabecalho(
  cabecalhoFolded: Iterable<string>,
): ColunaIdentificadora[] | null {
  const presentes = new Set(cabecalhoFolded);
  const candidatas = TIPOS_DE_IMPORTACAO.map((tipo) => tipo.identidade)
    .filter((identidade) => identidade.length > 0)
    .filter((identidade) => identidade.every((coluna) => presentes.has(coluna.folded)))
    .sort((a, b) => b.length - a.length);
  return candidatas[0] ?? null;
}

/** Como a chave de uma linha se escreve para quem lê: as partes, separadas. */
export const SEPARADOR_LEGIVEL = " · ";
