import type {
  LinhaDoMonitorDeEquipe,
  QuadroDeQlp,
  SituacaoDaLinhaDeEquipe,
} from "@workspace/comparison/monitor-equipe";
import {
  MODULO_DO_CARGO,
  ROTA_DO_QUADRO,
  SITUACOES_DA_EQUIPE,
} from "@workspace/comparison/monitor-equipe";
import { escreverRubrica } from "@/lib/qlp-comparacao";

/**
 * A leitura do Monitor Equipe — **escrever o que o servidor decidiu, nunca
 * produzi-lo**.
 *
 * Toda função deste arquivo recebe algo pronto e devolve texto, endereço ou
 * ordem. Não há soma de dinheiro porque não há dinheiro nesta seção — as
 * colunas do QLP chegam sem semântica confirmada, e a tela escreve a frase do
 * travamento onde o Monitor Custo Fixo escreve reais. E não há soma de efetivo
 * porque a do efetivo mora no quadro, sobre as duas pontas inteiras: derivá-la
 * aqui daria −1 num quadro que perdeu um cargo de quatro posições.
 *
 * A única aritmética que existe aqui é de **ordenação e de paginação** —
 * comparar dois scores já apurados e fatiar uma lista.
 *
 * Nada de React neste arquivo, pelo mesmo motivo de `lib/monitor-custo-fixo.ts`:
 * é assim que ele roda no vitest sem montar tela nenhuma.
 */

// ---------------------------------------------------------------------------
// O estado da tela, e como ele vive no endereço
// ---------------------------------------------------------------------------

/**
 * Os filtros do Monitor Equipe, como a URL os carrega.
 *
 * **Há dois pares, e não um.** O administrativo e o operacional são séries
 * próprias — o motor recusa comparar coberturas diferentes —, então cada quadro
 * escolhe as duas pontas dele. Um par único da tela obrigaria a casar as duas
 * séries por posição, que é como o par errado aparece embaixo do rótulo certo.
 *
 * Eles moram no endereço — e não em `useState` — pela razão do outro Monitor: o
 * caminho normal é *ver uma alteração → abrir o módulo dela → voltar*, e com o
 * estado só na memória o "voltar" devolvia a tela zerada.
 */
export interface FiltrosDoMonitorDeEquipe {
  baseOperacional: string;
  comparadaOperacional: string;
  baseAdministrativo: string;
  comparadaAdministrativo: string;
  modulos: string[];
  quadros: QuadroDeQlp[];
  situacoes: SituacaoDaLinhaDeEquipe[];
  busca: string;
}

export const FILTROS_VAZIOS: FiltrosDoMonitorDeEquipe = {
  baseOperacional: "",
  comparadaOperacional: "",
  baseAdministrativo: "",
  comparadaAdministrativo: "",
  modulos: [],
  quadros: [],
  situacoes: [],
  busca: "",
};

export const QUADROS_DO_MONITOR: readonly QuadroDeQlp[] = ["OPERACIONAL", "ADMINISTRATIVO"];

function listaDa(q: URLSearchParams, chave: string): string[] {
  return (q.get(chave) ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");
}

/**
 * Os filtros que o endereço declara — **com o inválido caindo no padrão**.
 *
 * Um `situacao=TALVEZ` na URL não esvazia a tela: ele é descartado, e a tela
 * abre como se ninguém tivesse filtrado por situação. É a mesma decisão que a
 * rota toma do outro lado, e ela é deliberada nos dois — recortar por um valor
 * que não existe daria zero linhas, correto e inexplicável.
 *
 * O módulo é a exceção que confirma a regra: quem valida a lista de rubricas é
 * a **rota**, contra o catálogo, e ela devolve o que ignorou. Uma segunda lista
 * escrita aqui recusaria amanhã a rubrica que a lateral já oferece.
 */
export function lerFiltros(search: string): FiltrosDoMonitorDeEquipe {
  const q = new URLSearchParams(search);
  return {
    baseOperacional: q.get("baseOperacional") ?? "",
    comparadaOperacional: q.get("comparadaOperacional") ?? "",
    baseAdministrativo: q.get("baseAdministrativo") ?? "",
    comparadaAdministrativo: q.get("comparadaAdministrativo") ?? "",
    modulos: listaDa(q, "modulo"),
    quadros: listaDa(q, "quadro")
      .map((v) => v.toUpperCase())
      .filter((v): v is QuadroDeQlp => (QUADROS_DO_MONITOR as readonly string[]).includes(v)),
    situacoes: listaDa(q, "situacao")
      .map((v) => v.toUpperCase())
      .filter((s): s is SituacaoDaLinhaDeEquipe =>
        (SITUACOES_DA_EQUIPE as readonly string[]).includes(s),
      ),
    busca: q.get("busca") ?? "",
  };
}

/** Os filtros de volta para o endereço. O que é padrão não aparece na URL. */
export function escreverFiltros(f: FiltrosDoMonitorDeEquipe): string {
  const q = new URLSearchParams();
  if (f.baseOperacional) q.set("baseOperacional", f.baseOperacional);
  if (f.comparadaOperacional) q.set("comparadaOperacional", f.comparadaOperacional);
  if (f.baseAdministrativo) q.set("baseAdministrativo", f.baseAdministrativo);
  if (f.comparadaAdministrativo) q.set("comparadaAdministrativo", f.comparadaAdministrativo);
  if (f.modulos.length > 0) q.set("modulo", f.modulos.join(","));
  if (f.quadros.length > 0) q.set("quadro", f.quadros.join(","));
  if (f.situacoes.length > 0) q.set("situacao", f.situacoes.join(","));
  if (f.busca.trim() !== "") q.set("busca", f.busca.trim());
  return q.toString();
}

/**
 * O RECORTE QUE O MENU DE VIGÊNCIAS PERGUNTA — e o que ele deliberadamente não
 * manda.
 *
 * `/monitor-equipe/candidatos` conta, por candidata a "De", as alterações que
 * **aquele** recorte produziria. Então vai o quadro da aba e vão os três
 * filtros que recortam linhas (módulo, situação, busca): o número do menu tem
 * de ser o número que o clique entrega, e um menu que contasse o quadro inteiro
 * com "salário" ligado prometeria alterações que a tabela não mostraria.
 *
 * **O par não vai.** As duas pontas do endereço são o que o menu está ajudando
 * a trocar: mandá-las junto só faria a consulta refazer-se a cada escolha, e
 * quem responde pelo "Para" é o parâmetro `para` da própria rota. A busca chega
 * aqui já adiada por quem chama (`useTextoAdiado`), e não a cada tecla.
 */
export function escreverRecorteDoMenuDeEquipe(
  f: FiltrosDoMonitorDeEquipe,
  quadro: QuadroDeQlp,
  busca = f.busca,
): string {
  const q = new URLSearchParams();
  q.set("quadro", quadro);
  if (f.modulos.length > 0) q.set("modulo", f.modulos.join(","));
  if (f.situacoes.length > 0) q.set("situacao", f.situacoes.join(","));
  if (busca.trim() !== "") q.set("busca", busca.trim());
  return q.toString();
}

/** O endereço do Monitor com o estado inteiro — o "voltar" que não zera a tela. */
export function enderecoDoMonitorDeEquipe(f: FiltrosDoMonitorDeEquipe): string {
  const query = escreverFiltros(f);
  return query === "" ? "/monitor-equipe" : `/monitor-equipe?${query}`;
}

/**
 * O endereço da tela de origem de uma linha, com o par **daquele quadro**.
 *
 * O módulo por assunto (`/qlp/<rubrica>`) abre na aba do quadro certo; o eixo
 * do cargo — quem entrou e quem saiu — abre a tela do quadro, na aba de
 * comparação, porque é lá que o cargo se lê inteiro.
 *
 * **O que não vai são os filtros do Monitor**: módulo e situação não existem
 * naquelas telas, e mandá-los seria prometer um recorte que elas não aplicam. É
 * a mesma recusa que `lib/monitor-custo-fixo.ts` escreve, e pela mesma razão.
 */
export function enderecoDaOrigem(
  linha: Pick<LinhaDoMonitorDeEquipe, "modulo" | "quadro" | "par">,
  contexto: { scopeHash: string | null; canal: string | null },
): string {
  const q = new URLSearchParams();
  q.set("quadro", linha.quadro);
  q.set("base", linha.par.baseId);
  q.set("comparada", linha.par.comparadaId);
  if (contexto.scopeHash) q.set("scopeHash", contexto.scopeHash);
  if (contexto.canal) q.set("canal", contexto.canal);
  if (linha.modulo === MODULO_DO_CARGO) {
    q.set("aba", "comparacao");
    return `${ROTA_DO_QUADRO[linha.quadro]}?${q.toString()}`;
  }
  return `/qlp/${linha.modulo}?${q.toString()}`;
}

// ---------------------------------------------------------------------------
// A escrita
// ---------------------------------------------------------------------------

/**
 * O nome de um módulo na tela.
 *
 * Sai de `ROTULO_DA_RUBRICA` — o mesmo dicionário da lateral e das telas por
 * assunto —, e não de uma segunda tabela: dois nomes para a mesma rubrica
 * fariam quem clica em "Vale-transporte" na lateral chegar a uma tela chamada
 * "transporte".
 */
export const ROTULO_DO_MODULO_DO_CARGO = "Entradas e saídas de cargo";

export function escreverModulo(modulo: string): string {
  return modulo === MODULO_DO_CARGO ? ROTULO_DO_MODULO_DO_CARGO : escreverRubrica(modulo);
}

/**
 * O que a célula de situação diz — e o que ela **nunca** diz.
 *
 * Nunca "R$ 0,00", e nunca em branco: as duas mentiriam, uma afirmando uma
 * medição que não houve e a outra escondendo que houve alteração. A frase curta
 * fica na célula e o motivo inteiro fica no painel lateral, que é onde cabe.
 */
export const FRASE_DA_SITUACAO_DE_EQUIPE: Record<SituacaoDaLinhaDeEquipe, string> = {
  EFETIVO: "Efetivo",
  SEM_VALORACAO: "Sem valoração",
  FORA_DA_SOMA: "Fora da soma",
  NAO_MONETARIA: "Não monetária",
};

/**
 * A ajuda de cada situação — por que aquela linha está naquela gaveta.
 *
 * Elas existem porque "sem valoração" numa tela de quadro de pessoal é o tipo
 * de rótulo que parece defeito do produto. Ele não é: é o travamento do QLP
 * dito em duas palavras, e a frase inteira está no painel.
 */
export const AJUDA_DA_SITUACAO_DE_EQUIPE: Record<SituacaoDaLinhaDeEquipe, string> = {
  EFETIVO:
    "Coluna de quantidade — posições, linhas de telefone, uniformes. É a única grandeza que este produto soma no QLP, porque ela é de gente e não depende da curadoria de semântica.",
  SEM_VALORACAO:
    "Coluna de dinheiro que não vira número: as colunas do QLP chegam sem semântica confirmada, e somar o que a curadoria não confirmou seria adivinhação. Não é R$ 0,00 — é a ausência de uma medição.",
  FORA_DA_SOMA:
    "Subtotal, benchmark ou coluna que o catálogo marcou: ou já contém as parcelas das outras linhas, ou é régua e não custo. Continua na tabela, e continua contada.",
  NAO_MONETARIA:
    "Não mede dinheiro por natureza — turno, unidade, cargo, uma taxa. Não há conversão em reais a esperar por ela.",
};

/**
 * Para que lado uma diferença foi — e a cor **nunca vem sozinha**.
 *
 * A tabela escreve a seta e a palavra, porque quem não distingue as duas cores
 * continua precisando saber para que lado o número foi. E o sinal é o da
 * coluna, não o do resultado: num quadro de pessoal, mais efetivo não é
 * automaticamente pior — é mais gente, e quem julga isso é quem audita.
 */
export function corDaDiferencaDeEquipe(diferenca: number | null): string {
  if (diferenca === null || diferenca === 0) return "text-muted-foreground";
  return diferenca > 0
    ? "text-destructive"
    : "text-emerald-700 dark:text-emerald-400";
}

// ---------------------------------------------------------------------------
// A ordenação da tabela
// ---------------------------------------------------------------------------

export type ColunaOrdenavel =
  | "prioridade"
  | "modulo"
  | "quadro"
  | "cargo"
  | "variavel"
  | "diferenca";

export interface Ordenacao {
  coluna: ColunaOrdenavel;
  ascendente: boolean;
}

export const ORDENACAO_PADRAO: Ordenacao = { coluna: "prioridade", ascendente: false };

/**
 * A ordem da tabela.
 *
 * "Diferença" ordena por **valor absoluto**, pela razão do outro Monitor: quem
 * procura o que mais se moveu quer a maior variação, e uma queda de três
 * posições moveu tanto quanto uma alta de três. Linhas sem diferença vão para o
 * fim — e nunca para o começo como se fossem zero.
 *
 * **Grandezas diferentes não se comparam**, e a ordenação não finge que sim: a
 * coluna escreve a unidade de cada célula, de modo que ninguém leia a ordem
 * como um ranking de valores equivalentes.
 */
export function ordenar(
  linhas: readonly LinhaDoMonitorDeEquipe[],
  ordem: Ordenacao,
  rotulos: Record<string, string>,
): LinhaDoMonitorDeEquipe[] {
  const sinal = ordem.ascendente ? 1 : -1;
  const chave = (l: LinhaDoMonitorDeEquipe): number | string => {
    switch (ordem.coluna) {
      case "prioridade":
        return l.prioridade.score;
      case "modulo":
        return escreverModulo(l.modulo);
      case "quadro":
        return l.quadro;
      case "cargo":
        return rotulos[l.cargo.chave] ?? l.cargo.chave;
      case "variavel":
        return l.variavel.rotulo;
      case "diferenca":
        return l.diferenca === null ? Number.NEGATIVE_INFINITY : Math.abs(l.diferenca);
    }
  };
  return [...linhas].sort((a, b) => {
    const x = chave(a);
    const y = chave(b);
    if (typeof x === "string" || typeof y === "string") {
      return String(x).localeCompare(String(y), "pt-BR") * sinal;
    }
    if (x === y) return a.id.localeCompare(b.id);
    return (x < y ? -1 : 1) * sinal;
  });
}

/** Uma página da tabela. Fatiar uma lista não é conta. */
export function paginar<T>(itens: readonly T[], pagina: number, porPagina: number): T[] {
  const inicio = (pagina - 1) * porPagina;
  return itens.slice(inicio, inicio + porPagina);
}

export type { LinhaDoMonitorDeEquipe, QuadroDeQlp, SituacaoDaLinhaDeEquipe };
