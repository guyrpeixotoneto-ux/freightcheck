import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeAluguel,
  CODIGOS_DA_TABELA_DE_ALUGUEL,
  CODIGOS_DO_DETALHE_DE_ALUGUEL,
  computeChangeSet,
  conferenciaDoAluguel,
  distribuicaoPorEstadoDeAluguel,
  getChangeSetForPair,
  getEntityTable,
  linhaDeAluguelSemAlteracao,
  linhasDeAluguel,
  listChanges,
  frotaDoEquipamento,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirAluguel,
  totaisDeAluguelPorVigencia,
  variavelDeAluguelDoCodigo,
  VARIAVEIS_DE_ALUGUEL,
  VARIAVEIS_DE_DETALHE_DE_ALUGUEL,
  type LinhaDeAluguel,
  type ValorDeAluguel,
  type RequestedContext,
  TIPOS_DE_EQUIPAMENTO,
} from "@workspace/comparison";
import { classificarFalha } from "../lib/classificar-falha";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { contextoDoPar } from "../lib/recorte-do-par";
import { comTetoDeRota } from "../lib/timeout-de-rota";
import {
  baldesDeUmaNatureza,
  candidatasDoPar,
  TETO_DE_CANDIDATAS_MS,
} from "../lib/candidatas-do-par";

/**
 * AUDITORIA DE ALUGUEL DE FROTA — o implemento alugado, entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `aluguel.ts` traduz; aqui só se costura os três e se responde. É a mesma rota
 * das outras cinco do Custo Fixo sobre outro recorte.
 *
 * ---------------------------------------------------------------------------
 * As duas leituras de `/aluguel/totais`
 * ---------------------------------------------------------------------------
 * O total mensal por vigência e a conferência da parcela saem da **mesma** linha
 * de `getEntityTable`: o aluguel, a parcela FINAME, a amortização e os juros do
 * mesmo implemento. Duas rotas leriam o acervo duas vezes para responder a duas
 * metades da mesma pergunta — e correriam o risco de cair em leituras
 * diferentes.
 *
 * As quatro colunas são pedidas juntas porque a conferência **é** sobre a
 * relação entre elas: nos alugados, amortização e juros são zero e a parcela é o
 * aluguel (`docs/ACHADO-ALUGUEL.md`).
 */
const router: IRouter = Router();

/** As variáveis — lidas do catálogo, nunca redigitadas. */
const ALUGUEL = VARIAVEIS_DE_ALUGUEL.find((v) => v.chave === "aluguel");
const PARCELA = VARIAVEIS_DE_ALUGUEL.find((v) => v.chave === "parcela_finame");
const ALUGUEL_DO_CAVALO = VARIAVEIS_DE_DETALHE_DE_ALUGUEL.find(
  (v) => v.chave === "aluguel_cavalo",
);

/**
 * As colunas de financiamento que a conferência precisa, e que não são do
 * catálogo desta rubrica.
 *
 * Amortização e juros são rubrica do FINAME, e por isso **não** entram em
 * `VARIAVEIS_DE_ALUGUEL`: uma tela não reivindica a coluna de outra só porque
 * precisa lê-la. Elas são lidas aqui, para a conferência, e não viram linha da
 * tabela nem entram em soma nenhuma — a mesma separação que a Auditoria de
 * Seguro faz ao conferir o custo fixo declarado.
 */
const AMORTIZACAO_DO_IMPLEMENTO = "carreta.amortizacao_implemento";
const JUROS_DO_IMPLEMENTO = "carreta.juros_finame_implemento";

/**
 * As linhas "sem alteração" — a leitura completa que o alternador liga.
 *
 * Nesta rubrica ele carrega mais peso do que nas irmãs: a frota alugada é uma
 * minoria, e um par de vigências em que nenhum aluguel mudou ainda tem
 * implementos alugados para mostrar. Ligado, a tabela diz quais são e quanto
 * custam.
 */
async function linhasIguais(
  snapshotA: { id: string; effectiveDate: string },
  snapshotB: { id: string; effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeAluguel[]> {
  const linhas: LinhaDeAluguel[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA_DE_ALUGUEL.filter(
      (c) => variavelDeAluguelDoCodigo(c)?.codigo[entityType] === c,
    );
    if (codigos.length === 0) continue;

    const [a, b] = await Promise.all([
      getEntityTable(db, entityType, codigos, recorte, snapshotA.effectiveDate),
      getEntityTable(db, entityType, codigos, recorte, snapshotB.effectiveDate),
    ]);
    if (!a || !b) continue;

    const naBase = new Map<string, (typeof a.rows)[number]["values"]>();
    for (const linha of a.rows) naBase.set(linha.entityId, linha.values);

    for (const linha of b.rows) {
      const anterior = naBase.get(linha.entityId);
      if (!anterior) continue;
      for (const code of codigos) {
        const antes = anterior[code]?.value ?? null;
        const depois = linha.values[code]?.value ?? null;
        if (antes !== depois) continue;
        /* Os dois lados ausentes não são "sem alteração": são ausência nas duas
           pontas, e o motor já não escreveu linha para eles. */
        if (antes === null) continue;
        const chave = `${linha.label}${entityType}${code}`;
        if (jaListadas.has(chave)) continue;
        const semAlteracao = linhaDeAluguelSemAlteracao({
          entityLabel: linha.label,
          entityType,
          attributeCode: code,
          valor: antes,
        });
        if (semAlteracao) linhas.push(semAlteracao);
      }
    }
  }
  return linhas;
}

/**
 * O par de vigências, recortado no aluguel.
 *
 * `GET /aluguel/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 */
router.get("/aluguel/comparacao", async (req, res, next): Promise<void> => {
  const base = typeof req.query.base === "string" ? req.query.base : "";
  const comparada = typeof req.query.comparada === "string" ? req.query.comparada : "";
  if (!base || !comparada) {
    res.status(400).json({ error: "Informe base e comparada." });
    return;
  }
  for (const id of [base, comparada]) {
    await exigirOperacaoDoRecurso(req, "vigência", id, () => operacaoDoSnapshot(db, id));
  }

  const comSemAlteracao = req.query.semAlteracao === "true";

  try {
    /* Reaproveita a comparação já calculada; só calcula quando ela não existe —
       o mesmo caminho das outras telas, e o que faz todas mostrarem o mesmo
       número para o mesmo par. */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:aluguel" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_ALUGUEL],
      limit: 5000,
    });

    const linhas = linhasDeAluguel(rows);
    const vigencias = await listComparableSnapshots(db, {
      operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
    });
    const snapshotA = vigencias.find((v) => v.id === base);
    const snapshotB = vigencias.find((v) => v.id === comparada);
    /* A frota dos cartões sai de `frotaPorTipo` recortada no equipamento, e não
       do `entity_count` do snapshot, que fala da vigência inteira e pode trazer
       trecho. Ver `frotaDoEquipamento`. */
    const frotaPorEquipamento = await frotaPorTipo(db, resumo.id, comparada);
    const frota = frotaDoEquipamento(frotaPorEquipamento);

    let todas = linhas;
    if (comSemAlteracao && snapshotA && snapshotB) {
      const jaListadas = new Set(
        linhas.map((l) => `${l.entityLabel}${l.entityType}${l.attributeCode}`),
      );
      todas = [
        ...linhas,
        ...(await linhasIguais(snapshotA, snapshotB, jaListadas, contextoDoPar(snapshotB, req))),
      ];
    }

    res.json({
      changeSetId: resumo.id,
      base: {
        id: base,
        sourceLabel: snapshotA?.sourceLabel ?? null,
        effectiveDate: snapshotA?.effectiveDate ?? null,
      },
      comparada: {
        id: comparada,
        sourceLabel: snapshotB?.sourceLabel ?? null,
        effectiveDate: snapshotB?.effectiveDate ?? null,
      },
      /* O resumo é sempre das alterações, com ou sem o alternador ligado: as
         linhas iguais não mudam indicador nenhum — elas preenchem a tabela. */
      resumo: resumirAluguel(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavelDeAluguel(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeAluguel(linhas, frota),
      porTipo: Object.fromEntries(
        (["CAVALO", "CARRETA"] as const).map((tipo) => {
          const doTipo = linhas.filter((l) => l.entityType === tipo);
          const frotaDoTipo = frotaPorEquipamento[tipo] ?? {
            comparados: 0,
            novos: 0,
            ausentes: 0,
          };
          return [
            tipo,
            {
              resumo: resumirAluguel(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavelDeAluguel(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstadoDeAluguel(doTipo, frotaDoTipo),
            },
          ];
        }),
      ),
      linhas: todas,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Comparação de aluguel recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O total mensal de cada ponta **e a conferência da parcela** — as duas séries.
 *
 * `GET /aluguel/totais?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Separado da comparação porque a pergunta é outra: um total tem de incluir quem
 * **não** mudou, e o `change_set` não conhece esses veículos — que aqui são
 * quase todos.
 */
router.get("/aluguel/totais", async (req, res): Promise<void> => {
  const base = typeof req.query.base === "string" ? req.query.base : "";
  const comparada = typeof req.query.comparada === "string" ? req.query.comparada : "";
  if (!base || !comparada) {
    res.status(400).json({ error: "Informe base e comparada." });
    return;
  }
  for (const id of [base, comparada]) {
    await exigirOperacaoDoRecurso(req, "vigência", id, () => operacaoDoSnapshot(db, id));
  }

  const vigencias = await listComparableSnapshots(db, {
    operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
  });
  const pontas = [
    { ponta: "BASE" as const, snapshot: vigencias.find((v) => v.id === base) },
    { ponta: "COMPARADA" as const, snapshot: vigencias.find((v) => v.id === comparada) },
  ];

  const valores: ValorDeAluguel[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        const codeAluguel =
          entityType === "CARRETA"
            ? ALUGUEL?.codigo.CARRETA
            : ALUGUEL_DO_CAVALO?.codigo.CAVALO;
        if (!codeAluguel) continue;

        /* A parcela e as duas colunas do financiamento só existem na carreta —
           e é só nela que a conferência tem pergunta. */
        const codeParcela = entityType === "CARRETA" ? PARCELA?.codigo.CARRETA : undefined;
        const colunas = [
          codeAluguel,
          codeParcela,
          entityType === "CARRETA" ? AMORTIZACAO_DO_IMPLEMENTO : undefined,
          entityType === "CARRETA" ? JUROS_DO_IMPLEMENTO : undefined,
        ].filter((c): c is string => Boolean(c));

        const tabela = await getEntityTable(
          db,
          entityType,
          colunas,
          contextoDoPar(snapshot, req),
          snapshot.effectiveDate,
        );
        if (!tabela) continue;
        for (const linha of tabela.rows) {
          valores.push({
            ponta,
            entityType,
            entityLabel: linha.label,
            aluguel: comoNumero(linha.values[codeAluguel]?.value ?? null),
            parcela: codeParcela
              ? comoNumero(linha.values[codeParcela]?.value ?? null)
              : null,
            amortizacao:
              entityType === "CARRETA"
                ? comoNumero(linha.values[AMORTIZACAO_DO_IMPLEMENTO]?.value ?? null)
                : null,
            juros:
              entityType === "CARRETA"
                ? comoNumero(linha.values[JUROS_DO_IMPLEMENTO]?.value ?? null)
                : null,
          });
        }
      }
    }
  } catch (err) {
    /* A recusa de recorte é frase para quem opera, não 500 — a mesma tradução
       da rota de comparação. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais de aluguel recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({
    totais: totaisDeAluguelPorVigencia(valores),
    conferencias: conferenciaDoAluguel(valores),
  });
});

/** Texto do acervo virando número — e nulo continuando nulo, nunca zero. */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no aluguel.
 *
 * `GET /aluguel/candidatos?para=<snapshotId>`
 *
 * Irmã de `/finame/candidatos`, e sem uma linha de regra própria: o orçamento, o
 * reaproveitamento do que já foi comparado e o recorte por unidade e cobertura
 * moram em `lib/candidatas-do-par.ts`.
 */
router.get("/aluguel/candidatos", async (req, res, next): Promise<void> => {
  const para = typeof req.query.para === "string" ? req.query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);

  try {
    /* A resposta sai fora do teto: quando ela sai, a conexão já voltou inteira
       ao pool. A mesma ordem das outras rotas de candidatas. */
    const resposta = await comTetoDeRota(TETO_DE_CANDIDATAS_MS, (dbComTeto) =>
      candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_DETALHE_DE_ALUGUEL,
          /* Custo Fixo audita placa: cavalo e carreta, e mais nada. */
          entityTypes: TIPOS_DE_EQUIPAMENTO,
          numeros: (rows) => {
            const linhas = linhasDeAluguel(rows);
            /* A frota entra zerada: esta rota não publica "veículos
               comparados", só o que se moveu. */
            const { variaveisAlteradas, impacto } = resumirAluguel(linhas, {
              comparados: 0,
              novos: 0,
              ausentes: 0,
            });
            return {
              alteracoes: variaveisAlteradas,
              impacto: { baldes: baldesDeUmaNatureza(impacto.porPeriodicidade) },
            };
          },
        },
        { operacao, computedBy: "api:aluguel-candidatos" },
      ),
    );

    if ("naoEncontrada" in resposta) {
      res.status(404).json({ error: "Essa vigência não existe." });
      return;
    }
    res.json(resposta);
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Candidatas de aluguel recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
