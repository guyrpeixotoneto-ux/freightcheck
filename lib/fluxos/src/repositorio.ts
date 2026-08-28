import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  fluxoConexaoTable,
  fluxoEtapaAcaoTable,
  fluxoEtapaIndicadorTable,
  fluxoEtapaItemTable,
  fluxoEtapaTable,
  fluxoOperacionalTable,
  unidadeTable,
  type Database,
} from "@workspace/db";
import type {
  AcaoDaEtapa,
  Conexao,
  Etapa,
  EntradaDeAcao,
  EntradaDeConexao,
  EntradaDeEtapa,
  EntradaDeFluxo,
  EntradaDeIndicador,
  EntradaDeItem,
  Fluxo,
  FluxoCompleto,
  FluxoDeclarado,
  ConexaoDeclarada,
  EtapaDeclarada,
  FluxoNaLista,
  IndicadorDaEtapa,
  ItemDaEtapa,
  PaiNaLista,
  PosicaoDaEtapa,
  DegrauDaTrilha,
  ResumoDeSubfluxo,
} from "./modelo";
import type { EspecieDeItem, SentidoDoIndicador, StatusDoFluxo } from "./catalogo";
import { posicionarEtapas } from "./layout";
import {
  comoSlug,
  RecusaDeFluxo,
  validarAcao,
  validarEntradaDeConexao,
  validarEntradaDeEtapa,
  validarEntradaDeFluxo,
  validarIndicador,
  validarItem,
} from "./validacao";

/**
 * O REPOSITÓRIO — o único lugar deste produto que lê e escreve fluxos.
 *
 * ---------------------------------------------------------------------------
 * A empresa é parâmetro de toda função, e nunca vem do corpo
 * ---------------------------------------------------------------------------
 *
 * Toda função aqui recebe `empresaId` como argumento **separado** do corpo da
 * requisição, e toda consulta o inclui no `where`. Não existe sobrecarga que o
 * dispense, não existe caminho que o infira do registro que está sendo alterado
 * e não existe padrão para o caso de ele faltar. Um `update` que confiasse no
 * `id` sozinho funcionaria em todos os testes de uma empresa só e vazaria na
 * primeira segunda empresa — e é por isso que a assinatura obriga.
 *
 * O escopo é resolvido em `routes/fluxos.ts`, a partir da requisição
 * autenticada, e conferido lá antes de chegar aqui. As duas defesas cobrem
 * coisas diferentes: lá se decide **de quem** é o escopo; aqui se garante que
 * nenhuma consulta escapa dele.
 *
 * ---------------------------------------------------------------------------
 * `where` composto, e não `where id = …` depois de um `select`
 * ---------------------------------------------------------------------------
 *
 * As escritas de etapa, conexão, item, indicador e ação filtram por
 * `(id, fluxoId, empresaId)` na própria instrução. Ler o dono antes e escrever
 * depois pareceria a mesma coisa e não é: entre as duas consultas existe uma
 * janela, e mais importante — a versão em duas etapas depende de alguém lembrar
 * de escrever a primeira. Um `update … where` composto não tem como esquecer.
 *
 * Além disso o banco carrega chaves compostas que tornam o vínculo atravessado
 * impossível de gravar (ver `lib/db/src/schema/fluxo.ts`). O código não confia
 * nelas para decidir nada — mas elas são a rede embaixo.
 */

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

export interface FiltroDeFluxos {
  /** Inclui os arquivados. Padrão: não. */
  incluirArquivados?: boolean;
  categoria?: string;
  status?: StatusDoFluxo;
}

export async function listarFluxos(
  db: Database,
  empresaId: string,
  filtro: FiltroDeFluxos = {},
): Promise<FluxoNaLista[]> {
  const condicoes = [eq(fluxoOperacionalTable.empresaId, empresaId)];
  if (filtro.status) {
    condicoes.push(eq(fluxoOperacionalTable.status, filtro.status));
  } else if (!filtro.incluirArquivados) {
    condicoes.push(sql`${fluxoOperacionalTable.status} <> 'ARQUIVADO'`);
  }
  if (filtro.categoria) condicoes.push(eq(fluxoOperacionalTable.categoria, filtro.categoria));

  /*
    As contagens vêm em duas consultas agregadas, e não por `left join` com
    `group by` na mesma consulta da lista: com dois joins (etapas e conexões) o
    `count` de um multiplica o do outro, e "16 etapas" apareceria como "272".
    É o erro clássico do join em leque, e ele **não** aparece em fluxo nenhum
    que tenha zero conexões — isto é, não aparece em teste escrito com um fluxo
    recém-criado. Duas consultas rasas custam um round-trip a mais e não têm
    como errar.
  */
  const [linhas, etapasPorFluxo, conexoesPorFluxo, vinculos] = await Promise.all([
    db
      .select()
      .from(fluxoOperacionalTable)
      .where(and(...condicoes))
      .orderBy(asc(fluxoOperacionalTable.categoria), asc(fluxoOperacionalTable.nome)),
    db
      .select({
        fluxoId: fluxoEtapaTable.fluxoId,
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(fluxoEtapaTable)
      .where(eq(fluxoEtapaTable.empresaId, empresaId))
      .groupBy(fluxoEtapaTable.fluxoId),
    db
      .select({
        fluxoId: fluxoConexaoTable.fluxoId,
        total: sql<number>`count(*)`.mapWith(Number),
      })
      .from(fluxoConexaoTable)
      .where(eq(fluxoConexaoTable.empresaId, empresaId))
      .groupBy(fluxoConexaoTable.fluxoId),
    /*
      Quem detalha quem, numa consulta rasa sobre as etapas da empresa inteira.
      É a mesma ligação que `trilhaAteARaiz` percorre um degrau por vez para um
      fluxo só; aqui não dá para subir em laço — seriam N consultas para uma
      lista — e nem é preciso: a tela monta a árvore com os pais imediatos que
      esta leitura devolve.
    */
    db
      .select({
        subfluxoId: fluxoEtapaTable.subfluxoId,
        fluxoId: fluxoEtapaTable.fluxoId,
        etapaId: fluxoEtapaTable.id,
        etapaNome: fluxoEtapaTable.nome,
      })
      .from(fluxoEtapaTable)
      .where(
        and(
          eq(fluxoEtapaTable.empresaId, empresaId),
          isNotNull(fluxoEtapaTable.subfluxoId),
        ),
      )
      .orderBy(asc(fluxoEtapaTable.ordem), asc(fluxoEtapaTable.criadoEm)),
  ]);

  const etapas = new Map(etapasPorFluxo.map((l) => [l.fluxoId, l.total]));
  const conexoes = new Map(conexoesPorFluxo.map((l) => [l.fluxoId, l.total]));

  /*
    Um fluxo detalha uma etapa, e não duas: o banco não impede que a mesma
    referência seja gravada em duas etapas, e se isso acontecer vale a primeira
    na ordem de leitura — a mesma escolha (e a mesma ordenação) de
    `trilhaAteARaiz`, para que a lista e a trilha nunca discordem sobre quem é
    o pai.
  */
  const pais = new Map<string, PaiNaLista>();
  for (const vinculo of vinculos) {
    if (!vinculo.subfluxoId || pais.has(vinculo.subfluxoId)) continue;
    pais.set(vinculo.subfluxoId, {
      fluxoId: vinculo.fluxoId,
      etapaId: vinculo.etapaId,
      etapaNome: vinculo.etapaNome,
    });
  }

  return linhas.map((linha) => ({
    ...comoFluxo(linha),
    etapas: etapas.get(linha.id) ?? 0,
    conexoes: conexoes.get(linha.id) ?? 0,
    pai: pais.get(linha.id) ?? null,
  }));
}

/** O fluxo inteiro — etapas, conexões e todo o material das etapas. */
export async function lerFluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
): Promise<FluxoCompleto | null> {
  const [linha] = await db
    .select()
    .from(fluxoOperacionalTable)
    .where(
      and(eq(fluxoOperacionalTable.id, fluxoId), eq(fluxoOperacionalTable.empresaId, empresaId)),
    )
    .limit(1);
  if (!linha) return null;

  /*
    Quatro consultas em paralelo, todas escopadas pelo fluxo **e** pela empresa.
    Escopar as filhas só pelo fluxo bastaria — as chaves compostas garantem que
    filha de fluxo alheio não existe —, e mesmo assim o `empresaId` está em
    todas: a regra deste arquivo é que nenhuma consulta escapa do escopo, e uma
    exceção "porque neste caso dá na mesma" é como a regra deixa de valer.
  */
  const [etapas, conexoes, itens, indicadores, acoes] = await Promise.all([
    db
      .select()
      .from(fluxoEtapaTable)
      .where(and(eq(fluxoEtapaTable.fluxoId, fluxoId), eq(fluxoEtapaTable.empresaId, empresaId)))
      .orderBy(asc(fluxoEtapaTable.ordem), asc(fluxoEtapaTable.criadoEm)),
    db
      .select()
      .from(fluxoConexaoTable)
      .where(
        and(eq(fluxoConexaoTable.fluxoId, fluxoId), eq(fluxoConexaoTable.empresaId, empresaId)),
      )
      .orderBy(asc(fluxoConexaoTable.ordem), asc(fluxoConexaoTable.criadoEm)),
    db
      .select()
      .from(fluxoEtapaItemTable)
      .where(
        and(
          eq(fluxoEtapaItemTable.fluxoId, fluxoId),
          eq(fluxoEtapaItemTable.empresaId, empresaId),
        ),
      )
      .orderBy(asc(fluxoEtapaItemTable.ordem), asc(fluxoEtapaItemTable.criadoEm)),
    db
      .select()
      .from(fluxoEtapaIndicadorTable)
      .where(
        and(
          eq(fluxoEtapaIndicadorTable.fluxoId, fluxoId),
          eq(fluxoEtapaIndicadorTable.empresaId, empresaId),
        ),
      )
      .orderBy(asc(fluxoEtapaIndicadorTable.ordem), asc(fluxoEtapaIndicadorTable.criadoEm)),
    db
      .select()
      .from(fluxoEtapaAcaoTable)
      .where(
        and(
          eq(fluxoEtapaAcaoTable.fluxoId, fluxoId),
          eq(fluxoEtapaAcaoTable.empresaId, empresaId),
        ),
      )
      .orderBy(asc(fluxoEtapaAcaoTable.ordem), asc(fluxoEtapaAcaoTable.criadoEm)),
  ]);

  const porEtapa = <T, R>(lista: T[], chave: (t: T) => string, converter: (t: T) => R) => {
    const mapa = new Map<string, R[]>();
    for (const item of lista) {
      const id = chave(item);
      const atual = mapa.get(id);
      if (atual) atual.push(converter(item));
      else mapa.set(id, [converter(item)]);
    }
    return mapa;
  };

  const itensPorEtapa = porEtapa(itens, (i) => i.etapaId, comoItem);
  const indicadoresPorEtapa = porEtapa(indicadores, (i) => i.etapaId, comoIndicador);
  const acoesPorEtapa = porEtapa(acoes, (a) => a.etapaId, comoAcao);

  /*
    Os dois lados do vínculo, resolvidos aqui e não pela tela: para baixo, o
    cabeçalho dos subfluxos que as etapas apontam; para cima, a trilha de volta.
    Uma tela que pedisse isso sozinha faria uma requisição por cartão — e a
    Jornada mostra quinze cartões de uma vez.
  */
  const [subfluxos, trilha] = await Promise.all([
    resumirSubfluxos(
      db,
      empresaId,
      etapas.map((e) => e.subfluxoId),
    ),
    trilhaAteARaiz(db, empresaId, fluxoId),
  ]);

  return {
    fluxo: comoFluxo(linha),
    etapas: etapas.map((e) => ({
      ...comoEtapa(e),
      itens: itensPorEtapa.get(e.id) ?? [],
      indicadores: indicadoresPorEtapa.get(e.id) ?? [],
      acoes: acoesPorEtapa.get(e.id) ?? [],
    })),
    conexoes: conexoes.map(comoConexao),
    subfluxos,
    trilha,
  };
}

/**
 * O cabeçalho de cada subfluxo referenciado, com a contagem de etapas.
 *
 * Uma consulta para os fluxos e uma para a contagem, as duas com `inArray`:
 * uma por etapa apontada seria uma ida ao banco por cartão da tela. Lista
 * vazia não consulta nada — que é o caso da esmagadora maioria dos fluxos.
 */
async function resumirSubfluxos(
  db: Database,
  empresaId: string,
  apontados: (string | null)[],
): Promise<ResumoDeSubfluxo[]> {
  const ids = [...new Set(apontados.filter((id): id is string => id !== null))];
  if (ids.length === 0) return [];

  const [linhas, contagens] = await Promise.all([
    db
      .select({
        id: fluxoOperacionalTable.id,
        nome: fluxoOperacionalTable.nome,
        slug: fluxoOperacionalTable.slug,
        categoria: fluxoOperacionalTable.categoria,
        status: fluxoOperacionalTable.status,
      })
      .from(fluxoOperacionalTable)
      .where(
        and(
          inArray(fluxoOperacionalTable.id, ids),
          eq(fluxoOperacionalTable.empresaId, empresaId),
        ),
      ),
    db
      .select({ fluxoId: fluxoEtapaTable.fluxoId, total: sql<number>`count(*)::int` })
      .from(fluxoEtapaTable)
      .where(
        and(inArray(fluxoEtapaTable.fluxoId, ids), eq(fluxoEtapaTable.empresaId, empresaId)),
      )
      .groupBy(fluxoEtapaTable.fluxoId),
  ]);

  const total = new Map(contagens.map((c) => [c.fluxoId, Number(c.total)]));
  return linhas.map((l) => ({
    id: l.id,
    nome: l.nome,
    slug: l.slug,
    categoria: l.categoria,
    status: l.status as StatusDoFluxo,
    etapas: total.get(l.id) ?? 0,
  }));
}

/**
 * O caminho de volta, da raiz até o pai imediato deste fluxo.
 *
 * Um passo por nível, e não uma CTE recursiva: a profundidade real de um
 * detalhamento é de dois ou três, o passo é uma consulta por índice, e um
 * `WITH RECURSIVE` aqui trocaria três linhas legíveis por um bloco de SQL cru
 * que ninguém revisa.
 *
 * O conjunto de visitados é o que impede um ciclo já gravado — por um banco
 * mexido à mão, ou por uma corrida entre dois `ligarSubfluxo` — de virar laço
 * infinito na leitura. `ligarSubfluxo` existe para que ele nunca seja
 * necessário; ele existe para o dia em que for.
 */
async function trilhaAteARaiz(
  db: Database,
  empresaId: string,
  fluxoId: string,
): Promise<DegrauDaTrilha[]> {
  const degraus: DegrauDaTrilha[] = [];
  const visitados = new Set<string>([fluxoId]);
  let atual = fluxoId;

  for (;;) {
    const [pai] = await db
      .select({
        fluxoId: fluxoEtapaTable.fluxoId,
        etapaId: fluxoEtapaTable.id,
        etapaNome: fluxoEtapaTable.nome,
        fluxoNome: fluxoOperacionalTable.nome,
      })
      .from(fluxoEtapaTable)
      .innerJoin(
        fluxoOperacionalTable,
        and(
          eq(fluxoOperacionalTable.id, fluxoEtapaTable.fluxoId),
          eq(fluxoOperacionalTable.empresaId, empresaId),
        ),
      )
      .where(
        and(eq(fluxoEtapaTable.subfluxoId, atual), eq(fluxoEtapaTable.empresaId, empresaId)),
      )
      .orderBy(asc(fluxoEtapaTable.ordem), asc(fluxoEtapaTable.criadoEm))
      .limit(1);

    if (!pai || visitados.has(pai.fluxoId)) break;
    degraus.unshift(pai);
    visitados.add(pai.fluxoId);
    atual = pai.fluxoId;
  }

  return degraus;
}

/** O fluxo pelo slug — o endereço legível, dentro da mesma empresa. */
export async function lerFluxoPorSlug(
  db: Database,
  empresaId: string,
  slug: string,
): Promise<FluxoCompleto | null> {
  const [linha] = await db
    .select({ id: fluxoOperacionalTable.id })
    .from(fluxoOperacionalTable)
    .where(
      and(eq(fluxoOperacionalTable.empresaId, empresaId), eq(fluxoOperacionalTable.slug, slug)),
    )
    .limit(1);
  return linha ? lerFluxo(db, empresaId, linha.id) : null;
}

// ---------------------------------------------------------------------------
// Escrita — fluxo
// ---------------------------------------------------------------------------

export class FluxoNaoEncontrado extends RecusaDeFluxo {
  constructor() {
    super("FLUXO_NAO_ENCONTRADO", "Este fluxo não existe nesta empresa.");
  }
}

export class EtapaNaoEncontrada extends RecusaDeFluxo {
  constructor() {
    super("ETAPA_NAO_ENCONTRADA", "Esta etapa não existe neste fluxo.");
  }
}

export class ConexaoNaoEncontrada extends RecusaDeFluxo {
  constructor() {
    super("CONEXAO_NAO_ENCONTRADA", "Esta conexão não existe neste fluxo.");
  }
}

/**
 * Detalhar uma etapa com um fluxo que já está acima dela na trilha.
 *
 * O ciclo não quebra nenhuma chave do banco — ele quebra a leitura: a trilha
 * do cabeçalho passa a não ter raiz, e "abrir o detalhe" leva de volta ao
 * ponto de partida sem que nada avise. A frase nomeia o fluxo que já está no
 * caminho, porque é o dado que resolve.
 */
export class SubfluxoEmCiclo extends RecusaDeFluxo {
  constructor(nome: string) {
    super(
      "SUBFLUXO_EM_CICLO",
      `"${nome}" já contém este fluxo mais acima — detalhar com ele criaria uma volta sem fim.`,
    );
  }
}

export class SlugJaUsado extends RecusaDeFluxo {
  constructor(slug: string) {
    super("FLUXO_SLUG_JA_USADO", `Já existe um fluxo com o endereço "${slug}" nesta empresa.`);
  }
}

export class EmpresaDesconhecida extends RecusaDeFluxo {
  constructor() {
    super(
      "EMPRESA_DESCONHECIDA",
      "Esta empresa não está cadastrada em Administração → Unidades.",
    );
  }
}

/**
 * A empresa existe? — a conferência que antecede toda escrita.
 *
 * A chave estrangeira já recusaria o insert, e a recusa dela é um 23503 com
 * texto de banco. Perguntar antes é o que transforma isso na frase que manda a
 * pessoa para a tela onde ela resolve.
 */
export async function conferirEmpresa(db: Database, empresaId: string): Promise<void> {
  const [linha] = await db
    .select({ id: unidadeTable.id })
    .from(unidadeTable)
    .where(eq(unidadeTable.id, empresaId))
    .limit(1);
  if (!linha) throw new EmpresaDesconhecida();
}

export interface Autor {
  /** O e-mail de quem está logado — o mesmo `actor` do resto do produto. */
  email: string | null;
}

export async function criarFluxo(
  db: Database,
  empresaId: string,
  bruto: unknown,
  autor: Autor,
): Promise<Fluxo> {
  const entrada = validarEntradaDeFluxo(bruto);
  await conferirEmpresa(db, empresaId);
  await recusarSlugRepetido(db, empresaId, entrada.slug, null);

  const [linha] = await db
    .insert(fluxoOperacionalTable)
    .values({
      empresaId,
      nome: entrada.nome,
      slug: entrada.slug,
      descricao: entrada.descricao ?? null,
      objetivo: entrada.objetivo ?? null,
      categoria: entrada.categoria,
      status: entrada.status,
      dono: entrada.dono ?? null,
      criadoPor: autor.email,
      atualizadoPor: autor.email,
    })
    .returning();
  return comoFluxo(linha);
}

export async function atualizarFluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  bruto: unknown,
  autor: Autor,
): Promise<Fluxo> {
  const entrada = validarEntradaDeFluxo(bruto);
  await recusarSlugRepetido(db, empresaId, entrada.slug, fluxoId);

  const [linha] = await db
    .update(fluxoOperacionalTable)
    .set({
      nome: entrada.nome,
      slug: entrada.slug,
      descricao: entrada.descricao ?? null,
      objetivo: entrada.objetivo ?? null,
      categoria: entrada.categoria,
      status: entrada.status,
      dono: entrada.dono ?? null,
      atualizadoEm: new Date(),
      atualizadoPor: autor.email,
    })
    .where(
      and(eq(fluxoOperacionalTable.id, fluxoId), eq(fluxoOperacionalTable.empresaId, empresaId)),
    )
    .returning();
  if (!linha) throw new FluxoNaoEncontrado();
  return comoFluxo(linha);
}

/**
 * Arquivar — e não apagar.
 *
 * Um processo que saiu de uso continua explicando o que a empresa fazia até
 * ontem, e é justamente isso que alguém procura quando investiga um problema
 * antigo. `DELETE` existe para etapa e conexão, que são material de rascunho;
 * para o fluxo inteiro, o que existe é mudar de status.
 */
export async function arquivarFluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  autor: Autor,
): Promise<Fluxo> {
  return trocarStatus(db, empresaId, fluxoId, "ARQUIVADO", autor);
}

export async function trocarStatus(
  db: Database,
  empresaId: string,
  fluxoId: string,
  status: StatusDoFluxo,
  autor: Autor,
): Promise<Fluxo> {
  const [linha] = await db
    .update(fluxoOperacionalTable)
    .set({ status, atualizadoEm: new Date(), atualizadoPor: autor.email })
    .where(
      and(eq(fluxoOperacionalTable.id, fluxoId), eq(fluxoOperacionalTable.empresaId, empresaId)),
    )
    .returning();
  if (!linha) throw new FluxoNaoEncontrado();
  return comoFluxo(linha);
}

/**
 * Duplicar — o fluxo inteiro, com etapas, conexões e todo o material.
 *
 * **A ligação de subfluxo não é copiada**, e é a decisão certa das duas
 * possíveis: a cópia apontaria para o mesmo detalhe do original, e editar o
 * detalhe da cópia mudaria o processo original sem nenhum aviso. Copiar os
 * subfluxos junto, recursivamente, seria a outra saída — e transformaria
 * "duplicar" numa operação que cria cinco fluxos a partir de um clique.
 *
 * Nasce RASCUNHO e versão 1, sempre: uma cópia não herda a afirmação "é assim
 * que funciona hoje", que é o que ATIVO significa. As conexões são refeitas
 * pelo mapa de identidades novas — copiar as antigas apontaria para as etapas do
 * original, e as chaves compostas do banco recusariam de qualquer forma.
 */
export async function duplicarFluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  nome: string,
  autor: Autor,
): Promise<Fluxo> {
  const original = await lerFluxo(db, empresaId, fluxoId);
  if (!original) throw new FluxoNaoEncontrado();

  const declarado: FluxoDeclarado = {
    nome,
    slug: comoSlug(nome),
    descricao: original.fluxo.descricao,
    objetivo: original.fluxo.objetivo,
    categoria: original.fluxo.categoria,
    dono: original.fluxo.dono,
    status: "RASCUNHO",
    etapas: original.etapas.map((etapa) => ({
      chave: etapa.id,
      nome: etapa.nome,
      descricao: etapa.descricao,
      tipo: etapa.tipo,
      ordem: etapa.ordem,
      responsavel: etapa.responsavel,
      area: etapa.area,
      objetivo: etapa.objetivo,
      sistemaPrincipal: etapa.sistemaPrincipal,
      regras: etapa.regras,
      informacoesConsultadas: etapa.informacoesConsultadas,
      observacoes: etapa.observacoes,
      status: etapa.status,
      posX: etapa.posX,
      posY: etapa.posY,
      chaveMonitoramento: etapa.chaveMonitoramento,
      itens: etapa.itens.map(({ id: _id, ...resto }) => resto),
      indicadores: etapa.indicadores.map(({ id: _id, ...resto }) => resto),
      acoes: etapa.acoes.map(({ id: _id, ...resto }) => resto),
    })),
    conexoes: original.conexoes.map((c) => ({
      de: c.origemEtapaId,
      para: c.destinoEtapaId,
      tipo: c.tipo,
      rotulo: c.rotulo,
      ordem: c.ordem,
    })),
  };

  return importarFluxo(db, empresaId, declarado, autor);
}

async function recusarSlugRepetido(
  db: Database,
  empresaId: string,
  slug: string,
  exceto: string | null,
): Promise<void> {
  const [linha] = await db
    .select({ id: fluxoOperacionalTable.id })
    .from(fluxoOperacionalTable)
    .where(
      and(eq(fluxoOperacionalTable.empresaId, empresaId), eq(fluxoOperacionalTable.slug, slug)),
    )
    .limit(1);
  if (linha && linha.id !== exceto) throw new SlugJaUsado(slug);
}

// ---------------------------------------------------------------------------
// Escrita — etapa
// ---------------------------------------------------------------------------

/**
 * O fluxo existe **nesta** empresa? — a pergunta que abre toda escrita filha.
 *
 * Devolve o `id` e nada mais. É a tradução de "não é seu" para "não existe":
 * responder "existe, mas não é seu" já entrega a informação de que ele existe,
 * e um módulo que isola empresas não tem por que confirmar o acervo alheio.
 */
async function exigirFluxo(db: Database, empresaId: string, fluxoId: string): Promise<string> {
  const [linha] = await db
    .select({ id: fluxoOperacionalTable.id })
    .from(fluxoOperacionalTable)
    .where(
      and(eq(fluxoOperacionalTable.id, fluxoId), eq(fluxoOperacionalTable.empresaId, empresaId)),
    )
    .limit(1);
  if (!linha) throw new FluxoNaoEncontrado();
  return linha.id;
}

export async function criarEtapa(
  db: Database,
  empresaId: string,
  fluxoId: string,
  bruto: unknown,
): Promise<Etapa> {
  await exigirFluxo(db, empresaId, fluxoId);
  const entrada = validarEntradaDeEtapa(bruto);

  const [linha] = await db
    .insert(fluxoEtapaTable)
    .values({ ...paraColunasDeEtapa(entrada), empresaId, fluxoId })
    .returning();
  return { ...comoEtapa(linha), itens: [], indicadores: [], acoes: [] };
}

export async function atualizarEtapa(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
  bruto: unknown,
): Promise<Etapa> {
  const entrada = validarEntradaDeEtapa(bruto);
  const [linha] = await db
    .update(fluxoEtapaTable)
    .set({ ...paraColunasDeEtapa(entrada), atualizadoEm: new Date() })
    .where(
      and(
        eq(fluxoEtapaTable.id, etapaId),
        eq(fluxoEtapaTable.fluxoId, fluxoId),
        eq(fluxoEtapaTable.empresaId, empresaId),
      ),
    )
    .returning();
  if (!linha) throw new EtapaNaoEncontrada();
  return { ...comoEtapa(linha), itens: [], indicadores: [], acoes: [] };
}

/**
 * Excluir uma etapa leva junto as conexões que a tocam — pelas chaves
 * estrangeiras em cascata, não por três `delete` escritos aqui.
 *
 * É a única cascata do módulo, e ela é a certa: uma seta para uma etapa que não
 * existe mais não é dado, é lixo que quebraria o desenho. O mesmo vale para
 * itens, indicadores e ações, que só existem dentro da etapa.
 */
export async function excluirEtapa(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
): Promise<void> {
  const linhas = await db
    .delete(fluxoEtapaTable)
    .where(
      and(
        eq(fluxoEtapaTable.id, etapaId),
        eq(fluxoEtapaTable.fluxoId, fluxoId),
        eq(fluxoEtapaTable.empresaId, empresaId),
      ),
    )
    .returning({ id: fluxoEtapaTable.id });
  if (linhas.length === 0) throw new EtapaNaoEncontrada();
}

// ---------------------------------------------------------------------------
// Escrita — subfluxo
// ---------------------------------------------------------------------------

/**
 * SUBFLUXO — a etapa que é um processo inteiro por dentro.
 *
 * Três funções e nenhuma entidade nova: ligar, desligar e "detalhar", que é
 * criar o fluxo já ligado. O detalhe é um fluxo comum — herda as seis
 * visualizações, a exportação, o versionamento e o isolamento por empresa sem
 * uma linha de motor a mais.
 *
 * A regra que só o código pode impor é o ciclo: `A` detalhada por `B` detalhada
 * por `A`. As chaves do banco não o barram (é alcançabilidade, não integridade)
 * e a leitura sozinha não o percebe — o cabeçalho fica sem raiz e "abrir o
 * detalhe" volta ao ponto de partida. Por isso toda ligação percorre a trilha
 * antes de gravar.
 */
export async function ligarSubfluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
  subfluxoId: string,
): Promise<Etapa> {
  await exigirSubfluxoLigavel(db, empresaId, fluxoId, subfluxoId);
  return gravarSubfluxo(db, empresaId, fluxoId, etapaId, subfluxoId);
}

/** Desfaz a ligação. O detalhe continua existindo — vira um fluxo sem pai. */
export async function desligarSubfluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
): Promise<Etapa> {
  return gravarSubfluxo(db, empresaId, fluxoId, etapaId, null);
}

/**
 * Detalhar uma etapa — o fluxo novo, com o nome dela, já ligado.
 *
 * É o caminho de um clique da tela: quem está lendo "Emissão do documento" e
 * percebe que ali dentro moram oito passos não quer preencher um formulário de
 * fluxo antes de escrever o primeiro deles. O detalhe nasce RASCUNHO, herda a
 * categoria e o dono do pai, e leva o objetivo da etapa como objetivo — que é
 * exatamente o que já estava escrito sobre ele.
 *
 * Numa transação só: um fluxo criado e não ligado seria um órfão na listagem,
 * sem nenhum aviso de que a ligação falhou.
 */
export async function detalharEtapa(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
  autor: Autor,
  nomePedido?: string | null,
): Promise<Fluxo> {
  const [pai] = await db
    .select({ nome: fluxoOperacionalTable.nome, categoria: fluxoOperacionalTable.categoria, dono: fluxoOperacionalTable.dono })
    .from(fluxoOperacionalTable)
    .where(
      and(eq(fluxoOperacionalTable.id, fluxoId), eq(fluxoOperacionalTable.empresaId, empresaId)),
    )
    .limit(1);
  if (!pai) throw new FluxoNaoEncontrado();

  const [etapa] = await db
    .select({ nome: fluxoEtapaTable.nome, objetivo: fluxoEtapaTable.objetivo, subfluxoId: fluxoEtapaTable.subfluxoId })
    .from(fluxoEtapaTable)
    .where(
      and(
        eq(fluxoEtapaTable.id, etapaId),
        eq(fluxoEtapaTable.fluxoId, fluxoId),
        eq(fluxoEtapaTable.empresaId, empresaId),
      ),
    )
    .limit(1);
  if (!etapa) throw new EtapaNaoEncontrada();
  if (etapa.subfluxoId) {
    throw new RecusaDeFluxo(
      "ETAPA_JA_DETALHADA",
      "Esta etapa já tem um subfluxo. Abra o que existe ou desfaça a ligação antes de criar outro.",
    );
  }

  const nome = (nomePedido ?? "").trim() || etapa.nome;
  const slug = await slugLivre(db, empresaId, comoSlug(nome));

  return db.transaction(async (tx) => {
    const [criado] = await tx
      .insert(fluxoOperacionalTable)
      .values({
        empresaId,
        nome,
        slug,
        /*
          A descrição diz de onde ele veio, em texto. É a única pista que
          sobrevive à listagem geral de fluxos, onde a trilha não aparece — e
          quem abre a lista amanhã precisa saber por que existe um fluxo
          chamado "Emissão do documento (no Unidox)".
        */
        descricao: `Detalhe da etapa "${etapa.nome}" do fluxo "${pai.nome}".`,
        objetivo: etapa.objetivo,
        categoria: pai.categoria,
        status: "RASCUNHO",
        dono: pai.dono,
        criadoPor: autor.email,
        atualizadoPor: autor.email,
      })
      .returning();

    await tx
      .update(fluxoEtapaTable)
      .set({ subfluxoId: criado.id, atualizadoEm: new Date() })
      .where(
        and(
          eq(fluxoEtapaTable.id, etapaId),
          eq(fluxoEtapaTable.fluxoId, fluxoId),
          eq(fluxoEtapaTable.empresaId, empresaId),
        ),
      );

    return comoFluxo(criado);
  });
}

/** O `update` que os dois lados usam — um `where` composto, sem leitura antes. */
async function gravarSubfluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
  subfluxoId: string | null,
): Promise<Etapa> {
  const [linha] = await db
    .update(fluxoEtapaTable)
    .set({ subfluxoId, atualizadoEm: new Date() })
    .where(
      and(
        eq(fluxoEtapaTable.id, etapaId),
        eq(fluxoEtapaTable.fluxoId, fluxoId),
        eq(fluxoEtapaTable.empresaId, empresaId),
      ),
    )
    .returning();
  if (!linha) throw new EtapaNaoEncontrada();
  return { ...comoEtapa(linha), itens: [], indicadores: [], acoes: [] };
}

/**
 * O alvo pode detalhar este fluxo? — existe, é desta empresa, não é ele mesmo
 * e não está acima dele.
 *
 * "Não está acima" é a pergunta cara, e é a que importa: ligar um ancestral
 * fecha a volta. Ela é respondida subindo a trilha **do fluxo pai**, que é
 * curta por natureza e já tem guarda contra laço.
 */
async function exigirSubfluxoLigavel(
  db: Database,
  empresaId: string,
  fluxoId: string,
  subfluxoId: string,
): Promise<void> {
  const [alvo] = await db
    .select({ id: fluxoOperacionalTable.id, nome: fluxoOperacionalTable.nome })
    .from(fluxoOperacionalTable)
    .where(
      and(
        eq(fluxoOperacionalTable.id, subfluxoId),
        eq(fluxoOperacionalTable.empresaId, empresaId),
      ),
    )
    .limit(1);
  if (!alvo) throw new FluxoNaoEncontrado();
  if (subfluxoId === fluxoId) throw new SubfluxoEmCiclo(alvo.nome);

  const acima = await trilhaAteARaiz(db, empresaId, fluxoId);
  if (acima.some((degrau) => degrau.fluxoId === subfluxoId)) {
    throw new SubfluxoEmCiclo(alvo.nome);
  }
}

/**
 * Um endereço livre a partir do desejado — `emissao-do-documento`,
 * `emissao-do-documento-2`, …
 *
 * O slug é único por empresa, e detalhar duas etapas com o mesmo nome é comum
 * (duas "Validação" em fluxos diferentes). Recusar o segundo detalhe com
 * "endereço já usado" seria cobrar da pessoa um campo que ela não preencheu —
 * o nome veio da etapa.
 */
async function slugLivre(db: Database, empresaId: string, desejado: string): Promise<string> {
  const usados = await db
    .select({ slug: fluxoOperacionalTable.slug })
    .from(fluxoOperacionalTable)
    .where(eq(fluxoOperacionalTable.empresaId, empresaId));
  const ocupados = new Set(usados.map((u) => u.slug));
  if (!ocupados.has(desejado)) return desejado;
  for (let n = 2; ; n += 1) {
    const tentativa = `${desejado}-${n}`;
    if (!ocupados.has(tentativa)) return tentativa;
  }
}

/**
 * O salvamento do arrastar — em lote, numa transação.
 *
 * Arrastar cinco cartões e salvar cinco vezes deixaria o canvas num estado
 * intermediário se a terceira falhasse. Aqui ou as cinco posições entram ou
 * nenhuma entra, e o desenho na tela continua sendo o desenho no banco.
 *
 * Uma posição de etapa que não é deste fluxo não é ignorada em silêncio: o
 * `where` composto não a alcança, e a contagem no fim recusa o lote inteiro.
 */
export async function reposicionarEtapas(
  db: Database,
  empresaId: string,
  fluxoId: string,
  posicoes: PosicaoDaEtapa[],
): Promise<number> {
  if (posicoes.length === 0) return 0;
  await exigirFluxo(db, empresaId, fluxoId);

  return db.transaction(async (tx) => {
    let gravadas = 0;
    for (const posicao of posicoes) {
      const linhas = await tx
        .update(fluxoEtapaTable)
        .set({ posX: posicao.posX, posY: posicao.posY, atualizadoEm: new Date() })
        .where(
          and(
            eq(fluxoEtapaTable.id, posicao.etapaId),
            eq(fluxoEtapaTable.fluxoId, fluxoId),
            eq(fluxoEtapaTable.empresaId, empresaId),
          ),
        )
        .returning({ id: fluxoEtapaTable.id });
      gravadas += linhas.length;
    }
    if (gravadas !== posicoes.length) throw new EtapaNaoEncontrada();
    return gravadas;
  });
}

// ---------------------------------------------------------------------------
// Escrita — conexão
// ---------------------------------------------------------------------------

export class ConexaoDuplicada extends RecusaDeFluxo {
  constructor() {
    super("CONEXAO_DUPLICADA", "Estas duas etapas já estão ligadas por uma seta deste tipo.");
  }
}

/**
 * As duas pontas precisam ser etapas **deste** fluxo — conferido antes, com
 * frase própria, e garantido depois pelas chaves compostas do banco.
 *
 * A conferência aqui existe para a mensagem; a garantia é do banco. Se um dia
 * alguém escrever um caminho novo de gravação e esquecer esta função, o insert
 * continua sendo recusado — só que com um erro de chave estrangeira, que é feio
 * e é seguro.
 */
async function exigirEtapasDoFluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  ids: string[],
): Promise<void> {
  const unicos = [...new Set(ids)];
  const linhas = await db
    .select({ id: fluxoEtapaTable.id })
    .from(fluxoEtapaTable)
    .where(
      and(
        inArray(fluxoEtapaTable.id, unicos),
        eq(fluxoEtapaTable.fluxoId, fluxoId),
        eq(fluxoEtapaTable.empresaId, empresaId),
      ),
    );
  if (linhas.length !== unicos.length) throw new EtapaNaoEncontrada();
}

export async function criarConexao(
  db: Database,
  empresaId: string,
  fluxoId: string,
  bruto: unknown,
): Promise<Conexao> {
  await exigirFluxo(db, empresaId, fluxoId);
  const entrada = validarEntradaDeConexao(bruto);
  await exigirEtapasDoFluxo(db, empresaId, fluxoId, [
    entrada.origemEtapaId,
    entrada.destinoEtapaId,
  ]);

  const linhas = await db
    .insert(fluxoConexaoTable)
    .values({
      empresaId,
      fluxoId,
      origemEtapaId: entrada.origemEtapaId,
      destinoEtapaId: entrada.destinoEtapaId,
      tipo: entrada.tipo,
      rotulo: entrada.rotulo ?? null,
      ordem: entrada.ordem,
    })
    /*
      Duas mãos ligando as mesmas etapas ao mesmo tempo produziriam a mesma
      seta duas vezes. `onConflictDoNothing` sobre o índice único devolve lista
      vazia nesse caso, e a lista vazia vira a frase de duplicidade — em vez do
      23505 cru, que a tela não sabe ler.
    */
    .onConflictDoNothing({
      target: [
        fluxoConexaoTable.origemEtapaId,
        fluxoConexaoTable.destinoEtapaId,
        fluxoConexaoTable.tipo,
      ],
    })
    .returning();
  if (linhas.length === 0) throw new ConexaoDuplicada();
  return comoConexao(linhas[0]);
}

export async function atualizarConexao(
  db: Database,
  empresaId: string,
  fluxoId: string,
  conexaoId: string,
  bruto: unknown,
): Promise<Conexao> {
  const entrada = validarEntradaDeConexao(bruto);
  await exigirEtapasDoFluxo(db, empresaId, fluxoId, [
    entrada.origemEtapaId,
    entrada.destinoEtapaId,
  ]);

  const [linha] = await db
    .update(fluxoConexaoTable)
    .set({
      origemEtapaId: entrada.origemEtapaId,
      destinoEtapaId: entrada.destinoEtapaId,
      tipo: entrada.tipo,
      rotulo: entrada.rotulo ?? null,
      ordem: entrada.ordem,
      atualizadoEm: new Date(),
    })
    .where(
      and(
        eq(fluxoConexaoTable.id, conexaoId),
        eq(fluxoConexaoTable.fluxoId, fluxoId),
        eq(fluxoConexaoTable.empresaId, empresaId),
      ),
    )
    .returning();
  if (!linha) throw new ConexaoNaoEncontrada();
  return comoConexao(linha);
}

export async function excluirConexao(
  db: Database,
  empresaId: string,
  fluxoId: string,
  conexaoId: string,
): Promise<void> {
  const linhas = await db
    .delete(fluxoConexaoTable)
    .where(
      and(
        eq(fluxoConexaoTable.id, conexaoId),
        eq(fluxoConexaoTable.fluxoId, fluxoId),
        eq(fluxoConexaoTable.empresaId, empresaId),
      ),
    )
    .returning({ id: fluxoConexaoTable.id });
  if (linhas.length === 0) throw new ConexaoNaoEncontrada();
}

// ---------------------------------------------------------------------------
// Escrita — o material da etapa
// ---------------------------------------------------------------------------

/**
 * Itens, indicadores e ações são gravados **substituindo a lista inteira**.
 *
 * O editor dessas listas é uma tabelinha na gaveta da etapa: quem mexe nela
 * adiciona, remove e reordena numa sessão só, e só então salva. Um contrato de
 * criar/editar/excluir item a item exigiria três chamadas para uma edição que a
 * pessoa entende como uma, e deixaria a ordem inconsistente no meio do caminho.
 * A substituição é uma transação e uma requisição.
 *
 * O preço é que o `id` de um item muda quando a lista é regravada. Nada aponta
 * para esses `id`s — nem link, nem histórico, nem outra tabela —, então o preço
 * é zero. No dia em que algo apontar, isto vira `upsert` por `id`, e é por isso
 * que o `id` existe desde já.
 *
 * Itens são substituídos **por espécie**: salvar a lista de documentos não
 * apaga a de falhas. É a granularidade da tela.
 */
export async function substituirItens(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
  especie: EspecieDeItem,
  brutos: unknown,
): Promise<void> {
  await exigirEtapasDoFluxo(db, empresaId, fluxoId, [etapaId]);
  const lista = comoLista(brutos).map((item, i) => validarItem({ ...(item as object), especie }, i));

  await db.transaction(async (tx) => {
    await tx
      .delete(fluxoEtapaItemTable)
      .where(
        and(
          eq(fluxoEtapaItemTable.etapaId, etapaId),
          eq(fluxoEtapaItemTable.fluxoId, fluxoId),
          eq(fluxoEtapaItemTable.empresaId, empresaId),
          eq(fluxoEtapaItemTable.especie, especie),
        ),
      );
    if (lista.length === 0) return;
    await tx.insert(fluxoEtapaItemTable).values(
      lista.map((item) => ({
        empresaId,
        fluxoId,
        etapaId,
        especie: item.especie,
        nome: item.nome,
        descricao: item.descricao,
        obrigatorio: item.obrigatorio,
        link: item.link,
        ordem: item.ordem,
      })),
    );
  });
}

export async function substituirIndicadores(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
  brutos: unknown,
): Promise<void> {
  await exigirEtapasDoFluxo(db, empresaId, fluxoId, [etapaId]);
  const lista = comoLista(brutos).map((item, i) => validarIndicador(item, i));

  await db.transaction(async (tx) => {
    await tx
      .delete(fluxoEtapaIndicadorTable)
      .where(
        and(
          eq(fluxoEtapaIndicadorTable.etapaId, etapaId),
          eq(fluxoEtapaIndicadorTable.fluxoId, fluxoId),
          eq(fluxoEtapaIndicadorTable.empresaId, empresaId),
        ),
      );
    if (lista.length === 0) return;
    await tx
      .insert(fluxoEtapaIndicadorTable)
      .values(lista.map((item) => ({ empresaId, fluxoId, etapaId, ...item })));
  });
}

export async function substituirAcoes(
  db: Database,
  empresaId: string,
  fluxoId: string,
  etapaId: string,
  brutos: unknown,
): Promise<void> {
  await exigirEtapasDoFluxo(db, empresaId, fluxoId, [etapaId]);
  const lista = comoLista(brutos).map((item, i) => validarAcao(item, i));

  await db.transaction(async (tx) => {
    await tx
      .delete(fluxoEtapaAcaoTable)
      .where(
        and(
          eq(fluxoEtapaAcaoTable.etapaId, etapaId),
          eq(fluxoEtapaAcaoTable.fluxoId, fluxoId),
          eq(fluxoEtapaAcaoTable.empresaId, empresaId),
        ),
      );
    if (lista.length === 0) return;
    await tx
      .insert(fluxoEtapaAcaoTable)
      .values(lista.map((item) => ({ empresaId, fluxoId, etapaId, ...item })));
  });
}

function comoLista(bruto: unknown): unknown[] {
  if (bruto === undefined || bruto === null) return [];
  if (!Array.isArray(bruto)) {
    throw new RecusaDeFluxo("LISTA_INVALIDA", "Esperava uma lista.");
  }
  return bruto;
}

// ---------------------------------------------------------------------------
// Importação declarativa — o caminho da seed e do duplicar
// ---------------------------------------------------------------------------

/**
 * Um fluxo inteiro a partir de uma declaração, numa transação só.
 *
 * É por aqui que a seed do CTe entra, é por aqui que `duplicarFluxo` grava, e é
 * por aqui que um `POST /fluxos/importar` cria um fluxo completo. Uma função
 * para os três: se semear tivesse caminho próprio, o caminho próprio seria o
 * único testado.
 *
 * Idempotente pelo slug: a empresa que já tem `cte-ate-recebimento` recebe de
 * volta o fluxo que já tinha, sem duplicar e sem apagar as edições que alguém
 * fez nele. É o que permite chamar a semeadura em toda partida sem medo.
 */
export async function importarFluxo(
  db: Database,
  empresaId: string,
  declarado: FluxoDeclarado,
  autor: Autor,
): Promise<Fluxo> {
  await conferirEmpresa(db, empresaId);

  const cabecalho = validarEntradaDeFluxo(declarado);
  const etapas = declarado.etapas.map((etapa) => ({
    chave: etapa.chave,
    colunas: validarEntradaDeEtapa(etapa),
    itens: (etapa.itens ?? []).map((item, i) => validarItem(item, i)),
    indicadores: (etapa.indicadores ?? []).map((item, i) => validarIndicador(item, i)),
    acoes: (etapa.acoes ?? []).map((item, i) => validarAcao(item, i)),
  }));

  const chaves = new Set(etapas.map((e) => e.chave));
  if (chaves.size !== etapas.length) {
    throw new RecusaDeFluxo(
      "ETAPA_CHAVE_REPETIDA",
      "Duas etapas da declaração usam a mesma chave.",
    );
  }
  for (const conexao of declarado.conexoes) {
    if (!chaves.has(conexao.de) || !chaves.has(conexao.para)) {
      throw new RecusaDeFluxo(
        "CONEXAO_ETAPA_DESCONHECIDA",
        `A conexão ${conexao.de} → ${conexao.para} cita uma etapa que a declaração não tem.`,
      );
    }
  }

  return db.transaction(async (tx) => {
    const [ja] = await tx
      .select()
      .from(fluxoOperacionalTable)
      .where(
        and(
          eq(fluxoOperacionalTable.empresaId, empresaId),
          eq(fluxoOperacionalTable.slug, cabecalho.slug),
        ),
      )
      .limit(1);
    if (ja) return comoFluxo(ja);

    const [fluxo] = await tx
      .insert(fluxoOperacionalTable)
      .values({
        empresaId,
        nome: cabecalho.nome,
        slug: cabecalho.slug,
        descricao: cabecalho.descricao ?? null,
        objetivo: cabecalho.objetivo ?? null,
        categoria: cabecalho.categoria,
        status: cabecalho.status,
        dono: cabecalho.dono ?? null,
        criadoPor: autor.email,
        atualizadoPor: autor.email,
      })
      .returning();

    const idPorChave = new Map<string, string>();
    const etapasGravadas: Omit<Etapa, "itens" | "indicadores" | "acoes">[] = [];
    for (const [indice, etapa] of etapas.entries()) {
      const [linha] = await tx
        .insert(fluxoEtapaTable)
        .values({
          ...paraColunasDeEtapa(etapa.colunas),
          /* A ordem declarada vale; sem ela, a posição na lista. */
          ordem: etapa.colunas.ordem ?? indice,
          empresaId,
          fluxoId: fluxo.id,
        })
        .returning();
      idPorChave.set(etapa.chave, linha.id);
      etapasGravadas.push(comoEtapa(linha));
    }

    for (const etapa of etapas) {
      const etapaId = idPorChave.get(etapa.chave)!;
      if (etapa.itens.length > 0) {
        await tx
          .insert(fluxoEtapaItemTable)
          .values(
            etapa.itens.map((item) => ({ empresaId, fluxoId: fluxo.id, etapaId, ...item })),
          );
      }
      if (etapa.indicadores.length > 0) {
        await tx
          .insert(fluxoEtapaIndicadorTable)
          .values(
            etapa.indicadores.map((item) => ({ empresaId, fluxoId: fluxo.id, etapaId, ...item })),
          );
      }
      if (etapa.acoes.length > 0) {
        await tx
          .insert(fluxoEtapaAcaoTable)
          .values(
            etapa.acoes.map((item) => ({ empresaId, fluxoId: fluxo.id, etapaId, ...item })),
          );
      }
    }

    const conexoesGravadas: Conexao[] = [];
    for (const [indice, conexao] of declarado.conexoes.entries()) {
      const entrada = validarEntradaDeConexao({
        origemEtapaId: idPorChave.get(conexao.de),
        destinoEtapaId: idPorChave.get(conexao.para),
        tipo: conexao.tipo,
        rotulo: conexao.rotulo,
        ordem: conexao.ordem ?? indice,
      });
      const [linha] = await tx
        .insert(fluxoConexaoTable)
        .values({
          empresaId,
          fluxoId: fluxo.id,
          origemEtapaId: entrada.origemEtapaId,
          destinoEtapaId: entrada.destinoEtapaId,
          tipo: entrada.tipo,
          rotulo: entrada.rotulo ?? null,
          ordem: entrada.ordem,
        })
        .returning();
      conexoesGravadas.push(comoConexao(linha));
    }

    /*
      O desenho inicial, e por que ele é feito aqui.

      Uma declaração descreve o processo, não o layout — nenhum dos exemplos
      traz `posX`/`posY`, e não deveria trazer: pedir coordenada a quem está
      levantando um processo é pedir a coisa errada. Sem este passo, abrir o
      fluxo recém-importado mostraria dezoito cartões empilhados na origem, e a
      única saída seria arrastar um por um — a fricção que faz um cadastro
      nunca ser usado.

      Quem calcula é `posicionarEtapas`, função pura e testada em
      `__tests__/layout.test.ts`; aqui só se grava o que ela devolveu. E ela é
      chamada com o padrão `somenteSemPosicao`, então uma declaração que
      **traga** posições — a que `duplicarFluxo` monta a partir de um fluxo já
      arranjado à mão — passa por aqui sem ter nada mexido. A cópia sai com o
      arranjo do original, que é o que se espera de uma cópia.
    */
    const posicoes = posicionarEtapas(
      etapasGravadas.map((e) => ({ ...e, itens: [], indicadores: [], acoes: [] })),
      conexoesGravadas,
    );
    for (const posicao of posicoes) {
      await tx
        .update(fluxoEtapaTable)
        .set({ posX: posicao.posX, posY: posicao.posY })
        .where(
          and(
            eq(fluxoEtapaTable.id, posicao.etapaId),
            eq(fluxoEtapaTable.fluxoId, fluxo.id),
          ),
        );
    }

    return comoFluxo(fluxo);
  });
}

// ---------------------------------------------------------------------------
// Acrescentar em lote, e organizar — os dois atalhos do desenho
// ---------------------------------------------------------------------------

/**
 * Acrescenta etapas e ligações a um fluxo que já existe — numa transação só.
 *
 * É o irmão de `importarFluxo` para o fluxo que já nasceu: a mesma declaração,
 * as mesmas validações, e a diferença de que as chaves locais podem citar
 * etapas **que já estão no banco** pelo `id`. É o que faz "colar mais dez
 * etapas no fim do processo" custar uma chamada em vez de dez formulários.
 *
 * Três decisões, e cada uma tem um jeito conhecido de dar errado:
 *
 * - **A ordem continua de onde parou.** Uma etapa acrescentada nasce depois da
 *   última que existe, e não em `0` — senão o painel e o layout passariam a
 *   discordar da ordem em que o processo é contado.
 * - **A ligação com o que já existe é por `id`.** `de`/`para` aceitam uma chave
 *   da declaração ou o `id` de uma etapa deste fluxo; qualquer outra coisa é
 *   recusada com nome, e não silenciosamente ignorada.
 * - **O layout roda no fim, só sobre quem está na origem.** Quem já foi
 *   arrastado fica onde está; as etapas novas nascem posicionadas, que é a
 *   diferença entre um desenho e uma pilha no canto.
 */
export async function acrescentarRoteiro(
  db: Database,
  empresaId: string,
  fluxoId: string,
  declarado: { etapas: EtapaDeclarada[]; conexoes: ConexaoDeclarada[] },
  autor: Autor,
): Promise<{ etapasCriadas: number; conexoesCriadas: number }> {
  await exigirFluxo(db, empresaId, fluxoId);

  const etapas = declarado.etapas.map((etapa) => ({
    chave: etapa.chave,
    colunas: validarEntradaDeEtapa(etapa),
    itens: (etapa.itens ?? []).map((item, i) => validarItem(item, i)),
    indicadores: (etapa.indicadores ?? []).map((item, i) => validarIndicador(item, i)),
    acoes: (etapa.acoes ?? []).map((item, i) => validarAcao(item, i)),
  }));
  if (etapas.length === 0) {
    throw new RecusaDeFluxo("ROTEIRO_VAZIO", "Não há nenhuma etapa para acrescentar.");
  }
  const chaves = new Set(etapas.map((e) => e.chave));
  if (chaves.size !== etapas.length) {
    throw new RecusaDeFluxo("ETAPA_CHAVE_REPETIDA", "Duas etapas da declaração usam a mesma chave.");
  }

  const existentes = await db
    .select({ id: fluxoEtapaTable.id, ordem: fluxoEtapaTable.ordem })
    .from(fluxoEtapaTable)
    .where(and(eq(fluxoEtapaTable.fluxoId, fluxoId), eq(fluxoEtapaTable.empresaId, empresaId)));
  const idsExistentes = new Set(existentes.map((e) => e.id));
  const proximaOrdem = existentes.reduce((maior, e) => Math.max(maior, e.ordem + 1), 0);

  for (const conexao of declarado.conexoes) {
    for (const ponta of [conexao.de, conexao.para]) {
      if (!chaves.has(ponta) && !idsExistentes.has(ponta)) {
        throw new RecusaDeFluxo(
          "CONEXAO_ETAPA_DESCONHECIDA",
          `A conexão ${conexao.de} → ${conexao.para} cita "${ponta}", que não é etapa deste fluxo nem chave da declaração.`,
        );
      }
    }
  }

  return db.transaction(async (tx) => {
    const idPorChave = new Map<string, string>();
    for (const [indice, etapa] of etapas.entries()) {
      const [linha] = await tx
        .insert(fluxoEtapaTable)
        .values({
          ...paraColunasDeEtapa(etapa.colunas),
          ordem: proximaOrdem + indice,
          empresaId,
          fluxoId,
        })
        .returning();
      idPorChave.set(etapa.chave, linha.id);

      if (etapa.itens.length > 0) {
        await tx
          .insert(fluxoEtapaItemTable)
          .values(
            etapa.itens.map((item) => ({ empresaId, fluxoId, etapaId: linha.id, ...item })),
          );
      }
      if (etapa.indicadores.length > 0) {
        await tx
          .insert(fluxoEtapaIndicadorTable)
          .values(
            etapa.indicadores.map((item) => ({ empresaId, fluxoId, etapaId: linha.id, ...item })),
          );
      }
      if (etapa.acoes.length > 0) {
        await tx
          .insert(fluxoEtapaAcaoTable)
          .values(
            etapa.acoes.map((item) => ({ empresaId, fluxoId, etapaId: linha.id, ...item })),
          );
      }
    }

    /* Uma chave da declaração vira o `id` recém-criado; um `id` já era um. */
    const identidade = (ponta: string): string => idPorChave.get(ponta) ?? ponta;

    let conexoesCriadas = 0;
    for (const [indice, conexao] of declarado.conexoes.entries()) {
      const entrada = validarEntradaDeConexao({
        origemEtapaId: identidade(conexao.de),
        destinoEtapaId: identidade(conexao.para),
        tipo: conexao.tipo,
        rotulo: conexao.rotulo,
        ordem: conexao.ordem ?? indice,
      });
      await tx.insert(fluxoConexaoTable).values({
        empresaId,
        fluxoId,
        origemEtapaId: entrada.origemEtapaId,
        destinoEtapaId: entrada.destinoEtapaId,
        tipo: entrada.tipo,
        rotulo: entrada.rotulo ?? null,
        ordem: entrada.ordem,
      });
      conexoesCriadas += 1;
    }

    await tx
      .update(fluxoOperacionalTable)
      .set({ atualizadoEm: new Date(), atualizadoPor: autor.email })
      .where(
        and(eq(fluxoOperacionalTable.id, fluxoId), eq(fluxoOperacionalTable.empresaId, empresaId)),
      );

    await aplicarLayout(tx, empresaId, fluxoId, { somenteSemPosicao: true });
    return { etapasCriadas: etapas.length, conexoesCriadas };
  });
}

/**
 * "Organizar" — o layout automático aplicado ao fluxo que já está no banco.
 *
 * `posicionarEtapas` é puro e testado desde o começo do módulo, e até aqui
 * ninguém o chamava fora da importação: quem montasse um fluxo à mão ficava com
 * o que arrastou, e quem esquecesse de arrastar ficava com a pilha na origem.
 *
 * `refazerTudo` é a diferença entre os dois pedidos que a palavra "organizar"
 * carrega: *arrume o que ficou para trás* (padrão, respeita todo cartão que
 * alguém posicionou) e *desmanche e refaça* (explícito, e a tela pergunta antes).
 */
export async function organizarFluxo(
  db: Database,
  empresaId: string,
  fluxoId: string,
  opcoes: { refazerTudo?: boolean } = {},
): Promise<{ movidas: number }> {
  await exigirFluxo(db, empresaId, fluxoId);
  return db.transaction(async (tx) =>
    aplicarLayout(tx, empresaId, fluxoId, {
      somenteSemPosicao: !(opcoes.refazerTudo ?? false),
    }),
  );
}

/**
 * O layout, gravado — a parte que as duas funções acima compartilham.
 *
 * Lê as etapas e as conexões de dentro da transação em curso, chama a função
 * pura e grava o que ela devolveu. Ler aqui, e não receber pronto, é o que
 * garante que o cálculo enxergue as etapas que a mesma transação acabou de
 * criar.
 */
async function aplicarLayout(
  tx: Database,
  empresaId: string,
  fluxoId: string,
  opcoes: { somenteSemPosicao: boolean },
): Promise<{ movidas: number }> {
  const etapas = await tx
    .select()
    .from(fluxoEtapaTable)
    .where(and(eq(fluxoEtapaTable.fluxoId, fluxoId), eq(fluxoEtapaTable.empresaId, empresaId)))
    .orderBy(asc(fluxoEtapaTable.ordem));
  const conexoes = await tx
    .select()
    .from(fluxoConexaoTable)
    .where(and(eq(fluxoConexaoTable.fluxoId, fluxoId), eq(fluxoConexaoTable.empresaId, empresaId)))
    .orderBy(asc(fluxoConexaoTable.ordem));

  const posicoes = posicionarEtapas(
    etapas.map((e) => ({ ...comoEtapa(e), itens: [], indicadores: [], acoes: [] })),
    conexoes.map(comoConexao),
    { somenteSemPosicao: opcoes.somenteSemPosicao },
  );

  for (const posicao of posicoes) {
    await tx
      .update(fluxoEtapaTable)
      .set({ posX: posicao.posX, posY: posicao.posY })
      .where(
        and(eq(fluxoEtapaTable.id, posicao.etapaId), eq(fluxoEtapaTable.fluxoId, fluxoId)),
      );
  }
  return { movidas: posicoes.length };
}

// ---------------------------------------------------------------------------
// Conversão — a fronteira entre a linha do banco e o que a API promete
// ---------------------------------------------------------------------------

type LinhaDeFluxo = typeof fluxoOperacionalTable.$inferSelect;
type LinhaDeEtapa = typeof fluxoEtapaTable.$inferSelect;
type LinhaDeConexao = typeof fluxoConexaoTable.$inferSelect;
type LinhaDeItem = typeof fluxoEtapaItemTable.$inferSelect;
type LinhaDeIndicador = typeof fluxoEtapaIndicadorTable.$inferSelect;
type LinhaDeAcao = typeof fluxoEtapaAcaoTable.$inferSelect;

/**
 * As datas saem em ISO, e não como `Date`.
 *
 * O que atravessa HTTP é texto de qualquer jeito; devolver `Date` daqui faria o
 * tipo do repositório mentir sobre o que a tela recebe, e é o tipo do
 * repositório que os testes conferem.
 */
function comoFluxo(linha: LinhaDeFluxo): Fluxo {
  return {
    id: linha.id,
    empresaId: linha.empresaId,
    nome: linha.nome,
    slug: linha.slug,
    descricao: linha.descricao,
    objetivo: linha.objetivo,
    categoria: linha.categoria,
    status: linha.status as Fluxo["status"],
    versao: linha.versao,
    dono: linha.dono,
    criadoEm: linha.criadoEm.toISOString(),
    atualizadoEm: linha.atualizadoEm.toISOString(),
    criadoPor: linha.criadoPor,
    atualizadoPor: linha.atualizadoPor,
  };
}

function comoEtapa(linha: LinhaDeEtapa): Omit<Etapa, "itens" | "indicadores" | "acoes"> {
  return {
    id: linha.id,
    fluxoId: linha.fluxoId,
    nome: linha.nome,
    descricao: linha.descricao,
    tipo: linha.tipo as Etapa["tipo"],
    ordem: linha.ordem,
    responsavel: linha.responsavel,
    area: linha.area,
    objetivo: linha.objetivo,
    sistemaPrincipal: linha.sistemaPrincipal,
    regras: linha.regras,
    informacoesConsultadas: linha.informacoesConsultadas,
    observacoes: linha.observacoes,
    status: linha.status as Etapa["status"],
    posX: linha.posX,
    posY: linha.posY,
    chaveMonitoramento: linha.chaveMonitoramento,
    subfluxoId: linha.subfluxoId,
  };
}

function comoConexao(linha: LinhaDeConexao): Conexao {
  return {
    id: linha.id,
    fluxoId: linha.fluxoId,
    origemEtapaId: linha.origemEtapaId,
    destinoEtapaId: linha.destinoEtapaId,
    tipo: linha.tipo as Conexao["tipo"],
    rotulo: linha.rotulo,
    ordem: linha.ordem,
  };
}

function comoItem(linha: LinhaDeItem): ItemDaEtapa {
  return {
    id: linha.id,
    especie: linha.especie as EspecieDeItem,
    nome: linha.nome,
    descricao: linha.descricao,
    obrigatorio: linha.obrigatorio,
    link: linha.link,
    ordem: linha.ordem,
  };
}

function comoIndicador(linha: LinhaDeIndicador): IndicadorDaEtapa {
  return {
    id: linha.id,
    nome: linha.nome,
    descricao: linha.descricao,
    unidade: linha.unidade,
    sentido: linha.sentido as SentidoDoIndicador,
    origem: linha.origem,
    ordem: linha.ordem,
  };
}

function comoAcao(linha: LinhaDeAcao): AcaoDaEtapa {
  return {
    id: linha.id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    rota: linha.rota,
    parametros: (linha.parametros as Record<string, string> | null) ?? null,
    icone: linha.icone,
    ordem: linha.ordem,
  };
}

function paraColunasDeEtapa(entrada: ReturnType<typeof validarEntradaDeEtapa>) {
  return {
    nome: entrada.nome,
    descricao: entrada.descricao ?? null,
    tipo: entrada.tipo,
    ordem: entrada.ordem ?? 0,
    responsavel: entrada.responsavel ?? null,
    area: entrada.area ?? null,
    objetivo: entrada.objetivo ?? null,
    sistemaPrincipal: entrada.sistemaPrincipal ?? null,
    regras: entrada.regras ?? null,
    informacoesConsultadas: entrada.informacoesConsultadas ?? null,
    observacoes: entrada.observacoes ?? null,
    status: entrada.status,
    posX: entrada.posX,
    posY: entrada.posY,
    chaveMonitoramento: entrada.chaveMonitoramento ?? null,
  };
}

export type {
  EntradaDeAcao,
  EntradaDeConexao,
  EntradaDeEtapa,
  EntradaDeFluxo,
  EntradaDeIndicador,
  EntradaDeItem,
};
