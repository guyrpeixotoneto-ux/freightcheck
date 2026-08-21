-- ---------------------------------------------------------------------------
-- A unidade canônica — uma autoridade única sobre "qual unidade é esta".
-- ---------------------------------------------------------------------------
--
-- O produto tinha quatro representações independentes da mesma unidade do mundo
-- real, e nenhuma era autoridade sobre as outras:
--
--   fechamento_competencia.unidade_codigo  texto livre, digitado ao abrir
--   fechamento_parte(tipo, codigo)         populada da 0044 a partir da acima
--   remuneracao_unidade.codigo             texto livre, sem check
--   snapshot.canonical_scope               normalizado, mas é evidência de import
--
-- O fechamento então *adivinhava* se dois textos representavam a mesma unidade.
-- Uma pessoa abria a competência como `CDD Belém`, outra cadastrava a planilha
-- com o CNPJ, e o Resumo caía no painel antigo sem nada estar errado em tela
-- nenhuma. Melhorar a heurística de casamento trataria o sintoma; o defeito é
-- haver duas identidades para casar.
--
-- Daqui para a frente a identidade é `unidade.id`, e o CNPJ é o que a determina.
--
-- ---------------------------------------------------------------------------
-- O que esta migration NÃO faz — e por que isso é a parte importante
-- ---------------------------------------------------------------------------
--
-- **Ela não popula `unidade`.** A tabela nasce vazia e permanece vazia até
-- alguém cadastrar. Não há backfill a partir de `unidade_codigo`, de
-- `fechamento_parte`, de `remuneracao_unidade` nem de `snapshot.canonical_scope`.
--
-- A razão é semântica, não de cautela. Uma unidade canônica é um **cadastro** —
-- alguém afirma "esta unidade existe e o CNPJ dela é este". Derivá-la de um
-- arquivo faria o acervo criar identidade sozinho, que é precisamente o desenho
-- que esta mudança desfaz. E derivá-la de `443` ou de um nome seria adivinhação:
-- `443` é um código da Ambev, não um CNPJ, e não existe função que o converta.
--
-- O `canonical_scope` de um snapshot **é** evidência determinística — sai da
-- coluna `Unidade - CNPJ` normalizada por função pura, com check no banco. Por
-- isso ele vira **sugestão** na tela de Administração → Unidades, com o CNPJ já
-- preenchido, sob o estado "detectada no acervo, não cadastrada". Quem confirma
-- é gente, e a confirmação é o cadastro. Um `INSERT ... SELECT` a partir dele
-- pareceria a mesma coisa e não é: transformaria "este arquivo declarou este
-- CNPJ" em "esta unidade existe no FreightCheck", que é outra afirmação e é de
-- quem opera.
--
-- **Ela não toca em nada histórico.** Nenhum `scope_hash` é recalculado, nenhum
-- snapshot reescrito, nenhum código de fonte convertido. `081-0443` continua
-- `081-0443`, `443` continua `443`, `36` continua `36`. As duas colunas novas
-- nascem `NULL` — e `NULL` é a resposta honesta para "qual unidade é esta"
-- quando ninguém disse.
--
-- **Ela não cria índice único novo em `fechamento_competencia`.** A chave
-- continua `(unidade_codigo, transportadora_codigo, tipo_de_operacao, chave)`.
-- Trocar `unidade_codigo` por `unidade_id` ali é fase posterior, e só depois de
-- o passivo estar classificado — com `unidade_id` nulo em quase tudo, o índice
-- novo colapsaria competências distintas hoje válidas. `UNIQUE(unidade_id)`
-- sozinho seria pior ainda: uma unidade tem muitas competências, por definição.
--
-- ---------------------------------------------------------------------------
-- Reentrância
-- ---------------------------------------------------------------------------
--
-- O Publishing do Replit propõe um diff derivado do `schema.ts` e oferece
-- aplicá-lo; quem aceitar aquela proposta fica com as colunas e sem o resto.
-- Como a `0015` e a `0048`, cada objeto aqui é primeiro procurado: se existir
-- como esperado, é adotado; nada é derrubado ou "consertado" sozinho.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj" text NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unidade_cnpj_canonico" CHECK ("unidade"."cnpj" ~ '^[0-9]{14}$')
);
--> statement-breakpoint
ALTER TABLE "fechamento_competencia" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;--> statement-breakpoint
ALTER TABLE "remuneracao_unidade" ADD COLUMN IF NOT EXISTS "unidade_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "unidade_cnpj_uq" ON "unidade" USING btree ("cnpj");--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		 WHERE conname = 'fechamento_competencia_unidade_id_unidade_id_fk'
	) THEN
		ALTER TABLE "fechamento_competencia"
			ADD CONSTRAINT "fechamento_competencia_unidade_id_unidade_id_fk"
			FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		 WHERE conname = 'remuneracao_unidade_unidade_id_unidade_id_fk'
	) THEN
		ALTER TABLE "remuneracao_unidade"
			ADD CONSTRAINT "remuneracao_unidade_unidade_id_unidade_id_fk"
			FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id")
			ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
