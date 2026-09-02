import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  numeric,
  jsonb,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ticketImportStatus } from "./enums";

/**
 * CHAMADOS — o outro caminho pelo qual a remuneração muda.
 *
 * A planilha de vigência é o estado do cadastro num dia: comparar duas diz o
 * que a Ambev mexeu entre elas, e é disso que a aba Planilha vive. O chamado é
 * a outra metade da história — o pedido aberto no Freightech, o que se pediu,
 * o que voltou aplicado, e quanto tempo ficou parado. Um e outro respondem
 * perguntas diferentes sobre o mesmo dinheiro, e é por isso que moram em
 * tabelas separadas em vez de virarem linhas do mesmo `change`.
 *
 * **Por que não entram como `change`.** Uma linha de `change` é sempre uma
 * diferença apurada entre duas vigências fechadas, com as duas pontas
 * rastreáveis até a célula de origem. Um chamado não tem isso: ele tem um
 * pedido e uma resposta, os dois declarados pela própria fonte, sem
 * contraprova. Misturá-los faria a soma de impacto da tela deixar de fechar
 * com a comparação — que é exatamente a propriedade que este produto existe
 * para preservar.
 *
 * **A linha original fica.** `payload` guarda a linha inteira do arquivo, com
 * os cabeçalhos como vieram. O mapeamento de colunas é um palpite justificado
 * (ver `lib/ingest/src/chamados.ts`), e um palpite que descarta a evidência
 * não pode ser corrigido depois.
 *
 * **Duas tabelas, e não uma.** O export de chamados vem no mesmo formato largo
 * da planilha de vigência: uma linha por chamado, e dezenas de colunas de
 * parâmetro de remuneração ao lado. Guardar isso como uma linha só obrigaria a
 * escolher *um* parâmetro por chamado — e um chamado que mexe em oito
 * parâmetros perderia sete. Por isso a linha larga é desdobrada: `ticket` é o
 * chamado (quem abriu, quando, em que situação), e `ticket_change` é uma linha
 * por parâmetro que veio preenchido nele.
 */

/**
 * Um envio de export de chamados.
 *
 * Não é `import_run`, e a diferença é proposital: `import_run` é a máquina de
 * estados da planilha de vigência — RAW, staging, preview, promoção —, e todo
 * o pipeline de imutabilidade da `0001` está amarrado nela. Chamados não
 * produzem vigência nem fato canônico; ler o arquivo é o passo inteiro, e não
 * existe decisão humana no meio para justificar um portão de aprovação.
 */
export const ticketImportTable = pgTable(
  "ticket_import",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    /** SHA-256 dos bytes exatos recebidos. O mesmo arquivo não entra duas vezes. */
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    /** Onde o original ficou. Pode não existir mais; a evidência é `payload`. */
    storagePath: text("storage_path"),
    sourceSystem: text("source_system").notNull().default("FREIGHTEC"),
    status: ticketImportStatus("status").notNull().default("PENDING"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedBy: text("received_by"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Linhas de dados que o arquivo trazia, cabeçalho fora. */
    rowCount: integer("row_count").notNull().default(0),
    /** Quantas viraram chamado. A diferença para `row_count` é `ignoredRowCount`. */
    ticketCount: integer("ticket_count").notNull().default(0),
    /** Linhas em branco ou sem número de chamado — contadas, nunca silenciadas. */
    ignoredRowCount: integer("ignored_row_count").notNull().default(0),
    /**
     * Que coluna do arquivo virou que campo nosso, e por quê.
     * `{ campo: { header, reason } }` — é o que a tela mostra quando alguém
     * pergunta de onde saiu "valor pedido".
     */
    columnMapping: jsonb("column_mapping").notNull().default({}),
    /** Cabeçalhos que não reconhecemos. Ficam em `payload`, e aparecem aqui. */
    unmappedColumns: jsonb("unmapped_columns").notNull().default([]),
    /**
     * As colunas lidas como parâmetro de remuneração, nomeadas.
     *
     * No formato largo elas são a maioria do arquivo, e quem confere o import
     * precisa vê-las: "reconheci 47 parâmetros" sem dizer quais é um número
     * sem lastro, e é justamente aqui que um cabeçalho lido errado apareceria.
     */
    parameterColumns: jsonb("parameter_columns").notNull().default([]),
    failureReason: text("failure_reason"),

    /**
     * A partição dentro da qual dois envios são comparáveis — a unidade.
     *
     * O arquivo real chama-se `Chamados_<unidade>.xlsx`, e dois envios do mesmo
     * dia costumam ser **unidades diferentes**, não reenvios da mesma fila.
     * Comparar Recife com Camaçari produziria "todos os chamados de Recife
     * sumiram e 380 novos apareceram" — movimentação falsa em massa, e a
     * primeira coisa que faria o gestor deixar de confiar na tela.
     *
     * `NULL` é legítimo e quer dizer **série indeterminada**, não "compara com
     * qualquer um": o motor a trata como uma série própria. Comparar às cegas é
     * exatamente o defeito que esta coluna existe para impedir.
     */
    serie: text("serie"),
    /**
     * De onde a série foi lida — porque a confiança nas duas não é a mesma.
     *
     * ARQUIVO         — a coluna `Unidade` das linhas, todas concordando. É a
     *                   fonte preferida: sobrevive a alguém renomear o arquivo.
     * NOME_DO_ARQUIVO — o `Chamados_<unidade>.xlsx`, quando a coluna não veio.
     * MISTA           — as linhas nomeiam mais de uma unidade; a comparação é
     *                   feita por (unidade, número do chamado), linha a linha.
     * INDETERMINADA   — nenhuma das duas disse nada.
     */
    serieOrigem: text("serie_origem"),
  },
  (t) => [
    index("ticket_import_sha256_idx").on(t.contentSha256),
    index("ticket_import_received_idx").on(t.receivedAt),
    /** A busca do envio anterior da mesma série — a primeira consulta do diff. */
    index("ticket_import_serie_idx").on(t.serie, t.receivedAt),
  ],
);

/**
 * O chamado: quem abriu, quando, em que situação, sobre que ativo.
 *
 * Nada de valor de parâmetro aqui — isso é de `ticket_change`, uma linha por
 * parâmetro. O que fica nesta tabela é o que vale para o chamado inteiro,
 * qualquer que seja o número de parâmetros que ele carregue.
 */
export const ticketTable = pgTable(
  "ticket",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketImportId: uuid("ticket_import_id")
      .notNull()
      .references(() => ticketImportTable.id),
    /** O número do chamado no Freightech, como veio. */
    externalId: text("external_id").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** O status como o arquivo escreveu — "Em atendimento", "Concluído", … */
    statusRaw: text("status_raw"),
    /**
     * O mesmo status dobrado numa das seis caixas que a tela filtra.
     * ABERTO | EM_ANDAMENTO | ATENDIDO | RECUSADO | CANCELADO | DESCONHECIDO.
     * É `text` e não enum porque a fonte inventa status novo sem avisar, e uma
     * migration não pode ser pré-requisito para receber um arquivo.
     */
    statusBucket: text("status_bucket").notNull().default("DESCONHECIDO"),
    /** A placa, quando o chamado é de um ativo específico. */
    entityLabel: text("entity_label"),
    entityType: text("entity_type"),
    /**
     * O ativo como o arquivo o descreve, inteiro.
     *
     * A coluna `Item` do export traz `Placa: QYW2D78 | Placa Carreta: QYW4C69`
     * numas linhas e `Cargo: Manobrista | Classificação: …` noutras. A placa é
     * extraída para `entityLabel`, que é o que casa com o canônico; o texto
     * inteiro fica aqui, porque nas linhas de cargo ele é a única identificação
     * que existe.
     */
    entityDescription: text("entity_description"),
    /**
     * A vigência que o próprio chamado nomeia (`Vig. Abertura`).
     *
     * Casa com `snapshot.source_label`, e é melhor do que qualquer heurística
     * nossa para achar o valor anterior de um parâmetro: em vez de "a vigência
     * mais recente", a que o chamado diz que é.
     */
    vigenciaLabel: text("vigencia_label"),
    requestedBy: text("requested_by"),
    /** Texto livre do chamado — assunto, descrição, o que a fonte trouxer. */
    subject: text("subject"),

    /*
      -----------------------------------------------------------------------
      As colunas que já estavam em `payload`, promovidas pela `0087`
      -----------------------------------------------------------------------

      O export real tem 26 cabeçalhos e este leitor promovia 12. Os outros 14
      nunca se perderam — `payload` guarda a linha inteira com os nomes
      originais —, mas ficar só lá tem um custo que só apareceu quando o
      Monitoramento de Chamados foi desenhado: não dá para filtrar por unidade,
      nem dizer "o responsável mudou", nem agrupar o dia por unidade, sem
      desempacotar um documento linha a linha.

      Por isso a `0087` as promove **e faz o backfill a partir do próprio
      `payload`** — nenhum arquivo precisou ser reimportado.

      O sufixo `_raw` é o mesmo de `status_raw`, e quer dizer a mesma coisa:
      isto é o que a Ambev escreveu. `unidade_raw` **não** é a `unidade`
      canônica de `schema/unidade.ts` — casar as duas é cadastro, ato de gente,
      e a `0049` documenta por que derivar identidade de arquivo é o desenho
      errado. O Monitoramento agrupa pelo texto porque é o que ele tem, e diz
      na tela que é o texto do arquivo.
    */
    /** `Unidade` — o recorte por que o Monitoramento particiona as séries. */
    unidadeRaw: text("unidade_raw"),
    /** `Segmento` — o que a tela chama de Área. */
    segmentoRaw: text("segmento_raw"),
    /** `Operador` — quem toca o chamado do lado da Ambev. */
    operadorRaw: text("operador_raw"),
    /** `Aprovador` — quem decide. É o "Responsável" do Monitoramento. */
    aprovadorRaw: text("aprovador_raw"),
    /**
     * `SLA` — como a fonte escreveu, sem interpretação.
     *
     * Não vira data e não vira número: num export real ela aparece ora como
     * prazo em dias, ora como um rótulo de acordo. Interpretá-la sem saber qual
     * das duas é seria inventar um prazo. O prazo do Monitoramento é
     * `prazoPrevisto`, que é data.
     */
    slaRaw: text("sla_raw"),
    /** `Categoria` — o assunto que a Ambev dá ao chamado. */
    categoriaRaw: text("categoria_raw"),
    /** `Previsão Análise` — a data que o Monitoramento chama de prazo. */
    prazoPrevisto: date("prazo_previsto"),
    /**
     * `Data Alteração` — quando a **Ambev** mexeu.
     *
     * Não é `openedAt` (quando o chamado nasceu) nem `ticketImport.receivedAt`
     * (quando **nós** lemos o arquivo). As três convivem porque são três
     * perguntas diferentes, e confundi-las é o defeito que o Monitoramento
     * existe para não cometer.
     */
    alteradoEmFonte: timestamp("alterado_em_fonte", { withTimezone: true }),
    /** Quantos parâmetros vieram preenchidos neste chamado. */
    changedParameterCount: integer("changed_parameter_count")
      .notNull()
      .default(0),
    /** Linha física do arquivo, 1-based, como uma pessoa a contaria. */
    sourceRowIndex: integer("source_row_index").notNull(),
    /** A linha inteira como veio, cabeçalho original por chave. */
    payload: jsonb("payload").notNull().default({}),
  },
  (t) => [
    uniqueIndex("ticket_import_row_uq").on(t.ticketImportId, t.sourceRowIndex),
    index("ticket_import_idx").on(t.ticketImportId),
    index("ticket_external_id_idx").on(t.externalId),
    index("ticket_status_bucket_idx").on(t.statusBucket),
    index("ticket_vigencia_idx").on(t.vigenciaLabel),
    /**
     * A junção do diff: os chamados de um envio, pelo número.
     *
     * `ticket_external_id_idx` sozinho não serve — ele varre o número em todos
     * os envios que já entraram, e a comparação quer os de **um**. Sem este par
     * a comparação é varredura sequencial nos dois lados.
     */
    index("ticket_import_external_idx").on(t.ticketImportId, t.externalId),
    index("ticket_unidade_idx").on(t.unidadeRaw),
  ],
);

/**
 * Um parâmetro de remuneração mexido por um chamado.
 *
 * É a unidade que a aba Chamados lista, e o paralelo direto de `change` na aba
 * Planilha: parâmetro, antes, agora, variação, impacto. A diferença está em
 * **de onde vem o "antes"**, e é por isso que `beforeSource` existe.
 *
 * O arquivo pode trazer o valor anterior ao lado do novo (colunas em par:
 * "Pedágio (antes)" e "Pedágio (novo)"), e aí o antes é do próprio documento.
 * Quando ele traz só o valor novo — que é o caso comum —, o antes é buscado na
 * vigência em vigor para aquela placa e aquele parâmetro. São duas
 * procedências com força de prova diferente, e a tela precisa poder dizer qual
 * está mostrando; guardá-las na mesma coluna sem marcar a origem seria
 * apresentar um valor inferido com a mesma cara de um declarado.
 */
export const ticketChangeTable = pgTable(
  "ticket_change",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => ticketTable.id),
    /** Repetido do chamado para que filtrar por envio não precise de junção. */
    ticketImportId: uuid("ticket_import_id")
      .notNull()
      .references(() => ticketImportTable.id),
    /** O nome do parâmetro como o cabeçalho do arquivo o escreveu. */
    parameterLabel: text("parameter_label").notNull(),
    /** O mesmo parâmetro resolvido no dicionário, quando reconhecido. */
    attributeCode: text("attribute_code"),
    /** Copiados do chamado: filtrar por placa não deve exigir junção. */
    entityLabel: text("entity_label"),
    entityType: text("entity_type"),

    valueBeforeRaw: text("value_before_raw"),
    valueBeforeNumeric: numeric("value_before_numeric", {
      precision: 18,
      scale: 6,
    }),
    valueAfterRaw: text("value_after_raw"),
    valueAfterNumeric: numeric("value_after_numeric", {
      precision: 18,
      scale: 6,
    }),
    /**
     * ARQUIVO   — o próprio chamado trouxe o valor anterior.
     * VIGENCIA  — veio da vigência em vigor; `beforeReference` diz qual.
     * AUSENTE   — não há antes, e `impactReason` diz por quê.
     */
    beforeSource: text("before_source").notNull().default("AUSENTE"),
    /** O rótulo da vigência de onde o antes saiu, quando saiu de uma. */
    beforeReference: text("before_reference"),

    /** A variação pedida. Existe mesmo com o chamado ainda aberto. */
    deltaAbsolute: numeric("delta_absolute", { precision: 18, scale: 6 }),
    deltaPercent: numeric("delta_percent", { precision: 12, scale: 6 }),
    /**
     * A variação já aplicada. Só existe com o chamado atendido — enquanto ele
     * corre, o valor ainda pode mudar, e um número que se altera sozinho na
     * tela é pior do que nenhum.
     */
    impactAmount: numeric("impact_amount", { precision: 18, scale: 6 }),
    /** CALCULATED | NOT_CALCULABLE — a mesma porta que a aba Planilha usa. */
    impactConfidence: text("impact_confidence")
      .notNull()
      .default("NOT_CALCULABLE"),
    /** Por que não deu para apurar. Escrito para quem opera, nunca vazio à toa. */
    impactReason: text("impact_reason"),
    /**
     * O que o chamado fez com o parâmetro: SET | ADD | FORM_THIS | …
     *
     * É a coluna `Operação` do export, e ela explica a maior parte da tabela:
     * num export real, 96% das alterações não têm valor nenhum porque não são
     * `SET` — são troca de fórmula ou inclusão de item, que mudam a
     * remuneração sem que exista "de 10 para 12" para mostrar. Sem este campo,
     * essas linhas apareceriam com as colunas de valor vazias e sem explicação,
     * e quem lê concluiria que o dado se perdeu.
     *
     * Texto, e não enum: é vocabulário do Freightech, que inventa operação nova
     * sem avisar — e uma migration não pode ser pré-requisito para receber um
     * arquivo.
     */
    changeKind: text("change_kind"),
    /** Coluna física do arquivo, 0-based — a origem desta linha. */
    sourceColumnIndex: integer("source_column_index").notNull(),
  },
  (t) => [
    uniqueIndex("ticket_change_grain_uq").on(t.ticketId, t.parameterLabel),
    index("ticket_change_import_idx").on(t.ticketImportId),
    index("ticket_change_ticket_idx").on(t.ticketId),
    index("ticket_change_attribute_idx").on(t.attributeCode),
    index("ticket_change_parameter_idx").on(t.parameterLabel),
    index("ticket_change_kind_idx").on(t.changeKind),
  ],
);
