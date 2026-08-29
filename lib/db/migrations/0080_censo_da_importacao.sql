-- ---------------------------------------------------------------------------
-- O CENSO DA IMPORTAÇÃO — o balanço deixa de ser recalculado a cada leitura.
-- ---------------------------------------------------------------------------
--
-- `GET /api/balance` respondia "a massa fecha em cada importação?" varrendo o
-- acervo inteiro de células cruas, a cada requisição. Medido em 29/08/2026,
-- sobre 12 importações e 6 unidades:
--
--   linhas lidas do Postgres por requisição ....... 1.022.946
--     das quais raw_cell (varredura completa) ..... 514.878
--     das quais staged_fact (varredura completa) .. 499.446
--   resposta ...................................... 2,5 KB
--   latência quente ............................... 2.267 ms
--
-- O custo não é do tamanho da resposta nem do número de importações listadas:
-- é do **histórico inteiro de células já importadas**, e cada importação nova o
-- aumenta para sempre. Quem paga é o Resumo executivo, que usa a resposta para
-- um cartão de percentual de cobertura.
--
-- Esta tabela é a resposta: cada importação grava, quando termina de preparar,
-- quantas células foram para cada destino. A leitura passa a somar linhas
-- prontas em vez de reclassificar células.
--
-- ---------------------------------------------------------------------------
-- Por que isto é exato, e não uma aproximação
-- ---------------------------------------------------------------------------
--
-- Porque a classificação de uma célula **nunca dependeu de outra importação**.
-- Toda entrada da conta é escopada ao run: as abas saem de `raw_sheet` dele, as
-- células das linhas dessas abas, os fatos preparados de
-- `staged_fact.import_run_id`, as recusas de `validation_issue.import_run_id`, e
-- o mapeamento de coluna por `raw_sheet_id`. Conferido antes de escrever esta
-- migration: rodar a classificação sem filtro e rodá-la uma vez por importação
-- devolve **as mesmas 36 linhas**, idênticas.
--
-- E por que o valor não envelhece: depois de `stage()` nenhuma entrada muda
-- mais. O RAW é imutável por trigger (`freightcheck_raw_is_immutable` recusa
-- UPDATE e DELETE), e nenhum caminho do produto apaga ou atualiza
-- `staged_fact`, `column_mapping` ou as duas recusas de linha que a
-- classificação lê. Gravar o censo não é cache: é registrar um fato que parou
-- de mudar.
--
-- ---------------------------------------------------------------------------
-- O que invalida, e o que não
-- ---------------------------------------------------------------------------
--
-- **Não invalida:** ocultar ou reexibir uma importação (`hidden_at` é filtro de
-- leitura, e a lista já escolhe quais runs mostrar); promover (mexe em `fact` e
-- `snapshot`, que não entram nesta conta); curar uma semântica (é a etapa 3 do
-- balanço, e não passa por aqui); importar outro arquivo (é outro run).
--
-- **Invalida:** excluir a importação — e é o `ON DELETE CASCADE` abaixo que
-- resolve, porque a exclusão é a única operação que apaga RAW. Reprocessar não
-- invalida coisa nenhuma: um reprocessamento é um run **novo**, com raw próprio
-- e censo próprio; o anterior continua com o censo dele, que continua
-- verdadeiro sobre o que ele fez.
--
-- ---------------------------------------------------------------------------
-- A marca de "já recenseado" são as próprias linhas — e não uma coluna
-- ---------------------------------------------------------------------------
--
-- A primeira forma desta tabela vinha com uma `import_run.censo_calculado_em`,
-- para separar "recenseado, e deu zero célula" de "nunca recenseado", que a
-- tabela representa igual: nenhuma linha. A coluna saiu, e a razão é que a
-- primeira situação **não existe**. Uma importação só chega a `stage()` depois
-- de ler pelo menos uma célula; um run recenseado tem sempre pelo menos uma
-- linha aqui. "Nenhuma linha" é, sem ambiguidade, "ainda não recenseado".
--
-- O que se ganha ao tirá-la é maior do que uma coluna a menos. Uma coluna em
-- `import_run` — tabela que Production **já tem** — é superfície de deploy: ela
-- entra no diff do Publishing, na lista do `bridge`, e precisa de reconciliação
-- própria. E, pior, ela pode sobreviver a um `down` que derrubou esta tabela,
-- e então o balanço leria um censo vazio como se fosse verdade. Sem a coluna,
-- essa mentira é impossível por construção: tabela vazia é histórico inteiro
-- por recensear, que a leitura calcula na hora.
--
-- ---------------------------------------------------------------------------
-- O backfill
-- ---------------------------------------------------------------------------
--
-- Deliberadamente **fora** desta migration. O `INSERT ... SELECT` que a
-- classificação exige custa ~2,3 s sobre o acervo medido e cresce com ele;
-- numa base grande, uma migration que não termina é uma partida que não
-- termina. Quem recenseia o histórico é `recensearPendentes()`
-- (`lib/balance/src/censo.ts`), chamada na partida do servidor em segundo
-- plano, uma importação por vez e reentrante.
--
-- Enquanto o backfill não passa, o run não tem linha aqui e a leitura o calcula
-- na hora — a resposta é a de sempre desde o primeiro instante, e só fica mais
-- rápida conforme o backfill avança. Não há janela em que a tela minta.
--
-- Reentrante, como as anteriores: cada objeto é primeiro procurado, e a
-- migration roda duas vezes sobre o mesmo banco sem falhar.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "import_run_censo" (
	"import_run_id" uuid NOT NULL,
	"destino" text NOT NULL,
	"celulas" integer NOT NULL,
	CONSTRAINT "import_run_censo_import_run_id_destino_pk" PRIMARY KEY("import_run_id","destino")
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'import_run_censo_import_run_id_import_run_id_fk'
	) THEN
		ALTER TABLE "import_run_censo" ADD CONSTRAINT "import_run_censo_import_run_id_import_run_id_fk"
			FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
