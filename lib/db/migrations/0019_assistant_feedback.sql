-- O que quem leu achou da resposta.
--
-- **Por que isto vale uma coluna.** Toda a medida de qualidade deste
-- assistente é feita por nós: uma bateria de perguntas, um benchmark com piso
-- por categoria, um conjunto de cenários para a trava de lastro. São boas e
-- todas têm o mesmo limite — elas medem o que nós pensamos em medir. O analista
-- que perguntou é a única fonte que sabe se a resposta serviu, e até aqui não
-- havia onde ele dizer isso.
--
-- **Por que no turno, e não numa tabela própria.** O feedback é um atributo da
-- resposta, não uma entidade: um voto por turno, do dono da conversa, que pode
-- mudar de ideia. Uma tabela ao lado custaria uma junção em toda leitura da
-- conversa para guardar um enum e um texto curto.
--
-- **Nulo é a ausência de opinião, e é o estado normal.** A maioria das
-- respostas não recebe voto nenhum, e ler isso como "ruim" seria inventar um
-- sinal que não existe.
--
-- Escrita para ser reaplicável: o registro de migrations pode se perder, e a
-- adoção reexecuta o arquivo. Coluna com `IF NOT EXISTS`, restrição derrubada
-- antes de ser criada.
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "feedback" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "feedback_note" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN IF NOT EXISTS "feedback_at" timestamptz;--> statement-breakpoint

-- Só a resposta recebe voto, e só um dos dois valores. Um voto numa pergunta
-- seria um dado que nenhuma tela sabe ler.
ALTER TABLE "assistant_message"
  DROP CONSTRAINT IF EXISTS "assistant_message_feedback_ck";--> statement-breakpoint
ALTER TABLE "assistant_message"
  ADD CONSTRAINT "assistant_message_feedback_ck"
  CHECK (
    "feedback" IS NULL
    OR ("role" = 'RESPOSTA' AND "feedback" IN ('UTIL', 'NAO_UTIL'))
  );
