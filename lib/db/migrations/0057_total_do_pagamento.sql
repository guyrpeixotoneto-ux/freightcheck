-- O `Total Remuneracao` do 03.08.20 passa a ser guardado, em vez de recalculado.
--
-- **O que isto conserta.** `lerPagamento` sempre extraiu o total que o
-- relatório declara (`Pagamento.totais`), mas a gravação o descartava: na
-- releitura, `de-para.ts` e `persistencia.ts` reconstruíam o número somando
-- `valor_faturado` das verbas. O efeito é que o total do relatório e a soma
-- das linhas eram a mesma conta **por construção** — nunca podiam divergir —,
-- e com isso se perdia a única conferência independente que o 03.08.20
-- oferece. Um relatório cujo rodapé não fecha com as próprias linhas (leitor
-- que perdeu uma verba, export truncado, desconto novo não reconhecido)
-- passava sem sintoma nenhum.
--
-- Com a tabela, os dois números existem separados e podem ser confrontados.
-- Esta migration não cria a conferência — ela só para de jogar fora o dado de
-- que a conferência precisa.
--
-- **Sem backfill, e de propósito.** O total dos documentos já importados não
-- existe em lugar nenhum: o arquivo original não é reprocessado por migration
-- e somar `valor_faturado` para preencher a coluna seria gravar como
-- "declarado pelo relatório" um número que o relatório não disse — exatamente
-- a confusão que esta tabela existe para desfazer. Documento antigo fica sem
-- linha aqui, e a conferência que vier depois deve tratar ausência como "não
-- sei", nunca como "bate". Reimportar o 03.08.20 preenche.
--
-- Reentrante como as demais (ver a `0056`): a fila pode reencontrar um banco
-- cujo registro se perdeu com o schema de pé.

CREATE TABLE IF NOT EXISTS "fechamento_pagamento_total" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"canal" text NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	CONSTRAINT "fechamento_pagamento_total_canal" CHECK ("fechamento_pagamento_total"."canal" in ('ROTA', 'AS'))
);
--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" DROP CONSTRAINT IF EXISTS "fechamento_pagamento_total_documento_fk";--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" ADD CONSTRAINT "fechamento_pagamento_total_documento_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."fechamento_documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" DROP CONSTRAINT IF EXISTS "fechamento_pagamento_total_competencia_fk";--> statement-breakpoint
ALTER TABLE "fechamento_pagamento_total" ADD CONSTRAINT "fechamento_pagamento_total_competencia_fk" FOREIGN KEY ("competencia_id") REFERENCES "public"."fechamento_competencia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_pagamento_total_por_competencia" ON "fechamento_pagamento_total" USING btree ("competencia_id","canal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_pagamento_total_por_documento" ON "fechamento_pagamento_total" USING btree ("documento_id");--> statement-breakpoint

-- A proteção de competência congelada, no mesmo molde reentrante da `0039`.
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fechamento_pagamento_total_congelada') THEN
		CREATE TRIGGER "fechamento_pagamento_total_congelada"
		BEFORE INSERT OR UPDATE OR DELETE ON "fechamento_pagamento_total"
		FOR EACH ROW EXECUTE FUNCTION fechamento_recusar_escrita_em_encerrada();
	END IF;
END
$reentrante$;
