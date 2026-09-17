import {
  bigint,
  bigserial,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { factTable, snapshotTable } from "./canonical";
import { importRunTable, rawRowTable } from "./raw";

/**
 * O FINANCIAMENTO REAL — o extrato do banco, lançamento a lançamento.
 *
 * ---------------------------------------------------------------------------
 * Por que existe uma tabela aqui, se o consolidado vai para `fact`
 * ---------------------------------------------------------------------------
 * O número que a auditoria mostra é um fato como qualquer outro: mora em
 * `fact`, no grão (snapshot, entidade, atributo), e com isso herda tudo o que o
 * produto já sabe fazer — rastreio, revisão, exclusão de importação, presença,
 * imutabilidade por gatilho, e o mesmo motor de comparação. Duplicar esse
 * caminho numa tabela paralela seria construir um segundo produto ao lado do
 * primeiro, livre para discordar dele no primeiro mês.
 *
 * O que `fact` **não** sabe guardar é o caminho entre o extrato e esse número.
 * Um valor consolidado de março nasce de um, dois ou três lançamentos, cada um
 * com o seu documento, a sua filial e a sua data de escrituração; o fato é um
 * só, e `fact.raw_cell_id` aponta para uma célula só. É essa distância que esta
 * tabela cobre: **uma linha por linha da planilha**, com o documento contábil
 * inteiro e o `raw_row_id` que leva de volta à célula original.
 *
 * A consequência prática é a que o produto exige de todo número que ele mostra:
 * clicar no realizado de março de uma placa e ver os três lançamentos que o
 * compõem, com NUMDOC, filial, conta e data — e não uma soma sem origem.
 *
 * ---------------------------------------------------------------------------
 * A célula âncora, e por que `fact.raw_cell_id` continua `NOT NULL`
 * ---------------------------------------------------------------------------
 * A `0061` provou que todo fato tem origem e fechou aquela coluna como
 * obrigatória. Um consolidado de três lançamentos tem três origens, e a saída
 * fácil seria afrouxar a coluna — desfazer uma garantia do banco inteiro para
 * acomodar um caso.
 *
 * Não é o que se faz aqui. O fato aponta para a célula `VLRREA` da **linha
 * âncora** — a de menor `row_index` entre as aceitas do grupo, regra escrita e
 * testada —, e a rastreabilidade completa vive nesta tabela, onde ela é
 * verdade: `fact_id` repetido em quantas linhas o grupo tiver. A âncora é uma
 * entrada para o grupo, não uma afirmação de que o fato veio só dela.
 *
 * ---------------------------------------------------------------------------
 * Derivada, e por isso descartável
 * ---------------------------------------------------------------------------
 * Nada aqui é decisão de gente: cada linha é a leitura de uma linha de planilha
 * que continua inteira em `raw_cell`, e reimportar o mesmo arquivo reconstrói
 * esta tabela idêntica — a agregação é função pura das linhas aceitas. Por isso
 * ela entra em `TABELAS_DESCARTAVEIS` no bridge, ao lado do censo e da
 * presença, e não entre as que exigem estar vazias.
 *
 * O que **é** decisão de gente mora em {@link financiamentoRealDecisaoTable},
 * separada exatamente por isso.
 */
export const finameRealLancamentoTable = pgTable(
  "finame_real_lancamento",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importRunId: uuid("import_run_id")
      .notNull()
      .references(() => importRunTable.id, { onDelete: "cascade" }),
    /** A linha da planilha de onde este lançamento saiu. O fim do rastreio. */
    rawRowId: bigint("raw_row_id", { mode: "number" })
      .notNull()
      .references(() => rawRowTable.id, { onDelete: "cascade" }),
    /**
     * A vigência mensal em que este lançamento foi consolidado.
     *
     * Nulo enquanto a importação não promoveu, e nulo para sempre no lançamento
     * que não entrou em consolidado nenhum — a duplicata provável e a placa sem
     * classificação. Nos dois casos a linha continua aqui, com o motivo escrito:
     * é a diferença entre "ficou de fora" e "sumiu".
     */
    snapshotId: uuid("snapshot_id").references(() => snapshotTable.id),
    /** O fato consolidado que esta linha compõe. Nulo pelas mesmas razões. */
    factId: bigint("fact_id", { mode: "number" }).references(() => factTable.id),

    /** A competência, sempre o primeiro dia do mês: `MES` + `ANO` das linhas. */
    competencia: date("competencia", { mode: "string" }).notNull(),
    /** A placa normalizada — maiúscula, sem hífen. É ela que casa com o acervo. */
    placa: text("placa").notNull(),
    /** A placa como o arquivo a escreveu, com hífen e tudo. Nunca normalizada. */
    placaRaw: text("placa_raw").notNull(),
    /**
     * O tipo de ativo, quando o cadastro canônico o resolveu.
     *
     * Nulo é a fila de classificação: a placa não foi encontrada no acervo nem
     * no cadastro, e o tipo **não é inventado** a partir da conta contábil. Ver
     * o status `PENDENTE_DE_CLASSIFICACAO`.
     */
    entityType: text("entity_type"),
    /** A entidade do acervo — a mesma placa do remunerado, por desenho. */
    entityId: uuid("entity_id"),

    /* --- O documento contábil, como o ERP o escreve --------------------- */
    numdoc: text("numdoc").notNull(),
    codfil: text("codfil"),
    serie: text("serie"),
    tipdoc: text("tipdoc"),
    /** `ANALIT` + `ANALITICA`: "61" / "C.D.C. - VP". A conta, preservada. */
    contaAnalitica: text("conta_analitica"),
    contaAnaliticaCodigo: text("conta_analitica_codigo"),
    contaSintetica: text("conta_sintetica"),
    contaSinteticaCodigo: text("conta_sintetica_codigo"),
    /** `OBSERVACAO` — o código interno do veículo no ERP. */
    codvei: text("codvei"),
    /** `DATATU` — a escrituração. É o que distingue duas linhas iguais no resto. */
    datatu: timestamp("datatu", { withTimezone: false }),
    situac: text("situac"),

    /* --- O valor, nas duas formas -------------------------------------- */
    /**
     * A despesa em positivo — a forma com que ela é apresentada e comparada.
     *
     * O extrato traz `VLRREA` negativo porque é um débito, e o remunerado é
     * positivo. Comparar os dois sem inverter faria a auditoria acusar uma
     * variação de duas vezes o valor em toda a frota.
     */
    valorAbsoluto: numeric("valor_absoluto", { precision: 18, scale: 6 }).notNull(),
    /**
     * `VLRREA` exatamente como veio, com o sinal.
     *
     * Guardado ao lado do outro porque inverter um sinal é uma interpretação, e
     * interpretação neste produto nunca substitui o dado: a reconciliação
     * contra o extrato de origem se faz por este campo.
     */
    valorOriginal: numeric("valor_original", { precision: 18, scale: 6 }).notNull(),

    /* --- Classificação -------------------------------------------------- */
    /**
     * A rubrica que este lançamento alimenta — hoje, `finame_real`.
     *
     * Existe como coluna, e não como constante no código, porque a conta
     * analítica do extrato já distingue três coisas (`C.D.C. - VP`,
     * `C.D.C. - FL`, `FINANCIAMENTO INTERNO - VP`) e nada garante que elas
     * sigam para sempre na mesma rubrica de auditoria.
     */
    rubrica: text("rubrica").notNull(),
    /**
     * A chave contábil: o que faz duas linhas serem o mesmo lançamento.
     *
     * `(CODFIL, NUMDOC, SERIE, TIPDOC, ANALIT, placa, competência)`, em hash.
     * Duas linhas com a mesma chave **não** são duplicata por isso: o extrato
     * lança principal e juros sob o mesmo documento, com valores diferentes, e
     * os dois somam. Duplicata é outra coisa — ver `status`.
     */
    chaveContabilHash: text("chave_contabil_hash").notNull(),
    /**
     * O grupo que vira um valor consolidado: unidade, competência, placa, tipo
     * e rubrica, em hash. É por ele que a soma é feita.
     */
    grupoHash: text("grupo_hash").notNull(),
    /**
     * `ACEITO` | `DUPLICATA_PROVAVEL` | `PENDENTE_DE_CLASSIFICACAO` | `REJEITADO`.
     *
     * Texto e não enum pela razão de sempre neste schema: a lista mora no
     * código que a decide, e um estado novo não pede migration.
     */
    status: text("status").notNull(),
    /** Por que este lançamento está no status em que está. Nunca vazio fora de ACEITO. */
    motivo: text("motivo"),
  },
  (t) => [
    /*
      Uma linha da planilha produz no máximo um lançamento. É esta restrição que
      torna a reimportação idempotente no grão mais fino: reler o mesmo arquivo
      não pode fazer o mesmo lançamento existir duas vezes.
    */
    uniqueIndex("finame_real_lancamento_row_uq").on(t.importRunId, t.rawRowId),
    index("finame_real_lancamento_run_idx").on(t.importRunId),
    index("finame_real_lancamento_snapshot_idx").on(t.snapshotId),
    /* "Os lançamentos deste fato" — a expansão do número na tela. */
    index("finame_real_lancamento_fact_idx").on(t.factId),
    /* "O realizado desta placa ao longo dos meses" — a série da ficha. */
    index("finame_real_lancamento_placa_idx").on(t.placa, t.competencia),
    /* A fila e as pendências, que a tela lê por status. */
    index("finame_real_lancamento_status_idx").on(t.status, t.competencia),
    index("finame_real_lancamento_raw_row_idx").on(t.rawRowId),
  ],
);

/**
 * O que uma pessoa decidiu sobre o financiamento real — e só isso.
 *
 * ---------------------------------------------------------------------------
 * Por que separada da tabela de lançamentos
 * ---------------------------------------------------------------------------
 * Porque as duas têm durabilidades diferentes, e misturá-las apagaria a mais
 * frágil. O lançamento é derivado: some com a importação, volta igual na
 * releitura. A decisão não volta — "fulano confirmou em 12/09 que as duas
 * linhas da RZG-5A37 são o mesmo pagamento" não é reconstruível por consulta
 * nenhuma, e um `down` que a levasse junto apagaria em silêncio a única prova
 * de que alguém olhou.
 *
 * É o mesmo corte que o produto já faz entre `ticket_movement_day` (derivada,
 * descartável) e `ticket_movement_review` (decisão, exige tabela vazia), e é
 * por ele que esta tabela entra em `TABELAS_REMOVIDAS` no bridge.
 *
 * ---------------------------------------------------------------------------
 * Append-only, e por quê
 * ---------------------------------------------------------------------------
 * Uma decisão revista não apaga a anterior: acrescenta. Quem lê pega a mais
 * recente da chave, e o histórico continua legível — "foi confirmada como
 * duplicata em setembro e desconfirmada em outubro, por fulano, com este
 * motivo". Um `UPDATE` no lugar transformaria a mudança de opinião em um estado
 * sem passado, que é precisamente o que uma trilha de auditoria não pode ser.
 */
export const financiamentoRealDecisaoTable = pgTable(
  "financiamento_real_decisao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * `DUPLICATA_CONFIRMADA` | `LANCAMENTOS_DISTINTOS` | `CLASSIFICAR_ATIVO`.
     *
     * As duas primeiras respondem à mesma pergunta em sentidos opostos, e os
     * nomes dizem a resposta em vez do ato: `DUPLICATA_CONFIRMADA` é "o export
     * repetiu a linha" — a cópia não entra na soma, agora por decisão e não por
     * precaução; `LANCAMENTOS_DISTINTOS` é "são dois pagamentos" — somam. A
     * terceira diz de que tipo é um ativo que o cadastro não resolveu.
     */
    tipo: text("tipo").notNull(),
    /**
     * Sobre o que é a decisão: a impressão digital do grupo de linhas repetidas,
     * ou a placa normalizada, conforme o tipo.
     */
    chave: text("chave").notNull(),
    /** O valor decidido — o `entity_type` escolhido, na classificação de ativo. */
    valor: text("valor"),
    /** Por quê. Obrigatório: uma decisão sem motivo não é auditável. */
    motivo: text("motivo").notNull(),
    decididoPor: text("decidido_por").notNull(),
    decididoEm: timestamp("decidido_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    /* A leitura é sempre "a decisão mais recente desta chave". */
    index("financiamento_real_decisao_chave_idx").on(t.tipo, t.chave, t.decididoEm),
  ],
);
