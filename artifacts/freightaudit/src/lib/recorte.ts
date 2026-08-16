/**
 * O recorte — a língua em que a Visão geral e as Alterações conversam.
 *
 * As duas telas respondem sobre a mesma população por caminhos diferentes: a
 * primeira mostra cinco números da vigência aberta, a segunda mostra as linhas
 * que produziram esses números. Enquanto o caminho entre elas foi um `/alteracoes`
 * pelado, a conversa não existia: quem estava lendo julho de CAMAÇARI e clicava
 * em "Ver todas" caía na vigência mais recente da unidade padrão, sem uma
 * palavra dizendo que o assunto tinha mudado. Os números não batiam, e não havia
 * como saber por quê.
 *
 * Este arquivo é o vocabulário dessa conversa, num lugar só:
 *
 * - **o recorte** (unidade, canal, vigência) — os mesmos três parâmetros que
 *   Parâmetros já usa, com os mesmos nomes;
 * - **os filtros de linha** que um link pode deixar pré-aplicados;
 * - **em que aba** de Alterações a resposta mora;
 * - e, o mais importante, **o que cada aba sabe honrar**. A vigência não vale na
 *   aba Impacto — ela mostra todas as quinzenas lado a lado, e mandar `period`
 *   para lá seria prometer um filtro que a tela não aplica. Chamados não sabe
 *   nem de unidade: o export de chamados é uma população própria. Estas duas
 *   recusas ficam escritas aqui, e não em cada `<Link>`, porque um endereço
 *   montado à mão numa tela é exatamente onde a promessa vazia nasce.
 *
 * Nada aqui lê a rede nem o React. São strings entrando e strings saindo, o que
 * deixa a regra testável sem montar tela nenhuma.
 */

// ---------------------------------------------------------------------------
// As abas
// ---------------------------------------------------------------------------

export type AbaDeAlteracoes = "planilha" | "chamados" | "impacto";

export const ABAS_DE_ALTERACOES: AbaDeAlteracoes[] = [
  "planilha",
  "chamados",
  "impacto",
];

export const abaValida = (valor: string | null): valor is AbaDeAlteracoes =>
  valor !== null && (ABAS_DE_ALTERACOES as string[]).includes(valor);

// ---------------------------------------------------------------------------
// O recorte
// ---------------------------------------------------------------------------

/**
 * De quem e de quando é o que está na tela.
 *
 * `canal` é `string | null` e o `null` **é** um valor: quer dizer "as vigências
 * sem canal legível no rótulo", que é uma partição real da base e não a ausência
 * de escolha. Quem não escolheu canal nenhum não tem a chave — ver
 * `parseContext` em `routes/changes.ts`, que faz a mesma distinção do outro
 * lado.
 */
export interface Recorte {
  period: string | null;
  scopeHash: string | null;
  canal: string | null;
}

export const RECORTE_VAZIO: Recorte = {
  period: null,
  scopeHash: null,
  canal: null,
};

function texto(params: URLSearchParams, chave: string): string | null {
  return params.has(chave) ? (params.get(chave) ?? "") : null;
}

/** O recorte que está escrito num endereço. */
export function lerRecorte(search: string | URLSearchParams): Recorte {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    // Vigência vazia não é vigência: `?period=` sem valor viraria um filtro que
    // o servidor descarta em silêncio, e a tela anunciaria um recorte que não
    // aconteceu.
    period: params.get("period") || null,
    scopeHash: params.get("scopeHash") || null,
    canal: texto(params, "canal"),
  };
}

/** Se o recorte diz alguma coisa — usado para saber se há o que anunciar. */
export function temRecorte(recorte: Recorte): boolean {
  return (
    recorte.period !== null ||
    recorte.scopeHash !== null ||
    recorte.canal !== null
  );
}

/**
 * O recorte como a API o recebe.
 *
 * `comPeriodo: false` é para quem lê todas as vigências de uma vez — a aba
 * Impacto —, onde mandar a vigência escolhida encolheria uma série temporal a um
 * ponto sem que ninguém tivesse pedido.
 */
export function paramsDoRecorte(
  recorte: Recorte,
  { comPeriodo = true }: { comPeriodo?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (comPeriodo && recorte.period !== null) params.set("period", recorte.period);
  if (recorte.scopeHash !== null) params.set("scopeHash", recorte.scopeHash);
  if (recorte.canal !== null) params.set("canal", recorte.canal);
  return params;
}

// ---------------------------------------------------------------------------
// Os filtros de linha
// ---------------------------------------------------------------------------

/**
 * Os filtros que atravessam a URL — os mesmos nomes de `Filters` na aba
 * Planilha e de `ChangeFilters` no servidor.
 *
 * A lista é explícita, e não `Object.keys(emptyFilters)`, para que acrescentar
 * um filtro na tela seja uma decisão consciente sobre se ele deve viajar num
 * link: um recorte que chega pela URL é um recorte que alguém vai colar num
 * chat, e ele precisa continuar querendo dizer a mesma coisa amanhã.
 */
export const FILTROS_NA_URL = [
  "attributeCode",
  "entityType",
  "impactConfidence",
  "costClass",
  "changeType",
  "semanticsStatus",
  "comparability",
  "minAbsImpact",
  "search",
] as const;

export type FiltroDeLinha = (typeof FILTROS_NA_URL)[number];

export type FiltrosDeLinha = Partial<Record<FiltroDeLinha, string>>;

/** Os filtros que um endereço pede. Vazios não entram: não filtram nada. */
export function lerFiltros(search: string | URLSearchParams): FiltrosDeLinha {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const filtros: FiltrosDeLinha = {};
  for (const chave of FILTROS_NA_URL) {
    const valor = params.get(chave);
    if (valor) filtros[chave] = valor;
  }
  return filtros;
}

// ---------------------------------------------------------------------------
// Os endereços
// ---------------------------------------------------------------------------

export interface DestinoDeAlteracoes {
  aba?: AbaDeAlteracoes;
  recorte?: Recorte;
  filtros?: FiltrosDeLinha;
  /** A série (`CAVALO`, `CARRETA`) quando o destino é a comparação dela. */
  serie?: string | null;
}

/**
 * O endereço de uma pergunta dentro de Alterações.
 *
 * Cada aba leva só o que sabe honrar, e o corte é feito aqui:
 *
 * - **Planilha** honra tudo: é a lista das linhas da vigência.
 * - **Impacto** não recebe `period` (mostra todas as quinzenas) nem filtro de
 *   linha que ela não aplica — sobram unidade, canal e, quando faz sentido, o
 *   equipamento e o parâmetro, que são as duas escolhas da própria aba.
 * - **Chamados** não recebe nada: os chamados não são recortados por unidade
 *   nem por vigência em lugar nenhum do produto, e fingir que são seria pior do
 *   que não filtrar.
 *
 * A aba `planilha` não é escrita no endereço por ser o padrão de quem abre
 * `/alteracoes` — um `?aba=planilha` a mais em todo link do produto é ruído que
 * não muda nada.
 */
export function linkDeAlteracoes(destino: DestinoDeAlteracoes = {}): string {
  const consulta = paramsDeAlteracoes(destino).toString();
  return consulta ? `/alteracoes?${consulta}` : "/alteracoes";
}

/**
 * O mesmo endereço, ainda em peças — para quem já está em Alterações.
 *
 * Trocar de aba dentro da tela não é montar um link novo: é passar o endereço
 * atual pelo mesmo crivo, para que os recortes que a aba de destino não honra
 * caiam fora em vez de ficarem escritos na barra parecendo aplicados. A
 * navegação também precisa preservar o caminho (`/impacto-financeiro` continua
 * `/impacto-financeiro`), e por isso recebe as peças em vez da string pronta.
 */
export function paramsDeAlteracoes({
  aba = "planilha",
  recorte = RECORTE_VAZIO,
  filtros = {},
  serie = null,
}: DestinoDeAlteracoes = {}): URLSearchParams {
  const params = new URLSearchParams();
  if (aba !== "planilha") params.set("aba", aba);

  if (aba !== "chamados") {
    for (const [chave, valor] of paramsDoRecorte(recorte, {
      comPeriodo: aba === "planilha",
    })) {
      params.set(chave, valor);
    }
  }

  if (aba === "planilha" || aba === "impacto") {
    for (const chave of FILTROS_NA_URL) {
      const valor = filtros[chave];
      if (!valor) continue;
      // A aba Impacto escolhe um parâmetro e um equipamento, e mais nada. Um
      // `impactConfidence` mandado para lá não filtraria a matriz — ficaria no
      // endereço parecendo um recorte aplicado.
      if (aba === "impacto" && chave !== "attributeCode" && chave !== "entityType") {
        continue;
      }
      params.set(chave, valor);
    }
  }

  if (aba === "planilha" && serie) params.set("serie", serie);

  return params;
}

/**
 * O nome da unidade, igual nas duas telas.
 *
 * Sem escopo cadastrado sobra o rótulo que o servidor montou ("CAMAÇARI ·
 * EMPURRADA"), que é sempre verdadeiro e às vezes feio. Mora aqui, e não em
 * cada tela, porque a faixa de Alterações precisa dizer exatamente a mesma
 * unidade que o título da Visão geral — duas grafias do mesmo lugar fariam
 * parecer que o recorte mudou no caminho.
 */
export function nomeDaUnidade(contexto: {
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
}): string {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? contexto.label;
}

/**
 * O caminho de volta — a Visão geral do mesmo recorte.
 *
 * A volta existe porque a ida aplica um filtro: quem chegou às 244 alterações
 * sem preço precisa poder voltar aos cinco números de onde as 244 saíram sem
 * refazer a escolha de unidade e de vigência no caminho.
 */
export function linkDaVisaoGeral(recorte: Recorte): string {
  const consulta = paramsDoRecorte(recorte).toString();
  return consulta ? `/?${consulta}` : "/";
}
