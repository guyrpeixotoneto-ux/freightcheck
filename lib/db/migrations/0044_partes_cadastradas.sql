-- O cadastro de unidade e transportadora — o vocabulário deixa de morar dentro
-- da competência que ele serve para criar.
--
-- **O defeito que isto conserta.** A lista dos dois campos de `Realizar
-- Fechamento` era derivada e só: `listarPartes` lia `fechamento_competencia` e
-- devolvia os códigos que apareciam lá. Quem digitava `443 — CDD Belém` no
-- campo, abria a competência e depois excluía a importação — aberta por engano,
-- que é justamente o que a exclusão existe para desfazer — perdia o nome junto
-- com ela, e voltava para um campo que dizia "Nada encontrado". O cadastro
-- tinha ido morar dentro do registro que ele serve para criar.
--
-- **Uma tabela nova não é uma segunda verdade sobre o nome de um CDD**, e a
-- razão é que toda escrita de parte passa a atravessá-la: o campo que cadastra
-- e a abertura de competência gravam aqui, de modo que a linha guarda sempre o
-- **último** nome escrito — exatamente o que a lista derivada devolvia.
-- `listarPartes` continua somando as duas fontes, de modo que nada some com a
-- chegada da tabela: os códigos anteriores a ela continuariam saindo das
-- competências mesmo com o cadastro vazio, com o mesmo nome e a mesma contagem
-- de antes.
--
-- **O backfill existe assim mesmo, e é o que torna a promessa uniforme.** Sem
-- ele, a garantia "o nome sobrevive à exclusão" valeria só para o que fosse
-- cadastrado a partir de hoje: quem excluísse uma competência aberta na semana
-- passada perderia o nome exatamente como antes, porque aquela parte nunca
-- passou pelo cadastro. O `INSERT` abaixo lê as competências que existem e
-- grava o **último** nome de cada código — a mesma regra de `listarPartes` —, e
-- o `ON CONFLICT DO NOTHING` o deixa reentrante: rodar de novo não reescreve o
-- que alguém já corrigiu à mão.
--
-- **`codigo` é único por tipo, e não no geral.** `36` pode ser uma
-- transportadora e um CDD ao mesmo tempo, e os dois números não têm relação um
-- com o outro.
--
-- **Sem gatilho de congelamento**, ao contrário das doze tabelas de linha: o
-- cadastro não é conteúdo de competência nenhuma, e travá-lo junto com a
-- primeira quinzena encerrada impediria de nomear um CDD para a quinzena
-- seguinte. O que o encerramento congela é a conta que se cobrou, e o nome de
-- uma unidade não é parte dela — a competência guardou o dela no próprio
-- registro, no momento em que foi aberta.
--
-- O DDL é o que `drizzle-kit generate` produziu do schema, reentrante como o da
-- `0039` e o da `0043`, pela mesma razão: a adoção de um banco que já os tem não
-- pode travar a fila.

CREATE TABLE IF NOT EXISTS "fechamento_parte" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"codigo" text NOT NULL,
	"nome" text,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fechamento_parte_tipo" CHECK ("fechamento_parte"."tipo" in ('UNIDADE', 'TRANSPORTADORA'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_parte_unica" ON "fechamento_parte" USING btree ("tipo","codigo");--> statement-breakpoint

-- O backfill: cada código que já aparece numa competência entra no cadastro com
-- o nome mais recente que recebeu — a mesma expressão que `listarPartes` usa
-- para escolher entre grafias, para que as duas fontes não discordem no minuto
-- seguinte à migration.
INSERT INTO "fechamento_parte" ("tipo", "codigo", "nome")
SELECT
	'UNIDADE',
	c."unidade_codigo",
	(array_agg(c."unidade_nome" ORDER BY c."aberta_em" DESC)
	   FILTER (WHERE c."unidade_nome" IS NOT NULL))[1]
FROM "fechamento_competencia" c
GROUP BY c."unidade_codigo"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "fechamento_parte" ("tipo", "codigo", "nome")
SELECT
	'TRANSPORTADORA',
	c."transportadora_codigo",
	(array_agg(c."transportadora_nome" ORDER BY c."aberta_em" DESC)
	   FILTER (WHERE c."transportadora_nome" IS NOT NULL))[1]
FROM "fechamento_competencia" c
GROUP BY c."transportadora_codigo"
ON CONFLICT DO NOTHING;
