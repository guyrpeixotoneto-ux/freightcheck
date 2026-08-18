-- A taxonomia passa a ser puramente semântica, e a raiz deixa de ser o nome do
-- domínio.
--
-- Três mudanças, e todas servem à mesma regra: **redesenhar a DRE amanhã não
-- muda a taxonomia dos atributos.**
--
-- 1. **A raiz.** Chamava-se `remuneracao` / "Remuneração" — o nome do domínio.
--    Uma árvore que começa no nome do domínio chega enviesada: sob
--    "Remuneração" as classes eram Custo Fixo, Custo Variável e Cadastral, três
--    recortes de custo e nenhum de receita, numa árvore cujo nome falava de
--    receita. Passa a ser `natureza` / "Natureza do atributo", que é a pergunta
--    que a árvore de fato responde.
--
-- 2. **As classes.** Custo Fixo e Custo Variável eram recortes econômicos, não
--    naturezas, e é por isso que a mesma natureza aparecia dos dois lados. Dão
--    lugar a famílias semânticas — Cadastro, Frota, Consumo e operação,
--    Pessoal, Proteção, Tributos, Capital, Remuneração ao transportador,
--    Direcionador operacional. A classe de custo saiu para `attribute` e
--    `attribute_semantics` na migration 0030.
--
-- 3. **Os nós que faltavam.** Dezoito, e nenhum inventado: cada um tem atributo
--    esperando por ele hoje. Pedágio, lavagem, seguro de carga, arla, IPVA e
--    licenciamento, rastreamento, locação, itens obrigatórios, tributos sobre a
--    prestação, premissas de financiamento e valor de aquisição vinham caindo
--    em "Outros"; remuneração e direcionador operacional eram famílias inteiras
--    ausentes — a primeira deixava sem casa tudo que a Ambev paga, a segunda
--    empurrava km, tempo e ciclo para "Especificação técnica".
--
-- **Nenhum atributo fica órfão.** Os dezessete códigos de grupo que já existiam
-- continuam existindo, com o mesmo código; o que muda é o pai, e em três deles
-- o nome, para tirar a moldura de custo:
--
--   cf_outros            "Outros custos fixos"     -> "Outros do ativo"
--   cv_outros            "Outros custos variáveis" -> "Outros da operação"
--   cf_seguros_tributos  "Seguros e tributos"      -> "Seguro do ativo"
--
-- `cf_seguros_tributos` misturava duas naturezas; fica com o seguro, e os
-- tributos ganham nós próprios. Quem estiver classificado nele continua
-- classificado — reclassificar é ato de curadoria, não de migration.
--
-- `cv_lucro_variavel` e `cf_remuneracao_capital` migram de Custo Variável e
-- Custo Fixo para Remuneração ao transportador. Não são custo: são margem e
-- remuneração de capital, e estavam na classe de custo mais próxima por falta
-- de um lado de receita na árvore.
--
-- Idempotente e declarativa: faz upsert de cada nó por código, religa os pais,
-- e só então recalcula `path` e `depth` a partir da parentagem — em vez de
-- escrever caminho à mão, que é como um caminho fica errado.
--
-- A árvore vai inline, num CTE repetido, e não numa tabela temporária. O runner
-- roda cada migration numa transação só, então um `TEMP … ON COMMIT DROP`
-- funcionaria; o `bridge-up`, porém, levanta statements avulsos do disco para
-- restaurar Development, e um statement que depende do anterior ter criado uma
-- tabela quebra fora da fila. Repetir o CTE custa texto e não custa correção.

-- 1. A raiz antiga vira a nova, mantendo o id — e com ele todo o parentesco que
--    já pendura nela.
UPDATE "taxonomy_node"
   SET "code" = 'natureza', "name" = 'Natureza do atributo'
 WHERE "code" = 'remuneracao' AND "depth" = 0
   AND NOT EXISTS (SELECT 1 FROM "taxonomy_node" WHERE "code" = 'natureza');--> statement-breakpoint

-- 2. Os nós que ainda não existem nascem. `path` provisório, porque a coluna é
--    NOT NULL e o passo 5 a recalcula.
WITH arvore_nova (code, name, kind, parent_code, sort_order) AS (
  VALUES
  ('natureza', 'Natureza do atributo', 'ROOT', NULL, 0),
  ('cadastro', 'Cadastro e identificação', 'CLASS', 'natureza', 0),
  ('cad_identificacao', 'Identificação do ativo', 'GROUP', 'cadastro', 0),
  ('cad_escopo', 'Escopo organizacional', 'GROUP', 'cadastro', 1),
  ('cad_contrato', 'Contrato e vigência', 'GROUP', 'cadastro', 2),
  ('cad_especificacao', 'Especificação técnica', 'GROUP', 'cadastro', 3),
  ('frota', 'Frota e equipamento', 'CLASS', 'natureza', 1),
  ('cf_frota_cavalo', 'Frota — Cavalo', 'GROUP', 'frota', 0),
  ('cf_frota_carreta', 'Frota — Carreta', 'GROUP', 'frota', 1),
  ('frota_locacao', 'Locação de equipamento', 'GROUP', 'frota', 2),
  ('frota_itens_obrigatorios', 'Itens obrigatórios do implemento', 'GROUP', 'frota', 3),
  ('cf_outros', 'Outros do ativo', 'GROUP', 'frota', 4),
  ('operacao', 'Consumo e operação', 'CLASS', 'natureza', 2),
  ('cv_combustivel', 'Combustível', 'GROUP', 'operacao', 0),
  ('op_arla', 'Arla', 'GROUP', 'operacao', 1),
  ('cv_pneus', 'Pneus', 'GROUP', 'operacao', 2),
  ('cv_manutencao', 'Manutenção', 'GROUP', 'operacao', 3),
  ('op_lavagem', 'Lavagem e lubrificação', 'GROUP', 'operacao', 4),
  ('op_pedagio', 'Pedágio', 'GROUP', 'operacao', 5),
  ('cv_outros', 'Outros da operação', 'GROUP', 'operacao', 6),
  ('pessoal', 'Pessoal', 'CLASS', 'natureza', 3),
  ('cf_pessoal', 'Pessoal e encargos', 'GROUP', 'pessoal', 0),
  ('protecao', 'Proteção e conformidade', 'CLASS', 'natureza', 4),
  ('cf_seguros_tributos', 'Seguro do ativo', 'GROUP', 'protecao', 0),
  ('prot_seguro_carga', 'Seguro de carga', 'GROUP', 'protecao', 1),
  ('prot_rastreamento', 'Rastreamento e telemetria', 'GROUP', 'protecao', 2),
  ('tributos', 'Tributos e taxas', 'CLASS', 'natureza', 5),
  ('trib_prestacao', 'Tributos sobre a prestação', 'GROUP', 'tributos', 0),
  ('trib_ipva_licenciamento', 'IPVA e licenciamento', 'GROUP', 'tributos', 1),
  ('capital', 'Capital e financiamento', 'CLASS', 'natureza', 6),
  ('cf_financiamento', 'Financiamento e juros', 'GROUP', 'capital', 0),
  ('cf_depreciacao', 'Depreciação e amortização', 'GROUP', 'capital', 1),
  ('cap_premissas_financiamento', 'Premissas de financiamento', 'GROUP', 'capital', 2),
  ('cap_valor_aquisicao', 'Valor de aquisição do ativo', 'GROUP', 'capital', 3),
  ('remuneracao_transportador', 'Remuneração ao transportador', 'CLASS', 'natureza', 7),
  ('rem_fixa', 'Remuneração fixa', 'GROUP', 'remuneracao_transportador', 0),
  ('cf_remuneracao_capital', 'Remuneração de capital', 'GROUP', 'remuneracao_transportador', 1),
  ('rem_variavel', 'Remuneração variável', 'GROUP', 'remuneracao_transportador', 2),
  ('cv_lucro_variavel', 'Lucro variável', 'GROUP', 'remuneracao_transportador', 3),
  ('rem_frete_trecho', 'Frete do trecho', 'GROUP', 'remuneracao_transportador', 4),
  ('direcionador', 'Direcionador operacional', 'CLASS', 'natureza', 8),
  ('dir_distancia', 'Distância', 'GROUP', 'direcionador', 0),
  ('dir_tempo', 'Tempo e jornada', 'GROUP', 'direcionador', 1),
  ('dir_ciclo', 'Ciclo e frequência', 'GROUP', 'direcionador', 2),
  ('dir_capacidade', 'Capacidade', 'GROUP', 'direcionador', 3),
  ('nao_classificado', 'Não classificado', 'CLASS', 'natureza', 9)
)
INSERT INTO "taxonomy_node" ("code", "name", "kind", "path", "depth", "sort_order")
SELECT n.code, n.name, n.kind, n.code, 0, n.sort_order
  FROM arvore_nova n
 WHERE NOT EXISTS (SELECT 1 FROM "taxonomy_node" t WHERE t."code" = n.code);--> statement-breakpoint

-- 3. Nome, tipo e ordem passam a ser os da árvore canônica.
WITH arvore_nova (code, name, kind, parent_code, sort_order) AS (
  VALUES
  ('natureza', 'Natureza do atributo', 'ROOT', NULL, 0),
  ('cadastro', 'Cadastro e identificação', 'CLASS', 'natureza', 0),
  ('cad_identificacao', 'Identificação do ativo', 'GROUP', 'cadastro', 0),
  ('cad_escopo', 'Escopo organizacional', 'GROUP', 'cadastro', 1),
  ('cad_contrato', 'Contrato e vigência', 'GROUP', 'cadastro', 2),
  ('cad_especificacao', 'Especificação técnica', 'GROUP', 'cadastro', 3),
  ('frota', 'Frota e equipamento', 'CLASS', 'natureza', 1),
  ('cf_frota_cavalo', 'Frota — Cavalo', 'GROUP', 'frota', 0),
  ('cf_frota_carreta', 'Frota — Carreta', 'GROUP', 'frota', 1),
  ('frota_locacao', 'Locação de equipamento', 'GROUP', 'frota', 2),
  ('frota_itens_obrigatorios', 'Itens obrigatórios do implemento', 'GROUP', 'frota', 3),
  ('cf_outros', 'Outros do ativo', 'GROUP', 'frota', 4),
  ('operacao', 'Consumo e operação', 'CLASS', 'natureza', 2),
  ('cv_combustivel', 'Combustível', 'GROUP', 'operacao', 0),
  ('op_arla', 'Arla', 'GROUP', 'operacao', 1),
  ('cv_pneus', 'Pneus', 'GROUP', 'operacao', 2),
  ('cv_manutencao', 'Manutenção', 'GROUP', 'operacao', 3),
  ('op_lavagem', 'Lavagem e lubrificação', 'GROUP', 'operacao', 4),
  ('op_pedagio', 'Pedágio', 'GROUP', 'operacao', 5),
  ('cv_outros', 'Outros da operação', 'GROUP', 'operacao', 6),
  ('pessoal', 'Pessoal', 'CLASS', 'natureza', 3),
  ('cf_pessoal', 'Pessoal e encargos', 'GROUP', 'pessoal', 0),
  ('protecao', 'Proteção e conformidade', 'CLASS', 'natureza', 4),
  ('cf_seguros_tributos', 'Seguro do ativo', 'GROUP', 'protecao', 0),
  ('prot_seguro_carga', 'Seguro de carga', 'GROUP', 'protecao', 1),
  ('prot_rastreamento', 'Rastreamento e telemetria', 'GROUP', 'protecao', 2),
  ('tributos', 'Tributos e taxas', 'CLASS', 'natureza', 5),
  ('trib_prestacao', 'Tributos sobre a prestação', 'GROUP', 'tributos', 0),
  ('trib_ipva_licenciamento', 'IPVA e licenciamento', 'GROUP', 'tributos', 1),
  ('capital', 'Capital e financiamento', 'CLASS', 'natureza', 6),
  ('cf_financiamento', 'Financiamento e juros', 'GROUP', 'capital', 0),
  ('cf_depreciacao', 'Depreciação e amortização', 'GROUP', 'capital', 1),
  ('cap_premissas_financiamento', 'Premissas de financiamento', 'GROUP', 'capital', 2),
  ('cap_valor_aquisicao', 'Valor de aquisição do ativo', 'GROUP', 'capital', 3),
  ('remuneracao_transportador', 'Remuneração ao transportador', 'CLASS', 'natureza', 7),
  ('rem_fixa', 'Remuneração fixa', 'GROUP', 'remuneracao_transportador', 0),
  ('cf_remuneracao_capital', 'Remuneração de capital', 'GROUP', 'remuneracao_transportador', 1),
  ('rem_variavel', 'Remuneração variável', 'GROUP', 'remuneracao_transportador', 2),
  ('cv_lucro_variavel', 'Lucro variável', 'GROUP', 'remuneracao_transportador', 3),
  ('rem_frete_trecho', 'Frete do trecho', 'GROUP', 'remuneracao_transportador', 4),
  ('direcionador', 'Direcionador operacional', 'CLASS', 'natureza', 8),
  ('dir_distancia', 'Distância', 'GROUP', 'direcionador', 0),
  ('dir_tempo', 'Tempo e jornada', 'GROUP', 'direcionador', 1),
  ('dir_ciclo', 'Ciclo e frequência', 'GROUP', 'direcionador', 2),
  ('dir_capacidade', 'Capacidade', 'GROUP', 'direcionador', 3),
  ('nao_classificado', 'Não classificado', 'CLASS', 'natureza', 9)
)
UPDATE "taxonomy_node" t
   SET "name" = n.name, "kind" = n.kind, "sort_order" = n.sort_order
  FROM arvore_nova n
 WHERE t."code" = n.code;--> statement-breakpoint

-- 4. A parentagem.
WITH arvore_nova (code, name, kind, parent_code, sort_order) AS (
  VALUES
  ('natureza', 'Natureza do atributo', 'ROOT', NULL, 0),
  ('cadastro', 'Cadastro e identificação', 'CLASS', 'natureza', 0),
  ('cad_identificacao', 'Identificação do ativo', 'GROUP', 'cadastro', 0),
  ('cad_escopo', 'Escopo organizacional', 'GROUP', 'cadastro', 1),
  ('cad_contrato', 'Contrato e vigência', 'GROUP', 'cadastro', 2),
  ('cad_especificacao', 'Especificação técnica', 'GROUP', 'cadastro', 3),
  ('frota', 'Frota e equipamento', 'CLASS', 'natureza', 1),
  ('cf_frota_cavalo', 'Frota — Cavalo', 'GROUP', 'frota', 0),
  ('cf_frota_carreta', 'Frota — Carreta', 'GROUP', 'frota', 1),
  ('frota_locacao', 'Locação de equipamento', 'GROUP', 'frota', 2),
  ('frota_itens_obrigatorios', 'Itens obrigatórios do implemento', 'GROUP', 'frota', 3),
  ('cf_outros', 'Outros do ativo', 'GROUP', 'frota', 4),
  ('operacao', 'Consumo e operação', 'CLASS', 'natureza', 2),
  ('cv_combustivel', 'Combustível', 'GROUP', 'operacao', 0),
  ('op_arla', 'Arla', 'GROUP', 'operacao', 1),
  ('cv_pneus', 'Pneus', 'GROUP', 'operacao', 2),
  ('cv_manutencao', 'Manutenção', 'GROUP', 'operacao', 3),
  ('op_lavagem', 'Lavagem e lubrificação', 'GROUP', 'operacao', 4),
  ('op_pedagio', 'Pedágio', 'GROUP', 'operacao', 5),
  ('cv_outros', 'Outros da operação', 'GROUP', 'operacao', 6),
  ('pessoal', 'Pessoal', 'CLASS', 'natureza', 3),
  ('cf_pessoal', 'Pessoal e encargos', 'GROUP', 'pessoal', 0),
  ('protecao', 'Proteção e conformidade', 'CLASS', 'natureza', 4),
  ('cf_seguros_tributos', 'Seguro do ativo', 'GROUP', 'protecao', 0),
  ('prot_seguro_carga', 'Seguro de carga', 'GROUP', 'protecao', 1),
  ('prot_rastreamento', 'Rastreamento e telemetria', 'GROUP', 'protecao', 2),
  ('tributos', 'Tributos e taxas', 'CLASS', 'natureza', 5),
  ('trib_prestacao', 'Tributos sobre a prestação', 'GROUP', 'tributos', 0),
  ('trib_ipva_licenciamento', 'IPVA e licenciamento', 'GROUP', 'tributos', 1),
  ('capital', 'Capital e financiamento', 'CLASS', 'natureza', 6),
  ('cf_financiamento', 'Financiamento e juros', 'GROUP', 'capital', 0),
  ('cf_depreciacao', 'Depreciação e amortização', 'GROUP', 'capital', 1),
  ('cap_premissas_financiamento', 'Premissas de financiamento', 'GROUP', 'capital', 2),
  ('cap_valor_aquisicao', 'Valor de aquisição do ativo', 'GROUP', 'capital', 3),
  ('remuneracao_transportador', 'Remuneração ao transportador', 'CLASS', 'natureza', 7),
  ('rem_fixa', 'Remuneração fixa', 'GROUP', 'remuneracao_transportador', 0),
  ('cf_remuneracao_capital', 'Remuneração de capital', 'GROUP', 'remuneracao_transportador', 1),
  ('rem_variavel', 'Remuneração variável', 'GROUP', 'remuneracao_transportador', 2),
  ('cv_lucro_variavel', 'Lucro variável', 'GROUP', 'remuneracao_transportador', 3),
  ('rem_frete_trecho', 'Frete do trecho', 'GROUP', 'remuneracao_transportador', 4),
  ('direcionador', 'Direcionador operacional', 'CLASS', 'natureza', 8),
  ('dir_distancia', 'Distância', 'GROUP', 'direcionador', 0),
  ('dir_tempo', 'Tempo e jornada', 'GROUP', 'direcionador', 1),
  ('dir_ciclo', 'Ciclo e frequência', 'GROUP', 'direcionador', 2),
  ('dir_capacidade', 'Capacidade', 'GROUP', 'direcionador', 3),
  ('nao_classificado', 'Não classificado', 'CLASS', 'natureza', 9)
)
UPDATE "taxonomy_node" t
   SET "parent_id" = p."id"
  FROM arvore_nova n
  JOIN "taxonomy_node" p ON p."code" = n.parent_code
 WHERE t."code" = n.code AND n.parent_code IS NOT NULL;--> statement-breakpoint

-- 5. `path` e `depth` recalculados da parentagem, para a árvore inteira —
--    inclusive para os nós que alguém criou pela tela e que penduram em
--    `nao_classificado`.
WITH RECURSIVE arvore AS (
  SELECT "id", "code", "code" AS path, 0 AS depth
    FROM "taxonomy_node"
   WHERE "parent_id" IS NULL
  UNION ALL
  SELECT f."id", f."code", a.path || '/' || f."code", a.depth + 1
    FROM "taxonomy_node" f
    JOIN arvore a ON f."parent_id" = a."id"
)
UPDATE "taxonomy_node" t
   SET "path" = a.path, "depth" = a.depth
  FROM arvore a
 WHERE t."id" = a."id"
   AND (t."path" IS DISTINCT FROM a.path OR t."depth" IS DISTINCT FROM a.depth);
