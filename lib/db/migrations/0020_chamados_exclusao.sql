-- Excluir um envio de chamados — o desfazer que faltava do outro lado.
--
-- A `0010` deu à importação de vigência uma porta de saída: o arquivo errado
-- entrou, alguém exclui, e fica o registro de que aquilo saiu. Chamados não
-- tinham nenhuma. Um export de teste, o mesmo mês lido duas vezes com o
-- cabeçalho corrigido, a fila exportada com um filtro errado — tudo isso ficava
-- no sistema para sempre, e o SHA-256 ainda recusava o arquivo certo quando ele
-- viesse depois com aquele conteúdo, porque o conteúdo "já havia sido lido".
--
-- Aqui a exclusão é mais simples do que a da vigência, e a diferença é do que
-- cada uma sustenta. Uma importação de vigência escreve fato canônico, vigência
-- fechada e célula RAW — três camadas que a `0001` protege por gatilho, e por
-- isso a `0010` precisou abrir uma porta declarada (`purge_import_run`) para
-- que o DELETE fosse aceito. Um envio de chamados não escreve nenhuma delas:
-- `ticket` e `ticket_change` são leitura declarada pela fonte, sem gatilho de
-- imutabilidade, e saem por DELETE comum. O que **não** muda é o resto da
-- promessa — quem apagou, quando, e quanta coisa saiu ficam registrados.
--
-- E o registro é append-only, como o da vigência: "nunca descarte
-- silenciosamente" vale para o descarte também.

-- ---------------------------------------------------------------------------
-- O registro do que foi apagado
-- ---------------------------------------------------------------------------
-- Tabela separada de `import_deletion`, e não um tipo dentro dela, pela mesma
-- razão que `ticket_import` não é `import_run`: o que sai de uma exclusão de
-- vigência são fatos e vigências; o que sai daqui são chamados e alterações
-- declaradas. Uma coluna `removed` que ora significasse uma coisa ora outra
-- obrigaria quem audita a saber por fora qual das duas contagens está lendo.
CREATE TABLE IF NOT EXISTS "ticket_import_deletion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_import_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_sha256" text NOT NULL,
	"import_status" text NOT NULL,
	"received_at" timestamp with time zone,
	"removed" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_by" text NOT NULL,
	"reason" text,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_import_deletion_deleted_at_idx" ON "ticket_import_deletion" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_import_deletion_sha256_idx" ON "ticket_import_deletion" USING btree ("content_sha256");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- O registro da exclusão não tem porta
-- ---------------------------------------------------------------------------
-- Mesma postura de `import_deletion` na `0010`: UPDATE e DELETE recusados em
-- qualquer circunstância, inclusive de dentro de outra exclusão. Uma auditoria
-- que se pode editar não é uma auditoria.
CREATE OR REPLACE FUNCTION freightcheck_ticket_import_deletion_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION
    'ticket_import_deletion is append-only: % is not allowed (row id %)',
    TG_OP, OLD.id
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- Escrita para ser reaplicável: o registro de migrations pode se perder, e a
-- adoção reexecuta o arquivo inteiro (ver docs/MIGRATIONS.md).
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                 JOIN pg_class c ON c.oid = t.tgrelid
                WHERE NOT t.tgisinternal
                  AND t.tgname = 'ticket_import_deletion_immutable'
                  AND c.relname = 'ticket_import_deletion') THEN
CREATE TRIGGER ticket_import_deletion_immutable
  BEFORE UPDATE OR DELETE ON "ticket_import_deletion"
  FOR EACH ROW EXECUTE FUNCTION freightcheck_ticket_import_deletion_is_immutable();
  END IF;
END $reentrante$;
