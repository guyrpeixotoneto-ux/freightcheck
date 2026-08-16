-- `ciclo` não é uma quantidade, e a média de 1,16 ciclos nunca quis dizer nada.
--
-- A auditoria classificou os dois `ciclo` como ERRADO por inspeção — ordinal
-- recebendo média — e a investigação de 16/08/2026 foi ao dado antes de mexer.
-- O que ela mediu, sobre o export real:
--
--   1. **Só existem dois valores**, 1 e 2, inteiros, nos dois equipamentos.
--   2. **A transição é monotônica.** Nas nove vigências há 17 mudanças de valor
--      (7 carretas, 10 cavalos) e *todas* vão de 1 para 2. Nenhuma volta.
--   3. **Ela é o portão do lucro do novo ciclo.** No cavalo, `ciclo = 1` tem
--      `lucroFixomodeloNovoCicloCavalo` zerado nas 503 linhas; `ciclo = 2` tem
--      valor em 51 das 55, média R$ 3.280,15. Na carreta, 4% contra 90%.
--
-- Isso é fase contratual, não contagem: o ativo está no primeiro ciclo ou já
-- entrou no segundo, e a virada é o evento que destrava outra remuneração. O
-- número 1 e o número 2 são nomes de estado — a distância entre eles não é uma
-- unidade de nada, e é por isso que somar ou tirar média produz um número sem
-- referente.
--
-- O efeito prático hoje: a série do detalhe publica `average = 1,16` para os
-- cavalos de agosto/2026, apresentada como leitura legítima. A leitura certa já
-- existe no produto e é `getAttributeDomain`, que responde "52 cavalos no ciclo
-- 1 (83,9%), 10 no ciclo 2 (16,1%)" — que é a frase que alguém usa numa reunião.
-- Com `NONE`, `podeTirarMedia` recusa a média e a tela cai no domínio.
--
-- O que esta migration deliberadamente NÃO faz: propor unidade. `QTD` está
-- errado — ciclo não é quantidade —, mas trocá-lo por um rótulo novo seria
-- inventar vocabulário que o modelo ainda não tem (a natureza da grandeza é o
-- PR seguinte). Deixá-lo em `QTD` com `NONE` já impede toda aritmética, que é o
-- dano real; a unidade fica registrada como pendência na definição.

-- ---------------------------------------------------------------------------
-- 1. `ciclo`: a agregação, a definição, e o registro de quem mudou e por quê
-- ---------------------------------------------------------------------------

-- `RETURNING` alimenta o evento: só entra no histórico a linha que de fato
-- mudou. Sem isso, rodar a migration duas vezes — o que a adoção de registro
-- perdido faz com toda migration que não cria objeto — duplicaria o registro,
-- e num banco já corrigido inventaria uma correção que não houve.
WITH corrigidos AS (
UPDATE "attribute"
   SET "aggregation" = 'NONE',
       "definition" = coalesce("definition",
         'Fase do contrato do ativo: 1 = primeiro ciclo, 2 = ciclo renovado. ' ||
         'Não é quantidade — os dois valores são nomes de estado, e a passagem ' ||
         'de 1 para 2 é o que destrava o lucro do novo ciclo (medido no export: ' ||
         'no ciclo 1 esse lucro é zero em todas as linhas). Não soma e não tira ' ||
         'média; a leitura é quantos ativos estão em cada ciclo. Pendência para ' ||
         'a curadoria: a unidade QTD é imprecisa e ficou como está por não haver ' ||
         'rótulo melhor no modelo.')
 WHERE "code" IN ('carreta.ciclo', 'cavalo.ciclo')
   AND "aggregation" IS DISTINCT FROM 'NONE'
RETURNING "id", "code", 'AVG'::text AS antes
)
INSERT INTO "curation_event"
  ("change_category", "target_kind", "target_id", "target_label", "field",
   "value_before", "value_after", "actor", "reason", "detail")
SELECT 'CURATION_CHANGE', 'ATTRIBUTE', c."id", c."code", 'aggregation',
       c.antes, 'NONE', 'migration:0024_ciclo_nao_e_quantidade',
       'Investigado no export real em 16/08/2026: ciclo assume só 1 e 2, muda ' ||
       'sempre de 1 para 2 (17 transições, nenhuma no sentido inverso) e separa ' ||
       'quem recebe o lucro do novo ciclo. É fase contratual, não quantidade — ' ||
       'a média de 1,16 ciclos que a tela publicava não descrevia nada.',
       jsonb_build_object('changeKind', 'CORRECAO_SEMANTICA',
                          'evidencia', 'transicoes=17 monotonicas; ciclo=1 sem lucro de novo ciclo')
  FROM corrigidos c;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. `prazoPagamento`: os dois caminhos convergem para "sem proposta"
-- ---------------------------------------------------------------------------
-- A 0023 normalizou para `NONE` o que violava a invariante do tipo, e o motor
-- de proposta passou a devolver *nenhuma* agregação para tipo `UNKNOWN`. As
-- duas decisões estão certas isoladamente e discordam entre si: um banco novo
-- termina com `NULL`, um banco migrado com `NONE`, no mesmo atributo.
--
-- Fica `NULL`, que é o estado honesto. `NONE` é uma constatação — "este valor
-- não admite aritmética" — e sobre uma coluna que o import nunca viu preenchida
-- (zero linhas nas nove vigências, tipo não observado) não há o que constatar.
-- A 0023 não podia saber disso: ela precisava apenas de um estado que a
-- constraint aceitasse, e `NULL` também é aceito.

WITH normalizados AS (
UPDATE "attribute"
   SET "aggregation" = NULL
 WHERE "data_type" = 'UNKNOWN'
   AND "aggregation" = 'NONE'
   AND NOT EXISTS (
     SELECT 1 FROM "fact" f
      WHERE f."attribute_id" = "attribute"."id" AND NOT f."is_null"
   )
RETURNING "id", "code"
)
INSERT INTO "curation_event"
  ("change_category", "target_kind", "target_id", "target_label", "field",
   "value_before", "value_after", "actor", "reason", "detail")
SELECT 'CURATION_CHANGE', 'ATTRIBUTE', n."id", n."code", 'aggregation',
       'NONE', NULL, 'migration:0024_ciclo_nao_e_quantidade',
       'Coluna sem tipo observado e sem nenhuma linha preenchida no export: ' ||
       'não há o que constatar sobre a agregação dela. Volta a "sem proposta", ' ||
       'que é onde um banco recém-semeado já a deixa.',
       jsonb_build_object('changeKind', 'CORRECAO_SEMANTICA')
  FROM normalizados n;
