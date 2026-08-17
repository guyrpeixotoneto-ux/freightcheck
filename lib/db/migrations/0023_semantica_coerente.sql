-- A semântica de agregação passa a ser inescapável, e não só combinada.
--
-- A auditoria de 16/08/2026 mediu o buraco com um UPDATE que o banco aceitou:
--
--   UPDATE attribute SET unit='KM_L', aggregation='SUM', is_monetary=true,
--          periodicity='MENSAL', semantics_status='CONFIRMED', ...
--   -- UPDATE 1, nenhuma constraint reclamou.
--
-- Um atributo nesse estado passa por todos os portões do produto e produz
-- "R$ 938" somando o consumo de 62 cavalos. As duas checagens que existiam
-- — `attribute_confirmed_requires_actor` e `attribute_confirmed_monetary_is_
-- complete` — pedem que os campos estejam *preenchidos*, nunca que sejam
-- *coerentes entre si*.
--
-- Quatro invariantes, e nenhuma delas é nova: são a redação em SQL de
-- `coerenciaDaSemantica`, em lib/curation/src/agregacao.ts. A função é a fonte;
-- este arquivo é a cópia inescapável, e um teste de arquitetura lê a definição
-- destas constraints do catálogo do Postgres e as confere contra a função,
-- combinação por combinação, justamente para que a cópia não possa divergir.
--
--   1. Uma razão não pode ser declarada somável. Somar km/l entre ativos não
--      produz grandeza nenhuma; o total exigiria a quilometragem, que não vem
--      neste export.
--   2. Um tipo não numérico não admite agregação além de NONE. Somar ou tirar
--      média de um chassi, de um booleano ou de uma data é aritmética que não
--      existe sobre aquele valor.
--   3. Um montante financeiro é medido em reais. `is_monetary` com unidade que
--      não é BRL é uma contradição entre dois campos que se afirmam.
--   4. A agregação é uma das três que o produto sabe executar. WEIGHTED_AVG
--      sai por aqui: o valor existia no enum, a tela o oferecia, e o cálculo
--      por trás era `total ÷ veículos` — média simples com nome de ponderada.
--      Enquanto o peso não for campo do modelo, o estado deixa de ser gravável.
--
-- As duas tabelas, porque o estado absurdo cabia nas duas: `attribute` é a
-- projeção e `attribute_semantics` é a verdade versionada, e uma versão
-- incoerente voltaria à projeção no `projectCurrentVersion` seguinte.
-- `attribute_semantics` não tem `data_type` — a invariante 2 é só da projeção.

-- ---------------------------------------------------------------------------
-- O dado existente, antes da trava
-- ---------------------------------------------------------------------------
-- Uma constraint não anexa sobre linha inválida, e o export real tem duas:
-- `carreta.prazo_pagamento` e `cavalo.prazo_pagamento` chegaram com tipo
-- UNKNOWN, zero linhas preenchidas, e mesmo assim receberam "média simples" —
-- o `guessAggregation` barra TEXT, BOOLEAN, DATE e MIXED, e esquecia UNKNOWN.
--
-- A normalização abaixo é a própria invariante 2 aplicada ao passado, e não uma
-- lista de códigos escolhida à mão: qualquer linha que a viole vira NONE, que é
-- o que "este valor não agrega" já significa em toda a tabela. Nenhuma outra
-- invariante tem violação no export real — medido antes de escrever isto.
UPDATE "attribute"
   SET "aggregation" = 'NONE'
 WHERE "data_type" IN ('TEXT', 'BOOLEAN', 'DATE', 'MIXED', 'UNKNOWN')
   AND "aggregation" IS NOT NULL
   AND "aggregation" <> 'NONE';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- As travas
-- ---------------------------------------------------------------------------

ALTER TABLE "attribute" DROP CONSTRAINT IF EXISTS "attribute_semantica_coerente";--> statement-breakpoint
ALTER TABLE "attribute" ADD CONSTRAINT "attribute_semantica_coerente" CHECK (
  ("aggregation" IS NULL OR "aggregation" IN ('SUM', 'AVG', 'NONE'))
  AND NOT ("data_type" IN ('TEXT', 'BOOLEAN', 'DATE', 'MIXED', 'UNKNOWN')
           AND "aggregation" IS NOT NULL AND "aggregation" <> 'NONE')
  AND NOT ("unit" IN ('KM_L', 'BRL_KM', 'PERCENT') AND "aggregation" = 'SUM')
  AND NOT ("is_monetary" IS TRUE AND "unit" IS NOT NULL AND "unit" <> 'BRL')
);--> statement-breakpoint

ALTER TABLE "attribute_semantics" DROP CONSTRAINT IF EXISTS "attribute_semantics_semantica_coerente";--> statement-breakpoint
ALTER TABLE "attribute_semantics" ADD CONSTRAINT "attribute_semantics_semantica_coerente" CHECK (
  ("aggregation" IS NULL OR "aggregation" IN ('SUM', 'AVG', 'NONE'))
  AND NOT ("unit" IN ('KM_L', 'BRL_KM', 'PERCENT') AND "aggregation" = 'SUM')
  AND NOT ("is_monetary" IS TRUE AND "unit" IS NOT NULL AND "unit" <> 'BRL')
);
