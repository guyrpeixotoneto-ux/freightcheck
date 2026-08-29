-- ---------------------------------------------------------------------------
-- O RESPONSÁVEL DA ETAPA COMO CADASTRO — departamento, cargo e pessoa.
-- ---------------------------------------------------------------------------
--
-- `fluxo_etapa.area` e `fluxo_etapa.responsavel` são texto livre desde a
-- `0068`, e a lista de responsáveis de `fluxo_etapa_item` também. O resultado é
-- o mesmo que a tela de Cargos existia para denunciar, agora no mapa dos
-- processos: uma etapa diz `Faturamento`, outra diz `FATURAMENTO`, uma terceira
-- diz `Fat.` — três raias no fluxograma, três valores no filtro da Lista, e
-- nenhuma resposta para "quantas etapas o Faturamento executa".
--
-- Estas seis colunas são a resposta, e são as mesmas três nas duas tabelas: o
-- departamento e o cargo vêm de `schema/cadastro.ts`, a pessoa vem de
-- `app_user`. **A identidade passa a ser o `id`; o texto vira projeção** — a
-- leitura sobrescreve `area`, `responsavel` e o `nome` do item com o nome atual
-- do cadastro quando o vínculo existe (ver `lerFluxo`, em
-- `lib/fluxos/repositorio.ts`). Renomear um departamento renomeia em todos os
-- fluxos de uma vez, e nenhum leitor — raia, filtro, exportação, Assistente —
-- precisou saber que estas colunas existem.
--
-- **A pessoa vem depois do papel, nunca no lugar dele.** Um processo sobrevive
-- a quem o executa: gente muda de função e sai da empresa, e é por isso que
-- `app_user.archived_at` existe. Uma etapa cujo único responsável fosse uma
-- conta viraria etapa órfã no dia do desligamento, e o mapa passaria a exigir
-- reedição em massa a cada troca de time. Departamento e cargo não têm esse
-- problema — é para eles que a raia olha.
--
-- **Nulas, e sem backfill.** Nulo é o estado de toda etapa anterior a estas
-- colunas, e também o de toda etapa cujo responsável é uma função que ninguém
-- cadastrou ainda: exigir o cadastro aqui transformaria "descrever um processo"
-- em "cadastrar a estrutura da casa primeiro", que é a barreira que faz gente
-- desistir e voltar a digitar texto. E nenhum `UPDATE` tenta casar o texto que
-- está lá com o cadastro, pela mesma razão que a `0073` não adivinhou cargo a
-- partir de e-mail: a canonização que decide se duas grafias são a mesma coisa
-- mora em `canonizarNome`, em TypeScript, e uma segunda implementação em SQL
-- concordaria com ela no dia em que fosse escrita e discordaria no primeiro
-- caractere que uma tratasse e a outra não. `Fat.` não é automaticamente
-- `Faturamento`; quem sabe disso é quem edita a etapa.
--
-- `ON DELETE RESTRICT` nas seis, como em toda referência ao cadastro: apagar um
-- departamento que dez etapas apontam deixaria dez linhas penduradas no que não
-- existe. Quem recusa antes, com o número na frase, é `excluirDepartamento` em
-- `lib/db/src/cadastro.ts`; a chave estrangeira é a rede embaixo — e os índices
-- existem para que essa contagem, feita a cada exclusão, não seja varredura das
-- tabelas de etapa e de item inteiras.
--
-- Reentrante como as anteriores: cada objeto é primeiro procurado, e a
-- migration roda duas vezes sobre o mesmo banco sem falhar. É também o que
-- permite ao `up` do bridge levantar estes statements do disco em vez de
-- reescrevê-los (ver `lib/db/src/bridge.ts`).
-- ---------------------------------------------------------------------------

ALTER TABLE "fluxo_etapa" ADD COLUMN IF NOT EXISTS "departamento_id" uuid;--> statement-breakpoint
ALTER TABLE "fluxo_etapa" ADD COLUMN IF NOT EXISTS "cargo_id" uuid;--> statement-breakpoint
ALTER TABLE "fluxo_etapa" ADD COLUMN IF NOT EXISTS "app_user_id" uuid;--> statement-breakpoint
ALTER TABLE "fluxo_etapa_item" ADD COLUMN IF NOT EXISTS "departamento_id" uuid;--> statement-breakpoint
ALTER TABLE "fluxo_etapa_item" ADD COLUMN IF NOT EXISTS "cargo_id" uuid;--> statement-breakpoint
ALTER TABLE "fluxo_etapa_item" ADD COLUMN IF NOT EXISTS "app_user_id" uuid;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_departamento_id_departamento_id_fk'
	) THEN
		ALTER TABLE "fluxo_etapa" ADD CONSTRAINT "fluxo_etapa_departamento_id_departamento_id_fk"
			FOREIGN KEY ("departamento_id") REFERENCES "public"."departamento"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_cargo_id_cargo_id_fk'
	) THEN
		ALTER TABLE "fluxo_etapa" ADD CONSTRAINT "fluxo_etapa_cargo_id_cargo_id_fk"
			FOREIGN KEY ("cargo_id") REFERENCES "public"."cargo"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_app_user_id_app_user_id_fk'
	) THEN
		ALTER TABLE "fluxo_etapa" ADD CONSTRAINT "fluxo_etapa_app_user_id_app_user_id_fk"
			FOREIGN KEY ("app_user_id") REFERENCES "public"."app_user"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_item_departamento_id_departamento_id_fk'
	) THEN
		ALTER TABLE "fluxo_etapa_item" ADD CONSTRAINT "fluxo_etapa_item_departamento_id_departamento_id_fk"
			FOREIGN KEY ("departamento_id") REFERENCES "public"."departamento"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_item_cargo_id_cargo_id_fk'
	) THEN
		ALTER TABLE "fluxo_etapa_item" ADD CONSTRAINT "fluxo_etapa_item_cargo_id_cargo_id_fk"
			FOREIGN KEY ("cargo_id") REFERENCES "public"."cargo"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'fluxo_etapa_item_app_user_id_app_user_id_fk'
	) THEN
		ALTER TABLE "fluxo_etapa_item" ADD CONSTRAINT "fluxo_etapa_item_app_user_id_app_user_id_fk"
			FOREIGN KEY ("app_user_id") REFERENCES "public"."app_user"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_departamento_idx" ON "fluxo_etapa" USING btree ("departamento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_cargo_idx" ON "fluxo_etapa" USING btree ("cargo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_pessoa_idx" ON "fluxo_etapa" USING btree ("app_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_item_departamento_idx" ON "fluxo_etapa_item" USING btree ("departamento_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_item_cargo_idx" ON "fluxo_etapa_item" USING btree ("cargo_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fluxo_etapa_item_pessoa_idx" ON "fluxo_etapa_item" USING btree ("app_user_id");
