import {
  pgTable,
  text,
  uuid,
  integer,
  numeric,
  jsonb,
  timestamp,
  date,
  boolean,
  index,
  uniqueIndex,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * FECHAMENTO DE REMUNERAÇÃO — a competência, seus documentos e a conta.
 *
 * Este arquivo modela o **outro** processo do produto. A Auditoria pergunta "o
 * que mudou entre vigências e quanto isso custa"; o Fechamento pergunta "quanto
 * devemos receber nesta quinzena, e o que impede de fechar". Ver
 * `docs/FECHAMENTO.md` para a separação, e
 * `docs/FONTES-FECHAMENTO-QUINZENAL.md` para o que cada fonte é.
 *
 * **Por que tabelas próprias e não o modelo canônico.** O canônico é
 * (vigência, entidade, atributo, valor): o retrato do que a Ambev *contratou*.
 * O fechamento é sobre o que *aconteceu* — 23 mil CT-es de uma quinzena, 949
 * viagens, 56 dias de disponibilidade. Não são atributos de um equipamento;
 * são eventos datados, com grão e ciclo de vida próprios. Forçá-los no
 * canônico exigiria uma entidade sintética por CT-e e destruiria a garantia que
 * o canônico dá — a de que toda entidade lá é um ativo que a Ambev remunera.
 *
 * **Por que toda FK tem nome declarado.** O nome que o drizzle geraria sozinho
 * — `<tabela>_<coluna>_<destino>_<coluna>_fk` — passa de 63 caracteres em cinco
 * destas tabelas, e o Postgres trunca identificador nesse limite **em
 * silêncio**. O efeito não é cosmético: a constraint nasce com o nome cortado,
 * toda conferência por nome — a reconvergência da partida, o diff do
 * Publishing — não a encontra, e conclui que a FK está faltando num banco em
 * que ela está lá. Nome curto e explícito resolve na origem.
 *
 * **O que é imutável aqui.** A competência encerrada congela: o gatilho
 * `fechamento_competencia_encerrada` recusa qualquer escrita nas tabelas de
 * linha de uma competência `ENCERRADA`. Reabrir é um ato com autor e motivo,
 * registrado — nunca um UPDATE silencioso.
 */

/* ===========================================================================
 * 1. A competência
 * ======================================================================== */

/**
 * O período de apuração — o eixo do ambiente inteiro.
 *
 * A chave é `2026-07-Q2`, estável e ordenável, e é o que a URL carrega. A
 * **quádrupla** (unidade, transportadora, tipo de operação, chave) é única.
 *
 * Ela já foi a trinca sem o tipo, com a frase "uma quinzena de um CDD com uma
 * transportadora é **um** fechamento, e dois seria o começo de duas verdades
 * sobre o mesmo dinheiro". A frase continua verdadeira e o recorte é que estava
 * incompleto: o mesmo CDD roda EMPURRADA e ROTA com a mesma transportadora na
 * mesma quinzena, e são duas operações — cada uma com a sua planilha de
 * remuneração, os seus relatórios e a sua conta. Somá-las num fechamento só é
 * que produzia uma verdade misturada. Ver a `0046`.
 *
 * `estado` é um `text` com CHECK, e não um enum, pela razão oposta à de
 * `enums.ts`: o ciclo de vida do fechamento é nosso e fechado, mas ainda está
 * sendo descoberto — um CHECK se altera numa migration de uma linha, um enum
 * do Postgres não.
 */
export const fechamentoCompetenciaTable = pgTable(
  "fechamento_competencia",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `2026-07-Q2`. */
    chave: text("chave").notNull(),
    ano: integer("ano").notNull(),
    mes: integer("mes").notNull(),
    quinzena: integer("quinzena").notNull(),
    inicio: date("inicio").notNull(),
    fim: date("fim").notNull(),
    /** O CDD — `443` / `CDD BELEM`, como as fontes o identificam. */
    unidadeCodigo: text("unidade_codigo").notNull(),
    unidadeNome: text("unidade_nome"),
    /** A transportadora — `36` / `HORIZONTE LOGISTICA LTDA`. */
    transportadoraCodigo: text("transportadora_codigo").notNull(),
    transportadoraNome: text("transportadora_nome"),
    /**
     * O tipo de operação — `EMPURRADA`, `ROTA`.
     *
     * **Não confundir com `Canal`**, que neste mesmo módulo é `ROTA` | `AS` —
     * distribuição urbana diária contra área de serviço, o primeiro eixo de
     * agregação de toda a apuração (ver `lib/fechamento/src/dominio.ts`). As
     * duas palavras colidem em `ROTA` e significam coisas diferentes, e é por
     * isso que esta coluna **não** se chama `canal`: dois campos com o mesmo
     * nome no mesmo módulo, um deles capaz de guardar `ROTA` querendo dizer
     * outra coisa, é a forma exata do erro que este arquivo escreve ensaios
     * para não cometer.
     *
     * Este eixo é o mesmo de `remuneracao_planilha.canal` e o mesmo que o
     * rótulo da vigência carrega (`EMPURRADA_1_8_2026` → `EMPURRADA`): é a
     * operação que a planilha de remuneração descreve, e é por ele que um
     * fechamento se liga ao cadastro que o remunera.
     *
     * `NAO_INFORMADO` é o valor das competências abertas **antes** de esta
     * coluna existir, e a única coisa que ele afirma é que ninguém disse. O
     * backfill não escreveu `EMPURRADA` nelas, ainda que hoje toda vigência
     * deste acervo seja empurrada: o fechamento não nasce das vigências, e
     * carimbar um tipo que nenhum dos cinco relatórios declara seria adivinhar
     * — a mesma recusa de `tributoDe` e de `DIZ_QUE_SIM`.
     *
     * O `default` existe para o backfill, e é fail-safe pela razão oposta à de
     * `app_user.role`: lá o default não podia fabricar um administrador; aqui
     * ele não pode fabricar um tipo. `NAO_INFORMADO` não se confunde com
     * nenhum, e a rota exige um de verdade.
     */
    tipoDeOperacao: text("tipo_de_operacao").notNull().default("NAO_INFORMADO"),
    estado: text("estado").notNull().default("ABERTA"),
    abertaPor: uuid("aberta_por"),
    abertaEm: timestamp("aberta_em", { withTimezone: true }).notNull().defaultNow(),
    /** Quando a apuração rodou pela última vez. */
    apuradaEm: timestamp("apurada_em", { withTimezone: true }),
    encerradaPor: uuid("encerrada_por"),
    encerradaEm: timestamp("encerrada_em", { withTimezone: true }),
    /** Por que foi reaberta, quando foi. Reabrir sem motivo não é permitido. */
    motivoDaReabertura: text("motivo_da_reabertura"),
  },
  (t) => [
    uniqueIndex("fechamento_competencia_unica").on(
      t.unidadeCodigo,
      t.transportadoraCodigo,
      t.tipoDeOperacao,
      t.chave,
    ),
    index("fechamento_competencia_por_periodo").on(t.ano, t.mes, t.quinzena),
    check("fechamento_competencia_quinzena", sql`${t.quinzena} in (1, 2)`),
    check("fechamento_competencia_mes", sql`${t.mes} between 1 and 12`),
    check(
      "fechamento_competencia_estado",
      sql`${t.estado} in ('ABERTA', 'EM_APURACAO', 'APURADA', 'APROVADA', 'ENCERRADA')`,
    ),
  ],
);

/**
 * A unidade e a transportadora que alguém cadastrou — o vocabulário que
 * sobrevive à competência.
 *
 * **Por que ela existe, se a lista sempre foi derivada.** Era derivada e só:
 * `listarPartes` lia as competências e devolvia os códigos que apareciam nelas.
 * A consequência apareceu no uso — quem digitou `443 — CDD Belém` no campo,
 * abriu a competência e depois excluiu a importação aberta por engano perdeu o
 * nome junto com ela. O cadastro tinha ido morar dentro do registro que ele
 * serve para criar, e desfazer o registro desfazia o cadastro.
 *
 * **O que ela não é.** Não é uma segunda verdade sobre o nome de um CDD. Toda
 * escrita de parte passa por aqui — a do campo que cadastra e a da abertura de
 * competência —, de modo que esta tabela guarda sempre o **último** nome
 * escrito, que é exatamente o que a lista derivada devolvia. `listarPartes`
 * continua somando as duas fontes: o cadastro responde pelo que ninguém usou
 * ainda, e as competências respondem pela contagem de cada código. A `0044`
 * nasce com o que já existia dentro — o backfill é o que faz a garantia valer
 * também para as competências abertas antes dela.
 *
 * `codigo` é único **por tipo**, e não no geral: `36` pode ser uma
 * transportadora e um CDD ao mesmo tempo, e os dois números não têm relação um
 * com o outro.
 */
export const fechamentoParteTable = pgTable(
  "fechamento_parte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `UNIDADE` ou `TRANSPORTADORA` — os dois lados de um fechamento. */
    tipo: text("tipo").notNull(),
    /** `443`, `36` — o código como as fontes da Ambev o escrevem. */
    codigo: text("codigo").notNull(),
    /** `CDD BELEM`. Nulo enquanto ninguém escreveu o nome — nunca vazio. */
    nome: text("nome"),
    criadaEm: timestamp("criada_em", { withTimezone: true }).notNull().defaultNow(),
    /** Quando o nome foi escrito pela última vez. */
    atualizadaEm: timestamp("atualizada_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fechamento_parte_unica").on(t.tipo, t.codigo),
    check("fechamento_parte_tipo", sql`${t.tipo} in ('UNIDADE', 'TRANSPORTADORA')`),
  ],
);

/* ===========================================================================
 * 2. Os documentos
 * ======================================================================== */

/**
 * Um arquivo de fonte recebido para uma competência.
 *
 * O SHA-256 do conteúdo é o que impede a mesma exportação de entrar duas vezes
 * e dobrar a conta — a mesma defesa que a importação da Auditoria usa, pela
 * mesma razão. O par (competência, tipo) **não** é único de propósito: uma
 * exportação corrigida substitui a anterior, e o histórico das duas fica.
 * `vigente` marca qual delas a apuração usa.
 *
 * `recusas` guarda, em JSON, as linhas que o leitor não conseguiu ler, cada uma
 * com a linha física e o texto original. Elas não são erro de importação: o
 * documento entra, a apuração roda com o que foi lido, e a tela mostra
 * nominalmente o que ficou de fora. O que nunca acontece é a linha ilegível
 * virar zero silencioso.
 */
export const fechamentoDocumentoTable = pgTable(
  "fechamento_documento",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competenciaId: uuid("competencia_id").notNull(),
    /** `OPERACAO` | `CTE` | `PAGAMENTO` | `DISPONIBILIDADE` | `REQUISICOES` | `CONCILIACAO`. */
    tipo: text("tipo").notNull(),
    nomeDoArquivo: text("nome_do_arquivo").notNull(),
    sha256: text("sha256").notNull(),
    tamanhoEmBytes: integer("tamanho_em_bytes").notNull(),
    /** Onde o arquivo ficou, para que a evidência possa ser reaberta. */
    caminho: text("caminho"),
    /** Quantas linhas o leitor produziu. */
    linhasLidas: integer("linhas_lidas").notNull().default(0),
    /** As linhas que ele recusou, com linha física e texto original. */
    recusas: jsonb("recusas").notNull().default(sql`'[]'::jsonb`),
    /** O documento que a apuração usa. Só um por (competência, tipo). */
    vigente: boolean("vigente").notNull().default(true),
    enviadoPor: uuid("enviado_por"),
    enviadoEm: timestamp("enviado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_documento_competencia_fk",
    }).onDelete("cascade"),
    uniqueIndex("fechamento_documento_sem_repeticao").on(t.competenciaId, t.sha256),
    uniqueIndex("fechamento_documento_vigente_unico")
      .on(t.competenciaId, t.tipo)
      .where(sql`${t.vigente}`),
    index("fechamento_documento_por_competencia").on(t.competenciaId, t.tipo),
    check(
      "fechamento_documento_tipo",
      sql`${t.tipo} in ('OPERACAO', 'CTE', 'PAGAMENTO', 'DISPONIBILIDADE', 'REQUISICOES', 'CONCILIACAO')`,
    ),
  ],
);

/* ===========================================================================
 * 3. As linhas normalizadas — uma tabela por fonte
 * ======================================================================== */

/*
 * Uma tabela por grão, e não uma tabela polimórfica com um `jsonb` de payload.
 *
 * A tabela única seria menor de escrever e impossível de conferir: `SUM` sobre
 * um campo dentro de JSON não usa índice, o tipo de cada campo deixa de ser
 * garantido pelo banco, e a primeira pergunta de auditoria — "some o frete
 * destas 19 mil viagens" — vira varredura. As seis fontes têm grãos
 * genuinamente diferentes — e o 03.08.20 tem dois, verba e desconto, que viram
 * duas tabelas pela mesma razão; modelá-las como se fossem a mesma coisa
 * esconderia exatamente o que a apuração precisa distinguir.
 *
 * Toda linha aponta o documento de origem, e o documento aponta o arquivo: a
 * cadeia até a célula não se interrompe em nenhum ponto.
 */

/**
 * Uma viagem do 2Art.
 *
 * As colunas se dividem em duas naturezas, e a divisão é a mesma que
 * `leitores/operacao.ts` faz na leitura. Do `dia` ao `valor_faturado` está o
 * que a apuração soma — mexer ali muda dinheiro. Da `transportadora` em diante
 * está o **retrato da viagem**: veículo, placa, horários, quilometragem,
 * ocupação, a abertura da remuneração da equipe. Nenhuma delas entra em conta
 * nenhuma; elas existem porque a tela do dia — a que substitui as abas
 * `01`…`31` da planilha — mostra a linha inteira, e porque a alternativa seria
 * guardar meia viagem e mandar quem confere reabrir o arquivo.
 *
 * **Todas as colunas do retrato são anuláveis, e nenhuma tem default.** O 2Art
 * de um CDD traz colunas que o de outro não traz; um `0` onde a exportação não
 * trouxe nada afirmaria que a viagem não pagou aquilo, que é diferente de não
 * sabermos. `NULL` é a única resposta honesta, e é o que a tela mostra como
 * traço.
 *
 * **Códigos são `text`, não número.** Veículo, região, transportadora,
 * matrícula e unidade de origem identificam algo — somá-los ou ordená-los como
 * grandeza não significaria nada, e o texto ainda preserva o zero à esquerda
 * que um número perderia.
 */
export const fechamentoViagemTable = pgTable(
  "fechamento_viagem",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentoId: uuid("documento_id").notNull(),
    competenciaId: uuid("competencia_id").notNull(),
    /** A linha física no arquivo — a ponta da trilha. */
    linhaNoArquivo: integer("linha_no_arquivo").notNull(),
    dia: date("dia").notNull(),
    canal: text("canal").notNull(),
    frota: text("frota").notNull(),
    placa: text("placa"),
    mapa: text("mapa"),
    entregas: integer("entregas").notNull().default(0),
    caixasCarregadas: numeric("caixas_carregadas", { precision: 14, scale: 2 }).notNull().default("0"),
    caixasEntregues: numeric("caixas_entregues", { precision: 14, scale: 2 }).notNull().default("0"),
    /** O frete sem imposto. */
    valorFrete: numeric("valor_frete", { precision: 14, scale: 2 }).notNull().default("0"),
    percentualDeImposto: numeric("percentual_de_imposto", { precision: 8, scale: 4 }),
    valorDeImposto: numeric("valor_de_imposto", { precision: 14, scale: 2 }).notNull().default("0"),
    /** O frete com imposto — o que se compara ao CT-e. */
    valorFaturado: numeric("valor_faturado", { precision: 14, scale: 2 }).notNull().default("0"),

    /* --- o retrato: quem rodou ------------------------------------------- */
    transportadora: text("transportadora"),
    cargaAtual: text("carga_atual"),
    regiao: text("regiao"),
    veiculo: text("veiculo"),
    entregaOuVolume: text("entrega_ou_volume"),
    unidadeDeOrigem: text("unidade_de_origem"),
    situacaoMultiCdd: text("situacao_multi_cdd"),
    veiculoCadastradoNoCdd: text("veiculo_cadastrado_no_cdd"),
    matriculaDoMotorista: text("matricula_do_motorista"),
    matriculaDoAjudante1: text("matricula_do_ajudante_1"),
    matriculaDoAjudante2: text("matricula_do_ajudante_2"),

    /* --- o retrato: a indisponibilidade ---------------------------------- */
    veiculoIndisponivel: text("veiculo_indisponivel"),
    placaIndisponivel: text("placa_indisponivel"),
    frotaIndisponivel: text("frota_indisponivel"),
    tipoDeIndisponibilidade: text("tipo_de_indisponibilidade"),

    /* --- o retrato: o que a viagem moveu --------------------------------- */
    ocupacao: numeric("ocupacao", { precision: 8, scale: 4 }),
    caixasDeRota: numeric("caixas_de_rota", { precision: 14, scale: 2 }),
    caixasDeAs: numeric("caixas_de_as", { precision: 14, scale: 2 }),
    veiculoBm: numeric("veiculo_bm", { precision: 14, scale: 4 }),
    rShow: numeric("r_show", { precision: 14, scale: 4 }),

    /* --- o retrato: o relógio e o hodômetro ------------------------------ */
    horaDeSaida: text("hora_de_saida"),
    horaDeEntrada: text("hora_de_entrada"),
    kmDeSaida: numeric("km_de_saida", { precision: 14, scale: 2 }),
    kmDeEntrada: numeric("km_de_entrada", { precision: 14, scale: 2 }),
    /*
      As durações são `text` porque é assim que o relatório as escreve — o mesmo
      arquivo traz `9:14` e `0:37:00` na mesma coluna. Convertê-las a minutos
      seria decidir, sem fonte, qual das duas grafias o Promax quis dizer; o que
      a tela precisa é mostrar o que está lá.
    */
    tempoInterno: text("tempo_interno"),
    tempoDoLaco: text("tempo_do_laco"),
    tempoDeDeslocamento: text("tempo_de_deslocamento"),
    kmDoLaco: numeric("km_do_laco", { precision: 14, scale: 2 }),
    kmDeDeslocamento: numeric("km_de_deslocamento", { precision: 14, scale: 2 }),

    /* --- o retrato: o previsto do roteirizador --------------------------- */
    tempoPrevisto: text("tempo_previsto"),
    kmPrevisto: numeric("km_previsto", { precision: 14, scale: 2 }),

    /* --- o retrato: o dinheiro além do frete ----------------------------- */
    custoSpot: numeric("custo_spot", { precision: 14, scale: 2 }),
    custoVariavel: numeric("custo_variavel", { precision: 14, scale: 2 }),
    lucro: numeric("lucro", { precision: 14, scale: 2 }),
    lucroUnitario: numeric("lucro_unitario", { precision: 14, scale: 4 }),
    tipoDeImposto: text("tipo_de_imposto"),
    valorUnitarioPorCaixaEntregue: numeric("valor_unitario_por_caixa_entregue", { precision: 14, scale: 4 }),
    valorPagoPorCaixaSemImposto: numeric("valor_pago_por_caixa_sem_imposto", { precision: 14, scale: 4 }),
    valorPagoPorCaixaComImposto: numeric("valor_pago_por_caixa_com_imposto", { precision: 14, scale: 4 }),
    valorDropdown: numeric("valor_dropdown", { precision: 14, scale: 2 }),

    /* --- o retrato: a remuneração da equipe ------------------------------ */
    valorUnitarioDoPontoDoMotorista: numeric("valor_unitario_do_ponto_do_motorista", { precision: 14, scale: 4 }),
    valorUnitarioDoPontoDoAjudante: numeric("valor_unitario_do_ponto_do_ajudante", { precision: 14, scale: 4 }),
    valorDaEquipeDeEntregaMotorista: numeric("valor_da_equipe_de_entrega_motorista", { precision: 14, scale: 2 }),
    valorDaEquipeDeEntregaAjudante: numeric("valor_da_equipe_de_entrega_ajudante", { precision: 14, scale: 2 }),

    /* --- o retrato: a abertura CEDBZ ------------------------------------- */
    custoVariavelCedbz: numeric("custo_variavel_cedbz", { precision: 14, scale: 2 }),
    lucroUnitarioCedbz: numeric("lucro_unitario_cedbz", { precision: 14, scale: 4 }),
    lucroVariavelPorCaixaEntregueFfcedbz: numeric("lucro_variavel_por_caixa_entregue_ffcedbz", { precision: 14, scale: 4 }),
  },
  (t) => [
    foreignKey({
      columns: [t.documentoId],
      foreignColumns: [fechamentoDocumentoTable.id],
      name: "fechamento_viagem_documento_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_viagem_competencia_fk",
    }).onDelete("cascade"),
    index("fechamento_viagem_por_competencia").on(t.competenciaId, t.dia, t.canal),
    index("fechamento_viagem_por_documento").on(t.documentoId),
  ],
);

/** Um CT-e do 03.08.15. É a tabela que cresce: ~23 mil linhas por quinzena. */
export const fechamentoCteTable = pgTable(
  "fechamento_cte",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentoId: uuid("documento_id").notNull(),
    competenciaId: uuid("competencia_id").notNull(),
    linhaNoArquivo: integer("linha_no_arquivo").notNull(),
    dia: date("dia"),
    /** A VBZ — a chave semântica que liga requisição, CT-e e conciliação. */
    vbz: integer("vbz").notNull(),
    verbaNome: text("verba_nome").notNull(),
    verbaNatureza: text("verba_natureza").notNull(),
    canal: text("canal").notNull(),
    numero: text("numero"),
    documento: text("documento"),
    /** O total do documento, com imposto. */
    valorCte: numeric("valor_cte", { precision: 14, scale: 2 }).notNull(),
    /** A base: o frete sem imposto, como o próprio documento a abre. */
    valorFrete: numeric("valor_frete", { precision: 14, scale: 2 }).notNull().default("0"),
    icms: numeric("icms", { precision: 14, scale: 2 }).notNull().default("0"),
    pis: numeric("pis", { precision: 14, scale: 2 }).notNull().default("0"),
    cofins: numeric("cofins", { precision: 14, scale: 2 }).notNull().default("0"),
    imposto: numeric("imposto", { precision: 14, scale: 2 }).notNull().default("0"),
    /** A chave de acesso do documento fiscal. */
    controle: text("controle"),
  },
  (t) => [
    foreignKey({
      columns: [t.documentoId],
      foreignColumns: [fechamentoDocumentoTable.id],
      name: "fechamento_cte_documento_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_cte_competencia_fk",
    }).onDelete("cascade"),
    index("fechamento_cte_por_verba").on(t.competenciaId, t.vbz),
    index("fechamento_cte_por_documento").on(t.documentoId),
  ],
);

/** Uma requisição de despesa do 03.08.12.09, com a trilha de aprovação inteira. */
export const fechamentoRequisicaoTable = pgTable(
  "fechamento_requisicao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentoId: uuid("documento_id").notNull(),
    competenciaId: uuid("competencia_id").notNull(),
    linhaNoArquivo: integer("linha_no_arquivo").notNull(),
    /** O número da requisição no SRTrans. */
    numero: text("numero").notNull(),
    quinzenaDePagamento: date("quinzena_de_pagamento"),
    canal: text("canal").notNull(),
    vbz: integer("vbz").notNull(),
    verbaNome: text("verba_nome").notNull(),
    tipoDeDespesaCodigo: text("tipo_de_despesa_codigo"),
    tipoDeDespesaNome: text("tipo_de_despesa_nome"),
    descricao: text("descricao"),
    /** `Aprovada`, `Reprovada`, `Pendente` — como veio. Quem decide é a apuração. */
    status: text("status").notNull(),
    /** O valor sem imposto. */
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull(),
    solicitante: text("solicitante"),
    aprovadorRegional: text("aprovador_regional"),
    aprovadorAc: text("aprovador_ac"),
    enviadaEm: date("enviada_em"),
    decididaEm: date("decidida_em"),
  },
  (t) => [
    foreignKey({
      columns: [t.documentoId],
      foreignColumns: [fechamentoDocumentoTable.id],
      name: "fechamento_requisicao_documento_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_requisicao_competencia_fk",
    }).onDelete("cascade"),
    index("fechamento_requisicao_por_verba").on(t.competenciaId, t.vbz),
    index("fechamento_requisicao_por_documento").on(t.documentoId),
  ],
);

/** Um dia de disponibilidade do 03.08.18 — a origem dos descontos no fixo. */
export const fechamentoDisponibilidadeTable = pgTable(
  "fechamento_disponibilidade",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentoId: uuid("documento_id").notNull(),
    competenciaId: uuid("competencia_id").notNull(),
    linhaNoArquivo: integer("linha_no_arquivo").notNull(),
    /** `FF` (caminhões) ou `VAN`. */
    tipoDeFrota: text("tipo_de_frota").notNull(),
    dia: date("dia").notNull(),
    canal: text("canal").notNull(),
    frotaTotal: integer("frota_total").notNull().default(0),
    contratada: numeric("contratada", { precision: 12, scale: 2 }).notNull().default("0"),
    realPrimeiraViagem: numeric("real_primeira_viagem", { precision: 12, scale: 2 }).notNull().default("0"),
    realSegundaViagem: numeric("real_segunda_viagem", { precision: 12, scale: 2 }).notNull().default("0"),
    gapTotal: numeric("gap_total", { precision: 12, scale: 2 }).notNull().default("0"),
    /** O gap da Ambev — **não** desconta. A distinção que é dinheiro. */
    gapDaCia: numeric("gap_da_cia", { precision: 12, scale: 2 }).notNull().default("0"),
    /** O gap da transportadora, aberto como o relatório o abre. */
    gapDaTransportadora: jsonb("gap_da_transportadora").notNull().default(sql`'{}'::jsonb`),
    descontoCustoFixo: numeric("desconto_custo_fixo", { precision: 14, scale: 2 }).notNull().default("0"),
    descontoEquipe: numeric("desconto_equipe", { precision: 14, scale: 2 }).notNull().default("0"),
    descontoIndiretos: numeric("desconto_indiretos", { precision: 14, scale: 2 }).notNull().default("0"),
    descontoFatorAjudante: numeric("desconto_fator_ajudante", { precision: 14, scale: 2 }).notNull().default("0"),
    descontoTotal: numeric("desconto_total", { precision: 14, scale: 2 }).notNull().default("0"),
    percentualDeUtilizacao: numeric("percentual_de_utilizacao", { precision: 8, scale: 4 }),
    percentualDeDisponibilidade: numeric("percentual_de_disponibilidade", { precision: 8, scale: 4 }),
  },
  (t) => [
    foreignKey({
      columns: [t.documentoId],
      foreignColumns: [fechamentoDocumentoTable.id],
      name: "fechamento_disponibilidade_documento_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_disponibilidade_competencia_fk",
    }).onDelete("cascade"),
    index("fechamento_disponibilidade_por_dia").on(t.competenciaId, t.dia),
    index("fechamento_disponibilidade_por_documento").on(t.documentoId),
  ],
);

/**
 * Uma linha de valor da conciliação do Promax.
 *
 * As duas colunas do relatório viram duas colunas aqui — `emitido` e
 * `calculado` — e as duas são anuláveis de propósito: muitas linhas do
 * relatório trazem um número só, e qual das colunas ele ocupa é o dado.
 * Guardar um `0` onde o relatório não trouxe nada apagaria essa distinção.
 */
export const fechamentoConciliacaoItemTable = pgTable(
  "fechamento_conciliacao_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentoId: uuid("documento_id").notNull(),
    competenciaId: uuid("competencia_id").notNull(),
    linhaNoArquivo: integer("linha_no_arquivo").notNull(),
    /** `ROTA`, `AS` ou `GERAL`. */
    secao: text("secao").notNull(),
    bloco: text("bloco"),
    rubrica: text("rubrica").notNull(),
    /** `S`, `N` ou nulo — a marca da coluna "Conciliado". */
    conciliado: text("conciliado"),
    emitido: numeric("emitido", { precision: 14, scale: 2 }),
    calculado: numeric("calculado", { precision: 14, scale: 2 }),
  },
  (t) => [
    foreignKey({
      columns: [t.documentoId],
      foreignColumns: [fechamentoDocumentoTable.id],
      name: "fechamento_conciliacao_item_documento_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_conciliacao_item_competencia_fk",
    }).onDelete("cascade"),
    index("fechamento_conciliacao_item_por_secao").on(t.competenciaId, t.secao),
    index("fechamento_conciliacao_item_por_documento").on(t.documentoId),
  ],
);

/**
 * Uma verba do demonstrativo de pagamento (03.08.20).
 *
 * As seis colunas do relatório viram seis colunas aqui, e nenhuma delas é
 * derivada das outras na leitura: `valorFaturado` é `NF-ISS + CTRC-ICMS` no
 * arquivo, mas guardá-lo como o arquivo o traz é o que permite acusar o dia em
 * que a soma do Promax não fechar. Recalcular na importação apagaria justamente
 * o erro que se quer encontrar.
 *
 * A mesma VBZ pode aparecer duas vezes no mesmo canal — a 07 (Freteiro) vem no
 * bloco de frete e no de outros custos —, e por isso a chave natural inclui o
 * bloco. Somar as duas é trabalho da apuração, não do banco.
 */
export const fechamentoPagamentoItemTable = pgTable(
  "fechamento_pagamento_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentoId: uuid("documento_id").notNull(),
    competenciaId: uuid("competencia_id").notNull(),
    linhaNoArquivo: integer("linha_no_arquivo").notNull(),
    /** `ROTA` ou `AS`. */
    canal: text("canal").notNull(),
    /** `FRETE` ou `OUTROS_CUSTOS`. */
    bloco: text("bloco").notNull(),
    vbz: integer("vbz").notNull(),
    /** O nome como o arquivo o escreve, que nem sempre é o do catálogo. */
    nomeNoArquivo: text("nome_no_arquivo").notNull(),
    semImposto: numeric("sem_imposto", { precision: 14, scale: 2 }).notNull().default("0"),
    nfIss: numeric("nf_iss", { precision: 14, scale: 2 }).notNull().default("0"),
    /** A coluna que vira CT-e — a que se compara ao 03.08.15. */
    ctrcIcms: numeric("ctrc_icms", { precision: 14, scale: 2 }).notNull().default("0"),
    valorFaturado: numeric("valor_faturado", { precision: 14, scale: 2 }).notNull().default("0"),
    vlcNfIss: numeric("vlc_nf_iss", { precision: 14, scale: 2 }).notNull().default("0"),
    vlcCtrcIcms: numeric("vlc_ctrc_icms", { precision: 14, scale: 2 }).notNull().default("0"),
  },
  (t) => [
    foreignKey({
      columns: [t.documentoId],
      foreignColumns: [fechamentoDocumentoTable.id],
      name: "fechamento_pagamento_item_documento_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_pagamento_item_competencia_fk",
    }).onDelete("cascade"),
    index("fechamento_pagamento_item_por_verba").on(t.competenciaId, t.vbz),
    index("fechamento_pagamento_item_por_documento").on(t.documentoId),
    check("fechamento_pagamento_item_canal", sql`${t.canal} in ('ROTA', 'AS')`),
    check("fechamento_pagamento_item_bloco", sql`${t.bloco} in ('FRETE', 'OUTROS_CUSTOS')`),
  ],
);

/**
 * Um desconto do demonstrativo de pagamento.
 *
 * Devolução, os quatro de disponibilidade e o frete mínimo. Todos vêm do
 * arquivo com a frase "Desconto Liquido ja subtraido da VBZ …", e o `rotulo`
 * guarda a frase inteira porque é ela que impede a leitura errada mais cara
 * possível: somar o desconto de novo a uma verba de que ele já saiu.
 *
 * `base` e `percentual` só existem na devolução — nas outras são `NULL`, e não
 * zero: zero afirmaria que a base era nenhuma.
 */
export const fechamentoPagamentoDescontoTable = pgTable(
  "fechamento_pagamento_desconto",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentoId: uuid("documento_id").notNull(),
    competenciaId: uuid("competencia_id").notNull(),
    linhaNoArquivo: integer("linha_no_arquivo").notNull(),
    canal: text("canal").notNull(),
    /** `DEVOLUCAO`, `DISPONIBILIDADE_*` ou `FRETE_MINIMO`. */
    tipo: text("tipo").notNull(),
    /** O rótulo inteiro, com a frase de qual VBZ o desconto já saiu. */
    rotulo: text("rotulo").notNull(),
    valor: numeric("valor", { precision: 14, scale: 2 }).notNull().default("0"),
    base: numeric("base", { precision: 14, scale: 2 }),
    percentual: numeric("percentual", { precision: 8, scale: 4 }),
  },
  (t) => [
    foreignKey({
      columns: [t.documentoId],
      foreignColumns: [fechamentoDocumentoTable.id],
      name: "fechamento_pagamento_desconto_documento_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_pagamento_desconto_competencia_fk",
    }).onDelete("cascade"),
    index("fechamento_pagamento_desconto_por_competencia").on(t.competenciaId, t.canal),
    index("fechamento_pagamento_desconto_por_documento").on(t.documentoId),
    check("fechamento_pagamento_desconto_canal", sql`${t.canal} in ('ROTA', 'AS')`),
  ],
);

/* ===========================================================================
 * 4. A conta apurada
 * ======================================================================== */

/**
 * O resultado da apuração, congelado.
 *
 * A apuração é função pura dos documentos, então poderia ser recalculada a cada
 * leitura. Ela é gravada assim mesmo, e a razão é o produto e não o
 * desempenho: **o que foi aprovado precisa ser o que se vê depois.** Se a
 * apuração fosse recalculada, trocar um documento mudaria retroativamente o
 * número que alguém aprovou na semana passada, e a aprovação deixaria de
 * significar coisa alguma.
 *
 * Rodar de novo cria uma linha nova. `vigente` marca a corrente; as anteriores
 * ficam, e é por elas que se responde "o que mudou desde que aprovei".
 */
export const fechamentoApuracaoTable = pgTable(
  "fechamento_apuracao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competenciaId: uuid("competencia_id").notNull(),
    rodadaEm: timestamp("rodada_em", { withTimezone: true }).notNull().defaultNow(),
    rodadaPor: uuid("rodada_por"),
    vigente: boolean("vigente").notNull().default(true),
    /** As fontes que existiam quando esta apuração rodou. */
    fontesPresentes: jsonb("fontes_presentes").notNull().default(sql`'[]'::jsonb`),
    fontesAusentes: jsonb("fontes_ausentes").notNull().default(sql`'[]'::jsonb`),
    /**
     * As alíquotas **medidas** dos arquivos, com a memória da medição.
     *
     * Ficam gravadas porque são a conversão que sustenta metade da conta: sem
     * elas registradas, uma apuração antiga vira um número sem como refazer.
     */
    aliquotas: jsonb("aliquotas").notNull().default(sql`'[]'::jsonb`),
    /** A carga fiscal que os próprios CT-es declaram — outra coisa, e por isso outro campo. */
    cargaFiscal: jsonb("carga_fiscal").notNull().default(sql`'[]'::jsonb`),
    totalEmitido: numeric("total_emitido", { precision: 16, scale: 2 }).notNull().default("0"),
    totalEsperado: numeric("total_esperado", { precision: 16, scale: 2 }).notNull().default("0"),
    /** A parte do emitido que nenhuma fonte sustenta — dita, não escondida. */
    totalNaoConferido: numeric("total_nao_conferido", { precision: 16, scale: 2 }).notNull().default("0"),
    totalDiferenca: numeric("total_diferenca", { precision: 16, scale: 2 }).notNull().default("0"),
  },
  (t) => [
    foreignKey({
      columns: [t.competenciaId],
      foreignColumns: [fechamentoCompetenciaTable.id],
      name: "fechamento_apuracao_competencia_fk",
    }).onDelete("cascade"),
    uniqueIndex("fechamento_apuracao_vigente_unica")
      .on(t.competenciaId)
      .where(sql`${t.vigente}`),
    index("fechamento_apuracao_por_competencia").on(t.competenciaId, t.rodadaEm),
  ],
);

/** Uma verba apurada, com a memória de cálculo de cada parcela. */
export const fechamentoApuracaoVerbaTable = pgTable(
  "fechamento_apuracao_verba",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apuracaoId: uuid("apuracao_id").notNull(),
    vbz: integer("vbz").notNull(),
    canal: text("canal").notNull(),
    verbaNome: text("verba_nome").notNull(),
    verbaNatureza: text("verba_natureza").notNull(),
    emitido: numeric("emitido", { precision: 16, scale: 2 }).notNull().default("0"),
    baseEmitida: numeric("base_emitida", { precision: 16, scale: 2 }).notNull().default("0"),
    documentos: integer("documentos").notNull().default(0),
    /** Nulo quando nenhuma fonte sustenta a verba. Nulo ≠ zero. */
    esperado: numeric("esperado", { precision: 16, scale: 2 }),
    diferenca: numeric("diferenca", { precision: 16, scale: 2 }),
    /** Parcela a parcela: origem, descrição, valor e fator aplicado. */
    memoria: jsonb("memoria").notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    foreignKey({
      columns: [t.apuracaoId],
      foreignColumns: [fechamentoApuracaoTable.id],
      name: "fechamento_apuracao_verba_apuracao_fk",
    }).onDelete("cascade"),
    uniqueIndex("fechamento_apuracao_verba_unica").on(t.apuracaoId, t.vbz),
  ],
);

/**
 * O que impede a competência de fechar, ou o que merece uma pergunta à Ambev.
 *
 * A divergência tem **desfecho**, e é isso que a separa de um relatório: cada
 * uma pode ser contestada, aceita ou resolvida, com autor e texto. É o
 * equivalente, no Fechamento, do que a Curadoria é na Auditoria — uma fila de
 * trabalho, não uma lista de avisos.
 */
export const fechamentoDivergenciaTable = pgTable(
  "fechamento_divergencia",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    apuracaoId: uuid("apuracao_id").notNull(),
    tipo: text("tipo").notNull(),
    canal: text("canal").notNull(),
    titulo: text("titulo").notNull(),
    valor: numeric("valor", { precision: 16, scale: 2 }).notNull().default("0"),
    /** Onde olhar para resolver: a fonte e a linha. */
    onde: text("onde").notNull(),
    /** `A_RECEBER`, `A_PAGAR` ou `INFORMATIVO`. */
    sentido: text("sentido").notNull(),
    /** `ABERTA`, `EM_CONTESTACAO`, `ACEITA`, `RESOLVIDA`. */
    desfecho: text("desfecho").notNull().default("ABERTA"),
    desfechoPor: uuid("desfecho_por"),
    desfechoEm: timestamp("desfecho_em", { withTimezone: true }),
    desfechoNota: text("desfecho_nota"),
  },
  (t) => [
    foreignKey({
      columns: [t.apuracaoId],
      foreignColumns: [fechamentoApuracaoTable.id],
      name: "fechamento_divergencia_apuracao_fk",
    }).onDelete("cascade"),
    index("fechamento_divergencia_por_apuracao").on(t.apuracaoId, t.desfecho),
    check(
      "fechamento_divergencia_sentido",
      sql`${t.sentido} in ('A_RECEBER', 'A_PAGAR', 'INFORMATIVO')`,
    ),
    check(
      "fechamento_divergencia_desfecho",
      sql`${t.desfecho} in ('ABERTA', 'EM_CONTESTACAO', 'ACEITA', 'RESOLVIDA')`,
    ),
  ],
);
