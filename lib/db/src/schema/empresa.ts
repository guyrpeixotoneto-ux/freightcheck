import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUserTable } from "./auth";
import { unidadeTable } from "./unidade";

/**
 * A EMPRESA — o tenant, que até a `0101` era a instalação inteira.
 *
 * **O que esta tabela muda de natureza.** Enquanto `unidade` não tinha dono,
 * "isolamento entre empresas" não era uma permissão faltando: era uma dimensão
 * que não existia, e nenhuma quantidade de verificação no servidor a
 * inventaria — não há o que comparar quando não há atributo. A partir daqui
 * toda unidade pertence a exatamente uma empresa, toda conta pertence a
 * exatamente uma empresa, e a pergunta "esta pessoa pode ler este dado?" começa
 * por uma junção em vez de por uma regra espalhada.
 *
 * **A sessão é a raiz de confiança, e é a única.** A empresa de uma requisição
 * sai de `app_user.empresa_id` da conta autenticada, nunca do corpo, da
 * consulta ou de um cabeçalho. É a invariante que sustenta todas as outras: um
 * cliente que pudesse declarar a própria empresa não estaria isolado de nada,
 * por mais completa que fosse a estrutura abaixo dela.
 *
 * `cnpj_raiz` são os oito primeiros dígitos — a raiz que as filiais de um mesmo
 * grupo compartilham. Anulável pela mesma razão de `unidade.cnpj`: a empresa
 * que o produto conhece por nome antes de conhecer por documento existe, e
 * exigir o documento produz cadastro nenhum em vez de cadastro melhor.
 */
export const empresaTable = pgTable(
  "empresa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** A grafia escolhida por quem cadastrou — descrição, nunca identidade. */
    nome: text("nome").notNull(),
    /** Os oito dígitos da raiz do CNPJ, sem máscara. `NULL` quando não há. */
    cnpjRaiz: text("cnpj_raiz"),
    /**
     * Empresa desligada continua existindo e para de conceder.
     *
     * Apagar não é opção: as unidades e as contas dela referenciam esta linha,
     * e o histórico de quem leu o quê aponta para cá. `ativa = false` é como
     * uma empresa sai do ar sem levar junto o rastro do que ela fez.
     */
    ativa: boolean("ativa").notNull().default(true),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("empresa_cnpj_raiz_uq").on(t.cnpjRaiz),
    check(
      "empresa_cnpj_raiz_canonico",
      sql`${t.cnpjRaiz} IS NULL OR ${t.cnpjRaiz} ~ '^[0-9]{8}$'`,
    ),
  ],
);

/**
 * ACESSO À UNIDADE — a autorização de leitura, em estrutura própria.
 *
 * **Por que não `app_user.unidade_id`.** Porque aquilo é lotação, e
 * `schema/auth.ts` diz com todas as letras que ela **não é permissão**: "ninguém
 * deixa de ver uma unidade por estar lotado em outra… misturar as duas coisas
 * faria um cadastro administrativo virar um portão de acesso silencioso".
 * Concordar com essa frase e ainda assim precisar de autorização por unidade
 * leva a exatamente uma saída: uma segunda estrutura, que é esta. Autorização
 * tem autor, tem data e tem histórico; lotação não precisa de nenhum dos três.
 *
 * **A ausência de linha concede — dentro da empresa, e nunca fora dela.** É a
 * mesma regra das outras três camadas de permissão deste produto, e existe pelo
 * mesmo motivo: ler o silêncio como bloqueio transformaria a migration num
 * apagão para toda conta que já existe. O que a ausência **jamais** faz é
 * atravessar empresa — o fallback é "todas as unidades da minha empresa", e é
 * por isso que ele mora numa consulta que começa por `empresa_id` em vez de num
 * "não há linha, então tudo". A diferença entre as duas frases é o produto
 * inteiro.
 *
 * `nivel` existe com dois valores desde o começo porque a estrutura que nasce
 * só com leitura precisa de uma migration para ganhar escrita, e a que nasce
 * com os dois não precisa de nenhuma. Hoje o corte de escrita continua sendo do
 * portão de permissão, por módulo e por ambiente.
 */
export const acessoAUnidadeTable = pgTable(
  "acesso_a_unidade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => appUserTable.id, { onDelete: "cascade" }),
    unidadeId: uuid("unidade_id")
      .notNull()
      .references(() => unidadeTable.id, { onDelete: "cascade" }),
    /** `VER` ou `EDITAR`. */
    nivel: text("nivel").notNull().default("VER"),
    /** Quem concedeu — o e-mail, como o resto do histórico de acesso guarda. */
    concedidoPor: text("concedido_por").notNull(),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("acesso_a_unidade_uq").on(t.userId, t.unidadeId),
    index("acesso_a_unidade_user_idx").on(t.userId),
    check("acesso_a_unidade_nivel_valido", sql`${t.nivel} IN ('VER', 'EDITAR')`),
  ],
);
