import { operacaoDaConsulta } from "./operacao";
import type { RequestedContext } from "@workspace/comparison";

/**
 * O RECORTE DE QUEM LÊ O ACERVO DIRETO — **o do par escolhido, nunca o padrão**.
 *
 * ---------------------------------------------------------------------------
 * O defeito que esta função existe para não repetir
 * ---------------------------------------------------------------------------
 * As telas de comparação têm duas fontes, e não uma. O cartão, a rosca e a
 * tabela de alterações saem do `change_set` do par, que é de uma unidade por
 * construção. O gráfico de totais e as linhas "sem alteração" **não podem** sair
 * dali — um total tem de incluir quem não mudou, e o change set não conhece
 * esses veículos —, então elas leem o acervo por `getEntityTable`.
 *
 * `getEntityTable` resolve o contexto sozinho quando não recebe um, e o padrão
 * dele é `contexts[0]`: o primeiro contexto do acervo, que não tem relação
 * nenhuma com o par que a tela abriu. Como a leitura é recortada **depois** pela
 * `effective_date` das vigências escolhidas, o resultado não vinha vazio — vinha
 * de outra unidade na mesma data. Foi assim, na Auditoria de FINAME, que a
 * Evolução entre duas vigências somou uma frota que não era a comparada
 * enquanto os cartões acima falavam da unidade certa: nenhum aviso, nenhum
 * campo vazio, só dois números que não reconciliavam.
 *
 * ---------------------------------------------------------------------------
 * Por que o escopo sai do snapshot, e não da URL
 * ---------------------------------------------------------------------------
 * Porque a URL pode não mandá-lo — e porque o par já respondeu à pergunta. As
 * rotas de comparação recebem `base` e `comparada`, autorizam as duas
 * (`exigirOperacaoDoRecurso`) e o motor só compara vigências de **mesmo
 * escopo**: há um recorte só, e ele é o da vigência. Ler o `scope_hash` dali é
 * o que torna impossível a tela pedir um total de uma unidade e receber o de
 * outra.
 *
 * A operação continua vindo da consulta: ela é o ambiente de quem pergunta
 * (`?operacao=ROTA`), e não uma propriedade do par.
 */
export function contextoDoPar(
  snapshot: { scopeHash: string } | undefined,
  req: { query: unknown },
): RequestedContext | undefined {
  if (!snapshot) return undefined;
  return {
    scopeHash: snapshot.scopeHash,
    operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
  };
}
