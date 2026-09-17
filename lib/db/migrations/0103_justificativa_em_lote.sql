-- ---------------------------------------------------------------------------
-- JUSTIFICATIVA EM LOTE — o registro do gesto, e não só das linhas.
-- ---------------------------------------------------------------------------
--
-- A tela de comparação passou a poder aplicar **uma** justificativa a várias
-- alterações de uma vez. Isso já era possível antes, linha a linha, e nada no
-- que uma justificativa significa mudou: continua sendo uma linha de
-- `justificativa` por `change_id`, com o mesmo texto derivado, os mesmos campos
-- estruturados da `0098` e o mesmo histórico (gravar de novo não edita: empilha).
--
-- O que não existia é o registro de **qual universo** o gesto alcançou. Sem
-- ele, 206 linhas gravadas no mesmo segundo pela mesma pessoa são 206 fatos
-- soltos, e a única pergunta que a justificativa em lote provoca — *o que essa
-- frase alcançou, e por quê?* — não tem onde ser respondida. É a tabela abaixo.
--
-- ---------------------------------------------------------------------------
-- Por que `recorte` é jsonb, e por que há uma `descricao` ao lado
-- ---------------------------------------------------------------------------
--
-- Porque o universo tem duas formas, e as duas são necessárias. Quem escolheu
-- as caixas uma a uma tem uma lista de ids; quem clicou em "Selecionar todos os
-- 206 resultados" tem um **recorte** — busca, variável, aba, tipo, negativos, o
-- par de vigências —, e é o recorte que fica gravado: mandar os ids seria
-- gravar o retrato que o navegador tinha dele, e num acervo maior seriam
-- milhares de números para dizer o que cinco campos dizem. O `jsonb` é exato e
-- ilegível; `descricao` é a mesma coisa em português, que é o que uma pessoa
-- confere contra a tela sem decodificar nada. Ver `EscopoDoLote`, em
-- `lib/comparison/src/justificativa-em-lote.ts`.
--
-- ---------------------------------------------------------------------------
-- As quatro contagens são um retrato, e não uma conta a refazer
-- ---------------------------------------------------------------------------
--
-- `alteracoes_no_universo`, `aplicadas`, `preservadas` e `sobrescritas` valem
-- para o instante da gravação e não se recalculam. Elas não vão bater com uma
-- contagem feita hoje sobre o mesmo filtro — a vigência pode ter sido
-- recalculada, e alterações podem ter sido justificadas depois. É o ponto: o
-- registro é do ato, na hora dele.
--
-- `preservadas` é a que carrega a regra: **o lote não sobrescreve justificativa
-- existente por padrão**. Quem seleciona 206 linhas das quais 31 já estão
-- explicadas está, quase sempre, resolvendo as 175 que faltam — e regravar as
-- 31 apagaria da tela decisões que outra pessoa tomou, uma a uma, com o nome
-- dela. Substituir continua possível e é outra ação: confirmação explícita,
-- permissão de administrador, e `sobrescritas` dizendo quantas foram.
--
-- ---------------------------------------------------------------------------
-- `justificativa.lote_id` é nulo na maioria, e o nulo significa algo
-- ---------------------------------------------------------------------------
--
-- Nulo é "escrita uma a uma", que é o caminho normal e o mais comum — a caixa
-- de justificar pergunta uma variável por vez, e cada resposta é um POST. Não é
-- "não se sabe".
--
-- `ON DELETE SET NULL`, e não cascade: apagar o registro de um lote não pode
-- apagar as justificativas que ele gravou. O que o gestor escreveu é dele, não
-- do lote.
--
-- As formas idempotentes são as da fila deste repositório (a `0049` é o
-- precedente): `canonical-identity-migration` roda a fila inteira sobre um
-- banco que já tem a estrutura e não tem o registro, e um `CREATE TABLE` cru
-- reprova ali.

CREATE TABLE IF NOT EXISTS "justificativa_lote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_set_id" uuid NOT NULL,
	"escopo" text NOT NULL,
	"recorte" jsonb NOT NULL,
	"descricao" text NOT NULL,
	"alteracoes_no_universo" integer NOT NULL,
	"aplicadas" integer NOT NULL,
	"preservadas" integer NOT NULL,
	"sobrescritas" integer NOT NULL,
	"sobrescrever" boolean DEFAULT false NOT NULL,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'justificativa_lote_change_set_id_change_set_id_fk') THEN
    ALTER TABLE "justificativa_lote" ADD CONSTRAINT "justificativa_lote_change_set_id_change_set_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_set"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "justificativa_lote_change_set_idx" ON "justificativa_lote" USING btree ("change_set_id");--> statement-breakpoint
ALTER TABLE "justificativa" ADD COLUMN IF NOT EXISTS "lote_id" uuid;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'justificativa_lote_id_justificativa_lote_id_fk') THEN
    ALTER TABLE "justificativa" ADD CONSTRAINT "justificativa_lote_id_justificativa_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."justificativa_lote"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "justificativa_lote_idx" ON "justificativa" USING btree ("lote_id");
