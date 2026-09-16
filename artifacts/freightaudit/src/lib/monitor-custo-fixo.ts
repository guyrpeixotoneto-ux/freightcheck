import type {
  BaldeDoMonitor,
  LinhaDoMonitor,
  ModuloDoMonitor,
  ResumoDoMonitor,
  SituacaoDoImpacto,
} from "@workspace/comparison/monitor-custo-fixo";
import {
  MODULOS_DO_MONITOR,
  ROTA_DO_MODULO,
  SITUACOES_DO_IMPACTO,
} from "@workspace/comparison/monitor-custo-fixo";
import { formatBrl } from "@/lib/format";

/**
 * A leitura do Monitor Custo Fixo — **escrever números, nunca produzi-los**.
 *
 * Toda função deste arquivo recebe algo que o servidor já decidiu e devolve
 * texto, cor ou ordem. Não há soma, subtração, conversão de periodicidade nem
 * derivação de impacto em lugar nenhum — e não é estilo: é o contrato da tela.
 * O dinheiro do Monitor é o dinheiro que cada módulo publicou, e um `+` neste
 * arquivo seria a quinta régua da mesma pergunta.
 *
 * A única aritmética que existe aqui é de **ordenação e de paginação** — que
 * não é de dinheiro: ordenar por impacto compara dois números já apurados, e
 * paginar fatia uma lista.
 *
 * Nada de React neste arquivo, pelo mesmo motivo de `lib/cockpit.ts`: é assim
 * que ele roda no vitest sem montar tela nenhuma.
 */

// ---------------------------------------------------------------------------
// O estado da tela, e como ele vive no endereço
// ---------------------------------------------------------------------------

/**
 * Os filtros do Monitor, como a URL os carrega.
 *
 * Eles moram no endereço — e não em `useState` — por uma razão operacional: o
 * caminho normal desta tela é *ver uma alteração → abrir a auditoria dela →
 * voltar*. Com o estado só na memória, o "voltar" do navegador devolvia a tela
 * zerada, e quem estava lendo as reduções de agosto em Camaçari recomeçava do
 * início. No endereço, voltar devolve exatamente o que se estava lendo — e o
 * endereço ainda vira link.
 */
export interface FiltrosDoMonitor {
  base: string;
  comparada: string;
  modulos: ModuloDoMonitor[];
  equipamento: string | null;
  situacoes: SituacaoDoImpacto[];
  periodicidades: string[];
  busca: string;
}

export const FILTROS_VAZIOS: FiltrosDoMonitor = {
  base: "",
  comparada: "",
  modulos: [],
  equipamento: null,
  situacoes: [],
  periodicidades: [],
  busca: "",
};

const EQUIPAMENTOS_VALIDOS = ["CAVALO", "CARRETA"];

function listaDa(q: URLSearchParams, chave: string): string[] {
  return (q.get(chave) ?? "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter((v) => v !== "");
}

/**
 * Os filtros que o endereço declara — **com o inválido caindo no padrão**.
 *
 * Um `situacao=TALVEZ` na URL não esvazia a tela: ele é descartado, e a tela
 * abre como se ninguém tivesse filtrado por situação. É a mesma decisão que a
 * rota toma do outro lado, e ela é deliberada nos dois: recortar por um valor
 * que não existe daria zero linhas, correto e inexplicável.
 */
export function lerFiltros(search: string): FiltrosDoMonitor {
  const q = new URLSearchParams(search);
  const equipamento = (q.get("equipamento") ?? "").trim().toUpperCase();
  return {
    base: q.get("base") ?? "",
    comparada: q.get("comparada") ?? "",
    modulos: listaDa(q, "modulo").filter((m): m is ModuloDoMonitor =>
      (MODULOS_DO_MONITOR as readonly string[]).includes(m),
    ),
    equipamento: EQUIPAMENTOS_VALIDOS.includes(equipamento) ? equipamento : null,
    situacoes: listaDa(q, "situacao").filter((s): s is SituacaoDoImpacto =>
      (SITUACOES_DO_IMPACTO as readonly string[]).includes(s),
    ),
    periodicidades: listaDa(q, "periodicidade"),
    busca: q.get("busca") ?? "",
  };
}

/** Os filtros de volta para o endereço. O que é padrão não aparece na URL. */
export function escreverFiltros(f: FiltrosDoMonitor): string {
  const q = new URLSearchParams();
  if (f.base) q.set("base", f.base);
  if (f.comparada) q.set("comparada", f.comparada);
  if (f.modulos.length > 0) q.set("modulo", f.modulos.join(","));
  if (f.equipamento) q.set("equipamento", f.equipamento);
  if (f.situacoes.length > 0) q.set("situacao", f.situacoes.join(","));
  if (f.periodicidades.length > 0) q.set("periodicidade", f.periodicidades.join(","));
  if (f.busca.trim() !== "") q.set("busca", f.busca.trim());
  return q.toString();
}

/**
 * Só o recorte — os filtros sem o par.
 *
 * É o que `/monitor-custo-fixo/candidatos` recebe além do "Para": ali a
 * pergunta é *quanto cada candidata a "De" produziria*, então mandar o par
 * escolhido junto seria mandar a resposta junto com a pergunta.
 *
 * Escrito sobre {@link escreverFiltros} de propósito. Uma segunda serialização
 * dos mesmos cinco filtros divergiria da primeira no dia em que um sexto
 * entrasse — e a divergência apareceria como um menu respondendo por um recorte
 * e a tela por outro, que é exatamente o que mandar os filtros pretende evitar.
 */
export function escreverRecorte(f: FiltrosDoMonitor): string {
  return escreverFiltros({ ...f, base: "", comparada: "" });
}

/**
 * O endereço da auditoria de origem, com o contexto que ela sabe honrar.
 *
 * `base` e `comparada` vão porque as quatro telas passaram a lê-los
 * (`parDaUrl`, em `lib/par-de-vigencias.ts`); `scopeHash` e `canal` vão porque
 * elas sempre os leram. **O que não vai são os filtros do Monitor** — situação,
 * periodicidade e módulo não existem naquelas telas, e mandá-los seria prometer
 * um recorte que a auditoria não aplica. É a mesma recusa que `lib/recorte.ts`
 * escreve sobre as abas de Alterações, e pela mesma razão.
 */
export function enderecoDaAuditoria(
  linha: Pick<LinhaDoMonitor, "modulo" | "par">,
  contexto: { scopeHash: string | null; canal: string | null },
): string {
  const q = new URLSearchParams();
  q.set("base", linha.par.baseId);
  q.set("comparada", linha.par.comparadaId);
  if (contexto.scopeHash) q.set("scopeHash", contexto.scopeHash);
  if (contexto.canal) q.set("canal", contexto.canal);
  return `${ROTA_DO_MODULO[linha.modulo]}?${q.toString()}`;
}

/**
 * O endereço de volta para o Monitor, com o estado inteiro.
 *
 * É o que o "voltar" da auditoria usa, e é por isso que ele existe separado do
 * histórico do navegador: quem chega à auditoria por um link colado não tem
 * histórico para voltar, e mesmo assim precisa de um caminho de volta que não
 * seja a tela zerada.
 */
export function enderecoDoMonitor(f: FiltrosDoMonitor): string {
  const query = escreverFiltros(f);
  return query === "" ? "/monitor-custo-fixo" : `/monitor-custo-fixo?${query}`;
}

// ---------------------------------------------------------------------------
// A escrita dos números
// ---------------------------------------------------------------------------

/** Como cada periodicidade se diz ao lado de um valor. */
export const SUFIXO_DA_PERIODICIDADE: Record<string, string> = {
  MENSAL: "/mês",
  ANUAL: "/ano",
  QUINZENAL: "/quinzena",
  DIARIO: "/dia",
  PONTUAL: " no evento",
  UNICO: " no evento",
  SEM_PERIODICIDADE: "",
};

export const ROTULO_DA_PERIODICIDADE: Record<string, string> = {
  MENSAL: "Mensal",
  ANUAL: "Anual",
  QUINZENAL: "Quinzenal",
  DIARIO: "Diário",
  PONTUAL: "Pontual",
  UNICO: "Pontual",
  SEM_PERIODICIDADE: "Sem periodicidade declarada",
};

export const rotuloDaPeriodicidade = (p: string): string =>
  ROTULO_DA_PERIODICIDADE[p] ?? p;

/**
 * Um valor com a periodicidade colada — `R$ 310,00/mês`.
 *
 * A periodicidade **nunca** fica só no cabeçalho da coluna: uma célula que diz
 * "R$ 310,00" ao lado de outra que diz "R$ 145.000,00" convida a somar, e as
 * duas podem ser de grandezas diferentes. O sufixo é o que impede a soma de
 * cabeça, e é por isso que ele é parte do número e não um enfeite.
 */
export function escreverImpacto(
  valor: number | null,
  periodicidade: string | null,
): string {
  if (valor === null) return "—";
  return `${formatBrl(valor)}${SUFIXO_DA_PERIODICIDADE[periodicidade ?? ""] ?? ""}`;
}

/**
 * O que a célula de impacto diz quando **não** há número.
 *
 * Nunca "R$ 0,00", e nunca em branco: as duas mentiriam, uma afirmando uma
 * medição que não houve e a outra escondendo que houve alteração. A frase curta
 * fica na célula e o motivo inteiro fica no painel lateral — que é onde cabe.
 */
export const FRASE_DA_SITUACAO: Record<SituacaoDoImpacto, string> = {
  VALORADO: "",
  SEM_VALORACAO: "Sem valoração",
  NAO_MONETARIA: "Não é dinheiro",
  FORA_DO_TOTAL: "Fora do total",
};

/**
 * A cor de uma direção — e **por que ela nunca vem sozinha**.
 *
 * `docs/LINGUAGEM-VISUAL.md` reserva o verde para redução e o vermelho para
 * aumento crítico, e esta função respeita isso. O que ela não faz é carregar a
 * informação: a tabela escreve "Aumento" e "Redução" por extenso ao lado da
 * seta, porque quem não distingue as duas cores continua precisando saber para
 * que lado o número foi.
 *
 * E o sinal é o da **rubrica**, não o do resultado: num módulo de receita, um
 * aumento é mais dinheiro entrando. Quem diz de que lado da DRE aquilo está é a
 * natureza, escrita ao lado.
 */
export function corDaDirecao(
  direcao: LinhaDoMonitor["impacto"]["direcao"],
): string {
  if (direcao === "AUMENTO") return "text-destructive";
  if (direcao === "REDUCAO") return "text-emerald-700 dark:text-emerald-400";
  return "text-muted-foreground";
}

// ---------------------------------------------------------------------------
// A ordenação da tabela
// ---------------------------------------------------------------------------

export type ColunaOrdenavel =
  | "prioridade"
  | "modulo"
  | "identificacao"
  | "variavel"
  | "impacto";

export interface Ordenacao {
  coluna: ColunaOrdenavel;
  ascendente: boolean;
}

export const ORDENACAO_PADRAO: Ordenacao = { coluna: "prioridade", ascendente: false };

/**
 * A ordem da tabela.
 *
 * "Impacto" ordena por **valor absoluto**, e isso é deliberado: quem procura o
 * que mexeu mais no mês quer a maior variação, e uma redução de R$ 6 mil mexeu
 * tanto quanto um aumento de R$ 6 mil. Ordenar pelo sinal poria as reduções
 * todas num extremo e esconderia as maiores delas atrás de trinta aumentos
 * pequenos.
 *
 * **Periodicidades diferentes não se comparam**, e a ordenação não finge que
 * sim: linhas sem valor vão para o fim, e a coluna mostra o sufixo em cada
 * célula, de modo que ninguém leia a ordem como um ranking de reais
 * equivalentes.
 */
export function ordenar(
  linhas: readonly LinhaDoMonitor[],
  ordem: Ordenacao,
): LinhaDoMonitor[] {
  const sinal = ordem.ascendente ? 1 : -1;
  const chave = (l: LinhaDoMonitor): number | string => {
    switch (ordem.coluna) {
      case "prioridade":
        return l.prioridade.score;
      case "modulo":
        return l.origem.rotulo;
      case "identificacao":
        return l.entidade.rotulo;
      case "variavel":
        return l.variavel.rotulo;
      case "impacto":
        return l.impacto.valor === null ? Number.NEGATIVE_INFINITY : Math.abs(l.impacto.valor);
    }
  };
  return [...linhas].sort((a, b) => {
    const x = chave(a);
    const y = chave(b);
    if (typeof x === "string" || typeof y === "string") {
      return String(x).localeCompare(String(y)) * sinal;
    }
    if (x === y) return a.id.localeCompare(b.id);
    return (x < y ? -1 : 1) * sinal;
  });
}

/** Uma página da tabela. Fatiar uma lista não é conta de dinheiro. */
export function paginar<T>(itens: readonly T[], pagina: number, porPagina: number): T[] {
  const inicio = (pagina - 1) * porPagina;
  return itens.slice(inicio, inicio + porPagina);
}

// ---------------------------------------------------------------------------
// Os blocos de periodicidade
// ---------------------------------------------------------------------------

/**
 * Os baldes que valem a pena mostrar, na ordem em que se leem.
 *
 * Um balde em que nada se moveu — nem custo, nem receita — não vira cartão: ele
 * ocuparia a mesma altura de um que custou R$ 145 mil, e a fileira inteira
 * perderia hierarquia. Ele não é escondido: a contagem de alterações continua
 * inteira, e a tabela continua listando cada linha.
 */
export function baldesVisiveis(resumo: ResumoDoMonitor): BaldeDoMonitor[] {
  return resumo.baldes.filter(
    (b) => b.custo.liquido !== 0 || b.receita.liquido !== 0,
  );
}

/** Há mais de uma periodicidade em jogo? É o que decide mostrar blocos. */
export const temMaisDeUmaPeriodicidade = (resumo: ResumoDoMonitor): boolean =>
  baldesVisiveis(resumo).length > 1;
