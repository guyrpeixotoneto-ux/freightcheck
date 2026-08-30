BEGIN;
SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '120s';

\echo '=== 00 · identidade do banco ==================================='
SELECT current_database() AS db,
       (SELECT count(*) FROM change_set) AS change_sets,
       (SELECT count(*) FROM change)     AS changes;

CREATE TEMP VIEW cs AS
SELECT c.id, sb.effective_date AS vigencia,
       c.value_changes, c.entities_added, c.entities_removed,
       c.impact_not_calculable, c.unchanged,
       c.calculated_impact_by_periodicity AS bruto,
       c.impacto_oficial_by_periodicity   AS oficial,
       c.deducao_rastro
FROM change_set c
JOIN snapshot sb ON sb.id = c.snapshot_b_id
WHERE sb.scope_hash = '1c76b852dbecf3b661cd4c722a8761afe65c3b2b1f3ac4f06fc319b2fe8369b1';

\echo '=== 01 · todas as vigencias · esperado 02/08: 102 alt, 24 add, 26 rem, 95 sem preco, +21.931,01'
SELECT vigencia, value_changes AS alteracoes, entities_added AS entraram,
       entities_removed AS sairam, impact_not_calculable AS sem_preco,
       unchanged AS intactos, bruto::text, oficial::text
FROM cs ORDER BY vigencia;

\echo '=== 02 · veiculos afetados · esperado 80 (02/08), 91 (01/08), 178 (01/07)'
SELECT s.vigencia, count(DISTINCT ch.entity_id) AS veiculos_afetados
FROM cs s JOIN change ch ON ch.change_set_id = s.id
WHERE ch.entity_id IS NOT NULL GROUP BY s.vigencia ORDER BY s.vigencia;

\echo '=== 03 · deducao de composicao · esperado bruto 43.862,01, oficial 21.931,01'
SELECT jsonb_pretty(deducao_rastro) FROM cs WHERE vigencia = '2026-08-02';

\echo '=== 04 · impacto por atributo · esperado finame +21.905,20 e lucro fixo +25,81'
SELECT a.code, a.display_name, ch.impact_periodicity AS period,
       count(*) AS alteracoes, sum(ch.impact_amount)::numeric(18,2) AS impacto
FROM cs s JOIN change ch ON ch.change_set_id = s.id
JOIN attribute a ON a.id = ch.attribute_id
WHERE s.vigencia = '2026-08-02' AND ch.impact_amount IS NOT NULL
GROUP BY a.code, a.display_name, ch.impact_periodicity
ORDER BY abs(sum(ch.impact_amount)) DESC;

\echo '=== 05 · impacto por placa · esperado RPG8G28 +17.227,35 / RPG1E60 +9.355,70 / OTI4A85 -4.652,04'
SELECT ei.identifier_value AS placa, ch.impact_periodicity AS period,
       count(*) AS alteracoes, sum(ch.impact_amount)::numeric(18,2) AS impacto
FROM cs s JOIN change ch ON ch.change_set_id = s.id
JOIN entity_identifier ei ON ei.entity_id = ch.entity_id AND ei.is_current
WHERE s.vigencia = '2026-08-02' AND ch.impact_amount IS NOT NULL
GROUP BY ei.identifier_value, ch.impact_periodicity
ORDER BY abs(sum(ch.impact_amount)) DESC;

\echo '=== 06 · O CASO #4 · devem aparecer DOIS destinos: 25.548,15 e 12.998,65'
SELECT ei.identifier_value AS placa, a.code AS atributo,
       ch.numeric_before::numeric(18,2) AS antes,
       ch.numeric_after::numeric(18,2)  AS depois,
       ch.impact_amount::numeric(18,2)  AS impacto
FROM cs s JOIN change ch ON ch.change_set_id = s.id
JOIN attribute a ON a.id = ch.attribute_id
LEFT JOIN entity_identifier ei ON ei.entity_id = ch.entity_id AND ei.is_current
WHERE s.vigencia = '2026-08-02' AND a.code ILIKE '%finame%'
ORDER BY ch.impact_amount DESC NULLS LAST;

\echo '=== 07 · lucro fixo novo ciclo · esperado OTI4A85 4.652,04->0 e RPG1E60 0->4.677,85'
SELECT ei.identifier_value AS placa, ch.numeric_before::numeric(18,2) AS antes,
       ch.numeric_after::numeric(18,2) AS depois,
       ch.impact_amount::numeric(18,2) AS impacto
FROM cs s JOIN change ch ON ch.change_set_id = s.id
JOIN attribute a ON a.id = ch.attribute_id
LEFT JOIN entity_identifier ei ON ei.entity_id = ch.entity_id AND ei.is_current
WHERE s.vigencia = '2026-08-02' AND a.code ILIKE '%lucro_fixo%'
ORDER BY ch.numeric_before DESC NULLS LAST;

\echo '=== 08 · DIVERGENCIA: lucro variavel 0->6.158,83 OU 2.405,01->7.972,05 ?'
SELECT ei.identifier_value AS placa, a.code,
       ch.numeric_before::numeric(18,2) AS antes,
       ch.numeric_after::numeric(18,2)  AS depois
FROM cs s JOIN change ch ON ch.change_set_id = s.id
JOIN attribute a ON a.id = ch.attribute_id
LEFT JOIN entity_identifier ei ON ei.entity_id = ch.entity_id AND ei.is_current
WHERE s.vigencia = '2026-08-02' AND a.code ILIKE '%lucro_variavel%' ORDER BY placa;

\echo '=== 09 · DIVERGENCIA: entraram/sairam 24 e 24, ou 24 e 26 ?'
SELECT entities_added AS entraram, entities_removed AS sairam FROM cs WHERE vigencia = '2026-08-02';
SELECT ch.change_type, count(*) AS n
FROM cs s JOIN change ch ON ch.change_set_id = s.id
WHERE s.vigencia = '2026-08-02' GROUP BY ch.change_type ORDER BY n DESC;

\echo '=== 10 · a placa ABC1D23 (#41) · esperado: zero linhas'
SELECT ei.identifier_value, ei.identifier_type
FROM entity_identifier ei
WHERE upper(replace(ei.identifier_value,'-','')) = 'ABC1D23';

\echo '=== 11 · serie IPVA cavalo · esperado 185.899,95 / 275.154,81 / 273.553,43 / 267.408,97'
SELECT sb.effective_date AS vigencia,
       count(*) FILTER (WHERE f.numeric_value IS NOT NULL) AS veiculos_com_valor,
       sum(f.numeric_value)::numeric(18,2) AS total,
       avg(f.numeric_value)::numeric(18,2) AS media
FROM fact f JOIN snapshot sb ON sb.id = f.snapshot_id
JOIN attribute a ON a.id = f.attribute_id
WHERE sb.scope_hash = '1c76b852dbecf3b661cd4c722a8761afe65c3b2b1f3ac4f06fc319b2fe8369b1'
  AND a.code ILIKE 'cavalo%ipva%'
GROUP BY sb.effective_date ORDER BY sb.effective_date;

\echo '=== 12 · curadoria · esperado 19 de 245 com significado'
SELECT count(*) AS atributos_total,
       count(*) FILTER (WHERE sm.id IS NOT NULL) AS com_significado
FROM attribute a
LEFT JOIN attribute_semantics asem ON asem.attribute_id = a.id
LEFT JOIN semantic_meaning sm ON sm.id = asem.meaning_id;

\echo '=== 13 · unidades · esperado Manaus, CDD Cebrasa, Equatorial, Camacari'
SELECT DISTINCT source_label FROM snapshot ORDER BY source_label;

COMMIT;
