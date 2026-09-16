/**
 * O vocabulário que a tela usa.
 *
 * O produto guarda `cavalo.ipva_licenciamento` e `ipvaLicenciamento`, e as duas
 * formas têm razão de existir: a primeira é a identidade interna, a segunda é o
 * literal da planilha, preservado para rastreabilidade. Nenhuma das duas é o
 * que alguém quer ler ao decidir se precisa ligar para o cliente.
 *
 * Este mapa é o terceiro nome — o de leitura. Ele **não** substitui os outros
 * dois: o código continua visível no detalhe do cartão, e o nome literal da
 * coluna continua na proveniência, ao lado da célula. Trocar o rótulo nunca
 * pode custar a capacidade de achar o dado na planilha do cliente.
 *
 * Este mapa fica em código porque é vocabulário de produto: um rótulo revisto
 * num pull request é mais fácil de auditar do que um `UPDATE`. Ele é o padrão,
 * não a palavra final — quando a curadoria dá um nome gerencial ao atributo,
 * é esse nome que aparece. Quem batizou assinou e justificou a escolha na tela
 * de curadoria, e um apelido dado por quem lê o número todo dia vale mais do
 * que o nosso palpite escrito aqui.
 */

/** Nome de leitura por código de atributo. Ausência aqui não é erro (ver `attributeLabel`). */
const ATTRIBUTE_LABELS: Record<string, string> = {
  // ---- Carreta ----------------------------------------------------------
  "carreta.custo_fixo": "Custo fixo",
  "carreta.finame": "FINAME",
  "carreta.finame_implemento": "FINAME do implemento",
  "carreta.amortizacao_implemento": "Amortização do implemento",
  "carreta.juros_finame_implemento": "Juros do FINAME do implemento",
  "carreta.lucro_fixomodelo_novo_ciclo": "Lucro fixo do novo ciclo",
  "carreta.lucro_fixomodelo_novo_ciclo_carreta": "Lucro fixo do novo ciclo (carreta)",
  "carreta.lucro_variavel_previsto": "Lucro variável previsto",
  "carreta.lucro_variavel_previsto_carreta": "Lucro variável previsto (carreta)",
  "carreta.ipva_licenciamento": "IPVA / Licenciamento",
  "carreta.ipva_licenciamento_mensal": "IPVA / Licenciamento (coluna “mensal”)",
  "carreta.seguro": "Seguro",
  "carreta.custo_aluguel": "Custo de aluguel",
  "carreta.valor_nf_compra": "Valor da nota de compra",
  "carreta.valor_pis_cofins": "PIS/COFINS sobre a compra",
  "carreta.valor_icms": "ICMS (valor)",
  "carreta.valor_pneus": "Pneus (valor)",
  "carreta.icms": "ICMS (alíquota)",
  "carreta.pis_cofins": "PIS/COFINS (alíquota)",
  "carreta.taxa_finame": "Taxa do FINAME",
  "carreta.tjlp": "TJLP",
  "carreta.ciclo": "Ciclo",
  "carreta.frota_emprestada": "Frota emprestada",
  "carreta.tacografo": "Tacógrafo",
  "carreta.status_financiamento_t1_shared": "Situação do financiamento",
  "carreta.data_fim_contrato": "Fim do contrato",

  // ---- Cavalo -----------------------------------------------------------
  "cavalo.finame_cavalo": "Custo fixo do cavalo (coluna “FINAME”)",
  "cavalo.amortizacao_cavalo": "Amortização do cavalo",
  "cavalo.juros_finame_cavalo": "Juros do FINAME do cavalo",
  "cavalo.lucro_fixomodelo_novo_ciclo_cavalo": "Lucro fixo do novo ciclo",
  "cavalo.lucro_variavel_previsto_cavalo": "Lucro variável previsto",
  "cavalo.ipva_licenciamento": "IPVA / Licenciamento",
  "cavalo.valor_nf_compra": "Valor da nota de compra",
  "cavalo.valor_pis_cofins": "PIS/COFINS sobre a compra",
  "cavalo.valor_icms": "ICMS (valor)",
  "cavalo.valor_pneu": "Pneu (valor)",
  "cavalo.custo_aluguel": "Custo de aluguel",
  "cavalo.custo_variavel_simulado": "Custo variável simulado",
  "cavalo.manutencao_bid": "Manutenção (BID)",
  "cavalo.manutencao_reais_km": "Manutenção por quilômetro",
  "cavalo.manutencao_vida_meses": "Vida da manutenção",
  "cavalo.manutencao_compra_fora_do_bid_autorizada": "Compra fora do BID autorizada",
  "cavalo.combustivel_consumo_neg": "Consumo de combustível negociado",
  "cavalo.combustivel_consumo_benchmark": "Consumo de combustível (referência)",
  "cavalo.combustivel_vida_cavalo": "Vida do combustível",
  "cavalo.combustivel_percentual_perda_vida": "Perda de vida do combustível",
  "cavalo.odometro_entrada": "Odômetro de entrada",
  "cavalo.percentual_reajuste_aplicado": "Reajuste aplicado",
  "cavalo.data_fim_contrato": "Fim do contrato",
  "cavalo.placa_carreta": "Carreta vinculada",
  "cavalo.ativo": "Situação do ativo",
  "cavalo.ciclo": "Ciclo",
  "cavalo.taxa_finame": "Taxa do FINAME",
  "cavalo.tjlp": "TJLP",
  "cavalo.status_financiamento_t1_shared": "Situação do financiamento",
};

/**
 * `ipvaLicenciamentoMensal` → `Ipva licenciamento mensal`.
 *
 * O que sobra quando não há rótulo escrito. Devolve algo legível sem fingir que
 * entendeu o campo — a alternativa seria mostrar o slug, que é pior, ou omitir
 * o atributo, que é inaceitável.
 */
/**
 * O que já foi humanizado, guardado.
 *
 * O universo de entradas é o dicionário de atributos — 138 nomes neste acervo,
 * fechado por importação. O que varia é quantas vezes cada um é pedido: uma
 * leitura da DRE chama `attributeLabel` por atributo, por ativo e por
 * vigência, e no perfil de CPU de `/api/dre/history` `humanise` respondia por
 * 5,7% do tempo do processo — três expressões regulares e quatro cópias de
 * string, refeitas milhares de vezes sobre a mesma dúzia de nomes.
 *
 * Um `Map` sem teto é seguro justamente porque o universo é fechado: a chave é
 * o `source_name` do atributo, não um valor vindo do usuário.
 */
const JA_HUMANIZADOS = new Map<string, string>();

function humanise(sourceName: string): string {
  const guardado = JA_HUMANIZADOS.get(sourceName);
  if (guardado !== undefined) return guardado;

  const spaced = sourceName
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  const legivel = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  JA_HUMANIZADOS.set(sourceName, legivel);
  return legivel;
}

/**
 * O rótulo de leitura, em ordem de autoridade: o nome gerencial confirmado na
 * curadoria, o vocabulário deste arquivo, e por fim o literal da planilha
 * humanizado. Quem não tem o `display_name` à mão chama com dois argumentos e
 * cai no comportamento de sempre.
 */
export function attributeLabel(
  attributeCode: string | null,
  sourceName?: string | null,
  displayName?: string | null,
): string {
  const curated = displayName?.trim();
  if (curated) return curated;
  if (attributeCode === null) return sourceName ? humanise(sourceName) : "(sem atributo)";
  const known = ATTRIBUTE_LABELS[attributeCode];
  if (known) return known;
  if (sourceName) return humanise(sourceName);
  // Último recurso: o trecho depois do prefixo do equipamento.
  return humanise(attributeCode.split(".").slice(1).join(".") || attributeCode);
}

/**
 * O nome de leitura de cada `entity_type`, no singular e no plural.
 *
 * `TRECHO` está aqui pela mesma razão que tem tela 360°: ele é um tipo de linha
 * que a fonte entrega, e uma contagem que diga "3 TRECHO" ou "3 ativos" onde
 * cabia "3 trechos" é a tela desistindo de nomear o que está mostrando. O que
 * não estiver nomeado continua caindo no neutro — a tabela é vocabulário de
 * produto, não uma enumeração que o banco tenha de respeitar.
 */
const NOMES: Record<string, { singular: string; plural: string }> = {
  CAVALO: { singular: "Cavalo", plural: "cavalos" },
  CARRETA: { singular: "Carreta", plural: "carretas" },
  TRECHO: { singular: "Trecho", plural: "trechos" },
};

/** `CAVALO` → `Cavalo`; `CARRETA+CAVALO` → `Cavalos e carretas`. */
export function equipmentLabel(entityType: string | null): string {
  if (!entityType) return "Sem equipamento";
  const parts = entityType
    .split("+")
    .map((p) => NOMES[p]?.singular ?? p.toLowerCase());
  if (parts.length === 1) return parts[0];
  return parts.join(" e ");
}

/** Plural para as contagens de frota: "62 cavalos", "71 carretas". */
export function equipmentPlural(entityType: string | null, count: number): string {
  const nomes = NOMES[entityType ?? ""];
  const pair: [string, string] = nomes
    ? [nomes.singular.toLowerCase(), nomes.plural]
    : ["ativo", "ativos"];
  return `${count} ${count === 1 ? pair[0] : pair[1]}`;
}

/**
 * O plural de um tipo, sem contagem — para as frases que já têm o número.
 *
 * Existe porque `coverageLabel` escrevia o seu próprio ternário
 * `CAVALO ? "cavalos" : CARRETA ? "carretas" : "ativos"`, e um ternário entre
 * dois é a forma de o terceiro tipo aparecer como "ativos" numa tela que sabe
 * perfeitamente que está falando de trechos.
 */
export function equipmentPluralNoun(entityType: string | null): string {
  return NOMES[entityType ?? ""]?.plural ?? "ativos";
}

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * `2026-08-01` → `agosto/2026`. Sem `Date`, para não depender de fuso.
 *
 * Morava em `grouped.ts`, e mudou de casa quando a proveniência passou a
 * precisar dela: `query.ts` não pode importar `grouped.ts` sem fechar o ciclo
 * `grouped → consolidated → query`. Aqui, ao lado dos outros rótulos de
 * leitura, ela é do módulo que já é a resposta para "como isto se escreve na
 * tela" — e continua exportada pelo pacote no mesmo nome de sempre.
 */
export function periodLabel(date: string): string {
  const [year, month] = date.split("-");
  const index = Number(month) - 1;
  return index >= 0 && index < 12 ? `${MONTHS[index]}/${year}` : date;
}

/** Como a periodicidade aparece ao lado de um valor: "/mês", "/ano". */
export function periodicitySuffix(periodicity: string | null): string {
  const map: Record<string, string> = {
    MENSAL: "/mês",
    ANUAL: "/ano",
    PONTUAL: " (valor único)",
  };
  return map[periodicity ?? ""] ?? "";
}

/** O estado da semântica, dito em português e sem o jargão do schema. */
export function semanticsLabel(status: string | null): string {
  const map: Record<string, string> = {
    CONFIRMED: "significado confirmado",
    PRESUMED: "significado ainda presumido",
    UNKNOWN: "significado desconhecido",
  };
  return map[status ?? ""] ?? "significado não registrado";
}

/** A natureza da mudança, em português, para o cartão e para a lista. */
export function natureLabel(nature: string | null): string {
  const map: Record<string, string> = {
    NUMERIC: "valor",
    TEXT: "texto",
    BOOLEAN: "sim/não",
    DATE: "data",
    ZEROING: "zerou",
    FROM_ZERO: "saiu de zero",
    APPEARED: "passou a existir",
    DISAPPEARED: "deixou de existir",
    NULL_REASON: "motivo da ausência",
    TYPE_CHANGE: "mudou de tipo",
    SEMANTICS_DRIFT: "significado mudou",
  };
  return map[nature ?? ""] ?? (nature ?? "—").toLowerCase();
}

/**
 * A quinzena a que um dia pertence: 1 do dia 1 ao 15, 2 do 16 em diante.
 *
 * É a régua que o produto já aplica em `competenciaDoDia`
 * (`@workspace/fechamento`) e na tela de remuneração. Está aqui porque
 * {@link rotuloDaVigencia} precisa dela e este módulo é o que responde "como
 * isto se escreve na tela" — não porque a Auditoria tenha virado quinzenal.
 */
export function quinzenaDe(data: string): 1 | 2 {
  return Number(data.slice(8, 10)) <= 15 ? 1 : 2;
}

/** Uma vigência é sempre `aaaa-mm-dd`; o que não for passa direto. */
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;


/**
 * A marca que acompanha o mês — a quinzena, sempre; o dia, quando ela não basta.
 *
 * A régua mudou, e a mudança é deliberada: antes a marca só aparecia quando o
 * mês tinha mais de uma entrega, e um mês com entrega única saía `agosto/2026`
 * puro. A leitura de quem audita é quinzenal — a competência do fechamento, a
 * planilha de remuneração e o próprio rótulo da fonte (`EMPURRADA_1_8_2026`)
 * já falam em quinzena —, e uma coluna que ora diz `agosto/2026 · 1ª quinzena`,
 * ora `junho/2026`, faz a **ausência** da marca parecer uma informação sobre a
 * vigência: *este mês não é quinzenal?* É; o que faltava era a outra metade
 * estar importada, que é um fato sobre o acervo e não sobre o mês.
 *
 * A quinzena não é inventada em nenhum caso: ela sai do **dia** da própria
 * vigência ({@link quinzenaDe}), que é o dia em que ela passou a valer. O que a
 * régua antiga protegia — não afirmar um grão que o calendário não sustenta —
 * segue protegido pelo dia: quando duas entregas do mesmo mês caem na **mesma**
 * metade (`01/08` e `02/08`, ou três no mês), a ordinal deixa de distinguir e o
 * dia entra **junto** com ela, nunca no lugar dela.
 *
 * `compacta` é o dialeto de onde o rótulo por extenso não cabe — o tick do eixo
 * e a linha da barra lateral: `1ªq` em vez de `1ª quinzena`. É o mesmo cálculo,
 * e é por isso que ele mora numa função só: duas concordariam no dia em que
 * fossem escritas e divergiriam no primeiro mês com três entregas.
 *
 * `null` só para o que não é vigência ISO — aí não há dia de onde tirar
 * quinzena, e quem chama devolve o texto como veio.
 */
function marcaDaVigencia(
  data: string,
  doContexto: readonly string[],
  compacta = false,
): string | null {
  const doMes = vigenciasDoMesmoMes(data, doContexto);
  if (doMes === null) return null;

  const quinzena = compacta ? `${quinzenaDe(data)}ªq` : `${quinzenaDe(data)}ª quinzena`;

  /* As entregas do mês não se repartem uma por quinzena: a ordinal sozinha
     escreveria o mesmo texto em duas linhas, e a lista voltaria a oferecer duas
     opções idênticas — o defeito que esta camada existe para não ter.

     No tick, o dia entra sem a palavra: `setembro/2026 · 1ªq · dia 02` medido
     em seis rótulos lado a lado encosta no vizinho e os dois últimos se
     sobrepõem. `· 02` é o mesmo dado com quatro caracteres a menos, e foi o
     que coube. A ordinal fica nos dois casos — encurtar não é o mesmo que
     deixar de dizer a quinzena. */
  const quinzenas = new Set([...doMes].map(quinzenaDe));
  if (quinzenas.size === doMes.size) return quinzena;
  const dia = data.slice(8, 10);
  return compacta ? `${quinzena} · ${dia}` : `${quinzena} · dia ${dia}`;
}

/**
 * O rótulo de uma vigência — `agosto/2026 · 1ª quinzena`.
 *
 * O nome de uma linha só: título de diálogo, coluna de CSV, frase de
 * justificativa. Era `1ª quinzena de agosto/2026`, e passou a ser escrito na
 * ordem da lista — mês primeiro, marca depois — pela razão que
 * {@link rotuloDeListaDaVigencia} documenta: o mês é por onde se procura, e
 * duas ordens para o mesmo nome obrigam quem lê a traduzir de uma tela para a
 * outra.
 *
 * `doContexto` são as vigências da mesma unidade e canal
 * (`periodosDisponiveis`). A própria `data` entra na conta mesmo que não esteja
 * na lista: é o que impede o rótulo de afirmar a mesma quinzena para duas datas
 * ao mesmo tempo quando a chamada vem de fora do conjunto. Chamar sem contexto
 * (`[]`) é legítimo para quem tem uma data só na mão — a quinzena sai do dia da
 * própria vigência, que é tudo de que ela precisa.
 *
 * Nasceu em `@workspace/remuneracao`, que precisou dela primeiro porque a
 * planilha de lá é quinzenal por natureza. Mora aqui desde que a Auditoria
 * passou a precisar da mesma garantia — e continua uma implementação só, pela
 * razão de sempre: duas concordariam no dia em que fossem escritas.
 */
export function rotuloDaVigencia(data: string, doContexto: readonly string[]): string {
  const marca = marcaDaVigencia(data, doContexto);
  return marca === null ? periodLabel(data) : `${periodLabel(data)} · ${marca}`;
}

/**
 * O mesmo rótulo na largura de um tick de eixo — `agosto/2026 · 1ªq`.
 *
 * Existe porque o eixo X do gráfico de impacto desenha seis rótulos lado a lado
 * e não comporta `1ª quinzena` por extenso seis vezes. O que ele **não** faz
 * mais é trocar de idioma: ele escrevia `01/08/2026` — o dia em dígitos — ao
 * lado de `julho/2026` no mesmo eixo, e quem varria os ticks procurando agosto
 * lia três nomes de mês e tinha de traduzir o `08` para o quarto. Aqui o mês é
 * sempre o mês, e o que encurta é só a ordinal.
 *
 * As três funções repartem {@link marcaDaVigencia} de propósito: é a decisão
 * "que marca esta data leva?" que precisa ser uma só.
 */
export function rotuloCurtoDaVigencia(data: string, doContexto: readonly string[]): string {
  const marca = marcaDaVigencia(data, doContexto, true);
  return marca === null ? periodLabel(data) : `${periodLabel(data)} · ${marca}`;
}

/**
 * As vigências do contexto que caem no mesmo mês que `data`, `data` inclusa —
 * o denominador de "este mês precisa de desempate?".
 *
 * `null` quando `data` não é uma vigência ISO: aí não há mês a comparar, e
 * quem chama devolve o texto como veio.
 *
 * A própria `data` entra no conjunto mesmo fora de `doContexto` pelo motivo
 * que {@link rotuloDaVigencia} documenta: sem ela, uma chamada de fora do
 * conjunto afirmaria "mês com uma entrega" para uma data que o contexto nem
 * conhece.
 */
function vigenciasDoMesmoMes(
  data: string,
  doContexto: readonly string[],
): Set<string> | null {
  if (!DATA_ISO.test(data)) return null;
  const mes = data.slice(0, 7);
  const doMes = new Set(doContexto.filter((d) => DATA_ISO.test(d) && d.slice(0, 7) === mes));
  doMes.add(data);
  return doMes;
}

/**
 * O mesmo rótulo de {@link rotuloDaVigencia}, partido em mês e desempate —
 * para as **listas**, onde os rótulos ficam empilhados uns sobre os outros.
 *
 * O seletor de "Trocar vigência" escrevia `rotuloCurtoDaVigencia` puro, e a
 * lista saía assim:
 *
 * ```
 * setembro/2026
 * 02/08/2026
 * 01/08/2026
 * julho/2026
 * ```
 *
 * Quatro linhas da mesma coluna em dois idiomas. Quem varre a lista procurando
 * agosto lê três nomes de mês e depois tem de traduzir `08` para o quarto — e
 * a única razão de as duas do meio estarem escritas em dígitos é que **elas**
 * precisavam de desempate, o que não é uma diferença que interesse a quem está
 * escolhendo o mês.
 *
 * Aqui o mês é sempre o mês (`agosto/2026`), e o desempate vira uma marca à
 * parte (`dia 02`, `2ª quinzena`) que a lista pode pôr em segundo plano. A
 * coluna volta a ser uma coluna de meses, e as duas vigências de agosto
 * continuam distinguíveis — que é o que {@link rotuloDaVigencia} existe para
 * garantir.
 *
 * A régua da marca é a mesma das outras duas, e pela mesma razão de sempre:
 * {@link marcaDaVigencia} decide "que marca esta data leva?" uma vez só. Toda
 * vigência ISO leva a quinzena; o dia entra junto com ela só quando duas
 * entregas do mês caem na mesma metade.
 *
 * `marca` continua podendo ser `null` — e não `""` — para o que não é vigência
 * ISO: a lista decide o que fazer com a ausência, e nenhuma acaba desenhando um
 * separador pendurado no vazio.
 */
export function rotuloDeListaDaVigencia(
  data: string,
  doContexto: readonly string[],
): { mes: string; marca: string | null } {
  return { mes: periodLabel(data), marca: marcaDaVigencia(data, doContexto) };
}
