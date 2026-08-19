-- Reprocessar: reler um arquivo já recebido, sem apagar o que ele já produziu.
--
-- O SHA-256 responde "este arquivo já entrou?" antes de abrir o arquivo, e é
-- ele que impede o reenvio acidental virar dado em dobro. O que faltava era a
-- outra pergunta, que só aparece com o tempo: **o leitor mudou desde então?**
--
-- Aconteceu com o QLP. Uma planilha de quadro de pessoal entrou quando o
-- pipeline ainda exigia `vigencia` + `placa` para uma aba virar fonte de fatos;
-- sem placa, a aba caiu como PIVOT e o arquivo entrou mudo — zero fato, zero
-- erro, zero aviso. Dias depois o leitor aprendeu o grão do QLP, e aí o mesmo
-- arquivo, reenviado, batia no SHA-256 e era recusado como duplicata: a defesa
-- contra o reenvio acidental virou uma tranca contra a releitura legítima. A
-- única saída era excluir o histórico e reenviar — apagar a evidência de que
-- o arquivo tinha chegado no dia em que chegou, para poder lê-lo de novo.
--
-- Reprocessar é a saída que não paga esse preço. É um `import_run` **novo**
-- sobre o **mesmo** `source_file`: nada é reescrito, nada é apagado, o
-- recebimento original continua onde estava, e o arquivo em disco continua
-- sendo um só. O que a coluna acrescenta é a frase que faltava no histórico —
-- *este run é uma releitura daquele*, e por quê.
--
-- `IF NOT EXISTS` porque a fila tem de ser reentrante: um banco onde a coluna
-- já existe e o registro se perdeu roda esta migration de novo, e ela precisa
-- atravessar em vez de parar a fila inteira com 42701.
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "reprocess_of_run_id" uuid;--> statement-breakpoint

-- Por que não `ON DELETE CASCADE`, e por que não `SET NULL`.
--
-- CASCADE faria excluir o recebimento original levar junto a releitura que o
-- corrigiu — e com ela os fatos e as vigências que hoje são a verdade da tela.
-- SET NULL seria pior de um jeito mais silencioso: o run sobreviveria sem
-- lembrar do que ele é releitura, e o histórico passaria a mostrar dois
-- recebimentos independentes do mesmo arquivo, que é exatamente a confusão que
-- esta coluna existe para desfazer.
--
-- RESTRICT é a escolha, e ela tem par no código: `planImportDeletion` recusa
-- em português, com a ordem certa ("exclua o reprocessamento primeiro"), antes
-- de o Postgres precisar recusar em SQLSTATE. A trava do banco é a rede de
-- baixo, não o texto que o operador lê.
--
-- A forma do bloco não é escolha de estilo: é a forma exata que
-- `CONSTRAINT_REENTRANTE` (lib/db/src/reconvergencia.ts) sabe levantar. Um
-- `DO $$ … EXCEPTION WHEN duplicate_object` faz a mesma coisa no banco e é
-- **invisível** para a reconvergência — e uma constraint que a reconvergência
-- não sabe repor é uma constraint que some no primeiro deploy em que o
-- Provision compara Production com um Development atrás da fila, para nunca
-- mais voltar. Ver `deploy-normal-reconverge.test.ts`.
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

-- O motivo não é decoração: é o que separa reprocessar de reenviar.
--
-- Reprocessar contorna deliberadamente a defesa que impede dado em dobro, e uma
-- ação assim não pode ser um clique a mais. Exigir a frase — "o leitor aprendeu
-- o grão do QLP", "a planilha foi lida antes da correção de datas" — faz três
-- coisas de uma vez: obriga quem pede a saber por que está pedindo, deixa no
-- histórico a razão que ninguém vai lembrar em três meses, e transforma o
-- reprocessamento acidental em algo que não se faz sem parar para escrever.
ALTER TABLE "import_run" ADD COLUMN IF NOT EXISTS "reprocess_reason" text;--> statement-breakpoint

-- Apontar sem dizer por quê é meia auditoria — e meia auditoria é a que parece
-- inteira na tela. Daí o CHECK: quem aponta, explica.
--
-- **A recíproca não vale, e a assimetria é o desenho.** O motivo pode
-- sobreviver ao ponteiro. Excluir a leitura que uma releitura releu é uma ação
-- legítima e comum — é exatamente o que se faz depois de reprocessar um arquivo
-- que tinha entrado sob o tipo errado: aprova-se a releitura certa e apaga-se a
-- importação errada. Nesse momento a releitura é reancorada na leitura anterior
-- da corrente (`deleteImportRun`), e quando não há nenhuma o ponteiro fica nulo.
--
-- O que **não** pode ficar nulo é a razão. "Este run é uma releitura, e foi
-- pedida por isto" é o fato de auditoria; "releu aquele run ali" é a
-- conveniência que ajuda a tela a desenhar a corrente. Exigir os dois juntos
-- faria a exclusão legítima da ponta da corrente ter de apagar a razão junto —
-- e o histórico voltaria a mostrar uma releitura como se fosse um envio comum.
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
END $reentrante$;--> statement-breakpoint

-- Uma leitura aberta por arquivo, decidida pelo banco.
--
-- A proteção contra o reprocessamento repetido não pode ser um SELECT seguido
-- de um INSERT: dois cliques no mesmo botão, ou dois operadores na mesma tela,
-- leem "não há nenhuma aberta" os dois e gravam os dois. O resultado seriam
-- dois runs lendo o mesmo arquivo ao mesmo tempo, os dois chegando a PREVIEWED,
-- e duas aprovações possíveis para a mesma vigência — que o índice canônico
-- barraria depois, mas só depois, e com uma recusa que fala de vigência para
-- quem só clicou duas vezes.
--
-- O índice parcial resolve antes: no máximo um run **por decidir** (na fila,
-- lendo, preparado, conferido, aprovando) por `source_file`. Estados terminais
-- ficam de fora porque é justamente sobre eles que se reprocessa — um arquivo
-- com dez releituras terminadas continua aceitando a décima primeira.
--
-- A invariante já era verdade antes desta migration, e por isso ela entra sem
-- backfill: o primeiro envio de um arquivo abre o único run por decidir que ele
-- pode ter, e todo reenvio idêntico nasce em SKIPPED_DUPLICATE, que é terminal.
CREATE UNIQUE INDEX IF NOT EXISTS "import_run_leitura_aberta_uq"
  ON "import_run" ("source_file_id")
  WHERE "status" IN ('PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING');
