-- ---------------------------------------------------------------------------
-- O subfluxo — a etapa que é um processo inteiro por dentro.
-- ---------------------------------------------------------------------------
--
-- Uma coluna, uma chave e um índice. Nenhuma tabela nova, porque não há
-- entidade nova: **um subfluxo é um fluxo normal**. "Emissão do documento (no
-- Unidox)" continua sendo uma etapa do processo pai e passa a poder apontar
-- para a linha de `fluxo_operacional` que a detalha — que tem as suas próprias
-- etapas, as seis visualizações, exportação e versão, sem uma linha de motor
-- nova.
--
-- A alternativa seria desenhar grupo dentro do canvas: posicionamento,
-- conexões atravessando a borda do grupo, layout e exportação todos
-- recursivos, e a Jornada (que é lista) virando árvore. O ganho de leitura é o
-- mesmo; o custo, uma ordem de grandeza maior.
--
-- `(subfluxo_id, empresa_id) → fluxo_operacional(id, empresa_id)`, pela mesma
-- razão das outras chaves compostas da 0068: detalhar uma etapa com um fluxo de
-- outra empresa deixa de ser expressável, e não depende de a próxima rota
-- lembrar de conferir.
--
-- `ON DELETE SET NULL`, e não cascata: apagar o detalhe não pode levar junto a
-- etapa do processo pai — ela continua acontecendo mesmo sem ninguém ter
-- escrito como.
--
-- O que o banco **não** barra é ciclo (A detalha B que detalha A): isso é
-- alcançabilidade, não integridade referencial. Quem barra é `ligarSubfluxo`,
-- em `lib/fluxos/repositorio.ts`, que percorre a trilha inteira antes de
-- gravar.
--
-- Reentrante como as anteriores: cada objeto é primeiro procurado. É o que
-- mantém esta migration aplicável sobre um banco em que a proposta de diff do
-- Publishing já tenha criado parte disto.
-- ---------------------------------------------------------------------------

ALTER TABLE "fluxo_etapa" ADD COLUMN IF NOT EXISTS "subfluxo_id" uuid;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_subfluxo_empresa_fk'
	) THEN
		ALTER TABLE "fluxo_etapa" ADD CONSTRAINT "fluxo_etapa_subfluxo_empresa_fk"
			FOREIGN KEY ("subfluxo_id","empresa_id")
			REFERENCES "public"."fluxo_operacional"("id","empresa_id")
			ON DELETE set null ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_subfluxo_idx" ON "fluxo_etapa" USING btree ("subfluxo_id");
