-- Dar a cada atributo a versão de semântica que ele nunca teve.
--
-- ---------------------------------------------------------------------------
-- O estado que esta migration conserta
-- ---------------------------------------------------------------------------
-- A `0005` criou `attribute_semantics` e não preencheu nenhuma linha — de
-- propósito: preencher era trabalho de `backfillSemantics`, na curadoria. Só
-- que essa função é chamada pelo `dev-seed` e pelos testes, e por mais ninguém.
-- A promoção, que é o único caminho de produção que cria atributo, criava
-- `attribute` e parava aí.
--
-- Medido em 16/08/2026, num banco com o export real promovido e nenhuma
-- curadoria: **138 atributos, 138 sem versão**. Não é o caso de uma coluna.
--
-- O sintoma visível era pequeno: "fórmula de cálculo" mora só na linha
-- versionada, então a tela de Curadoria recusava gravá-la pedindo um backfill
-- que a interface não sabe rodar. O sintoma calado era o caro: a comparação
-- resolve unidade, periodicidade e base de cálculo pela versão em vigor na data
-- de cada vigência, e sem nenhuma linha ela cai na projeção — **nenhuma mudança
-- de semântica da fonte é detectável**. O caso que justificou a tabela inteira,
-- o IPVA trocando de base de cálculo duas vezes sem trocar de unidade, passaria
-- batido.
--
-- ---------------------------------------------------------------------------
-- Por que uma migration, e não "rodem o backfill"
-- ---------------------------------------------------------------------------
-- Porque "rodem o backfill" é exatamente a instrução que ninguém executou por
-- todo o tempo em que esta tabela existiu. Uma migration tem um `when` que
-- registro nenhum contém: roda uma vez, sozinha, no Development, no de
-- produção, no de cada teste e em todo banco que venha a existir.
--
-- Daqui para a frente a versão nasce junto do atributo, na mesma transação da
-- promoção — ver `garantirSemanticaInicial`, em `lib/db/src/semantica-inicial.ts`,
-- que é a mesma regra escrita uma vez e chamada pela importação e pela
-- curadoria. Esta migration é o passado; aquela função é o futuro. Num banco em
-- dia esta aqui é no-op e não escreve nada.
--
-- ---------------------------------------------------------------------------
-- O que ela NÃO faz: inventar semântica
-- ---------------------------------------------------------------------------
-- A versão 1 copia o atributo, coluna a coluna. Num atributo recém-importado
-- isso é unidade nula, periodicidade nula, agregação nula, monetário nulo e
-- `UNKNOWN` — ela não afirma que a coluna é mensal, nem que é dinheiro, nem que
-- alguém a conferiu. Afirma uma coisa só, verdadeira por construção: este é o
-- trecho da série sobre o qual o que sabemos é isto, inclusive quando é nada.
--
-- `calculation_basis` nasce nula, e é a única coisa que não vem do atributo:
-- não existe esse campo em `attribute`, ninguém o escreveu ainda, e um palpite
-- ali seria a invenção que este arquivo não pode cometer.
--
-- `change_origin = 'INITIAL'` é o que impede a linha de virar notícia: a
-- comparação só emite SEMANTICS_CHANGE para versões com origem
-- `SOURCE_SEMANTICS_CHANGE`. Um atributo com uma versão só nunca é incompatível
-- consigo mesmo, então nenhuma comparação já calculada muda de número.

INSERT INTO "attribute_semantics" (
  "attribute_id", "version", "effective_from", "effective_until",
  "unit", "periodicity", "aggregation", "is_monetary", "taxonomy_node_id",
  "calculation_basis", "definition",
  "semantics_status", "confirmed_by", "confirmed_at", "rationale", "change_origin"
)
SELECT a."id", 1,
       coalesce((SELECT min(s."effective_date") FROM "snapshot" s), DATE '1970-01-01'),
       NULL,
       a."unit", a."periodicity", a."aggregation", a."is_monetary", a."taxonomy_node_id",
       NULL, a."definition",
       a."semantics_status"::text, a."confirmed_by", a."confirmed_at",
       a."semantics_rationale", 'INITIAL'
  FROM "attribute" a
 WHERE NOT EXISTS (
         SELECT 1 FROM "attribute_semantics" v WHERE v."attribute_id" = a."id"
       );--> statement-breakpoint

-- A versão inicial cobre a série inteira, e não o pedaço que existia quando ela
-- foi criada. Num banco que já rodou o backfill antes de uma importação
-- retroativa, a versão 1 começa depois da vigência mais antiga — e a comparação
-- daquela vigência deixa de resolver semântica, em silêncio.
--
-- Só a inicial se move, e só quando cabe: `version = 1`, origem `INITIAL`, e
-- nunca para depois do próprio fim. A data de uma versão aberta por mudança da
-- fonte **significa** alguma coisa — a vigência em que a regra mudou — e essa
-- não é tocada por nada.
UPDATE "attribute_semantics" v
   SET "effective_from" = serie."inicio"
  FROM (
    SELECT coalesce((SELECT min(s."effective_date") FROM "snapshot" s), DATE '1970-01-01')
             AS "inicio"
  ) AS serie
 WHERE v."version" = 1
   AND v."change_origin" = 'INITIAL'
   AND v."effective_from" <> serie."inicio"
   AND (v."effective_until" IS NULL OR serie."inicio" < v."effective_until");
