import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeManutencao,
  CODIGOS_DA_TABELA_DE_MANUTENCAO,
  CODIGOS_DO_DETALHE_DE_MANUTENCAO,
  computeChangeSet,
  conferenciaDaOrigem,
  distribuicaoPorEstadoDeManutencao,
  getChangeSetForPair,
  getEntityTable,
  linhaDeManutencaoSemAlteracao,
  linhasDeManutencao,
  listChanges,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirManutencao,
  totaisDeManutencaoPorVigencia,
  variavelDeManutencaoDoCodigo,
  VARIAVEIS_DE_MANUTENCAO,
  type LinhaDeManutencao,
  type ValorDeManutencao,
  type RequestedContext,
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
 * AUDITORIA DE MANUTENÇÃO E PNEU — o que se paga por rodar.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `manutencao.ts` traduz; aqui só se costura os três e se responde. É a mesma
 * rota das auditorias de custo fixo sobre outro recorte, e é de propósito que
 * seja.
 *
 * ---------------------------------------------------------------------------
 * O que `/totais` devolve, e o que ele se recusa a devolver
 * ---------------------------------------------------------------------------
 * Devolve a **média** do R$/km por ponta e por tipo, e a conferência de onde o
 * R$/km vem. Não devolve um total em reais: R$/km só vira dinheiro multiplicado
 * por quilômetro rodado, e o quilômetro é de outra leitura, de outro grão e de
 * outra vigência. Fazer essa conta aqui produziria um "custo de manutenção" que
 * nenhuma outra tela do produto conseguiria reproduzir.
 */
const router: IRouter = Router();

/** Os veículos de cada lado, a partir do que o motor contou. */
function frotaDoPar(
  resumo: { entitiesAdded: number; entitiesRemoved: number },
  entityCountB: number,
): { comparados: number; novos: number; ausentes: number } {
  /*
    Presentes nas duas pontas = os ativos da vigência comparada menos os que
    entraram nela. Sai da contagem do próprio snapshot, e não do tamanho da
    lista de alterações: um veículo em que nada mudou não produz alteração
    nenhuma, e derivar "comparados" da lista daria zero justamente na comparação
    em que nada se moveu.
  */
  return {
    comparados: Math.max(0, entityCountB - resumo.entitiesAdded),
    novos: resumo.entitiesAdded,
    ausentes: resumo.entitiesRemoved,
  };
}

/**
 * As linhas "sem alteração" — a leitura completa que o alternador liga.
 *
 * Desligado por padrão, e não por economia de bytes: a pergunta da tela é o que
 * mudou, e o `change_set` só guarda isso. Ligado, são duas leituras de
 * `getEntityTable` (uma por vigência) casadas por `entity_id`.
 */
async function linhasIguais(
  snapshotA: { id: string; effectiveDate: string },
  snapshotB: { id: string; effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeManutencao[]> {
  const linhas: LinhaDeManutencao[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA_DE_MANUTENCAO.filter(
      (c) => variavelDeManutencaoDoCodigo(c)?.codigo[entityType] === c,
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
        // Os dois lados ausentes não são "sem alteração": são ausência nas
        // duas pontas, e o motor já não escreveu linha para eles.
        if (antes === null) continue;
        const chave = `${linha.label}${entityType}${code}`;
        if (jaListadas.has(chave)) continue;
        const semAlteracao = linhaDeManutencaoSemAlteracao({
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
 * O par de vigências, recortado na manutenção.
 *
 * `GET /manutencao/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 */
router.get("/manutencao/comparacao", async (req, res, next): Promise<void> => {
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
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:manutencao" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_MANUTENCAO],
      limit: 5000,
    });

    const linhas = linhasDeManutencao(rows);
    const vigencias = await listComparableSnapshots(db, {
      operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
    });
    const snapshotA = vigencias.find((v) => v.id === base);
    const snapshotB = vigencias.find((v) => v.id === comparada);
    const frota = frotaDoPar(resumo, snapshotB?.entityCount ?? 0);
    const frotaPorEquipamento = await frotaPorTipo(db, resumo.id, comparada);

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
      resumo: resumirManutencao(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavelDeManutencao(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeManutencao(linhas, frota),
      /*
        Os mesmos três agregados, um por tipo de equipamento. Aqui a aba Carreta
        só tem o pneu — e o pneu é zero em toda parte —, o que é o dado: a
        carreta não declara coluna de manutenção nenhuma.
      */
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
              resumo: resumirManutencao(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavelDeManutencao(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstadoDeManutencao(doTipo, frotaDoTipo),
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
    req.log.warn({ err }, "Comparação de manutenção recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O R$/km médio de cada ponta **e a conferência da origem** — as duas séries.
 *
 * Separado da comparação porque a pergunta é outra: uma média tem de incluir
 * quem **não** mudou, e o `change_set` não conhece esses veículos.
 *
 * A mesma leitura serve às duas respostas: o R$/km resolvido, o do BID e o do
 * contrato do mesmo caminhão saem da mesma linha de `getEntityTable`.
 */
router.get("/manutencao/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeManutencao[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        /* Os códigos saem do catálogo, e não de uma segunda lista aqui: a
           decisão de quais colunas compõem esta rubrica é uma só, e mora em
           `manutencao.ts`. */
        const doTipo = new Map<string, string>();
        for (const v of VARIAVEIS_DE_MANUTENCAO) {
          const code = v.codigo[entityType];
          if (code) doTipo.set(v.chave, code);
        }
        if (doTipo.size === 0) continue;

        const tabela = await getEntityTable(
          db,
          entityType,
          [...doTipo.values()],
          contextoDoPar(snapshot, req),
          snapshot.effectiveDate,
        );
        if (!tabela) continue;

        const ler = (linha: (typeof tabela.rows)[number], code: string | undefined) =>
          code ? comoNumero(linha.values[code]?.value ?? null) : null;

        for (const linha of tabela.rows) {
          valores.push({
            ponta,
            entityType,
            entityLabel: linha.label,
            reaisKm: ler(linha, doTipo.get("reais_km")),
            bid: ler(linha, doTipo.get("bid")),
            contrato: ler(linha, doTipo.get("contrato")),
            vidaMeses: ler(linha, doTipo.get("vida_meses")),
            freeMaintenance: ler(linha, doTipo.get("free_maintenance")),
            pneu: ler(linha, doTipo.get("pneu")),
          });
        }
      }
    }
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais de manutenção recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({
    totais: totaisDeManutencaoPorVigencia(valores),
    origens: conferenciaDaOrigem(valores),
  });
});

/** Texto do acervo virando número — e nulo continuando nulo, nunca zero. */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, nesta rubrica.
 *
 * `GET /manutencao/candidatos?para=<snapshotId>`
 *
 * Irmã de `/ipva/candidatos`, e deliberadamente sem uma linha de regra própria:
 * o orçamento, o reaproveitamento do que já foi comparado e o recorte por
 * unidade e cobertura moram em `lib/candidatas-do-par.ts`.
 *
 * O número que ela publica no menu é a **contagem de alterações**, e não um
 * impacto em reais: nesta rubrica o balde de reais vem quase sempre vazio, e um
 * menu que mostrasse R$ 0,00 ao lado de uma vigência em que meia frota mudou de
 * R$/km diria o contrário do que aconteceu.
 */
router.get("/manutencao/candidatos", async (req, res, next): Promise<void> => {
  const para = typeof req.query.para === "string" ? req.query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);

  try {
    /*
      A resposta sai **fora** do teto, e não de dentro dele: quando ela sai, a
      conexão já voltou inteira ao pool. Ver a nota longa em `ipva.ts`, que é
      onde este cuidado foi descoberto, e `finame-candidatos.test.ts`, que o
      afere sobre a rota irmã — a ordem aqui é a mesma.
    */
    const resposta = await comTetoDeRota(TETO_DE_CANDIDATAS_MS, (dbComTeto) =>
      candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_DETALHE_DE_MANUTENCAO,
          numeros: (rows) => {
            const linhas = linhasDeManutencao(rows);
            /* A frota entra zerada: esta rota não publica "veículos
               comparados", só o que se moveu. */
            const { variaveisAlteradas, impacto } = resumirManutencao(linhas, {
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
        { operacao, computedBy: "api:manutencao-candidatos" },
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
    req.log.warn({ err }, "Candidatas de manutenção recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
