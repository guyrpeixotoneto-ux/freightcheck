import {
  pgTable,
  text,
  uuid,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * AUTH — quem entrou, e a prova de que entrou.
 *
 * Existe por uma razão só, e ela é do domínio, não da infraestrutura: este
 * produto grava `actor` em cada confirmação de curadoria e em cada promoção de
 * vigência, e até aqui esse nome era digitado por quem estava na tela. Um campo
 * de texto livre não sustenta a frase "foi fulano quem confirmou" — sustenta
 * apenas "alguém digitou fulano". Uma sessão sustenta.
 *
 * O que este arquivo deliberadamente **não** tem: papéis, permissões por tela,
 * convites, recuperação de senha. Nada disso foi pedido, e cada um deles é uma
 * decisão de produto que ainda não foi tomada. Estar logado é hoje uma resposta
 * binária, e o schema diz isso sem fingir mais.
 */

export const appUserTable = pgTable(
  "app_user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Sempre normalizado em minúsculas antes de gravar — o índice é único e
     * `Guy@x.com` e `guy@x.com` são a mesma pessoa em todo provedor de e-mail
     * que este produto vai encontrar. A normalização mora no código de auth,
     * não num trigger, porque é a mesma função que compara no login.
     */
    email: text("email").notNull(),
    name: text("name").notNull(),
    /**
     * scrypt, com sal por usuário, no formato descrito em
     * `artifacts/api-server/src/lib/auth.ts`. A senha em claro nunca é gravada,
     * nunca é logada e nunca volta numa resposta.
     */
    passwordHash: text("password_hash").notNull(),
    /**
     * ADMIN ou OPERADOR — o papel mínimo que separa "quem gerencia contas" de
     * "quem audita". Nasceu porque a ausência de papéis deixava qualquer conta
     * redefinir a senha de qualquer outra — tomada de conta a um clique, num
     * produto cujo valor é o "quem fez".
     *
     * O default do banco é OPERADOR de propósito (fail-closed: um INSERT que
     * esqueça o papel não fabrica um administrador); as contas anteriores à
     * migration viram ADMIN no backfill, porque era o que todas já podiam.
     */
    role: text("role").notNull().default("OPERADOR"),
    /**
     * Desativar em vez de apagar: o `actor` das confirmações já feitas aponta
     * para esta pessoa, e apagar a linha transformaria um histórico auditável
     * num e-mail órfão.
     */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * Quem deu o acesso, e quem tirou — o e-mail de quem estava logado, no mesmo
     * formato do `actor` do resto do produto.
     *
     * Dar acesso a um sistema de auditoria é um ato administrativo, e um ato
     * administrativo sem autor é exatamente o que este produto recusa em todas
     * as outras telas. Nulo em `created_by` significa uma conta anterior a esta
     * coluna ou criada pelo terminal (`create-user`), e não "não se sabe".
     */
    createdBy: text("created_by"),
    disabledBy: text("disabled_by"),
  },
  (t) => [uniqueIndex("app_user_email_key").on(t.email)],
);

export const userSessionTable = pgTable(
  "user_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUserTable.id, { onDelete: "cascade" }),
    /**
     * O SHA-256 do token, nunca o token.
     *
     * O que vai no cookie é aleatório e só existe no navegador de quem entrou.
     * Guardar o valor original aqui daria a quem lesse esta tabela — um dump,
     * um backup, um log de query — a capacidade de se passar por qualquer
     * pessoa logada. Guardar o hash não dá.
     */
    tokenHash: text("token_hash").notNull(),
    /** Absoluto: passou disto, a sessão morre mesmo com a aba aberta. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("user_session_token_key").on(t.tokenHash),
    index("user_session_user_idx").on(t.userId),
    index("user_session_expires_idx").on(t.expiresAt),
  ],
);
