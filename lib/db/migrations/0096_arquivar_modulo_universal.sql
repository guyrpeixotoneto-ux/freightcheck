-- ---------------------------------------------------------------------------
-- ARQUIVAR MÓDULO UNIVERSAL — tirar da lista sem perder a decisão.
-- ---------------------------------------------------------------------------
--
-- A `0086` deu à casa o gesto de desligar: a chave sai do menu de todo mundo e
-- nenhum papel a devolve. O que ela não deu foi um jeito de a **lista de quem
-- administra** encolher junto. Uma instalação que não usa dois terços do
-- produto desliga dezenas de chaves e passa a administrar acesso dentro de uma
-- tela em que quase tudo está riscado — as vinte que ela usa de verdade ficam
-- entre quarenta e sete que ela nunca mais vai olhar.
--
-- Arquivar é a decisão sobre a lista, e não sobre o acesso. A chave arquivada
-- sai da matriz, vai para a gaveta "Arquivados" no fim dela, e volta com um
-- clique. Nada é apagado: a linha continua inteira, com quem desligou, quando e
-- por quê, e o histórico append-only da `0086` ganha os dois gestos novos.
--
-- É a mesma distinção que a `0078` escreveu para a conta arquivada, e vale a
-- pena repetir por que ela não é "excluir com outro nome": excluir tiraria a
-- resposta para "quem tirou o QLP do menu, e quando" — que é justamente o que
-- esta camada existe para guardar.
--
-- ---------------------------------------------------------------------------
-- Arquivar pressupõe estar desligada
-- ---------------------------------------------------------------------------
--
-- A linha só existe quando a chave está desligada (ausência de linha é ligado,
-- `0086`), então arquivar é sempre sobre algo que já saiu do ar — e ligar de
-- volta apaga a linha, o que desarquiva junto. Não há, e não pode haver, chave
-- arquivada no ar: seria uma tela aberta para todo mundo que não aparece na
-- tela que existe para dizer o que está aberto. O portão da rota recusa
-- arquivar o que não está desligado, e não desliga por conta própria.
--
-- ---------------------------------------------------------------------------
-- `arquivado` no histórico é nulável, e não `false`
-- ---------------------------------------------------------------------------
--
-- Com default `false`, todo desligamento já gravado passaria a se ler como "e
-- desarquivou também" — um gesto que ninguém fez, num tempo em que arquivar não
-- existia. Nulo quer dizer "este evento não falou da lista", que é o que todos
-- os eventos anteriores a esta migration são.
--
-- ---------------------------------------------------------------------------
-- O espelho da casa muda junto
-- ---------------------------------------------------------------------------
--
-- `decisao-da-casa.ts` mantém uma cópia das duas tabelas em `drizzle`, fora de
-- `public`, para a decisão sobreviver ao DDL que o Publishing executa por fora
-- da fila. Ele refaz o espelho a cada escrita (`CREATE TABLE AS`, que resolve
-- coluna nova sozinho), mas `reporDecisaoDaCasa` **aborta** quando o espelho e
-- a tabela têm colunas diferentes — e é exatamente o que aconteceria numa casa
-- que desligou algo antes desta migration, perdeu a estrutura depois dela e não
-- escreveu nada no meio. Por isso as colunas entram nos dois lugares aqui, na
-- mesma migration: `ALTER TABLE IF EXISTS` não faz nada onde o espelho ainda
-- não existe, que é o caso normal.
--
-- Reentrante: tudo é `IF NOT EXISTS`, e nenhuma linha muda de valor.
-- ---------------------------------------------------------------------------

ALTER TABLE "modulo_universal" ADD COLUMN IF NOT EXISTS "arquivado_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "modulo_universal" ADD COLUMN IF NOT EXISTS "arquivado_por" text;
--> statement-breakpoint
ALTER TABLE "modulo_universal_evento" ADD COLUMN IF NOT EXISTS "arquivado" boolean;
--> statement-breakpoint
ALTER TABLE IF EXISTS "drizzle"."modulo_universal__casa" ADD COLUMN IF NOT EXISTS "arquivado_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE IF EXISTS "drizzle"."modulo_universal__casa" ADD COLUMN IF NOT EXISTS "arquivado_por" text;
--> statement-breakpoint
ALTER TABLE IF EXISTS "drizzle"."modulo_universal_evento__casa" ADD COLUMN IF NOT EXISTS "arquivado" boolean;
