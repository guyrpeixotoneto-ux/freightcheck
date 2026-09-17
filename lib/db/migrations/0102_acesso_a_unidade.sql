-- ---------------------------------------------------------------------------
-- ACESSO À UNIDADE — a autorização de leitura que o produto nunca teve.
-- ---------------------------------------------------------------------------
--
-- **Nasceu `0101` e virou `0102` no encontro de fila.** A `main` chegou antes
-- com a `0101_quinzena_declarada_no_envio`, e renumerar é o que a fila deste
-- repositório faz nesse caso — a `0048` tem o mesmo histórico escrito no
-- cabeçalho dela. O número aparece num lugar só do código (`M102`, em
-- `bridge.ts`), que é o que torna renumerar uma troca de literal em vez de uma
-- caçada por texto solto.
-- ---------------------------------------------------------------------------
--
-- Esta migration cria **estrutura**, e não bloqueio. Depois dela, nenhuma
-- leitura deste produto responde diferente do que respondia antes: a tabela
-- nasce vazia, ninguém a consulta para recusar nada, e o corte é uma decisão
-- posterior, tomada com a medição do modo de observação na mão (ver
-- `middlewares/escopo-em-observacao.ts`, no api-server).
--
-- A separação é deliberada. A auditoria de 17/09/2026 mediu por que ligar o
-- corte junto com o schema é caro: ~40 rotas de leitura compartilham endpoints,
-- e um bloqueio mal colocado derruba tela permitida sem proteger a proibida. É
-- a mesma razão, escrita em `lib/permissoes.ts`, pela qual leitura nunca foi
-- filtrada por módulo neste produto.
--
-- ---------------------------------------------------------------------------
-- A fronteira é a unidade — e não há nível acima dela
-- ---------------------------------------------------------------------------
--
-- Não existe empresa aqui, e a ausência é decisão de produto: o FreightCheck
-- organiza o mundo por unidade, e um nível acima só para pendurar autorização
-- seria uma dimensão que nenhuma tela usa e que toda consulta teria de
-- atravessar. Quem precisa enxergar várias unidades recebe várias linhas.
--
-- ---------------------------------------------------------------------------
-- Sem linha é sem acesso, e isto é o oposto do resto do produto
-- ---------------------------------------------------------------------------
--
-- `permissao_de_modulo`, `papel` e `modulo_universal` leem a ausência de linha
-- como concessão — foi o certo lá, porque nasceram sobre um produto em uso e o
-- silêncio lido como bloqueio teria sido um apagão.
--
-- Aqui a regra é a inversa: **ausência de concessão é ausência de acesso**. Um
-- fallback "sem cadastro, alcança tudo" transformaria falta de configuração em
-- autorização global — a tabela existiria, pareceria fronteira, e não seria
-- nenhuma. Quem precisa de todas as unidades recebe todas, explicitamente, com
-- autor e data; não há caminho em que alguém alcance uma unidade porque
-- ninguém decidiu nada sobre ela.
--
-- O preço disso é real: num banco sem concessões, o corte deixaria todo mundo
-- sem nada. É exatamente por isso que o corte **não** vem nesta migration. A
-- ordem é: criar a estrutura, medir em observação, cadastrar as concessões, e
-- só então ligar.
--
-- ---------------------------------------------------------------------------
-- O que esta migration deliberadamente não faz
-- ---------------------------------------------------------------------------
--
-- Não toca em `app_user.unidade_id`, que continua sendo lotação e não
-- permissão (`schema/auth.ts`). Não toca em `snapshot`, em `scope_hash` nem em
-- nenhuma tabela de acervo: o hash continua sendo a soma do escopo que o
-- arquivo declarou, e a ponte dele para a unidade canônica já existe, curada
-- por gente, em `remuneracao_unidade.unidade_id`.
--
-- O DDL abaixo é o que o `drizzle-kit generate` produziu a partir do schema,
-- com as formas idempotentes que a fila deste repositório usa — a `0049` é o
-- precedente. Idempotência não é preciosismo aqui: `canonical-identity-
-- migration` roda a fila inteira sobre um banco que já tem a estrutura e não
-- tem o registro, e um `CREATE TABLE` cru reprova ali.

CREATE TABLE IF NOT EXISTS "acesso_a_unidade" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"unidade_id" uuid NOT NULL,
	"nivel" text DEFAULT 'VER' NOT NULL,
	"concedido_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
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
