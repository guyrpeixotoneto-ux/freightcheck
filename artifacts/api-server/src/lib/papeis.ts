import { and, asc, count, desc, eq, ne, sql } from "drizzle-orm";
import {
  appUserTable,
  papelEventoTable,
  papelPermissaoTable,
  papelTable,
  type Database,
} from "@workspace/db";
import {
  CHAVE_PADRAO,
  NIVEL_PADRAO,
  ehNivel,
  padraoDe,
  permissoesDoPapel,
  type Nivel,
} from "./permissoes";

/**
 * Papel — o acesso cadastrado uma vez, valendo para todo mundo que o usa.
 *
 * `permissoes.ts` responde "o que esta pessoa alcança" e é por pessoa. Este
 * arquivo responde "o que um **conferente** alcança", e a conta aponta para a
 * resposta em vez de a copiar: mexer no papel muda o acesso de quem o usa na
 * mesma hora (`schema/papel.ts` diz por que é vínculo, e não carimbo).
 *
 * Duas coisas moram aqui e não são óbvias:
 *
 * · **`app_user.role` é escrito daqui.** Ele continua sendo a coluna que o
 *   servidor lê em dezenas de lugares para saber quem gerencia contas — e
 *   passou a ser derivado de `papel.gerencia_contas`. Quem troca o papel de uma
 *   conta, e quem troca o `gerencia_contas` de um papel, reescreve o `role` de
 *   quem aquilo alcança, no mesmo caminho e sem exceção. Uma decisão, um dono,
 *   uma escrita: é o que impede a coluna e o papel de discordarem.
 * · **Os dois papéis do sistema não se apagam nem se renomeiam.** Toda conta
 *   anterior à `0082` aponta para um deles, e um produto sem nenhum papel que
 *   administre contas é a porta trancada por dentro. As permissões deles se
 *   editam como as de qualquer outro — é o que faz o cadastro valer também para
 *   quem nunca criar um papel novo.
 */

export const ROLE_ADMIN = "ADMIN";
export const ROLE_OPERADOR = "OPERADOR";

/** O `role` que um papel implica — a única conversão, e ela mora aqui. */
export function roleDoPapel(gerenciaContas: boolean): string {
  return gerenciaContas ? ROLE_ADMIN : ROLE_OPERADOR;
}

export interface Papel {
  id: string;
  nome: string;
  descricao: string | null;
  gerenciaContas: boolean;
  /**
   * O piso do perfil — o nível de toda chave sem linha própria.
   *
   * `EDITAR` é o de quase todo perfil, e é o que o produto sempre teve: a
   * ausência concede. `Leitor` nasce `VISUALIZAR`, e é só por causa desta
   * coluna que ele é dizível sem uma linha por módulo do menu (ver
   * `schema/papel.ts`).
   */
  nivelPadrao: Nivel;
  sistema: boolean;
  criadoEm: string;
  criadoPor: string | null;
  /** Quantas contas usam este papel — a lista mostra, e a exclusão depende. */
  contas: number;
  /** Quantas chaves ele restringe. Zero é o papel que alcança tudo. */
  restricoes: number;
}

export async function listarPapeis(db: Database): Promise<Papel[]> {
  /*
    Duas contagens vindas de duas tabelas na mesma consulta dariam produto
    cartesiano — cada conta multiplicada por cada restrição —, e o número
    apareceria certo na tela até o dia em que um papel tivesse as duas coisas.
    São duas junções agregadas separadas, cada uma já reduzida ao papel.
  */
  const contas = db
    .select({
      papelId: appUserTable.papelId,
      total: sql<number>`count(*)::int`.as("total_contas"),
    })
    .from(appUserTable)
    .groupBy(appUserTable.papelId)
    .as("contas");

  const restricoes = db
    .select({
      papelId: papelPermissaoTable.papelId,
      total: sql<number>`count(*)::int`.as("total_restricoes"),
    })
    .from(papelPermissaoTable)
    .groupBy(papelPermissaoTable.papelId)
    .as("restricoes");

  const linhas = await db
    .select({
      id: papelTable.id,
      nome: papelTable.nome,
      descricao: papelTable.descricao,
      gerenciaContas: papelTable.gerenciaContas,
      nivelPadrao: papelTable.nivelPadrao,
      sistema: papelTable.sistema,
      criadoEm: papelTable.criadoEm,
      criadoPor: papelTable.criadoPor,
      contas: contas.total,
      restricoes: restricoes.total,
    })
    .from(papelTable)
    .leftJoin(contas, eq(contas.papelId, papelTable.id))
    .leftJoin(restricoes, eq(restricoes.papelId, papelTable.id))
    /* Os do sistema primeiro, e o resto por nome: a lista abre no que toda
       instalação tem, e não no que a última pessoa cadastrou. */
    .orderBy(desc(papelTable.sistema), asc(papelTable.nome));

  return linhas.map((l) => ({
    ...l,
    nivelPadrao: ehNivel(l.nivelPadrao) ? l.nivelPadrao : NIVEL_PADRAO,
    criadoEm: l.criadoEm.toISOString(),
    contas: l.contas ?? 0,
    restricoes: l.restricoes ?? 0,
  }));
}

export async function papelPorId(
  db: Database,
  id: string,
): Promise<Papel | null> {
  return (await listarPapeis(db)).find((p) => p.id === id) ?? null;
}

/** O papel de mesmo nome, ignorando maiúsculas — a recusa de duplicata. */
export async function papelPorNome(
  db: Database,
  nome: string,
  exceto?: string,
): Promise<{ id: string; nome: string } | null> {
  const [linha] = await db
    .select({ id: papelTable.id, nome: papelTable.nome })
    .from(papelTable)
    .where(
      exceto === undefined
        ? sql`lower(${papelTable.nome}) = lower(${nome})`
        : and(sql`lower(${papelTable.nome}) = lower(${nome})`, ne(papelTable.id, exceto)),
    )
    .limit(1);
  return linha ?? null;
}

/** Quantos papéis que gerenciam contas têm gente ativa dentro. */
export async function contasAtivasQueAdministram(
  db: Database,
  exceto?: string,
): Promise<number> {
  const [linha] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(appUserTable)
    .innerJoin(papelTable, eq(papelTable.id, appUserTable.papelId))
    .where(
      and(
        sql`${appUserTable.disabledAt} IS NULL`,
        eq(papelTable.gerenciaContas, true),
        ...(exceto === undefined ? [] : [ne(appUserTable.id, exceto)]),
      ),
    );
  return linha?.total ?? 0;
}

/**
 * O papel do sistema que corresponde a um `role` — a ponte com quem ainda fala
 * ADMIN/OPERADOR: o CLI que cria conta pelo terminal, e a rota `/users/:id/role`.
 *
 * `null` só num banco em que a `0082` não semeou nada, e o caminho de quem
 * chama é então continuar pelo `role` puro, como antes dela.
 */
export async function papelDoSistema(
  db: Database,
  gerenciaContas: boolean,
): Promise<Papel | null> {
  const [linha] = await db
    .select({ id: papelTable.id })
    .from(papelTable)
    .where(
      and(eq(papelTable.sistema, true), eq(papelTable.gerenciaContas, gerenciaContas)),
    )
    /*
      O que concede primeiro, e o nome como desempate. Desde a `0095` há dois
      perfis do sistema que não gerenciam contas — `Gestor` e `Leitor` —, e a
      ordem alfabética sozinha é um empate frágil: quem chama isto quer o
      equivalente do `role` OPERADOR, que é o perfil que usa o produto inteiro,
      e não o que só o lê. Uma renomeação futura não pode mudar isso por acaso.
    */
    .orderBy(sql`${papelTable.nivelPadrao} = 'EDITAR' DESC`, asc(papelTable.nome))
    .limit(1);
  return linha ? papelPorId(db, linha.id) : null;
}

export async function criarPapel(
  db: Database,
  entrada: {
    nome: string;
    descricao: string | null;
    gerenciaContas: boolean;
    /** O piso do perfil. Ausente é `EDITAR` — o perfil que alcança tudo. */
    nivelPadrao?: Nivel;
    por: string;
  },
): Promise<Papel> {
  const [criado] = await db
    .insert(papelTable)
    .values({
      nome: entrada.nome.trim(),
      descricao: entrada.descricao,
      gerenciaContas: entrada.gerenciaContas,
      nivelPadrao: entrada.nivelPadrao ?? NIVEL_PADRAO,
      criadoPor: entrada.por,
    })
    .returning({ id: papelTable.id });

  await db.insert(papelEventoTable).values({
    papelId: criado!.id,
    tipo: "CRIADO",
    detalhe: entrada.gerenciaContas
      ? `${entrada.nome.trim()} — gerencia contas`
      : entrada.nome.trim(),
    por: entrada.por,
  });

  return (await papelPorId(db, criado!.id))!;
}

/**
 * Renomear, redescrever e dar ou tirar a administração de contas.
 *
 * A administração é a única que sai daqui e mexe em outra tabela: dar-lhe (ou
 * tirar-lhe) o poder de gerenciar contas reescreve o `role` de **todas** as
 * contas do papel, que é o vínculo funcionando. Um papel promovido cujas contas
 * ficassem OPERADOR seria a tela dizendo uma coisa e o portão fazendo outra.
 */
export async function atualizarPapel(
  db: Database,
  id: string,
  mudanca: {
    nome?: string;
    descricao?: string | null;
    gerenciaContas?: boolean;
    nivelPadrao?: Nivel;
  },
  por: string,
): Promise<Papel> {
  const antes = (await papelPorId(db, id))!;

  await db
    .update(papelTable)
    .set({
      ...(mudanca.nome !== undefined ? { nome: mudanca.nome.trim() } : {}),
      ...(mudanca.descricao !== undefined ? { descricao: mudanca.descricao } : {}),
      ...(mudanca.gerenciaContas !== undefined
        ? { gerenciaContas: mudanca.gerenciaContas }
        : {}),
      ...(mudanca.nivelPadrao !== undefined
        ? { nivelPadrao: mudanca.nivelPadrao }
        : {}),
    })
    .where(eq(papelTable.id, id));

  /*
    Mudar o piso é o ato mais amplo que existe sobre um perfil — ele reescreve
    toda chave que ninguém decidiu, que é quase o menu inteiro —, e por isso ele
    é gravado como as outras permissões, na chave `*`. O histórico da tela lê a
    chave e diz "Tudo o que não tem decisão própria" no lugar dela.
  */
  if (
    mudanca.nivelPadrao !== undefined &&
    mudanca.nivelPadrao !== antes.nivelPadrao
  ) {
    await db.insert(papelEventoTable).values({
      papelId: id,
      chave: CHAVE_PADRAO,
      tipo: "PERMISSAO",
      nivelAnterior: antes.nivelPadrao,
      nivel: mudanca.nivelPadrao,
      por,
    });
  }

  if (mudanca.nome !== undefined && mudanca.nome.trim() !== antes.nome) {
    await db.insert(papelEventoTable).values({
      papelId: id,
      tipo: "RENOMEADO",
      detalhe: `${antes.nome} → ${mudanca.nome.trim()}`,
      por,
    });
  }

  if (
    mudanca.gerenciaContas !== undefined &&
    mudanca.gerenciaContas !== antes.gerenciaContas
  ) {
    await sincronizarRoleDoPapel(db, id, mudanca.gerenciaContas);
    await db.insert(papelEventoTable).values({
      papelId: id,
      tipo: "ADMINISTRACAO",
      detalhe: mudanca.gerenciaContas
        ? "passou a gerenciar contas"
        : "deixou de gerenciar contas",
      por,
    });
  }

  return (await papelPorId(db, id))!;
}

/** Reescreve o `role` de quem usa o papel. Ver o cabeçalho deste arquivo. */
export async function sincronizarRoleDoPapel(
  db: Database,
  papelId: string,
  gerenciaContas: boolean,
): Promise<void> {
  await db
    .update(appUserTable)
    .set({ role: roleDoPapel(gerenciaContas) })
    .where(eq(appUserTable.papelId, papelId));
}

/**
 * Põe uma conta num papel — e acerta o `role` dela no mesmo ato.
 *
 * As exceções da conta (`permissao_de_modulo`) **não** são tocadas: elas foram
 * decididas sobre aquela pessoa e continuam vencendo o papel novo. Apagá-las ao
 * trocar de papel seria desfazer, sem pedir, decisões que alguém tomou uma a
 * uma — e a tela de Permissões mostra as duas camadas justamente para que quem
 * quiser desfazê-las as veja antes.
 */
export async function definirPapelDaConta(
  db: Database,
  userId: string,
  papelId: string,
): Promise<void> {
  const [papel] = await db
    .select({ gerenciaContas: papelTable.gerenciaContas })
    .from(papelTable)
    .where(eq(papelTable.id, papelId))
    .limit(1);
  if (!papel) return;

  await db
    .update(appUserTable)
    .set({ papelId, role: roleDoPapel(papel.gerenciaContas) })
    .where(eq(appUserTable.id, userId));
}

/**
 * Grava as restrições de um papel, e só as que mudaram.
 *
 * Espelho de `definirPermissoes`, uma camada acima: o nível igual ao **piso do
 * perfil** apaga a linha, porque um perfil é a lista do que ele diz de
 * diferente do próprio piso. Num perfil que concede — quase todos — o piso é
 * `EDITAR` e nada mudou; num `Leitor` ele é `VISUALIZAR`, e é contra isso que
 * cada chave se compara.
 *
 * A linha de base é o piso e não outro perfil: não há herança entre perfis, de
 * propósito (ver `schema/papel.ts`).
 */
export async function definirPermissoesDoPapel(
  db: Database,
  entrada: { papelId: string; niveis: Record<string, Nivel>; por: string },
): Promise<Record<string, Nivel>> {
  const atuais = await permissoesDoPapel(db, entrada.papelId);
  /*
    O piso do perfil, e não a constante: num `Leitor`, a linha de base é
    `VISUALIZAR` — e é ela que a ausência de linha significa. Comparar contra
    `EDITAR` gravaria noventa linhas `VISUALIZAR` que não dizem nada, e apagar
    uma delas devolveria o módulo a `EDITAR` num perfil que não edita.
  */
  const piso = padraoDe(atuais);

  for (const [chave, nivel] of Object.entries(entrada.niveis)) {
    /* O piso se muda em `PUT /papeis/:id`, e não aqui: ele é do cadastro do
       perfil, e não uma das chaves que ele restringe. */
    if (chave === CHAVE_PADRAO) continue;
    const anterior = atuais[chave];
    if ((anterior ?? piso) === nivel) continue;

    if (nivel === piso) {
      await db
        .delete(papelPermissaoTable)
        .where(
          and(
            eq(papelPermissaoTable.papelId, entrada.papelId),
            eq(papelPermissaoTable.chave, chave),
          ),
        );
    } else {
      await db
        .insert(papelPermissaoTable)
        .values({
          papelId: entrada.papelId,
          chave,
          nivel,
          definidoPor: entrada.por,
        })
        .onConflictDoUpdate({
          target: [papelPermissaoTable.papelId, papelPermissaoTable.chave],
          set: { nivel, definidoPor: entrada.por, definidoEm: new Date() },
        });
    }

    await db.insert(papelEventoTable).values({
      papelId: entrada.papelId,
      chave,
      tipo: "PERMISSAO",
      nivelAnterior: anterior ?? null,
      nivel,
      por: entrada.por,
    });
  }

  return permissoesDoPapel(db, entrada.papelId);
}

export interface EventoDoPapel {
  chave: string | null;
  tipo: string;
  nivelAnterior: string | null;
  nivel: string | null;
  detalhe: string | null;
  em: string;
  por: string;
}

export async function historicoDoPapel(
  db: Database,
  papelId: string,
): Promise<EventoDoPapel[]> {
  const linhas = await db
    .select({
      chave: papelEventoTable.chave,
      tipo: papelEventoTable.tipo,
      nivelAnterior: papelEventoTable.nivelAnterior,
      nivel: papelEventoTable.nivel,
      detalhe: papelEventoTable.detalhe,
      em: papelEventoTable.em,
      por: papelEventoTable.por,
    })
    .from(papelEventoTable)
    .where(eq(papelEventoTable.papelId, papelId))
    .orderBy(desc(papelEventoTable.em))
    .limit(200);

  return linhas.map((l) => ({ ...l, em: l.em.toISOString() }));
}

/**
 * Apaga um papel — e só um que ninguém use.
 *
 * As restrições e o histórico dele vão junto (`ON DELETE CASCADE`), e é a única
 * exclusão do produto que leva histórico embora. A razão é que o histórico de um
 * papel é sobre o papel: sem ele, ninguém mais pergunta por aquelas linhas. O que
 * **não** vai embora é o histórico das contas — quem tirou o quê de quem
 * continua em `permissao_de_modulo_evento`, onde sempre esteve.
 */
export async function excluirPapel(db: Database, id: string): Promise<void> {
  await db.delete(papelTable).where(eq(papelTable.id, id));
}

/**
 * O nome do perfil de uma conta — o rótulo que a barra do topo mostra.
 *
 * `null` na conta criada pelo terminal antes do cadastro existir, e a tela diz
 * isso em vez de chutar um nome.
 */
export async function nomeDoPerfilDaConta(
  db: Database,
  userId: string,
): Promise<string | null> {
  const [linha] = await db
    .select({ nome: papelTable.nome })
    .from(appUserTable)
    .innerJoin(papelTable, eq(papelTable.id, appUserTable.papelId))
    .where(eq(appUserTable.id, userId))
    .limit(1);
  return linha?.nome ?? null;
}

/** Quantas contas usam o papel — a rota conta antes de recusar a exclusão. */
export async function contasDoPapel(db: Database, id: string): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(appUserTable)
    .where(eq(appUserTable.papelId, id));
  return linha?.total ?? 0;
}
