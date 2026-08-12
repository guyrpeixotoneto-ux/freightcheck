import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  describeEmailProblem,
  describeNameProblem,
  describePasswordProblem,
  verifyPassword,
  normalizeEmail,
} from "../lib/auth";
import {
  EmailAlreadyUsedError,
  SESSION_COOKIE,
  countUsers,
  createUser,
  endSession,
  findUserForLogin,
  purgeExpiredSessions,
  resolveSession,
  startSession,
} from "../lib/session";

/**
 * Entrar, sair, e o primeiro acesso.
 *
 * O primeiro acesso é a parte que costuma virar gambiarra, e aqui ele tem uma
 * regra só: `POST /auth/setup` funciona enquanto a tabela de usuários estiver
 * vazia, e para de funcionar no instante em que existe uma conta. Isso evita as
 * duas alternativas piores — uma senha padrão no código, que ninguém troca, e
 * uma variável de ambiente obrigatória, que quebraria a promessa de um
 * workspace novo funcionar só apertando Run.
 *
 * A janela é real e vale a pena ser dita em voz alta: entre o primeiro deploy e
 * o primeiro cadastro, quem chegar na URL cria a conta inicial. Em compensação,
 * ela fecha sozinha e não deixa credencial conhecida para trás.
 */
const router: IRouter = Router();

/**
 * Tentativas erradas seguidas, por e-mail.
 *
 * É em memória e por processo, e isso é uma escolha, não um esquecimento:
 * serve para que testar senhas na força bruta seja lento, e para isso um
 * contador local basta. Contar no banco só faria diferença com vários
 * processos, e este produto roda um.
 */
const FAILURE_LIMIT = 8;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000;

interface FailureRecord {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

const failures = new Map<string, FailureRecord>();

function lockedUntil(email: string): number | null {
  const record = failures.get(email);
  if (!record) return null;
  if (record.lockedUntil > Date.now()) return record.lockedUntil;
  if (Date.now() - record.firstAt > FAILURE_WINDOW_MS) failures.delete(email);
  return null;
}

function registerFailure(email: string): void {
  const now = Date.now();
  const record = failures.get(email);

  if (!record || now - record.firstAt > FAILURE_WINDOW_MS) {
    failures.set(email, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }

  record.count += 1;
  if (record.count >= FAILURE_LIMIT) {
    record.lockedUntil = now + LOCK_MS;
    record.count = 0;
    record.firstAt = now;
  }
}

function clearFailures(email: string): void {
  failures.delete(email);
}

/**
 * `secure` sai do protocolo desta requisição, e não de NODE_ENV.
 *
 * Um cookie `Secure` enviado por http é descartado pelo navegador sem aviso: o
 * login responderia 200 e a próxima chamada viria sem sessão, que é o tipo de
 * falha que se persegue por horas. Atrás do roteador do Replit quem sabe o
 * protocolo original é o `x-forwarded-proto`, e é por isso que `app.ts` liga o
 * `trust proxy`.
 */
function setSessionCookie(
  req: Request,
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
    expires: expiresAt,
    path: "/",
  });
}

function clearSessionCookie(req: Request, res: Response): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.protocol === "https",
    path: "/",
  });
}

/**
 * O estado da porta, respondido sem sessão.
 *
 * É o primeiro pedido que a interface faz, e ele responde as duas perguntas de
 * que a tela precisa: quem está logado (se alguém), e se este ambiente ainda
 * não tem nenhuma conta — caso em que a tela mostra o primeiro acesso em vez do
 * login. Nunca responde 401: "não tem ninguém logado" é a resposta, não um erro.
 */
router.get("/auth/session", async (req, res): Promise<void> => {
  try {
    const token: unknown = req.cookies?.[SESSION_COOKIE];
    const user =
      typeof token === "string" && token !== ""
        ? await resolveSession(db, token)
        : null;

    if (user) {
      res.json({ user, needsSetup: false });
      return;
    }

    res.json({ user: null, needsSetup: (await countUsers(db)) === 0 });
  } catch (err) {
    req.log.error({ err }, "Error resolving session");
    res.status(503).json({
      error:
        "Não foi possível falar com o banco para verificar a sessão. " +
        "Confira /api/healthz.",
      code: "SESSION_CHECK_FAILED",
    });
  }
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { email, password } = req.body ?? {};

  if (typeof email !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Informe e-mail e senha." });
    return;
  }

  const normalized = normalizeEmail(email);
  const until = lockedUntil(normalized);
  if (until !== null) {
    const seconds = Math.ceil((until - Date.now()) / 1000);
    res.setHeader("Retry-After", String(seconds));
    res.status(429).json({
      error: `Tentativas demais. Tente de novo em ${Math.ceil(seconds / 60)} minuto(s).`,
    });
    return;
  }

  try {
    const user = await findUserForLogin(db, normalized);
    /**
     * A mesma resposta para "e-mail não existe" e "senha errada".
     *
     * Distinguir os dois entrega a quem tenta uma lista de quem tem conta aqui,
     * de graça. O preço é uma mensagem menos específica para quem errou a senha
     * de boa-fé, e ele é menor.
     */
    const ok = user ? await verifyPassword(password, user.passwordHash) : false;

    if (!user || !ok) {
      registerFailure(normalized);
      req.log.warn({ email: normalized }, "Login recusado");
      res.status(401).json({ error: "E-mail ou senha incorretos." });
      return;
    }

    clearFailures(normalized);
    const { token, expiresAt } = await startSession(db, user.id);
    setSessionCookie(req, res, token, expiresAt);

    // Enquanto alguém entra, as sessões que já morreram saem. Não vale um job.
    purgeExpiredSessions(db).catch((err: unknown) => {
      req.log.warn({ err }, "Falha ao limpar sessões expiradas");
    });

    res.json({
      user: { id: user.id, name: user.name, email: user.email },
      needsSetup: false,
    });
  } catch (err) {
    req.log.error({ err }, "Error during login");
    res.status(500).json({ error: "Não foi possível concluir o login." });
  }
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  try {
    if (typeof token === "string") await endSession(db, token);
  } catch (err) {
    // O cookie sai de qualquer forma: quem pediu para sair, saiu.
    req.log.error({ err }, "Error ending session");
  }
  clearSessionCookie(req, res);
  res.status(204).end();
});

/**
 * Primeiro acesso: cria a conta inicial, e só enquanto não existir nenhuma.
 *
 * Quem cria já entra — a alternativa seria mandar a pessoa digitar de novo, na
 * tela ao lado, a senha que ela acabou de escolher.
 */
router.post("/auth/setup", async (req, res): Promise<void> => {
  const { name, email, password } = req.body ?? {};

  const problem =
    describeNameProblem(name) ??
    describeEmailProblem(email) ??
    describePasswordProblem(password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  try {
    if ((await countUsers(db)) > 0) {
      res.status(409).json({
        error:
          "Este ambiente já tem conta cadastrada. O primeiro acesso só existe " +
          "enquanto não há nenhuma.",
      });
      return;
    }

    const user = await createUser(db, {
      name: name as string,
      email: email as string,
      password: password as string,
    });
    const { token, expiresAt } = await startSession(db, user.id);
    setSessionCookie(req, res, token, expiresAt);

    req.log.info({ email: user.email }, "Primeira conta criada");
    res.status(201).json({ user, needsSetup: false });
  } catch (err) {
    if (err instanceof EmailAlreadyUsedError) {
      res.status(409).json({ error: err.message });
      return;
    }
    req.log.error({ err }, "Error creating first user");
    res.status(500).json({ error: "Não foi possível criar a conta." });
  }
});

export default router;
