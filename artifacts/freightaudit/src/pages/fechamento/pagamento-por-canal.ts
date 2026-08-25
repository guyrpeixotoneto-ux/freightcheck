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
 * seção — conferir as linhas apontadas contra o arquivo original geralmente
 * resolve rápido. Valores divergentes é mais grave: a mesma verba com dois
 * valores diferentes não tem explicação óbvia — o mais provável é o 03.08.20
 * ter mesmo declarado a VBZ duas vezes, e isso precisa voltar para a Ambev
 * antes de fechar, não ser decidido aqui.
 *
 * **Nunca deduplica, nunca soma.** As duas classificações só relatam o que o
 * arquivo trouxe; a tabela abaixo continua mostrando toda linha, e o total do
 * bloco continua somando todas elas. Escolher qual linha "vale" seria inventar
 * um dado que o 03.08.20 não decidiu.
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
