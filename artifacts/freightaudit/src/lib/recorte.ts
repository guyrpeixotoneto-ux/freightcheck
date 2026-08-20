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
 * O recorte De/Até é outra coisa, e por isso não está neste arquivo: ele não
 * viaja em endereço nenhum, é escolhido dentro da tela e vale nas quatro abas —
 * cada uma sobre o eixo de vigências que a sua conta sustenta.
 *
 * Nada aqui lê a rede nem o React. São strings entrando e strings saindo, o que
 * deixa a regra testável sem montar tela nenhuma.
 */

// ---------------------------------------------------------------------------
// As abas
// ---------------------------------------------------------------------------

export type AbaDeAlteracoes = "planilha" | "chamados" | "impacto" | "cliente";

export const ABAS_DE_ALTERACOES: AbaDeAlteracoes[] = [
  "planilha",
  "chamados",
  "impacto",
  "cliente",
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
 * - **Impacto** recebe unidade e canal, e nada mais. Nem `period` — ela põe
 *   todas as quinzenas lado a lado —, nem filtro de linha, **nem o parâmetro**.
 *   Os dois últimos merecem explicação, porque a primeira versão deste arquivo
 *   deixava o parâmetro passar:
 *
 *   Abrir a matriz já num parâmetro afirma, sem dizer, que foi *aquele* o
 *   assunto da quinzena — e essa porta foi fechada de propósito em 16/08/2026
 *   (ver o cabeçalho de `ImpactoQuinzenas`: o FINAME é o décimo em número de
 *   alterações, e abrir nele fazia parecer que era o primeiro). Sair da aba
 *   pela outra ponta também não serve: o "N alterações" do panorama conta
 *   transições nas **nove** vigências da série, e mandá-lo para a Planilha, que
 *   é de uma vigência só, mostraria um número menor sob o mesmo rótulo.
 *
 *   O que sustenta o número do panorama é a matriz de nove colunas, e clicar na
 *   linha já leva até ela. A cadeia fecha dentro da aba; o que não existe é um
 *   endereço para o meio dela, e inventá-lo custaria uma das duas mentiras
 *   acima.
 * - **Cliente** recebe o mesmo que o Impacto, e pela mesma razão: ela lê a série
 *   inteira, com o recorte De/Até que as abas partilham, e a unidade é o assunto.
 *   Vigência única e filtro de linha ficam de fora — o que ela mostra é o
 *   subconjunto acionável do que o Impacto apurou, não uma lista de alterações.
 * - **Chamados** não recebe nada: o export de chamados é uma população própria,
 *   sem unidade e sem canal, e fingir que tem seria pior do que não filtrar. A
 *   vigência única também não vale ali — a aba recorta por intervalo, e pelo
 *   eixo que os próprios chamados declaram (`Vig. Abertura`), que não é o mesmo
 *   que o das vigências importadas.
 *
 * O De/Até não entra em endereço nenhum, e é decisão e não esquecimento: ele
 * mora na tela porque atravessa as quatro abas durante uma pergunta só, e quem
 * chega de fora chega no começo dela — com a série inteira à vista, que é onde
 * a pergunta começa.
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
      // Só a Planilha responde por uma vigência. Impacto e Cliente leem a série
      // inteira, e uma vigência ali estreitaria a leitura a uma coluna.
      comPeriodo: aba === "planilha",
    })) {
      params.set(chave, valor);
    }
  }

  // Filtro de linha é assunto da Planilha, e só dela — a razão de o Impacto
  // ficar de fora está no cabeçalho, e não é de implementação.
  if (aba === "planilha") {
    for (const chave of FILTROS_NA_URL) {
      const valor = filtros[chave];
      if (valor) params.set(chave, valor);
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

/**
 * O caminho para os Parâmetros do mesmo recorte.
 *
 * Irmão de `linkDaVisaoGeral`, e existe pela mesma razão: quem escolheu a
 * unidade num lugar não deve reescolhê-la no seguinte. A Visão Gerencial usa
 * este link porque a pergunta que ela deixa em aberto — "3.202 alterações no
 * ano, e o que mudou?" — é a que a grade de atributos responde.
 *
 * **O recorte inclui a vigência de propósito.** Parâmetros lê uma quinzena por
 * vez, e sem `period` ele abriria a mais recente do banco — que pode não ser a
 * mais recente *daquela unidade*, e aí o número da tela seria de outro mês que
 * ninguém pediu. Quem chama manda a vigência que o cartão de origem anunciou.
 */
export function linkDosParametros(recorte: Recorte): string {
  const consulta = paramsDoRecorte(recorte).toString();
  return consulta ? `/parametros?${consulta}` : "/parametros";
}
