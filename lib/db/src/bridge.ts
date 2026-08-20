/**
 * O bridge deploy — como publicar sem deixar o Publishing reescrever o schema.
 *
 * ---------------------------------------------------------------------------
 * O conflito
 * ---------------------------------------------------------------------------
 * Existem duas autoridades sobre o schema de Production, e elas rodam em
 * momentos diferentes do mesmo deploy:
 *
 * 1. **O Publishing do Replit**, na fase `Provision`, que introspecta os bancos
 *    de Development e de Production, calcula o diff e o aplica — antes de o
 *    servidor novo existir. É serviço da plataforma; nada neste repositório o
 *    desliga (renomear `drizzle.config.ts` não desliga: a doc do Replit é
 *    explícita sobre a introspecção direta dos dois bancos).
 * 2. **`runMigrations()`**, na partida do servidor, aplicando a fila versionada.
 *
 * A primeira sempre ganha a corrida, e ela não sabe nada do que sustenta este
 * schema: não cria as onze funções `freightcheck_*`, não cria as três views,
 * não faz backfill, não funde vigência duplicada, e não conhece a ordem
 * "coluna nullable → backfill → validação → NOT NULL". O deploy morria em
 *
 *     ALTER TABLE "snapshot" ADD COLUMN "canonical_snapshot_key" text
 *       GENERATED ALWAYS AS (freightcheck_snapshot_key(...)) STORED;
 *     ERROR: function freightcheck_snapshot_key(text, text, text, date, jsonb)
 *            does not exist
 *
 * e a única saída que a tela oferecia era copiar Development por cima de
 * Production.
 *
 * ---------------------------------------------------------------------------
 * A saída: não fazer o diff funcionar — fazer o diff ficar pequeno e inócuo
 * ---------------------------------------------------------------------------
 * `bridgeDown` deixa Development temporariamente compatível com Production
 * **exatamente nos pontos que geram DDL destrutivo ou impossível**. O que sobra
 * para o Publishing é medido, nominal e de uma classe só:
 *
 *     6 ADD COLUMN — nullable, sem default, sem generated, em tabela existente
 *
 * As seis pertencem à `0015`, que **confere o tipo de cada uma** e aborta
 * nomeando a diferença se alguma chegar errada. Nenhuma tabela, nenhum índice,
 * nenhuma constraint, nenhum DROP.
 *
 * Depois do deploy, `runMigrations()` leva Production de `0000` ao fim da fila — a
 * fila é reentrante, então atravessa o que o Publishing tiver criado —, e
 * `bridgeUp` devolve Development ao estado canônico.
 *
 * ---------------------------------------------------------------------------
 * Três regras que este módulo não quebra
 * ---------------------------------------------------------------------------
 * **Sem CASCADE.** Toda remoção é `RESTRICT`. Uma dependência que ninguém
 * previu tem de derrubar o bridge, não sumir junto com o objeto. As dependências
 * conhecidas são enumeradas antes e conferidas uma a uma.
 *
 * **Fail-closed e transacional.** Todas as pré-condições são verificadas antes
 * do primeiro DDL, e tudo roda numa transação só: ou o bridge inteiro entra, ou
 * nada entra.
 *
 * **O registro não é tocado.** `drizzle.__drizzle_migrations` é história de
 * migrations, não retrato de estrutura; uma sobreposição operacional temporária
 * não é evento dessa história. Por isso `bridgeUp` **não** é um segundo
 * executor de migrations: ele restaura uma lista nominal de objetos, cada um
 * com a definição exata que a migration proprietária lhe dá, e nenhuma
 * transformação de dados é reaplicada.
 */
import pg from "pg";
import { readMigrations, mexeEmDados } from "./migrate";
import {
  CRIAR_MARCADOR,
  LIMPAR_MARCADOR,
  MARCAR_DESCIDA,
} from "./bridge-marcador";

// ---------------------------------------------------------------------------
// O que o bridge move, nominalmente
// ---------------------------------------------------------------------------

/** As nove colunas que a `0013` remove de `ticket`, com o tipo original da `0012`. */
export const COLUNAS_LEGADAS_TICKET: { nome: string; ddl: string }[] = [
  { nome: "parameter_label", ddl: "text" },
  { nome: "attribute_code", ddl: "text" },
  { nome: "requested_value_raw", ddl: "text" },
  { nome: "requested_value_numeric", ddl: "numeric(18, 6)" },
  { nome: "applied_value_raw", ddl: "text" },
  { nome: "applied_value_numeric", ddl: "numeric(18, 6)" },
  { nome: "impact_amount", ddl: "numeric(18, 6)" },
  // Idêntica à de Production: a medição do primeiro desenho mostrou que
  // recriá-la nullable deixava um ALTER de comportamento no diff residual.
  { nome: "impact_confidence", ddl: "text NOT NULL DEFAULT 'NOT_CALCULABLE'" },
  { nome: "impact_reason", ddl: "text" },
];

/**
 * A allowlist: o que o Publishing ainda cria em Production depois do `down`.
 *
 * Todas nullable, sem default, sem generated, em tabela que já existe — e todas
 * conferidas por tipo pela `0015` (ver a seção 4 daquela migration).
 */
export const ALLOWLIST: {
  tabela: string;
  coluna: string;
  tipo: string;
  /**
   * A coluna entra na fila depois do ponto em que o bridge costuma rodar.
   *
   * As primeiras seis existem desde cedo, e por isso a conferência do `down`
   * exige encontrá-las: ausência ali significaria que o `down` removeu o que
   * não devia. Uma coluna acrescentada por uma migration recente é diferente —
   * um Development parado antes dela **não a tem**, e não tê-la é o estado
   * correto, não um defeito do bridge. Marcadas assim, elas são conferidas
   * quando existem e ignoradas quando ainda não chegaram.
   */
  aindaPodeNaoExistir?: boolean;
}[] = [
  { tabela: "snapshot", coluna: "dataset_family", tipo: "text" },
  { tabela: "snapshot", coluna: "canal", tipo: "text" },
  { tabela: "snapshot", coluna: "canonical_scope", tipo: "jsonb" },
  { tabela: "snapshot", coluna: "canonical_payload_hash", tipo: "text" },
  { tabela: "staged_fact", coluna: "entity_key_raw", tipo: "text" },
  { tabela: "entity_identifier", coluna: "identifier_value_raw", tipo: "text" },
  /*
    As duas da `0030`. A classe de custo saiu da taxonomia e virou propriedade
    do atributo — versionada em `attribute_semantics`, projetada em `attribute`.
    São aditivas, como todas as daqui: Production ganha as colunas quando rodar
    a fila, e até lá o `down` as mantém para que a proposta do Publishing não
    tenha nada além delas.
  */
  { tabela: "attribute", coluna: "cost_class", tipo: "text", aindaPodeNaoExistir: true },
  {
    tabela: "attribute_semantics",
    coluna: "cost_class",
    tipo: "text",
    aindaPodeNaoExistir: true,
  },
  /*
    A da `0035`. O tipo declarado no envio — a aba da tela por onde a planilha
    entrou. Aditiva e nula por definição: toda importação anterior a ela não
    declarou nada, e é isso que `NULL` diz. Production a ganha quando rodar a
    fila; até lá o `down` a mantém, para que a proposta do Publishing continue
    sendo só o que esta lista nomeia.
  */
  {
    tabela: "import_run",
    coluna: "declared_type",
    tipo: "text",
    aindaPodeNaoExistir: true,
  },
  /*
    As duas da `0040`. O reprocessamento — reler um arquivo já recebido porque o
    leitor mudou — precisa dizer no histórico *qual leitura ele releu* e *por
    quê*. Aditivas e nulas por definição: toda importação que não é releitura
    tem as duas em `NULL`, que é exatamente o que elas devem dizer dela.
  */
  {
    tabela: "import_run",
    coluna: "reprocess_of_run_id",
    tipo: "uuid",
    aindaPodeNaoExistir: true,
  },
  {
    tabela: "import_run",
    coluna: "reprocess_reason",
    tipo: "text",
    aindaPodeNaoExistir: true,
  },
];

/**
 * Tabelas que o `down` remove. Todas têm de estar vazias — é pré-condição.
 *
 * `ticket_import_deletion` é da `0020`, e a pré-condição de vazia vale para ela
 * com um sentido a mais: é o registro das exclusões de envios de chamados, e
 * ele é append-only justamente para não se perder. Um bridge que a derrubasse
 * com linhas dentro apagaria em silêncio a única prova de que aqueles envios
 * existiram — então ele para e diz o que encontrou, que é o que este projeto
 * faz com descarte.
 *
 * `coverage_expectation`, da `0021`, está aqui pelo mesmo motivo e não entre as
 * derivadas abaixo: o que ela guarda é decisão humana — um curador que dispensou
 * uma ausência ou aceitou uma renomeação escreveu ali algo que nenhuma consulta
 * reconstrói. Se ela tiver linha, abortar é o desfecho certo, não um transtorno.
 *
 * `entity_expectation`, da `0032`, é o mesmo caso no grão da entidade. Uma baixa
 * de frota é a afirmação de que um equipamento saiu — a única coisa capaz de
 * fazer a cobertura parar de cobrá-lo. Nenhuma consulta a reconstrói: a série
 * mostra que o caminhão sumiu, e é justamente sobre o *porquê* que a linha fala.
 * Perdê-la reabriria todas as lacunas que alguém já resolveu.
 */
const TABELAS_REMOVIDAS = [
  "ticket_change",
  "snapshot_merge",
  "import_decision",
  "ticket_import_deletion",
  "coverage_expectation",
  "entity_expectation",
  /*
    As treze do Fechamento — as dez da `0039`, as duas do 03.08.20 (`0043`) e o
    cadastro de partes (`0044`).
    Elas entram aqui inteiras, e na ordem em
    que o `RESTRICT` do `down` as aceita — filha antes de mãe —, porque o
    ambiente é novo: Production não o conhece, e até rodar a fila toda tabela
    dele é uma tabela que a proposta do Publishing proporia criar.

    `fechamento_parte` não é filha de ninguém — o cadastro sobrevive à
    competência, que é a razão de ele existir —, e por isso poderia entrar em
    qualquer ponto da lista. Entra ao lado da competência porque é dela que ele
    fala.

    A pré-condição de vazia é a certa também aqui, e por um motivo que vale
    além do padrão: uma competência guarda os cinco relatórios que a Ambev
    exportou naquela quinzena e a conta que se cobrou a partir deles. Derrubá-la
    com linhas dentro apagaria a prova de uma cobrança — exatamente o que o
    gatilho `fechamento_*_congelada` existe para impedir do outro lado.
  */
  "fechamento_divergencia",
  "fechamento_apuracao_verba",
  "fechamento_apuracao",
  "fechamento_pagamento_desconto",
  "fechamento_pagamento_item",
  "fechamento_conciliacao_item",
  "fechamento_disponibilidade",
  "fechamento_requisicao",
  "fechamento_cte",
  "fechamento_viagem",
  /*
    O conteúdo guardado da importação, da `0047`. Vem **antes** do documento
    porque é filha dele: derrubar o pai primeiro esbarraria na chave
    estrangeira, que é o que esta ordem existe para evitar.
  */
  "fechamento_documento_conteudo",
  "fechamento_documento",
  "fechamento_competencia",
  "fechamento_parte",
  /*
    A planilha informada, da `0045` — o mesmo caso das treze acima: Production
    não a conhece até rodar a fila, e até lá toda tabela nova é uma tabela que a
    proposta do Publishing proporia criar.

    Não é filha de ninguém (não há FK para `app_user`, de propósito — ver
    `schema/remuneracao.ts`), e por isso entra em qualquer ponto da lista.

    **A pré-condição de vazia é a mais dura desta lista, e é a certa.** Cada
    linha aqui é uma célula que uma pessoa digitou da aba de Excel, e não existe
    consulta que a reconstrua a partir de outra coisa — é decisão humana, como
    `coverage_expectation` e como o significado cadastrado na tela. Um
    Development com planilha preenchida trava o `down`, e travar é o
    comportamento correto: encolher o diff descartando o que alguém digitou é
    exatamente o que o bridge não pode fazer.
  */
  "remuneracao_planilha",
];

/**
 * Tabelas **derivadas** que o `down` remove mesmo com linhas.
 *
 * A pré-condição de vazia existe para que o bridge nunca descarte dado que só
 * existe naquela tabela. `snapshot_entity_type` não é esse caso: cada linha
 * dela é o resultado de uma contagem sobre `fact`, e a consulta que a produz
 * está escrita na migration que a criou. Descartá-la não perde nada; exigi-la
 * vazia travaria todo deploy de um Development com dado, que é o normal.
 *
 * O `up` a reconstrói com **aquele mesmo statement**, levantado do disco — não
 * com uma cópia reescrita aqui, que poderia divergir sem ninguém ver.
 */
/**
 * As colunas que a `0042` acrescentou a `fechamento_viagem` — o retrato da
 * viagem, que a tela do dia mostra e a conta não usa.
 *
 * A lista existe para o `up`: o `down` derruba a tabela inteira e o `up` a
 * recria pelo `CREATE TABLE` da `0039`, que não as conhece. Sem elas a tabela
 * voltaria com quinze colunas em vez de sessenta e duas.
 *
 * Os nomes estão aqui por extenso, e não lidos do SQL por expressão regular,
 * pelo mesmo motivo de toda lista nominal deste arquivo: o que o `up` repõe é
 * decisão declarada, e uma varredura que casasse a mais reporia coisa que
 * ninguém revisou. Quem confere o par é o teste do bridge, que compara o
 * schema depois do `up` com o de um banco criado do zero pela fila.
 */
const COLUNAS_DO_RETRATO_DA_VIAGEM = [
  "transportadora", "carga_atual", "regiao",
  "veiculo", "entrega_ou_volume", "unidade_de_origem",
  "situacao_multi_cdd", "veiculo_cadastrado_no_cdd", "matricula_do_motorista",
  "matricula_do_ajudante_1", "matricula_do_ajudante_2", "veiculo_indisponivel",
  "placa_indisponivel", "frota_indisponivel", "tipo_de_indisponibilidade",
  "ocupacao", "caixas_de_rota", "caixas_de_as",
  "veiculo_bm", "r_show", "hora_de_saida",
  "hora_de_entrada", "km_de_saida", "km_de_entrada",
  "tempo_interno", "tempo_do_laco", "tempo_de_deslocamento",
  "km_do_laco", "km_de_deslocamento", "tempo_previsto",
  "km_previsto", "custo_spot", "custo_variavel",
  "lucro", "lucro_unitario", "tipo_de_imposto",
  "valor_unitario_por_caixa_entregue", "valor_pago_por_caixa_sem_imposto", "valor_pago_por_caixa_com_imposto",
  "valor_dropdown", "valor_unitario_do_ponto_do_motorista", "valor_unitario_do_ponto_do_ajudante",
  "valor_da_equipe_de_entrega_motorista", "valor_da_equipe_de_entrega_ajudante", "custo_variavel_cedbz",
  "lucro_unitario_cedbz", "lucro_variavel_por_caixa_entregue_ffcedbz",
] as const;

const TABELAS_DERIVADAS: { nome: string; migration: string; marca: RegExp }[] = [
  {
    nome: "snapshot_entity_type",
    migration: "0021_cobertura",
    marca: /INSERT INTO "snapshot_entity_type"/,
  },
  /*
    O catálogo de significados econômicos entra aqui, e não em
    `TABELAS_REMOVIDAS`, porque ele **nasce cheio**: as quinze linhas iniciais
    são um `INSERT` da própria `0028`, e o `up` as repõe levantando aquele
    statement do disco. Exigi-la vazia travaria todo deploy.

    O que ela pode guardar e nenhuma consulta reconstrói é o significado que a
    operação cadastrou na tela — `is_seed = false`. Esse caso tem pré-condição
    própria no `down`, e ela aborta, exatamente como `coverage_expectation`:
    decisão de gente não se descarta para encolher um diff.
  */
  {
    nome: "semantic_meaning",
    migration: "0028_significado_economico",
    marca: /INSERT INTO "semantic_meaning"/,
  },
];

/**
 * Colunas que o `down` remove de tabelas que ficam.
 *
 * Exportada porque é a lista que a reconciliação tem de cobrir. Depois que o
 * `down` roda, **só o `up` devolve estas colunas**: a fila de migrations não
 * consegue, porque o registro já dá por aplicadas as migrations que as criam. A
 * `0024_reconciliar_bridge` fecha esse buraco para as que dá para fechar, e
 * `reconciliacao-bridge.test.ts` exige que toda entrada daqui esteja de um dos
 * dois lados dessa fronteira — nunca esquecida no meio.
 */
export const COLUNAS_REMOVIDAS: [string, string][] = [
  ["snapshot", "canonical_snapshot_key"],
  ["ticket", "changed_parameter_count"],
  ["ticket", "vigencia_label"],
  ["ticket", "entity_description"],
  ["ticket_import", "parameter_columns"],
  ["fact", "inherited_from_snapshot_id"],
  // A `0019` não está aplicada no Development real (o registro para na `0018`),
  // mas o bridge não pode depender disso: num banco que já a tenha, estas três
  // e o CHECK que as acompanha entrariam no diff, e o CHECK é comportamento.
  ["assistant_message", "feedback"],
  ["assistant_message", "feedback_note"],
  ["assistant_message", "feedback_at"],
  // A `0022`, pelo mesmo motivo das três acima. As duas são nullable e sem
  // default — a forma exata da allowlist —, e ainda assim saem em vez de entrar
  // nela: a allowlist não é "onde coluna nova cabe", é a lista fechada que a
  // `0015` confere por tipo e aborta nomeando a diferença. Crescê-la afrouxaria
  // a conferência para ganhar dois `ADD COLUMN` que a fila cria de graça.
  ["attribute", "definition"],
  ["attribute_semantics", "definition"],
  // A `0023`, pelo mesmo motivo da `0022`: a direção econômica e a frase que a
  // explica são quatro colunas de texto nullable, exatamente a forma que a
  // allowlist aceita — e mesmo assim saem, porque a allowlist é uma lista
  // fechada conferida por tipo, e não um lugar onde coluna nova cabe.
  ["attribute", "economic_direction"],
  ["attribute", "economic_effect"],
  ["attribute_semantics", "economic_direction"],
  ["attribute_semantics", "economic_effect"],
  // A `0028`, pelo mesmo motivo. As três são nullable e sem default, e as duas
  // primeiras carregam a chave estrangeira para `semantic_meaning` — que o
  // `down` derruba logo abaixo. A ordem do DDL já é essa: coluna primeiro,
  // tabela depois, e o `RESTRICT` continua sendo quem decide.
  ["attribute", "meaning_id"],
  ["attribute_semantics", "meaning_id"],
  ["taxonomy_node", "created_by"],
  /*
    A `0032`, pelo mesmo motivo das anteriores: três colunas de `change_set` que
    Production não tem porque está parada na `0012`. São `NOT NULL` com default,
    forma que a allowlist **não** aceita — e é o desfecho certo, porque elas são
    dado derivado: recomputar a comparação as reconstrói.
  */
  ["change_set", "impacto_oficial_by_periodicity"],
  ["change_set", "deducao_rastro"],
  ["change_set", "mudancas_fora_do_total"],
  /*
    A `0037`, pelo mesmo contrato: `app_user.role` é NOT NULL com default,
    forma que a allowlist não aceita. Diferente das colunas de `change_set`,
    ela é decisão de gente — e é por isso que a `0038` que a repõe refaz o
    backfill pela mesma sentinela da `0037` (sem nenhum ADMIN, as contas
    existentes viram ADMIN): um Development que passe por down sem up volta ao
    estado pós-migration, nunca a um estado sem papel.
  */
  ["app_user", "role"],
];

/** Índices que o `down` remove. Exportada pelo motivo de `COLUNAS_REMOVIDAS`. */
export const INDICES_REMOVIDOS = [
  "snapshot_canonical_live_uq",
  "snapshot_canonical_revision_uq",
  "snapshot_canonical_key_idx",
  "fact_inherited_idx",
  "ticket_vigencia_idx",
  "fact_nao_aplicavel_idx",
  // A `0040`: no máximo uma leitura por decidir por arquivo, que é a trava
  // contra o reprocessamento em duplicidade. Sai como as demais — o Publishing
  // não a modela, e um índice único que ele tentasse criar em Production
  // encontraria dados que ele não sabe explicar.
  "import_run_leitura_aberta_uq",
];

/**
 * As três views da `0015`. Duas dependem da coluna gerada; a terceira não —
 * `freightcheck_fato_duplicado` olha só para `fact`.
 *
 * Ela sai mesmo assim, e o motivo é o critério, não a dependência: **não há
 * como provar que o Publishing ignora views.** Para funções há prova direta —
 * o deploy morreu chamando `freightcheck_snapshot_key`, o que significa que o
 * diff dele trazia a coluna gerada e não trazia a função. Para views não existe
 * evidência equivalente, e uma view que ele tentasse criar em Production
 * referenciaria colunas que só a fila cria. Na dúvida, o bridge remove.
 */
const VIEWS_REMOVIDAS = [
  "freightcheck_snapshot_ativo_duplicado",
  "freightcheck_identidade_vigencia",
  "freightcheck_fato_duplicado",
];

/**
 * As onze funções da identidade canônica, criadas pela `0015`.
 *
 * Production tem seis funções `freightcheck_*` — as da `0001` e da `0009` —, e
 * não tem nenhuma destas. Elas saem para que o estado pós-`down` seja
 * comparável a Production em **todas** as categorias, e não só nas que se
 * consegue argumentar. Depois da coluna gerada e das views, nada mais depende
 * delas: são posteriores a `freightcheck_correct_entity_type` e aos gatilhos de
 * imutabilidade, que portanto não as chamam.
 *
 * O `up` as recria antes de qualquer coisa que as use, levantando as definições
 * da própria `0015` — `CREATE OR REPLACE FUNCTION`, idempotente e sem dado.
 */
const FUNCOES_REMOVIDAS = [
  "freightcheck_sem_acento",
  "freightcheck_norm_documento",
  "freightcheck_norm_identificador",
  "freightcheck_norm_scope_code",
  "freightcheck_norm_canal",
  "freightcheck_canal_do_rotulo",
  "freightcheck_dataset_family",
  "freightcheck_canonical_scope",
  "freightcheck_serialize_scope",
  "freightcheck_iso_date",
  "freightcheck_snapshot_key",
];

/**
 * A função de gatilho da `0020`, que Production não tem.
 *
 * Sai pelo mesmo critério das onze acima — o estado pós-`down` precisa ser
 * comparável a Production em **todas** as categorias, e função é uma delas. O
 * gatilho que a chama já saiu junto com a tabela; a ordem no `down` garante
 * isso, e o `RESTRICT` continua sendo quem decide se algo mais dependia dela.
 */
const FUNCOES_REMOVIDAS_CHAMADOS = [
  "freightcheck_ticket_import_deletion_is_immutable",
];

const CHECKS_REMOVIDOS: [string, string][] = [
  ["snapshot", "snapshot_canal_nao_vazio_ck"],
  ["snapshot", "snapshot_dataset_family_nao_vazio_ck"],
  ["snapshot", "snapshot_canonical_scope_ck"],
  ["snapshot", "snapshot_canonical_scope_nao_vazio_ck"],
  ["assistant_message", "assistant_message_feedback_ck"],
  // A `0023` — as duas travas da coerência semântica. São comportamento, e não
  // forma: um Development que as tenha recusaria uma linha que o Publishing
  // aceita, então o `down` as derruba e o `up` as repõe.
  ["attribute", "attribute_semantica_coerente"],
  ["attribute_semantics", "attribute_semantics_semantica_coerente"],
  // A `0037` — o CHECK cai junto com a coluna `role`; está aqui para o `up`
  // e a `0038` o reporem em par com ela.
  ["app_user", "app_user_role_ck"],
  // As duas da `0040`. Acompanham as colunas do reprocessamento na allowlist:
  // as colunas ficam (são aditivas e nulas), as constraints saem, porque o
  // Publishing não as carrega e o `up` as repõe pela própria migration.
  ["import_run", "import_run_reprocess_of_fk"],
  ["import_run", "import_run_reprocess_completo"],
];

const NULLABLE_TEMPORARIO: [string, string][] = [
  ["snapshot", "dataset_family"],
  ["snapshot", "canal"],
  ["snapshot", "canonical_scope"],
];

const INDICES_LEGADOS: { nome: string; ddl: string }[] = [
  {
    nome: "snapshot_business_key_uq",
    ddl: `CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_business_key_uq" ON "snapshot"
            USING btree ("source_system","source_label","scope_hash","entity_type_set","revision")`,
  },
  {
    nome: "snapshot_business_key_live_uq",
    ddl: `CREATE UNIQUE INDEX IF NOT EXISTS "snapshot_business_key_live_uq" ON "snapshot"
            USING btree ("source_system","source_label","scope_hash","entity_type_set")
            WHERE "status" <> 'SUPERSEDED'`,
  },
  {
    nome: "ticket_attribute_idx",
    ddl: `CREATE INDEX IF NOT EXISTS "ticket_attribute_idx" ON "ticket" USING btree ("attribute_code")`,
  },
];

// ---------------------------------------------------------------------------
// Relatório
// ---------------------------------------------------------------------------

export interface BridgeReport {
  /** Pré-condições conferidas, na ordem, com o que cada uma mediu. */
  precondicoes: { nome: string; ok: boolean; detalhe: string }[];
  /** Objetos dependentes encontrados, por objeto que seria removido. */
  dependencias: { objeto: string; dependentes: string[] }[];
  /** DDL executado, em ordem. Em `dryRun`, o que teria sido executado. */
  ddl: string[];
  /** A conferência do estado residual, depois dos DDLs. */
  verificacao: { nome: string; ok: boolean; detalhe: string }[];
  dryRun: boolean;
  /**
   * O que o operador precisa saber e nenhuma conferência reprovou.
   *
   * Hoje há um só: a conferência contra a Production real não roda sem a URL
   * dela, e um bridge que passou sem essa medição passou sobre uma suposição —
   * a de que Production continua atrás. Calar isso faria o `✓` final dizer mais
   * do que ele sabe.
   */
  avisos: string[];
  /** Preenchido quando o bridge abortou. Nada foi aplicado. */
  falha?: string;
}

class BridgeAbortou extends Error {}

// ---------------------------------------------------------------------------
// Leitura de estrutura
// ---------------------------------------------------------------------------

async function existeTabela(c: pg.PoolClient, nome: string): Promise<boolean> {
  const { rows } = await c.query<{ e: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS e`,
    [`public."${nome}"`],
  );
  return rows[0]!.e;
}

async function existeColuna(
  c: pg.PoolClient,
  tabela: string,
  coluna: string,
): Promise<boolean> {
  const { rows } = await c.query<{ e: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS e`,
    [tabela, coluna],
  );
  return rows[0]!.e;
}

/**
 * A estrutura comparável de um banco — o que o critério final do `up` compara.
 *
 * Views e funções entram porque são exatamente o que um diff de schema não
 * modela, e portanto o que se perderia sem ninguém notar.
 */
export async function estruturaDe(
  c: pg.PoolClient | pg.Pool,
): Promise<string[]> {
  const { rows } = await c.query<{ linha: string }>(`
    SELECT linha FROM (
      SELECT 'COL  '||table_name||'.'||column_name||' '||data_type||' null='||is_nullable
             ||' gen='||coalesce((SELECT a.attgenerated::text FROM pg_attribute a
                  JOIN pg_class k ON k.oid=a.attrelid AND k.relnamespace='public'::regnamespace
                 WHERE k.relname=c.table_name AND a.attname=c.column_name),'')
             ||' def='||coalesce(column_default,'-') AS linha
        FROM information_schema.columns c
       WHERE table_schema='public'
      UNION ALL SELECT 'IDX  '||indexdef FROM pg_indexes WHERE schemaname='public'
      UNION ALL SELECT 'CON  '||conname||' '||pg_get_constraintdef(oid)
        FROM pg_constraint WHERE connamespace='public'::regnamespace
      UNION ALL SELECT 'TRG  '||t.tgname||' on '||k.relname
        FROM pg_trigger t JOIN pg_class k ON k.oid=t.tgrelid WHERE NOT t.tgisinternal
      UNION ALL SELECT 'FN   '||p.proname||'('||pg_get_function_arguments(p.oid)||')'
        FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname LIKE 'freightcheck%'
      UNION ALL SELECT 'VIEW '||viewname||' '||md5(definition) FROM pg_views WHERE schemaname='public'
      UNION ALL SELECT 'ENUM '||t.typname||' '||e.enumlabel
        FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
    ) s ORDER BY linha`);
  return rows.map((r) => r.linha);
}

// ---------------------------------------------------------------------------
// A proposta do Publishing, medida contra a Production real
// ---------------------------------------------------------------------------

/**
 * O que o Publishing faria com Production, se publicassem agora.
 *
 * ---------------------------------------------------------------------------
 * A suposição que este módulo carregava sem medir
 * ---------------------------------------------------------------------------
 * O bridge inteiro está escrito para um mundo em que **Production está atrás de
 * Development**: nesse mundo, encolher Development encolhe o diff, e o que
 * sobra são seis `ADD COLUMN`. `bridge.test.ts` prova isso — contra uma réplica
 * de Production reconstruída da fila até a `0012`, que era onde ela estava em
 * 15/08/2026.
 *
 * A suposição tem prazo, e ele venceu. Todo deploy que dá certo termina com o
 * servidor de Production rodando `runMigrations()` na partida, e depois disso
 * Production está **à frente** de um Development que perdeu a fila — por um
 * bridge que desceu e não subiu, ou por ninguém ter rodado `migrate` lá, que é
 * a política deste repositório. No dia em que isso acontece, a mesma operação
 * que protegia o deploy passa a produzir o oposto: o Publishing compara os dois
 * bancos, encontra em Production o que Development não tem, e propõe
 * **remover** de lá o que a fila criou.
 *
 * Foi o que apareceu em 17/08/2026, no `Provision`:
 *
 *     ALTER TABLE "attribute" DROP CONSTRAINT "attribute_meaning_id_semantic_meaning_id_fk";
 *     constraint "attribute_meaning_id_semantic_meaning_id_fk" of relation "attribute" does not exist
 *
 * A falha é ordem interna do gerador — a proposta derruba `semantic_meaning`
 * antes, e a FK cai junto com a tabela —, e é o menor dos problemas dela: a
 * mesma proposta levava `coverage_expectation`, `ticket_change` e
 * `ticket_import_deletion`, que são decisão de gente e registro append-only.
 *
 * ---------------------------------------------------------------------------
 * O que esta função mede
 * ---------------------------------------------------------------------------
 * A mesma comparação que o Publishing faz — introspecção dos dois bancos —,
 * pelo mesmo critério de `estruturaDe`: coluna, índice, constraint, gatilho,
 * função, view e enum. Uma linha que só Production tem é um objeto que a
 * proposta removeria de lá; uma que só Development tem é um objeto que ela
 * criaria. Nada é escrito em nenhum dos dois lados.
 *
 * Contra a réplica histórica de Production, `removeria` é vazia depois do
 * `down` — medido, não argumentado: é o que a suíte prende. Qualquer linha ali
 * é DDL destrutivo entrando em produção fora da fila.
 */
export interface PropostaDoPublishing {
  /** Só Production tem: o que a proposta **removeria** de lá. */
  removeria: string[];
  /** Só Development tem: o que a proposta **criaria** em Production. */
  criaria: string[];
}

export async function propostaDoPublishing(
  development: pg.PoolClient | pg.Pool,
  producao: pg.PoolClient | pg.Pool,
): Promise<PropostaDoPublishing> {
  const doDev = await estruturaDe(development);
  const daProd = await estruturaDe(producao);
  const emDev = new Set(doDev);
  const emProd = new Set(daProd);
  return {
    removeria: daProd.filter((linha) => !emDev.has(linha)),
    criaria: doDev.filter((linha) => !emProd.has(linha)),
  };
}

/**
 * A mesma medição pela URL dos dois bancos, sem abrir transação em nenhum.
 *
 * É o que o `bridge-cli conferir` roda antes de alguém apertar Publish, e é
 * somente leitura dos dois lados — inclusive de Production, que é o único banco
 * deste projeto onde uma ferramenta não escreve nunca.
 */
export async function conferirProposta(
  developmentUrl: string,
  producaoUrl: string,
): Promise<PropostaDoPublishing> {
  const dev = new pg.Pool({ connectionString: developmentUrl });
  const prod = new pg.Pool({ connectionString: producaoUrl });
  try {
    return await propostaDoPublishing(dev, prod);
  } finally {
    await dev.end();
    await prod.end();
  }
}

/**
 * O texto do aborto, quando Production tem o que Development perdeu.
 *
 * Escrito uma vez porque sai por dois caminhos — o `down` que recusa e o
 * `conferir` que reprova — e as duas têm de dizer a mesma coisa, com a mesma
 * lista, para que quem lê uma reconheça a outra.
 */
export function textoDaProposta(removeria: string[]): string {
  return (
    `Production tem ${removeria.length} objeto(s) que Development não tem. ` +
    `Publicar assim faz a proposta do Publishing **removê-los de lá** — é DDL ` +
    `destrutivo em produção, fora da fila. Development é que está atrás: ` +
    `conclua o bridge (bridge:up) e rode a fila (migrate) antes de publicar.\n` +
    removeria.map((l) => `    ${l}`).join("\n")
  );
}

// ---------------------------------------------------------------------------
// Dependências — a alternativa ao CASCADE
// ---------------------------------------------------------------------------

/**
 * O que depende deste objeto, tirando o que o bridge já vai remover.
 *
 * `DROP ... CASCADE` resolveria isso sozinho, e é justamente por isso que não é
 * usado: ele remove em silêncio o que ninguém previu. Aqui a dependência
 * inesperada aparece nominalmente e derruba o bridge.
 */
async function dependentesInesperados(
  c: pg.PoolClient,
  relname: string,
  previstos: Set<string>,
): Promise<string[]> {
  const { rows } = await c.query<{ nome: string; tipo: string }>(
    `SELECT DISTINCT dep.relname AS nome,
            CASE dep.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'
                             WHEN 'i' THEN 'índice' ELSE dep.relkind::text END AS tipo
       FROM pg_depend d
       JOIN pg_class alvo ON alvo.oid = d.refobjid
       JOIN pg_rewrite r  ON r.oid = d.objid
       JOIN pg_class dep  ON dep.oid = r.ev_class
      WHERE alvo.relname = $1
        AND alvo.relnamespace = 'public'::regnamespace
        AND dep.relname <> $1
      UNION
     SELECT c2.relname, 'FK ' || con.conname
       FROM pg_constraint con
       JOIN pg_class c2 ON c2.oid = con.conrelid
      WHERE con.confrelid = to_regclass($2)
        AND con.conrelid <> con.confrelid`,
    [relname, `public."${relname}"`],
  );
  return rows
    .filter((r) => !previstos.has(r.nome))
    .map((r) => `${r.tipo} ${r.nome}`);
}

// ---------------------------------------------------------------------------
// bridge-down
// ---------------------------------------------------------------------------

export interface DownOptions {
  dryRun?: boolean;
  /**
   * A Production real, somente leitura, para a conferência final.
   *
   * Sem ela o `down` continua rodando — e continua supondo que Production está
   * atrás, que é a suposição que venceu (ver `propostaDoPublishing`). Com ela, o
   * bridge mede a proposta que o Publishing montaria e **recusa a descer** se
   * ela remover qualquer coisa de lá. A transação é uma só, então recusar é
   * devolver Development ao estado em que ele estava.
   */
  producaoUrl?: string;
}

export async function bridgeDown(
  connectionString: string,
  options: DownOptions = {},
): Promise<BridgeReport> {
  const dryRun = options.dryRun === true;
  const pool = new pg.Pool({ connectionString });
  const c = await pool.connect();
  const rel: BridgeReport = {
    precondicoes: [],
    dependencias: [],
    ddl: [],
    verificacao: [],
    avisos: [],
    dryRun,
  };

  const exec = async (sql: string) => {
    rel.ddl.push(sql.trim().replace(/\s+/g, " "));
    await c.query(sql);
  };

  try {
    await c.query("BEGIN");

    // -----------------------------------------------------------------------
    // 1. Pré-condições — todas antes do primeiro DDL
    // -----------------------------------------------------------------------
    const exigir = (nome: string, ok: boolean, detalhe: string) => {
      rel.precondicoes.push({ nome, ok, detalhe });
      if (!ok) throw new BridgeAbortou(`pré-condição falhou — ${nome}: ${detalhe}`);
    };

    for (const t of TABELAS_REMOVIDAS) {
      if (!(await existeTabela(c, t))) {
        rel.precondicoes.push({
          nome: `${t} vazia`,
          ok: true,
          detalhe: "tabela não existe",
        });
        continue;
      }
      const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM "${t}"`);
      exigir(
        `${t} vazia`,
        Number(rows[0]!.n) === 0,
        `${rows[0]!.n} linha(s) — o bridge remove esta tabela e não copia dado`,
      );
    }

    if (await existeColuna(c, "fact", "inherited_from_snapshot_id")) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM "fact" WHERE "inherited_from_snapshot_id" IS NOT NULL`,
      );
      exigir("nenhum fato herdado", Number(rows[0]!.n) === 0, `${rows[0]!.n} fato(s) herdado(s)`);
    }

    if (await existeTabela(c, "ticket")) {
      const { rows } = await c.query<{ n: string }>(`SELECT count(*) AS n FROM "ticket"`);
      exigir("ticket sem linhas", Number(rows[0]!.n) === 0, `${rows[0]!.n} chamado(s)`);
    }

    if (await existeColuna(c, "assistant_message", "feedback")) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM "assistant_message"
          WHERE "feedback" IS NOT NULL OR "feedback_note" IS NOT NULL OR "feedback_at" IS NOT NULL`,
      );
      exigir(
        "nenhum feedback registrado",
        Number(rows[0]!.n) === 0,
        `${rows[0]!.n} mensagem(ns) com feedback — o bridge remove estas colunas`,
      );
    }

    if (await existeTabela(c, "semantic_meaning")) {
      /*
        As quinze linhas do catálogo inicial voltam do disco; as que a operação
        cadastrou, não. Um `R$ por pallet` criado por alguém na tela de
        confirmação é decisão humana, e pode estar apontado por atributos já
        confirmados — descartá-lo para encolher um diff é a mesma coisa que
        `coverage_expectation` proíbe.
      */
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM "semantic_meaning" WHERE NOT "is_seed"`,
      );
      exigir(
        "nenhum significado cadastrado na tela",
        Number(rows[0]!.n) === 0,
        `${rows[0]!.n} significado(s) fora do catálogo inicial — o bridge remove ` +
          `esta tabela e só o catálogo volta do disco`,
      );
    }

    if (await existeColuna(c, "ticket_import", "parameter_columns")) {
      const { rows } = await c.query<{ n: string }>(
        `SELECT count(*) AS n FROM "ticket_import"
          WHERE "parameter_columns" IS NOT NULL AND "parameter_columns" <> '[]'::jsonb`,
      );
      exigir(
        "parameter_columns sem conteúdo",
        Number(rows[0]!.n) === 0,
        `${rows[0]!.n} envio(s) com colunas de parâmetro registradas`,
      );
    }

    /*
      Não se derruba o que não se sabe levantar. Construir o plano do `up` aqui
      — antes do primeiro DDL — prova que cada objeto removido tem, no
      repositório, a definição exata que o restaura, e que nenhuma delas mexe em
      dados. Se uma migration for editada de um jeito que quebre esse
      levantamento, o `down` para aqui em vez de deixar Development pela metade.

      Também é o que substitui a antiga exigência de "a função tal existe no
      banco": agora que o `down` remove as funções da identidade, exigir a
      presença delas quebraria a repetibilidade dele.
    */
    let objetosDoUp = 0;
    try {
      objetosDoUp = planoUp().length;
    } catch (err) {
      throw new BridgeAbortou(
        `o plano de restauração não pôde ser construído: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    rel.precondicoes.push({
      nome: "plano de restauração construível",
      ok: true,
      detalhe: `${objetosDoUp} objetos, nenhum statement mexe em dados`,
    });

    // -----------------------------------------------------------------------
    // 2. Dependências — nada de CASCADE
    // -----------------------------------------------------------------------
    const previstos = new Set<string>([
      ...TABELAS_REMOVIDAS,
      ...TABELAS_DERIVADAS.map((t) => t.nome),
      ...INDICES_REMOVIDOS,
      ...VIEWS_REMOVIDAS,
    ]);
    /*
      Quem depende de um alvo **porque o bridge também remove a coluna que
      depende**.

      `attribute.meaning_id` e `attribute_semantics.meaning_id` apontam para
      `semantic_meaning`, e as duas saem em `COLUNAS_REMOVIDAS`, antes da tabela,
      na seção de DDL. A varredura de dependências roda antes de qualquer DDL —
      é o desenho deste módulo — e veria as duas FKs como surpresa.

      Por alvo, e não no conjunto global: pôr "attribute" em `previstos` calaria
      a varredura para todos os outros alvos também, e é justamente ela que
      impede uma dependência nova de passar despercebida.
    */
    const previstosPorAlvo: Record<string, string[]> = {
      semantic_meaning: ["attribute", "attribute_semantics"],
    };
    for (const alvo of [
      ...TABELAS_REMOVIDAS,
      ...TABELAS_DERIVADAS.map((t) => t.nome),
      "snapshot",
    ]) {
      if (!(await existeTabela(c, alvo))) continue;
      const doAlvo = new Set([...previstos, ...(previstosPorAlvo[alvo] ?? [])]);
      const dependentes =
        alvo === "snapshot"
          ? (await dependentesInesperados(c, alvo, doAlvo)).filter((d) =>
              // De `snapshot` só interessa quem depende da coluna gerada; as
              // duas views são previstas, o resto tem de aparecer.
              VIEWS_REMOVIDAS.every((v) => !d.endsWith(v)),
            )
          : await dependentesInesperados(c, alvo, doAlvo);
      rel.dependencias.push({ objeto: alvo, dependentes });
      if (alvo !== "snapshot" && dependentes.length > 0) {
        throw new BridgeAbortou(
          `dependência inesperada em ${alvo}: ${dependentes.join(", ")}. ` +
            `O bridge não usa CASCADE — confira o que apareceu e decida à mão.`,
        );
      }
    }

    // -----------------------------------------------------------------------
    // 3. DDL — sem CASCADE em nenhum ponto
    // -----------------------------------------------------------------------
    for (const v of VIEWS_REMOVIDAS) await exec(`DROP VIEW IF EXISTS "${v}" RESTRICT`);
    for (const i of INDICES_REMOVIDOS) await exec(`DROP INDEX IF EXISTS "${i}" RESTRICT`);
    for (const [t, cc] of CHECKS_REMOVIDOS) {
      await exec(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${cc}" RESTRICT`);
    }
    for (const [t, col] of NULLABLE_TEMPORARIO) {
      if (await existeColuna(c, t, col)) {
        await exec(`ALTER TABLE "${t}" ALTER COLUMN "${col}" DROP NOT NULL`);
      }
    }
    for (const [t, col] of COLUNAS_REMOVIDAS) {
      if (await existeColuna(c, t, col)) {
        await exec(`ALTER TABLE "${t}" DROP COLUMN "${col}" RESTRICT`);
      }
    }
    for (const t of [...TABELAS_REMOVIDAS, ...TABELAS_DERIVADAS.map((d) => d.nome)]) {
      if (await existeTabela(c, t)) await exec(`DROP TABLE "${t}" RESTRICT`);
    }
    // Depois da coluna gerada e das views, nada mais depende delas. `RESTRICT`
    // continua sendo quem decide: se algo depender, o bridge cai aqui.
    for (const f of [...FUNCOES_REMOVIDAS, ...FUNCOES_REMOVIDAS_CHAMADOS]) {
      const { rows } = await c.query<{ assinatura: string }>(
        `SELECT p.oid::regprocedure::text AS assinatura FROM pg_proc p
          WHERE p.pronamespace='public'::regnamespace AND p.proname=$1`,
        [f],
      );
      for (const r of rows) await exec(`DROP FUNCTION ${r.assinatura} RESTRICT`);
    }
    for (const col of COLUNAS_LEGADAS_TICKET) {
      await exec(
        `ALTER TABLE "ticket" ADD COLUMN IF NOT EXISTS "${col.nome}" ${col.ddl}`,
      );
    }
    for (const i of INDICES_LEGADOS) await exec(i.ddl);

    // -----------------------------------------------------------------------
    // 4. Verificação do estado residual — só então o script confirma sucesso
    // -----------------------------------------------------------------------
    const conferir = (nome: string, ok: boolean, detalhe: string) => {
      rel.verificacao.push({ nome, ok, detalhe });
      if (!ok) throw new BridgeAbortou(`verificação falhou — ${nome}: ${detalhe}`);
    };

    for (const a of ALLOWLIST) {
      const { rows } = await c.query<{ t: string; n: string; d: string | null }>(
        `SELECT data_type AS t, is_nullable AS n, column_default AS d
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
        [a.tabela, a.coluna],
      );
      const r = rows[0];
      if (!r && a.aindaPodeNaoExistir) continue;
      conferir(
        `allowlist ${a.tabela}.${a.coluna}`,
        !!r && r.t === a.tipo && r.n === "YES" && r.d === null,
        r ? `${r.t} null=${r.n} default=${r.d ?? "-"}` : "ausente",
      );
    }

    for (const t of [...TABELAS_REMOVIDAS, ...TABELAS_DERIVADAS.map((d) => d.nome)]) {
      conferir(`${t} removida`, !(await existeTabela(c, t)), "ainda existe");
    }
    for (const [t, col] of COLUNAS_REMOVIDAS) {
      conferir(`${t}.${col} removida`, !(await existeColuna(c, t, col)), "ainda existe");
    }
    for (const col of COLUNAS_LEGADAS_TICKET) {
      conferir(
        `ticket.${col.nome} restaurada`,
        await existeColuna(c, "ticket", col.nome),
        "ausente",
      );
    }
    const { rows: idx } = await c.query<{ nome: string }>(
      `SELECT indexname AS nome FROM pg_indexes WHERE schemaname='public'`,
    );
    const nomes = new Set(idx.map((r) => r.nome));
    for (const i of INDICES_REMOVIDOS) {
      conferir(`índice ${i} removido`, !nomes.has(i), "ainda existe");
    }
    for (const i of INDICES_LEGADOS) {
      conferir(`índice ${i.nome} restaurado`, nomes.has(i.nome), "ausente");
    }
    const { rows: gerada } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_attribute a
         JOIN pg_class k ON k.oid=a.attrelid AND k.relnamespace='public'::regnamespace
        WHERE a.attgenerated <> '' AND NOT a.attisdropped`,
    );
    conferir(
      "nenhuma coluna gerada no schema",
      Number(gerada[0]!.n) === 0,
      `${gerada[0]!.n} coluna(s) gerada(s) — o Publishing tentaria recriá-la`,
    );
    const { rows: views } = await c.query<{ nome: string }>(
      `SELECT viewname AS nome FROM pg_views WHERE schemaname='public'`,
    );
    conferir(
      "nenhuma view do schema canônico",
      views.length === 0,
      `sobrou: ${views.map((v) => v.nome).join(", ")}`,
    );
    const { rows: fns } = await c.query<{ nome: string }>(
      `SELECT proname AS nome FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND proname = ANY($1)`,
      [FUNCOES_REMOVIDAS],
    );
    conferir(
      "nenhuma função da identidade",
      fns.length === 0,
      `sobrou: ${fns.map((f) => f.nome).join(", ")}`,
    );

    /*
      A última conferência é a única que não olha para Development.

      Todas as de cima medem o estado residual contra a lista que este módulo
      declara — e passariam iguais no dia em que Production tiver andado, porque
      nenhuma delas pergunta nada a Production. É essa a conferência que faltava
      quando o `Provision` de 17/08/2026 propôs derrubar `semantic_meaning`.

      Ela roda **dentro da transação do `down`**, sobre o estado já reduzido: o
      que se quer saber não é se os dois bancos concordam agora, é se vão
      concordar no instante em que o Publishing os comparar — que é depois do
      `down`, com Development já encolhido. Reprovar aqui desfaz o bridge
      inteiro, que é o desfecho certo: um Development encolhido é justamente o
      que transforma "Production está à frente" em DDL destrutivo.
    */
    if (options.producaoUrl) {
      const producao = new pg.Pool({ connectionString: options.producaoUrl });
      try {
        const proposta = await propostaDoPublishing(c, producao);
        conferir(
          "Production não tem nada que Development perdeu",
          proposta.removeria.length === 0,
          textoDaProposta(proposta.removeria),
        );
        rel.verificacao.push({
          nome: "a proposta do Publishing é só aditiva",
          ok: true,
          detalhe: `${proposta.criaria.length} objeto(s) a criar em Production`,
        });
      } finally {
        await producao.end();
      }
    } else {
      rel.avisos.push(
        "a conferência contra a Production real não rodou: sem " +
          "PRODUCTION_DATABASE_URL (ou --producao=), o bridge supõe que " +
          "Production continua atrás de Development. Depois de qualquer deploy " +
          "que tenha dado certo, ela não está.",
      );
    }

    /*
      O marcador entra **com** o bridge, e não depois dele.

      O `down` inteiro é uma transação — ou entra tudo, ou nada. O marcador vai
      junto: um `down` que aborta não deixa marcador, e um `down` que entra não
      tem como deixar de deixá-lo. Escrevê-lo depois do `COMMIT` criaria uma
      segunda verdade sobre o mesmo fato, capaz de discordar da primeira
      exatamente na janela em que alguém precisaria dela.

      Em `dryRun` ele é escrito e desfeito junto com o resto, que é o que faz o
      ensaio ensaiar também esta parte.
    */
    for (const comando of CRIAR_MARCADOR) await c.query(comando);
    await c.query(MARCAR_DESCIDA, [JSON.stringify(rel.ddl)]);

    if (dryRun) await c.query("ROLLBACK");
    else await c.query("COMMIT");
    return rel;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    rel.falha = err instanceof Error ? err.message : String(err);
    return rel;
  } finally {
    c.release();
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// bridge-up
// ---------------------------------------------------------------------------

/**
 * Um statement estrutural levantado de uma migration, pelo nome do objeto.
 *
 * Reaproveitar o texto da migration é o que garante que a definição restaurada
 * é **a mesma** — um índice parcial reescrito à mão aqui divergiria em silêncio,
 * que é exatamente o defeito que `CREATE INDEX IF NOT EXISTS` não pega.
 *
 * Cada statement levantado passa por `mexeEmDados`: se carregar `INSERT`,
 * `UPDATE` ou `DELETE` fora de corpo de função, o `up` aborta em vez de
 * reaplicar transformação de dado que não é dele.
 */
function levantar(tag: string, marca: RegExp): string {
  const m = readMigrations().find((x) => x.tag === tag);
  if (!m) throw new BridgeAbortou(`migration ${tag} não encontrada`);
  const achados = m.statements.filter((s) => marca.test(s));
  if (achados.length !== 1) {
    throw new BridgeAbortou(
      `esperava 1 statement casando ${marca} em ${tag}, achei ${achados.length}`,
    );
  }
  const sql = achados[0]!;
  if (mexeEmDados([sql])) {
    throw new BridgeAbortou(
      `o statement de ${tag} casado por ${marca} mexe em dados; o bridge-up só restaura estrutura`,
    );
  }
  return sql;
}

/**
 * O plano de restauração, nominal e ordenado.
 *
 * Não é "reexecutar a 0013 até a 0018": é uma lista de objetos, cada um com a
 * definição que a sua migration proprietária lhe dá. Nenhum backfill, nenhuma
 * fusão, nenhuma validação de dado histórico é reaplicada.
 */
export interface PassoUp {
  objeto: string;
  sql: string;
  /** A migration dona do objeto. O `up` só o restaura se ela estiver registrada. */
  migration: string;
  /**
   * O passo repovoa uma tabela derivada, e por isso escreve linhas.
   *
   * É a única exceção à regra "o `up` só restaura estrutura", e ela é estreita
   * de propósito: vale apenas para as tabelas de `TABELAS_DERIVADAS`, cujo
   * conteúdo inteiro é uma consulta sobre o canônico, e o statement é levantado
   * da migration proprietária em vez de reescrito aqui. Marcar em vez de
   * esconder é o que permite ao relatório dizer quantos passos escrevem.
   */
  reconstroiDados?: true;
}

/**
 * O statement que repovoa uma tabela derivada, levantado do disco.
 *
 * Gêmeo de `levantar`, com a condição invertida: aqui o statement **tem** de
 * mexer em dados, senão não é reconstrução e a lista está errada. A conferência
 * existe para que trocar o `INSERT` da migration por outra coisa quebre este
 * caminho em vez de deixar a tabela silenciosamente vazia depois do `up`.
 */
function reconstruir(tag: string, marca: RegExp): string {
  const m = readMigrations().find((x) => x.tag === tag);
  if (!m) throw new BridgeAbortou(`migration ${tag} não encontrada`);
  const achados = m.statements.filter((s) => marca.test(s));
  if (achados.length !== 1) {
    throw new BridgeAbortou(
      `esperava 1 statement casando ${marca} em ${tag}, achei ${achados.length}`,
    );
  }
  const sql = achados[0]!;
  if (!mexeEmDados([sql])) {
    throw new BridgeAbortou(
      `o statement de ${tag} casado por ${marca} não repovoa nada; uma tabela derivada sem reconstrução ficaria vazia depois do up`,
    );
  }
  return sql;
}

function planoUp(): PassoUp[] {
  const p: PassoUp[] = [];
  const add = (migration: string, objeto: string, sql: string) =>
    p.push({ objeto, sql, migration });

  const M13 = "0013_chamados_por_parametro";
  const M14 = "0014_chamados_formato_real";
  const M15 = "0015_canonical_identity";
  const M16 = "0016_canonical_identity_enforcement";
  const M17 = "0017_fato_herdado";
  const M18 = "0018_identidade_forte";
  const M19 = "0019_assistant_feedback";
  const M20 = "0020_chamados_exclusao";
  const M40 = "0040_reprocessamento";

  // 1. Desfaz o estado legado que o `down` recriou. Quem o desfaz é a `0013`.
  for (const col of COLUNAS_LEGADAS_TICKET) {
    add(M13, `ticket.${col.nome}`, `ALTER TABLE "ticket" DROP COLUMN IF EXISTS "${col.nome}" RESTRICT`);
  }
  add(M13, "índice ticket_attribute_idx", `DROP INDEX IF EXISTS "ticket_attribute_idx" RESTRICT`);
  for (const i of ["snapshot_business_key_uq", "snapshot_business_key_live_uq"]) {
    add(M16, `índice ${i}`, `DROP INDEX IF EXISTS "${i}" RESTRICT`);
  }

  // 2. Colunas, com a definição da migration proprietária.
  add(M13, "ticket.changed_parameter_count", levantar(M13, /ADD COLUMN IF NOT EXISTS "changed_parameter_count"/));
  add(M13, "ticket_import.parameter_columns", levantar(M13, /ADD COLUMN IF NOT EXISTS "parameter_columns"/));
  add(M14, "ticket.vigencia_label", levantar(M14, /ADD COLUMN IF NOT EXISTS "vigencia_label"/));
  add(M14, "ticket.entity_description", levantar(M14, /ADD COLUMN IF NOT EXISTS "entity_description"/));
  add(M17, "fact.inherited_from_snapshot_id", levantar(M17, /ADD COLUMN IF NOT EXISTS "inherited_from_snapshot_id"/));

  // 3. Tabelas e o que vem com elas.
  add(M13, "ticket_change", levantar(M13, /CREATE TABLE IF NOT EXISTS "ticket_change"/));
  add(M13, "FKs de ticket_change", levantar(M13, /ticket_change_ticket_id_ticket_id_fk/));
  for (const i of [
    "ticket_change_grain_uq",
    "ticket_change_import_idx",
    "ticket_change_ticket_idx",
    "ticket_change_attribute_idx",
    "ticket_change_parameter_idx",
  ]) {
    add(M13, `índice ${i}`, levantar(M13, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(M14, "ticket_change.change_kind", levantar(M14, /ADD COLUMN IF NOT EXISTS "change_kind"/));
  add(M14, "índice ticket_change_kind_idx", levantar(M14, /INDEX IF NOT EXISTS "ticket_change_kind_idx"/));
  add(M14, "índice ticket_vigencia_idx", levantar(M14, /INDEX IF NOT EXISTS "ticket_vigencia_idx"/));
  add(M17, "índice fact_inherited_idx", levantar(M17, /INDEX IF NOT EXISTS "fact_inherited_idx"/));
  add(M16, "snapshot_merge", levantar(M16, /CREATE TABLE IF NOT EXISTS "snapshot_merge"/));
  add(M16, "import_decision", levantar(M16, /CREATE TABLE IF NOT EXISTS "import_decision"/));
  for (const i of ["import_decision_run_idx", "import_decision_key_idx", "import_decision_sha_idx"]) {
    add(M16, `índice ${i}`, levantar(M16, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }

  // 4. A identidade canônica. As funções vêm primeiro: a coluna gerada e as
  //    views as chamam, e `CREATE OR REPLACE FUNCTION` é idempotente.
  for (const f of FUNCOES_REMOVIDAS) {
    add(M15, `função ${f}`, levantar(M15, new RegExp(`CREATE OR REPLACE FUNCTION ${f}\\(`)));
  }
  add(M15, "snapshot.canonical_snapshot_key", levantar(M15, /ADD COLUMN "canonical_snapshot_key" text/));
  add(M15, "índice snapshot_canonical_key_idx", levantar(M15, /snapshot_canonical_key_idx/));
  add(M16, "índices únicos da identidade", levantar(M16, /snapshot_canonical_live_uq/));
  for (const v of VIEWS_REMOVIDAS) {
    // O `DROP` antes do `CREATE` é o que torna o `up` repetível: a `0015` tem
    // os dois como statements separados, e levantar só o `CREATE` faria a
    // segunda execução morrer em `relation already exists`.
    add(M15, `view ${v}`, `DROP VIEW IF EXISTS "${v}" RESTRICT`);
    add(M15, `view ${v}`, levantar(M15, new RegExp(`CREATE VIEW "${v}"`)));
  }

  // A `0020` — a função antes do gatilho que a chama, e a tabela antes dos dois.
  add(
    M20,
    "função freightcheck_ticket_import_deletion_is_immutable",
    levantar(M20, /CREATE OR REPLACE FUNCTION freightcheck_ticket_import_deletion_is_immutable\(/),
  );
  add(M20, "ticket_import_deletion", levantar(M20, /CREATE TABLE IF NOT EXISTS "ticket_import_deletion"/));
  for (const i of [
    "ticket_import_deletion_deleted_at_idx",
    "ticket_import_deletion_sha256_idx",
  ]) {
    add(M20, `índice ${i}`, levantar(M20, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(
    M20,
    "gatilho ticket_import_deletion_immutable",
    levantar(M20, /CREATE TRIGGER ticket_import_deletion_immutable/),
  );

  // A `0019` — presente só em bancos que chegaram até ela.
  for (const col of ["feedback", "feedback_note", "feedback_at"]) {
    add(M19, `assistant_message.${col}`, levantar(M19, new RegExp(`ADD COLUMN IF NOT EXISTS "${col}"`)));
  }
  add(M19, "assistant_message_feedback_ck", levantar(M19, /DROP CONSTRAINT IF EXISTS "assistant_message_feedback_ck"/));
  add(M19, "assistant_message_feedback_ck", levantar(M19, /ADD CONSTRAINT\s+"assistant_message_feedback_ck"/));

  // A `0021` — as duas tabelas da cobertura. `snapshot_entity_type` volta
  // estrutura primeiro e conteúdo depois, com o próprio backfill da migration:
  // é a única escrita de linha do plano, e ela é marcada como tal.
  const M21 = "0021_cobertura";
  add(M21, "coverage_expectation", levantar(M21, /CREATE TABLE IF NOT EXISTS "coverage_expectation"/));
  for (const i of ["coverage_expectation_lookup_idx", "coverage_expectation_attribute_idx"]) {
    add(M21, `índice ${i}`, levantar(M21, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(M21, "índice fact_nao_aplicavel_idx", levantar(M21, /INDEX IF NOT EXISTS "fact_nao_aplicavel_idx"/));
  add(M21, "snapshot_entity_type", levantar(M21, /CREATE TABLE IF NOT EXISTS "snapshot_entity_type"/));
  add(M21, "FK de snapshot_entity_type", levantar(M21, /snapshot_entity_type_snapshot_id_snapshot_id_fk/));
  for (const i of ["snapshot_entity_type_uq", "snapshot_entity_type_type_idx"]) {
    add(M21, `índice ${i}`, levantar(M21, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  p.push({
    migration: M21,
    objeto: "snapshot_entity_type (reconstrução)",
    sql: reconstruir(M21, /INSERT INTO "snapshot_entity_type"/),
    reconstroiDados: true,
  });

  // A `0022` — o significado escrito pelo curador. Duas colunas de texto e nada
  // mais: sem índice, sem constraint, sem backfill. A tabela é nomeada dentro
  // da marca porque as duas linhas são idênticas fora dela, e `levantar` exige
  // casar exatamente um statement.
  const M22 = "0022_significado";
  for (const t of ["attribute", "attribute_semantics"]) {
    add(
      M22,
      `${t}.definition`,
      levantar(M22, new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "definition"`)),
    );
  }

  // A `0023` — a coerência entre unidade, tipo e agregação. A normalização vem
  // junto e antes: a constraint não anexa sobre a linha que a viola, e o export
  // real tem duas (os dois `prazoPagamento`, tipo UNKNOWN com média proposta).
  const M23 = "0023_semantica_coerente";
  // A normalização vem primeiro e é escrita de linha, como o backfill da 0021:
  // a constraint não anexa sobre a linha que a viola, e o `up` precisa da mesma
  // ordem que a migration teve.
  p.push({
    migration: M23,
    objeto: "agregações impossíveis, normalizadas antes da trava",
    sql: reconstruir(M23, /UPDATE "attribute"/),
    reconstroiDados: true,
  });
  for (const t of ["attribute", "attribute_semantics"]) {
    const nome = t === "attribute" ? "attribute_semantica_coerente" : "attribute_semantics_semantica_coerente";
    add(M23, `${nome} (drop)`, levantar(M23, new RegExp(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${nome}"`)));
    add(M23, nome, levantar(M23, new RegExp(`ALTER TABLE "${t}" ADD CONSTRAINT "${nome}"`)));
  }


  // A `0026` — a leitura econômica. Mesma forma da `0022`: quatro colunas de
  // texto, sem índice, sem constraint, sem backfill. A tabela **e** a coluna
  // entram na marca porque as quatro linhas só diferem nesses dois pontos, e
  // `levantar` exige casar exatamente um statement.
  //
  // Ela já foi renumerada duas vezes, e as duas pela mesma causa: nasceu `0023`
  // e a `main` avançou com `0023_semantica_coerente`; virou `0025` e a `main`
  // avançou com `0025_semantica_inicial`. Um branch longo colide com o próximo
  // número livre toda vez que a fila anda.
  //
  // Da segunda vez o `_journal.json` ficou impecável e este literal continuou
  // apontando para o número velho: `levantar` procura a migration pelo nome,
  // não a encontra, e o plano de restauração inteiro falha — onze casos do
  // `bridge` de uma vez, com uma mensagem que não diz "renumeração". A fila
  // conhece os índices; ela não conhece quem escreveu o nome numa string.
  const M26 = "0026_direcao_economica";
  for (const t of ["attribute", "attribute_semantics"]) {
    for (const col of ["economic_direction", "economic_effect"]) {
      add(
        M26,
        `${t}.${col}`,
        levantar(M26, new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "${col}"`)),
      );
    }
  }
  /*
    A `0028` — o cadastro de significados econômicos e o ponteiro para ele.

    A ordem aqui é a da própria migration, e ela importa: tabela, índices,
    colunas, chaves estrangeiras, catálogo, constraints e só então o backfill.
    O backfill é a leitura de volta — ele deduz `meaning_id` dos quatro campos
    técnicos que nunca saíram do banco —, e é por isso que derrubar a coluna no
    `down` não perde informação: o `up` a reconstrói da mesma fonte de que ela
    saiu.

    As duas constraints da `0023` são reescritas aqui, depois de o bloco da
    `0023` acima tê-las reposto: a `0028` troca a lista fechada de três razões
    pelo prefixo `BRL_`, e a versão que tem de sobrar é a última.
  */
  const M28 = "0028_significado_economico";
  add(M28, "semantic_meaning", levantar(M28, /CREATE TABLE IF NOT EXISTS "semantic_meaning"/));
  for (const i of [
    "semantic_meaning_code_uq",
    "semantic_meaning_label_uq",
    "semantic_meaning_scope_idx",
  ]) {
    add(M28, `índice ${i}`, levantar(M28, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  for (const [t, col] of [
    ["attribute", "meaning_id"],
    ["attribute_semantics", "meaning_id"],
    ["taxonomy_node", "created_by"],
  ] as const) {
    add(
      M28,
      `${t}.${col}`,
      levantar(M28, new RegExp(`ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS "${col}"`)),
    );
  }
  add(M28, "FK attribute.meaning_id", levantar(M28, /attribute_meaning_id_semantic_meaning_id_fk/));
  add(
    M28,
    "FK attribute_semantics.meaning_id",
    levantar(M28, /attribute_semantics_meaning_id_semantic_meaning_id_fk/),
  );
  p.push({
    migration: M28,
    objeto: "catálogo inicial de significados",
    sql: reconstruir(M28, /INSERT INTO "semantic_meaning"/),
    reconstroiDados: true,
  });
  for (const [t, nome] of [
    ["attribute", "attribute_semantica_coerente"],
    ["attribute_semantics", "attribute_semantics_semantica_coerente"],
    ["semantic_meaning", "semantic_meaning_semantica_coerente"],
  ] as const) {
    add(M28, `${nome} (drop)`, levantar(M28, new RegExp(`ALTER TABLE "${t}" DROP CONSTRAINT IF EXISTS "${nome}"`)));
    add(M28, nome, levantar(M28, new RegExp(`ALTER TABLE "${t}" ADD CONSTRAINT "${nome}"`)));
  }
  for (const [objeto, marca] of [
    ["attribute.meaning_id (leitura de volta)", /UPDATE "attribute" a/],
    ["attribute_semantics.meaning_id (leitura de volta)", /UPDATE "attribute_semantics" v/],
  ] as const) {
    p.push({
      migration: M28,
      objeto,
      sql: reconstruir(M28, marca),
      reconstroiDados: true,
    });
  }

  // A `0032` — o universo esperado. A tabela nova do grão da entidade, e a
  // reabertura do CHECK de origem: `coverage_expectation` volta da `0021` com a
  // lista antiga (`CONTRATO`, `CURADORIA`), então o par drop/add tem de vir
  // **depois** dela, ou o banco restaurado recusaria toda linha `CATALOGO` e a
  // semeadura falharia na primeira partida.
  const M32 = "0032_universo_esperado";
  add(M32, "entity_expectation", levantar(M32, /CREATE TABLE IF NOT EXISTS "entity_expectation"/));
  add(
    M32,
    "FK de entity_expectation",
    levantar(M32, /entity_expectation_entity_id_entity_id_fk/),
  );
  for (const i of ["entity_expectation_recorte_idx", "entity_expectation_entity_idx"]) {
    add(M32, `índice ${i}`, levantar(M32, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(
    M32,
    "coverage_expectation_origin_ck (drop)",
    levantar(M32, /DROP CONSTRAINT IF EXISTS "coverage_expectation_origin_ck"/),
  );
  add(
    M32,
    "coverage_expectation_origin_ck",
    levantar(M32, /ADD CONSTRAINT "coverage_expectation_origin_ck"/),
  );

  const M33 = "0033_verdade_financeira_unica";
  /*
    As três colunas da `0033`. A definição é levantada da própria migration, e
    não escrita aqui: uma segunda redação do mesmo DDL é a forma mais silenciosa
    de o `up` devolver uma coluna com default ou nulidade diferente da que a fila
    cria — e o teste que compara "depois do up" com "banco criado do zero" é
    justamente quem cobraria isso, tarde.
  */
  for (const col of [
    "impacto_oficial_by_periodicity",
    "deducao_rastro",
    "mudancas_fora_do_total",
  ]) {
    add(
      M33,
      `change_set.${col}`,
      levantar(M33, new RegExp(`ALTER TABLE "change_set"\\s+ADD COLUMN IF NOT EXISTS "${col}"`)),
    );
  }

  // A `0037` — coluna, backfill e CHECK, levantados da própria migration.
  // O backfill entra porque `role` é decisão de gente com uma sentinela
  // reentrante (sem nenhum ADMIN, as contas existentes viram ADMIN): um up que
  // repusesse só a estrutura deixaria todo mundo OPERADOR — inclusive quem
  // precisa entrar em Configurações para consertar isso.
  const M37 = "0037_papeis";
  add(M37, "app_user.role", levantar(M37, /ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "role"/));
  // O backfill é a segunda escrita de linha do plano, marcada como tal: `role`
  // é decisão de gente com sentinela reentrante (sem nenhum ADMIN, as contas
  // existentes viram ADMIN). Um up só de estrutura deixaria todo mundo
  // OPERADOR — inclusive quem precisaria entrar em Configurações para
  // consertar isso.
  p.push({
    migration: M37,
    objeto: "app_user.role (backfill)",
    sql: reconstruir(M37, /UPDATE "app_user"/),
    reconstroiDados: true,
  });
  add(M37, "app_user_role_ck (drop)", levantar(M37, /DROP CONSTRAINT IF EXISTS "app_user_role_ck"/));
  add(M37, "app_user_role_ck", levantar(M37, /ADD CONSTRAINT "app_user_role_ck"/));

  /*
    A `0039` — o ambiente Fechamento inteiro, que o `down` remove porque
    Production ainda não o conhece.

    A ordem aqui é a da migration e importa: tabela antes de FK, FK antes de
    índice, e a função de gatilho antes dos gatilhos que a chamam. Cada chave e
    cada gatilho é levantado pelo próprio nome — a migration os escreve um por
    bloco reentrante, e não em laço, exatamente para que possam ser
    endereçados assim aqui e pela reconvergência da partida.
  */
  const M39 = "0039_fechamento";
  const TABELAS_DO_FECHAMENTO = [
    "fechamento_competencia",
    "fechamento_documento",
    "fechamento_viagem",
    "fechamento_cte",
    "fechamento_requisicao",
    "fechamento_disponibilidade",
    "fechamento_conciliacao_item",
    "fechamento_apuracao",
    "fechamento_apuracao_verba",
    "fechamento_divergencia",
  ];
  for (const t of TABELAS_DO_FECHAMENTO) {
    add(M39, t, levantar(M39, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}" \\(`)));
  }
  for (const nome of [
    "fechamento_documento_competencia_fk",
    ...["fechamento_viagem", "fechamento_cte", "fechamento_requisicao",
        "fechamento_disponibilidade", "fechamento_conciliacao_item"].flatMap((t) => [
      `${t}_documento_fk`,
      `${t}_competencia_fk`,
    ]),
    "fechamento_apuracao_competencia_fk",
    "fechamento_apuracao_verba_apuracao_fk",
    "fechamento_divergencia_apuracao_fk",
  ]) {
    add(M39, `FK ${nome}`, levantar(M39, new RegExp(`ADD CONSTRAINT "${nome}"`)));
  }
  for (const i of [
    "fechamento_competencia_unica",
    "fechamento_competencia_por_periodo",
    "fechamento_documento_sem_repeticao",
    "fechamento_documento_vigente_unico",
    "fechamento_documento_por_competencia",
    "fechamento_viagem_por_competencia",
    "fechamento_viagem_por_documento",
    "fechamento_cte_por_verba",
    "fechamento_cte_por_documento",
    "fechamento_requisicao_por_verba",
    "fechamento_requisicao_por_documento",
    "fechamento_disponibilidade_por_dia",
    "fechamento_disponibilidade_por_documento",
    "fechamento_conciliacao_item_por_secao",
    "fechamento_conciliacao_item_por_documento",
    "fechamento_apuracao_vigente_unica",
    "fechamento_apuracao_por_competencia",
    "fechamento_apuracao_verba_unica",
    "fechamento_divergencia_por_apuracao",
  ]) {
    add(M39, `índice ${i}`, levantar(M39, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(
    M39,
    "fechamento_recusar_escrita_em_encerrada()",
    levantar(M39, /CREATE OR REPLACE FUNCTION fechamento_recusar_escrita_em_encerrada/),
  );
  for (const t of [
    "fechamento_documento",
    "fechamento_viagem",
    "fechamento_cte",
    "fechamento_requisicao",
    "fechamento_disponibilidade",
    "fechamento_conciliacao_item",
    "fechamento_apuracao",
  ]) {
    add(M39, `gatilho ${t}_congelada`, levantar(M39, new RegExp(`CREATE TRIGGER "${t}_congelada"`)));
  }

  /*
    A `0042` — o retrato da viagem, que a `0039` não tinha.

    Ela entra aqui porque o `down` derruba `fechamento_viagem` inteira, e o
    `up` a recria pelo `CREATE TABLE` da `0039`: sem este passo a tabela
    voltaria com as quinze colunas da conta e sem as quarenta e sete que a tela
    do dia mostra — um schema que nenhuma das duas autoridades reconhece, que é
    o estado que o bridge existe para não produzir.

    Cada coluna é levantada pelo próprio nome, e não em bloco, pela mesma razão
    que as chaves e os gatilhos acima: é o que permite endereçá-las uma a uma
    aqui e na reconvergência da partida. As aspas de fechamento no padrão não
    são enfeite — sem elas `"lucro"` casaria também `"lucro_unitario"`, e
    `levantar` abortaria por achar dois statements onde espera um.
  */
  /*
    A `0043` — as duas tabelas do 03.08.20, o demonstrativo de pagamento.

    Entram aqui pela mesma razão das dez da `0039`: o `down` as derruba porque
    Production ainda não conhece o ambiente, e o `up` tem de devolvê-las
    inteiras. Cada objeto é levantado da própria migration, um por bloco
    reentrante, e não reescrito aqui — uma segunda escrita da mesma definição
    concorda no dia em que é escrita e discorda no dia em que a migration muda.

    O CHECK de `fechamento_documento.tipo` entra **e é o passo mais fácil de
    esquecer**, porque a tabela que o carrega não é da `0043`. O `down` derruba
    `fechamento_documento` inteira e o `up` a recria pelo `CREATE TABLE` da
    `0039` — que traz o CHECK com os cinco tipos de lá. Sem a troca aqui, o
    banco reconstruído recusaria um documento `PAGAMENTO` que um banco criado
    do zero aceita: o mesmo schema por duas autoridades, divergindo em silêncio
    num único ARRAY. É o `bridge-up` comparado contra um banco novo que pega
    isso, e foi ele que pegou.

    Os dois passos, na ordem da migration: o DROP antes do ADD, cada um
    levantado pelo próprio padrão — é o mesmo desenho de `app_user_role_ck` na
    `0037`, pela mesma razão.
  */
  const M43 = "0043_pagamento";
  for (const t of ["fechamento_pagamento_item", "fechamento_pagamento_desconto"]) {
    add(M43, t, levantar(M43, new RegExp(`CREATE TABLE IF NOT EXISTS "${t}" \\(`)));
    for (const fk of [`${t}_documento_fk`, `${t}_competencia_fk`]) {
      add(M43, `FK ${fk}`, levantar(M43, new RegExp(`ADD CONSTRAINT "${fk}"`)));
    }
    add(
      M43,
      `gatilho ${t}_congelada`,
      levantar(M43, new RegExp(`CREATE TRIGGER "${t}_congelada"`)),
    );
  }
  for (const i of [
    "fechamento_pagamento_item_por_verba",
    "fechamento_pagamento_item_por_documento",
    "fechamento_pagamento_desconto_por_competencia",
    "fechamento_pagamento_desconto_por_documento",
  ]) {
    add(M43, `índice ${i}`, levantar(M43, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }
  add(
    M43,
    "fechamento_documento_tipo (drop)",
    levantar(M43, /DROP CONSTRAINT IF EXISTS "fechamento_documento_tipo"/),
  );
  add(
    M43,
    "fechamento_documento_tipo",
    levantar(M43, /ADD CONSTRAINT "fechamento_documento_tipo"/),
  );

  /*
    A `0044` — o cadastro de unidade e transportadora, pela mesma razão das
    outras: o `down` o derruba com o resto do ambiente, e o `up` tem de
    devolvê-lo inteiro, com o índice único que o torna um cadastro em vez de uma
    pilha de repetições. Sem chave estrangeira e sem gatilho: a tabela não
    depende de competência nenhuma, e é exatamente isso que ela existe para
    dizer.
  */
  const M44 = "0044_partes_cadastradas";
  add(M44, "fechamento_parte", levantar(M44, /CREATE TABLE IF NOT EXISTS "fechamento_parte" \(/));
  add(
    M44,
    "índice fechamento_parte_unica",
    levantar(M44, /INDEX IF NOT EXISTS "fechamento_parte_unica"/),
  );

  /*
    A `0045` — a planilha de remuneração informada, pela mesma razão da `0044`:
    o `down` a derruba porque Production não a conhece, e o `up` tem de
    devolvê-la inteira. O índice único é o que faz dela uma planilha em vez de
    uma pilha de versões da mesma célula, e o outro é o que a leitura por
    (unidade, vigência) usa. Sem chave estrangeira e sem gatilho, como a `0044`:
    o autor não referencia `app_user` de propósito (a conta pode ser desativada,
    o histórico do número não pode depender disso), e a planilha não é conteúdo
    de competência nenhuma.
  */
  /*
    A `0046` — o tipo de operação na competência.

    Ela **altera** uma tabela que o `down` derruba inteira, e por isso tem de vir
    aqui: o `up` recria `fechamento_competencia` pelo `CREATE TABLE` da `0039`,
    que não conhece a coluna nem o índice de quatro colunas. Sem estas três
    linhas o schema voltaria com a unicidade de três — a que somava EMPURRADA e
    ROTA num fechamento só —, e o teste que compara o banco reposto com um banco
    novo diria exatamente isso.

    A ordem é a da migration: coluna, `DROP` do índice velho, `CREATE` do novo. O
    `DROP` não é enfeite mesmo depois de a tabela ter acabado de nascer — é o
    índice de três colunas que a `0039` criou, e ele existe.
  */
  const M46 = "0046_tipo_de_operacao";
  add(
    M46,
    "fechamento_competencia.tipo_de_operacao",
    levantar(M46, /ADD COLUMN IF NOT EXISTS "tipo_de_operacao"/),
  );
  add(
    M46,
    "índice fechamento_competencia_unica (o de três colunas sai)",
    levantar(M46, /DROP INDEX IF EXISTS "fechamento_competencia_unica"/),
  );
  add(
    M46,
    "índice fechamento_competencia_unica",
    levantar(M46, /CREATE UNIQUE INDEX IF NOT EXISTS "fechamento_competencia_unica"/),
  );

  const M45 = "0045_planilha_de_remuneracao";
  add(
    M45,
    "remuneracao_planilha",
    levantar(M45, /CREATE TABLE IF NOT EXISTS "remuneracao_planilha" \(/),
  );
  for (const i of ["remuneracao_planilha_unica", "remuneracao_planilha_por_vigencia"]) {
    add(M45, `índice ${i}`, levantar(M45, new RegExp(`INDEX IF NOT EXISTS "${i}"`)));
  }

  /*
    A `0047` — o arquivo importado deixa de ser descartado depois de lido. Mesmo
    caso da `0044` e da `0045`: Production não conhece a tabela até rodar a
    fila, então o `down` a derruba e o `up` tem de devolvê-la inteira, com a
    chave estrangeira que a faz sair junto com o documento.

    Nasceu `0046` neste branch e virou `0047` na fusão, porque a `main` chegou
    antes com a `0046_tipo_de_operacao` — o mesmo encontro de fila que a `0023` e
    a `0025` já tiveram, e cujo custo está medido em
    `docs/PROPOSTA-ASSISTENTE-AGENTE.md §13`. É por isto que a migration é citada
    por esta constante e não por texto solto: renumerar passa a ser trocar um
    literal, e o `levantar` reprova alto se o nome não existir na fila.
  */
  const M47 = "0047_conteudo_da_importacao";
  add(
    M47,
    "fechamento_documento_conteudo",
    levantar(M47, /CREATE TABLE IF NOT EXISTS "fechamento_documento_conteudo" \(/),
  );
  add(
    M47,
    "fk fechamento_documento_conteudo_documento_fk",
    levantar(M47, /DO \$reentrante\$\s*\n\s*BEGIN\s*\n\s*IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'fechamento_documento_conteudo_documento_fk'\)/),
  );

  const M42 = "0042_viagem_completa";
  for (const coluna of COLUNAS_DO_RETRATO_DA_VIAGEM) {
    add(
      M42,
      `fechamento_viagem.${coluna}`,
      levantar(M42, new RegExp(`ADD COLUMN IF NOT EXISTS "${coluna}"`)),
    );
  }

  // 5. Obrigatoriedade e constraints.
  //    Os valores nunca saíram: o `down` só afrouxou o NOT NULL.
  for (const [t, col] of NULLABLE_TEMPORARIO) {
    add(M15, `${t}.${col} NOT NULL`, `ALTER TABLE "${t}" ALTER COLUMN "${col}" SET NOT NULL`);
  }
  add(M18, "constraints da identidade", levantar(M18, /snapshot_canonical_scope_nao_vazio_ck/));

  /*
    As da `0040`. O índice e as duas constraints do reprocessamento voltam pelo
    DDL da própria migration — nenhum deles é reescrito aqui, pela mesma razão
    de `levantar` existir: uma segunda escrita da mesma definição concorda no
    dia em que é escrita e discorda no dia em que a migration muda.

    As colunas não entram: elas nunca saíram. Estão na ALLOWLIST justamente
    porque são aditivas e nulas, e o `down` as mantém.
  */
  add(
    M40,
    "índice import_run_leitura_aberta_uq",
    levantar(M40, /CREATE UNIQUE INDEX IF NOT EXISTS "import_run_leitura_aberta_uq"/),
  );
  add(M40, "constraint import_run_reprocess_of_fk", levantar(M40, /import_run_reprocess_of_fk/));
  add(
    M40,
    "constraint import_run_reprocess_completo",
    levantar(M40, /import_run_reprocess_completo/),
  );

  return p;
}

export async function bridgeUp(connectionString: string): Promise<BridgeReport> {
  const pool = new pg.Pool({ connectionString });
  const c = await pool.connect();
  const rel: BridgeReport = {
    precondicoes: [],
    dependencias: [],
    ddl: [],
    verificacao: [],
    avisos: [],
    dryRun: false,
  };

  try {
    /*
      O `up` restaura **o que o `down` removeu**, e nada além disso.

      A diferença não é acadêmica. Development real tem dezenove carimbos, o
      último da `0018`: a `0019` está no disco e não no banco. Um `up` que
      aplicasse o plano inteiro criaria as colunas de feedback e o CHECK dela, e
      Development terminaria com schema de `0019` e registro de `0018` — um
      estado que nenhuma das duas autoridades reconhece, e exatamente o tipo de
      divergência que este trabalho existe para fechar.

      Por isso cada passo carrega a migration que o possui, e só entra se ela
      estiver registrada. O que ficou de fora não se perde: é a fila que o
      aplica, por `runMigrations()`, que é quem tem autoridade para isso — e aí
      schema e registro avançam juntos.
    */
    const { rows: carimbos } = await c.query<{ created_at: string }>(
      `SELECT created_at FROM "drizzle"."__drizzle_migrations"`,
    );
    const aplicadas = new Set(carimbos.map((r) => Number(r.created_at)));
    const registrada = new Map(
      readMigrations().map((m) => [m.tag, aplicadas.has(m.when)]),
    );

    const plano = planoUp();
    const aFazer = plano.filter((p) => registrada.get(p.migration) === true);
    const adiadas = [
      ...new Set(plano.filter((p) => !aFazer.includes(p)).map((p) => p.migration)),
    ];

    const reconstroem = aFazer.filter((p) => p.reconstroiDados).length;
    rel.precondicoes.push({
      nome: "plano estrutural",
      ok: true,
      detalhe:
        `${aFazer.length} de ${plano.length} objetos, ` +
        (reconstroem === 0
          ? "nenhum statement mexe em dados"
          : `${reconstroem} repovoa(m) tabela derivada e nenhum outro mexe em dados`),
    });
    if (adiadas.length > 0) {
      rel.precondicoes.push({
        nome: "adiado para a fila",
        ok: true,
        detalhe: `${adiadas.join(", ")} não está registrada — quem a aplica é runMigrations()`,
      });
    }

    await c.query("BEGIN");
    for (const passo of aFazer) {
      rel.ddl.push(`-- ${passo.objeto}`);
      await c.query(passo.sql);
    }

    /*
      As duas únicas escritas do `up`, e as duas só tocam linha cuja coluna
      **este script acabou de criar** — portanto toda ela `NULL`. Não é
      reaplicação do backfill da `0013`: é o valor canônico da coluna que o
      `down` removeu, devolvido junto com ela. Com `ticket` vazio, é no-op.
    */
    if (await existeColuna(c, "ticket", "changed_parameter_count")) {
      await c.query(
        `UPDATE "ticket" t SET "changed_parameter_count" =
           (SELECT count(*) FROM "ticket_change" tc WHERE tc."ticket_id" = t."id")
          WHERE t."changed_parameter_count" IS NULL`,
      );
      await c.query(`ALTER TABLE "ticket" ALTER COLUMN "changed_parameter_count" SET DEFAULT 0`);
      await c.query(`ALTER TABLE "ticket" ALTER COLUMN "changed_parameter_count" SET NOT NULL`);
    }
    if (await existeColuna(c, "ticket_import", "parameter_columns")) {
      await c.query(
        `UPDATE "ticket_import" SET "parameter_columns" = '[]'::jsonb WHERE "parameter_columns" IS NULL`,
      );
      await c.query(`ALTER TABLE "ticket_import" ALTER COLUMN "parameter_columns" SET DEFAULT '[]'::jsonb`);
      await c.query(`ALTER TABLE "ticket_import" ALTER COLUMN "parameter_columns" SET NOT NULL`);
    }

    /*
      O `up` concluiu: não há mais bridge pendente. Some junto com a restauração
      e pela mesma razão do `down` — se o `up` abortar, o marcador continua lá,
      que é a resposta certa para um bridge que ainda não terminou.
    */
    await c.query(LIMPAR_MARCADOR);

    await c.query("COMMIT");
    rel.verificacao.push({
      nome: "restauração aplicada",
      ok: true,
      detalhe: `${aFazer.length} objetos restaurados${
        adiadas.length > 0 ? `, ${adiadas.length} migration(s) adiada(s) para a fila` : ""
      }`,
    });
    return rel;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    rel.falha = err instanceof Error ? err.message : String(err);
    return rel;
  } finally {
    c.release();
    await pool.end();
  }
}
