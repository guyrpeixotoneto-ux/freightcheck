import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, changeTable, justificativaTable } from "@workspace/db";
import {
  autoresDeJustificativas,
  coberturaDeJustificativas,
  linhasDoPainel,
  listChangeSets,
  operacaoDoChangeSet,
  type DirecaoDoImpacto,
  type SituacaoDaJustificativa,
} from "@workspace/comparison";
import {
  iniciarFase,
  instrumentarCicloDaRequisicao,
} from "../lib/observabilidade";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";

const DEFAULT_ACTOR = "sistema";

/**
 * Plano de Ação — Justificativas.
 *
 * A tela lê `/changes/latest` (mesma rota da aba Planilha de Alterações) para
 * saber o que mudou, agrupa por placa no cliente e usa esta rota só para o
 * que é próprio dela: a justificativa que o gestor escreveu sobre cada
 * alteração (`change.id`), dentro de uma comparação (`changeSetId`).
 */
const router: IRouter = Router();

router.use("/justificativas", instrumentarCicloDaRequisicao);

const SITUACOES: SituacaoDaJustificativa[] = ["TODAS", "PENDENTE", "JUSTIFICADA"];
const DIRECOES: DirecaoDoImpacto[] = ["TODAS", "AUMENTO", "REDUCAO"];

/** Dez linhas por página, como o rodapé de paginação abre; teto de cem. */
const POR_PAGINA_PADRAO = 10;
const POR_PAGINA_MAXIMO = 100;

function limiteDaConsulta(bruto: unknown): number {
  const n = Number(bruto);
  if (!Number.isFinite(n) || n <= 0) return POR_PAGINA_PADRAO;
  return Math.min(Math.trunc(n), POR_PAGINA_MAXIMO);
}

function offsetDaConsulta(bruto: unknown): number {
  const n = Number(bruto);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * As comparações que o painel pode somar: a escolhida, quando há uma, e as da
 * unidade aberta quando não.
 *
 * A recusa por operação é a mesma das rotas por id — um `changeSetId` de outra
 * auditoria não vira painel, vira 403. Sem id nenhum, quem recorta é
 * `listChangeSets`, que já é por operação: é o que garante que "todas" nunca
 * queira dizer "as das quatro".
 *
 * **E por unidade, quando quem pergunta traz uma.** A operação sozinha não
 * bastava: com PERNAMBUCO na lateral, o painel somava a empurrada inteira —
 * CAMAÇARI, MANAUS e CDD CEBRASA no mesmo total, e as linhas da fila trazendo
 * placas que a unidade aberta não tem. O recorte é o `scope_hash` da vigência
 * comparada (`snapshot_b_scope_hash`), o mesmo par que `comparacoesDoEscopo`
 * aplica no cliente. Sem `scopeHash` a resposta é a de antes — a soma que
 * atravessa as unidades, que na tela é a Visão Geral.
 *
 * Comparação sem `scope_hash` — anterior à coluna — fica fora do recorte de uma
 * unidade: atribuí-la à unidade aberta seria afirmar uma origem que o dado não
 * tem.
 */
async function idsDoPainel(
  req: Parameters<typeof exigirOperacaoDoRecurso>[0],
  operacao: ReturnType<typeof operacaoDaConsulta>,
  changeSetId: string | undefined,
  scopeHash: string | undefined,
): Promise<string[]> {
  if (changeSetId) {
    await exigirOperacaoDoRecurso(req, "comparação", changeSetId, () =>
      operacaoDoChangeSet(db, changeSetId),
    );
    return [changeSetId];
  }
  const changeSets = await listChangeSets(db, { operacao });
  return changeSets
    .filter((cs) => !scopeHash || String(cs.snapshot_b_scope_hash ?? "") === scopeHash)
    .map((cs) => String(cs.id));
}

function escopoDaConsulta(query: Record<string, unknown>): string | undefined {
  return typeof query.scopeHash === "string" && query.scopeHash !== ""
    ? query.scopeHash
    : undefined;
}

/**
 * Painel de Justificativas — a cobertura do Plano de Ação, do acervo inteiro.
 *
 * A fila (`GET /justificativas`) responde por uma comparação de cada vez, que é
 * o que a tela de justificar precisa. O painel pergunta outra coisa — quanto do
 * que mudou já está explicado e quanto falta —, e essa pergunta não tem
 * resposta dentro de uma vigência só: quem cobra o trabalho quer o total, e
 * depois o recorte.
 *
 * Uma resposta para todas as comparações da operação, e não uma por vigência,
 * pelo mesmo motivo de `/change-sets/tipos`: são poucas comparações, a tela
 * precisa de todas para montar os cartões e a tabela por vigência, e N chamadas
 * dariam a mesma resposta por N vezes o custo.
 *
 * O recorte por operação é o das demais listagens — `listChangeSets` já o
 * aplica, e é ele que impede o painel da Auditoria Rota de somar a cobertura da
 * empurrada. Um `?changeSetId=` fora da operação de quem pergunta é recusado
 * pela mesma regra por id do resto do arquivo. `?scopeHash=` recorta pela
 * unidade aberta na lateral; sem ele, a soma atravessa as unidades — ver
 * `idsDoPainel`.
 */
router.get("/justificativas/painel", async (req, res): Promise<void> => {
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);
  const changeSetId =
    typeof req.query.changeSetId === "string" && req.query.changeSetId !== ""
      ? req.query.changeSetId
      : undefined;

  const ids = await idsDoPainel(
    req,
    operacao,
    changeSetId,
    escopoDaConsulta(req.query as Record<string, unknown>),
  );

  const faseCobertura = iniciarFase(req, "db.cobertura");
  const cobertura = await coberturaDeJustificativas(db, ids);
  faseCobertura.fim({ linhas: cobertura.length });

  const faseAutores = iniciarFase(req, "db.autores");
  const autores = await autoresDeJustificativas(db, ids);
  faseAutores.fim({ linhas: autores.length });

  res.json({ cobertura, autores });
});

/**
 * A lista do painel: as alterações pendentes de justificativa, ou as já
 * justificadas — paginadas no banco.
 *
 * Paginada no servidor, e não recortada no cliente como a fila faz, porque
 * aqui a lista pode atravessar o acervo inteiro: "todas as pendências de todas
 * as vigências" é justamente a pergunta que a fila não responde, e trazê-la
 * inteira para o navegador para mostrar dez linhas seria o desenho que
 * `components/ui/paginacao.tsx` existe para não repetir.
 */
router.get("/justificativas/pendencias", async (req, res): Promise<void> => {
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);
  const changeSetId =
    typeof req.query.changeSetId === "string" && req.query.changeSetId !== ""
      ? req.query.changeSetId
      : undefined;

  const ids = await idsDoPainel(
    req,
    operacao,
    changeSetId,
    escopoDaConsulta(req.query as Record<string, unknown>),
  );

  const situacao = SITUACOES.includes(req.query.situacao as SituacaoDaJustificativa)
    ? (req.query.situacao as SituacaoDaJustificativa)
    : "PENDENTE";
  const direcao = DIRECOES.includes(req.query.direcao as DirecaoDoImpacto)
    ? (req.query.direcao as DirecaoDoImpacto)
    : "TODAS";
  const entityType =
    typeof req.query.entityType === "string" && req.query.entityType !== ""
      ? req.query.entityType
      : undefined;
  const autor =
    typeof req.query.autor === "string" && req.query.autor !== ""
      ? req.query.autor
      : undefined;

  const fase = iniciarFase(req, "db.linhas");
  const resposta = await linhasDoPainel(db, {
    changeSetIds: ids,
    entityType,
    situacao,
    direcao,
    autor,
    limit: limiteDaConsulta(req.query.limit),
    offset: offsetDaConsulta(req.query.offset),
  });
  fase.fim({ linhas: resposta.linhas.length, total: resposta.total });

  res.json(resposta);
});

/** As justificativas de uma comparação, uma por alteração — sempre a mais recente. */
router.get("/justificativas", async (req, res): Promise<void> => {
  const changeSetId =
    typeof req.query.changeSetId === "string"
      ? req.query.changeSetId
      : undefined;
  if (!changeSetId) {
    res.status(400).json({ error: "changeSetId é obrigatório." });
    return;
  }
  /*
    A justificativa é sempre *de uma comparação*, e a comparação é de uma
    operação. Ler ou escrever a de outra é o mesmo vazamento das rotas por id —
    aqui com a agravante de a escrita gravar, na comparação alheia, um texto que
    o gestor achava estar escrevendo na dele.
  */
  await exigirOperacaoDoRecurso(req, "comparação", changeSetId, () =>
    operacaoDoChangeSet(db, changeSetId),
  );

  const faseSelect = iniciarFase(req, "db.select");
  const rows = await db
    .select()
    .from(justificativaTable)
    .where(eq(justificativaTable.changeSetId, changeSetId))
    .orderBy(desc(justificativaTable.criadoEm));
  faseSelect.fim({ linhas: rows.length });

  // Uma alteração pode ter sido justificada mais de uma vez; a tela mostra só
  // a mais recente, e a lista já vem ordenada da mais nova para a mais antiga.
  const porAlteracao = new Map<number, (typeof rows)[number]>();
  for (const row of rows) {
    if (!porAlteracao.has(row.changeId)) porAlteracao.set(row.changeId, row);
  }

  res.json({ justificativas: [...porAlteracao.values()] });
});

/**
 * Justificar uma ou mais alterações de uma vez — o mesmo texto vale para
 * todas as selecionadas, uma linha por alteração.
 */
router.post("/justificativas", async (req, res): Promise<void> => {
  const changeSetId =
    typeof req.body?.changeSetId === "string"
      ? req.body.changeSetId
      : undefined;
  const changeIds = Array.isArray(req.body?.changeIds)
    ? req.body.changeIds.filter(
        (v: unknown): v is number => typeof v === "number" && Number.isFinite(v),
      )
    : [];
  const texto =
    typeof req.body?.texto === "string" ? req.body.texto.trim() : "";

  if (!changeSetId) {
    res.status(400).json({ error: "changeSetId é obrigatório." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "comparação", changeSetId, () =>
    operacaoDoChangeSet(db, changeSetId),
  );
  if (changeIds.length === 0) {
    res.status(400).json({ error: "Selecione ao menos uma alteração." });
    return;
  }
  if (texto === "") {
    res
      .status(400)
      .json({ error: "A justificativa não pode ficar em branco." });
    return;
  }

  const criadoPor = req.user?.email ?? DEFAULT_ACTOR;

  // `entity_label`/`entity_type` vêm de `change`, não do corpo da requisição:
  // o cliente não é fonte confiável para o que fica gravado como auditoria, e
  // o filtro por `changeSetId` garante que só alterações desta comparação
  // entram, mesmo que o cliente mande um id de outra.
  const faseChanges = iniciarFase(req, "db.select.changes");
  const changes: { id: number; entityLabel: string | null; entityType: string | null }[] =
    await db
      .select({
        id: changeTable.id,
        entityLabel: changeTable.entityLabel,
        entityType: changeTable.entityType,
      })
      .from(changeTable)
      .where(
        and(
          eq(changeTable.changeSetId, changeSetId),
          inArray(changeTable.id, changeIds),
        ),
      );
  faseChanges.fim({ linhas: changes.length });

  if (changes.length === 0) {
    res
      .status(400)
      .json({ error: "Nenhuma das alterações selecionadas pertence a esta comparação." });
    return;
  }

  const faseInsert = iniciarFase(req, "db.insert");
  const inseridas = await db
    .insert(justificativaTable)
    .values(
      changes.map((change) => ({
        changeSetId,
        changeId: change.id,
        entityLabel: change.entityLabel ?? "",
        entityType: change.entityType,
        texto,
        criadoPor,
      })),
    )
    .returning();
  faseInsert.fim({ linhas: inseridas.length });

  res.status(201).json({ justificativas: inseridas });
});

export default router;
