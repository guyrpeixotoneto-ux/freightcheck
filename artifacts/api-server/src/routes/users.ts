import { Router, type IRouter } from "express";
import { cargoPorId, db, unidadePorId } from "@workspace/db";
import {
  describeEmailProblem,
  describeNameProblem,
  describePasswordProblem,
  describeTelefoneProblem,
  dominioDoEmail,
  gerarSenhaInicial,
  whyCannotDisable,
} from "../lib/auth";
import {
  EmailAlreadyUsedError,
  definirCadastro,
  countActiveAdmins,
  countActiveUsers,
  createUser,
  findUserById,
  gestorFechaCiclo,
  gerarEmailDisponivel,
  listUsers,
  setUserArquivado,
  setUserDisabled,
  setUserPassword,
  setUserRole,
} from "../lib/session";
import {
  definirPermissoes,
  ehChaveDeAmbiente,
  ehNivel,
  historicoDePermissoes,
  permissoesDetalhadasDe,
  type Nivel,
} from "../lib/permissoes";
import {
  definirPapelDaConta,
  papelPorId,
  papelDoSistema,
  roleDoPapel,
} from "../lib/papeis";

/**
 * Quem tem acesso — a superfície da tela de Configurações.
 *
 * Toda rota aqui exige sessão, como todas as outras; e as mutações exigem
 * papel. Os papéis deixaram de ser dois valores no código e viraram cadastro
 * (`routes/papeis.ts`, `0082`); o que **não** mudou é o portão: `role` continua
 * sendo a coluna lida aqui, derivada do `gerencia_contas` do papel e escrita
 * junto com ele — quem gerencia contas cria, desativa, redefine senha e muda o
 * papel dos outros; quem não gerencia usa o produto. A separação nasceu de um achado da
 * auditoria comercial: sem papel, qualquer conta redefinia a senha de
 * qualquer outra — tomada de conta a um clique, num produto cujo valor é o
 * "quem fez". Ler a lista continua aberto a quem entrou: transparência sobre
 * quem tem acesso não é privilégio.
 *
 * Ninguém é apagado. `actor` das confirmações já feitas aponta para estas
 * linhas, e apagar uma transformaria um histórico auditável num e-mail órfão.
 * Desativar tira o acesso e preserva o histórico; arquivar tira da lista quem
 * já não tem acesso, e também preserva. São as duas formas oferecidas, e
 * nenhuma delas apaga.
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

/**
 * Lê cargo e unidade do corpo, conferindo que os dois existem.
 *
 * Devolve a frase da recusa quando algo está errado, e o par pronto quando não
 * — as duas coisas por retorno, e não por exceção, porque quem chama já está
 * dentro de uma rota que precisa responder e não relançar.
 *
 * **Confere aqui, e não deixa a chave estrangeira falhar.** As duas dariam o
 * mesmo desfecho — a conta não fica com lotação inválida —, mas só esta diz
 * *qual* dos dois campos está errado. Uma violação de chave estrangeira chega à
 * tela como 500 e manda a pessoa adivinhar.
 */
async function lerLotacao(
  corpo: Record<string, unknown>,
): Promise<{ cargoId: string | null; unidadeId: string | null } | string> {
  const ler = (campo: string): string | null | undefined => {
    if (!(campo in corpo)) return null;
    const valor = corpo[campo];
    if (valor === null || valor === "") return null;
    return typeof valor === "string" && UUID.test(valor) ? valor : undefined;
  };

  const cargoId = ler("cargoId");
  if (cargoId === undefined) return "Identificador de cargo inválido.";
  const unidadeId = ler("unidadeId");
  if (unidadeId === undefined) return "Identificador de unidade inválido.";

  if (cargoId !== null && (await cargoPorId(db, cargoId)) === null) {
    return "O cargo informado não está cadastrado. Cadastre-o em Configurações → Cargos.";
  }
  if (unidadeId !== null && (await unidadePorId(db, unidadeId)) === null) {
    return "A unidade informada não está cadastrada. Cadastre-a em Configurações → Unidades.";
  }
  return { cargoId, unidadeId };
}

/**
 * Lê o `gestorId` do corpo. `undefined` é a recusa; `null` é "ninguém (topo)".
 *
 * Distingue os dois porque eles são coisas diferentes: um identificador
 * malformado é erro de quem chamou, e a ausência é uma resposta legítima —
 * alguém tem que estar no topo do organograma.
 */
function lerGestor(corpo: Record<string, unknown>): string | null | undefined {
  if (!("gestorId" in corpo)) return null;
  const valor = corpo.gestorId;
  if (valor === null || valor === "") return null;
  return typeof valor === "string" && UUID.test(valor) ? valor : undefined;
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

  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const { role } = corpo;
  const lotacao = await lerLotacao(corpo);
  if (typeof lotacao === "string") {
    res.status(400).json({ error: lotacao });
    return;
  }

  /*
    Nome e sobrenome chegam separados da tela e são gravados juntos: o que o
    produto guarda de uma pessoa é o nome com que ela assina, e `actor` é esse
    nome inteiro. Separá-los no banco criaria a pergunta "e quem tem dois
    sobrenomes?" para não ganhar nada — a única coisa que a separação serve é
    montar o login, e isso acontece aqui, antes de gravar.
  */
  const nome = typeof corpo.name === "string" ? corpo.name.trim() : "";
  const sobrenome =
    typeof corpo.sobrenome === "string" ? corpo.sobrenome.trim() : "";
  const nomeCompleto = [nome, sobrenome].filter((p) => p !== "").join(" ");

  const problemaDoNome = describeNameProblem(nomeCompleto);
  if (problemaDoNome) {
    res.status(400).json({ error: problemaDoNome });
    return;
  }

  const problemaDoTelefone = describeTelefoneProblem(corpo.telefone);
  if (problemaDoTelefone) {
    res.status(400).json({ error: problemaDoTelefone });
    return;
  }

  /*
    O gestor é conferido aqui porque não há chave estrangeira para conferi-lo
    no banco (ver a `0077`), e porque a recusa precisa chegar à tela como
    frase. Conta desativada não entra: o organograma que aponta para quem já
    não tem acesso é o organograma que ninguém atualizou.
  */
  const gestorId = lerGestor(corpo);
  if (gestorId === undefined) {
    res.status(400).json({ error: "Identificador de gestor inválido." });
    return;
  }
  if (gestorId !== null) {
    const gestor = await findUserById(db, gestorId);
    if (!gestor || gestor.disabledAt !== null) {
      res.status(400).json({
        error:
          "A pessoa escolhida em “Reporta a” não tem conta ativa. Escolha " +
          "outra, ou deixe em branco.",
      });
      return;
    }
  }

  /*
    O papel vem do cadastro (`papelId`), e é assim que a tela manda desde que
    Papéis existe. `role` continua aceito para quem chama por fora — o CLI, um
    script, um cliente antigo — e é resolvido no papel do sistema
    correspondente: uma conta criada com `role` e sem papel valeria pelo `role`
    e não acompanharia cadastro nenhum, que é o estado que a `0082` acabou.
  */
  const papelPedido = corpo.papelId;
  if (papelPedido !== undefined && papelPedido !== null && papelPedido !== "") {
    if (typeof papelPedido !== "string" || !UUID.test(papelPedido)) {
      res.status(400).json({ error: "Identificador de papel inválido." });
      return;
    }
  }
  if (role !== undefined && !PAPEIS.has(role as string)) {
    res.status(400).json({ error: "Papel precisa ser ADMIN ou OPERADOR." });
    return;
  }

  const papel =
    typeof papelPedido === "string" && papelPedido !== ""
      ? await papelPorId(db, papelPedido)
      : await papelDoSistema(db, role === "ADMIN");
  if (typeof papelPedido === "string" && papelPedido !== "" && papel === null) {
    res.status(400).json({
      error:
        "O papel informado não está cadastrado. Cadastre-o em Configurações → Papéis.",
    });
    return;
  }

  /*
    E-mail em branco é pedido para o servidor gerar um, e não erro: quem dá
    acesso a um motorista ou a um conferente muitas vezes não tem endereço para
    dar, e exigir um levava a `nome@empresa.com` inventado na hora — um login
    que ninguém confere e que colide no segundo homônimo. O domínio é o de quem
    está criando a conta, que é o domínio da casa (ver `dominioDoEmail`).
  */
  let email: string;
  if (corpo.email === undefined || corpo.email === null || corpo.email === "") {
    const dominio = dominioDoEmail(req.user!.email);
    const gerado =
      dominio === null
        ? null
        : await gerarEmailDisponivel(db, nomeCompleto, dominio);
    if (gerado === null) {
      res.status(400).json({
        error:
          "Não deu para gerar um e-mail a partir deste nome. Informe o " +
          "e-mail da pessoa.",
      });
      return;
    }
    email = gerado;
  } else {
    const problemaDoEmail = describeEmailProblem(corpo.email);
    if (problemaDoEmail) {
      res.status(400).json({ error: problemaDoEmail });
      return;
    }
    email = corpo.email as string;
  }

  /*
    Senha em branco é o caminho normal desta tela — o botão diz "criar usuário
    e gerar credenciais". Quando quem cria escolhe uma, ela é conferida pela
    mesma régua de sempre; quando não, o servidor sorteia (`gerarSenhaInicial`)
    e devolve o valor **uma única vez**, nesta resposta. O banco guarda só o
    hash, e não existe rota que devolva a senha depois: perdida a resposta,
    o caminho é redefinir.
  */
  const senhaEscolhida =
    corpo.password === undefined ||
    corpo.password === null ||
    corpo.password === ""
      ? null
      : corpo.password;
  if (senhaEscolhida !== null) {
    const problemaDaSenha = describePasswordProblem(senhaEscolhida);
    if (problemaDaSenha) {
      res.status(400).json({ error: problemaDaSenha });
      return;
    }
  }
  const senha = (senhaEscolhida as string | null) ?? gerarSenhaInicial();

  const telefone =
    typeof corpo.telefone === "string" && corpo.telefone.trim() !== ""
      ? corpo.telefone.trim()
      : null;

  const user = await createUser(db, {
    name: nomeCompleto,
    email,
    password: senha,
    /*
      Papel e `role` são gravados juntos, e o `role` vem do papel — nunca do
      corpo. É o que mantém a coluna e o cadastro dizendo a mesma coisa desde a
      primeira linha da conta.
    */
    ...(papel !== null
      ? { papelId: papel.id, role: roleDoPapel(papel.gerenciaContas) }
      : role !== undefined
        ? { role: role as string }
        : {}),
    createdBy: req.user!.email,
    cargoId: lotacao.cargoId,
    unidadeId: lotacao.unidadeId,
    telefone,
    gestorId,
  });
  req.log.info(
    { email: user.email, by: req.user!.email },
    "Conta criada pela interface",
  );
  /*
    As credenciais saem no corpo, e só aqui. `senhaGerada` diz se o valor foi
    sorteado ou digitado por quem criou — a tela usa isso para decidir entre
    "guarde esta senha, ela não aparece de novo" e o silêncio de quem já sabe
    a senha que escolheu. Nada disto vai para o log: `req.log` acima carrega
    e-mail e autor, nunca a senha.
  */
  res.status(201).json({
    ...user,
    senhaInicial: senha,
    senhaGerada: senhaEscolhida === null,
    emailGerado:
      corpo.email === undefined || corpo.email === null || corpo.email === "",
  });
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
 * Arquivar e desarquivar — o que a lixeira faz numa conta que já está sem
 * acesso.
 *
 * Continua não havendo como apagar ninguém, e pela razão de sempre: o `actor`
 * de cada confirmação de curadoria e de cada promoção de vigência aponta para
 * estas linhas. Arquivar não é a exclusão com outro nome — é uma decisão sobre
 * a **lista**: a tela de Usuários mostra tudo o que já existiu, e sem isto os
 * desligados de dois anos atrás se lêem junto com quem trabalha aqui hoje, no
 * grupo do cargo que já não é de ninguém.
 *
 * **Exige a conta já desativada, e não desativa por conta própria.** Uma conta
 * arquivada e ativa seria gente entrando no produto sem aparecer na tela que
 * existe para dizer quem entra. E cortar o acesso de alguém tem aviso próprio,
 * na gaveta de desativar; embutir isso em "arquivar" faria um gesto de
 * arrumação derrubar a sessão de quem está trabalhando.
 *
 * Duas rotas, e não uma com um flag no corpo, pela mesma razão de `disable` e
 * `enable`: têm consequências opostas, e é assim que este produto as escreve.
 */
router.post("/users/:id/arquivar", async (req, res): Promise<void> => {
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
  if (target.id === req.user!.id) {
    res.status(409).json({
      error:
        "Não dá para arquivar a própria conta — você está usando ela agora.",
    });
    return;
  }
  if (target.disabledAt === null) {
    res.status(409).json({
      error:
        "Esta conta ainda tem acesso. Arquivar esconde a conta da lista, e uma " +
        "conta escondida que continua entrando no sistema é o que esta tela " +
        "existe para não deixar acontecer. Desative o acesso primeiro.",
    });
    return;
  }

  await setUserArquivado(db, target.id, true, req.user!.email);
  req.log.info({ email: target.email, by: req.user!.email }, "Conta arquivada");
  res.json(await listUsers(db));
});

router.post("/users/:id/desarquivar", async (req, res): Promise<void> => {
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

  /* Desarquivar devolve a conta à lista e nada mais: ela continua desativada,
     porque arquivar nunca tirou acesso nenhum. Quem quer a pessoa de volta no
     produto usa o interruptor, que desarquiva junto. */
  await setUserArquivado(db, target.id, false, req.user!.email);
  req.log.info(
    { email: target.email, by: req.user!.email },
    "Conta desarquivada",
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

  /*
    A escrita vai pelo papel, e não direto em `role`: desde a `0082` a coluna é
    derivada, e ter dois lugares que a escrevem é ter dois lugares que podem
    discordar. Esta rota resolve o `role` pedido no papel do sistema
    correspondente e move a conta para lá — quem chama continua falando
    ADMIN/OPERADOR, e o cadastro continua sendo o dono da resposta.
  */
  const papel = await papelDoSistema(db, role === "ADMIN");
  if (papel === null) await setUserRole(db, target.id, role as string);
  else await definirPapelDaConta(db, target.id, papel.id);

  req.log.info(
    { email: target.email, role, by: req.user!.email },
    "Papel de conta alterado",
  );
  res.json(await listUsers(db));
});

/**
 * Pôr uma conta num papel do cadastro — o seletor de Papel da tela de Usuários.
 *
 * É a rota que `/users/:id/role` virou depois da `0082`: lá o papel era um de
 * dois valores escritos no código, aqui ele é uma linha de `papel`, com as
 * permissões que alguém cadastrou. As duas escrevem pelo mesmo caminho, e as
 * duas recusas de beco são as mesmas — quem administra o acesso não se rebaixa
 * sozinho para o sistema ficar sem administrador.
 *
 * **As exceções da conta não são tocadas.** Trocar de papel muda o que ela
 * herda; o que alguém decidiu sobre aquela pessoa em Permissões continua
 * valendo, e continua aparecendo lá como exceção. Apagá-las aqui desfaria, sem
 * pedir, decisões tomadas uma a uma.
 */
router.put("/users/:id/papel", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de conta inválido." });
    return;
  }
  const papelId = (req.body ?? {}).papelId;
  if (typeof papelId !== "string" || !UUID.test(papelId)) {
    res.status(400).json({ error: "Identificador de papel inválido." });
    return;
  }

  const target = await findUserById(db, req.params.id);
  if (!target) {
    res.status(404).json({ error: "Conta não encontrada." });
    return;
  }
  const papel = await papelPorId(db, papelId);
  if (!papel) {
    res.status(404).json({ error: "Papel não encontrado." });
    return;
  }

  if (
    target.role === "ADMIN" &&
    !papel.gerenciaContas &&
    (await countActiveAdmins(db)) <= 1
  ) {
    res.status(409).json({
      error:
        "Esta é a última conta de administrador ativa. Movê-la para um papel " +
        "que não gerencia contas deixaria o sistema sem quem administre acesso — " +
        "inclusive sem quem pudesse desfazer isto.",
    });
    return;
  }

  await definirPapelDaConta(db, target.id, papel.id);
  req.log.info(
    { email: target.email, papel: papel.nome, by: req.user!.email },
    "Papel de conta alterado",
  );
  res.json(await listUsers(db));
});

/**
 * O cadastro de uma conta — nome, cargo, unidade, telefone e a quem reporta.
 *
 * Rota própria, e não um campo a mais em `/users/:id/role`, pela distinção que
 * `definirCadastro` documenta: **papel é acesso, cadastro é cadastro.**
 * Promover alguém na empresa e dar-lhe poder de gerenciar contas são dois
 * atos, e um botão que fizesse os dois juntos faria o segundo sem que ninguém
 * o pedisse. A gaveta de edição chama as duas, e só manda o papel quando ele
 * mudou de fato.
 *
 * É `PUT` e substitui os campos: mandar `null` é tirar o vínculo, e é assim que
 * se desfaz um engano. Um `PATCH` que só mexesse no que veio pareceria mais
 * gentil e tornaria "tirar o cargo" indistinguível de "não mexer no cargo".
 *
 * **O e-mail não se edita aqui, nem em lugar nenhum.** Ele é quem a pessoa é
 * para o histórico — o `actor` de cada confirmação de curadoria e de cada
 * promoção de vigência —, e trocá-lo faria o que já foi assinado apontar para
 * um endereço que não existe mais. Um engano no endereço se resolve criando a
 * conta certa e desativando a errada, que é o desfecho honesto: as duas
 * aparecem no histórico, cada uma com o que fez.
 *
 * Antes chamava-se `/lotacao` e mexia só em cargo e unidade. Cresceu com a
 * gaveta de edição, que é a mesma da criação e por isso mostra os mesmos
 * campos — e um formulário que mostra cinco campos e salva dois é um
 * formulário que mente.
 */
router.put("/users/:id/cadastro", async (req, res): Promise<void> => {
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

  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const lotacao = await lerLotacao(corpo);
  if (typeof lotacao === "string") {
    res.status(400).json({ error: lotacao });
    return;
  }

  /* Nome ausente é "não mexe no nome": a gaveta de edição sempre o manda, mas
     quem chamar a rota só para trocar o cargo não deveria precisar repetir o
     nome da pessoa para não o perder. */
  let nome: string | undefined;
  if (corpo.name !== undefined) {
    const composto = [corpo.name, corpo.sobrenome]
      .filter((p): p is string => typeof p === "string" && p.trim() !== "")
      .map((p) => p.trim())
      .join(" ");
    const problema = describeNameProblem(composto);
    if (problema) {
      res.status(400).json({ error: problema });
      return;
    }
    nome = composto;
  }

  const problemaDoTelefone = describeTelefoneProblem(corpo.telefone);
  if (problemaDoTelefone) {
    res.status(400).json({ error: problemaDoTelefone });
    return;
  }

  const gestorId = lerGestor(corpo);
  if (gestorId === undefined) {
    res.status(400).json({ error: "Identificador de gestor inválido." });
    return;
  }
  if (gestorId !== null) {
    if (gestorId === target.id) {
      res.status(400).json({
        error:
          "Ninguém reporta a si mesmo. Escolha outra pessoa, ou deixe em branco.",
      });
      return;
    }
    const gestor = await findUserById(db, gestorId);
    if (!gestor || gestor.disabledAt !== null) {
      res.status(400).json({
        error:
          "A pessoa escolhida em “Reporta a” não tem conta ativa. Escolha " +
          "outra, ou deixe em branco.",
      });
      return;
    }
    /* O ciclo é recusado aqui e não no banco porque só aqui ele tem nome: uma
       restrição não consegue dizer "isto faria A responder por B e B por A". */
    if (await gestorFechaCiclo(db, target.id, gestorId)) {
      res.status(400).json({
        error:
          "Isso fecharia um ciclo no organograma — a pessoa passaria a " +
          "responder, por algum caminho, a quem já responde a ela.",
      });
      return;
    }
  }

  const telefone =
    typeof corpo.telefone === "string" && corpo.telefone.trim() !== ""
      ? corpo.telefone.trim()
      : null;

  await definirCadastro(db, target.id, {
    ...(nome !== undefined ? { name: nome } : {}),
    ...lotacao,
    telefone,
    gestorId,
  });
  req.log.info(
    { email: target.email, ...lotacao, gestorId, by: req.user!.email },
    "Cadastro de conta alterado",
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

  const camadas = await permissoesDetalhadasDe(db, target.id);
  res.json({
    /* `permissoes` continua sendo o que vale — é o que o portão faria —, e as
       duas camadas vêm ao lado para a tela poder dizer o que é herança do papel
       e o que é exceção daquela pessoa. */
    permissoes: camadas.efetivas,
    doPapel: camadas.doPapel,
    daPessoa: camadas.daPessoa,
    /* A camada da casa, que vence as duas: sem ela a tela chamaria de "exceção
       desta conta" o que a instalação desligou para todo mundo. */
    universaisDesligadas: camadas.universaisDesligadas,
    historico: await historicoDePermissoes(db, target.id),
  });
});

/**
 * Mudar o acesso de alguém — ADMIN, e só.
 *
 * O corpo é `{ niveis: { "/curadoria": "VISUALIZAR", … } }`, e é um **patch**:
 * o que não vier fica como está. Mandar **o nível que o papel da conta já dá**
 * devolve o módulo à herança, e é assim que se desfaz uma exceção — numa conta
 * sem papel, ou num módulo que o papel não restringe, esse nível é `EDITAR`,
 * como era antes da `0082`.
 *
 * Duas recusas, e as duas evitam becos sem saída:
 *
 * · ninguém mexe no próprio acesso — quem se bloqueasse por engano precisaria
 *   de outra pessoa para voltar atrás, e num produto com um administrador só
 *   isso é a porta trancada por dentro;
 * · Configurações (`/configuracoes`) é o módulo que gerencia contas, e tirá-lo
 *   de um administrador é a mesma porta com outro nome — quem administra o
 *   acesso precisa alcançar a tela onde o acesso se administra.
 *
 * As chaves são de duas formas: módulo, o endereço do item no menu, e ambiente,
 * `@` mais o id de um dos oito espaços de trabalho. Nenhuma regra separa as
 * duas aqui — a gravação, o histórico e o padrão que concede são os mesmos —,
 * e é justamente por isso que o eixo novo não trouxe rota nova.
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
    /*
      Duas formas de chave, e as duas conferidas: módulo é o endereço do item no
      menu (começa por barra) e ambiente é `@` mais o id de um dos oito
      (`lib/permissoes.ts`). O ambiente é conferido contra a lista, e não pelo
      formato: `@fechamento-rotta` gravaria uma linha que ninguém lê nunca — uma
      restrição que a tela mostra e o portão ignora é pior do que uma recusa.
    */
    if (!modulo.startsWith("/") && !ehChaveDeAmbiente(modulo)) {
      res.status(400).json({
        error: `"${modulo}" não é um módulo nem um ambiente: a chave é o endereço do item no menu, começando por barra, ou "@" e o id do ambiente.`,
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

  await definirPermissoes(db, {
    userId: target.id,
    niveis: pedido,
    por: req.user!.email,
  });

  req.log.info(
    { email: target.email, by: req.user!.email, niveis: pedido },
    "Permissões de módulo alteradas",
  );

  const camadas = await permissoesDetalhadasDe(db, target.id);
  res.json({
    permissoes: camadas.efetivas,
    doPapel: camadas.doPapel,
    daPessoa: camadas.daPessoa,
    /* A camada da casa, que vence as duas: sem ela a tela chamaria de "exceção
       desta conta" o que a instalação desligou para todo mundo. */
    universaisDesligadas: camadas.universaisDesligadas,
    historico: await historicoDePermissoes(db, target.id),
  });
});

export default router;
