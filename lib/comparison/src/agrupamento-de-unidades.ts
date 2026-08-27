/**
 * Como um conjunto de contextos vira um conjunto de unidades — e quais delas
 * não podem ser somadas.
 *
 * Estas três funções moravam dentro de `families-view-overview.ts`, privadas,
 * ao lado do código que fala com o banco. São puras: a entrada é exatamente o
 * JSON que `/contexts` devolve, e a saída é agrupamento. Estão aqui, num módulo
 * sem nenhuma dependência de banco, porque o Radar de Alterações precisa da
 * **mesma** régua no navegador.
 *
 * A alternativa era o Radar reescrever a regra no cliente. Uma régua de negócio
 * escrita duas vezes é uma régua que vai divergir — e esta em particular decide
 * o que **não** entra num consolidado financeiro, que é o pior lugar do produto
 * para as duas versões discordarem em silêncio. Um módulo só, dois chamadores.
 *
 * Nada de comportamento mudou na extração: `families-view-overview.ts` importa
 * daqui e continua sendo o único lugar que aplica a régua no servidor.
 */
/**
 * O mínimo que o agrupamento lê de um contexto.
 *
 * Tipado pelo que estas funções tocam, e não por `ContextoAgrupavel`, de propósito:
 * `ContextoAgrupavel` carrega campos que só o servidor tem como preencher, e exigi-lo
 * obrigaria o Radar a converter a lista do `/contexts` — ou, o que é pior, a um
 * `as` que faria o compilador parar de conferir justamente na fronteira em que
 * ele é útil. `ContextoAgrupavel` satisfaz esta forma sem nenhuma conversão, e o
 * `Contexto` da interface também.
 */
export interface ContextoAgrupavel {
  scopeHash: string;
  channel: string | null;
  label: string;
  scopes: { scopeType: string; code: string }[];
}

/**
 * A identidade real de uma unidade — o código do escopo `UNIDADE`, não o
 * `scopeHash` (que já mistura REGIONAL/OPERADOR/canal). Mesmo fallback de
 * `contextLabel` em `series.ts`, para nunca ficar sem chave.
 */
export function chaveDaUnidade(c: ContextoAgrupavel): string {
  return c.scopes.find((s) => s.scopeType === "UNIDADE")?.code ?? c.scopeHash;
}

export function agruparPorUnidade<T extends ContextoAgrupavel>(contexts: T[]): Map<string, T[]> {
  // Genérica para devolver o **mesmo** tipo que recebeu: o servidor passa
  // `ContextInfo` e precisa dos campos dele de volta; a tela passa `Contexto` e
  // precisa dos dela. Fixar o retorno em `ContextoAgrupavel` obrigaria os dois a
  // um cast na saída.
  const porUnidade = new Map<string, T[]>();
  for (const c of contexts) {
    const chave = chaveDaUnidade(c);
    const grupo = porUnidade.get(chave) ?? [];
    grupo.push(c);
    porUnidade.set(chave, grupo);
  }
  return porUnidade;
}

/**
 * `scopeType:code` de cada entrada do contexto — não só o tipo. Dois
 * contextos com o mesmo conjunto de *tipos* de escopo (ex. `{UNIDADE,
 * OPERADOR}` e `{UNIDADE, OPERADOR}`) mas códigos de operador diferentes são
 * irmãos, não um a fatia do outro; comparar só por tipo confundiria os dois
 * casos.
 */
export function conjuntoDeEntradas(c: ContextoAgrupavel): Set<string> {
  return new Set(c.scopes.map((s) => `${s.scopeType}:${s.code}`));
}

/**
 * Se dois ou mais contextos elegíveis da mesma unidade caem no **mesmo
 * canal**, a unidade é recusada — mesmo sem aninhamento visível entre os
 * conjuntos de escopo.
 *
 * Confirmado por investigação de `lib/ingest/src/pipeline.ts`
 * (`groupFactsByEntityScope`): o agrupamento de escopo na importação é feito
 * por linha, conforme quais colunas (unidade/operador/regional) aquela linha
 * trouxe preenchidas, **dentro de um mesmo canal**. Nada no pipeline garante
 * que os contextos resultantes particionam a frota sem sobreposição — "não
 * detectei aninhamento" não é o mesmo que "provei que são disjuntos". Por
 * isso a régua aqui não tenta provar disjunção (exigiria comparar frota
 * total, fora do escopo desta v1): qualquer canal com mais de um contexto
 * elegível é tratado como ambíguo, ponto. Contextos de **canais diferentes**
 * continuam somáveis entre si — cada `(scopeHash, channel)` já é a partição
 * que o resto do produto usa para tratar séries como distintas (`series.ts`),
 * e nada na investigação apontou risco de sobreposição *entre* canais.
 */
export function agruparPorCanal<T extends ContextoAgrupavel>(matched: T[]): Map<string, T[]> {
  const porCanal = new Map<string, T[]>();
  for (const c of matched) {
    const canal = c.channel ?? "";
    const lista = porCanal.get(canal) ?? [];
    lista.push(c);
    porCanal.set(canal, lista);
  }
  return porCanal;
}

/** O canal com mais de um contexto elegível, quando existe — a unidade é ambígua. */
export function canalAmbiguo<T extends ContextoAgrupavel>(grupo: T[]): T[] | undefined {
  return [...agruparPorCanal(grupo).values()].find((lista) => lista.length > 1);
}
