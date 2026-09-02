import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  jsonb,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { appUserTable } from "./auth";
import { ticketImportTable, ticketTable } from "./tickets";

/**
 * MONITORAMENTO DE CHAMADOS — o que mudou entre um envio e o seguinte.
 *
 * `tickets.ts` guarda a fila como ela chegou: um envio, os chamados dele, os
 * parâmetros que cada um mexeu. Responde "o que tem na fila hoje". Não responde
 * a pergunta que o gestor faz todo dia — **o que mudou desde ontem?** — e
 * nenhuma linha do repositório respondia: `GET /tickets` lê um envio, e nada
 * cruzava dois.
 *
 * Este arquivo é essa segunda pergunta. Ele não guarda chamado nenhum: guarda a
 * **comparação** entre dois retratos que já existiam.
 *
 * ---------------------------------------------------------------------------
 * O material já estava lá, e é por isso que isto é pequeno
 * ---------------------------------------------------------------------------
 *
 * `readTicketImport` **só insere** — nunca faz UPDATE em `ticket`. Cada
 * `ticket_import` é, sem que ninguém tenha planejado assim, um retrato completo
 * e imutável da fila naquele instante. Não foi preciso criar snapshot: foi
 * preciso escrever a subtração.
 *
 * ---------------------------------------------------------------------------
 * Uma movimentação não é um `ticket_change`
 * ---------------------------------------------------------------------------
 *
 * É a confusão mais fácil de cometer aqui, e a mais cara. `ticket_change` é *o
 * parâmetro de remuneração que este chamado pediu para mexer* — um antes→depois
 * **de valor**, dentro de **um** envio, cujo "antes" às vezes nem vem do
 * arquivo (`before_source = 'VIGENCIA'`). A movimentação é *o que mudou no
 * chamado entre o envio de ontem e o de hoje*. Reaproveitar um pelo outro daria
 * uma tela que parece certa e responde outra pergunta.
 *
 * ---------------------------------------------------------------------------
 * Derivado, como `change_set` — com uma exceção
 * ---------------------------------------------------------------------------
 *
 * `ticket_import_comparacao`, `ticket_movement_day`, `ticket_movement_field` e
 * `ticket_movement_step` são recomputáveis a partir de `ticket_import`. Mesma
 * postura de `comparison.ts` ("derived, and deliberately replaceable"): o
 * algoritmo pode melhorar sem migration.
 *
 * `ticket_movement_review` não. Ela é ato humano, e ninguém recomputa um ato
 * humano.
 */

/**
 * Um envio processado pelo monitoramento — a comparação, e o que ela deu.
 *
 * Existe para que **"dia sem importação" e "importação sem nenhuma mudança"**
 * não sejam o mesmo estado na tela. Os dois dão zero movimentações, e são
 * coisas opostas para quem opera: um é "ninguém mandou arquivo", o outro é
 * "chegou e não mexeu em nada". Sem esta tabela a tela teria de adivinhar, e
 * adivinharia igual nos dois.
 */
export const ticketImportComparacaoTable = pgTable(
  "ticket_import_comparacao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketImportId: uuid("ticket_import_id")
      .notNull()
      .references(() => ticketImportTable.id, { onDelete: "cascade" }),
    /** Contra qual envio se comparou. `NULL` na BASELINE, que não compara. */
    baseImportId: uuid("base_import_id").references(() => ticketImportTable.id, {
      onDelete: "cascade",
    }),
    serie: text("serie"),
    /**
     * O dia da régua: `received_at` do envio-alvo, no fuso da operação.
     *
     * Gravado, e não calculado na consulta, por duas razões. A conta
     * (`AT TIME ZONE 'America/Sao_Paulo'`) num `WHERE` descarta o índice; e o
     * dia de uma comparação é um fato dela, não uma opinião de quem a lê — duas
     * telas que o recalculassem poderiam discordar sobre em que dia uma
     * movimentação aconteceu.
     */
    dia: date("dia").notNull(),
    /**
     * BASELINE — o primeiro envio da série. Registra o estado inicial e **não
     *            produz movimentação nenhuma**. É o que impede a primeira carga
     *            histórica de nascer como milhares de "chamados novos" a
     *            revisar — que seria o primeiro contato de alguém com a tela.
     * DIFF     — comparado com o anterior; `baseImportId` diz com qual.
     * IGNORADO — não entrou em conta nenhuma, e `motivo` diz por quê: o envio
     *            não chegou a READ, ou é mais antigo que a última comparação da
     *            série. Dado parcial nunca é apresentado como oficial.
     */
    tipo: text("tipo").notNull(),
    chamadosNoEnvio: integer("chamados_no_envio").notNull().default(0),
    chamadosNaBase: integer("chamados_na_base").notNull().default(0),
    movimentacoes: integer("movimentacoes").notNull().default(0),
    /**
     * Quantos desaparecimentos foram **contados e não publicados**.
     *
     * Um export que sai truncado faz milhares de chamados sumirem de uma vez, e
     * publicá-los como movimentação encheria o dia de pendências falsas. Acima
     * do limiar (ver `LIMIAR_DE_ENCOLHIMENTO`), os removidos são suprimidos — e
     * o número fica aqui, com o motivo, porque suprimir em silêncio seria a
     * mesma omissão que o produto recusa em todo o resto.
     */
    removidosSuprimidos: integer("removidos_suprimidos").notNull().default(0),
    /** Escrito para quem opera. Nunca vazio quando `tipo` é IGNORADO. */
    motivo: text("motivo"),
    calculadaEm: timestamp("calculada_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /** Um envio é comparado uma vez; recomputar substitui. */
    uniqueIndex("ticket_import_comparacao_envio_uq").on(t.ticketImportId),
    index("ticket_import_comparacao_dia_idx").on(t.dia, t.serie),
  ],
);

/**
 * A movimentação: **o chamado que se mexeu num dia.**
 *
 * O grão é `(dia, série, chamado)`, e não `(comparação, chamado)`. Um chamado
 * que se mexeu às 08h, às 12h e às 17h é **uma** linha da fila, com os três
 * passos em `ticket_movement_step` e visíveis ao expandir.
 *
 * **A razão é a revisão.** Se cada comparação fosse revisável em separado,
 * "fechar o dia" passaria a depender de quantas vezes alguém subiu o arquivo, e
 * um dia ficaria meio fechado por um artefato de operação em vez de por
 * trabalho pendente. Com este grão, "70 movimentações" quer dizer 70 chamados
 * que se mexeram — que é o que a frase quer dizer para quem a lê.
 *
 * **A linha do dia corrente é mutável, de propósito.** O envio das 17h reescreve
 * a movimentação que existia às 09h, e `revisao` sobe. A revisão carimbada na
 * versão anterior deixa de valer e a movimentação volta para a fila — porque
 * quem revisou às 09h revisou outra coisa. Dias passados param de mudar
 * sozinhos: não chegam mais envios com aquela data.
 */
export const ticketMovementDayTable = pgTable(
  "ticket_movement_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dia: date("dia").notNull(),
    serie: text("serie"),
    /** O número do chamado — `B.O` no export real. */
    externalId: text("external_id").notNull(),
    /**
     * NOVO | ALTERADO | ENCERRADO | REMOVIDO — **exatamente uma por linha.**
     *
     * As quatro são mutuamente exclusivas e exaustivas, e é isso que faz
     * `novos + alterados + encerrados + removidos = movimentações` fechar por
     * construção. Um encerramento é uma mudança de status, logo também um
     * "alterado"; contar os dois somaria a mesma movimentação duas vezes, e a
     * tela publicaria um total maior que a população. **Encerrar vence**: a
     * mudança de prazo que veio junto continua aparecendo entre os campos.
     */
    classe: text("classe").notNull(),
    /** Sobe a cada recálculo **que muda o conteúdo**. Ver `assinatura`. */
    revisao: integer("revisao").notNull().default(1),
    /**
     * O SHA-256 de tudo o que esta movimentação afirma — classe, estado final,
     * criticidade e o conjunto de diferenças, em ordem determinística.
     *
     * Existe para responder barato à única pergunta que decide se uma revisão
     * sobrevive: **o recálculo mudou o que foi revisado?** Recalcular um dia é
     * rotina (todo envio novo recalcula o dia inteiro), e a esmagadora maioria
     * dos recálculos reescreve linha por linha exatamente o mesmo conteúdo. Sem
     * esta coluna, `revisao` subiria em todos eles e **toda revisão do dia
     * voltaria para a fila a cada arquivo recebido** — o que faria "fechar o
     * dia" ser impossível num dia com três importações.
     *
     * Com ela: assinatura igual, `revisao` fica; assinatura diferente, `revisao`
     * sobe e a revisão anterior deixa de valer, que é o comportamento correto —
     * quem revisou revisou outra coisa.
     */
    assinatura: text("assinatura").notNull(),
    /** Quantas comparações tocaram este chamado neste dia. */
    passos: integer("passos").notNull().default(1),
    camposAlterados: integer("campos_alterados").notNull().default(0),
    primeiroImportId: uuid("primeiro_import_id")
      .notNull()
      .references(() => ticketImportTable.id, { onDelete: "cascade" }),
    ultimoImportId: uuid("ultimo_import_id")
      .notNull()
      .references(() => ticketImportTable.id, { onDelete: "cascade" }),
    /**
     * A linha do chamado no estado final do dia. `NULL` quando ele desapareceu
     * (REMOVIDO) — não há estado final de algo que não veio.
     *
     * `SET NULL` na exclusão, e não `CASCADE`: a movimentação continua sendo
     * verdade sobre aquele dia mesmo depois de a linha do chamado sair.
     */
    ticketIdFinal: uuid("ticket_id_final").references(() => ticketTable.id, {
      onDelete: "set null",
    }),

    /*
      O estado final, denormalizado do último `ticket` do dia.

      Mesma razão de `change` denormalizar os dele: a lista filtra por unidade,
      por responsável e por status, e ordena por hora — tudo isso com junção
      seria uma junção por linha da página, em cima de uma tabela do tamanho do
      arquivo.
    */
    unidade: text("unidade"),
    area: text("area"),
    /** O `Aprovador` do export — quem decide. */
    responsavel: text("responsavel"),
    /** O `Solicitante` — quem abriu. Não é o responsável, e a tela mostra os dois. */
    solicitante: text("solicitante"),
    statusRaw: text("status_raw"),
    statusBucket: text("status_bucket"),
    assunto: text("assunto"),
    /** A placa, ou a descrição do item quando não há placa. */
    entidade: text("entidade"),
    prazoPrevisto: date("prazo_previsto"),
    abertoEm: timestamp("aberto_em", { withTimezone: true }),
    encerradoEm: timestamp("encerrado_em", { withTimezone: true }),
    /** `Data Alteração` — quando a Ambev mexeu, segundo a Ambev. */
    alteradoEmFonte: timestamp("alterado_em_fonte", { withTimezone: true }),

    /**
     * NORMAL | ATENCAO | CRITICO — **derivado por nós, nunca vindo da Ambev.**
     *
     * Nenhuma das 26 colunas do export é prioridade ou criticidade. A régua
     * está em `criticidadeDoChamado` (`@workspace/comparison`), e é uma decisão
     * de produto aprovada, não um dado da fonte.
     */
    criticidade: text("criticidade").notNull().default("NORMAL"),
    /** A frase que explica o selo. Nula quando NORMAL. */
    criticidadeMotivo: text("criticidade_motivo"),
    /**
     * DERIVADA — e por enquanto é o único valor possível.
     *
     * A coluna existe para que a tela nunca precise decidir sozinha se pode
     * dizer "crítico segundo a Ambev". No dia em que a fonte passar a mandar
     * prioridade, `FONTE` entra aqui e a tela troca o rótulo sem que ninguém
     * tenha de caçar onde ela o escrevia.
     */
    criticidadeOrigem: text("criticidade_origem").notNull().default("DERIVADA"),
    atrasado: boolean("atrasado").notNull().default(false),

    /** A hora do envio que produziu a última mudança do dia. Ordena a lista. */
    movidaEm: timestamp("movida_em", { withTimezone: true }).notNull(),
    calculadaEm: timestamp("calculada_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /**
     * A identidade da movimentação.
     *
     * `serie` entra na chave porque o mesmo número de chamado pode existir em
     * duas unidades sem ser o mesmo chamado. O `COALESCE` é necessário e não
     * decorativo: um índice único trata cada `NULL` como distinto, e sem ele
     * duas movimentações do mesmo chamado da série indeterminada no mesmo dia
     * passariam a conviver — que é a duplicata que este índice existe para
     * impedir.
     */
    uniqueIndex("ticket_movement_day_grao_uq").on(
      t.dia,
      sql`(COALESCE(${t.serie},'—'))`,
      t.externalId,
    ),
    index("ticket_movement_day_classe_idx").on(t.dia, t.serie, t.classe),
    index("ticket_movement_day_unidade_idx").on(t.dia, t.serie, t.unidade),
    /**
     * A ordem padrão da lista: o mais recente do dia primeiro.
     *
     * `id` desempata de propósito. Vários chamados se movem no **mesmo**
     * instante — é o mesmo envio —, e uma ordenação só por `movida_em` deixa a
     * ordem entre eles a critério do plano de execução: a mesma linha pode
     * aparecer em duas páginas, ou em nenhuma.
     */
    index("ticket_movement_day_ordem_idx").on(t.dia, t.movidaEm, t.id),
    index("ticket_movement_day_import_idx").on(t.ultimoImportId),
    index("ticket_movement_day_primeiro_import_idx").on(t.primeiroImportId),
  ],
);

/**
 * O antes → depois de um campo. A informação central da tela.
 *
 * Tabela, e não um `jsonb` dentro da movimentação, porque "quantos prazos
 * mudaram hoje" é uma pergunta do painel: com tabela é um `count` com índice,
 * com documento é varredura desempacotando json linha a linha.
 *
 * **Um campo que sai de A, passa por B e volta a A no mesmo dia não gera linha
 * aqui.** O consolidado do dia é honesto sobre o saldo: nada mudou. As idas e
 * voltas ficam em `ticket_movement_step`, que é onde elas são verdade.
 */
export const ticketMovementFieldTable = pgTable(
  "ticket_movement_field",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => ticketMovementDayTable.id, { onDelete: "cascade" }),
    /**
     * STATUS | ENCERRAMENTO | PRAZO | RESPONSAVEL | SOLICITANTE | UNIDADE |
     * AREA | CATEGORIA | VIGENCIA | ENTIDADE | VALOR_SOLICITADO | OUTRO.
     *
     * Texto e não enum, pela mesma razão de `status_bucket` e `change_kind`: a
     * fonte inventa coluna nova sem avisar, e uma migration não pode ser
     * pré-requisito para receber um arquivo.
     */
    tipo: text("tipo").notNull(),
    /** O cabeçalho original — é ele que a tela mostra, e o que resolve `OUTRO`. */
    campo: text("campo").notNull(),
    valorAntes: text("valor_antes"),
    valorDepois: text("valor_depois"),
  },
  (t) => [
    uniqueIndex("ticket_movement_field_grao_uq").on(t.movementId, t.tipo, t.campo),
    index("ticket_movement_field_movement_idx").on(t.movementId),
    index("ticket_movement_field_tipo_idx").on(t.tipo),
  ],
);

/**
 * O encadeamento intradia — a evidência.
 *
 * Um passo por comparação que tocou aquele chamado naquele dia. É o fato bruto:
 * aconteceu, tem hora, e não se reescreve por conveniência de tela. É o que
 * mostra que o prazo foi para 03/09, voltou para 01/09 e terminou em 05/09 —
 * história que o consolidado A→D não conta, e que quem audita vai pedir.
 */
export const ticketMovementStepTable = pgTable(
  "ticket_movement_step",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => ticketMovementDayTable.id, { onDelete: "cascade" }),
    comparacaoId: uuid("comparacao_id")
      .notNull()
      .references(() => ticketImportComparacaoTable.id, { onDelete: "cascade" }),
    ordem: integer("ordem").notNull(),
    /** `received_at` do envio-alvo daquele passo. */
    ocorridoEm: timestamp("ocorrido_em", { withTimezone: true }).notNull(),
    /**
     * `[{ tipo, campo, antes, depois }]` — as diferenças **daquele passo**.
     *
     * Aqui é `jsonb` e em `ticket_movement_field` é tabela, e a diferença não é
     * inconsistência: ninguém agrega por passo. O passo é lido inteiro, por uma
     * movimentação de cada vez, quando alguém expande a linha.
     */
    diferencas: jsonb("diferencas")
      .$type<
        { tipo: string; campo: string; antes: string | null; depois: string | null }[]
      >()
      .notNull()
      .default([]),
  },
  (t) => [
    uniqueIndex("ticket_movement_step_ordem_uq").on(t.movementId, t.ordem),
    index("ticket_movement_step_movement_idx").on(t.movementId),
    index("ticket_movement_step_comparacao_idx").on(t.comparacaoId),
  ],
);

/**
 * A revisão — a única coisa aqui que não se recomputa.
 *
 * **A importação nunca escreve nesta tabela.** Quem escreve é uma rota, com a
 * sessão de quem está na tela: `revisado_por` no mesmo formato de `actor` do
 * resto do produto, e `user_id` porque a conta pode mudar de e-mail e o
 * histórico não pode ficar órfão por causa disso.
 *
 * **Revisada é a movimentação cuja revisão mais recente aponta para a `revisao`
 * atual dela.** O índice único por `(movement_id, revisao)` torna "revisar
 * duas vezes a mesma versão" um não-evento em vez de duas linhas — e é o que
 * impede a contagem de revisadas de passar do total, que é exatamente o defeito
 * que `painel-de-justificativas.ts` documenta ter evitado do outro lado.
 *
 * **Revisado por qualquer pessoa vale para a instalação inteira**, como a
 * justificativa de uma alteração de vigência. O produto tem um acervo só, e
 * "fechar o dia" é um fato da operação — não a caixa de entrada de alguém.
 */
export const ticketMovementReviewTable = pgTable(
  "ticket_movement_review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    movementId: uuid("movement_id")
      .notNull()
      .references(() => ticketMovementDayTable.id, { onDelete: "cascade" }),
    /** A versão da movimentação que foi revisada. Ver o cabeçalho. */
    revisao: integer("revisao").notNull(),
    userId: uuid("user_id").references(() => appUserTable.id, {
      onDelete: "set null",
    }),
    /** Nunca nulo: uma revisão sem autor não é auditável. */
    revisadoPor: text("revisado_por").notNull(),
    revisadoEm: timestamp("revisado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ticket_movement_review_versao_uq").on(t.movementId, t.revisao),
    index("ticket_movement_review_movement_idx").on(t.movementId),
    index("ticket_movement_review_quem_idx").on(t.revisadoPor),
  ],
);
