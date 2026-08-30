-- ---------------------------------------------------------------------------
-- A PRESENÇA DA VIGÊNCIA — a tela deixa de reler os fatos para contar entidades.
-- ---------------------------------------------------------------------------
--
-- `getFamiliesView` e `getRangeAnalysis` respondiam "quantas entidades de cada
-- tipo cada vigência tem" varrendo os fatos das vigências do contexto, a cada
-- carregamento. Medido em 30/08/2026, sobre o export real:
--
--   linhas de `fact` lidas por consulta ........... 83.241
--   números produzidos ............................ 18
--   duração ....................................... 110 a 172 ms
--   vezes por carregamento de tela ................ 2 (a mesma consulta)
--   participação no SQL do load ................... 260 de 301 ms (86%)
--
-- Em produção a mesma rota custa de 814 a 3.799 ms, variando com o que está em
-- `shared_buffers` — e quem abre a tela fria paga o pior caso.
--
-- ---------------------------------------------------------------------------
-- Por que o grão é a entidade, e não a contagem por vigência
-- ---------------------------------------------------------------------------
--
-- Porque a contagem por vigência **não sobrevive a ocultar uma importação**.
-- `fato_visivel` (`0061`) esconde o fato pela origem dele —
-- `origin_import_run_id` —, não pela importação do snapshot; e o fato herdado,
-- que vive num snapshot visível e nasceu num arquivo oculto, é a regra e não a
-- exceção: **54 dos 108 snapshots** do acervo medido misturam origens. Ocultar
-- a importação A muda a contagem de uma vigência que pertence à importação B.
--
-- Guardar o número pronto por vigência — o desenho do censo do balanço, da
-- `0080` — daria número errado no dia em que alguém ocultasse um arquivo. Aqui
-- a escrita registra o par (vigência, entidade) com a origem, e **a leitura**
-- filtra as origens ocultas antes de contar. É a mesma divisão de trabalho do
-- censo, num grão que a ocultação não quebra.
--
-- E a contagem continua sendo `count(DISTINCT entity_id)` na leitura, nunca
-- soma de pré-agregados por origem: a mesma entidade pode ter fato de duas
-- origens no mesmo snapshot, e somar contaria duas vezes. No acervo medido isso
-- não acontece (zero casos), mas é dado, não invariante — e uma soma erraria em
-- silêncio no dia em que acontecesse.
--
-- ---------------------------------------------------------------------------
-- Por que isto não envelhece
-- ---------------------------------------------------------------------------
--
-- `fact` é imutável por gatilho (`fact_immutable`) assim que o snapshot deixa
-- de ser DRAFT: UPDATE e DELETE são recusados, e nenhum caminho do produto
-- tenta — conferido antes de escrever esta migration. A única porta é a
-- exclusão física, e quem responde por ela é o `ON DELETE CASCADE` abaixo,
-- sem nenhuma lógica paralela de invalidação.
--
-- **Não invalida:** ocultar ou restaurar importação (é filtro de leitura);
-- curadoria e reclassificação (não tocam em `fact`); reprocessamento (cria
-- snapshots novos, com presença própria).
--
-- **O `CONJUNTO` fica de fora**, de propósito: ele conta o par cavalo→carreta
-- por `entity_identifier.is_current`, que é estado do presente e não da
-- vigência. Congelá-lo mudaria a semântica atual, e não é o que esta mudança
-- se propõe a fazer. Continua sendo apurado ao vivo.
--
-- ---------------------------------------------------------------------------
-- O backfill
-- ---------------------------------------------------------------------------
--
-- Deliberadamente **fora** desta migration, como na `0080`: o `INSERT ...
-- SELECT` sobre todo o histórico cresce com o acervo, e uma migration que não
-- termina é uma partida que não termina. Quem preenche o histórico é
-- `preencherPresencasPendentes()`, na partida do servidor, um snapshot por vez
-- e reentrante.
--
-- Enquanto ele não passa, o snapshot sem presença é contado na hora, pelo
-- caminho de sempre — a resposta é a mesma desde o primeiro instante, e só fica
-- mais rápida conforme o backfill avança. Não há janela em que a tela minta.
--
-- Reentrante, como as anteriores.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "snapshot_presenca" (
	"snapshot_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"origin_import_run_id" uuid NOT NULL,
	CONSTRAINT "snapshot_presenca_snapshot_id_entity_id_origin_import_run_id_pk" PRIMARY KEY("snapshot_id","entity_id","origin_import_run_id")
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snapshot_presenca_snapshot_id_snapshot_id_fk') THEN
		ALTER TABLE "snapshot_presenca" ADD CONSTRAINT "snapshot_presenca_snapshot_id_snapshot_id_fk"
			FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshot"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snapshot_presenca_entity_id_entity_id_fk') THEN
		ALTER TABLE "snapshot_presenca" ADD CONSTRAINT "snapshot_presenca_entity_id_entity_id_fk"
			FOREIGN KEY ("entity_id") REFERENCES "public"."entity"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'snapshot_presenca_origin_import_run_id_import_run_id_fk') THEN
		ALTER TABLE "snapshot_presenca" ADD CONSTRAINT "snapshot_presenca_origin_import_run_id_import_run_id_fk"
			FOREIGN KEY ("origin_import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "snapshot_presenca_snapshot_idx" ON "snapshot_presenca" USING btree ("snapshot_id");
