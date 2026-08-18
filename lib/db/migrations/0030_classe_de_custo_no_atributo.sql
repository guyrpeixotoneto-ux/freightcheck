-- A classe de custo deixa de morar na taxonomia e passa a morar no atributo.
--
-- A taxonomia responde **o que este atributo é**. `cost_class` responde **como
-- ele se comporta economicamente**. São perguntas diferentes, e enquanto a
-- segunda for uma propriedade do nó, a árvore precisa de um nó por combinação
-- das duas — que é a duplicação que esta migration existe para impedir.
--
-- O caso que forçou a decisão está medido no produto: *Pessoal e encargos* é
-- custo fixo quando o valor descreve o cavalo e custo variável quando descreve
-- o trecho. Com a classe no nó, a mesma natureza precisaria de dois nós
-- (`Custo Fixo › Pessoal` e `Custo Variável › Pessoal`), e a partir daí "o que
-- é isto?" passaria a ter duas respostas conforme o contexto — que é
-- exatamente o que uma taxonomia não pode ter. O código já admitia a tensão em
-- `PAI_DE_CATEGORIA_NOVA`: "pedágio é custo variável numa operação e repasse
-- contratual em outra".
--
-- Com a classe no atributo, `cavalo.pessoal` e `trecho.pessoal` apontam para o
-- **mesmo** nó de natureza e declaram classes diferentes. Nenhum nó a mais.
--
-- Em `attribute_semantics` (a verdade versionada) e em `attribute` (a
-- projeção), pelo motivo de sempre nesta tabela: quando muda o que uma coluna
-- significa, a mudança tem data e autor, e a leitura barata continua sendo um
-- join só.
--
-- O vocabulário: FIXO | VARIAVEL | NAO_APLICAVEL | null.
--
--   FIXO / VARIAVEL  — o que as telas de custo já liam da árvore.
--   NAO_APLICAVEL    — afirmação, e não lacuna: cadastro e direcionador
--                      operacional não são custo, e carimbá-los FIXO os poria
--                      num total. É o que `cadastral` dizia devolvendo NULL
--                      herdado, com a diferença de que agora está escrito.
--   null             — ninguém decidiu ainda.
--
-- Texto e não `CHECK`, como `calculation_basis` e `economic_direction`: o
-- vocabulário de comportamento econômico é da operação, e uma quarta categoria
-- não deve custar uma migration.
--
-- **Nenhum número muda hoje.** O backfill copia, para cada atributo, a classe
-- que ele já herdava do ancestral mais próximo — a mesma conta que
-- `INHERITED_COST_CLASS_JOIN` fazia em tempo de consulta. Um atributo em nó
-- cadastral, que herdava NULL, recebe NAO_APLICAVEL: a árvore dizia isso por
-- omissão e agora diz por escrito.
--
-- Só então `taxonomy_node.cost_class` é **zerada**, e não derrubada. Zerada
-- porque uma segunda resposta à mesma pergunta acaba divergindo da primeira, que
-- é a razão de esta migration existir; não derrubada porque o `DROP` faria a
-- proposta do Publishing removê-la de Production antes de Production ter rodado
-- a fila — DDL destrutivo fora de ordem, que é o que `textoDaProposta` recusa. A
-- coluna fica inerte: nenhum código a lê, a árvore canônica não a declara, e o
-- `DROP` é uma migration de uma linha no dia em que Production estiver em dia.
--
-- `semantics_status` não é tocado. Dizer como um valor se comporta não é
-- confirmar unidade, periodicidade e agregação — os portões que destravam soma
-- de dinheiro continuam onde estavam.

ALTER TABLE "attribute" ADD COLUMN IF NOT EXISTS "cost_class" text;--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD COLUMN IF NOT EXISTS "cost_class" text;--> statement-breakpoint

-- O backfill, pela mesma regra que a consulta usava: o ancestral mais próximo
-- que declara uma classe é o maior `path` que é prefixo do meu.
--
-- Dentro de um `DO` que confere se a coluna ainda existe, porque **a fila é
-- reentrante**: `runMigrations()` atravessa bancos que já passaram por aqui, e
-- o `bridge-up` levanta estes statements do disco para restaurar Development.
-- Na segunda passada `taxonomy_node.cost_class` já foi derrubada, e um `SELECT`
-- que a nomeia falha no parser antes de qualquer `WHERE` poder evitá-lo — é por
-- isso que não basta um `IF NOT EXISTS`, e o corpo precisa ser dinâmico.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'taxonomy_node' AND column_name = 'cost_class'
  ) THEN
    EXECUTE $backfill$
      UPDATE "attribute" AS a
         SET "cost_class" = COALESCE(
               (SELECT ancestor."cost_class"
                  FROM "taxonomy_node" ancestor
                 WHERE ancestor."cost_class" IS NOT NULL
                   AND (node."path" = ancestor."path"
                        OR node."path" LIKE ancestor."path" || '/%')
                 ORDER BY length(ancestor."path") DESC
                 LIMIT 1),
               'NAO_APLICAVEL')
        FROM "taxonomy_node" node
       WHERE node."id" = a."taxonomy_node_id"
         AND a."cost_class" IS NULL
    $backfill$;

    EXECUTE $backfill$
      UPDATE "attribute_semantics" AS s
         SET "cost_class" = COALESCE(
               (SELECT ancestor."cost_class"
                  FROM "taxonomy_node" ancestor
                 WHERE ancestor."cost_class" IS NOT NULL
                   AND (node."path" = ancestor."path"
                        OR node."path" LIKE ancestor."path" || '/%')
                 ORDER BY length(ancestor."path") DESC
                 LIMIT 1),
               'NAO_APLICAVEL')
        FROM "taxonomy_node" node
       WHERE node."id" = s."taxonomy_node_id"
         AND s."cost_class" IS NULL
    $backfill$;
  END IF;
END $$;--> statement-breakpoint

UPDATE "taxonomy_node" SET "cost_class" = NULL WHERE "cost_class" IS NOT NULL;
