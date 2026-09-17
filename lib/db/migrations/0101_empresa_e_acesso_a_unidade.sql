-- ---------------------------------------------------------------------------
-- EMPRESA E ACESSO À UNIDADE — a dimensão que faltava, e a autorização que
-- nunca existiu.
-- ---------------------------------------------------------------------------
--
-- Esta migration cria **estrutura**, e não bloqueio. Depois dela, nenhuma
-- leitura deste produto responde diferente do que respondia antes: o corte é
-- uma decisão posterior, tomada com a medição do modo de observação na mão
-- (ver `escopo-efetivo.ts` e o middleware que registra o que recusaria).
-- Misturar as duas coisas numa migration só faria a mudança de schema e a
-- mudança de comportamento chegarem juntas, e a auditoria de 17/09/2026 já
-- mostrou por que isso é caro: ~40 rotas de leitura compartilham endpoints, e
-- um corte mal colocado derruba tela permitida para proteger nenhuma.
--
-- ---------------------------------------------------------------------------
-- 1. `empresa` — o tenant, que até aqui era a instalação
-- ---------------------------------------------------------------------------
--
-- O produto nasceu single-tenant: uma instalação, uma casa, e `unidade` sem
-- dono. Enquanto foi assim, "isolamento entre empresas" não era uma permissão
-- faltando — era uma dimensão inexistente, e nenhuma quantidade de verificação
-- no servidor a inventaria. `empresa` é essa dimensão, e ela é de primeira
-- classe: toda unidade pertence a exatamente uma, toda conta pertence a
-- exatamente uma, e a sessão é a raiz de confiança sobre qual é.
--
-- `cnpj_raiz` são os oito primeiros dígitos do CNPJ — a raiz que as filiais
-- compartilham. Anulável pela mesma razão que `unidade.cnpj` é: a empresa que
-- o produto conhece por nome antes de conhecer por documento existe, e exigir
-- o documento produziria cadastro nenhum em vez de cadastro melhor.
--
-- ---------------------------------------------------------------------------
-- 2. A empresa padrão, e por que ela não pode ser criada pela aplicação
-- ---------------------------------------------------------------------------
--
-- `unidade.empresa_id` e `app_user.empresa_id` nascem `NOT NULL`, porque uma
-- unidade sem dono é exatamente o estado que esta migration existe para
-- acabar. Isso obriga o preenchimento a acontecer **aqui**, na mesma
-- transação: uma coluna anulável "por enquanto" com um backfill na partida do
-- servidor deixaria a janela em que uma linha sem empresa é legítima — e é
-- dentro dessa janela que o isolamento não vale.
--
-- A empresa padrão nasce com um nome neutro porque não há de onde tirar o
-- verdadeiro: o cadastro da casa deste produto é departamento, cargo e negócio
-- (`schema/cadastro.ts`), e nenhum deles guarda a razão social. Ela não é um
-- registro técnico: é a empresa que a instalação atual **é**, e quem a
-- renomear depois está nomeando o próprio cliente, que é o comportamento
-- certo.
--
-- ---------------------------------------------------------------------------
-- 3. `acesso_a_unidade` — autorização em estrutura própria
-- ---------------------------------------------------------------------------
--
-- Separada de `app_user.unidade_id` **de propósito**, e a razão está escrita em
-- `schema/auth.ts`: lotação é cadastro administrativo — onde a pessoa trabalha
-- —, e transformá-la em portão faria um campo de RH decidir acesso em silêncio.
-- Autorização tem autor, tem data e tem histórico; lotação não precisa de
-- nenhum dos três.
--
-- **A ausência de linha concede — dentro da empresa, e só dentro dela.** É a
-- mesma regra das outras três camadas de permissão deste produto (`permissao_de
-- _modulo`, `papel`, `modulo_universal`), e ela existe pelo mesmo motivo: ler o
-- silêncio como bloqueio transformaria a migration num apagão para toda conta
-- que já existe. O que a ausência **nunca** faz é atravessar empresa: o
-- fallback é "todas as unidades da minha empresa", nunca "todas as unidades", e
-- é por isso que ele mora numa consulta que começa por `empresa_id` em vez de
-- num `IF NOT EXISTS` sobre a tabela inteira.
--
-- ---------------------------------------------------------------------------
-- 4. O que esta migration deliberadamente não faz
-- ---------------------------------------------------------------------------
--
-- Não toca em `snapshot`, `scope_hash` nem em nenhuma tabela de acervo. O
-- `scope_hash` continua sendo o que sempre foi — a soma do escopo declarado
-- pelo arquivo —, e a ponte dele para a unidade canônica já existe em
-- `remuneracao_unidade.unidade_id`. Reescrever o acervo para carimbar empresa
-- nele seria derivar identidade de importação, que é o desenho que
-- `schema/unidade.ts` desfez.

-- ── 1. empresa ──────────────────────────────────────────────────────────────
--
-- O DDL desta migration é o que o `drizzle-kit generate` produziu a partir do
-- schema, com **uma** diferença deliberada: as duas colunas novas nascem
-- anuláveis, são preenchidas, e só então viram `NOT NULL`. O gerado as criava
-- já `NOT NULL`, o que funciona em banco vazio e falha em todo banco com
-- linhas — que são todos os que importam.

CREATE TABLE IF NOT EXISTS "empresa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"cnpj_raiz" text,
	"ativa" boolean DEFAULT true NOT NULL,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "empresa_cnpj_raiz_canonico" CHECK ("empresa"."cnpj_raiz" IS NULL OR "empresa"."cnpj_raiz" ~ '^[0-9]{8}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "empresa_cnpj_raiz_uq" ON "empresa" USING btree ("cnpj_raiz");--> statement-breakpoint

-- ── 2. a empresa desta instalação ───────────────────────────────────────────

INSERT INTO "empresa" ("nome")
SELECT 'Empresa principal'
WHERE NOT EXISTS (SELECT 1 FROM "empresa");--> statement-breakpoint

-- ── 3. unidade e conta passam a ter dono ────────────────────────────────────

ALTER TABLE "unidade" ADD COLUMN IF NOT EXISTS "empresa_id" uuid;--> statement-breakpoint
UPDATE "unidade" SET "empresa_id" = (SELECT "id" FROM "empresa" ORDER BY "criada_em" LIMIT 1) WHERE "empresa_id" IS NULL;--> statement-breakpoint
ALTER TABLE "unidade" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unidade_empresa_id_empresa_id_fk') THEN
    ALTER TABLE "unidade" ADD CONSTRAINT "unidade_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unidade_empresa_idx" ON "unidade" USING btree ("empresa_id");--> statement-breakpoint

ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "empresa_id" uuid;--> statement-breakpoint
UPDATE "app_user" SET "empresa_id" = (SELECT "id" FROM "empresa" ORDER BY "criada_em" LIMIT 1) WHERE "empresa_id" IS NULL;--> statement-breakpoint
ALTER TABLE "app_user" ALTER COLUMN "empresa_id" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_user_empresa_id_empresa_id_fk') THEN
    ALTER TABLE "app_user" ADD CONSTRAINT "app_user_empresa_id_empresa_id_fk" FOREIGN KEY ("empresa_id") REFERENCES "public"."empresa"("id") ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_user_empresa_idx" ON "app_user" USING btree ("empresa_id");--> statement-breakpoint

-- ── 4. acesso_a_unidade ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "acesso_a_unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"unidade_id" uuid NOT NULL,
	"nivel" text DEFAULT 'VER' NOT NULL,
	"concedido_por" text NOT NULL,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "acesso_a_unidade_nivel_valido" CHECK ("acesso_a_unidade"."nivel" IN ('VER', 'EDITAR'))
);
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acesso_a_unidade_user_id_app_user_id_fk') THEN
    ALTER TABLE "acesso_a_unidade" ADD CONSTRAINT "acesso_a_unidade_user_id_app_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."app_user"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acesso_a_unidade_unidade_id_unidade_id_fk') THEN
    ALTER TABLE "acesso_a_unidade" ADD CONSTRAINT "acesso_a_unidade_unidade_id_unidade_id_fk" FOREIGN KEY ("unidade_id") REFERENCES "public"."unidade"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "acesso_a_unidade_uq" ON "acesso_a_unidade" USING btree ("user_id","unidade_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "acesso_a_unidade_user_idx" ON "acesso_a_unidade" USING btree ("user_id");
