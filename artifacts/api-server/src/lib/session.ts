import { and, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import {
  appUserTable,
  userSessionTable,
  type Database,
} from "@workspace/db";
import {
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

export async function createUser(
  db: Database,
  input: {
    name: string;
    email: string;
    password: string;
    /** Quem está criando. Ausente = terminal (`create-user`). */
    createdBy?: string;
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
        ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      })
      .returning({
        id: appUserTable.id,
        name: appUserTable.name,
        email: appUserTable.email,
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
 * Quem é o dono deste token — ou null, que é a resposta para tudo que não seja
 * uma sessão viva de uma conta ativa: token inexistente, expirado, ou de
 * alguém desativado desde que entrou.
 */
export async function resolveSession(
  db: Database,
  token: string,
): Promise<SessionUser | null> {
  if (!token) return null;

  const tokenHash = hashSessionToken(token);
  const [row] = await db
    .select({
      sessionId: userSessionTable.id,
      lastSeenAt: userSessionTable.lastSeenAt,
      id: appUserTable.id,
      name: appUserTable.name,
      email: appUserTable.email,
    })
    .from(userSessionTable)
    .innerJoin(appUserTable, eq(appUserTable.id, userSessionTable.userId))
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

  return { id: row.id, name: row.name, email: row.email };
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
  const rows = await db
    .select({
      id: appUserTable.id,
      name: appUserTable.name,
      email: appUserTable.email,
      disabledAt: appUserTable.disabledAt,
      lastLoginAt: appUserTable.lastLoginAt,
      createdAt: appUserTable.createdAt,
      createdBy: appUserTable.createdBy,
      disabledBy: appUserTable.disabledBy,
      openSessions: sql<number>`count(${userSessionTable.id})::int`,
    })
    .from(appUserTable)
    .leftJoin(
      userSessionTable,
      and(
        eq(userSessionTable.userId, appUserTable.id),
        gt(userSessionTable.expiresAt, new Date()),
      ),
    )
    .groupBy(appUserTable.id)
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
