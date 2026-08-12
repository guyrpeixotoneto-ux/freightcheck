import { randomBytes, createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/**
 * As primitivas de autenticação, sem banco e sem HTTP.
 *
 * Tudo aqui é função pura sobre strings, e é de propósito: são as decisões que
 * não podem estar erradas — como a senha é guardada, como o token de sessão é
 * comparado, o que conta como e-mail — e nenhuma delas precisa de um Postgres
 * de pé para ser exercitada por um teste. O que fala com o banco está em
 * `session.ts`; o que fala com o Express está em `middlewares/require-session.ts`.
 */

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
) => Promise<Buffer>;

/**
 * Parâmetros do scrypt. `N=16384` é o padrão recomendado pelo Node e custa
 * ~50ms por verificação nesta máquina — caro o suficiente para que tentar
 * senhas em massa não valha a pena, barato o suficiente para um login humano.
 *
 * Eles vão gravados dentro do próprio hash, e a verificação lê os do hash em
 * vez destes. É isso que permite aumentar o custo um dia sem invalidar a senha
 * de ninguém: hashes antigos continuam sendo conferidos com os parâmetros com
 * que foram criados.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

const HASH_PREFIX = "scrypt";

/** Guarda contra um "keylen" absurdo vindo de um hash corrompido no banco. */
const MAX_KEYLEN = 256;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return [
    HASH_PREFIX,
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Confere a senha contra o hash gravado.
 *
 * Nunca lança: um hash ilegível — truncado, de outro formato, escrito à mão no
 * banco — é uma senha que não confere, e não um 500. A comparação final é
 * `timingSafeEqual` porque a alternativa (`===`) vaza, pelo tempo que leva para
 * responder, quantos bytes iniciais estavam certos.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== HASH_PREFIX) return false;

  const [, rawN, rawR, rawP, rawSalt, rawKey] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  const salt = Buffer.from(rawSalt, "base64");
  const expected = Buffer.from(rawKey, "base64");
  if (salt.length === 0 || expected.length === 0) return false;
  if (expected.length > MAX_KEYLEN) return false;

  try {
    const actual = await scryptAsync(password, salt, expected.length, {
      N,
      r,
      p,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * O que vai no cookie. 32 bytes de aleatoriedade criptográfica, em base64url
 * para atravessar um header sem escaping.
 */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * O que vai no banco. SHA-256 basta aqui — e a razão é diferente da senha:
 * um token já é 256 bits aleatórios, então não existe "adivinhar o original"
 * como existe com senha humana. O hash serve para que ler a tabela não seja o
 * mesmo que estar logado.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Duas grafias do mesmo e-mail são a mesma pessoa. O índice único depende disto. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Suficiente para recusar o que não é endereço, sem tentar validar e-mail por
 * regex — isso não tem fim e recusa endereços válidos. Retorna a frase que a
 * tela mostra, ou null quando está tudo bem.
 */
export function describeEmailProblem(email: unknown): string | null {
  if (typeof email !== "string" || email.trim() === "") {
    return "Informe o e-mail.";
  }
  const normalized = normalizeEmail(email);
  if (normalized.length > 254) return "E-mail longo demais.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return "Isso não parece um endereço de e-mail.";
  }
  return null;
}

/** O mínimo é 10 caracteres, e o máximo existe para o scrypt não virar um DoS. */
export function describePasswordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password === "") {
    return "Informe a senha.";
  }
  if (password.length < 10) {
    return "A senha precisa de pelo menos 10 caracteres.";
  }
  if (password.length > 200) {
    return "A senha passa de 200 caracteres.";
  }
  return null;
}

export function describeNameProblem(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") {
    return "Informe o seu nome.";
  }
  if (name.trim().length > 120) return "Nome longo demais.";
  return null;
}

/**
 * As rotas que respondem sem sessão, e por quê cada uma.
 *
 * A lista é curta de propósito, e o padrão é o oposto dela: qualquer rota nova
 * nasce protegida sem que ninguém precise lembrar de protegê-la. Foi o
 * contrário disso — uma lista do que proteger — que já deixou endpoint aberto
 * em todo produto que tentou.
 *
 * Os caminhos são relativos ao mount `/api`.
 */
const PUBLIC_PATHS = new Set([
  // O roteador do Replit usa /healthz como health check do deployment: exigir
  // sessão aqui faria o serviço nunca ficar de pé.
  "/healthz",
  "/build",
  // A tela de login precisa poder perguntar "existe sessão?" e "já existe
  // alguém cadastrado?" antes de haver qualquer sessão.
  "/auth/session",
  "/auth/login",
  "/auth/logout",
  "/auth/setup",
]);

export function isPublicPath(path: string): boolean {
  // Express entrega o path já sem query string; a barra final é a única
  // variação que chega aqui.
  const normalized =
    path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  return PUBLIC_PATHS.has(normalized);
}
