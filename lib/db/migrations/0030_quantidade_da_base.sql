-- A quantidade da base — o dado que faltava para uma taxa virar dinheiro.
--
-- O produto já sabia que este dado faltava, e já sabia o nome dele.
-- `baseQueFalta` (lib/curation/src/agregacao.ts) responde, para `BRL_KM`,
-- "quilometragem rodada por ativo no período", e para `BRL_VIAGEM`, "a
-- quantidade de viagem do período, por ativo". A composição já exclui esses
-- componentes com o motivo nomeado `BASE_AUSENTE`. O catálogo de significados
-- já diz, em prosa, que "a taxa vira dinheiro quando multiplicada pela base".
--
-- O que não existia era **um lugar para a resposta**. Por isso
-- `manutencaoReaisKm` — R$/km, no cavalo, em produção — está fora de todos os
-- totais desde que existe. Não é um problema do trecho: o trecho apenas o torna
-- grande, porque metade das colunas de dinheiro dele é R$/km e a outra metade é
-- R$/viagem.
--
-- A regra inteira, numa linha:
--
--     R$/base × base/competência = R$/competência
--
-- `0,38 R$/km × 4.200 km/mês` e `12,40 R$/viagem × 128 viagens/mês` são a mesma
-- conta. É por isso que esta tabela não tem coluna de "viagem" nem de "km": a
-- base é texto que veio do cadastro de significados, e `R$ por pallet` no dia
-- em que a operação cadastrar não custa uma migration.
--
-- ---------------------------------------------------------------------------
-- Por que declarada, e não descoberta
-- ---------------------------------------------------------------------------
-- O export de trecho traz `previsaoViagens` e `kmRodadoMesPorEquipe`, plausíveis
-- as duas. Qual delas remunera é decisão de quem opera o contrato, e um palpite
-- errado aqui não deixa a tela vazia: produz um número com cara de apurado.
-- Daí `declared_by`, `justification` e a janela de vigência — o mesmo molde de
-- `attribute_semantics` e `entity_identifier`.
--
-- ---------------------------------------------------------------------------
-- `nature`: previsão não é medição
-- ---------------------------------------------------------------------------
-- Um total montado sobre previsão é orçamento. Sair com a mesma cara de um
-- valor apurado é a classe de erro que este produto existe para não cometer, e
-- por isso a natureza é campo da declaração e acompanha o montante derivado até
-- a tela — a mesma disciplina de `PROJECAO_LINEAR` em dre/normalizacao.ts.
--
-- É o único CHECK de vocabulário aqui, e a assimetria com `base` é deliberada:
-- o vocabulário de bases é da operação e cresce com o negócio; "medido ou
-- previsto" é distinção do nosso modelo, com exatamente dois lados. Um terceiro
-- valor não seria uma base nova — seria alguém contornando a etiqueta que
-- separa orçamento de apuração.
--
-- ---------------------------------------------------------------------------
-- O que esta migration **não** faz
-- ---------------------------------------------------------------------------
-- Não semeia nenhuma declaração, e não muda nenhum número. Enquanto a tabela
-- estiver vazia, todo componente que hoje é excluído por `BASE_AUSENTE`
-- continua excluído, com a mesma frase. A conta está em
-- `lib/curation/src/quantidade-da-base.ts`; quem a chama no portão financeiro é
-- assunto de outra mudança, e o primeiro vínculo é ato de curadoria, assinado.
CREATE TABLE IF NOT EXISTS "base_quantity_source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	-- `*` vale para qualquer tipo. A declaração específica ganha da geral.
	"entity_type" text NOT NULL,
	"base" text NOT NULL,
	"competence" text NOT NULL,
	"quantity_attribute_code" text NOT NULL,
	"nature" text NOT NULL,
	"justification" text NOT NULL,
	"declared_by" text NOT NULL,
	"effective_from" date NOT NULL,
	"effective_until" date,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "base_quantity_source_nature_conhecida" CHECK ("base_quantity_source"."nature" IN ('MEDIDA', 'PREVISTA')),
	CONSTRAINT "base_quantity_source_janela_ordenada" CHECK ("base_quantity_source"."effective_until" IS NULL OR "base_quantity_source"."effective_until" >= "base_quantity_source"."effective_from")
);
--> statement-breakpoint
-- Uma fonte corrente por (tipo, base, competência). Duas declarações vivas para
-- a mesma pergunta não é conflito a resolver na leitura: é estado que não pode
-- existir. `fonteAplicavel` escolhe entre o específico e o `*`, e não entre dois
-- específicos — porque este índice impede que eles existam.
CREATE UNIQUE INDEX IF NOT EXISTS "base_quantity_source_current_uq" ON "base_quantity_source" USING btree ("entity_type","base","competence") WHERE "base_quantity_source"."is_current";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "base_quantity_source_lookup_idx" ON "base_quantity_source" USING btree ("base","competence");--> statement-breakpoint
-- Por atributo: a curadoria precisa responder "esta coluna é fonte de alguma
-- base?" antes de deixar alguém renomear ou aposentar o significado dela.
CREATE INDEX IF NOT EXISTS "base_quantity_source_attribute_idx" ON "base_quantity_source" USING btree ("quantity_attribute_code");
