import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  jsonb,
  timestamp,
  check,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * INTEGRAÇÕES — os sistemas que falam com este por API, e o que cada um pode.
 *
 * Até aqui todo dado entrava por uma pessoa com um arquivo na mão, e toda
 * leitura saía por uma tela com sessão aberta. A porta de API é a terceira
 * forma, e ela precisa responder três perguntas que a tela respondia sozinha:
 * **quem** está chamando, **o que** pode fazer, e **o que fez**. Três tabelas,
 * uma para cada pergunta.
 *
 * **1. `integracao` é o sistema do outro lado**, com nome de gente — "Freightec
 * da Ambev", "ERP da matriz". Não é a credencial: uma integração vive anos e
 * troca de chave quantas vezes for preciso, e é ela que aparece no log de
 * chamadas meses depois, quando a chave que fez aquela chamada já não existe.
 *
 * **2. `integracao_chave` é a credencial**, e são várias por integração de
 * propósito. Trocar chave sem parar a integração exige duas válidas ao mesmo
 * tempo por alguns minutos — emite-se a nova, configura-se o outro lado,
 * revoga-se a antiga. Com uma chave por integração, toda troca seria uma
 * parada, e uma parada que dá trabalho é uma chave que nunca se troca.
 *
 * **3. `integracao_chamada` é o que aconteceu**, e é a razão de a tela existir.
 * Sem ela, "o sistema está atualizando por API" é uma afirmação sem prova: não
 * se sabe se o outro lado chamou hoje, se parou de chamar na terça, se está
 * apanhando 403 há uma semana por falta de escopo. É o mesmo princípio das
 * outras telas deste produto — o número aparece com a origem ao lado —,
 * aplicado à porta.
 *
 * **O que estas tabelas deliberadamente não guardam: a chave.** Só o SHA-256
 * dela e o prefixo público. Um dump deste banco não vira acesso à API. O
 * porquê inteiro, e a conferência em tempo constante, estão em
 * `lib/integrations/src/chave.ts`.
 *
 * **E o que a chave nunca alcança: a promoção.** Uma importação enviada por
 * API para no preview, como a que sobe pela tela, e a aprovação continua sendo
 * o clique de uma pessoa. É a fronteira que o produto inteiro existe para
 * manter, e por isso ela é dita aqui, no schema, e não só na rota que a
 * implementa.
 */

export const integracaoTable = pgTable(
  "integracao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** O nome de gente — o que a tela lista e o que o log nomeia. */
    nome: text("nome").notNull(),
    /** O sistema do outro lado, como quem opera o chama: "Freightec", "SAP". */
    sistema: text("sistema").notNull(),
    /** Para que serve, escrito por quem criou. Opcional, e quase sempre lido. */
    descricao: text("descricao"),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    /** O e-mail de quem criou — o mesmo formato de `actor` do resto do produto. */
    criadaPor: text("criada_por").notNull(),
    /**
     * Desativar não apaga: uma integração desativada continua no log de tudo o
     * que já fez, e nenhuma chave dela entra. Excluir apagaria o histórico de
     * quem escreveu no acervo, que é justamente o que não se pode perder.
     */
    desativadaEm: timestamp("desativada_em", { withTimezone: true }),
    desativadaPor: text("desativada_por"),
  },
  (t) => [
    /*
      Dois "Freightec" na lista seriam duas linhas indistinguíveis na tela e no
      log — e a pergunta "qual das duas está chamando?" não teria resposta.
    */
    uniqueIndex("integracao_nome_uq").on(t.nome),
    index("integracao_criada_idx").on(t.criadaEm),
  ],
);

export const integracaoChaveTable = pgTable(
  "integracao_chave",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integracaoId: uuid("integracao_id")
      .notNull()
      .references(() => integracaoTable.id, { onDelete: "cascade" }),
    /** `fck_a1b2c3d4e5f6` — em claro, e é por ele que a conferência acha a linha. */
    prefixo: text("prefixo").notNull(),
    /** SHA-256 hex da chave inteira. A chave em si não existe em lugar nenhum. */
    hash: text("hash").notNull(),
    /**
     * Os escopos desta chave, como lista de texto.
     *
     * `jsonb` e não tabela de junção: escopo é vocabulário de código
     * (`lib/integrations/src/escopos.ts`), não cadastro — não há tela que os
     * crie, não há chave estrangeira que os proteja, e uma tabela a mais só
     * acrescentaria um JOIN a toda conferência de chamada. Escopo que este
     * servidor não conhece não concede nada, e é assim que um build mais velho
     * lê uma linha escrita por um mais novo sem derrubar a integração.
     */
    escopos: jsonb("escopos").notNull().default([]),
    /** Como quem administra chama esta chave: "produção", "homologação". */
    apelido: text("apelido"),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    criadaPor: text("criada_por").notNull(),
    /**
     * Quando esta chave foi usada pela última vez.
     *
     * É o único campo destas tabelas que é escrito por uma chamada de API, e o
     * único que existe para responder uma pergunta de faxina: quais chaves
     * podem ser revogadas sem quebrar nada. Sem ele, a resposta seria "vasculhe
     * o log de chamadas de cada uma", e a chave esquecida ficaria viva para
     * sempre.
     */
    ultimaChamadaEm: timestamp("ultima_chamada_em", { withTimezone: true }),
    /** Revogar é para sempre: a chave revogada nunca volta a valer. */
    revogadaEm: timestamp("revogada_em", { withTimezone: true }),
    revogadaPor: text("revogada_por"),
  },
  (t) => [
    /*
      Os dois são únicos, e por razões diferentes. O hash porque duas linhas com
      o mesmo hash seriam a mesma chave em duas integrações — e a conferência
      teria de escolher uma. O prefixo porque é ele que localiza a linha: um
      prefixo repetido faria a busca devolver duas candidatas, e a defesa contra
      isso seria comparar as duas, que é exatamente o que o prefixo existe para
      evitar.
    */
    uniqueIndex("integracao_chave_hash_uq").on(t.hash),
    uniqueIndex("integracao_chave_prefixo_uq").on(t.prefixo),
    index("integracao_chave_integracao_idx").on(t.integracaoId),
  ],
);

export const integracaoChamadaTable = pgTable(
  "integracao_chamada",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integracaoId: uuid("integracao_id")
      .notNull()
      .references(() => integracaoTable.id, { onDelete: "cascade" }),
    /**
     * A chave que fez a chamada. Continua apontando para a chave revogada — é
     * o histórico dela que responde "o que esta chave chegou a fazer antes de
     * ser revogada", e uma revogação que apagasse o rastro tornaria a pergunta
     * impossível justamente no caso em que ela é urgente.
     */
    chaveId: uuid("chave_id")
      .notNull()
      .references(() => integracaoChaveTable.id, { onDelete: "cascade" }),
    em: timestamp("em", { withTimezone: true }).notNull().defaultNow(),
    metodo: text("metodo").notNull(),
    /** O caminho, sem query string — credencial nenhuma passa por lá, e o log não a guardaria. */
    caminho: text("caminho").notNull(),
    status: integer("status").notNull(),
    duracaoMs: integer("duracao_ms").notNull(),
    /**
     * OK, RECUSADA ou FALHA — a leitura de uma linha em uma palavra.
     *
     * O status HTTP já está ao lado, e ainda assim os três nomes existem: a
     * pergunta da tela é "esta integração está funcionando?", e respondê-la
     * exigiria, sem eles, uma classificação de faixa de status escrita na
     * consulta — e outra na tela, e outra no dia em que alguém somasse por
     * fora. RECUSADA é nossa recusa deliberada (401, 403, 409, 422); FALHA é
     * defeito nosso (5xx).
     */
    resultado: text("resultado").notNull(),
    /** O motivo da recusa, quando houve — a mesma frase que o outro lado recebeu. */
    motivo: text("motivo"),
    /** Quantos bytes o corpo trouxe. Zero nas leituras. */
    bytes: integer("bytes").notNull().default(0),
    /** O `requestId` desta requisição — é o que liga esta linha ao log do processo. */
    requestId: text("request_id"),
    /**
     * A importação que esta chamada criou, quando criou alguma.
     *
     * Sem chave estrangeira, e é decisão: excluir uma importação é um ato
     * previsto (`import_deletion`), e uma FK faria a exclusão levar junto o
     * registro de que uma integração a criou — ou, com RESTRICT, impediria a
     * exclusão por causa de uma linha de log. O id fica como referência fraca:
     * quando a importação existe, a tela leva até ela; quando não existe mais,
     * a linha continua dizendo que naquele dia entrou um arquivo por API.
     */
    importRunId: uuid("import_run_id"),
  },
  (t) => [
    /*
      A consulta da tela é sempre "as últimas chamadas desta integração", e o
      índice é o par que ela usa. Sem ele, a listagem varre o log inteiro — que
      é a tabela que mais cresce deste schema, uma linha por chamada.
    */
    index("integracao_chamada_integracao_em_idx").on(t.integracaoId, t.em),
    index("integracao_chamada_chave_idx").on(t.chaveId),
    index("integracao_chamada_em_idx").on(t.em),
    /*
      Os três nomes também no banco, e não só no código que grava. É a mesma
      razão do check de `permissao_de_modulo.nivel`: um INSERT vindo de um
      script não inventa um quarto resultado que a tela não sabe ler.
    */
    check(
      "integracao_chamada_resultado_ck",
      sql`${t.resultado} IN ('OK', 'RECUSADA', 'FALHA')`,
    ),
  ],
);
