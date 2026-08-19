-- O 03.08.20 — o demonstrativo de pagamento, a sexta fonte do fechamento.
--
-- **O que ele resolve.** Até aqui a apuração reconstruía o variável (2Art +
-- conciliação), o complementar (requisições) e os descontos no fixo (03.08.18),
-- e não reconstruía **o fixo em si**: frota, equipe de entrega e despesa
-- administrativa entravam na conta pelo que o CT-e dizia, sem que nada os
-- conferisse. Na quinzena de referência — CDD Belém, 16–31/07/2026 — isso eram
-- R$ 654.310,24 dos R$ 1.473.432,61 emitidos: 44% do dinheiro sustentado pelo
-- próprio documento fiscal que se queria auditar.
--
-- O 03.08.20 é o documento que a Ambev e a transportadora assinam ("declaramos
-- estar de acordo com os valores acima"), e ele abre cada verba em seis
-- colunas. A coluna `CTRC-ICMS` é a que vira CT-e — e ela bate **ao centavo**
-- com o 03.08.15 nas seis verbas fixas dos dois canais.
--
-- **Duas tabelas e não uma.** O relatório tem dois grãos: a verba, com as seis
-- colunas, e o desconto, que é um valor com rótulo. Espremer os dois numa
-- tabela só obrigaria metade das colunas a ser nula em metade das linhas, e a
-- primeira consulta teria de saber qual metade ler.
--
-- **Nenhum número é derivado na importação.** `valor_faturado` é
-- `nf_iss + ctrc_icms` no arquivo, e é gravado como o arquivo o traz.
-- Recalculá-lo apagaria exatamente o erro que se quer encontrar no dia em que a
-- soma do Promax não fechar.
--
-- O DDL abaixo é o que `drizzle-kit generate` produziu do schema, com três
-- diferenças deliberadas, todas na forma e nenhuma no resultado: os objetos
-- nascem reentrantes (`IF NOT EXISTS`, um bloco por chave), como toda a `0039`,
-- para que a adoção de um banco que já os tem não trave a fila; e os dois
-- gatilhos de congelamento entram no fim, porque o drizzle não modela gatilho e
-- uma fonte que continuasse aceitando escrita depois do encerramento seria uma
-- porta aberta para mudar, em silêncio, a conta que alguém já cobrou.

CREATE TABLE IF NOT EXISTS "fechamento_pagamento_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"canal" text NOT NULL,
	"bloco" text NOT NULL,
	"vbz" integer NOT NULL,
	"nome_no_arquivo" text NOT NULL,
	"sem_imposto" numeric(14, 2) DEFAULT '0' NOT NULL,
	"nf_iss" numeric(14, 2) DEFAULT '0' NOT NULL,
	"ctrc_icms" numeric(14, 2) DEFAULT '0' NOT NULL,
	"valor_faturado" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vlc_nf_iss" numeric(14, 2) DEFAULT '0' NOT NULL,
	"vlc_ctrc_icms" numeric(14, 2) DEFAULT '0' NOT NULL,
	CONSTRAINT "fechamento_pagamento_item_canal" CHECK ("fechamento_pagamento_item"."canal" in ('ROTA', 'AS')),
	CONSTRAINT "fechamento_pagamento_item_bloco" CHECK ("fechamento_pagamento_item"."bloco" in ('FRETE', 'OUTROS_CUSTOS'))
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "fechamento_pagamento_desconto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"canal" text NOT NULL,
	"tipo" text NOT NULL,
	"rotulo" text NOT NULL,
	"valor" numeric(14, 2) DEFAULT '0' NOT NULL,
	"base" numeric(14, 2),
	"percentual" numeric(8, 4),
	CONSTRAINT "fechamento_pagamento_desconto_canal" CHECK ("fechamento_pagamento_desconto"."canal" in ('ROTA', 'AS'))
);--> statement-breakpoint

DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_pagamento_item_documento_fk') THEN
		ALTER TABLE "fechamento_pagamento_item"
			ADD CONSTRAINT "fechamento_pagamento_item_documento_fk"
			FOREIGN KEY ("documento_id") REFERENCES "fechamento_documento"("id") ON DELETE CASCADE;
	END IF;
END
$reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_pagamento_item_competencia_fk') THEN
		ALTER TABLE "fechamento_pagamento_item"
			ADD CONSTRAINT "fechamento_pagamento_item_competencia_fk"
			FOREIGN KEY ("competencia_id") REFERENCES "fechamento_competencia"("id") ON DELETE CASCADE;
	END IF;
END
$reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_pagamento_desconto_documento_fk') THEN
		ALTER TABLE "fechamento_pagamento_desconto"
			ADD CONSTRAINT "fechamento_pagamento_desconto_documento_fk"
			FOREIGN KEY ("documento_id") REFERENCES "fechamento_documento"("id") ON DELETE CASCADE;
	END IF;
END
$reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_pagamento_desconto_competencia_fk') THEN
		ALTER TABLE "fechamento_pagamento_desconto"
			ADD CONSTRAINT "fechamento_pagamento_desconto_competencia_fk"
			FOREIGN KEY ("competencia_id") REFERENCES "fechamento_competencia"("id") ON DELETE CASCADE;
	END IF;
END
$reentrante$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "fechamento_pagamento_item_por_verba" ON "fechamento_pagamento_item" ("competencia_id","vbz");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_pagamento_item_por_documento" ON "fechamento_pagamento_item" ("documento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_pagamento_desconto_por_competencia" ON "fechamento_pagamento_desconto" ("competencia_id","canal");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fechamento_pagamento_desconto_por_documento" ON "fechamento_pagamento_desconto" ("documento_id");--> statement-breakpoint

-- O tipo de documento passa a admitir `PAGAMENTO`. O `DROP` vem com
-- `IF EXISTS` porque a fila também roda sobre bancos adotados, onde a
-- constraint pode ter outro nome ou não existir.
ALTER TABLE "fechamento_documento" DROP CONSTRAINT IF EXISTS "fechamento_documento_tipo";--> statement-breakpoint
ALTER TABLE "fechamento_documento" ADD CONSTRAINT "fechamento_documento_tipo" CHECK ("fechamento_documento"."tipo" in ('OPERACAO', 'CTE', 'PAGAMENTO', 'DISPONIBILIDADE', 'REQUISICOES', 'CONCILIACAO'));--> statement-breakpoint

-- As duas tabelas novas congelam junto com a competência, como as outras sete.
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fechamento_pagamento_item_congelada') THEN
		CREATE TRIGGER "fechamento_pagamento_item_congelada"
		BEFORE INSERT OR UPDATE OR DELETE ON "fechamento_pagamento_item"
		FOR EACH ROW EXECUTE FUNCTION fechamento_recusar_escrita_em_encerrada();
	END IF;
END
$reentrante$;--> statement-breakpoint
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fechamento_pagamento_desconto_congelada') THEN
		CREATE TRIGGER "fechamento_pagamento_desconto_congelada"
		BEFORE INSERT OR UPDATE OR DELETE ON "fechamento_pagamento_desconto"
		FOR EACH ROW EXECUTE FUNCTION fechamento_recusar_escrita_em_encerrada();
	END IF;
END
$reentrante$;
