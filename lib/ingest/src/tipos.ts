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

// ---------------------------------------------------------------------------
// A família do dataset — o acervo que o arquivo alimenta
// ---------------------------------------------------------------------------

/**
 * A família é **declarada pelo tipo**, e é isso que a torna um eixo próprio.
 *
 * A identidade canônica de uma vigência é (sistema, família, canal, data,
 * escopo) — ver `canonical-identity.ts`, e o índice único que o Postgres gera
 * sobre ela. A família era *derivada* do `entity_type`: um mapa de CAVALO para
 * REMUNERACAO_EQUIPAMENTO, de QLP para QUADRO_DE_PESSOAL. Enquanto o único
 * acervo era o remunerado, derivar e declarar davam no mesmo, e derivar era
 * menos escrita.
 *
 * O **real** desfaz o empate. O extrato do financiamento fala das mesmas
 * placas, na mesma data, no mesmo canal: derivada do tipo, a família dele sairia
 * REMUNERACAO_EQUIPAMENTO, e o arquivo colidiria com a vigência remunerada
 * daquela data — recusado como duplicata, ou pior, fundido com ela. Trocar o
 * `entity_type` para não colidir custaria mais caro ainda: `entity_identifier`
 * é único por (tipo, valor), então a placa do real viraria uma **entidade
 * diferente** da mesma placa no remunerado, e não haveria como cruzar as duas —
 * que é a única coisa que a auditoria do real precisa fazer.
 *
 * Declarar a família resolve os dois de uma vez: o `entity_type` continua
 * CAVALO, e a placa casa; a família diz de que acervo aquele arquivo é, e as
 * duas vigências coexistem na mesma data sem se ver.
 *
 * Elas moram aqui, e não em `canonical-identity.ts`, pelo motivo que o cabeçalho
 * deste arquivo explica: a aba da tela precisa saber a família que está
 * declarando, e `canonical-identity.ts` importa `node:crypto`. Lá elas
 * continuam exportadas, por reexportação, para quem já as lia de
 * `@workspace/ingest`.
 */

/**
 * A remuneração dos ativos: o que a Ambev paga por cavalo, carreta, trecho.
 *
 * CAVALO e CARRETA são componentes de uma mesma família. Um arquivo só de
 * cavalos e um arquivo de cavalos+carretas descrevem a mesma remuneração da
 * mesma vigência — antes disto, viravam duas identidades ativas, e os cavalos
 * passavam a existir em duplicidade. A família é do acervo, e não conta quantas
 * abas foram lidas.
 */
export const DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO = "REMUNERACAO_EQUIPAMENTO";

/**
 * O quadro de lotação de pessoal — administrativo e operacional, uma família.
 *
 * **Por que não a mesma família do equipamento.** A identidade da vigência é
 * (sistema, família, canal, data, escopo). Sem família própria, um arquivo de
 * QLP da mesma unidade, mesma data e mesmo canal teria a mesma identidade da
 * remuneração de equipamento — e entraria como *revisão* dela, superpondo uma
 * vigência que fala de caminhão com uma que fala de gente. A família existe
 * para essa distinção; usá-la é o que impede a confusão, não uma formalidade.
 *
 * **Por que uma só para os dois QLPs.** Pelo mesmo argumento que junta CAVALO e
 * CARRETA: os dois arquivos descrevem o mesmo quadro da mesma vigência, cada um
 * com uma parte da população. Em famílias separadas, cada um abriria a sua
 * vigência e nunca se reconheceriam como partes de um todo; na mesma, o segundo
 * entra como revisão que herda os fatos do primeiro — a máquina de fato herdado
 * (`0017`) foi escrita exatamente para o arquivo parcial.
 *
 * **E por que ela não é um acervo à parte na tela.** O que a Ambev paga por
 * gente é remuneração igual: a família separa a *identidade da vigência*, que é
 * problema do banco, e o acervo separa *telas*, que é problema de quem opera.
 * As duas divisões são reais e não coincidem — ver `ACERVOS`, abaixo.
 */
export const DATASET_FAMILY_QUADRO_DE_PESSOAL = "QUADRO_DE_PESSOAL";

export interface DefinicaoDeTipo {
  code: TipoDeImportacao;
  /** O nome na aba e nas frases: "Cavalo", "QLP Administrativo". */
  rotulo: string;
  /** Uma linha sobre o que se importa por aqui. */
  descricao: string;
  /**
   * O acervo que este tipo alimenta — metade da identidade canônica da vigência.
   *
   * Ver o bloco acima: é a declaração da família que deixa o real e o remunerado
   * do mesmo veículo, na mesma data, existirem sem colidir.
   */
  familia: string;
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
    familia: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    identidade: [PLACA],
  },
  {
    code: "CARRETA",
    rotulo: "Carreta",
    descricao: "O export de remuneração da carreta, por placa e quinzena.",
    familia: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    identidade: [PLACA],
  },
  {
    code: "TRECHO",
    rotulo: "Trecho",
    descricao:
      "O export do lado variável da remuneração — origem, destino e quilometragem —, " +
      "identificado pela chave do trecho e não por placa.",
    familia: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
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
    familia: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    identidade: [PLACA],
  },
  {
    code: "CARROCERIA",
    rotulo: "Carroceria",
    descricao:
      "O export de remuneração da carroceria — o implemento do caminhão, no " +
      "lugar da carreta —, por placa e quinzena.",
    familia: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    identidade: [PLACA],
  },
  {
    code: "EMPILHADEIRA",
    rotulo: "Empilhadeira",
    descricao:
      "O export de remuneração da empilhadeira, o ativo da operação de apoio: " +
      "trabalha dentro do pátio, não puxa implemento e não roda trecho.",
    familia: DATASET_FAMILY_REMUNERACAO_EQUIPAMENTO,
    identidade: [PLACA],
  },
  {
    code: "QLP_ADMINISTRATIVO",
    rotulo: "QLP Administrativo",
    descricao:
      "O quadro de lotação de pessoal da estrutura administrativa: um cargo por " +
      "unidade, com as despesas de ordenados, encargos, benefícios, frota leve, " +
      "telefonia e uniformes.",
    familia: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    identidade: [UNIDADE_CNPJ, CARGO],
  },
  {
    code: "QLP_OPERACIONAL",
    rotulo: "QLP Operacional",
    descricao:
      "O quadro de lotação de pessoal da operação: um cargo por unidade e turno, " +
      "com piso, adicional noturno, benefícios, encargos e a quantidade por caminhão.",
    familia: DATASET_FAMILY_QUADRO_DE_PESSOAL,
    identidade: [UNIDADE_CNPJ, CARGO_EQUIPE, TURNO],
  },
];

/**
 * O financiamento como o banco o cobra — o **real**, ao lado do remunerado.
 *
 * Esta é a família que obriga a declaração a existir, e o motivo está no
 * `entity_type`. O extrato fala das mesmas placas: para a auditoria poder
 * cruzar o real com o remunerado do mesmo veículo, os dois têm de ser a
 * **mesma entidade** — e `entity_identifier` é único por (tipo, valor), então
 * inventar um `CAVALO_REAL` transformaria a placa ABC1D23 do real numa
 * entidade diferente da ABC1D23 do remunerado, e não haveria o que cruzar.
 *
 * O tipo declarado continua sendo CAVALO, portanto, e é a família que separa os
 * acervos. Sem ela, os dois arquivos da mesma data teriam a mesma identidade
 * canônica de vigência, e o segundo seria recusado como reentrega do primeiro.
 */
export const DATASET_FAMILY_FINANCIAMENTO_REAL = "FINANCIAMENTO_REAL";

// ---------------------------------------------------------------------------
// Os acervos — a fileira de cima da tela de Importações
// ---------------------------------------------------------------------------

/** Os acervos que a tela oferece, na ordem em que aparecem. */
export type Acervo = "REMUNERADO" | "REAL";

export interface DefinicaoDeAcervo {
  code: Acervo;
  /** Como o endereço o escreve: `?secao=remunerado`. */
  slug: string;
  /** O nome na aba e nas frases. */
  rotulo: string;
  /** Uma linha sobre o que entra por aqui. */
  descricao: string;
  /**
   * A família que este acervo carimba, quando ele carimba uma.
   *
   * O **real** fixa a dele: todo arquivo que entra por ali é financiamento
   * real, seja de cavalo ou de carreta. O **remunerado** deixa `undefined` e
   * defere ao tipo, porque ali a família depende do que se envia — o
   * equipamento tem a sua, o quadro de pessoal tem a dele.
   *
   * Ver {@link familiaDeclarada}, que é onde essa regra vira um valor.
   */
  familiaFixa?: string;
  /**
   * Os tipos que este acervo aceita. Ausente quer dizer **todos**.
   *
   * O real é o financiamento de um **ativo**, e nem todo tipo é um: um trecho é
   * uma perna de rota, e uma perna de rota não se financia; o quadro de pessoal
   * não tem contrato de banco. Oferecer as abas deles dentro do Real seria
   * convidar a declarar um acervo para um arquivo que não pode pertencer a ele.
   *
   * A lista é por código, e não derivada de `EQUIPAMENTOS_DO_AMBIENTE`
   * (`lib/frota.ts`, no cliente), porque aquela inclui o trecho — ela responde
   * "que ativos esta auditoria mostra", que é outra pergunta.
   */
  tipos?: TipoDeImportacao[];
}

/**
 * A lista dos acervos. Uma só, e esta.
 *
 * A fileira de abas da tela é escrita por ela, e o servidor recusa por ela —
 * pela mesma razão que `TIPOS_DE_IMPORTACAO` é uma lista só: duas listas
 * concordariam no dia em que fossem escritas e discordariam depois.
 *
 * **Chamados não está aqui**, e não é esquecimento. Ele é a terceira aba da
 * mesma fileira na tela, mas não é um acervo de planilha: não tem tipo
 * declarado, não tem família de vigência e não passa por este pipeline. A tela
 * o trata como o caso à parte que ele é, em vez de o enfiar nesta lista e
 * precisar de exceção em toda regra que a lista sustenta.
 */
export const ACERVOS: DefinicaoDeAcervo[] = [
  {
    code: "REMUNERADO",
    slug: "remunerado",
    rotulo: "Remunerado",
    descricao:
      "O que a Ambev paga: o export de remuneração dos ativos e o quadro de " +
      "lotação de pessoal, por vigência.",
  },
  {
    code: "REAL",
    slug: "real",
    rotulo: "Real",
    descricao:
      "O custo como ele é cobrado — hoje, o extrato do financiamento dos " +
      "veículos. Entra por planilha enquanto a API não existe.",
    familiaFixa: DATASET_FAMILY_FINANCIAMENTO_REAL,
    tipos: ["CAVALO", "CARRETA", "CAMINHAO", "CARROCERIA", "EMPILHADEIRA"],
  },
];

const ACERVO_POR_SLUG = new Map<string, DefinicaoDeAcervo>(
  ACERVOS.map((acervo) => [acervo.slug, acervo]),
);

/** O acervo de um slug de endereço, ou `null` quando ele não é um. */
export function acervoDoSlug(slug: string | null | undefined): DefinicaoDeAcervo | null {
  if (slug === null || slug === undefined) return null;
  return ACERVO_POR_SLUG.get(slug.trim().toLowerCase()) ?? null;
}

/**
 * A família que um envio declara — a conta que junta o acervo e o tipo.
 *
 * É a única forma de escrever essa regra: o acervo sozinho não decide (o
 * remunerado tem duas famílias), e o tipo sozinho também não (CAVALO existe nos
 * dois acervos). Quem chama isto é o envio, e o valor vai para o
 * `declared_family` do run — de onde a promoção o lê.
 */
export function familiaDeclarada(
  acervo: DefinicaoDeAcervo | null,
  tipo: DefinicaoDeTipo | null,
): string | null {
  if (acervo?.familiaFixa !== undefined) return acervo.familiaFixa;
  return tipo?.familia ?? null;
}

/** Se este acervo aceita receber um arquivo daquele tipo. */
export function acervoAceitaTipo(
  acervo: DefinicaoDeAcervo,
  code: TipoDeImportacao,
): boolean {
  return acervo.tipos === undefined || acervo.tipos.includes(code);
}

/** Toda família que um envio pode declarar — o que o servidor aceita. */
export const FAMILIAS_DECLARAVEIS: string[] = [
  ...new Set([
    ...TIPOS_DE_IMPORTACAO.map((tipo) => tipo.familia),
    ...ACERVOS.flatMap((a) => (a.familiaFixa ? [a.familiaFixa] : [])),
  ]),
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
