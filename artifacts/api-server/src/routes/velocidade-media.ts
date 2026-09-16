import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeVelocidade,
  CODIGOS_DA_TABELA_DE_VELOCIDADE,
  CODIGOS_DO_DETALHE_DE_VELOCIDADE,
  computeChangeSet,
  distribuicaoPorEstadoDeVelocidade,
  getChangeSetForPair,
  getEntityTable,
  linhaDeVelocidadeSemAlteracao,
  linhasDeVelocidade,
  listChanges,
  listComparableSnapshots,
  operacaoDoSnapshot,
  particaoDoCicloPorVigencia,
  resumirVelocidade,
  tempoPagoPorVigencia,
  TIPO_DA_VELOCIDADE,
  velocidadePorVigencia,
  type LinhaDeVelocidade,
  type ValorDeVelocidade,
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
 * AUDITORIA DE VELOCIDADE MÉDIA — o tempo do ciclo do trecho.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `velocidade-media.ts` traduz; aqui só se costura os três e se responde. É a
 * mesma rota das cinco auditorias anteriores, e sobre o mesmo grão da de Km
 * Rodado: `TRECHO`.
 */
const router: IRouter = Router();

/** Os códigos que a leitura das duas pontas precisa, lidos do catálogo. */
const CODIGO_VELOCIDADE = "trecho.velocidade_media_km_h";
const CODIGO_CICLO = "trecho.carga_horaria_por_trajeto_minuto";
const CODIGO_TRAJETO = "trecho.tempo_trajeto_fabrica_cd_minuto";
const CODIGO_TMA_ORIGEM = "trecho.tempo_interno_origem";
const CODIGO_TMA_DESTINO = "trecho.tempo_interno_destino";
const CODIGO_REFEICAO = "trecho.tempo_refeicao_minuto";
const CODIGO_KM_CICLO = "trecho.km_rodado";
const CODIGO_KM_IDA = "trecho.km_ida";
const CODIGO_CICLO_LUCRO = "trecho.carga_horaria_por_trajeto_minuto_lucro";
const CODIGO_TMA_ORIGEM_LUCRO = "trecho.tempo_interno_origem_lucro";
const CODIGO_TMA_DESTINO_LUCRO = "trecho.tempo_interno_destino_lucro";
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
 * `entity_id`, e só entram as linhas em que os dois lados existem e são iguais.
 */
async function linhasIguais(
  snapshotA: { effectiveDate: string },
  snapshotB: { effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeVelocidade[]> {
  const linhas: LinhaDeVelocidade[] = [];
  const [a, b] = await Promise.all([
    getEntityTable(
      db,
      TIPO_DA_VELOCIDADE,
      [...CODIGOS_DA_TABELA_DE_VELOCIDADE],
      recorte,
      snapshotA.effectiveDate,
    ),
    getEntityTable(
      db,
      TIPO_DA_VELOCIDADE,
      [...CODIGOS_DA_TABELA_DE_VELOCIDADE],
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
    for (const code of CODIGOS_DA_TABELA_DE_VELOCIDADE) {
      const antes = anterior[code]?.value ?? null;
      const depois = linha.values[code]?.value ?? null;
      if (antes !== depois) continue;
      // Os dois lados ausentes não são "sem alteração": são ausência nas duas
      // pontas, e o motor já não escreveu linha para eles.
      if (antes === null) continue;
      const chave = `${linha.label}${TIPO_DA_VELOCIDADE}${code}`;
      if (jaListadas.has(chave)) continue;
      const semAlteracao = linhaDeVelocidadeSemAlteracao({
        entityLabel: linha.label,
        entityType: TIPO_DA_VELOCIDADE,
        attributeCode: code,
        valor: antes,
      });
      if (semAlteracao) linhas.push(semAlteracao);
    }
  }
  return linhas;
}

/**
 * O par de vigências, recortado no tempo do trecho.
 *
 * `GET /velocidade-media/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 */
router.get("/velocidade-media/comparacao", async (req, res, next): Promise<void> => {
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
      (await computeChangeSet(db, base, comparada, { computedBy: "api:velocidade-media" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_VELOCIDADE],
      limit: 5000,
    });

    const linhas = linhasDeVelocidade(rows);
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
      resumo: resumirVelocidade(linhas, trechos),
      alteracoesPorVariavel: alteracoesPorVariavelDeVelocidade(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeVelocidade(linhas, trechos),
      linhas: todas,
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Comparação de velocidade média recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * A partição do ciclo, a conferência da velocidade e a folga do tempo pago.
 *
 * Separado da comparação porque a pergunta é outra: uma média tem de incluir
 * quem **não** mudou, e o `change_set` não conhece esses trechos.
 *
 * As três vêm juntas porque saem da mesma linha de `getEntityTable` — o ciclo, as
 * três paradas, o km e as duas versões do tempo do mesmo trecho. Separá-las
 * significaria ler a tabela inteira três vezes para responder a três metades da
 * mesma pergunta, e correr o risco de as três caírem em leituras diferentes.
 */
router.get("/velocidade-media/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeVelocidade[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      const tabela = await getEntityTable(
        db,
        TIPO_DA_VELOCIDADE,
        [...CODIGOS_DO_DETALHE_DE_VELOCIDADE],
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
          velocidade: ler(CODIGO_VELOCIDADE),
          ciclo: ler(CODIGO_CICLO),
          trajeto: ler(CODIGO_TRAJETO),
          tmaOrigem: ler(CODIGO_TMA_ORIGEM),
          tmaDestino: ler(CODIGO_TMA_DESTINO),
          refeicao: ler(CODIGO_REFEICAO),
          kmCiclo: ler(CODIGO_KM_CICLO),
          kmIda: ler(CODIGO_KM_IDA),
          cicloLucro: ler(CODIGO_CICLO_LUCRO),
          tmaOrigemLucro: ler(CODIGO_TMA_ORIGEM_LUCRO),
          tmaDestinoLucro: ler(CODIGO_TMA_DESTINO_LUCRO),
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
    particao: particaoDoCicloPorVigencia(valores),
    velocidade: velocidadePorVigencia(valores),
    tempoPago: tempoPagoPorVigencia(valores),
  });
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * Nesta rubrica o branco decide uma velocidade: `Number("")` é `0`, e uma
 * refeição zero inventada pela conversão inflaria o tempo rodando e produziria
 * uma velocidade alta e falsa, que é o número que esta tela existe para não
 * mostrar.
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para", na Velocidade Média.
 *
 * `GET /velocidade-media/candidatos?para=<snapshotId>`
 *
 * Mesma pergunta e mesmo caminho das outras candidatas
 * (`lib/candidatas-do-par.ts`). O que sobra aqui é o recorte da velocidade.
 *
 * **O número do menu é de dinheiro, e não de minuto.** `impactoDeVelocidade`
 * só soma linha de medida `DINHEIRO`, e se recusa a virar minuto em R$ — o
 * tempo vira custo pelo fator motorista e pela jornada, que é outra conta e
 * depende de quantas viagens a operação rodou. Então uma candidata em que só
 * tempos se moveram sai com `R$ 0,00` **e** a contagem de alterações: o zero é
 * verdadeiro (nenhum dinheiro mudou nesta rubrica) e a contagem ao lado dele é
 * o que diz que houve movimento. Ler o zero sozinho seria ler metade da linha,
 * e é por isso que a contagem nunca sai daqui.
 */
router.get("/velocidade-media/candidatos", async (req, res, next): Promise<void> => {
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
          attributeCodes: CODIGOS_DO_DETALHE_DE_VELOCIDADE,
          numeros: (rows) => {
            const linhas = linhasDeVelocidade(rows);
            /* Os trechos entram zerados: esta rota não publica "trechos
               comparados" — só o que se moveu. A mesma recusa das outras. */
            const { variaveisAlteradas, impacto } = resumirVelocidade(linhas, {
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
        { operacao, computedBy: "api:velocidade-media-candidatos" },
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
    req.log.warn({ err }, "Candidatas de Velocidade Média recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
