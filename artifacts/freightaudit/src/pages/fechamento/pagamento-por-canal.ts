import type { ItemDePagamento } from "@/lib/fechamento";

/**
 * O ROTA e o AS do mesmo 03.08.20 — separados, uma vez, para toda a etapa 4.
 *
 * **Por que existe fora do componente.** `TotaisDoPagamentoNaEtapa` e
 * `VerbaAVerbaDoPagamento` liam listas diferentes (`totais.canais` e `itens`
 * do endpoint `/pagamento`) e cada uma filtrava o próprio jeito — dois lugares
 * fáceis de um herdar o filtro e o outro não, na primeira mudança que só
 * mexesse num deles. Uma função só, testada sozinha, é o que garante que "só
 * Rota nesta tela" é uma regra e não uma coincidência de dois filtros iguais
 * escritos em paralelo.
 *
 * **Isto não recalcula nada.** `calculado` e `declarado` de cada canal já
 * chegam prontos, agrupados por canal desde `totaisDoPagamentoDaCompetencia`
 * (`lib/fechamento/src/persistencia.ts`) — o servidor nunca soma ROTA e AS
 * antes de separar. Filtrar aqui só descarta a linha do AS da lista que a
 * tela itera; não há conta feita sobre os dois juntos em nenhum ponto do
 * caminho, então não há conta a desfazer.
 */
export function apenasCanalRota<T extends { canal: string }>(itens: readonly T[]): T[] {
  return itens.filter((i) => i.canal === "ROTA");
}

export type ClassificacaoDaRepeticao = "IDENTICA" | "DIVERGENTE";

export interface VbzRepetida {
  vbz: number;
  nome: string;
  bloco: string;
  classificacao: ClassificacaoDaRepeticao;
  ocorrencias: { linha: number; valorFaturado: number }[];
}

const CAMPOS_DE_VALOR = [
  "semImposto",
  "nfIss",
  "ctrcIcms",
  "valorFaturado",
  "vlcNfIss",
  "vlcCtrcIcms",
] as const;

function mesmosValores(a: ItemDePagamento, b: ItemDePagamento): boolean {
  return CAMPOS_DE_VALOR.every((campo) => a[campo] === b[campo]);
}

/**
 * Toda VBZ que aparece mais de uma vez no mesmo bloco do mesmo documento —
 * classificada, nunca resolvida.
 *
 * **Por que "mesmo bloco" e não "mesmo canal".** Uma VBZ pode legitimamente
 * repetir dentro do canal em dois blocos diferentes — Frete e Outros Custos,
 * porque parte da verba nasce da operação e parte de requisição aprovada (ver
 * `ctrcPorVerba`, em `leitores/pagamento.ts`, que soma as duas de propósito).
 * Isso não é repetição a investigar; é o desenho do relatório. O que pede
 * atenção é a mesma VBZ **duas vezes no mesmo bloco** — aí não há uma segunda
 * origem que explique a segunda linha.
 *
 * **As duas classificações pedem coisas diferentes de quem fecha a quinzena.**
 * Valores idênticos é o caso mais provável de o exportador ter duplicado a
 * seção — a mesma linha entrou duas vezes no arquivo, byte a byte, e é isso
 * que {@link consolidarDuplicatasExatas} resolve para a tela. Valores
 * divergentes é mais grave: a mesma verba com dois valores diferentes não tem
 * explicação óbvia — o mais provável é o 03.08.20 ter mesmo declarado a VBZ
 * duas vezes, e isso precisa voltar para a Ambev antes de fechar, não ser
 * decidido aqui.
 *
 * **Esta função em si não deduplica nem soma — só relata.** Quem decide o que
 * fazer com o achado é quem chama: {@link consolidarDuplicatasExatas} usa o
 * resultado para reduzir as `IDENTICA` a uma linha só; as `DIVERGENTE`
 * continuam intactas em qualquer uso, porque ali não há linha "sobrando" para
 * remover — as duas dizem coisas diferentes.
 */
export function verbasRepetidas(itens: readonly ItemDePagamento[]): VbzRepetida[] {
  const grupos = new Map<string, ItemDePagamento[]>();
  for (const item of itens) {
    const chave = `${item.bloco}|${item.verba.vbz}`;
    const grupo = grupos.get(chave);
    if (grupo) grupo.push(item);
    else grupos.set(chave, [item]);
  }

  const achadas: VbzRepetida[] = [];
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const [primeiro, ...resto] = grupo;
    const identica = resto.every((item) => mesmosValores(primeiro, item));
    achadas.push({
      vbz: primeiro.verba.vbz,
      nome: primeiro.nomeNoArquivo,
      bloco: primeiro.bloco,
      classificacao: identica ? "IDENTICA" : "DIVERGENTE",
      ocorrencias: grupo.map((i) => ({ linha: i.linha, valorFaturado: i.valorFaturado })),
    });
  }
  return achadas.sort((a, b) => a.vbz - b.vbz);
}

export interface DuplicataExataConsolidada {
  vbz: number;
  nome: string;
  bloco: string;
  /** A linha física que a tela mantém — a primeira, pela ordem do arquivo. */
  linhaMantida: number;
  /** As linhas idênticas que a tela deixou de mostrar. */
  linhasRemovidas: number[];
}

/**
 * A mesma lista de itens, com toda VBZ **exatamente** repetida no mesmo bloco
 * reduzida a uma única linha — mantendo a de menor linha física, pela ordem em
 * que o arquivo as trouxe.
 *
 * **Por que só a `IDENTICA` some, e a `DIVERGENTE` nunca.** Duas linhas com os
 * mesmos seis valores não carregam informação nova uma da outra — é a mesma
 * afirmação, repetida, e mostrar as duas só faz a etapa 4 parecer que a Ambev
 * paga a verba em dobro quando ela não paga. Duas linhas com valores
 * diferentes são duas afirmações diferentes: reter uma e descartar a outra
 * inventaria qual delas vale, e essa decisão é da Ambev, não desta tela — por
 * isso `verbasRepetidas` continua reportando as `DIVERGENTE` e esta função as
 * deixa todas na lista.
 *
 * **Retorna o que foi consolidado, e não só a lista enxuta.** A tela precisa
 * dizer que uma redução aconteceu — sumir uma linha calado é o oposto do que
 * este módulo inteiro existe para evitar.
 */
export function consolidarDuplicatasExatas(itens: readonly ItemDePagamento[]): {
  itens: ItemDePagamento[];
  consolidadas: DuplicataExataConsolidada[];
} {
  const identicas = verbasRepetidas(itens).filter((r) => r.classificacao === "IDENTICA");
  if (identicas.length === 0) return { itens: [...itens], consolidadas: [] };

  const linhasARemover = new Set<number>();
  const consolidadas: DuplicataExataConsolidada[] = identicas.map((r) => {
    const linhas = r.ocorrencias.map((o) => o.linha).sort((a, b) => a - b);
    const [linhaMantida, ...linhasRemovidas] = linhas;
    for (const linha of linhasRemovidas) linhasARemover.add(linha);
    return { vbz: r.vbz, nome: r.nome, bloco: r.bloco, linhaMantida, linhasRemovidas };
  });

  return {
    itens: itens.filter((i) => !linhasARemover.has(i.linha)),
    consolidadas,
  };
}
