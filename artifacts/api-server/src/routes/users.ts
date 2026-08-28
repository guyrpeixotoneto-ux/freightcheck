import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  describeEmailProblem,
  describeNameProblem,
  describePasswordProblem,
  whyCannotDisable,
} from "../lib/auth";
import {
  EmailAlreadyUsedError,
  countActiveAdmins,
  countActiveUsers,
  createUser,
  findUserById,
  listUsers,
  setUserDisabled,
  setUserPassword,
  setUserRole,
} from "../lib/session";
import {
  definirPermissoes,
  ehNivel,
  historicoDePermissoes,
  permissoesDe,
  type Nivel,
} from "../lib/permissoes";

/**
 * Quem tem acesso — a superfície da tela de Configurações.
 *
 * Toda rota aqui exige sessão, como todas as outras; e as mutações exigem
 * papel. Dois papéis, e só dois: **ADMIN** cria, desativa, redefine senha e
 * muda papel; **OPERADOR** usa o produto. A separação nasceu de um achado da
 * auditoria comercial: sem papel, qualquer conta redefinia a senha de
 * qualquer outra — tomada de conta a um clique, num produto cujo valor é o
 * "quem fez". Ler a lista continua aberto a quem entrou: transparência sobre
 * quem tem acesso não é privilégio.
 *
 * Ninguém é apagado. `actor` das confirmações já feitas aponta para estas
 * linhas, e apagar uma transformaria um histórico auditável num e-mail órfão.
 * Desativar tira o acesso e preserva o histórico; é a única forma oferecida.
 */
const router: IRouter = Router();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PAPEIS = new Set(["ADMIN", "OPERADOR"]);

/** A recusa de papel, uma frase só — quem a lê sabe a quem pedir. */
export function somenteAdmin(req: { user?: { role: string } }): string | null {
  return req.user?.role === "ADMIN"
    ? null
    : "Somente administradores gerenciam contas. Peça a um administrador.";
}

router.get("/users", async (req, res): Promise<void> => {
  res.json(await listUsers(db));
});

router.post("/users", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }

  const { name, email, password, role } = req.body ?? {};

  const problem =
    describeNameProblem(name) ??
    describeEmailProblem(email) ??
    describePasswordProblem(password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  if (role !== undefined && !PAPEIS.has(role as string)) {
    res.status(400).json({ error: "Papel precisa ser ADMIN ou OPERADOR." });
    return;
  }

  const user = await createUser(db, {
    name: name as string,
    email: email as string,
    password: password as string,
    ...(role !== undefined ? { role: role as string } : {}),
    createdBy: req.user!.email,
  });
  req.log.info(
    { email: user.email, by: req.user!.email },
    "Conta criada pela interface",
  );
  res.status(201).json(user);
});

/**
 * Desativar e reativar são a mesma rota com o alvo declarado no corpo? Não:
 * são duas, porque têm consequências opostas e o produto inteiro é escrito
 * assim — botão que faz duas coisas dependendo de um flag é onde a distinção
 * se perde.
 */
router.post("/users/:id/disable", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de conta inválido." });
    return;
  }

  const target = await findUserById(db, req.params.id);
  if (!target) {
    res.status(404).json({ error: "Conta não encontrada." });
    return;
  }

  const refusal = whyCannotDisable({
    targetId: target.id,
    actorId: req.user!.id,
    activeUsers: await countActiveUsers(db),
  });
  if (refusal) {
    res.status(409).json({ error: refusal });
    return;
  }
  if (target.role === "ADMIN" && (await countActiveAdmins(db)) <= 1) {
    res.status(409).json({
      error:
        "Esta é a última conta de administrador ativa. Desativá-la deixaria o " +
        "sistema sem quem gerencie contas. Promova outra pessoa antes.",
    });
    return;
  }

  await setUserDisabled(db, target.id, true, req.user!.email);
  req.log.info(
    { email: target.email, by: req.user!.email },
    "Conta desativada",
  );
  res.json(await listUsers(db));
});

router.post("/users/:id/enable", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de conta inválido." });
    return;
  }

  const target = await findUserById(db, req.params.id);
  if (!target) {
    res.status(404).json({ error: "Conta não encontrada." });
    return;
  }

  await setUserDisabled(db, target.id, false, req.user!.email);
  req.log.info(
    { email: target.email, by: req.user!.email },
    "Conta reativada",
  );
  res.json(await listUsers(db));
});

/**
 * Redefinir a senha de outra pessoa — o que existe no lugar de "esqueci minha
 * senha", já que este produto não manda e-mail.
 *
 * Não exige a senha atual, e não teria como: quem redefine não a conhece. O que
 * a torna aceitável é o efeito colateral obrigatório — as sessões da pessoa
 * caem todas — e o fato de que qualquer um que já tenha acesso poderia, de
 * qualquer forma, criar outra conta. A senha nova é dita a ela por fora; nada
 * aqui a envia para lugar nenhum.
 */
router.post("/users/:id/password", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de conta inválido." });
    return;
  }

  const problem = describePasswordProblem(req.body?.password);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }

  const target = await findUserById(db, req.params.id);
  if (!target) {
    res.status(404).json({ error: "Conta não encontrada." });
    return;
  }

  await setUserPassword(db, target.id, req.body.password as string);
  req.log.info(
    { email: target.email, by: req.user!.email },
    "Senha redefinida por outra pessoa",
  );
  // A lista de volta, como nas outras duas: as sessões daquela pessoa
  // acabaram de cair, e é isso que a tela precisa reexibir.
  res.json(await listUsers(db));
});

/**
 * Mudar o papel de uma conta — ADMIN promove e rebaixa.
 *
 * A única recusa além do portão é a que evita o beco: rebaixar o último
 * administrador ativo deixaria o sistema sem quem gerencie contas — inclusive
 * sem quem pudesse desfazer o rebaixamento.
 */
router.post("/users/:id/role", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de conta inválido." });
    return;
  }
  const { role } = req.body ?? {};
  if (!PAPEIS.has(role as string)) {
    res.status(400).json({ error: "Papel precisa ser ADMIN ou OPERADOR." });
    return;
  }

  const target = await findUserById(db, req.params.id);
  if (!target) {
    res.status(404).json({ error: "Conta não encontrada." });
    return;
  }

  if (
    target.role === "ADMIN" &&
    role === "OPERADOR" &&
    (await countActiveAdmins(db)) <= 1
  ) {
    res.status(409).json({
      error:
        "Esta é a última conta de administrador ativa. Rebaixá-la deixaria o " +
        "sistema sem quem gerencie contas — inclusive sem quem pudesse desfazer isto.",
    });
    return;
  }

  await setUserRole(db, target.id, role as string);
  req.log.info(
    { email: target.email, role, by: req.user!.email },
    "Papel de conta alterado",
  );
  res.json(await listUsers(db));
});

/**
 * O que uma pessoa alcança, e como se chegou nisso.
 *
 * Ler é aberto a quem tem sessão, pela mesma razão que a lista de contas é:
 * saber quem pode o quê num sistema de auditoria não é privilégio — e quem
 * abre a própria tela precisa saber por que um módulo sumiu do menu dela.
 *
 * O histórico vem junto porque é ele que responde a pergunta que se faz depois:
 * não "o que vale hoje", que o mapa acima diz, mas "quem tirou isto, e quando".
 */
router.get("/users/:id/permissoes", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de conta inválido." });
    return;
  }

  const target = await findUserById(db, req.params.id);
  if (!target) {
    res.status(404).json({ error: "Conta não encontrada." });
    return;
  }

  res.json({
    permissoes: await permissoesDe(db, target.id),
    historico: await historicoDePermissoes(db, target.id),
  });
});

/**
 * Mudar o acesso de alguém — ADMIN, e só.
 *
 * O corpo é `{ niveis: { "/curadoria": "VISUALIZAR", … } }`, e é um **patch**:
 * o que não vier fica como está. Mandar `EDITAR` devolve o módulo ao padrão, e
 * é assim que se desfaz uma restrição.
 *
 * Duas recusas, e as duas evitam becos sem saída:
 *
 * · ninguém mexe no próprio acesso — quem se bloqueasse por engano precisaria
 *   de outra pessoa para voltar atrás, e num produto com um administrador só
 *   isso é a porta trancada por dentro;
 * · Configurações (`/configuracoes`) é o módulo que gerencia contas, e tirá-lo
 *   de um administrador é a mesma porta com outro nome — quem administra o
 *   acesso precisa alcançar a tela onde o acesso se administra.
 */
router.put("/users/:id/permissoes", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de conta inválido." });
    return;
  }

  const niveis: unknown = req.body?.niveis;
  if (typeof niveis !== "object" || niveis === null || Array.isArray(niveis)) {
    res.status(400).json({
      error: "Mande `niveis` como um objeto de módulo para nível de acesso.",
    });
    return;
  }

  const pedido: Record<string, Nivel> = {};
  for (const [modulo, nivel] of Object.entries(niveis as Record<string, unknown>)) {
    if (!modulo.startsWith("/")) {
      res.status(400).json({
        error: `"${modulo}" não é um módulo: a chave é o endereço do item no menu, começando por barra.`,
      });
      return;
    }
    if (!ehNivel(nivel)) {
      res.status(400).json({
        error: `Nível inválido para ${modulo}. Use EDITAR, VISUALIZAR ou SEM_ACESSO.`,
      });
      return;
    }
    pedido[modulo] = nivel;
  }

  const target = await findUserById(db, req.params.id);
  if (!target) {
    res.status(404).json({ error: "Conta não encontrada." });
    return;
  }

  if (target.id === req.user!.id) {
    res.status(409).json({
      error:
        "Ninguém muda o próprio acesso. Peça a outro administrador — assim um " +
        "engano aqui nunca tranca a porta por dentro.",
    });
    return;
  }

  if (target.role === "ADMIN" && pedido["/configuracoes"] === "SEM_ACESSO") {
    res.status(409).json({
      error:
        "Um administrador precisa alcançar Configurações, que é onde o acesso " +
        "se administra. Rebaixe a conta para operador antes de tirar este módulo.",
    });
    return;
  }

  const permissoes = await definirPermissoes(db, {
    userId: target.id,
    niveis: pedido,
    por: req.user!.email,
  });

  req.log.info(
    { email: target.email, by: req.user!.email, niveis: pedido },
    "Permissões de módulo alteradas",
  );

  res.json({
    permissoes,
    historico: await historicoDePermissoes(db, target.id),
  });
});

export default router;
