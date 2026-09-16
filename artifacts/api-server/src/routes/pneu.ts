import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDePneu,
  CODIGOS_DA_TABELA_DE_PNEU,
  CODIGOS_DO_DETALHE_DE_PNEU,
  computeChangeSet,
  conferenciaDoPneu,
  custoDoPneuPorVigencia,
  distribuicaoPorEstadoDePneu,
  getChangeSetForPair,
  getEntityTable,
  linhaDePneuSemAlteracao,
  linhasDePneu,
  listChanges,
  listComparableSnapshots,
  operacaoDoSnapshot,
  reconstituicaoPorVigencia,
  resumirPneu,
  TIPO_DO_PNEU,
  type LinhaDePneu,
  type ValorDePneu,
  type RequestedContext,
} from "@workspace/comparison";
import {
  baldesDeUmaNatureza,
  candidatasDoPar,
  TETO_DE_CANDIDATAS_MS,
} from "../lib/candidatas-do-par";
import { classificarFalha } from "../lib/classificar-falha";
import { comTetoDeRota } from "../lib/timeout-de-rota";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { contextoDoPar } from "../lib/recorte-do-par";

/**
 * AUDITORIA DE PNEU — o que a carcaça custa por quilômetro.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `pneu.ts` traduz; aqui só se costura os três e se responde. É a mesma rota da
 * Auditoria de Km Rodado sobre outro recorte — e sobre o mesmo grão: o tipo de
 * entidade é `TRECHO`, porque o pneu com dado deste acervo é do percurso, e não
 * do equipamento.
 *
 * As três colunas de pneu que o equipamento declara (`cavalo.valor_pneu`,
 * `carreta.valor_pneus`, `pneu_medida_empurrada`) **não** são lidas aqui. Elas
 * estão nomeadas em `COLUNAS_DE_EQUIPAMENTO_DE_PNEU`, no núcleo, e a tela as
 * publica como aviso: são de outro grão, e zeradas em 100% do acervo.
 */
const router: IRouter = Router();

/** Os códigos que a leitura ponta a ponta precisa, lidos do catálogo. */
const CODIGO_CUSTO_REAIS_KM = "trecho.pneu_custo_pneus_camaras_reais_km";
const CODIGO_FRETE_REAIS_KM = "trecho.frete_reais_km_pneu";
const CODIGO_FRETE_REAIS_VIAGEM = "trecho.frete_reais_viagem_pneus";
const CODIGO_QUANTIDADE = "trecho.pneu_quantidade_de_pneus";
const CODIGO_VALOR_MEDIO_PNEUS = "trecho.pneu_valor_medio_pneus";
const CODIGO_VALOR_RECAPAGEM = "trecho.pneu_valor_medio_da_recapagem";
const CODIGO_VENDA_CARCACA = "trecho.pneu_valor_de_venda_da_carcaca";
const CODIGO_VIDA_UTIL = "trecho.pneu_vidautil_pneu";
const CODIGO_VIDA_AJUSTADA = "trecho.vidautil_ajustada_pneu";
const CODIGO_KM_CICLO = "trecho.km_rodado";
const CODIGO_ORIGEM = "trecho.origem";
const CODIGO_DESTINO = "trecho.destino";

/** Os trechos de cada lado, a partir do que o motor contou. */
function trechosDoPar(
  resumo: { entitiesAdded: number; entitiesRemoved: number },
  entityCountB: number,
): { comparados: number; novos: number; ausentes: number } {
  /*
    Presentes nas duas pontas = os trechos da vigência comparada menos os que
    entraram nela. Sai da contagem do próprio snapshot, e não do tamanho da lista
    de alterações: um trecho em que nada mudou não produz alteração nenhuma.
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
 */
async function linhasIguais(
  snapshotA: { effectiveDate: string },
  snapshotB: { effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDePneu[]> {
  const linhas: LinhaDePneu[] = [];
  const [a, b] = await Promise.all([
    getEntityTable(
      db,
      TIPO_DO_PNEU,
      [...CODIGOS_DA_TABELA_DE_PNEU],
      recorte,
      snapshotA.effectiveDate,
    ),
    getEntityTable(
      db,
      TIPO_DO_PNEU,
      [...CODIGOS_DA_TABELA_DE_PNEU],
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
    for (const code of CODIGOS_DA_TABELA_DE_PNEU) {
      const antes = anterior[code]?.value ?? null;
      const depois = linha.values[code]?.value ?? null;
      if (antes !== depois) continue;
      // Os dois lados ausentes não são "sem alteração": são ausência nas duas
      // pontas, e o motor já não escreveu linha para eles.
      if (antes === null) continue;
      const chave = `${linha.label}${TIPO_DO_PNEU}${code}`;
      if (jaListadas.has(chave)) continue;
      const semAlteracao = linhaDePneuSemAlteracao({
        entityLabel: linha.label,
        entityType: TIPO_DO_PNEU,
        attributeCode: code,
        valor: antes,
      });
      if (semAlteracao) linhas.push(semAlteracao);
    }
  }
  return linhas;
}

/**
 * O par de vigências, recortado no pneu do trecho.
 *
 * `GET /pneu/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência. Negar o sinal no cliente daria a variação errada.
 */
router.get("/pneu/comparacao", async (req, res, next): Promise<void> => {
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
      Reaproveita a comparação já calculada; só calcula quando ela não existe. É o
      mesmo caminho de Comparar, do Radar de Trechos e das demais auditorias de
      rubrica — e é o que faz todas elas responderem o mesmo número para o mesmo
      par.
    */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:pneu" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_PNEU],
      limit: 5000,
    });

    const linhas = linhasDePneu(rows);
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
      resumo: resumirPneu(linhas, trechos),
      alteracoesPorVariavel: alteracoesPorVariavelDePneu(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDePneu(linhas, trechos),
      linhas: todas,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Comparação de pneu recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O custo do pneu, a reconstituição e a conferência — as três séries da mesma
 * leitura.
 *
 * Separado da comparação porque a pergunta é outra: uma média tem de incluir
 * quem **não** mudou, e o `change_set` não conhece esses trechos.
 *
 * As três vêm juntas porque saem da mesma linha de `getEntityTable`: o custo
 * apurado, a parcela do preço, os cinco componentes e o km do ciclo do mesmo
 * trecho. Separá-las significaria ler a tabela três vezes para responder a três
 * metades da mesma pergunta — e correr o risco de as três caírem em leituras
 * diferentes, que é o que tornaria a conferência indefensável.
 */
router.get("/pneu/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDePneu[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      const tabela = await getEntityTable(
        db,
        TIPO_DO_PNEU,
        [...CODIGOS_DO_DETALHE_DE_PNEU],
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
          custoReaisKm: ler(CODIGO_CUSTO_REAIS_KM),
          freteReaisKm: ler(CODIGO_FRETE_REAIS_KM),
          freteReaisViagem: ler(CODIGO_FRETE_REAIS_VIAGEM),
          quantidade: ler(CODIGO_QUANTIDADE),
          valorMedioPneus: ler(CODIGO_VALOR_MEDIO_PNEUS),
          valorMedioRecapagem: ler(CODIGO_VALOR_RECAPAGEM),
          valorVendaCarcaca: ler(CODIGO_VENDA_CARCACA),
          vidaUtil: ler(CODIGO_VIDA_UTIL),
          vidaUtilAjustada: ler(CODIGO_VIDA_AJUSTADA),
          kmCiclo: ler(CODIGO_KM_CICLO),
        });
      }
    }
  } catch (err) {
    /* Pedir o escopo do par é pedir um recorte que pode não ter contexto — e a
       recusa de recorte é frase para quem opera, não 500. A mesma tradução da
       rota de comparação, pela mesma razão. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais de pneu recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({
    custo: custoDoPneuPorVigencia(valores),
    reconstituicao: reconstituicaoPorVigencia(valores),
    conferencias: conferenciaDoPneu(valores),
  });
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * O branco é testado antes de converter, e nesta rubrica isso decide um
 * veredito: `Number("")` é `0`, e um R$/km zero inventado pela conversão sairia
 * da conferência como "trecho que não cobra pneu" em vez de "coluna que não
 * veio".
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no Pneu.
 *
 * `GET /pneu/candidatos?para=<snapshotId>`
 *
 * A pergunta é a mesma das demais rubricas, e a resposta sai pelo mesmo caminho
 * (`lib/candidatas-do-par.ts`): fixado o "Para", quanto cada candidata produz
 * contra ele. O que sobra aqui é o recorte do pneu — quais atributos ler, e como
 * contar o que mudou neles.
 */
router.get("/pneu/candidatos", async (req, res, next): Promise<void> => {
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
          attributeCodes: CODIGOS_DO_DETALHE_DE_PNEU,
          numeros: (rows) => {
            const linhas = linhasDePneu(rows);
            /* Os trechos entram zerados de propósito: esta rota não publica
               "trechos comparados" — só o que se moveu. É a mesma recusa de
               `/km-rodado/candidatos`, e pela mesma razão. */
            const { variaveisAlteradas, impacto } = resumirPneu(linhas, {
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
        { operacao, computedBy: "api:pneu-candidatos" },
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
    req.log.warn({ err }, "Candidatas de Pneu recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
