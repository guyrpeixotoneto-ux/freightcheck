import {
  pgTable,
  text,
  uuid,
  integer,
  bigint,
  bigserial,
  boolean,
  timestamp,
  date,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { importRunStatus, sheetRole } from "./enums";

/**
 * RAW layer — the documentary evidence.
 *
 * INVARIANT: every table in this file is append-only. UPDATE and DELETE are
 * blocked by database triggers (see migration `0001_raw_immutability`), not by
 * application convention. If the parser improves, we re-derive STAGING and
 * CANONICAL from RAW; RAW itself is never rewritten.
 */

/**
 * A file as received. Deduplicated by content hash.
 *
 * `source_file` is deliberately NOT the same thing as an import attempt, and
 * neither is the same thing as a snapshot: one file may be processed many
 * times (import_run) and may contain many vigências (snapshot).
 */
export const sourceFileTable = pgTable(
  "source_file",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    /** SHA-256 of the exact bytes received. First line of idempotency defence. */
    contentSha256: text("content_sha256").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    mimeType: text("mime_type"),
    /** Where the untouched original is preserved. Never overwritten. */
    storagePath: text("storage_path").notNull(),
    sourceSystem: text("source_system").notNull().default("FREIGHTEC"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    receivedBy: text("received_by"),
  },
  (t) => [uniqueIndex("source_file_sha256_uq").on(t.contentSha256)],
);

/**
 * One attempt at processing one file. Failed attempts are kept: "nunca
 * descarte silenciosamente" applies to our own operations too.
 */
export const importRunTable = pgTable(
  "import_run",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceFileId: uuid("source_file_id")
      .notNull()
      .references(() => sourceFileTable.id),
    status: importRunStatus("status").notNull().default("PENDING"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredBy: text("triggered_by"),
    rawSheetCount: integer("raw_sheet_count").notNull().default(0),
    rawRowCount: integer("raw_row_count").notNull().default(0),
    rawCellCount: integer("raw_cell_count").notNull().default(0),
    stagedFactCount: integer("staged_fact_count").notNull().default(0),
    errorCount: integer("error_count").notNull().default(0),
    warningCount: integer("warning_count").notNull().default(0),
    /** Populated on promotion; how many snapshots this run produced. */
    snapshotCount: integer("snapshot_count").notNull().default(0),
    failureReason: text("failure_reason"),
    /**
     * O que a aprovação fez — escrito quando ela termina, e não devolvido a
     * ninguém na hora.
     *
     * A promoção deixou de acontecer dentro da requisição: a rota responde 202
     * e o trabalho continua depois dela. O relatório que antes voltava no corpo
     * da resposta — quantas vigências entraram, quantos nós de taxonomia foram
     * garantidos, quantas semânticas aplicadas, quantos pares comparados e o
     * que ficou para trás — não tinha mais para onde ir, e sem lugar ele
     * simplesmente deixaria de existir: uma importação de três minutos
     * terminaria dizendo só "aprovada".
     *
     * Fica aqui porque é sobre **esta** tentativa, e porque é assim que ele
     * sobrevive ao fim da requisição, ao F5 e à troca de instância. `jsonb`, e
     * não colunas: é relatório de leitura, cresce com o que a promoção passar a
     * garantir, e nada decide nada a partir dele.
     */
    promotionReport: jsonb("promotion_report"),
    /**
     * Quando a aprovação começou — e nulo em todo run que não está aprovando.
     *
     * Existe porque a reserva da promoção passou a ser **comitada** antes de a
     * transação começar (ver `reservarPromocao`). Isso é o que permite
     * responder 202 e trabalhar depois; o preço é que o `ROLLBACK` já não
     * desfaz o estado PROMOTING como desfazia quando ele era escrito lá dentro.
     * Um reinício no meio da gravação deixaria o run em PROMOTING para sempre,
     * que é exatamente o beco sem saída que a `0062` fechou do lado da leitura.
     *
     * Esta coluna é o que a varredura de órfãs olha para saber há quanto tempo
     * aquela aprovação começou — e não `started_at`, que é o começo do **run**
     * e inclui a leitura e todo o tempo em que o arquivo ficou esperando
     * decisão, que pode ser de dias.
     */
    promocaoEm: timestamp("promocao_em", { withTimezone: true }),
    /**
     * Em que trecho da leitura este run está, e quanto dele já passou.
     *
     * O estado responde "em que etapa"; estas três colunas respondem "quanto
     * desta etapa". A diferença é a que existe entre a tela dizer "lendo…"
     * pelos quatro minutos inteiros de um arquivo grande — sem distinguir um
     * leitor trabalhando de um processo morto — e ela dizer 12%, 38%, 61%.
     *
     * `progress_step` é o trecho ('CAPTURA', a cópia do workbook para o RAW;
     * 'PREPARO', a tipagem linha a linha), e não o estado: os dois trechos
     * acontecem dentro de READING, e um número que subisse e voltasse a zero
     * na virada seria pior que número nenhum. Nulo quer dizer "nenhum trecho
     * medido agora" — antes de começar, e em todo estado terminal.
     *
     * `progress_total` é a estimativa que o próprio pipeline tem do tamanho
     * do trecho, em linhas de planilha, e `progress_done` é quanto ele já
     * percorreu. As duas são gravadas **durante** o trabalho, e não no fim
     * dele; são a única coisa neste esquema que descreve trabalho em curso, e
     * por isso a única que pode ser lida como desatualizada sem ser lida como
     * errada. Quem as escreve não é o caminho quente: `relatorDeProgresso`
     * (lib/ingest/src/progresso.ts) publica no máximo cerca de cem vezes por
     * trecho, porque a tela pergunta a cada 1,2 s e mais que isso seria
     * escrita paga sem leitor.
     */
    progressStep: text("progress_step"),
    progressDone: integer("progress_done").notNull().default(0),
    progressTotal: integer("progress_total").notNull().default(0),
    /**
     * O tipo que quem enviou declarou — a aba da tela em que ele escolheu.
     *
     * Nulo quer dizer "ninguém declarou", que é como toda importação anterior
     * a esta coluna entrou: o tipo saía do conteúdo, e continua saindo. O que
     * a declaração acrescenta é uma segunda resposta para a mesma pergunta, e
     * a importação compara as duas — ver `lib/ingest/src/tipos.ts`.
     */
    declaredType: text("declared_type"),
    /**
     * A família de dataset que o envio declarou — o acervo, não o tipo.
     *
     * Metade da identidade canônica da vigência (`0015`), e a metade que o tipo
     * não decide sozinho: CAVALO existe no remunerado **e** no real, e os dois
     * precisam coexistir na mesma data sem colidir. É a conta de
     * (acervo × tipo) feita no envio — `familiaDeclarada`, em
     * `lib/ingest/src/tipos.ts` — gravada uma vez e lida pela promoção.
     *
     * Nulo quer dizer "ninguém declarou", que é como todo run anterior a esta
     * coluna entrou: a família saía deduzida do `entity_type` dos fatos, e
     * continua saindo quando esta está nula.
     */
    declaredFamily: text("declared_family"),
    /**
     * A quinzena que o envio declarou — a linha da tela por onde a planilha
     * entrou.
     *
     * Guardada como a **data em que o período começa** (dia 1 ou dia 16), que é
     * a forma com que o resto do produto fala de quinzena: `snapshot.effective_date`
     * sai do rótulo por essa mesma regra (`parseVigenciaLabel`). Assim a
     * conferência é uma igualdade de datas, sem tradução no meio.
     *
     * Nula quer dizer "ninguém declarou quinzena", que é como todo envio pelo
     * campo de arquivo entra: o arquivo vale pela quinzena que o rótulo dele
     * disser, e não há o que conferir. Preenchida, a pré-visualização recusa o
     * arquivo cujo rótulo diz outra — ver `QUINZENA_DIVERGE_DA_DECLARACAO`.
     */
    declaredPeriod: date("declared_period", { mode: "string" }),
    /**
     * A granularidade que o envio declarou — `QUINZENAL` ou `MENSAL`.
     *
     * Existe porque a data não a distingue. A competência mensal de março e a
     * 1ª quinzena de março começam no mesmo dia — `2026-03-01` nas duas —, e
     * sem esta coluna um extrato mensal enviado pela linha da quinzena entraria
     * como quinzena, com a segunda metade do mês vazia e o financiamento
     * parecendo custar metade.
     *
     * Nula quer dizer "ninguém declarou", que é como todo envio anterior a esta
     * coluna entrou. E nulo **não** é o mesmo que `QUINZENAL`: naquele tempo a
     * quinzenal era a única que existia, então ela é a leitura correta de um
     * nulo — mas quem a leu assim foi a regra, e não uma pessoa. A diferença
     * entre o afirmado e o deduzido é a única coisa que esta coluna guarda.
     */
    declaredGranularity: text("declared_granularity"),
    /**
     * A competência que o envio declarou, como o primeiro dia do mês.
     *
     * É o `declared_period` do acervo Real: o extrato do ERP não traz rótulo de
     * vigência nenhum — quem diz de que mês ele é, é quem envia —, e a
     * importação confere essa declaração contra `MES`/`ANO` das linhas. Um
     * arquivo com nove competências declarado como "março" é recusado por
     * `COMPETENCIA_DIVERGE_DA_DECLARACAO`, com as nove na mensagem.
     *
     * Separada de `declared_period` porque as duas conferências são diferentes:
     * aquela é uma igualdade contra o rótulo de dentro do arquivo, esta é uma
     * conferência contra o conjunto de competências que as linhas trazem.
     */
    declaredCompetence: date("declared_competence", { mode: "string" }),
    /**
     * A unidade que o envio declarou, como CNPJ só de dígitos.
     *
     * O extrato do ERP **não traz CNPJ**: traz `UNIDADE` por extenso
     * ("TRANSFERÊNCIA URBANA - EMPURRADA") e `CODUNN`. E o escopo UNIDADE é o
     * que fecha a identidade de uma vigência — sem ele, duas unidades
     * diferentes teriam a mesma chave, e a promoção recusa (com razão) por
     * `ESCOPO_OBRIGATORIO_AUSENTE`.
     *
     * Quem sabe o CNPJ é quem envia, escolhendo a unidade do cadastro na hora
     * do envio — a mesma autoridade da `0094`, ato explícito de uma pessoa, e
     * não uma heurística sobre o texto do arquivo. O que o arquivo diz continua
     * inteiro em `raw_cell` e vira a evidência contra a qual a declaração é
     * conferida: um extrato cujo `CODUNN` não bate com a unidade escolhida é
     * recusado antes de qualquer fato entrar.
     *
     * Nula em todo envio que não precisa dela — o export de remuneração traz a
     * coluna `Unidade - CNPJ` em cada linha, e ali o escopo sai do próprio
     * arquivo, como sempre saiu.
     */
    declaredUnidade: text("declared_unidade"),
    /**
     * A unidade **aberta na lateral** no momento do envio — a escolha explícita
     * de quem importou, guardada como `unidade.id`.
     *
     * **Não é `declared_unidade`, e a diferença não é de forma.** Aquela é o
     * CNPJ que o envio do acervo Real precisa fornecer porque o extrato do ERP
     * não o traz: ela *supre* o escopo que falta no arquivo. Esta é a
     * declaração no sentido de `declared_type` e `declared_period` — o que a
     * pessoa afirmou, guardado para ser **conferido** contra o que o arquivo
     * diz. Um envio pode ter as duas, e elas respondem perguntas diferentes.
     *
     * Duas coisas saem daqui, e são as duas metades do mesmo ato:
     *
     * - a **conferência**: um arquivo cujo escopo não é o da unidade aberta é
     *   recusado antes de promover (`UNIDADE_DIVERGE_DA_DECLARACAO`), em vez de
     *   entrar calado sob o nome errado;
     * - a **identidade**: o escopo cujo código não carrega documento nenhum —
     *   `443`, `CDD Belém` — ganha a unidade daqui. O arquivo não identifica;
     *   quem estava na tela identifica, e a escolha dela é o que prevalece.
     *
     * Nula quando o envio saiu da Visão Geral, quando o acervo aberto não tem
     * unidade na lateral, e em todo envio anterior a esta coluna. Nula quer
     * dizer "ninguém declarou", e aí o arquivo decide sozinho pelo CNPJ que ele
     * traz — que é como sempre foi.
     */
    unidadeId: uuid("unidade_id"),
    /**
     * O run que este aqui releu — nulo em toda importação que é a primeira
     * leitura do seu arquivo.
     *
     * Reprocessar é reler um `source_file` que já entrou, porque o leitor mudou
     * desde a primeira vez. O run novo não substitui o antigo nem o apaga: ele
     * aponta para ele. É isso que permite a tela dizer "esta é uma releitura
     * daquela de 18/08" em vez de mostrar dois recebimentos do mesmo arquivo
     * como se fossem coincidência.
     */
    reprocessOfRunId: uuid("reprocess_of_run_id"),
    /**
     * Por que se releu — obrigatório para quem aponta, e conferido pelo banco
     * (`import_run_reprocess_completo`).
     *
     * Um reprocessamento contorna de propósito a defesa que impede o mesmo
     * arquivo de entrar duas vezes. A frase é o que separa isso de um clique a
     * mais: quem pede tem de saber o que mudou desde a primeira leitura, e
     * quem ler o histórico daqui a três meses tem de encontrar essa resposta
     * sem precisar reconstituir a data de um commit.
     *
     * **É esta coluna, e não o ponteiro, que diz "isto é uma releitura".** O
     * ponteiro pode ficar nulo quando a leitura relida é excluída — o que é
     * legítimo, e é o passo final de corrigir um arquivo que entrou sob o tipo
     * errado. A razão sobrevive, porque ela é o fato de auditoria.
     */
    reprocessReason: text("reprocess_reason"),
    /**
     * Quando não-nulo, este run — e todos os fatos de todas as suas
     * vigências — fica de fora de todo agregado (dashboard, comparativo,
     * cobertura, DRE...). Reversível: `NULL` de novo mostra tudo outra vez.
     *
     * Não é exclusão nem é revisão. `import_deletion` (ver `deletion.ts`)
     * apaga de verdade; `snapshot.status = SUPERSEDED` diz "uma revisão mais
     * nova existe". Ocultar não é nenhum dos dois — o dado continua o mesmo,
     * só para de contar enquanto quem importou está com outro arquivo em
     * mãos.
     */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    hiddenBy: text("hidden_by"),
    hiddenReason: text("hidden_reason"),
  },
  (t) => [
    index("import_run_source_file_idx").on(t.sourceFileId),
    index("import_run_hidden_at_idx")
      .on(t.id)
      .where(sql`${t.hiddenAt} IS NOT NULL`),
    /**
     * No máximo um run por decidir por arquivo — a trava contra o
     * reprocessamento repetido, decidida pelo banco e não por um SELECT antes
     * do INSERT. Ver `0040_reprocessamento.sql`; os estados terminais ficam de
     * fora porque é sobre eles que se reprocessa.
     */
    uniqueIndex("import_run_leitura_aberta_uq")
      .on(t.sourceFileId)
      .where(
        sql`${t.status} IN ('PENDING', 'READING', 'STAGED', 'PREVIEWED', 'PROMOTING')`,
      ),
  ],
);

/**
 * O pedido de parar uma importação — numa tabela sua, e a tabela é a decisão.
 *
 * ---------------------------------------------------------------------------
 * Por que não é uma coluna de `import_run`
 * ---------------------------------------------------------------------------
 * Seria o lugar óbvio, e é o lugar errado. A aprovação roda dentro de uma
 * transação que começa travando a própria linha do run (`SELECT … FOR UPDATE`,
 * em `promote`): enquanto ela corre, todo `UPDATE import_run` sobre aquela
 * linha **espera** a transação acabar. Uma bandeira de cancelamento gravada ali
 * ficaria presa atrás exatamente do trabalho que ela existe para interromper —
 * o pedido esperaria o fim da promoção para ser escrito, e a promoção esperaria
 * o pedido para saber que devia parar. Parar não pode depender de terminar.
 *
 * Aqui a escrita é noutra linha, noutra tabela, e não disputa lock nenhum com a
 * promoção: quem cancela grava na hora, e quem trabalha lê a cada publicação de
 * progresso — que já era uma ida ao banco, e agora volta com a resposta.
 *
 * ---------------------------------------------------------------------------
 * Uma linha por run, e ela não some
 * ---------------------------------------------------------------------------
 * O pedido é o registro de quem desistiu, quando e por quê, e sobrevive ao
 * desfecho: o run vai a `CANCELLED` e esta linha continua explicando quem
 * apertou. Chegar tarde é caso normal e não é erro — o trabalho pode ter
 * terminado entre o clique e a escrita —, e é por isso que o pedido é
 * `atendido_em` nulo até alguém de fato parar por causa dele.
 */
export const importCancelamentoTable = pgTable("import_cancelamento", {
  importRunId: uuid("import_run_id")
    .primaryKey()
    .references(() => importRunTable.id, { onDelete: "cascade" }),
  pedidoEm: timestamp("pedido_em", { withTimezone: true }).notNull().defaultNow(),
  pedidoPor: text("pedido_por"),
  /** Nulo: parar não exige justificativa como excluir exige — nada sai do acervo. */
  motivo: text("motivo"),
  /**
   * Quando o trabalho de fato parou por causa deste pedido.
   *
   * Nulo é "pedido feito, ainda não atendido" — inclusive para sempre, quando o
   * trabalho acabou antes de o pedido ser lido. Distinguir os dois é o que
   * permite a tela dizer "não deu tempo: a importação terminou" em vez de
   * mostrar um cancelamento que não cancelou nada.
   */
  atendidoEm: timestamp("atendido_em", { withTimezone: true }),
});

/**
 * A worksheet inside the file. Pivot tables are captured in RAW like
 * everything else — they are evidence — but `role` keeps them out of the
 * canonical fact stream.
 */
export const rawSheetTable = pgTable(
  "raw_sheet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id),
    sheetName: text("sheet_name").notNull(),
    sheetIndex: integer("sheet_index").notNull(),
    rowCount: integer("row_count").notNull(),
    columnCount: integer("column_count").notNull(),
    role: sheetRole("role").notNull(),
    /** Why the classifier decided this role. Auditable, never a bare guess. */
    roleReason: text("role_reason").notNull(),
    headerRowIndex: integer("header_row_index"),
  },
  (t) => [
    uniqueIndex("raw_sheet_run_index_uq").on(t.importRunId, t.sheetIndex),
    index("raw_sheet_run_idx").on(t.importRunId),
  ],
);

export const rawRowTable = pgTable(
  "raw_row",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rawSheetId: uuid("raw_sheet_id")
      .notNull()
      .references(() => rawSheetTable.id),
    /** 1-based physical row number in the worksheet, as a human would count it. */
    rowIndex: integer("row_index").notNull(),
    isHeader: boolean("is_header").notNull().default(false),
  },
  (t) => [uniqueIndex("raw_row_sheet_index_uq").on(t.rawSheetId, t.rowIndex)],
);

/**
 * The end of the traceability chain. Every canonical number must be able to
 * point at exactly one of these rows.
 */
export const rawCellTable = pgTable(
  "raw_cell",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    rawRowId: bigint("raw_row_id", { mode: "number" })
      .notNull()
      .references(() => rawRowTable.id),
    /** 0-based position, and the spreadsheet letter, so a human can find it. */
    columnIndex: integer("column_index").notNull(),
    columnLetter: text("column_letter").notNull(),
    /** Header text exactly as it appears in the file — never normalised. */
    columnHeader: text("column_header"),
    /** The value as text, always. Typing happens in STAGING, not here. */
    rawValue: text("raw_value"),
    /**
     * SheetJS cell type as delivered: n | s | b | d | e | z.
     * Kept because the file mixes representations for the same concept
     * (e.g. dates arriving both as `d` and as a bare `n` serial).
     */
    sourceType: text("source_type").notNull(),
    /** Excel's own formatted text, when present. Useful for date forensics. */
    formattedText: text("formatted_text"),
  },
  (t) => [
    uniqueIndex("raw_cell_row_column_uq").on(t.rawRowId, t.columnIndex),
    index("raw_cell_row_idx").on(t.rawRowId),
  ],
);

/**
 * Por que o pipeline decidiu o que decidiu, uma linha por decisão.
 *
 * Existe para que "por que esse arquivo não entrou?" tenha resposta sem ler
 * log. A recusa por duplicata é o caso que mais precisa disso: ela é
 * silenciosa por natureza — nada muda no banco canônico —, e sem registro o
 * operador só vê que o número dele não apareceu.
 *
 * Guarda o que sustentou a decisão: o arquivo e seu SHA-256, o hash canônico do
 * conteúdo, a identidade calculada, a vigência, o escopo, a família, e qual
 * revisão foi encontrada ou criada. `ON DELETE CASCADE` acompanha a exclusão do
 * run: a auditoria de uma importação apagada vive em `import_deletion`, que é
 * permanente, e não aqui.
 */
export const importDecisionTable = pgTable(
  "import_decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id, { onDelete: "cascade" }),
    /**
     * RECEBIDO | DUPLICATA_DE_ARQUIVO | DUPLICATA_DE_DADOS |
     * VIGENCIA_ATIVA_EXISTENTE | ESCOPO_OBRIGATORIO_AUSENTE |
     * ENTIDADE_CONFLITANTE | PROMOVIDO | REVISAO_CRIADA
     *
     * Texto e não enum: uma decisão nova não deve exigir migration.
     */
    decisao: text("decisao").notNull(),
    /** A frase que vai para a tela, escrita para quem opera. */
    motivo: text("motivo").notNull(),
    filename: text("filename"),
    contentSha256: text("content_sha256"),
    canonicalPayloadHash: text("canonical_payload_hash"),
    canonicalSnapshotKey: text("canonical_snapshot_key"),
    sourceLabel: text("source_label"),
    effectiveDate: date("effective_date", { mode: "string" }),
    canal: text("canal"),
    datasetFamily: text("dataset_family"),
    canonicalScope: jsonb("canonical_scope"),
    snapshotId: uuid("snapshot_id"),
    revisionEncontrada: integer("revision_encontrada"),
    revisionCriada: integer("revision_criada"),
    detalhe: jsonb("detalhe"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("import_decision_run_idx").on(t.importRunId),
    index("import_decision_key_idx").on(t.canonicalSnapshotKey),
    index("import_decision_sha_idx").on(t.contentSha256),
  ],
);

/**
 * O censo de destinos de uma importação — quantas células foram parar em cada
 * destino declarado por `lib/balance/src/destinos.ts`.
 *
 * Uma linha por (importação, destino), gravada uma vez, quando a importação
 * termina de preparar. Não é cache: depois de `stage()` nenhuma entrada da
 * classificação muda mais — o RAW é imutável por trigger e nada apaga
 * `staged_fact`, `column_mapping` ou as recusas de linha. O raciocínio inteiro,
 * com o que invalida e o que não invalida, está no cabeçalho de
 * `lib/balance/src/censo.ts`.
 *
 * `ON DELETE CASCADE` é o que faz excluir uma importação levar o censo dela
 * junto — a exclusão é a única operação do produto que apaga RAW, e um censo
 * sobrevivente descreveria células que não existem mais.
 */
export const importRunCensoTable = pgTable(
  "import_run_censo",
  {
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id, { onDelete: "cascade" }),
    /** O código do destino. Texto, e não enum: a lista mora em `destinos.ts`. */
    destino: text("destino").notNull(),
    celulas: integer("celulas").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.importRunId, t.destino] }),
  ],
);
