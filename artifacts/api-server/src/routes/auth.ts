import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  describePasswordProblem,
  verifyPassword,
  normalizeEmail,
} from "../lib/auth";
import {
  SESSION_COOKIE,
  endSession,
  findPasswordHash,
  findUserForLogin,
  purgeExpiredSessions,
  resolveSession,
  setUserPassword,
  startSession,
} from "../lib/session";
import { permissoesDe } from "../lib/permissoes";

/**
 * Entrar, sair, e trocar a própria senha.
 *
 * Não existe aqui nenhuma forma de criar conta. Existiu — um "primeiro acesso"
 * que funcionava enquanto o banco estivesse sem usuários — e saiu por decisão
 * de produto: quem entra passa a assinar confirmações de curadoria e promoções
 * de vigência, e isso não é auto-atendimento. Contas nascem em Configurações,
 * por quem já tem acesso, ou no terminal com `create-user` quando o ambiente é
 * novo e ainda não há ninguém para fazer a primeira.
 *
 * A consequência de ter tirado, dita em voz alta: um ambiente com o banco vazio
 * não tem como criar a primeira conta pela tela. É o `create-user` que responde
 * por esse caso, e é por isso que ele não é opcional.
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
 * Quem está logado, respondido sem exigir sessão.
 *
 * É o primeiro pedido que a interface faz. Nunca responde 401: "não tem ninguém
 * logado" é a resposta, não um erro — e é o que faz a tela de login aparecer em
 * vez de um estado de falha.
 */
router.get("/auth/session", async (req, res): Promise<void> => {
  /*
    **Sem `catch` próprio, e é uma correção.** Esta rota respondia 503 com a
    frase "Não foi possível falar com o banco para verificar a sessão. Confira
    /api/healthz." — duas coisas erradas numa linha só. A segunda é o produto
    entregando um endpoint técnico a quem só queria entrar; a primeira é uma
    afirmação que a rota não tinha como sustentar, porque `resolveSession` pode
    falhar por banco fora, por schema atrasado ou por defeito nosso, e ela
    respondia a mesma coisa para os três.

    O contrato de erro sabe distinguir os três e responde cada um com o
    diagnóstico da autoridade única (`middlewares/contrato-json.ts`). Deixar o
    erro subir é o que dá acesso a isso — e o Express 5 encaminha a rejeição de
    um handler `async` para lá sozinho.
  */
  const token: unknown = req.cookies?.[SESSION_COOKIE];
  const user =
    typeof token === "string" && token !== ""
      ? await resolveSession(db, token)
      : null;

  /*
    As permissões vêm junto, e não numa segunda chamada: é a lateral que as
    consome, e ela é montada antes de qualquer tela. Pedi-las à parte faria o
    menu aparecer inteiro por um instante e encolher depois — mostrando a quem
    não tem acesso exatamente o que a decisão tirou dele.

    Só os módulos com decisão tomada aparecem aqui; o resto vale o padrão, que
    é edição (ver `lib/permissoes.ts`). Sem sessão não há o que responder.
  */
  const permissoes = user ? await permissoesDe(db, user.id) : {};

  res.json({ user, permissoes });
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

    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    req.log.error({ err }, "Error during login");
    /*
      **Sobe, e não vira "Não foi possível concluir o login".**

      Aquela frase era a resposta desta rota para o banco desligado — e ela é
      indistinguível de senha errada para quem a lê, o que manda a pessoa
      digitar de novo a credencial certa e concluir que perdeu o acesso. O 401
      logo acima é a resposta a credencial errada, e precisa continuar sendo a
      **única** coisa que se parece com ela.

      O que houve com o ambiente é classificado num lugar só, e não aqui: banco
      fora vira 503 com o diagnóstico da conexão, schema atrasado vira 503 com
      a migration que falta, e o que ninguém classificou vira 500 com
      `requestId`. Ver `middlewares/contrato-json.ts`.
    */
    throw err;
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
  // Corpo JSON, e não 204: toda resposta desta API é JSON — é a premissa de
  // `readJson` na interface, que trata corpo vazio como sinal de que a
  // requisição parou numa camada antes de chegar aqui.
  res.json({ user: null });
});

/**
 * Trocar a própria senha.
 *
 * Exige a senha atual mesmo com a sessão já aberta: uma aba esquecida aberta
 * não pode virar a troca da credencial da pessoa. As outras sessões dela caem
 * junto — trocar a senha é o que se faz quando se desconfia de que alguém a
 * tem — e a desta aba continua, porque foi aqui que ela acabou de digitar a
 * nova.
 */
router.post("/auth/password", async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body ?? {};
  const me = req.user!;

  if (typeof currentPassword !== "string") {
    res.status(400).json({ error: "Informe a senha atual." });
    return;
  }

  const problem = describePasswordProblem(newPassword);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({ error: "A senha nova é igual à atual." });
    return;
  }

  try {
    const hash = await findPasswordHash(db, me.id);
    if (!hash || !(await verifyPassword(currentPassword, hash))) {
      req.log.warn({ email: me.email }, "Troca de senha recusada");
      res.status(401).json({ error: "A senha atual não confere." });
      return;
    }

    const token: unknown = req.cookies?.[SESSION_COOKIE];
    await setUserPassword(
      db,
      me.id,
      newPassword as string,
      typeof token === "string" ? token : undefined,
    );

    req.log.info({ email: me.email }, "Senha trocada pela própria pessoa");
    res.json({ user: me });
  } catch (err) {
    req.log.error({ err }, "Error changing own password");
    /*
      Sobe, pelo mesmo motivo do login: "Não foi possível trocar a senha" com o
      banco fora é indistinguível de "a senha atual não confere", que é o 401
      logo acima. O contrato de erro classifica e responde com o diagnóstico —
      ver `middlewares/contrato-json.ts`.
    */
    throw err;
  }
});

export default router;
