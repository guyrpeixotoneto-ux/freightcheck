import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeKm,
  CODIGOS_DA_TABELA_DE_KM,
  CODIGOS_DO_DETALHE_DE_KM,
  COMPONENTES_DO_PRECO,
  composicaoDoPrecoPorKm,
  computeChangeSet,
  conferenciaDoKm,
  distribuicaoPorEstadoDeKm,
  getChangeSetForPair,
  getEntityTable,
  linhaDeKmSemAlteracao,
  linhasDeKm,
  listChanges,
  listComparableSnapshots,
  operacaoDoSnapshot,
  precoPorKmPorVigencia,
  resumirKm,
  TIPO_DO_KM_RODADO,
  type LinhaDeKm,
  type ValorDeKm,
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
 * AUDITORIA DE KM RODADO — o quilômetro contratado de cada trecho.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `km-rodado.ts` traduz; aqui só se costura os três e se responde. É a mesma
 * rota das quatro auditorias de rubrica sobre outro recorte — e sobre outro
 * **grão**: o tipo de entidade aqui é `TRECHO`, e não cavalo e carreta.
 *
 * Essa é a única diferença estrutural, e ela aparece em dois lugares: a leitura
 * completa percorre um tipo só, e o par de vigências precisa ser de vigências
 * que **cobrem trecho** — o que a tela garante antes de chamar
 * (`vigenciasQueCobrem`), e o motor garante de novo ao recusar coberturas
 * diferentes.
 */
const router: IRouter = Router();

/** Os códigos de contexto e de eixo, lidos do catálogo e nunca redigitados. */
const CODIGO_KM_CICLO = "trecho.km_rodado";
const CODIGO_KM_IDA = "trecho.km_ida";
const CODIGO_KM_VOLTA = "trecho.km_volta";
const CODIGO_VIAGENS = "trecho.previsao_viagens";
const CODIGO_ORIGEM = "trecho.origem";
const CODIGO_DESTINO = "trecho.destino";

/** Os trechos de cada lado, a partir do que o motor contou. */
function trechosDoPar(
  resumo: { entitiesAdded: number; entitiesRemoved: number },
  entityCountB: number,
): { comparados: number; novos: number; ausentes: number } {
  /*
    Presentes nas duas pontas = os trechos da vigência comparada menos os que
    entraram nela. Sai da contagem do próprio snapshot, e não do tamanho da
    lista de alterações: um trecho em que nada mudou não produz alteração
    nenhuma.
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
 * `getEntityTable` casadas por `entity_id` — e só entram as linhas em que os
 * dois lados existem e são iguais, porque as diferentes já vieram do motor.
 *
 * Um tipo só, e não dois: custo variável é por trecho.
 */
async function linhasIguais(
  snapshotA: { effectiveDate: string },
  snapshotB: { effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeKm[]> {
  const linhas: LinhaDeKm[] = [];
  const [a, b] = await Promise.all([
    getEntityTable(
      db,
      TIPO_DO_KM_RODADO,
      [...CODIGOS_DA_TABELA_DE_KM],
      recorte,
      snapshotA.effectiveDate,
    ),
    getEntityTable(
      db,
      TIPO_DO_KM_RODADO,
      [...CODIGOS_DA_TABELA_DE_KM],
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
    for (const code of CODIGOS_DA_TABELA_DE_KM) {
      const antes = anterior[code]?.value ?? null;
      const depois = linha.values[code]?.value ?? null;
      if (antes !== depois) continue;
      // Os dois lados ausentes não são "sem alteração": são ausência nas duas
      // pontas, e o motor já não escreveu linha para eles.
      if (antes === null) continue;
      const chave = `${linha.label}${TIPO_DO_KM_RODADO}${code}`;
      if (jaListadas.has(chave)) continue;
      const semAlteracao = linhaDeKmSemAlteracao({
        entityLabel: linha.label,
        entityType: TIPO_DO_KM_RODADO,
        attributeCode: code,
        valor: antes,
      });
      if (semAlteracao) linhas.push(semAlteracao);
    }
  }
  return linhas;
}

/**
 * O par de vigências, recortado no quilômetro do trecho.
 *
 * `GET /km-rodado/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência. Negar o sinal no cliente daria a variação errada.
 */
router.get("/km-rodado/comparacao", async (req, res, next): Promise<void> => {
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
    /*
      Reaproveita a comparação já calculada; só calcula quando ela não existe.
      É o mesmo caminho de Comparar, do Radar de Trechos e das quatro auditorias
      de rubrica — e é o que faz todas elas responderem o mesmo número para o
      mesmo par.
    */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:km-rodado" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_KM],
      limit: 5000,
    });

    const linhas = linhasDeKm(rows);
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
      /* O resumo é sempre das alterações, com ou sem o alternador ligado: as
         linhas iguais não mudam indicador nenhum — elas só preenchem a tabela. */
      resumo: resumirKm(linhas, trechos),
      alteracoesPorVariavel: alteracoesPorVariavelDeKm(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeKm(linhas, trechos),
      linhas: todas,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Comparação de km rodado recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O preço do quilômetro **e** a conferência do km — as três séries da leitura.
 *
 * Separado da comparação porque a pergunta é outra: um preço médio tem de
 * incluir quem **não** mudou, e o `change_set` não conhece esses trechos.
 *
 * As três vêm juntas porque saem da mesma linha de `getEntityTable`: as
 * distâncias, os nove R$/km e os nove R$/viagem do mesmo trecho. Separá-las
 * significaria ler a tabela inteira três vezes para responder a três metades da
 * mesma pergunta — e correr o risco de as três caírem em leituras diferentes,
 * que é justamente o que tornaria a conferência do km indefensável.
 */
router.get("/km-rodado/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeKm[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      const tabela = await getEntityTable(
        db,
        TIPO_DO_KM_RODADO,
        [...CODIGOS_DO_DETALHE_DE_KM],
        contextoDoPar(snapshot, req),
        snapshot.effectiveDate,
      );
      if (!tabela) continue;

      for (const linha of tabela.rows) {
        const ler = (code: string): number | null =>
          comoNumero(linha.values[code]?.value ?? null);
        const texto = (code: string): string | null => linha.values[code]?.value ?? null;

        const razoes: Record<string, number | null> = {};
        const viagens: Record<string, number | null> = {};
        for (const c of COMPONENTES_DO_PRECO) {
          razoes[c.chave] = ler(c.codigoRazao);
          viagens[c.chave] = ler(c.codigoViagem);
        }

        valores.push({
          ponta,
          entityLabel: linha.label,
          origem: texto(CODIGO_ORIGEM),
          destino: texto(CODIGO_DESTINO),
          kmCiclo: ler(CODIGO_KM_CICLO),
          kmIda: ler(CODIGO_KM_IDA),
          kmVolta: ler(CODIGO_KM_VOLTA),
          viagensPrevistas: ler(CODIGO_VIAGENS),
          razoes,
          viagens,
        });
      }
    }
  } catch (err) {
    /* Pedir o escopo do par é pedir um recorte que pode não ter contexto — e a
       recusa de recorte é frase para quem opera, não 500. A mesma tradução da
       rota de comparação, pela mesma razão. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({
    preco: precoPorKmPorVigencia(valores),
    composicao: composicaoDoPrecoPorKm(valores),
    conferencias: conferenciaDoKm(valores),
  });
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * O branco é testado antes de converter, e nesta rubrica isso decide um
 * veredito: `Number("")` é `0`, e um R$/km zero inventado pela conversão sairia
 * da conferência como "componente que o trecho não cobra" em vez de "coluna que
 * não veio".
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no KM Rodado.
 *
 * `GET /km-rodado/candidatos?para=<snapshotId>`
 *
 * A pergunta é a mesma das quatro rubricas de custo fixo, e a resposta sai pelo
 * mesmo caminho (`lib/candidatas-do-par.ts`): fixado o "Para", quanto cada
 * candidata produz contra ele. O que sobra aqui é o recorte do KM — quais
 * atributos ler, e como contar o que mudou neles.
 *
 * O grão é **trecho**, e não veículo. Isso não muda nada para esta rota: a
 * contagem e o impacto saem de `resumirKm`, que é a mesma função que a tela
 * chama depois do clique — e é o que faz o número do menu ser o número que o
 * clique entrega.
 */
router.get("/km-rodado/candidatos", async (req, res, next): Promise<void> => {
  const para = typeof req.query.para === "string" ? req.query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);

  try {
    /* A resposta sai **fora** do teto, pela razão que `/finame/candidatos`
       documenta: quando ela chega, a conexão já voltou inteira ao pool. */
    const resposta = await comTetoDeRota(TETO_DE_CANDIDATAS_MS, (dbComTeto) =>
      candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_DETALHE_DE_KM,
          numeros: (rows) => {
            const linhas = linhasDeKm(rows);
            /* Os trechos entram zerados de propósito: esta rota não publica
               "trechos comparados" — só o que se moveu. É a mesma recusa de
               `/finame/candidatos`, e pela mesma razão: derivar um indicador de
               frota a partir de um zero seria pior do que não tê-lo. */
            const { variaveisAlteradas, impacto } = resumirKm(linhas, {
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
        { operacao, computedBy: "api:km-rodado-candidatos" },
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
    req.log.warn({ err }, "Candidatas de KM Rodado recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
