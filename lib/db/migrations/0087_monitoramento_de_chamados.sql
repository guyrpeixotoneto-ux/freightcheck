-- ---------------------------------------------------------------------------
-- MONITORAMENTO DE CHAMADOS — o que mudou entre um envio e o seguinte.
-- ---------------------------------------------------------------------------
--
-- A `0012`/`0013`/`0014` deram ao produto a fila de chamados do Freightech: um
-- envio, os chamados dele, e os parâmetros de remuneração que cada um mexeu.
-- O que elas **não** deram foi a pergunta que o gestor faz todo dia: *o que
-- mudou desde ontem?* Hoje `GET /tickets` lê **um** envio, e nada no
-- repositório cruza dois — comprovado por varredura: `ticket_import` só é lido
-- pelo importador, pela leitura da aba e pela varredura de órfãos.
--
-- O material para responder já existe, e é a razão de esta migration ser
-- pequena: `readTicketImport` **só insere** — nunca faz UPDATE em `ticket` —,
-- então cada `ticket_import` já é, na prática, um retrato completo e imutável
-- da fila naquele instante. Comparar dois envios é uma conta que ninguém tinha
-- escrito, e não um dado que faltava.
--
-- ---------------------------------------------------------------------------
-- Três coisas acontecem aqui, e a ordem delas importa
-- ---------------------------------------------------------------------------
--
-- 1. **Colunas que já estavam gravadas viram colunas.** O export real tem 26
--    cabeçalhos e o leitor promovia 12; os outros 14 ficavam em
--    `ticket.payload`, que guarda a linha inteira com os nomes originais.
--    Unidade, Segmento, Operador, Aprovador, SLA, Previsão Análise, Categoria e
--    Data Alteração estão lá **em todos os envios que já entraram** — e é por
--    isso que o backfill abaixo não precisa de reimportação nenhuma. Sem essas
--    colunas não há filtro por unidade, não há "responsável alterado", não há
--    "prazo alterado", e o painel por unidade não tem de onde sair.
--
-- 2. **O envio ganha uma série.** O arquivo real chama-se
--    `Chamados_<unidade>.xlsx`: dois envios do mesmo dia podem ser Recife e
--    Camaçari, e compará-los produziria "todos os chamados de Recife sumiram e
--    380 novos apareceram". A série é a partição dentro da qual dois envios são
--    comparáveis, e `serie_origem` diz de onde ela foi lida — a coluna do
--    arquivo, o nome do arquivo, ou nenhum dos dois.
--
-- 3. **Quatro tabelas novas guardam a comparação, a movimentação, o que mudou
--    em cada campo e quem revisou.**
--
-- ---------------------------------------------------------------------------
-- A camada é derivada, como `change_set` — e uma tabela dela não é
-- ---------------------------------------------------------------------------
--
-- `ticket_import_comparacao`, `ticket_movement_day`, `ticket_movement_field` e
-- `ticket_movement_step` podem ser descartadas e recomputadas a qualquer
-- momento a partir de `ticket_import`. É a mesma postura de `comparison.ts`
-- ("derived, and deliberately replaceable"), e é o que permite melhorar o
-- algoritmo sem migration.
--
-- `ticket_movement_review` **não** é derivada: é ato humano, e ninguém a
-- recomputa. Por isso ela guarda a `revisao` da movimentação que foi revisada —
-- um recálculo que produza a mesma movimentação preserva a revisão; um que a
-- mude a invalida, e a movimentação volta para a fila. Uma revisão que
-- sobrevivesse à mudança do que foi revisado seria um carimbo em branco.
--
-- Sem gatilho de imutabilidade: a `0001` protege a camada RAW, que é evidência.
-- Esta é conta, e conta se refaz.
--
-- Reentrante do começo ao fim (ver docs/MIGRATIONS.md).
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 0 · Ler uma coluna do payload sem depender da grafia exata do cabeçalho
-- ---------------------------------------------------------------------------
-- O leitor casa cabeçalhos por texto dobrado (minúsculas, sem acento, sem
-- pontuação) porque a mesma coluna chega como `Vig. Abertura`, `VIG ABERTURA` e
-- `Vig Abertura` conforme quem exportou. O backfill precisa da mesma régua: um
-- `payload->>'Previsão Análise'` literal deixaria de fora todo envio cujo
-- cabeçalho veio com outra caixa ou sem o acento, e o resultado seria uma
-- coluna meio preenchida — pior do que vazia, porque parece completa.
CREATE OR REPLACE FUNCTION freightcheck_dobrar_cabecalho(bruto text)
RETURNS text AS $$
  SELECT btrim(
    regexp_replace(
      lower(translate(
        COALESCE(bruto, ''),
        'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
        'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN'
      )),
      '[^a-z0-9]+', ' ', 'g'
    )
  );
$$ LANGUAGE sql IMMUTABLE;
--> statement-breakpoint

-- O primeiro valor não vazio cujo cabeçalho dobrado esteja entre os aliases.
-- A ordem dos aliases é a ordem de disputa, como em `ALIASES` do leitor.
CREATE OR REPLACE FUNCTION freightcheck_payload_valor(payload jsonb, aliases text[])
RETURNS text AS $$
DECLARE
  alias text;
  achado text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RETURN NULL;
  END IF;
  FOREACH alias IN ARRAY aliases LOOP
    SELECT p.value INTO achado
      FROM jsonb_each_text(payload) AS p(key, value)
     WHERE freightcheck_dobrar_cabecalho(p.key) = alias
       AND p.value IS NOT NULL
       AND btrim(p.value) <> ''
     LIMIT 1;
    IF achado IS NOT NULL THEN
      RETURN btrim(achado);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

-- Uma data do payload, ou NULL — nunca uma exceção.
--
-- O valor pode ser `2026-09-03T00:00:00.000Z` (o leitor converte Date para ISO
-- antes de gravar), `03/09/2026`, ou lixo. Um backfill que estourasse no
-- primeiro lixo deixaria a migration irreaplicável, que é exatamente o que
-- `docs/MIGRATIONS.md` proíbe.
--
-- **A ordem das tentativas é a correção, e não uma preferência.** O primeiro
-- rascunho tentava o cast genérico antes do formato brasileiro, e `03/09/2026`
-- virava **9 de março**: com `DateStyle = 'ISO, MDY'` — o padrão do Postgres —
-- `'03/09/2026'::timestamptz` é aceito como mês/dia e nunca chega à segunda
-- tentativa. Um erro que não estoura, não aparece em log nenhum, e desloca
-- prazo em meses. A data brasileira é decidida primeiro, pelo formato.
--
-- **E o instante ISO é lido em UTC, de propósito.** `parseTicketDate` monta
-- toda data com `Date.UTC` e o payload guarda o `toISOString()` dela; ler
-- `2026-09-03T00:00:00.000Z` no fuso do servidor devolveria 02/09 em qualquer
-- banco a oeste de Greenwich — inclusive o desta operação.
CREATE OR REPLACE FUNCTION freightcheck_texto_para_data(bruto text)
RETURNS date AS $$
DECLARE
  limpo text := btrim(COALESCE(bruto, ''));
  br    text;
BEGIN
  IF limpo = '' THEN RETURN NULL; END IF;

  -- 1. dd/mm/aaaa (ou com hífen), que é como a Ambev escreve. Sempre primeiro.
  br := substring(replace(limpo, '-', '/') from '^\d{1,2}/\d{1,2}/\d{4}');
  IF br IS NOT NULL THEN
    BEGIN RETURN to_date(br, 'DD/MM/YYYY'); EXCEPTION WHEN others THEN END;
  END IF;

  -- 2. aaaa-mm-dd puro: já é uma data, sem fuso a resolver.
  IF limpo ~ '^\d{4}-\d{2}-\d{2}$' THEN
    BEGIN RETURN limpo::date; EXCEPTION WHEN others THEN END;
  END IF;

  -- 3. instante ISO, lido em UTC — ver o comentário acima.
  BEGIN RETURN (limpo::timestamptz AT TIME ZONE 'UTC')::date; EXCEPTION WHEN others THEN END;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION freightcheck_texto_para_instante(bruto text)
RETURNS timestamptz AS $$
DECLARE
  limpo text := btrim(COALESCE(bruto, ''));
  d     date;
BEGIN
  IF limpo = '' THEN RETURN NULL; END IF;

  -- Data brasileira e data pura viram meia-noite UTC, que é o mesmo instante
  -- que `parseTicketDate` produz para elas do lado do leitor. Duas leituras da
  -- mesma célula que discordassem em três horas seriam pior do que uma vazia.
  IF replace(limpo, '-', '/') ~ '^\d{1,2}/\d{1,2}/\d{4}$' OR limpo ~ '^\d{4}-\d{2}-\d{2}$' THEN
    d := freightcheck_texto_para_data(limpo);
    RETURN CASE WHEN d IS NULL THEN NULL ELSE (d::timestamp AT TIME ZONE 'UTC') END;
  END IF;

  BEGIN RETURN limpo::timestamptz; EXCEPTION WHEN others THEN END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 1 · As colunas que já estavam no payload
-- ---------------------------------------------------------------------------
-- Todas terminam em `_raw` quando são texto da fonte, pela mesma razão de
-- `status_raw`: são o que a Ambev escreveu, e não uma identidade nossa.
-- `unidade_raw` **não** é a `unidade` canônica de `schema/unidade.ts` — casar as
-- duas é cadastro, ato de gente, e a `0049` documenta por que derivar
-- identidade de arquivo é o desenho errado.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "unidade_raw" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "segmento_raw" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "operador_raw" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "aprovador_raw" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "sla_raw" text;--> statement-breakpoint
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "categoria_raw" text;--> statement-breakpoint
-- `Previsão Análise` — a data que o Monitoramento chama de prazo.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "prazo_previsto" date;--> statement-breakpoint
-- `Data Alteração` — quando a Ambev mexeu. Não é `received_at` (quando nós
-- lemos) nem `opened_at` (quando o chamado nasceu). As três convivem porque são
-- três perguntas, e misturá-las é o defeito que este módulo existe para evitar.
ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "alterado_em_fonte" timestamp with time zone;--> statement-breakpoint

UPDATE "ticket" SET
  "unidade_raw"  = COALESCE("unidade_raw",  freightcheck_payload_valor("payload", ARRAY['unidade','unidade de negocio','filial','cdd'])),
  "segmento_raw" = COALESCE("segmento_raw", freightcheck_payload_valor("payload", ARRAY['segmento','area','setor'])),
  "operador_raw" = COALESCE("operador_raw", freightcheck_payload_valor("payload", ARRAY['operador'])),
  "aprovador_raw"= COALESCE("aprovador_raw",freightcheck_payload_valor("payload", ARRAY['aprovador','responsavel'])),
  "sla_raw"      = COALESCE("sla_raw",      freightcheck_payload_valor("payload", ARRAY['sla'])),
  "categoria_raw"= COALESCE("categoria_raw",freightcheck_payload_valor("payload", ARRAY['categoria','tipo'])),
  "prazo_previsto" = COALESCE("prazo_previsto",
    freightcheck_texto_para_data(freightcheck_payload_valor("payload", ARRAY['previsao analise','previsao de analise','prazo','previsao']))),
  "alterado_em_fonte" = COALESCE("alterado_em_fonte",
    freightcheck_texto_para_instante(freightcheck_payload_valor("payload", ARRAY['data alteracao','data da alteracao','data de alteracao'])))
WHERE "payload" IS NOT NULL
  AND jsonb_typeof("payload") = 'object'
  AND "payload" <> '{}'::jsonb;
--> statement-breakpoint

-- A junção do diff: os chamados de um envio, pelo número. É o índice que
-- sustenta cada comparação, e sem ele ela é varredura sequencial em duas
-- tabelas do tamanho do arquivo.
CREATE INDEX IF NOT EXISTS "ticket_import_external_idx" ON "ticket" USING btree ("ticket_import_id","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_unidade_idx" ON "ticket" USING btree ("unidade_raw");--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 2 · A série do envio
-- ---------------------------------------------------------------------------
-- NULL é legítimo e quer dizer "ainda não determinada" — é o estado de todo
-- envio anterior a esta migration cujo arquivo não nomeia unidade nenhuma. O
-- motor trata NULL como uma série própria (`—`), e não como "compara com
-- qualquer um": comparar às cegas é justamente o que produz movimentação falsa.
ALTER TABLE "ticket_import" ADD COLUMN IF NOT EXISTS "serie" text;--> statement-breakpoint
-- ARQUIVO | NOME_DO_ARQUIVO | MISTA | INDETERMINADA
ALTER TABLE "ticket_import" ADD COLUMN IF NOT EXISTS "serie_origem" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_import_serie_idx" ON "ticket_import" USING btree ("serie","received_at");--> statement-breakpoint

-- Backfill: a série de um envio já lido é a unidade que as linhas dele nomeiam,
-- quando é uma só. Duas ou mais → MISTA, e o motor compara por (unidade,
-- external_id) linha a linha. Nenhuma → INDETERMINADA.
WITH unidades AS (
  SELECT t."ticket_import_id" AS id,
         COUNT(DISTINCT t."unidade_raw") FILTER (WHERE t."unidade_raw" IS NOT NULL) AS distintas,
         MIN(t."unidade_raw") AS unica
    FROM "ticket" t
   GROUP BY t."ticket_import_id"
)
UPDATE "ticket_import" ti SET
  "serie" = CASE WHEN u.distintas = 1 THEN u.unica ELSE NULL END,
  "serie_origem" = CASE
    WHEN u.distintas = 1 THEN 'ARQUIVO'
    WHEN u.distintas > 1 THEN 'MISTA'
    ELSE 'INDETERMINADA'
  END
  FROM unidades u
 WHERE u.id = ti."id" AND ti."serie_origem" IS NULL;
--> statement-breakpoint

-- Envio sem nenhuma linha (falhou, ou foi recusado como duplicata) também
-- precisa de um estado declarado: silêncio aqui viraria "ninguém decidiu".
UPDATE "ticket_import" SET "serie_origem" = 'INDETERMINADA' WHERE "serie_origem" IS NULL;
--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 3 · A comparação — um envio lido contra o anterior da mesma série
-- ---------------------------------------------------------------------------
-- Uma linha por envio processado, e é ela que a régua de dias lê. Sem esta
-- tabela, "dia sem importação" e "importação sem nenhuma mudança" seriam o
-- mesmo estado na tela — zero movimentações nos dois casos —, e são coisas
-- diferentes para quem opera.
--
-- `tipo` responde por que aquele envio produziu o que produziu:
--   BASELINE  — é o primeiro da série. Registra o estado inicial e **não
--               produz movimentação nenhuma**. É o que impede a primeira carga
--               histórica de nascer como milhares de "chamados novos" a
--               revisar, que seria a primeira impressão do produto.
--   DIFF      — comparado com o anterior; `base_import_id` diz com qual.
--   IGNORADO  — não entrou em conta nenhuma, e `motivo` diz por quê (envio que
--               não chegou a READ, ou mais antigo que a última comparação da
--               série). Dado parcial nunca é apresentado como oficial.
CREATE TABLE IF NOT EXISTS "ticket_import_comparacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_import_id" uuid NOT NULL,
	"base_import_id" uuid,
	"serie" text,
	"dia" date NOT NULL,
	"tipo" text NOT NULL,
	"chamados_no_envio" integer DEFAULT 0 NOT NULL,
	"chamados_na_base" integer DEFAULT 0 NOT NULL,
	"movimentacoes" integer DEFAULT 0 NOT NULL,
	"removidos_suprimidos" integer DEFAULT 0 NOT NULL,
	"motivo" text,
	"calculada_em" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_import_comparacao_envio_uq" ON "ticket_import_comparacao" USING btree ("ticket_import_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_import_comparacao_dia_idx" ON "ticket_import_comparacao" USING btree ("dia","serie");--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 4 · A movimentação — o chamado que se mexeu num dia
-- ---------------------------------------------------------------------------
-- O grão é `(dia, série, chamado)`, e não `(comparação, chamado)`. Um chamado
-- que se mexeu às 08h, às 12h e às 17h é **uma** linha da fila, com os três
-- passos guardados em `ticket_movement_step` e visíveis ao expandir.
--
-- A razão é a revisão. Se cada comparação fosse revisável em separado, "fechar
-- o dia" passaria a depender de quantas vezes alguém subiu o arquivo — e um dia
-- ficaria meio fechado por um artefato de operação, não por trabalho pendente.
-- Com este grão, "70 movimentações" quer dizer 70 chamados que se mexeram.
--
-- **A linha do dia corrente é mutável, e é de propósito.** O envio das 17h
-- reescreve a movimentação que existia às 09h, e `revisao` sobe. Uma revisão
-- carimbada na versão anterior deixa de valer, e a movimentação volta para a
-- fila — porque quem revisou às 09h revisou outra coisa. Dias passados param de
-- mudar sozinhos: não chegam mais envios com aquela data.
--
-- Os campos de estado final (`unidade`, `area`, `responsavel`, `status_raw`,
-- `assunto`…) são denormalizados do último `ticket` do dia, pela mesma razão que
-- `change` denormaliza os dele: a lista precisa filtrar e mostrar sem junção.
--
-- `criticidade` é **derivada por nós**, e a coluna `criticidade_origem` existe
-- para que a tela nunca a apresente como se viesse da Ambev — nenhuma das 26
-- colunas do export é prioridade, e afirmar o contrário seria inventar dado.
CREATE TABLE IF NOT EXISTS "ticket_movement_day" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dia" date NOT NULL,
	"serie" text,
	"external_id" text NOT NULL,
	"classe" text NOT NULL,
	"revisao" integer DEFAULT 1 NOT NULL,
	"assinatura" text NOT NULL,
	"passos" integer DEFAULT 1 NOT NULL,
	"campos_alterados" integer DEFAULT 0 NOT NULL,
	"primeiro_import_id" uuid NOT NULL,
	"ultimo_import_id" uuid NOT NULL,
	"ticket_id_final" uuid,
	"unidade" text,
	"area" text,
	"responsavel" text,
	"solicitante" text,
	"status_raw" text,
	"status_bucket" text,
	"assunto" text,
	"entidade" text,
	"prazo_previsto" date,
	"aberto_em" timestamp with time zone,
	"encerrado_em" timestamp with time zone,
	"alterado_em_fonte" timestamp with time zone,
	"criticidade" text DEFAULT 'NORMAL' NOT NULL,
	"criticidade_motivo" text,
	"criticidade_origem" text DEFAULT 'DERIVADA' NOT NULL,
	"atrasado" boolean DEFAULT false NOT NULL,
	"movida_em" timestamp with time zone NOT NULL,
	"calculada_em" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
-- A identidade da movimentação. `serie` entra na chave porque o mesmo número de
-- chamado pode existir em duas unidades sem serem o mesmo chamado; `COALESCE`
-- porque um índice único trata cada NULL como distinto, e duas movimentações da
-- série indeterminada do mesmo chamado no mesmo dia passariam a conviver.
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_movement_day_grao_uq" ON "ticket_movement_day" USING btree ("dia",(COALESCE("serie",'—')),"external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_day_classe_idx" ON "ticket_movement_day" USING btree ("dia","serie","classe");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_day_unidade_idx" ON "ticket_movement_day" USING btree ("dia","serie","unidade");--> statement-breakpoint
-- A ordem padrão da lista: o mais recente do dia primeiro. `id` desempata para
-- que a paginação seja estável quando dois chamados se movem no mesmo instante
-- — sem ele, a mesma linha pode aparecer em duas páginas ou em nenhuma.
CREATE INDEX IF NOT EXISTS "ticket_movement_day_ordem_idx" ON "ticket_movement_day" USING btree ("dia","movida_em","id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_day_import_idx" ON "ticket_movement_day" USING btree ("ultimo_import_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_day_primeiro_import_idx" ON "ticket_movement_day" USING btree ("primeiro_import_id");--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 5 · O antes → depois de cada campo
-- ---------------------------------------------------------------------------
-- É a informação central da tela, e por isso ela é uma tabela e não um jsonb
-- dentro da movimentação: "quantos prazos mudaram hoje" é um `count` com
-- índice, e não uma varredura desempacotando documento.
--
-- Um campo que sai de A, passa por B e volta a A no mesmo dia **não gera linha
-- aqui** — o consolidado do dia é honesto sobre o saldo. As idas e voltas ficam
-- em `ticket_movement_step`, que é onde elas são verdade.
CREATE TABLE IF NOT EXISTS "ticket_movement_field" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"campo" text NOT NULL,
	"valor_antes" text,
	"valor_depois" text
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_movement_field_grao_uq" ON "ticket_movement_field" USING btree ("movement_id","tipo","campo");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_field_movement_idx" ON "ticket_movement_field" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_field_tipo_idx" ON "ticket_movement_field" USING btree ("tipo");--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 6 · O encadeamento intradia — a evidência
-- ---------------------------------------------------------------------------
-- Um passo por comparação que tocou aquele chamado naquele dia. É o fato bruto:
-- aconteceu, tem hora, e não se reescreve por conveniência de tela. É o que
-- mostra que o prazo foi para 03/09, voltou para 01/09 e terminou em 05/09 —
-- história que o consolidado A→D não conta e que quem audita vai pedir.
CREATE TABLE IF NOT EXISTS "ticket_movement_step" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"comparacao_id" uuid NOT NULL,
	"ordem" integer NOT NULL,
	"ocorrido_em" timestamp with time zone NOT NULL,
	"diferencas" jsonb DEFAULT '[]'::jsonb NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_movement_step_ordem_uq" ON "ticket_movement_step" USING btree ("movement_id","ordem");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_step_movement_idx" ON "ticket_movement_step" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_step_comparacao_idx" ON "ticket_movement_step" USING btree ("comparacao_id");--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 7 · A revisão — a única coisa aqui que não se recomputa
-- ---------------------------------------------------------------------------
-- A importação **nunca** escreve nesta tabela. Quem escreve é uma rota, com a
-- sessão de quem está na tela — `revisado_por` no mesmo formato de `actor` do
-- resto do produto, e `user_id` porque a conta pode mudar de e-mail.
--
-- **Revisada é a movimentação cuja revisão mais recente aponta para a `revisao`
-- atual dela.** O índice único por `(movement_id, revisao)` é o que torna
-- "revisar duas vezes a mesma versão" um não-evento em vez de duas linhas — e é
-- o que faz a contagem de revisadas nunca passar do total, que é o defeito que
-- `painel-de-justificativas.ts` documenta ter evitado do outro lado.
--
-- Revisado por qualquer pessoa vale para a instalação inteira, como a
-- justificativa de uma alteração de vigência: o produto tem um acervo só, e
-- "fechar o dia" é um fato da operação, não a caixa de entrada de alguém.
CREATE TABLE IF NOT EXISTS "ticket_movement_review" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"movement_id" uuid NOT NULL,
	"revisao" integer NOT NULL,
	"user_id" uuid,
	"revisado_por" text NOT NULL,
	"revisado_em" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_movement_review_versao_uq" ON "ticket_movement_review" USING btree ("movement_id","revisao");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_review_movement_idx" ON "ticket_movement_review" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_movement_review_quem_idx" ON "ticket_movement_review" USING btree ("revisado_por");--> statement-breakpoint


-- ---------------------------------------------------------------------------
-- 8 · As chaves estrangeiras
-- ---------------------------------------------------------------------------
-- `ON DELETE CASCADE` de ponta a ponta a partir de `ticket_import`: excluir um
-- envio (`0020`) tem de levar junto tudo o que foi derivado dele, senão a
-- exclusão deixa movimentações apontando para um envio que não existe mais — e
-- a tela do dia mostraria uma comparação sem as duas pontas.
--
-- A exceção é `ticket_id_final`, que é `ON DELETE SET NULL`: a movimentação
-- continua sendo verdade sobre o dia mesmo quando a linha do chamado sai.
--
-- Escrito em bloco reentrante porque `ADD CONSTRAINT` não aceita
-- `IF NOT EXISTS`, e esta migration precisa poder ser reaplicada inteira.
DO $fks$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_import_comparacao_ticket_import_id_ticket_import_id_fk') THEN
    ALTER TABLE "ticket_import_comparacao"
      ADD CONSTRAINT "ticket_import_comparacao_ticket_import_id_ticket_import_id_fk"
      FOREIGN KEY ("ticket_import_id") REFERENCES "ticket_import"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_import_comparacao_base_import_id_ticket_import_id_fk') THEN
    ALTER TABLE "ticket_import_comparacao"
      ADD CONSTRAINT "ticket_import_comparacao_base_import_id_ticket_import_id_fk"
      FOREIGN KEY ("base_import_id") REFERENCES "ticket_import"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_day_primeiro_import_id_ticket_import_id_fk') THEN
    ALTER TABLE "ticket_movement_day"
      ADD CONSTRAINT "ticket_movement_day_primeiro_import_id_ticket_import_id_fk"
      FOREIGN KEY ("primeiro_import_id") REFERENCES "ticket_import"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_day_ultimo_import_id_ticket_import_id_fk') THEN
    ALTER TABLE "ticket_movement_day"
      ADD CONSTRAINT "ticket_movement_day_ultimo_import_id_ticket_import_id_fk"
      FOREIGN KEY ("ultimo_import_id") REFERENCES "ticket_import"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_day_ticket_id_final_ticket_id_fk') THEN
    ALTER TABLE "ticket_movement_day"
      ADD CONSTRAINT "ticket_movement_day_ticket_id_final_ticket_id_fk"
      FOREIGN KEY ("ticket_id_final") REFERENCES "ticket"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_field_movement_id_ticket_movement_day_id_fk') THEN
    ALTER TABLE "ticket_movement_field"
      ADD CONSTRAINT "ticket_movement_field_movement_id_ticket_movement_day_id_fk"
      FOREIGN KEY ("movement_id") REFERENCES "ticket_movement_day"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_step_movement_id_ticket_movement_day_id_fk') THEN
    ALTER TABLE "ticket_movement_step"
      ADD CONSTRAINT "ticket_movement_step_movement_id_ticket_movement_day_id_fk"
      FOREIGN KEY ("movement_id") REFERENCES "ticket_movement_day"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_step_comparacao_id_ticket_import_comparacao_id_fk') THEN
    ALTER TABLE "ticket_movement_step"
      ADD CONSTRAINT "ticket_movement_step_comparacao_id_ticket_import_comparacao_id_fk"
      FOREIGN KEY ("comparacao_id") REFERENCES "ticket_import_comparacao"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_review_movement_id_ticket_movement_day_id_fk') THEN
    ALTER TABLE "ticket_movement_review"
      ADD CONSTRAINT "ticket_movement_review_movement_id_ticket_movement_day_id_fk"
      FOREIGN KEY ("movement_id") REFERENCES "ticket_movement_day"("id") ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ticket_movement_review_user_id_app_user_id_fk') THEN
    ALTER TABLE "ticket_movement_review"
      ADD CONSTRAINT "ticket_movement_review_user_id_app_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL;
  END IF;
END $fks$;
