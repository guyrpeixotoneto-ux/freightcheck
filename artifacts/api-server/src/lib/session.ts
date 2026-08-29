import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  appUserTable,
  cargoTable,
  unidadeTable,
  userSessionTable,
  type Database,
} from "@workspace/db";
import {
  apelidoDoNome,
  hashPassword,
  hashSessionToken,
  newSessionToken,
  normalizeEmail,
} from "./auth";

/**
 * Sessões e contas, do lado do banco.
 *
 * A regra que organiza este arquivo: nenhuma função aqui devolve o hash da
 * senha nem o token. O que sai daqui para uma rota é sempre `SessionUser` — o
 * que a interface pode mostrar e o histórico pode gravar como `actor`.
 */

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  /** ADMIN gerencia contas; OPERADOR usa o produto. Ver a migration 0037. */
  role: string;
}

/**
 * Sete dias, absolutos.
 *
 * Não é deslizante: uma sessão aberta há sete dias expira com a aba aberta, e
 * quem estiver usando faz login de novo. O produto edita a semântica que
 * sustenta números financeiros; uma sessão que se renova para sempre é uma
 * credencial permanente presa num navegador que ninguém lembra que existe.
 */
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** `last_seen_at` é diagnóstico, não controle de acesso: escrever a cada
 * requisição seria um UPDATE por chamada de API para nada. */
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export const SESSION_COOKIE = "freightcheck_session";
export const SESSION_MAX_AGE_MS = SESSION_TTL_MS;

/** Código do Postgres para violação de unicidade — aqui, e-mail repetido. */
const UNIQUE_VIOLATION = "23505";

/**
 * O código do Postgres não vem no topo do erro.
 *
 * O Drizzle embrulha o erro do driver num `DrizzleQueryError` e pendura o
 * original em `cause`. Procurar `code` só no primeiro nível — que é o que este
 * arquivo fazia — significa nunca reconhecer o e-mail repetido: a rota
 * respondia 500 "não foi possível criar a conta" para o caso mais comum e mais
 * fácil de explicar que ela tem.
 */
export function isUniqueViolation(err: unknown): boolean {
  // O limite existe para o caso de uma corrente de `cause` circular; nenhuma
  // biblioteca aqui produz uma, e um `while (true)` seria confiar nisso.
  let current: unknown = err;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code: unknown }).code === UNIQUE_VIOLATION
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export class EmailAlreadyUsedError extends Error {
  constructor() {
    super("Já existe uma conta com esse e-mail.");
    this.name = "EmailAlreadyUsedError";
  }
}

export async function countUsers(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(appUserTable);
  return row?.total ?? 0;
}

/** Contas que ainda entram. É o número que impede desativar a última delas. */
export async function countActiveUsers(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(appUserTable)
    .where(isNull(appUserTable.disabledAt));
  return row?.total ?? 0;
}

/** Administradores ativos agora — a guarda do "último admin". */
export async function countActiveAdmins(db: Database): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(appUserTable)
    .where(and(isNull(appUserTable.disabledAt), eq(appUserTable.role, "ADMIN")));
  return row?.total ?? 0;
}

/** Muda o papel. A validação do valor e a guarda do último admin são da rota. */
export async function setUserRole(
  db: Database,
  userId: string,
  role: string,
): Promise<void> {
  await db
    .update(appUserTable)
    .set({ role })
    .where(eq(appUserTable.id, userId));
}

/**
 * Define a lotação de uma conta — o cargo e a unidade da pessoa.
 *
 * Fica separada de `setUserRole` de propósito, e a distância entre as duas é a
 * coisa mais importante deste arquivo hoje: **papel é acesso, lotação é
 * cadastro.** ADMIN e OPERADOR decidem o que a pessoa pode fazer no produto;
 * cargo e unidade dizem o que ela faz na empresa. Juntar os dois numa rota só
 * faria uma promoção na empresa virar uma promoção de acesso sem que ninguém
 * tivesse pedido isso.
 *
 * O que não é validado aqui é validado onde tem que ser: o `id` de cargo e o de
 * unidade existirem é problema da chave estrangeira e da rota, que checa antes
 * para poder dizer qual dos dois está errado.
 */
export async function definirLotacao(
  db: Database,
  userId: string,
  lotacao: { cargoId: string | null; unidadeId: string | null },
): Promise<void> {
  await db
    .update(appUserTable)
    .set({ cargoId: lotacao.cargoId, unidadeId: lotacao.unidadeId })
    .where(eq(appUserTable.id, userId));
}

/**
 * O e-mail que o sistema gera quando quem cria a conta não informa um.
 *
 * `João da Silva` + `grupohorizonte.com.br` vira
 * `joao.silva@grupohorizonte.com.br`; um segundo João da Silva vira
 * `joao.silva2@…`, e assim por diante. O sufixo é numérico e começa no 2
 * porque é o que uma pessoa escreveria à mão — e porque `joao.silva1` sugere
 * que existe um `joao.silva0`, que não existe.
 *
 * **Consulta antes e ainda assim pode perder a corrida**, e é por isso que
 * quem chama continua tratando `EmailAlreadyUsedError`: duas criações no mesmo
 * instante veriam o mesmo vago e a segunda esbarra no índice único, que é o
 * único juiz do assunto. A consulta existe para que o caso comum saia com o
 * endereço bonito, não para substituir o índice.
 *
 * Devolve `null` quando o nome não deixa nada aproveitável — um nome só de
 * símbolos —, e quem chama pede o e-mail em vez de inventar um.
 */
export async function gerarEmailDisponivel(
  db: Database,
  nome: string,
  dominio: string,
): Promise<string | null> {
  const apelido = apelidoDoNome(nome);
  if (apelido === "") return null;

  const candidatos = Array.from(
    { length: MAXIMO_DE_HOMONIMOS },
    (_, i) => `${apelido}${i === 0 ? "" : i + 1}@${dominio}`,
  );
  const tomados = new Set(
    (
      await db
        .select({ email: appUserTable.email })
        .from(appUserTable)
        .where(inArray(appUserTable.email, candidatos))
    ).map((linha) => linha.email),
  );

  return candidatos.find((email) => !tomados.has(email)) ?? null;
}

/**
 * Quantos homônimos o gerador tenta antes de desistir e pedir o e-mail.
 *
 * Vinte é folgado para uma casa inteira e curto o bastante para que a consulta
 * continue sendo uma só. Passando disso, a tela pede o endereço — o que é
 * melhor do que um `joao.silva37` que ninguém vai lembrar.
 */
const MAXIMO_DE_HOMONIMOS = 20;

export async function createUser(
  db: Database,
  input: {
    name: string;
    email: string;
    password: string;
    /** ADMIN ou OPERADOR. Ausente, vale o default fail-closed do banco (OPERADOR). */
    role?: string;
    /** Quem está criando. Ausente = terminal (`create-user`). */
    createdBy?: string;
    /**
     * A lotação, do cadastro da casa. Ausente é legítimo: a conta nasce sem
     * cargo e sem unidade quando quem a cria ainda não sabe, e a lista a mostra
     * em "Sem cargo" em vez de a esconder.
     */
    cargoId?: string | null;
    unidadeId?: string | null;
    /** O telefone, como a pessoa o ditou. Ausente ou nulo é quem não deu. */
    telefone?: string | null;
    /** A quem ela reporta. Nulo é o topo — uma resposta, não uma lacuna. */
    gestorId?: string | null;
  },
): Promise<SessionUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(appUserTable)
      .values({
        name: input.name.trim(),
        email: normalizeEmail(input.email),
        passwordHash,
        ...(input.role ? { role: input.role } : {}),
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
        ...(input.cargoId !== undefined ? { cargoId: input.cargoId } : {}),
        ...(input.unidadeId !== undefined ? { unidadeId: input.unidadeId } : {}),
        ...(input.telefone !== undefined
          ? { telefone: input.telefone === null ? null : input.telefone.trim() }
          : {}),
        ...(input.gestorId !== undefined ? { gestorId: input.gestorId } : {}),
      })
      .returning({
        id: appUserTable.id,
        name: appUserTable.name,
        email: appUserTable.email,
        role: appUserTable.role,
      });
    return user!;
  } catch (err) {
    if (isUniqueViolation(err)) throw new EmailAlreadyUsedError();
    throw err;
  }
}

/** Devolve o hash junto porque quem chama é o login, e é ele que confere. */
export async function findUserForLogin(
  db: Database,
  email: string,
): Promise<(SessionUser & { passwordHash: string }) | null> {
  const [user] = await db
    .select({
      id: appUserTable.id,
      name: appUserTable.name,
      email: appUserTable.email,
        role: appUserTable.role,
      passwordHash: appUserTable.passwordHash,
    })
    .from(appUserTable)
    .where(
      and(
        eq(appUserTable.email, normalizeEmail(email)),
        isNull(appUserTable.disabledAt),
      ),
    )
    .limit(1);
  return user ?? null;
}

/**
 * Abre a sessão e devolve o token — a única vez em que ele existe fora do
 * navegador. O banco guarda o hash, e por isso este valor não pode ser
 * recuperado depois: se ele se perder aqui, a sessão está perdida.
 */
export async function startSession(
  db: Database,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(userSessionTable).values({
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt,
  });

  await db
    .update(appUserTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(appUserTable.id, userId));

  return { token, expiresAt };
}

/**
 * Uma sessão viva, resolvida — e por que ela tem duas contas dentro.
 *
 * Enquanto ninguém está visualizando ninguém, `usuario` e `dono` são a mesma
 * pessoa e este tipo é uma embalagem sem graça em volta do que sempre esteve
 * aqui. Ele existe pelo outro caso: um administrador olhando o produto como
 * outra conta (`impersonated_user_id`, ver `schema/auth.ts`).
 *
 * A separação é a coisa mais importante deste arquivo hoje: **`usuario` é a
 * conta que a tela vale, `dono` é quem digitou a senha.** O menu, as permissões
 * e o que aparece em cada tela seguem `usuario` — é justamente isso que se foi
 * ver. O log, a faixa do topo e a decisão de recusar escrita seguem `dono` — é
 * ele quem responde pelo que a sessão faz. Colapsar os dois num campo só faria
 * o produto ou mostrar a tela errada ou atribuir o ato à pessoa errada, e a
 * segunda é imperdoável num produto que existe para dizer quem fez.
 */
export interface ResolvedSession {
  /** A conta pelos olhos de quem a requisição enxerga o produto. */
  usuario: SessionUser;
  /** Quem entrou com a própria senha. Igual a `usuario` fora da visualização. */
  dono: SessionUser;
  /** Desde quando a visualização está aberta; `null` quando não há nenhuma. */
  visualizacaoDesde: Date | null;
}

/**
 * Quem é o dono deste token — ou null, que é a resposta para tudo que não seja
 * uma sessão viva de uma conta ativa: token inexistente, expirado, ou de
 * alguém desativado desde que entrou.
 *
 * **A visualização só é honrada se a conta visualizada continuar ativa.** É a
 * razão pela qual `impersonated_user_id` pode viver sem chave estrangeira: uma
 * conta desativada (ou uma linha que sumisse) faz a sessão voltar sozinha a ser
 * a de quem entrou, em vez de virar uma sessão de ninguém. Desativar alguém
 * derruba as sessões *dele*; esta é a outra ponta do mesmo ato.
 */
export async function resolveSession(
  db: Database,
  token: string,
): Promise<ResolvedSession | null> {
  if (!token) return null;

  /* O alias é obrigatório: as duas pontas da junção são a mesma tabela, e sem
     ele o SQL sairia com `app_user` duas vezes e o Postgres não saberia de
     qual coluna se está falando. */
  const visualizado = alias(appUserTable, "visualizado");

  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({
      sessionId: userSessionTable.id,
      lastSeenAt: userSessionTable.lastSeenAt,
      visualizacaoDesde: userSessionTable.impersonationStartedAt,
      id: appUserTable.id,
      name: appUserTable.name,
      email: appUserTable.email,
      role: appUserTable.role,
      alvoId: visualizado.id,
      alvoName: visualizado.name,
      alvoEmail: visualizado.email,
      alvoRole: visualizado.role,
    })
    .from(userSessionTable)
    .innerJoin(appUserTable, eq(appUserTable.id, userSessionTable.userId))
    .leftJoin(
      visualizado,
      and(
        eq(visualizado.id, userSessionTable.impersonatedUserId),
        isNull(visualizado.disabledAt),
      ),
    )
    .where(
      and(
        eq(userSessionTable.tokenHash, tokenHash),
        gt(userSessionTable.expiresAt, new Date()),
        isNull(appUserTable.disabledAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  if (Date.now() - row.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
    await db
      .update(userSessionTable)
      .set({ lastSeenAt: new Date() })
      .where(eq(userSessionTable.id, row.sessionId));
  }

  const dono: SessionUser = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
  };

  if (row.alvoId === null) {
    return { usuario: dono, dono, visualizacaoDesde: null };
  }

  return {
    usuario: {
      id: row.alvoId,
      name: row.alvoName!,
      email: row.alvoEmail!,
      role: row.alvoRole!,
    },
    dono,
    visualizacaoDesde: row.visualizacaoDesde,
  };
}

/**
 * Abre e fecha a visualização desta sessão — quem pode fazê-lo é decisão da
 * rota (`routes/auth.ts`), que é onde o papel de quem pede está à mão.
 *
 * O alvo é gravado na linha da própria sessão, e não numa tabela à parte: é o
 * que faz a visualização morrer junto com a sessão, sem nenhuma limpeza.
 */
export async function iniciarVisualizacao(
  db: Database,
  token: string,
  alvoId: string,
): Promise<void> {
  await db
    .update(userSessionTable)
    .set({ impersonatedUserId: alvoId, impersonationStartedAt: new Date() })
    .where(eq(userSessionTable.tokenHash, hashSessionToken(token)));
}

export async function encerrarVisualizacao(
  db: Database,
  token: string,
): Promise<void> {
  await db
    .update(userSessionTable)
    .set({ impersonatedUserId: null, impersonationStartedAt: null })
    .where(eq(userSessionTable.tokenHash, hashSessionToken(token)));
}

/** Sair é apagar a linha: um logout que só limpasse o cookie deixaria o token
 * válido para quem o tivesse copiado. */
export async function endSession(db: Database, token: string): Promise<void> {
  if (!token) return;
  await db
    .delete(userSessionTable)
    .where(eq(userSessionTable.tokenHash, hashSessionToken(token)));
}

/**
 * Derruba tudo o que essa pessoa tem aberto — opcionalmente menos a sessão de
 * quem está fazendo a operação.
 *
 * Senha trocada e conta desativada só valem alguma coisa se as sessões já
 * abertas morrerem junto. Sem isto, "desativei o acesso dele" seria falso
 * enquanto a aba dele continuasse aberta, por até sete dias.
 */
export async function endAllSessionsForUser(
  db: Database,
  userId: string,
  keepToken?: string,
): Promise<void> {
  const conditions = [eq(userSessionTable.userId, userId)];
  if (keepToken) {
    conditions.push(ne(userSessionTable.tokenHash, hashSessionToken(keepToken)));
  }
  await db.delete(userSessionTable).where(and(...conditions));
}

/** O que a tela de Configurações mostra. Nunca inclui o hash da senha. */
export interface ManagedUser extends SessionUser {
  disabledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  createdBy: string | null;
  disabledBy: string | null;
  /** Quantas sessões vivas essa pessoa tem agora. */
  openSessions: number;
  /**
   * A lotação da pessoa — cargo e unidade, do cadastro da casa.
   *
   * Vem com `id` **e** nome porque a tela precisa dos dois e por razões
   * diferentes: o `id` é o que ela manda de volta ao editar, e o nome é o que
   * ela mostra e por onde agrupa. Mandar só o `id` faria a lista de contas
   * buscar o cadastro inteiro para escrever uma linha; mandar só o nome faria
   * a edição casar por texto, que é o defeito que o cadastro desfez.
   *
   * `null` nos dois é o estado normal de quem entrou antes de alguém dizer o
   * que faz e onde. A lista mostra essas contas num grupo próprio.
   */
  cargoId: string | null;
  cargoNome: string | null;
  unidadeId: string | null;
  unidadeNome: string | null;
  /** O telefone, como foi ditado. `null` é quem não deu o número. */
  telefone: string | null;
  /**
   * A quem a pessoa reporta — `id` e nome, pela mesma razão do cargo: o `id` é
   * o que a tela devolve ao editar, e o nome é o que ela mostra.
   *
   * `null` nos dois é o topo do organograma, ou uma conta criada antes desta
   * coluna. Como não há chave estrangeira (ver `schema/auth.ts`), a junção é à
   * esquerda: um `gestor_id` que aponte para o que não existe vira "sem
   * gestor" na tela em vez de sumir com a linha.
   */
  gestorId: string | null;
  gestorNome: string | null;
}

/**
 * As sessões abertas são contadas por junção, e não por subconsulta escrita à
 * mão.
 *
 * A subconsulta que estava aqui saía do Drizzle sem qualificar as colunas —
 * `where "user_id" = "id"` — e dentro do subselect `"id"` é o da própria
 * `user_session`, não o da `app_user` de fora. A condição nunca era verdadeira,
 * e a tela dizia "sem sessão aberta" para todo mundo, inclusive para quem
 * estava olhando a tela. Um número errado com aparência de certo é o defeito
 * que este produto existe para não cometer.
 */
export async function listUsers(db: Database): Promise<ManagedUser[]> {
  const gestorTable = alias(appUserTable, "gestor");
  const rows = await db
    .select({
      id: appUserTable.id,
      name: appUserTable.name,
      email: appUserTable.email,
        role: appUserTable.role,
      disabledAt: appUserTable.disabledAt,
      lastLoginAt: appUserTable.lastLoginAt,
      createdAt: appUserTable.createdAt,
      createdBy: appUserTable.createdBy,
      disabledBy: appUserTable.disabledBy,
      openSessions: sql<number>`count(${userSessionTable.id})::int`,
      cargoId: appUserTable.cargoId,
      cargoNome: cargoTable.nome,
      unidadeId: appUserTable.unidadeId,
      unidadeNome: unidadeTable.nome,
      telefone: appUserTable.telefone,
      gestorId: appUserTable.gestorId,
      gestorNome: gestorTable.name,
    })
    .from(appUserTable)
    .leftJoin(
      userSessionTable,
      and(
        eq(userSessionTable.userId, appUserTable.id),
        gt(userSessionTable.expiresAt, new Date()),
      ),
    )
    /*
      Junção à esquerda nos dois: conta sem cargo e conta sem unidade são o
      estado normal de quem acabou de entrar, e uma junção interna as sumiria
      da lista de contas — a tela de Usuários deixaria de mostrar gente que
      tem acesso ao produto, que é o oposto do que ela existe para fazer.
    */
    .leftJoin(cargoTable, eq(cargoTable.id, appUserTable.cargoId))
    .leftJoin(unidadeTable, eq(unidadeTable.id, appUserTable.unidadeId))
    /* O gestor é a própria tabela sob outro nome: quem reporta a quem mora em
       `app_user`, e sem o alias a junção seria a tabela consigo mesma sem que
       o SQL soubesse qual das duas cada coluna está pedindo. */
    .leftJoin(gestorTable, eq(gestorTable.id, appUserTable.gestorId))
    .groupBy(appUserTable.id, cargoTable.nome, unidadeTable.nome, gestorTable.name)
    .orderBy(appUserTable.name);

  return rows.map((row) => ({
    ...row,
    disabledAt: row.disabledAt?.toISOString() ?? null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function findUserById(
  db: Database,
  id: string,
): Promise<(SessionUser & { disabledAt: Date | null }) | null> {
  const [user] = await db
    .select({
      id: appUserTable.id,
      name: appUserTable.name,
      email: appUserTable.email,
        role: appUserTable.role,
      disabledAt: appUserTable.disabledAt,
    })
    .from(appUserTable)
    .where(eq(appUserTable.id, id))
    .limit(1);
  return user ?? null;
}

/**
 * Desativar tira o acesso e mantém a pessoa: o `actor` das confirmações que ela
 * já fez continua apontando para um nome que existe. Reativar é o mesmo ato ao
 * contrário, e por isso os dois vivem aqui e não em duas funções que divergem.
 */
export async function setUserDisabled(
  db: Database,
  userId: string,
  disabled: boolean,
  by: string,
): Promise<void> {
  await db
    .update(appUserTable)
    .set(
      disabled
        ? { disabledAt: new Date(), disabledBy: by }
        : { disabledAt: null, disabledBy: null },
    )
    .where(eq(appUserTable.id, userId));

  if (disabled) await endAllSessionsForUser(db, userId);
}

/**
 * Troca a senha e derruba as sessões dessa pessoa.
 *
 * `keepToken` existe para quem está trocando a própria senha: continuar logado
 * na aba em que se acabou de digitar a senha nova é o esperado; continuar
 * logado nas outras não é.
 */
export async function setUserPassword(
  db: Database,
  userId: string,
  password: string,
  keepToken?: string,
): Promise<void> {
  await db
    .update(appUserTable)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(appUserTable.id, userId));

  await endAllSessionsForUser(db, userId, keepToken);
}

/** O hash de quem está logado, para conferir a senha atual antes de trocá-la. */
export async function findPasswordHash(
  db: Database,
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ passwordHash: appUserTable.passwordHash })
    .from(appUserTable)
    .where(eq(appUserTable.id, userId))
    .limit(1);
  return row?.passwordHash ?? null;
}

/** Linhas expiradas não autenticam mais ninguém; ficam só ocupando espaço. */
export async function purgeExpiredSessions(db: Database): Promise<void> {
  await db
    .delete(userSessionTable)
    .where(lt(userSessionTable.expiresAt, new Date()));
}
