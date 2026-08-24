-- A frota do Promax entra no Fechamento — duas fontes novas, operacionais.
--
-- **O que isto acrescenta.** `FROTA_PROMAX_ATIVA` (01.22.02.00) e
-- `FROTA_PROMAX_INATIVA` (01.22.08.00) são a fotografia quinzenal de quais
-- veículos o Promax marca como em operação, ou não — quinzenal como as
-- demais fontes financeiras, não mensal. `fechamento_frota_promax`
-- guarda uma linha por veículo, com rastreabilidade até a competência, o
-- documento e a linha física do arquivo de origem — o mesmo desenho de
-- `fechamento_disponibilidade`.
--
-- **Não é fonte financeira, e a migration não pretende que seja.** Nenhuma
-- coluna daqui é somada em `fechamento_apuracao` ou em qualquer verba: a
-- conferência que estas linhas alimentam roda em
-- `lib/fechamento/src/frota-promax-comparacao.ts`, fora do motor de cálculo.
-- Ver `dominio.ts`, onde `ladoDaFonte` classifica as duas como
-- `CONFERENCIA_OPERACIONAL` e não como `DEVIDO`/`DEMONSTRADO`.
--
-- **Multi-tenant pelo mesmo caminho de sempre.** Como toda tabela de linha
-- deste módulo, o isolamento entre competências (e portanto entre unidade e
-- transportadora) é `competencia_id`, com `on delete cascade` a partir da
-- competência — não há tenant_id separado neste módulo porque a competência
-- já é o limite de isolamento: uma linha de frota só é lida através de uma
-- competência, e a competência já responde por (unidade, transportadora,
-- tipo de operação).
--
-- **A proteção de competência congelada acompanha a tabela desde que ela
-- nasce**, com o mesmo gatilho `fechamento_recusar_escrita_em_encerrada()` que
-- todas as outras tabelas de linha usam (ver a `0039`). Diferente da `0055`,
-- não há dado existente para migrar — a tabela é nova e vazia — então não há
-- por que desabilitar gatilho nenhum: o `CREATE TRIGGER` roda uma vez, no fim,
-- sobre uma tabela sem linha.
--
-- **A lista fechada de `fechamento_documento.tipo` cresce em duas entradas.**
-- O `DROP CONSTRAINT` seguido do `ADD CONSTRAINT`, dentro da mesma transação de
-- migration, é o mesmo padrão da `0055` para trocar a lista — aqui só para
-- somar dois valores nela, sem remover nenhum existente e sem tocar em linha
-- de documento já gravada.
--
-- TODO(Rebeca): o layout de colunas do 01.22.02.00 e do 01.22.08.00 não foi
-- confirmado com a amostra real do Promax — ver o TODO em
-- `lib/fechamento/src/dominio.ts`, junto de `TipoDeFonte`, e
-- `lib/fechamento/src/leitores/mapeamento-frota-promax.ts`.

CREATE TABLE "fechamento_frota_promax" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"documento_id" uuid NOT NULL,
	"competencia_id" uuid NOT NULL,
	"linha_no_arquivo" integer NOT NULL,
	"situacao" text NOT NULL,
	"unidade" text NOT NULL,
	"placa" text NOT NULL,
	"modelo" text NOT NULL,
	"categoria" text,
	CONSTRAINT "fechamento_frota_promax_situacao" CHECK ("fechamento_frota_promax"."situacao" in ('ATIVA', 'INATIVA'))
);
--> statement-breakpoint
ALTER TABLE "fechamento_documento" DROP CONSTRAINT "fechamento_documento_tipo";--> statement-breakpoint
ALTER TABLE "fechamento_frota_promax" ADD CONSTRAINT "fechamento_frota_promax_documento_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."fechamento_documento"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fechamento_frota_promax" ADD CONSTRAINT "fechamento_frota_promax_competencia_fk" FOREIGN KEY ("competencia_id") REFERENCES "public"."fechamento_competencia"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fechamento_frota_promax_por_competencia" ON "fechamento_frota_promax" USING btree ("competencia_id","situacao");--> statement-breakpoint
CREATE INDEX "fechamento_frota_promax_por_documento" ON "fechamento_frota_promax" USING btree ("documento_id");--> statement-breakpoint
ALTER TABLE "fechamento_documento" ADD CONSTRAINT "fechamento_documento_tipo" CHECK ("fechamento_documento"."tipo" in ('OPERACAO', 'CTE', 'PAGAMENTO', 'DISPONIBILIDADE_FF', 'DISPONIBILIDADE_VAN', 'REQUISICOES', 'CONCILIACAO', 'FROTA_PROMAX_ATIVA', 'FROTA_PROMAX_INATIVA'));--> statement-breakpoint

-- O gatilho de competência congelada, no mesmo molde reentrante da `0039` —
-- seguro para rodar de novo se algum dia esta migration for reaplicada.
DO $reentrante$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'fechamento_frota_promax_congelada') THEN
		CREATE TRIGGER "fechamento_frota_promax_congelada"
		BEFORE INSERT OR UPDATE OR DELETE ON "fechamento_frota_promax"
		FOR EACH ROW EXECUTE FUNCTION fechamento_recusar_escrita_em_encerrada();
	END IF;
END
$reentrante$;
