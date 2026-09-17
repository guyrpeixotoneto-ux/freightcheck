import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeConsumo,
  CODIGOS_DA_TABELA_DE_CONSUMO,
  CODIGOS_DO_DETALHE_DE_CONSUMO,
  computeChangeSet,
  conferenciaDoConsumo,
  distribuicaoPorEstadoDeConsumo,
  getChangeSetForPair,
  getEntityTable,
  linhaDeConsumoSemAlteracao,
  linhasDeConsumo,
  listChanges,
  listComparableSnapshots,
  operacaoDoSnapshot,
  rendimentoPorVigencia,
  resumirConsumo,
  TIPO_DO_CONSUMO,
  type LinhaDeConsumo,
  type ValorDeConsumo,
  type RequestedContext,
} from "@workspace/comparison";
import {
  baldesDoImpacto,
  candidatasDoPar,
  TETO_DE_CANDIDATAS_MS,
} from "../lib/candidatas-do-par";
import { classificarFalha } from "../lib/classificar-falha";
import { comTetoDeRota } from "../lib/timeout-de-rota";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { contextoDoPar } from "../lib/recorte-do-par";

/**
 * AUDITORIA DE CONSUMO — o rendimento do trecho, e o preço do litro que ele
 * embute.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `consumo.ts` traduz; aqui só se costura os três e se responde. O grão é
 * `TRECHO`, como no Km Rodado e no Pneu: quem gasta diesel é o percurso.
 *
 * As seis colunas de combustível do `Modelo_Cavalo` **não** são lidas aqui —
 * elas estão nomeadas em `COLUNAS_DE_EQUIPAMENTO_DE_CONSUMO`, no núcleo, e a
 * tela as publica como aviso. São o modelo de consumo do veículo; o que
 * precifica o frete é o rendimento do trecho.
 *
 * ---------------------------------------------------------------------------
 * O preço do litro sai daqui, e não do banco
 * ---------------------------------------------------------------------------
 * Nenhuma coluna do acervo declara quanto custa o litro de diesel. Ele é
 * `R$/km × km/l`, e quem faz essa conta é `conferenciaDoConsumo`, no núcleo, a
 * partir das duas colunas que o trecho declara. Esta rota entrega as duas, e
 * nunca a conta: um preço do litro calculado aqui e outro calculado na tela
 * seriam dois números com o mesmo nome.
 */
const router: IRouter = Router();

/** Os códigos que a leitura ponta a ponta precisa, lidos do catálogo. */
const CODIGO_KM_LITRO = "trecho.diesel_consumo_km_l";
const CODIGO_CONSUMO_AJUSTADO = "trecho.consumo_diesel_ajustado";
const CODIGO_DIESEL_REAIS_KM = "trecho.diesel_consumo_diesel_reais_km";
const CODIGO_FRETE_REAIS_KM = "trecho.frete_reais_km_diesel";
const CODIGO_FRETE_REAIS_VIAGEM = "trecho.frete_reais_viagem_diesel";
const CODIGO_PERDA_KM = "trecho.percentual_perda_km";
const CODIGO_PERDA_REGIAO = "trecho.percentual_perda_regiao";
const CODIGO_PERDA_DESCARTAVEL = "trecho.percentual_perda_descartavel";
const CODIGO_KM_CICLO = "trecho.km_rodado";
const CODIGO_ORIGEM = "trecho.origem";
const CODIGO_DESTINO = "trecho.destino";

/** Os trechos de cada lado, a partir do que o motor contou. */
function trechosDoPar(
  resumo: { entitiesAdded: number; entitiesRemoved: number },
  entityCountB: number,
): { comparados: number; novos: number; ausentes: number } {
  return {
    comparados: Math.max(0, entityCountB - resumo.entitiesAdded),
    novos: resumo.entitiesAdded,
    ausentes: resumo.entitiesRemoved,
  };
}

/**
 * As linhas "sem alteração" — a leitura completa que o alternador liga.
 *
 * Desligado por padrão: a pergunta da tela é o que mudou, e o `change_set` só
 * guarda isso. Ligado, são duas leituras de `getEntityTable` casadas por
 * `entity_id` — e só entram as linhas em que os dois lados existem e são iguais.
 */
async function linhasIguais(
  snapshotA: { effectiveDate: string },
  snapshotB: { effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeConsumo[]> {
  const linhas: LinhaDeConsumo[] = [];
  const [a, b] = await Promise.all([
    getEntityTable(
      db,
      TIPO_DO_CONSUMO,
      [...CODIGOS_DA_TABELA_DE_CONSUMO],
      recorte,
      snapshotA.effectiveDate,
    ),
    getEntityTable(
      db,
      TIPO_DO_CONSUMO,
      [...CODIGOS_DA_TABELA_DE_CONSUMO],
      recorte,
      snapshotB.effectiveDate,
    ),
  ]);
  if (!a || !b) return linhas;

  const naBase = new Map<string, (typeof a.rows)[number]["values"]>();
  for (const linha of a.rows) naBase.set(linha.entityId, linha.values);

  for (const linha of b.rows) {
    const anterior = naBase.get(linha.entityId);
    if (!anterior) continue;
    for (const code of CODIGOS_DA_TABELA_DE_CONSUMO) {
      const antes = anterior[code]?.value ?? null;
      const depois = linha.values[code]?.value ?? null;
      if (antes !== depois) continue;
      // Os dois lados ausentes não são "sem alteração": são ausência nas duas
      // pontas, e o motor já não escreveu linha para eles.
      if (antes === null) continue;
      const chave = `${linha.label}${TIPO_DO_CONSUMO}${code}`;
      if (jaListadas.has(chave)) continue;
      const semAlteracao = linhaDeConsumoSemAlteracao({
        entityLabel: linha.label,
        entityType: TIPO_DO_CONSUMO,
        attributeCode: code,
        valor: antes,
      });
      if (semAlteracao) linhas.push(semAlteracao);
    }
  }
  return linhas;
}

/**
 * O par de vigências, recortado no consumo do trecho.
 *
 * `GET /consumo/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência.
 */
router.get("/consumo/comparacao", async (req, res, next): Promise<void> => {
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
      (await computeChangeSet(db, base, comparada, { computedBy: "api:consumo" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_CONSUMO],
      limit: 5000,
    });

    const linhas = linhasDeConsumo(rows);
    const vigencias = await listComparableSnapshots(db, {
      operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
    });
    const snapshotA = vigencias.find((v) => v.id === base);
    const snapshotB = vigencias.find((v) => v.id === comparada);
    const trechos = trechosDoPar(resumo, snapshotB?.entityCount ?? 0);

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
      /* O resumo é sempre das alterações, com ou sem o alternador ligado. */
      resumo: resumirConsumo(linhas, trechos),
      alteracoesPorVariavel: alteracoesPorVariavelDeConsumo(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeConsumo(linhas, trechos),
      linhas: todas,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Comparação de consumo recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O rendimento **e** a conferência do diesel — as duas séries da mesma leitura.
 *
 * Separado da comparação porque a pergunta é outra: uma média tem de incluir
 * quem **não** mudou, e o `change_set` não conhece esses trechos.
 *
 * E há um motivo a mais aqui, que não existe nas outras rubricas: o preço do
 * litro de referência é a **mediana entre os trechos da vigência**. Ela não pode
 * sair de uma lista de alterações — uma mediana calculada só sobre os trechos que
 * mudaram seria a mediana dos que mudaram, e não a da tabela.
 */
router.get("/consumo/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeConsumo[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      const tabela = await getEntityTable(
        db,
        TIPO_DO_CONSUMO,
        [...CODIGOS_DO_DETALHE_DE_CONSUMO],
        contextoDoPar(snapshot, req),
        snapshot.effectiveDate,
      );
      if (!tabela) continue;

      for (const linha of tabela.rows) {
        const ler = (code: string): number | null =>
          comoNumero(linha.values[code]?.value ?? null);
        const texto = (code: string): string | null => linha.values[code]?.value ?? null;

        valores.push({
          ponta,
          entityLabel: linha.label,
          origem: texto(CODIGO_ORIGEM),
          destino: texto(CODIGO_DESTINO),
          kmLitro: ler(CODIGO_KM_LITRO),
          consumoAjustado: ler(CODIGO_CONSUMO_AJUSTADO),
          dieselReaisKm: ler(CODIGO_DIESEL_REAIS_KM),
          freteReaisKmDiesel: ler(CODIGO_FRETE_REAIS_KM),
          freteReaisViagemDiesel: ler(CODIGO_FRETE_REAIS_VIAGEM),
          perdaKm: ler(CODIGO_PERDA_KM),
          perdaRegiao: ler(CODIGO_PERDA_REGIAO),
          perdaDescartavel: ler(CODIGO_PERDA_DESCARTAVEL),
          kmCiclo: ler(CODIGO_KM_CICLO),
        });
      }
    }
  } catch (err) {
    /* A recusa de recorte é frase para quem opera, não 500 — a mesma tradução da
       rota de comparação. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais de consumo recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({
    rendimento: rendimentoPorVigencia(valores),
    conferencias: conferenciaDoConsumo(valores),
  });
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * `Number("")` é `0`, e um km/l zero inventado pela conversão sairia da conta do
 * preço do litro como uma divisão por zero disfarçada — ou, pior, como um
 * rendimento nulo que a média da vigência engoliria sem avisar.
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no Consumo.
 *
 * `GET /consumo/candidatos?para=<snapshotId>`
 *
 * A pergunta é a mesma das demais rubricas, e a resposta sai pelo mesmo caminho
 * (`lib/candidatas-do-par.ts`). O que sobra aqui é o recorte do consumo.
 */
router.get("/consumo/candidatos", async (req, res, next): Promise<void> => {
  const para = typeof req.query.para === "string" ? req.query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);

  try {
    const resposta = await comTetoDeRota(TETO_DE_CANDIDATAS_MS, (dbComTeto) =>
      candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_DETALHE_DE_CONSUMO,
          numeros: (rows) => {
            const linhas = linhasDeConsumo(rows);
            /* Os trechos entram zerados: esta rota não publica "trechos
               comparados" — só o que se moveu. */
            const { variaveisAlteradas, impacto } = resumirConsumo(linhas, {
              comparados: 0,
              novos: 0,
              ausentes: 0,
            });
            return {
              alteracoes: variaveisAlteradas,
              impacto: { baldes: baldesDoImpacto(impacto.porPeriodicidade) },
            };
          },
        },
        { operacao, computedBy: "api:consumo-candidatos" },
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
    req.log.warn({ err }, "Candidatas de Consumo recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
