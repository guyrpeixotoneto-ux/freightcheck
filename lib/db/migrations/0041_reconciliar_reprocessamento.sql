-- Reconciliar o que a 0040 cria e o bridge remove.
--
-- É o mesmo buraco da `0024`, da `0027`, da `0029`, da `0034` e da `0038`, e ele não fecha
-- sozinho: `bridgeDown` remove objetos que as migrations criam e **não toca no
-- registro**; `runMigrations()` pula toda migration cujo carimbo já está
-- registrado. Depois de um `down` sem `up`, só o `up` devolveria aqueles
-- objetos — a fila estruturalmente não consegue, e `migrate` responderia "nada
-- a aplicar" sobre um banco divergente.
--
-- A `0040` acrescentou duas colunas, um índice e duas constraints a
-- `import_run`. As **colunas ficam**: elas entram na allowlist do bridge, como
-- `declared_type` da `0035`, porque são aditivas e nulas e o contrato com o
-- Publishing as tolera. O índice e as duas constraints saem, e é por eles que
-- esta migration existe.
--
-- Uma migration nova, e não uma edição da `0038`, pelo motivo de sempre nesta
-- fila: a `0038` já está registrada em todo banco que a aplicou, e reescrevê-la
-- não a faz rodar de novo em nenhum deles — a decisão de rodar é pelo carimbo,
-- nunca pelo conteúdo.
--
-- Só estrutura, e só reposição: os três comandos são idempotentes por
-- construção, então num banco íntegro esta migration é um não-evento.

-- A trava contra o reprocessamento em duplicidade: no máximo uma leitura por
-- decidir por arquivo. Sem ela, dois cliques no mesmo botão abrem dois runs
-- lendo o mesmo arquivo, e a recusa só apareceria depois — falando de vigência
-- para quem só clicou duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS "import_run_leitura_aberta_uq"
  ON "import_run" ("source_file_id")
  WHERE "status" IN ('PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING');--> statement-breakpoint

-- A integridade do ponteiro de procedência. Sem ela, uma releitura pode apontar
-- para um run que não existe — e o histórico volta a mostrar leituras soltas do
-- mesmo arquivo, que é a confusão que a `0040` desfaz.
DO $reentrante$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'import_run'
       AND c.conname = 'import_run_reprocess_of_fk'
  ) THEN
    ALTER TABLE "import_run"
      ADD CONSTRAINT "import_run_reprocess_of_fk"
      FOREIGN KEY ("reprocess_of_run_id") REFERENCES "public"."import_run"("id")
      ON DELETE no action ON UPDATE no action;
  END IF;
END $reentrante$;--> statement-breakpoint

-- Quem aponta, explica. A recíproca não vale de propósito — ver a `0040`.
DO $reentrante$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'import_run'
       AND c.conname = 'import_run_reprocess_completo'
  ) THEN
    ALTER TABLE "import_run"
      ADD CONSTRAINT "import_run_reprocess_completo"
      CHECK ("reprocess_of_run_id" IS NULL OR "reprocess_reason" IS NOT NULL);
  END IF;
END $reentrante$;
