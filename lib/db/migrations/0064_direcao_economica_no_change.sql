-- A direção econômica, também snapshotada em `change`.
--
-- Mesma razão de `cost_class`/`taxonomy_path`/`semantics_status` na mesma
-- tabela: o Radar de Trechos lê `economic_direction` para decidir se uma
-- variação foi favorável ou desfavorável, e uma curadoria posterior (alguém
-- corrige a direção de um atributo mês que vem) não pode reescrever em
-- silêncio o veredito de um change-set já calculado. A leitura ao vivo de
-- `attribute.economic_direction` teria exatamente esse risco.
--
-- Anuláveis, sem backfill: change-sets antigos ficam com `NULL` aqui, que o
-- Radar já trata como "não classificado" — o mesmo estado de quem nunca foi
-- curado.

ALTER TABLE "change" ADD COLUMN "economic_direction" text;--> statement-breakpoint
ALTER TABLE "change" ADD COLUMN "economic_effect" text;
