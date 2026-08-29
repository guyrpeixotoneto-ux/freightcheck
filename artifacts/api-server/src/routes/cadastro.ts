import { Router, type IRouter, type Response } from "express";
import { eq, sql } from "drizzle-orm";
import {
  appUserTable,
  CadastroEmUso,
  CadastroNaoEncontrado,
  CadastroSemNome,
  DepartamentoInexistente,
  DepartamentoPaiInexistente,
  HierarquiaCircular,
  NomeJaCadastrado,
  cadastrarCargo,
  cadastrarDepartamento,
  cadastrarNegocio,
  db,
  editarCargo,
  editarDepartamento,
  editarNegocio,
  excluirCargo,
  excluirDepartamento,
  excluirNegocio,
  listarCargos,
  listarDepartamentos,
  listarNegocios,
} from "@workspace/db";

/**
 * CONFIGURAÇÕES → CARGOS, NEGÓCIO E DEPARTAMENTO — o cadastro da casa.
 *
 * As três telas eram páginas de "em preparo" que diziam o que faltava. O que
 * faltava era isto: as três coisas como **cadastro**, com identidade própria,
 * autor e data — e não como o texto que a planilha trouxe. Ver
 * `lib/db/src/schema/cadastro.ts` para o desenho e `lib/db/src/cadastro.ts`
 * para as regras.
 *
 * **Três rotas, e não uma genérica com o tipo no caminho.** Elas quase
 * coincidem hoje — nome entra, nome sai —, e a semelhança é temporária: cargo
 * ganha faixa salarial vigente, departamento ganha vínculo com classe de custo,
 * negócio ganha a regra que vale nele. Uma rota genérica pagaria a fatura da
 * separação depois, com três chamadores já escritos em cima dela.
 *
 * **Ler é aberto a quem tem sessão; escrever é de ADMIN**, exatamente como em
 * `users.ts` e pela mesma razão: saber que departamentos existem não é
 * privilégio, e criar a estrutura da empresa é ato administrativo. Quem cria
 * fica gravado em `criado_por`, no mesmo formato do `actor` do resto do
 * produto — um cadastro sem autor é o que este produto recusa em todas as
 * outras telas.
 *
 * **A contagem de uso vem junto na listagem, e é o que separa esta tela de uma
 * lista de nomes.** `cargos` diz quantas contas estão lotadas em cada cargo, e
 * `departamentos` diz quantos cargos e quantos departamentos filhos dependem de
 * cada um. É com esse número que a tela explica por que a exclusão foi recusada
 * antes de alguém tentar — e não depois, com uma violação de chave estrangeira
 * traduzida às pressas.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A mesma recusa de `users.ts`, uma frase só — quem a lê sabe a quem pedir. */
function somenteAdmin(req: { user?: { role: string } }): string | null {
  return req.user?.role === "ADMIN"
    ? null
    : "Somente administradores mexem no cadastro da casa. Peça a um administrador.";
}

/**
 * Traduz as recusas do cadastro em status e código.
 *
 * O `codigo` existe para a tela poder decidir o que fazer sem ler a frase — é o
 * mesmo contrato de `unidades.ts`. A frase continua indo junto porque é ela que
 * a pessoa lê, e ela diz o que fazer a seguir, não só o que deu errado.
 */
function responderRecusa(erro: unknown, res: Response): boolean {
  if (erro instanceof CadastroSemNome) {
    res.status(400).json({ error: erro.message, codigo: "CADASTRO_SEM_NOME" });
    return true;
  }
  if (erro instanceof NomeJaCadastrado) {
    res.status(409).json({
      error: erro.message,
      codigo: "NOME_JA_CADASTRADO",
      nomeExistente: erro.nomeExistente,
    });
    return true;
  }
  if (erro instanceof CadastroNaoEncontrado) {
    res.status(404).json({ error: erro.message, codigo: "CADASTRO_NAO_ENCONTRADO" });
    return true;
  }
  if (erro instanceof DepartamentoPaiInexistente || erro instanceof DepartamentoInexistente) {
    res.status(400).json({ error: erro.message, codigo: "DEPARTAMENTO_INEXISTENTE" });
    return true;
  }
  if (erro instanceof HierarquiaCircular) {
    res.status(409).json({ error: erro.message, codigo: "HIERARQUIA_CIRCULAR" });
    return true;
  }
  if (erro instanceof CadastroEmUso) {
    res.status(409).json({ error: erro.message, codigo: "CADASTRO_EM_USO" });
    return true;
  }
  return false;
}

/** O texto de um campo do corpo, ou vazio — nunca `undefined` disfarçado. */
function texto(corpo: Record<string, unknown>, campo: string): string {
  return typeof corpo[campo] === "string" ? (corpo[campo] as string) : "";
}

/**
 * O `id` opcional de um campo do corpo.
 *
 * `undefined` (campo ausente) e `null` (campo mandado vazio) são coisas
 * diferentes na edição — o primeiro é "não mexa nisso", o segundo é "tire a
 * lotação" — e por isso os dois sobrevivem daqui até `cadastro.ts`.
 */
function idOpcional(
  corpo: Record<string, unknown>,
  campo: string,
): string | null | undefined {
  if (!(campo in corpo)) return undefined;
  const valor = corpo[campo];
  if (valor === null || valor === "") return null;
  return typeof valor === "string" && UUID.test(valor) ? valor : undefined;
}

/* =========================================================================
 * Departamento
 * ====================================================================== */

/** Quantos cargos e quantos filhos dependem de cada departamento. */
async function usoDosDepartamentos(): Promise<Map<string, { cargos: number; filhos: number }>> {
  const { rows } = await db.execute<{ id: string; cargos: number; filhos: number }>(sql`
    SELECT d.id                                                     AS id,
           (SELECT count(*)::int FROM cargo c WHERE c.departamento_id = d.id) AS cargos,
           (SELECT count(*)::int FROM departamento f WHERE f.pai_id  = d.id)  AS filhos
      FROM departamento d
  `);
  return new Map(
    rows.map((l) => [l.id, { cargos: Number(l.cargos), filhos: Number(l.filhos) }]),
  );
}

router.get("/cadastro/departamentos", async (_req, res): Promise<void> => {
  const [departamentos, uso] = await Promise.all([
    listarDepartamentos(db),
    usoDosDepartamentos(),
  ]);
  res.json(
    departamentos.map((d) => ({
      ...d,
      cargos: uso.get(d.id)?.cargos ?? 0,
      filhos: uso.get(d.id)?.filhos ?? 0,
    })),
  );
});

router.post("/cadastro/departamentos", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  try {
    const criado = await cadastrarDepartamento(db, {
      nome: texto(corpo, "nome"),
      paiId: idOpcional(corpo, "paiId") ?? null,
      criadoPor: req.user!.email,
    });
    req.log.info({ nome: criado.nome, by: req.user!.email }, "Departamento cadastrado");
    res.status(201).json({ ...criado, cargos: 0, filhos: 0 });
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

router.put("/cadastro/departamentos/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de departamento inválido." });
    return;
  }
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  try {
    const editado = await editarDepartamento(db, req.params.id, {
      nome: texto(corpo, "nome"),
      paiId: idOpcional(corpo, "paiId"),
    });
    const uso = await usoDosDepartamentos();
    res.json({
      ...editado,
      cargos: uso.get(editado.id)?.cargos ?? 0,
      filhos: uso.get(editado.id)?.filhos ?? 0,
    });
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

router.delete("/cadastro/departamentos/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de departamento inválido." });
    return;
  }
  try {
    await excluirDepartamento(db, req.params.id);
    req.log.info({ id: req.params.id, by: req.user!.email }, "Departamento excluído");
    res.status(204).end();
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

/* =========================================================================
 * Cargo
 * ====================================================================== */

/** Quantas contas estão lotadas em cada cargo. */
async function contasPorCargo(): Promise<Map<string, number>> {
  const linhas = await db
    .select({ cargoId: appUserTable.cargoId, contas: sql<number>`count(*)::int` })
    .from(appUserTable)
    .groupBy(appUserTable.cargoId);
  return new Map(
    linhas
      .filter((l): l is { cargoId: string; contas: number } => l.cargoId !== null)
      .map((l) => [l.cargoId, Number(l.contas)]),
  );
}

router.get("/cadastro/cargos", async (_req, res): Promise<void> => {
  const [cargos, contas] = await Promise.all([listarCargos(db), contasPorCargo()]);
  res.json(cargos.map((c) => ({ ...c, contas: contas.get(c.id) ?? 0 })));
});

router.post("/cadastro/cargos", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  try {
    const criado = await cadastrarCargo(db, {
      nome: texto(corpo, "nome"),
      departamentoId: idOpcional(corpo, "departamentoId") ?? null,
      criadoPor: req.user!.email,
    });
    req.log.info({ nome: criado.nome, by: req.user!.email }, "Cargo cadastrado");
    res.status(201).json({ ...criado, contas: 0 });
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

router.put("/cadastro/cargos/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de cargo inválido." });
    return;
  }
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  try {
    const editado = await editarCargo(db, req.params.id, {
      nome: texto(corpo, "nome"),
      departamentoId: idOpcional(corpo, "departamentoId"),
    });
    const contas = await contasPorCargo();
    res.json({ ...editado, contas: contas.get(editado.id) ?? 0 });
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

/**
 * Exclui um cargo, e recusa quando há conta lotada nele.
 *
 * A checagem é feita aqui, e não em `cadastro.ts`, porque a tabela de contas é
 * de auth e aquele módulo é do cadastro — pô-la lá faria o cadastro depender de
 * quem entra no produto. O `RESTRICT` da chave estrangeira continua sendo a
 * segunda linha de defesa.
 */
router.delete("/cadastro/cargos/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de cargo inválido." });
    return;
  }

  const lotadas = await db
    .select({ id: appUserTable.id })
    .from(appUserTable)
    .where(eq(appUserTable.cargoId, req.params.id));
  if (lotadas.length > 0) {
    res.status(409).json({
      codigo: "CADASTRO_EM_USO",
      error:
        `Este cargo não pode ser excluído: ${lotadas.length} conta` +
        `${lotadas.length === 1 ? " está lotada" : "s estão lotadas"} nele. ` +
        "Troque o cargo dessas pessoas em Configurações → Usuários antes.",
    });
    return;
  }

  try {
    await excluirCargo(db, req.params.id);
    req.log.info({ id: req.params.id, by: req.user!.email }, "Cargo excluído");
    res.status(204).end();
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

/* =========================================================================
 * Negócio
 * ====================================================================== */

router.get("/cadastro/negocios", async (_req, res): Promise<void> => {
  res.json(await listarNegocios(db));
});

router.post("/cadastro/negocios", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  try {
    const criado = await cadastrarNegocio(db, {
      nome: texto(corpo, "nome"),
      criadoPor: req.user!.email,
    });
    req.log.info({ nome: criado.nome, by: req.user!.email }, "Negócio cadastrado");
    res.status(201).json(criado);
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

router.put("/cadastro/negocios/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de negócio inválido." });
    return;
  }
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  try {
    res.json(await editarNegocio(db, req.params.id, { nome: texto(corpo, "nome") }));
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

router.delete("/cadastro/negocios/:id", async (req, res): Promise<void> => {
  const recusa = somenteAdmin(req);
  if (recusa) {
    res.status(403).json({ error: recusa });
    return;
  }
  if (!UUID.test(req.params.id)) {
    res.status(400).json({ error: "Identificador de negócio inválido." });
    return;
  }
  try {
    await excluirNegocio(db, req.params.id);
    req.log.info({ id: req.params.id, by: req.user!.email }, "Negócio excluído");
    res.status(204).end();
  } catch (erro) {
    if (!responderRecusa(erro, res)) throw erro;
  }
});

export default router;
