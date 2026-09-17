import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appUserTable } from "./auth";
import { unidadeTable } from "./unidade";

/**
 * ACESSO À UNIDADE — quem pode ler o acervo de qual unidade.
 *
 * ---------------------------------------------------------------------------
 * A fronteira do produto é a unidade
 * ---------------------------------------------------------------------------
 *
 * Não há camada de empresa acima disto, e a ausência é decisão de produto: o
 * FreightCheck organiza o mundo por **unidade**, e inventar um nível acima só
 * para pendurar autorização criaria uma dimensão que nenhuma tela usa e que
 * toda consulta teria de atravessar. Quem precisa enxergar várias unidades
 * recebe várias linhas aqui.
 *
 * ---------------------------------------------------------------------------
 * Por que não `app_user.unidade_id`
 * ---------------------------------------------------------------------------
 *
 * Porque aquilo é **lotação**, e `schema/auth.ts` diz com todas as letras que
 * ela não é permissão: "ninguém deixa de ver uma unidade por estar lotado em
 * outra… misturar as duas coisas faria um cadastro administrativo virar um
 * portão de acesso silencioso". Concordar com aquela frase e ainda assim
 * precisar de autorização por unidade leva a exatamente uma saída, que é esta
 * tabela.
 *
 * A lotação pode **sugerir** — a tela de concessão oferece a unidade da pessoa
 * já preenchida, porque é quase sempre a primeira que ela vai receber. Sugerir
 * não é conceder: quem concede é gente, e fica escrito quem foi.
 *
 * ---------------------------------------------------------------------------
 * Sem linha é sem acesso — e por que isto difere do resto do produto
 * ---------------------------------------------------------------------------
 *
 * As outras três camadas de permissão deste produto (`permissao_de_modulo`,
 * `papel`, `modulo_universal`) leem a ausência de linha como **concessão**. Foi
 * a decisão certa lá: elas nasceram sobre um produto em uso, e ler o silêncio
 * como bloqueio teria transformado a migration num apagão.
 *
 * Aqui a regra é a oposta, e é deliberada: **ausência de concessão é ausência
 * de acesso**. Um fallback "sem cadastro, alcança tudo" transformaria a falta
 * de configuração em autorização global — a tabela existiria, pareceria uma
 * fronteira, e não seria nenhuma. Quem precisa ver todas as unidades recebe
 * todas explicitamente; não existe caminho em que alguém alcance uma unidade
 * porque ninguém decidiu nada a respeito dela.
 *
 * **O preço dessa escolha é real e está pago em outro lugar**: num banco sem
 * concessões, todo mundo ficaria sem nada. Por isso o corte não acompanha esta
 * migration. Ela cria a estrutura; o bloqueio é ligado depois, com a medição do
 * modo de observação na mão e com as concessões já cadastradas. Ver
 * `middlewares/escopo-em-observacao.ts`, no api-server.
 *
 * ---------------------------------------------------------------------------
 * `nivel`
 * ---------------------------------------------------------------------------
 *
 * `VER` e `EDITAR` desde o começo porque uma estrutura que nasce só com leitura
 * precisa de migration para ganhar escrita, e a que nasce com as duas não
 * precisa de nenhuma. Hoje o corte de **escrita** continua sendo do portão de
 * permissão, por módulo e por ambiente — este eixo é o de leitura.
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
    nivel: text("nivel").notNull().default("VER"),
    /** O e-mail de quem concedeu — o mesmo `actor` do resto do produto. */
    concedidoPor: text("concedido_por").notNull(),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("acesso_a_unidade_uq").on(t.userId, t.unidadeId),
    index("acesso_a_unidade_user_idx").on(t.userId),
    check("acesso_a_unidade_nivel_valido", sql`${t.nivel} IN ('VER', 'EDITAR')`),
  ],
);
