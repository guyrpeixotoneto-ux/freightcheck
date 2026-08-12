import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
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

export async function createUser(
  db: Database,
  input: { name: string; email: string; password: string },
): Promise<SessionUser> {
  const passwordHash = await hashPassword(input.password);
  try {
    const [user] = await db
      .insert(appUserTable)
      .values({
        name: input.name.trim(),
        email: normalizeEmail(input.email),
        passwordHash,
      })
      .returning({
        id: appUserTable.id,
        name: appUserTable.name,
        email: appUserTable.email,
      });
    return user!;
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: unknown }).code === UNIQUE_VIOLATION
    ) {
      throw new EmailAlreadyUsedError();
    }
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

/** Linhas expiradas não autenticam mais ninguém; ficam só ocupando espaço. */
export async function purgeExpiredSessions(db: Database): Promise<void> {
  await db
    .delete(userSessionTable)
    .where(lt(userSessionTable.expiresAt, new Date()));
}
