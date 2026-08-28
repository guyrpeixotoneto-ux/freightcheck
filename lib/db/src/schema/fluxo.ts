import {
  pgTable,
  text,
  uuid,
  integer,
  boolean,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
  unique,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { unidadeTable } from "./unidade";

/**
 * FLUXOS OPERACIONAIS — o mapa dos processos da empresa, como dado.
 *
 * O que estas seis tabelas guardam não é um desenho: é a resposta a "como este
 * processo funciona, quem participa, que sistemas e documentos entram, onde ele
 * costuma falhar e onde eu consulto isso dentro do FreightCheck". O fluxograma
 * é a leitura mais visível do que está aqui, e nem de longe a única — a mesma
 * linha responde ao painel da etapa, ao índice de riscos e, no dia em que o
 * Modo Monitoramento existir, ao farol.
 *
 * ---------------------------------------------------------------------------
 * O motor é genérico, e isso é a decisão principal
 * ---------------------------------------------------------------------------
 *
 * Nenhuma coluna abaixo sabe o que é um CTe, uma SEFAZ ou um boleto. "Emissão
 * de CTe até Recebimento" é uma **linha** em `fluxo_operacional` com dezesseis
 * linhas em `fluxo_etapa` e um punhado em `fluxo_etapa_item` — exatamente como
 * "NF até pagamento" será, sem nenhuma migration nova. O teste dessa afirmação
 * está escrito em `lib/fluxos`: um segundo fluxo, de outro domínio, montado
 * pelas mesmas funções.
 *
 * Pelo mesmo motivo, **tipo de etapa, tipo de conexão e espécie de item são
 * `text` sem `CHECK`**. A lista de valores válidos mora em
 * `@workspace/fluxos/catalogo`, que é código, se lê inteira e ganha um item com
 * uma linha. Um `CHECK` aqui compraria uma segunda linha de defesa e cobraria
 * por ela uma migration a cada tipo novo — que é exatamente o "retrabalho
 * estrutural" que este módulo existe para não ter. O que **tem** `CHECK` é o
 * que é estrutura e não vocabulário: nome não vazio, uma conexão não voltar
 * para a própria etapa, e a rota de uma ação começar com `/`.
 *
 * ---------------------------------------------------------------------------
 * `empresa_id` em toda tabela, e não só na raiz
 * ---------------------------------------------------------------------------
 *
 * A empresa é a `unidade` canônica — a autoridade que já existe sobre "qual
 * empresa é esta", identificada por CNPJ (ver `schema/unidade.ts`). Não há
 * tabela de inquilino nova: inventar uma ao lado daquela criaria a segunda
 * identidade que a `0049` desfez.
 *
 * A coluna se repete nas cinco tabelas filhas, e a repetição é deliberada. Ela
 * não existe para poupar join — existe para que a **chave estrangeira composta**
 * `(fluxo_id, empresa_id) → fluxo_operacional(id, empresa_id)` seja possível.
 * Com ela, gravar uma etapa da empresa A dentro de um fluxo da empresa B é
 * recusado pelo Postgres, e não por uma verificação que alguém pode esquecer de
 * escrever na rota nova. O mesmo vale um nível abaixo: item, indicador e ação
 * apontam para `(etapa_id, fluxo_id)`, e conexão aponta as duas pontas para
 * `(etapa_id, fluxo_id)` — o que torna impossível ligar duas etapas de fluxos
 * diferentes, e portanto de empresas diferentes.
 *
 * Isolamento por consulta (`where empresa_id = …`) continua valendo em toda
 * leitura e escrita, em `lib/fluxos/repositorio.ts`. As duas defesas cobrem
 * coisas diferentes: a consulta impede **ler** o que é de outro; a chave composta
 * impede **gravar** um vínculo atravessado.
 *
 * ---------------------------------------------------------------------------
 * Por que `fluxo_etapa_item` é uma tabela só
 * ---------------------------------------------------------------------------
 *
 * Sistemas, documentos, responsáveis, falhas e gargalos têm a mesma forma —
 * nome, descrição, ordem, e um par de campos opcionais — e a mesma pergunta:
 * "o que desta espécie existe nesta etapa". Cinco tabelas idênticas dariam
 * cinco rotas idênticas, cinco componentes idênticos e uma migration por
 * espécie nova. Uma tabela com `especie` dá uma consulta indexada, um contrato
 * e nenhuma migration.
 *
 * Isso **não** é o "JSON opaco" que este módulo recusa: cada item é uma linha
 * consultável, com tipo, ordem e chave estrangeira. `SELECT nome, count(*) FROM
 * fluxo_etapa_item WHERE especie = 'FALHA' GROUP BY 1` responde "quais falhas
 * mais aparecem nos nossos processos" — pergunta que um `textarea` não responde.
 *
 * `fluxo_etapa_indicador` fica de fora dessa tabela porque tem campos que as
 * outras espécies não têm nem teriam sentido de ter (unidade de medida, sentido
 * desejado, origem futura do dado), e é a única cujo destino é deixar de ser
 * metadado. `fluxo_etapa_acao` fica de fora porque o que ela guarda é um
 * endereço navegável, com parâmetros — outra coisa que só ela tem.
 */

export const fluxoOperacionalTable = pgTable(
  "fluxo_operacional",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * A empresa dona do fluxo. `RESTRICT` de propósito: apagar a unidade
     * canônica não pode levar junto o mapa dos processos dela em silêncio.
     */
    empresaId: uuid("empresa_id")
      .notNull()
      .references(() => unidadeTable.id, { onDelete: "restrict" }),
    nome: text("nome").notNull(),
    /**
     * O identificador legível, único por empresa — `cte-ate-recebimento`.
     * Existe para o endereço e para a semeadura ser idempotente (semear duas
     * vezes não cria dois fluxos iguais). Não é a identidade: essa é o `id`.
     */
    slug: text("slug").notNull(),
    descricao: text("descricao"),
    objetivo: text("objetivo"),
    /**
     * Texto livre — `Faturamento`, `Financeiro`, `Cadastro`. Sem `CHECK` e sem
     * tabela de categorias: a lista de categorias de processo de uma empresa
     * muda mais rápido do que qualquer migration acompanha, e nada no motor
     * decide nada com base nela.
     */
    categoria: text("categoria").notNull(),
    /** RASCUNHO | ATIVO | ARQUIVADO. Ver `@workspace/fluxos/catalogo`. */
    status: text("status").notNull().default("RASCUNHO"),
    /**
     * Inteiro, incrementado a cada publicação de versão. Hoje o produto só o
     * exibe e o carimba; o versionamento com histórico é trabalho declarado
     * como próximo passo, e o campo existe para que ele não precise rechavear
     * nada quando chegar.
     */
    versao: integer("versao").notNull().default(1),
    /** O dono do processo — área ou pessoa, como texto. */
    dono: text("dono"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** O e-mail de quem estava logado — o mesmo `actor` do resto do produto. */
    criadoPor: text("criado_por"),
    atualizadoPor: text("atualizado_por"),
  },
  (t) => [
    uniqueIndex("fluxo_operacional_empresa_slug_uq").on(t.empresaId, t.slug),
    index("fluxo_operacional_empresa_idx").on(t.empresaId),
    /**
     * O alvo da chave composta das filhas. Redundante como unicidade (`id` já é
     * a chave primária) e indispensável como referência: o Postgres exige um
     * índice único sobre exatamente as colunas referenciadas.
     */
    unique("fluxo_operacional_id_empresa_uq").on(t.id, t.empresaId),
    check("fluxo_operacional_nome_nao_vazio", sql`length(btrim(${t.nome})) > 0`),
    check("fluxo_operacional_slug_nao_vazio", sql`length(btrim(${t.slug})) > 0`),
    check("fluxo_operacional_versao_positiva", sql`${t.versao} >= 1`),
  ],
);

export const fluxoEtapaTable = pgTable(
  "fluxo_etapa",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull(),
    fluxoId: uuid("fluxo_id").notNull(),
    nome: text("nome").notNull(),
    descricao: text("descricao"),
    /** INICIO | PROCESSO | DECISAO | VALIDACAO | DOCUMENTO | SISTEMA | PENDENCIA | FIM. */
    tipo: text("tipo").notNull().default("PROCESSO"),
    /**
     * A ordem de leitura, não a topologia. O processo real é o grafo de
     * `fluxo_conexao`; esta coluna existe para a lista, para a numeração que a
     * tela mostra e para o desempate de um layout automático. Um processo com
     * ida e volta continua sendo representado corretamente com ordens
     * repetidas — é por isso que ela **não** é única.
     */
    ordem: integer("ordem").notNull().default(0),
    responsavel: text("responsavel"),
    area: text("area"),
    objetivo: text("objetivo"),
    sistemaPrincipal: text("sistema_principal"),
    regras: text("regras"),
    /**
     * O que se consulta aqui — as informações que a pessoa (ou o sistema) vai
     * buscar para conseguir executar a etapa: um relatório, uma tela, uma
     * tabela, um e-mail. É texto livre e não é a mesma coisa que os itens da
     * espécie `DOCUMENTO`: aqueles são o material que a etapa **produz ou
     * exige** como entregável, enquanto isto é o que ela **olha** — e o que se
     * olha raramente cabe numa lista de nomes com link.
     */
    informacoesConsultadas: text("informacoes_consultadas"),
    /**
     * AS TRÊS DIMENSÕES DO QUE DÁ ERRADO, DO QUE TRAVA E DO QUE É PRECISO SABER.
     *
     * Havia uma coluna só, `observacoes`, e ela era o depósito da etapa: o erro
     * que costuma acontecer, a fila que atrasa e a instrução de quem executa
     * cabiam todos ali. Com as três juntas o processo fica legível e
     * inconsultável — "quais são as principais falhas", "onde estão os maiores
     * gargalos" e "quais etapas concentram mais problemas" são perguntas que só
     * se respondem se falha, gargalo e informação forem colunas diferentes.
     *
     * `falhas` é o que pode dar errado — erros, retrabalhos, desvios,
     * problemas recorrentes. `gargalos` é o que atrasa mesmo quando nada dá
     * errado — esperas, filas, dependências, limitação de capacidade.
     * `informacoes` é o contexto: particularidades, instruções complementares,
     * o que é preciso saber para entender ou executar a etapa.
     *
     * Elas **não** substituem as espécies `FALHA` e `GARGALO` de
     * `fluxo_etapa_item`: aquelas são listas de itens nomeados, contáveis um a
     * um; estas são o texto corrido que descreve a situação e que não cabe numa
     * lista de nomes.
     */
    falhas: text("falhas"),
    gargalos: text("gargalos"),
    informacoes: text("informacoes"),
    /**
     * A coluna de antes das três acima — mantida, e não removida.
     *
     * A `0072` **copiou** o que estava aqui para `informacoes` e não tocou nesta
     * linha: é o texto original de quem escreveu a etapa, guardado como estava.
     * O produto não a escreve mais e não a mostra; o que a lê é quem precisar
     * conferir, um dia, o que exatamente havia antes do recorte em três.
     *
     * Ela continua chegando e voltando pela API, e o cliente continua mandando
     * o valor que recebeu, porque a rota da etapa é substituição: deixar de
     * mandá-la faria a primeira edição de qualquer campo apagar o backup.
     */
    observacoes: text("observacoes"),
    status: text("status").notNull().default("ATIVO"),
    /**
     * Onde o cartão está no canvas, em pixels do referencial do próprio fluxo.
     * Inteiro porque meio pixel não significa nada e porque arredondar aqui
     * evita que arrastar o mesmo cartão duas vezes produza dois valores
     * diferentes para a mesma posição visual.
     */
    posX: integer("pos_x").notNull().default(0),
    posY: integer("pos_y").notNull().default(0),
    /**
     * A costura para o Modo Monitoramento, e a única coisa deste schema que
     * existe para o futuro.
     *
     * Uma chave estável e opcional — `cte.autorizacao_sefaz` — pela qual um
     * coletor de métricas ainda inexistente vai poder dizer "o farol desta
     * etapa é vermelho" sem que nada aqui saiba o que ele mede. Enquanto não
     * houver coletor, é um campo de texto que ninguém lê: nenhuma consulta
     * deste módulo decide nada com ele, que é o que impede o acoplamento
     * prematuro de já ter acontecido.
     */
    chaveMonitoramento: text("chave_monitoramento"),
    /**
     * O fluxo que detalha esta etapa — o subfluxo.
     *
     * "Emissão do documento (no Unidox)" é uma etapa aqui e um processo inteiro
     * lá dentro: oito passos, três sistemas e duas pessoas. Sem esta coluna, a
     * única saída era escrever esse detalhe em `observacoes` — texto que não se
     * navega, não se exporta e não conta etapas — ou inflar o fluxo pai com
     * dezenas de cartões, apagando a leitura de ponta a ponta que ele existe
     * para dar.
     *
     * **Um subfluxo é um fluxo normal**, e é isso que torna a coluna barata: o
     * detalhe herda as seis visualizações, a exportação, o versionamento e o
     * isolamento por empresa sem uma linha de motor nova. Nada aqui é
     * "contêiner" nem "grupo" — é uma referência de uma etapa para outra linha
     * de `fluxo_operacional`.
     *
     * `SET NULL` ao apagar o alvo, e não cascata: o detalhe some, a etapa fica.
     * Apagar o subfluxo não pode levar junto a etapa do processo pai, que
     * continua acontecendo mesmo sem ninguém ter escrito como.
     *
     * A chave é composta com `empresa_id` pela mesma razão das outras: um
     * subfluxo de outra empresa deixa de ser possível de gravar, e não depende
     * de a rota lembrar de conferir. O que o banco **não** barra é ciclo — A
     * detalha B que detalha A —, porque isso é alcançabilidade e não
     * integridade referencial; quem barra é `ligarSubfluxo`, em
     * `lib/fluxos/repositorio.ts`, com o caminho inteiro na mão.
     */
    subfluxoId: uuid("subfluxo_id"),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fluxo_etapa_fluxo_empresa_fk",
      columns: [t.fluxoId, t.empresaId],
      foreignColumns: [fluxoOperacionalTable.id, fluxoOperacionalTable.empresaId],
    }).onDelete("cascade"),
    /** O alvo das filhas: item, indicador, ação e as duas pontas da conexão. */
    unique("fluxo_etapa_id_fluxo_uq").on(t.id, t.fluxoId),
    foreignKey({
      name: "fluxo_etapa_subfluxo_empresa_fk",
      columns: [t.subfluxoId, t.empresaId],
      foreignColumns: [fluxoOperacionalTable.id, fluxoOperacionalTable.empresaId],
    }).onDelete("set null"),
    index("fluxo_etapa_fluxo_idx").on(t.fluxoId),
    index("fluxo_etapa_empresa_idx").on(t.empresaId),
    /** Quem detalha quem — a consulta de "esta etapa tem subfluxo" e a da trilha de volta. */
    index("fluxo_etapa_subfluxo_idx").on(t.subfluxoId),
    check("fluxo_etapa_nome_nao_vazio", sql`length(btrim(${t.nome})) > 0`),
  ],
);

export const fluxoConexaoTable = pgTable(
  "fluxo_conexao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull(),
    fluxoId: uuid("fluxo_id").notNull(),
    origemEtapaId: uuid("origem_etapa_id").notNull(),
    destinoEtapaId: uuid("destino_etapa_id").notNull(),
    /** SEQUENCIA | DECISAO_SIM | DECISAO_NAO | EXCECAO | RETRABALHO. */
    tipo: text("tipo").notNull().default("SEQUENCIA"),
    /** A condição escrita na seta — "se rejeitado", "acima de R$ 5 mil". */
    rotulo: text("rotulo"),
    ordem: integer("ordem").notNull().default(0),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp("atualizado_em", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fluxo_conexao_fluxo_empresa_fk",
      columns: [t.fluxoId, t.empresaId],
      foreignColumns: [fluxoOperacionalTable.id, fluxoOperacionalTable.empresaId],
    }).onDelete("cascade"),
    /**
     * As duas pontas presas ao **mesmo** fluxo, pela chave composta.
     *
     * É o que torna a ligação atravessada impossível de gravar: para conectar
     * uma etapa de outro fluxo seria preciso que ela existisse com o
     * `fluxo_id` deste, e ela não existe. Como o fluxo carrega a empresa, a
     * mesma chave já barra a ligação entre empresas — sem nenhuma verificação
     * escrita na rota.
     */
    foreignKey({
      name: "fluxo_conexao_origem_fk",
      columns: [t.origemEtapaId, t.fluxoId],
      foreignColumns: [fluxoEtapaTable.id, fluxoEtapaTable.fluxoId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fluxo_conexao_destino_fk",
      columns: [t.destinoEtapaId, t.fluxoId],
      foreignColumns: [fluxoEtapaTable.id, fluxoEtapaTable.fluxoId],
    }).onDelete("cascade"),
    /**
     * A mesma seta não é gravada duas vezes — mas duas setas de **tipos**
     * diferentes entre as mesmas etapas continuam podendo existir, porque
     * "aprovado" e "reprovado" saindo da mesma decisão para o mesmo destino é
     * um processo legítimo, ainda que raro.
     */
    uniqueIndex("fluxo_conexao_par_uq").on(t.origemEtapaId, t.destinoEtapaId, t.tipo),
    index("fluxo_conexao_fluxo_idx").on(t.fluxoId),
    /**
     * Laço em si mesma é recusado; **ciclo entre etapas, não**. Um processo
     * real volta: rejeitado → correção → nova validação. Proibir ciclos aqui
     * seria proibir retrabalho, que é justamente o que este módulo existe para
     * tornar visível. A decisão está provada em `lib/fluxos`.
     */
    check("fluxo_conexao_sem_laco", sql`${t.origemEtapaId} <> ${t.destinoEtapaId}`),
  ],
);

export const fluxoEtapaItemTable = pgTable(
  "fluxo_etapa_item",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull(),
    fluxoId: uuid("fluxo_id").notNull(),
    etapaId: uuid("etapa_id").notNull(),
    /** SISTEMA | DOCUMENTO | RESPONSAVEL | FALHA | GARGALO — e o que vier. */
    especie: text("especie").notNull(),
    nome: text("nome").notNull(),
    descricao: text("descricao"),
    /**
     * Só faz sentido para DOCUMENTO, e é nulo nas outras espécies — nulo aqui
     * quer dizer "a pergunta não se aplica", não "não se sabe".
     */
    obrigatorio: boolean("obrigatorio"),
    /** Só faz sentido para SISTEMA: o endereço externo do portal, do banco. */
    link: text("link"),
    ordem: integer("ordem").notNull().default(0),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fluxo_etapa_item_etapa_fk",
      columns: [t.etapaId, t.fluxoId],
      foreignColumns: [fluxoEtapaTable.id, fluxoEtapaTable.fluxoId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fluxo_etapa_item_fluxo_empresa_fk",
      columns: [t.fluxoId, t.empresaId],
      foreignColumns: [fluxoOperacionalTable.id, fluxoOperacionalTable.empresaId],
    }).onDelete("cascade"),
    index("fluxo_etapa_item_etapa_idx").on(t.etapaId, t.especie),
    index("fluxo_etapa_item_especie_idx").on(t.empresaId, t.especie),
    check("fluxo_etapa_item_nome_nao_vazio", sql`length(btrim(${t.nome})) > 0`),
  ],
);

export const fluxoEtapaIndicadorTable = pgTable(
  "fluxo_etapa_indicador",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull(),
    fluxoId: uuid("fluxo_id").notNull(),
    etapaId: uuid("etapa_id").notNull(),
    nome: text("nome").notNull(),
    descricao: text("descricao"),
    /** `%`, `dias`, `R$`, `h`. Texto porque a unidade é do indicador. */
    unidade: text("unidade"),
    /** MAIOR_MELHOR | MENOR_MELHOR | NEUTRO — o sentido desejado. */
    sentido: text("sentido").notNull().default("NEUTRO"),
    /**
     * De onde o número virá quando vier — uma frase, não um endereço.
     * Deliberadamente não é uma referência a nada: o dia em que o Modo
     * Monitoramento existir, é aqui que a fonte é declarada, e até lá uma
     * coluna que apontasse para uma consulta inexistente seria promessa.
     */
    origem: text("origem"),
    ordem: integer("ordem").notNull().default(0),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fluxo_etapa_indicador_etapa_fk",
      columns: [t.etapaId, t.fluxoId],
      foreignColumns: [fluxoEtapaTable.id, fluxoEtapaTable.fluxoId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fluxo_etapa_indicador_fluxo_empresa_fk",
      columns: [t.fluxoId, t.empresaId],
      foreignColumns: [fluxoOperacionalTable.id, fluxoOperacionalTable.empresaId],
    }).onDelete("cascade"),
    index("fluxo_etapa_indicador_etapa_idx").on(t.etapaId),
    check("fluxo_etapa_indicador_nome_nao_vazio", sql`length(btrim(${t.nome})) > 0`),
  ],
);

export const fluxoEtapaAcaoTable = pgTable(
  "fluxo_etapa_acao",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    empresaId: uuid("empresa_id").notNull(),
    fluxoId: uuid("fluxo_id").notNull(),
    etapaId: uuid("etapa_id").notNull(),
    titulo: text("titulo").notNull(),
    descricao: text("descricao"),
    /**
     * A rota **interna** — `/fechamento/conciliacao`, `/alteracoes`. Começa com
     * `/` por `CHECK`, e o motivo é de segurança e não de estética: sem essa
     * garantia, um cadastro poderia gravar `javascript:…` ou um endereço de
     * outro domínio num botão que a interface apresenta como "consultar no
     * FreightCheck". A tela não monta URL nenhuma por conta própria — ela
     * navega para o que está gravado aqui, e é por isso que o que está gravado
     * aqui precisa ser sempre um caminho deste produto.
     */
    rota: text("rota").notNull(),
    /**
     * Os parâmetros de consulta, como objeto — `{"status":"REJEITADO"}`.
     *
     * É o único `jsonb` do módulo, e o único lugar em que ele é a estrutura
     * certa: as chaves são as da tela de destino, variam por rota e não existe
     * conjunto fechado a modelar. Vira query string em `@workspace/fluxos`,
     * numa função só, e não em cada componente.
     */
    parametros: jsonb("parametros"),
    /** O nome de um ícone do catálogo da interface. Opcional. */
    icone: text("icone"),
    ordem: integer("ordem").notNull().default(0),
    criadoEm: timestamp("criado_em", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "fluxo_etapa_acao_etapa_fk",
      columns: [t.etapaId, t.fluxoId],
      foreignColumns: [fluxoEtapaTable.id, fluxoEtapaTable.fluxoId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fluxo_etapa_acao_fluxo_empresa_fk",
      columns: [t.fluxoId, t.empresaId],
      foreignColumns: [fluxoOperacionalTable.id, fluxoOperacionalTable.empresaId],
    }).onDelete("cascade"),
    index("fluxo_etapa_acao_etapa_idx").on(t.etapaId),
    check("fluxo_etapa_acao_titulo_nao_vazio", sql`length(btrim(${t.titulo})) > 0`),
    check("fluxo_etapa_acao_rota_interna", sql`${t.rota} ~ '^/'`),
  ],
);
