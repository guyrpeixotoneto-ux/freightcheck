import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeLucroFixo,
  CODIGOS_DA_TABELA_DE_LUCRO_FIXO,
  CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
  coexistencias,
  computeChangeSet,
  distribuicaoPorEstadoDeLucroFixo,
  getChangeSetForPair,
  getEntityTable,
  linhaDeLucroFixoSemAlteracao,
  linhasDeLucroFixo,
  listChanges,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirLucroFixo,
  totaisDeLucroFixoPorVigencia,
  variavelDeLucroFixoDoCodigo,
  VARIAVEIS_DE_LUCRO_FIXO,
  type LinhaDeLucroFixo,
  type ValorDeLucroFixo,
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
 * AUDITORIA DE LUCRO FIXO — o recorte da remuneração entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `lucro-fixo.ts` traduz; aqui só se costura os três e se responde. É a terceira
 * rota com esta forma — FINAME, IPVA e agora esta —, e é de propósito que sejam
 * iguais: uma rota que fizesse conta própria seria a quarta régua da mesma
 * pergunta, e a que ficasse para trás mostraria um impacto diferente do de
 * Alterações para o mesmo par de vigências.
 *
 * As três garantias do par vêm de graça, porque vêm do motor: escopo igual,
 * cobertura igual e canal igual (`engine.ts`). Uma vigência da Empurrada
 * comparada com uma da Rota é recusada com a frase do motor, traduzida aqui em
 * 422.
 */
const router: IRouter = Router();

/** A rubrica que soma, e as duas que a explicam. Lidas do catálogo. */
const LUCRO_FIXO = VARIAVEIS_DE_LUCRO_FIXO.find((v) => v.chave === "lucro_fixo");
const AMORTIZACAO = VARIAVEIS_DE_LUCRO_FIXO.find((v) => v.chave === "amortizacao");
const CICLO = VARIAVEIS_DE_LUCRO_FIXO.find((v) => v.chave === "ciclo");

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
 * Desligada por padrão, e não por economia de bytes: a pergunta da tela é o que
 * mudou, e o `change_set` só guarda isso.
 */
async function linhasIguais(
  snapshotA: { id: string; effectiveDate: string },
  snapshotB: { id: string; effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeLucroFixo[]> {
  const linhas: LinhaDeLucroFixo[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA_DE_LUCRO_FIXO.filter(
      (c) => variavelDeLucroFixoDoCodigo(c)?.codigo[entityType] === c,
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
        // Os dois lados ausentes não são "sem alteração": são ausência nas duas
        // pontas, e o motor já não escreveu linha para eles.
        if (antes === null) continue;
        const chave = `${linha.label}${entityType}${code}`;
        if (jaListadas.has(chave)) continue;
        const semAlteracao = linhaDeLucroFixoSemAlteracao({
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
 * O par de vigências, recortado na remuneração fixa.
 *
 * `GET /lucro-fixo/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência. Negar o sinal no cliente daria a variação errada.
 */
router.get("/lucro-fixo/comparacao", async (req, res, next): Promise<void> => {
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
      (await computeChangeSet(db, base, comparada, { computedBy: "api:lucro-fixo" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_LUCRO_FIXO],
      limit: 5000,
    });

    const linhas = linhasDeLucroFixo(rows);
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
        linhas.map((l) => `${l.entityLabel}${l.entityType}${l.attributeCode}`),
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
      resumo: resumirLucroFixo(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavelDeLucroFixo(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeLucroFixo(linhas, frota),
      /*
        Os mesmos três agregados, um por tipo de equipamento — o que as abas
        Cavalo e Carreta mostram.

        Calculados aqui, com as mesmas três funções, e não recompostos no
        navegador: "veículos comparados" sai do acervo (`frotaPorTipo`), nunca
        da lista de alterações, porque um veículo em que nada mudou não produz
        linha nenhuma. E são as mesmas funções de propósito — a aba e o total
        precisam contar do mesmo jeito, ou a soma das abas deixa de fechar com
        o número publicado ao lado delas.
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
              resumo: resumirLucroFixo(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavelDeLucroFixo(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstadoDeLucroFixo(doTipo, frotaDoTipo),
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
    req.log.warn({ err }, "Comparação de lucro fixo recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * Os totais de cada ponta **e as coexistências** — as duas séries da leitura.
 *
 * Separado da comparação porque a pergunta é outra: um total tem de incluir quem
 * **não** mudou, e o `change_set` não conhece esses veículos.
 *
 * As duas vêm juntas porque saem da mesma linha de `getEntityTable`: o lucro
 * fixo, a amortização e o ciclo do mesmo ativo. Separá-las em duas rotas
 * significaria ler o acervo inteiro duas vezes para responder a duas metades da
 * mesma pergunta — e correr o risco de as duas metades caírem em leituras
 * diferentes, que é justamente o que tornaria a coexistência indefensável.
 */
router.get("/lucro-fixo/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeLucroFixo[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        /* Os três códigos saem do catálogo, e não de uma segunda lista aqui: qual
           coluna é "a parcela própria" de cada tipo é uma decisão só, e mora lá. */
        const code = LUCRO_FIXO?.codigo[entityType];
        const codeAmortizacao = AMORTIZACAO?.codigo[entityType];
        const codeCiclo = CICLO?.codigo[entityType];
        if (!code) continue;

        const colunas = [code, codeAmortizacao, codeCiclo].filter(
          (c): c is string => typeof c === "string",
        );
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
            lucroFixo: comoNumero(linha.values[code]?.value ?? null),
            amortizacao: codeAmortizacao
              ? comoNumero(linha.values[codeAmortizacao]?.value ?? null)
              : null,
            ciclo: codeCiclo ? comoInteiro(linha.values[codeCiclo]?.value ?? null) : null,
          });
        }
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
    totais: totaisDeLucroFixoPorVigencia(valores),
    coexistencias: coexistencias(valores),
  });
});

/** Texto do acervo virando número — e nulo continuando nulo, nunca zero. */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O ciclo, que é inteiro — e cujo branco **não** é zero.
 *
 * `Number("")` é `0`, e um ciclo zero não existe: seria um terceiro ciclo
 * inventado pela conversão, contado como "nem 1 nem 2" nos totais. O branco é
 * testado antes, como no núcleo.
 */
function comoInteiro(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no lucro fixo.
 *
 * `GET /lucro-fixo/candidatos?para=<snapshotId>`
 *
 * A terceira irmã de `lib/candidatas-do-par.ts`, e a que melhor mostra por que
 * aquele módulo existe: ela não tem uma linha de regra própria. Orçamento,
 * reaproveitamento do que já foi comparado e recorte por unidade e cobertura
 * são os mesmos do FINAME e do IPVA, e o que entra aqui é só o recorte do lucro
 * fixo — quais atributos ler, e como contar o que mudou neles.
 */
router.get("/lucro-fixo/candidatos", async (req, res, next): Promise<void> => {
  const para = typeof req.query.para === "string" ? req.query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);

  try {
    await comTetoDeRota(TETO_DE_CANDIDATAS_MS, async (dbComTeto) => {
      const resposta = await candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_DETALHE_DE_LUCRO_FIXO,
          numeros: (rows) => {
            const linhas = linhasDeLucroFixo(rows);
            /* A frota entra zerada: esta rota não publica "veículos
               comparados", só o que se moveu. Derivar a frota de um zero seria
               inventar um denominador que ninguém pediu. */
            const { variaveisAlteradas, impacto } = resumirLucroFixo(linhas, {
              comparados: 0,
              novos: 0,
              ausentes: 0,
            });
            /* Uma natureza só — a linha do menu sai sem prefixo, como
               sempre saiu. Ver `BaldeDoImpacto`. */
            return {
              alteracoes: variaveisAlteradas,
              impacto: { baldes: baldesDeUmaNatureza(impacto.porPeriodicidade) },
            };
          },
        },
        { operacao, computedBy: "api:lucro-fixo-candidatos" },
      );

      if ("naoEncontrada" in resposta) {
        res.status(404).json({ error: "Essa vigência não existe." });
        return;
      }
      res.json(resposta);
    });
  } catch (err) {
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") {
      next(err);
      return;
    }
    req.log.warn({ err }, "Candidatas de lucro fixo recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
