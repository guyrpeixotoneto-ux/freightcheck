import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  changeTable,
  justificativaLoteTable,
  justificativaTable,
} from "@workspace/db";
import {
  estadoDaAlteracao,
  getChangeSetForPair,
  listChanges,
  autoresDeJustificativas,
  coberturaDeJustificativas,
  coberturaPorRubrica,
  gravarJustificativasDerivadas,
  linhasDoPainel,
  listChangeSets,
  operacaoDoChangeSet,
  type DirecaoDoImpacto,
  type SituacaoDaJustificativa,
} from "@workspace/comparison";
import {
  descreverEscopoDoLote,
  lerEscopoDoLote,
  repartirAlvosDoLote,
  type EscopoDoLote,
} from "@workspace/comparison/justificativa-em-lote";
import { RECORTES_DO_LOTE } from "@workspace/comparison/recortes-do-lote";
import {
  lerJustificativaEstruturada,
  resumoDaJustificativa,
  ROTULO_DO_CAMPO,
} from "@workspace/comparison/justificativa-estruturada";
import {
  iniciarFase,
  instrumentarCicloDaRequisicao,
} from "../lib/observabilidade";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";

const DEFAULT_ACTOR = "sistema";

/**
 * Chamados — Justificativas.
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
 * Painel de Justificativas — a cobertura de Chamados, do acervo inteiro.
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

  /*
    A terceira leitura: a cobertura por rubrica, que é a que o Monitor cobra —
    em que módulo está a pendência, e em que rubrica dentro dele. Ela vem na
    mesma resposta das outras duas pelo motivo do cabeçalho desta rota: a tela
    precisa das três para se montar, e uma chamada por leitura daria três idas
    para responder uma pergunta só.

    Ela é agrupada no banco por atributo e dobrada em rubrica em memória — ver
    `coberturaPorRubrica`. São algumas centenas de linhas no fio, e não as
    milhares que o grão do banco teria.
  */
  const faseRubricas = iniciarFase(req, "db.rubricas");
  const rubricas = await coberturaPorRubrica(db, ids);
  faseRubricas.fim({ linhas: rubricas.length });

  res.json({ cobertura, autores, rubricas });
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
 * Justificar as alterações do corpo — uma linha de `justificativa` por
 * alteração.
 *
 * A caixa da tela manda **uma** alteração por vez desde que virou fila (uma
 * justificativa por variável, porque a parcela e os juros não têm a mesma
 * fórmula). A rota continua aceitando `changeIds` com mais de um id: é o que
 * mantém utilizável o POST de quem tem, de fato, uma decisão só para várias
 * alterações — e tirar o plural daqui não tornaria a rota mais verdadeira, só
 * mais estreita.
 *
 * O corpo deixou de ser `{ texto }` e passou a ser a justificativa estruturada
 * — fórmula, regra, conformidade e, na exceção, motivo e responsável. `texto`
 * continua sendo gravado, e continua sendo o que as telas de uma linha só
 * mostram, mas é **derivado aqui** e não aceito do cliente: um resumo que o
 * cliente mandasse poderia contradizer os campos que o acompanham, e a coluna
 * que a auditoria lê não pode discordar da decisão que ela resume.
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
  const lida = lerJustificativaEstruturada(req.body);
  if (!lida.ok) {
    res.status(400).json({
      error: `A justificativa está incompleta: ${lida.faltam
        .map((campo) => ROTULO_DO_CAMPO[campo])
        .join(", ")}.`,
      faltam: lida.faltam,
    });
    return;
  }
  const justificativa = lida.valor;
  const texto = resumoDaJustificativa(justificativa);

  const criadoPor = req.user?.email ?? DEFAULT_ACTOR;

  // `entity_label`/`entity_type` vêm de `change`, não do corpo da requisição:
  // o cliente não é fonte confiável para o que fica gravado como auditoria, e
  // o filtro por `changeSetId` garante que só alterações desta comparação
  // entram, mesmo que o cliente mande um id de outra.
  const faseChanges = iniciarFase(req, "db.select.changes");
  const changes: {
    id: number;
    entityId: string | null;
    entityLabel: string | null;
    entityType: string | null;
  }[] =
    await db
      .select({
        id: changeTable.id,
        entityId: changeTable.entityId,
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
        formula: justificativa.formula,
        regra: justificativa.regra,
        conforme: justificativa.conforme,
        naoConformidade: justificativa.naoConformidade,
        motivoExcecao: justificativa.motivoExcecao,
        responsavelAprovacao: justificativa.responsavelAprovacao,
        criadoPor,
      })),
    )
    .returning();
  faseInsert.fim({ linhas: inseridas.length });

  /*
    O total que é a conta das suas parcelas fecha sozinho — ver
    `gravarJustificativasDerivadas`. Roda depois do insert, e não antes, porque
    o que ela procura é justamente o efeito dele: a parcela que faltava para o
    total poder ser deduzido pode ser a que acabou de ser gravada.

    Recortada pelas entidades deste POST, e não pela comparação inteira: a caixa
    grava uma variável por vez, e varrer as milhares de alterações da vigência a
    cada clique cobraria da fila o preço de um relatório.

    Uma falha aqui não derruba a gravação de quem justificou: o que o gestor
    escreveu já está no banco, e o total apenas continua pendente — a próxima
    justificativa da mesma placa tenta de novo, porque a varredura não depende
    de qual parcela chegou por último.
  */
  const faseDerivadas = iniciarFase(req, "db.derivadas");
  let derivadas: typeof inseridas = [];
  try {
    derivadas = await gravarJustificativasDerivadas(db, {
      changeSetId,
      entityIds: changes
        .map((c) => c.entityId)
        .filter((id): id is string => id !== null),
      criadoPor,
    });
  } catch (erro) {
    req.log?.warn({ erro }, "não foi possível deduzir a justificativa dos totais");
  }
  faseDerivadas.fim({ linhas: derivadas.length });

  res.status(201).json({ justificativas: [...inseridas, ...derivadas] });
});

/**
 * JUSTIFICAR EM LOTE — a mesma frase, aplicada a várias alterações.
 *
 * ---------------------------------------------------------------------------
 * Por que uma rota, e não um `changeIds` mais longo no POST de cima
 * ---------------------------------------------------------------------------
 * Porque o que chega aqui não é "uma justificativa com mais ids": é uma
 * operação com **universo**, e um universo tem perguntas que a rota de cima não
 * faz e não deveria fazer. Quantas das alterações do recorte já estavam
 * explicadas? O que acontece com elas? Quem autorizou substituir? E, seis meses
 * depois, o que exatamente aquela frase alcançou?
 *
 * O que **não** muda é o que uma justificativa é: continua uma linha por
 * `change_id`, com o mesmo texto derivado no servidor, os mesmos campos
 * estruturados cobrados pela mesma `lerJustificativaEstruturada`, o mesmo
 * histórico (gravar de novo empilha, não edita) e a mesma dedução dos totais.
 * É deliberado: uma segunda gravação com regras próprias seria uma
 * justificativa de segunda classe, e a tela não teria como dizer qual é qual.
 *
 * ---------------------------------------------------------------------------
 * O recorte, e não o retrato do recorte
 * ---------------------------------------------------------------------------
 * `escopo.tipo === "FILTRO"` é quem clicou em "Selecionar todos os N
 * resultados". O corpo traz o filtro — busca, variável, aba, tipo, negativos —
 * e **o servidor reabre o universo aqui**, com a mesma função que a tela usou
 * para desenhar a tabela (`filtrarLinhasDeIpva`). Não é preciosismo de
 * tamanho: a lista que o navegador tinha é um retrato de um instante, e é o
 * recorte — não o retrato — que fica gravado em `justificativa_lote`.
 *
 * A guarda que sustenta isso é o par: o `changeSetId` tem de ser o da
 * comparação de `base → comparada`. Sem ela, um filtro montado sobre um par e
 * mandado com o id de outro gravaria a frase num universo que ninguém viu.
 *
 * ---------------------------------------------------------------------------
 * O que o lote se recusa a fazer em silêncio
 * ---------------------------------------------------------------------------
 * **Não sobrescreve justificativa existente.** Por padrão elas são preservadas
 * e contadas; a resposta diz quantas foram. Substituir é outra ação: pede
 * `sobrescrever: true` — que a tela só manda depois de uma confirmação
 * explícita — e pede papel de administrador, porque apagar da tela a decisão
 * que outra pessoa tomou com o nome dela não é edição de rotina.
 *
 * **Não justifica o que não é alteração.** Conflito e dado incompleto são a
 * recusa do motor em afirmar que houve alteração, e o que eles pedem é conserto
 * de dado, não uma frase — a mesma regra da coluna de justificar, e por isso a
 * mesma função (`estadoDaAlteracao`). Marcar a caixa da placa inteira não passa
 * por cima disso.
 */
router.post("/justificativas/lote", async (req, res): Promise<void> => {
  const changeSetId =
    typeof req.body?.changeSetId === "string" ? req.body.changeSetId : undefined;
  if (!changeSetId) {
    res.status(400).json({ error: "changeSetId é obrigatório." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "comparação", changeSetId, () =>
    operacaoDoChangeSet(db, changeSetId),
  );

  const lido = lerEscopoDoLote(req.body?.escopo, RECORTES_DO_LOTE);
  if (!lido.ok) {
    res.status(400).json({ error: lido.erro });
    return;
  }
  const escopo = lido.valor;

  const justificativaLida = lerJustificativaEstruturada(req.body);
  if (!justificativaLida.ok) {
    res.status(400).json({
      error: `A justificativa está incompleta: ${justificativaLida.faltam
        .map((campo) => ROTULO_DO_CAMPO[campo])
        .join(", ")}.`,
      faltam: justificativaLida.faltam,
    });
    return;
  }
  const justificativa = justificativaLida.valor;

  const sobrescrever = req.body?.sobrescrever === true;
  /*
    Substituir é ato de administração, e não de auditoria.

    O portão de permissão já recusa quem não tem edição no módulo — é ele que
    decide quem justifica. O que ele não distingue é justificar do **apagar da
    tela a justificativa de outra pessoa**, que é o que a substituição em lote
    faz de uma vez em dezenas de linhas. A decisão de quem pode fazer isso é a
    mesma que separa "quem gerencia contas" de "quem usa o produto" (ver
    `lib/papeis.ts`), e é a única no produto com esse recorte.
  */
  if (sobrescrever && req.user?.role !== "ADMIN") {
    res.status(403).json({
      error:
        "Substituir justificativas já gravadas é uma ação de administrador. " +
        "Sem isso, o lote aplica a justificativa apenas às alterações ainda não justificadas.",
    });
    return;
  }

  const faseUniverso = iniciarFase(req, "db.universo");
  let candidatos: { id: number; entityId: string | null }[];
  try {
    candidatos = await candidatosDoLote(changeSetId, escopo);
  } catch (erro) {
    faseUniverso.fim({ linhas: 0 });
    res.status(409).json({ error: (erro as Error).message });
    return;
  }
  faseUniverso.fim({ linhas: candidatos.length });

  if (candidatos.length === 0) {
    res.status(400).json({
      error:
        "Nenhuma alteração deste recorte pode receber justificativa. " +
        "Conflito e dado incompleto não são alterações — eles pedem conserto do dado.",
    });
    return;
  }

  /*
    O que já está explicado, lido **agora** e não pelo que o navegador achava.

    Entre abrir a caixa e confirmar, outra pessoa pode ter justificado uma das
    linhas do recorte — e é exatamente essa a que não pode ser regravada sem
    que ninguém saiba. A leitura é por `change_id`, a mesma da fila.
  */
  const faseJa = iniciarFase(req, "db.ja-justificadas");
  const jaGravadas = await db
    .select({ changeId: justificativaTable.changeId })
    .from(justificativaTable)
    .where(
      and(
        eq(justificativaTable.changeSetId, changeSetId),
        inArray(
          justificativaTable.changeId,
          candidatos.map((c) => c.id),
        ),
      ),
    );
  const jaJustificadas = new Set(jaGravadas.map((j) => j.changeId));
  faseJa.fim({ linhas: jaJustificadas.size });

  const reparticao = repartirAlvosDoLote(
    candidatos.map((c) => c.id),
    jaJustificadas,
    sobrescrever,
  );

  if (reparticao.aplicar.length === 0) {
    res.status(409).json({
      error:
        `As ${reparticao.preservadas.length} alterações deste recorte já estão justificadas. ` +
        "Para substituí-las, confirme a substituição — ela exige papel de administrador.",
      resumo: {
        universo: candidatos.length,
        aplicadas: 0,
        preservadas: reparticao.preservadas.length,
        sobrescritas: 0,
      },
    });
    return;
  }

  const texto = resumoDaJustificativa(justificativa);
  const criadoPor = req.user?.email ?? DEFAULT_ACTOR;
  const porId = new Map(candidatos.map((c) => [c.id, c]));

  /*
    O registro do gesto entra **antes** das linhas, e não depois: é dele que
    sai o `lote_id` de cada uma. As duas escritas vão na mesma transação porque
    uma justificativa em lote sem o registro do universo é exatamente o que
    esta rota existe para não produzir.
  */
  const faseGravacao = iniciarFase(req, "db.insert");
  const { lote, inseridas } = await db.transaction(async (tx) => {
    const [lote] = await tx
      .insert(justificativaLoteTable)
      .values({
        changeSetId,
        escopo: escopo.tipo,
        recorte: escopo,
        descricao: descreverEscopoDoLote(
          escopo,
          escopo.tipo === "FILTRO" ? RECORTES_DO_LOTE[escopo.rubrica]?.padroes : undefined,
        ),
        alteracoesNoUniverso: candidatos.length,
        aplicadas: reparticao.aplicar.length,
        preservadas: reparticao.preservadas.length,
        sobrescritas: reparticao.sobrescritas.length,
        sobrescrever,
        criadoPor,
      })
      .returning();

    /*
      `entity_label`/`entity_type` vêm de `change`, e não do corpo: o cliente
      não é fonte confiável para o que fica gravado como auditoria. É a mesma
      regra do POST de uma alteração, e por isso a mesma leitura — os
      candidatos já vieram do banco, recortados por este `change_set`.
    */
    const alvos = await tx
      .select({
        id: changeTable.id,
        entityLabel: changeTable.entityLabel,
        entityType: changeTable.entityType,
      })
      .from(changeTable)
      .where(
        and(
          eq(changeTable.changeSetId, changeSetId),
          inArray(changeTable.id, reparticao.aplicar),
        ),
      );

    const inseridas = await tx
      .insert(justificativaTable)
      .values(
        alvos.map((alvo) => ({
          changeSetId,
          changeId: alvo.id,
          entityLabel: alvo.entityLabel ?? "",
          entityType: alvo.entityType,
          texto,
          formula: justificativa.formula,
          regra: justificativa.regra,
          conforme: justificativa.conforme,
          naoConformidade: justificativa.naoConformidade,
          motivoExcecao: justificativa.motivoExcecao,
          responsavelAprovacao: justificativa.responsavelAprovacao,
          loteId: lote!.id,
          criadoPor,
        })),
      )
      .returning();

    return { lote: lote!, inseridas };
  });
  faseGravacao.fim({ linhas: inseridas.length });

  /*
    Os totais que são a conta das suas parcelas fecham sozinhos, como no POST de
    uma alteração — e aqui com mais razão: um lote costuma justificar todas as
    parcelas de uma vez, que é justamente quando o total passa a ser dedutível.
    Uma falha aqui não derruba o que o gestor escreveu; o total apenas continua
    pendente.
  */
  const faseDerivadas = iniciarFase(req, "db.derivadas");
  let derivadas: typeof inseridas = [];
  try {
    derivadas = await gravarJustificativasDerivadas(db, {
      changeSetId,
      entityIds: reparticao.aplicar
        .map((id) => porId.get(id)?.entityId ?? null)
        .filter((id): id is string => id !== null),
      criadoPor,
    });
  } catch (erro) {
    req.log?.warn({ erro }, "não foi possível deduzir a justificativa dos totais");
  }
  faseDerivadas.fim({ linhas: derivadas.length });

  res.status(201).json({
    lote,
    justificativas: [...inseridas, ...derivadas],
    resumo: {
      universo: candidatos.length,
      aplicadas: inseridas.length,
      preservadas: reparticao.preservadas.length,
      sobrescritas: reparticao.sobrescritas.length,
    },
  });
});

/**
 * O universo do lote, resolvido **no banco** — nunca aceito pronto.
 *
 * Os dois caminhos chegam ao mesmo lugar por razões diferentes:
 *
 * · **SELECAO** — os ids vêm do corpo, mas o que vale é o recorte por
 *   `change_set` e o estado que o motor gravou: um id de outra comparação some
 *   aqui, e um conflito também.
 * · **FILTRO** — não há ids. O recorte é reaberto com as mesmas funções da
 *   tela: as alterações da rubrica, traduzidas em linhas, filtradas pelo mesmo
 *   `filtrarLinhasDeIpva`. As linhas "sem alteração" nunca entram porque não
 *   têm `change.id` — não há sobre o que gravar.
 *
 * `entityId` viaja junto porque é dele que a dedução dos totais precisa, e
 * buscá-lo de novo depois seria uma segunda ida ao banco para ler o que esta
 * já leu.
 */
async function candidatosDoLote(
  changeSetId: string,
  escopo: EscopoDoLote,
): Promise<{ id: number; entityId: string | null }[]> {
  if (escopo.tipo === "SELECAO") {
    const linhas = await db
      .select({
        id: changeTable.id,
        entityId: changeTable.entityId,
        changeType: changeTable.changeType,
        nature: changeTable.nature,
        attributeCode: changeTable.attributeCode,
        entityLabel: changeTable.entityLabel,
        entityType: changeTable.entityType,
        valueBefore: changeTable.valueBefore,
        valueAfter: changeTable.valueAfter,
        deltaAbsolute: changeTable.deltaAbsolute,
        deltaPercent: changeTable.deltaPercent,
        comparability: changeTable.comparability,
      })
      .from(changeTable)
      .where(
        and(
          eq(changeTable.changeSetId, changeSetId),
          inArray(changeTable.id, escopo.changeIds),
        ),
      );
    return linhas
      .filter((l) => estadoDaAlteracao(l) === "ALTERADO")
      .map((l) => ({ id: l.id, entityId: l.entityId }));
  }

  /*
    A guarda do par: o filtro foi montado sobre `base → comparada`, e é essa a
    comparação em que ele pode ser reaberto. Um `changeSetId` de outro par com
    um filtro deste gravaria a frase num universo que ninguém viu em tela.
  */
  const doPar = await getChangeSetForPair(db, escopo.base, escopo.comparada);
  if (!doPar || String(doPar.id) !== changeSetId) {
    throw new Error(
      "O recorte é de outro par de vigências. Recarregue a comparação e refaça a seleção.",
    );
  }

  /*
    O recorte da rubrica, com as mesmas funções que desenharam a tabela — ver
    `RECORTES_DO_LOTE`. A rubrica já foi validada na leitura do escopo; este
    acesso não pode falhar, e a guarda existe para o dia em que alguém tirar
    uma entrada do registro sem tirar a rota junto.
  */
  const recorte = RECORTES_DO_LOTE[escopo.rubrica];
  if (!recorte) {
    throw new Error(`Não sei reabrir o recorte de ${escopo.rubrica}.`);
  }

  const { rows } = await listChanges(db, changeSetId, {
    attributeCodes: [...recorte.codigos],
    limit: 5000,
  });
  const ids = recorte
    .filtrar(recorte.linhas(rows), escopo.filtros)
    .filter((linha) => linha.id !== null && linha.estado === "ALTERADO")
    .map((linha) => linha.id!);
  if (ids.length === 0) return [];

  /*
    O `entity_id` numa segunda ida, e não em `listChanges`: a leitura da tela
    não o traz — nenhuma tela mostra o id interno do ativo —, e é dele que a
    dedução dos totais precisa. Alargar `listChanges` para servir a esta rota
    faria a leitura de todas as telas carregar uma coluna que nenhuma usa.
  */
  return db
    .select({ id: changeTable.id, entityId: changeTable.entityId })
    .from(changeTable)
    .where(and(eq(changeTable.changeSetId, changeSetId), inArray(changeTable.id, ids)));
}

export default router;
