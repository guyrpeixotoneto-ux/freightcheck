import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  atualizarPapel,
  contasDoPapel,
  criarPapel,
  definirPermissoesDoPapel,
  excluirPapel,
  historicoDoPapel,
  listarPapeis,
  papelPorId,
  papelPorNome,
} from "../lib/papeis";
import {
  ehChaveDeAmbiente,
  ehNivel,
  permissoesDoPapel,
  type Nivel,
} from "../lib/permissoes";
import { listUsers } from "../lib/session";
import { somenteAdmin } from "./users";

/**
 * Papéis — o acesso que se cadastra uma vez.
 *
 * A tela de Permissões decide por pessoa; esta decide por **grupo**, e a conta
 * aponta para o papel em vez de copiá-lo (`schema/papel.ts` diz por que é
 * vínculo). Daí a única coisa incomum destas rotas: quase todas devolvem
 * também a lista de contas, porque mexer num papel muda o que a lista de
 * Usuários mostra — o `role` de quem o usa é reescrito no mesmo ato.
 *
 * Ler é aberto a quem tem sessão, como a lista de contas e pela mesma razão:
 * saber quem pode o quê num sistema de auditoria não é privilégio. Mexer é de
 * administrador, e a recusa é a mesma frase de `/users`.
 *
 * As recusas que existem aqui, e o beco que cada uma evita:
 *
 * · **Nome repetido** — dois `Conferente` seriam duas listas de acesso com o
 *   mesmo nome no seletor de Usuários, e ninguém saberia qual escolheu.
 * · **Papel do sistema não se renomeia, não se apaga e não muda de
 *   administração** — `Operador` e `Administrador` são o que toda conta anterior
 *   à `0082` tem, e um `Operador` que gerenciasse contas seria um nome mentindo
 *   sobre o que faz. As permissões deles, essas sim, se editam.
 * · **Papel com gente dentro não se apaga** — a conta ficaria apontando para uma
 *   linha morta; a recusa diz quantas contas são, para que quem apaga saiba o
 *   que mover antes.
 * · **Não se tira a administração do último papel que administra** — seria
 *   rebaixar todo mundo de uma vez, e não sobraria quem desfizesse.
 */
const router: IRouter = Router();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOME_MAXIMO = 60;

/** A recusa do nome, uma frase só — ou `null` quando ele serve. */
function problemaDoNome(bruto: unknown): string | null {
  if (typeof bruto !== "string" || bruto.trim() === "") {
    return "O papel precisa de um nome — é ele que aparece no cadastro de contas.";
  }
  if (bruto.trim().length > NOME_MAXIMO) {
    return `O nome do papel passa de ${NOME_MAXIMO} caracteres.`;
  }
  return null;
}

function lerDescricao(bruto: unknown): string | null {
  return typeof bruto === "string" && bruto.trim() !== "" ? bruto.trim() : null;
}

router.get("/papeis", async (_req, res): Promise<void> => {
  res.json(await listarPapeis(db));
});

/** Um papel com o que ele restringe e como se chegou nisso. */
router.get("/papeis/:id", async (req, res): Promise<void> => {
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de papel inválido." });
    return;
  }
  const papel = await papelPorId(db, req.params.id);
  if (!papel) {
    res.status(404).json({ error: "Papel não encontrado." });
    return;
  }
  res.json({
    papel,
    permissoes: await permissoesDoPapel(db, papel.id),
    historico: await historicoDoPapel(db, papel.id),
  });
});

router.post("/papeis", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }

  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const problema = problemaDoNome(corpo.nome);
  if (problema) {
    res.status(400).json({ error: problema });
    return;
  }
  const nome = (corpo.nome as string).trim();

  const repetido = await papelPorNome(db, nome);
  if (repetido) {
    res.status(409).json({
      error: `Já existe um papel chamado “${repetido.nome}”. Dois papéis com o mesmo nome seriam duas listas de acesso indistinguíveis no cadastro de contas.`,
    });
    return;
  }

  const papel = await criarPapel(db, {
    nome,
    descricao: lerDescricao(corpo.descricao),
    gerenciaContas: corpo.gerenciaContas === true,
    por: req.user!.email,
  });

  req.log.info(
    { papel: papel.nome, by: req.user!.email },
    "Papel cadastrado",
  );
  res.status(201).json(papel);
});

router.put("/papeis/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de papel inválido." });
    return;
  }

  const papel = await papelPorId(db, req.params.id);
  if (!papel) {
    res.status(404).json({ error: "Papel não encontrado." });
    return;
  }

  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const mudanca: {
    nome?: string;
    descricao?: string | null;
    gerenciaContas?: boolean;
  } = {};

  if ("nome" in corpo) {
    const problema = problemaDoNome(corpo.nome);
    if (problema) {
      res.status(400).json({ error: problema });
      return;
    }
    const nome = (corpo.nome as string).trim();
    if (papel.sistema && nome !== papel.nome) {
      res.status(409).json({
        error: `“${papel.nome}” é um papel do sistema e não se renomeia: toda conta criada antes do cadastro de papéis aponta para ele. Crie um papel novo com o nome que você quer.`,
      });
      return;
    }
    const repetido = await papelPorNome(db, nome, papel.id);
    if (repetido) {
      res.status(409).json({
        error: `Já existe um papel chamado “${repetido.nome}”.`,
      });
      return;
    }
    mudanca.nome = nome;
  }

  if ("descricao" in corpo) mudanca.descricao = lerDescricao(corpo.descricao);

  if ("gerenciaContas" in corpo) {
    const querAdministrar = corpo.gerenciaContas === true;
    if (papel.sistema && querAdministrar !== papel.gerenciaContas) {
      res.status(409).json({
        error: `“${papel.nome}” é um papel do sistema, e gerenciar contas (ou não) é o que ele significa. Crie um papel novo se precisa de outra combinação.`,
      });
      return;
    }
    /*
      Tirar a administração de um papel rebaixa todo mundo que o usa, de uma
      vez. Se não sobrar nenhuma conta ativa que gerencie contas, ninguém
      desfaz isto — é a porta trancada por dentro, com a maçaneta do lado de
      fora.
    */
    if (!querAdministrar && papel.gerenciaContas) {
      const outros = (await listUsers(db)).filter(
        (c) =>
          c.disabledAt === null &&
          c.role === "ADMIN" &&
          c.papelId !== papel.id,
      );
      if (outros.length === 0) {
        res.status(409).json({
          error:
            "Este é o único papel que gerencia contas com gente ativa dentro. " +
            "Tirar isto dele deixaria o sistema sem quem administre acesso — " +
            "inclusive sem quem pudesse desfazer. Ponha alguém num outro papel " +
            "de administração antes.",
        });
        return;
      }
    }
    mudanca.gerenciaContas = querAdministrar;
  }

  const atualizado = await atualizarPapel(db, papel.id, mudanca, req.user!.email);
  req.log.info(
    { papel: atualizado.nome, by: req.user!.email, ...mudanca },
    "Papel alterado",
  );
  res.json({ papel: atualizado, contas: await listUsers(db) });
});

/**
 * As restrições do papel — o corpo é `{ niveis: { "/curadoria": "VISUALIZAR" } }`,
 * e é um patch, como o de `/users/:id/permissoes`. `EDITAR` devolve a chave ao
 * padrão, que concede.
 *
 * Mexer aqui muda o acesso de todo mundo que usa o papel, na hora — e é por isso
 * que a resposta traz a lista de contas junto: a tela mostra quantas mudaram.
 */
router.put("/papeis/:id/permissoes", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de papel inválido." });
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
  for (const [chave, nivel] of Object.entries(niveis as Record<string, unknown>)) {
    if (!chave.startsWith("/") && !ehChaveDeAmbiente(chave)) {
      res.status(400).json({
        error: `"${chave}" não é um módulo nem um ambiente: a chave é o endereço do item no menu, começando por barra, ou "@" e o id do ambiente.`,
      });
      return;
    }
    if (!ehNivel(nivel)) {
      res.status(400).json({
        error: `Nível inválido para ${chave}. Use EDITAR, VISUALIZAR ou SEM_ACESSO.`,
      });
      return;
    }
    pedido[chave] = nivel;
  }

  const papel = await papelPorId(db, req.params.id);
  if (!papel) {
    res.status(404).json({ error: "Papel não encontrado." });
    return;
  }

  /*
    A mesma recusa de `/users/:id/permissoes`, uma camada acima: quem administra
    acesso precisa alcançar a tela onde o acesso se administra. Aqui ela vale
    para o papel inteiro — tirar Configurações do papel de administração seria
    trancar a porta para todo mundo que o usa de uma vez.
  */
  if (papel.gerenciaContas && pedido["/configuracoes"] === "SEM_ACESSO") {
    res.status(409).json({
      error:
        "Este papel gerencia contas, e quem gerencia contas precisa alcançar " +
        "Configurações — que é onde o acesso se administra.",
    });
    return;
  }

  const permissoes = await definirPermissoesDoPapel(db, {
    papelId: papel.id,
    niveis: pedido,
    por: req.user!.email,
  });

  req.log.info(
    { papel: papel.nome, by: req.user!.email, niveis: pedido },
    "Permissões de papel alteradas",
  );

  res.json({
    papel: await papelPorId(db, papel.id),
    permissoes,
    historico: await historicoDoPapel(db, papel.id),
    contas: await listUsers(db),
  });
});

router.delete("/papeis/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de papel inválido." });
    return;
  }

  const papel = await papelPorId(db, req.params.id);
  if (!papel) {
    res.status(404).json({ error: "Papel não encontrado." });
    return;
  }
  if (papel.sistema) {
    res.status(409).json({
      error: `“${papel.nome}” é um papel do sistema e não se apaga: toda conta criada antes do cadastro de papéis aponta para ele.`,
    });
    return;
  }

  const contas = await contasDoPapel(db, papel.id);
  if (contas > 0) {
    res.status(409).json({
      error:
        `${contas} conta${contas === 1 ? "" : "s"} usa${contas === 1 ? "" : "m"} ` +
        `“${papel.nome}”. Mova ess${contas === 1 ? "a conta" : "as contas"} para ` +
        `outro papel antes de apagar este.`,
    });
    return;
  }

  await excluirPapel(db, papel.id);
  req.log.info({ papel: papel.nome, by: req.user!.email }, "Papel apagado");
  res.json(await listarPapeis(db));
});

export default router;
