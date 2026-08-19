/**
 * QLP Administrativo — a leitura do quadro de pessoal da estrutura
 * administrativa, sobre o modelo canônico e mais nada.
 *
 * O que este pacote faz: resolve o contexto **da família QUADRO_DE_PESSOAL**,
 * lê fatos de entidades `QLP_ADMINISTRATIVO` (grão: unidade + cargo, definido
 * em `lib/ingest/tipos.ts`), e projeta três respostas — o quadro de uma
 * vigência, a ficha de um cargo com a célula de origem, e a série de presença.
 *
 * O que ele **não** faz, de propósito:
 *
 * - não compara vigências — diferença de valor, comparabilidade e impacto são
 *   do motor canônico (`computeChangeSet`), servidos pelos endpoints de
 *   change-set que já existem;
 * - não soma o que a curadoria não confirmou — toda agregação passa por
 *   `podeSomar`/`viraDinheiro` de `@workspace/curation`, e a recusa vai para a
 *   tela com o motivo por extenso, nunca como zero;
 * - não grava nada: nenhuma tabela, nenhuma migration, nenhum pipeline.
 *
 * Dívidas técnicas registradas (fora do escopo daqui, de propósito):
 *
 * 1. `entity_identifier` grava `identifier_type = 'PLACA'` para toda entidade,
 *    inclusive as de QLP — o nome mente para o quadro de pessoal, mas é a
 *    chave que todo caminho de leitura do produto usa
 *    (`lib/ingest/pipeline.ts`). Este pacote lê como está.
 * 2. O motor de comparação rotula as linhas de change com `identifier_value`
 *    (a chave normalizada, `20618821000799AUXILIARADM`), e não com
 *    `identifier_value_raw` (a legível, `20.618.821/0007-99 · AUXILIAR ADM`)
 *    — ver `lib/comparison/src/engine.ts`, eixos 1 e 2. Para placas as duas
 *    formas coincidem; para o QLP a tela traduz na apresentação
 *    (`artifacts/freightaudit/src/components/qlp/apresentacao.ts`). Corrigir o
 *    rótulo na fonte é decisão do motor, porque muda o que fica gravado em
 *    `change.entity_label` para todas as séries.
 */
export * from "./contexto";
export * from "./quadro";
export * from "./detalhe";
export * from "./evolucao";
export * from "./inconsistencias";
