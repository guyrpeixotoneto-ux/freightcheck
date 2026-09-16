import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeImpostos,
  CODIGOS_DA_TABELA_DE_IMPOSTOS,
  CODIGOS_DO_DETALHE_DE_IMPOSTOS,
  computeChangeSet,
  conferenciaDeAliquotas,
  distribuicaoPorEstadoDeImpostos,
  getChangeSetForPair,
  getEntityTable,
  linhaDeImpostosSemAlteracao,
  linhasDeImpostos,
  listChanges,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirImpostos,
  totaisDeImpostosPorVigencia,
  variavelDeImpostosDoCodigo,
  VARIAVEIS_DE_IMPOSTOS,
  type LinhaDeImpostos,
  type ValorDeImposto,
  type RequestedContext,
} from "@workspace/comparison";
import { classificarFalha } from "../lib/classificar-falha";
import {
  baldesDeUmaNatureza,
  candidatasDoPar,
  TETO_DE_CANDIDATAS_MS,
} from "../lib/candidatas-do-par";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { contextoDoPar } from "../lib/recorte-do-par";
import { comTetoDeRota } from "../lib/timeout-de-rota";

/**
 * AUDITORIA DE IMPOSTOS — o tributo da compra do ativo entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `impostos.ts` traduz; aqui só se costura os três e se responde. É a mesma rota
 * de `finame.ts`, `ipva.ts` e `lucro-fixo.ts` sobre outro recorte, e é de
 * propósito que seja: uma rota que fizesse conta própria seria a segunda régua
 * da mesma pergunta — e a que ficasse para trás mostraria um impacto diferente
 * do de Alterações para o mesmo par de vigências.
 *
 * As três garantias do par vêm de graça, porque vêm do motor: escopo igual,
 * cobertura igual e **canal igual** (`engine.ts`). Uma vigência da Empurrada
 * comparada com uma da Rota é recusada com a frase do motor, traduzida aqui em
 * 422 — como já acontece em `POST /change-sets`.
 */
const router: IRouter = Router();

/** As colunas da conferência — lidas do catálogo, nunca redigitadas. */
const PIS_COFINS = VARIAVEIS_DE_IMPOSTOS.find((v) => v.chave === "pis_cofins");
const ICMS = VARIAVEIS_DE_IMPOSTOS.find((v) => v.chave === "icms");
const PERCENTUAL_PIS_COFINS = VARIAVEIS_DE_IMPOSTOS.find(
  (v) => v.chave === "percentual_pis_cofins",
);
const PERCENTUAL_ICMS = VARIAVEIS_DE_IMPOSTOS.find((v) => v.chave === "percentual_icms");

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
    em que nada se moveu — que, nesta rubrica, é o caso mais comum de todos.
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
 * `getEntityTable` (uma por vigência) casadas por `entity_id` — e só entram as
 * linhas em que os dois lados existem e são iguais, porque as diferentes já
 * vieram do motor, com o veredito dele.
 *
 * **Aqui o alternador pesa mais do que nas outras três telas**, e é medido: o
 * PIS/COFINS de aquisição nunca varia ao longo das nove vigências, e o montante
 * de ICMS é zero em todas elas. Uma comparação sem alteração nenhuma é o
 * resultado esperado — e é justamente por isso que a leitura completa precisa
 * estar a um clique.
 */
async function linhasIguais(
  snapshotA: { id: string; effectiveDate: string },
  snapshotB: { id: string; effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeImpostos[]> {
  const linhas: LinhaDeImpostos[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA_DE_IMPOSTOS.filter(
      (c) => variavelDeImpostosDoCodigo(c)?.codigo[entityType] === c,
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
        const semAlteracao = linhaDeImpostosSemAlteracao({
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
 * O par de vigências, recortado nos impostos da compra.
 *
 * `GET /impostos/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência. Negar o sinal no cliente daria a variação errada — 100→110 é +10%,
 * e 110→100 é −9,09%.
 */
router.get("/impostos/comparacao", async (req, res, next): Promise<void> => {
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
      É o mesmo caminho de Comparar e o das outras três auditorias de rubrica — e
      é o que faz as quatro telas mostrarem o mesmo número para o mesmo par, em
      vez de quatro contas independentes.
    */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:impostos" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_IMPOSTOS],
      limit: 5000,
    });

    const linhas = linhasDeImpostos(rows);
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
      /* O resumo é sempre das alterações, com ou sem o alternador ligado: as
         linhas iguais não mudam indicador nenhum — elas só preenchem a tabela. */
      resumo: resumirImpostos(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavelDeImpostos(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeImpostos(linhas, frota),
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
              resumo: resumirImpostos(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavelDeImpostos(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstadoDeImpostos(doTipo, frotaDoTipo),
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
    req.log.warn({ err }, "Comparação de impostos recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * Os totais de cada tributo **e a conferência das alíquotas** — as duas séries.
 *
 * Separado da comparação porque a pergunta é outra: um total tem de incluir quem
 * **não** mudou, e o `change_set` não conhece esses veículos. Nesta rubrica isso
 * é a diferença entre uma tela vazia e a tela inteira: o PIS/COFINS de aquisição
 * não varia entre vigências, então quase nada dele aparece no change set.
 *
 * As duas respostas vêm juntas porque saem da mesma linha de `getEntityTable`: o
 * montante, a alíquota declarada e o valor de nota do mesmo ativo. Separá-las em
 * duas rotas significaria ler o acervo inteiro duas vezes para responder a duas
 * metades da mesma pergunta — e correr o risco de as duas metades caírem em
 * leituras diferentes, que é justamente o que tornaria a conferência
 * indefensável.
 */
router.get("/impostos/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeImposto[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        /* Os cinco códigos saem do catálogo, e não de uma segunda lista aqui: qual
           coluna é o montante, qual é a alíquota declarada e qual é a base é uma
           decisão só, e mora lá. */
        const codeMontantePis = PIS_COFINS?.codigo[entityType];
        const codeMontanteIcms = ICMS?.codigo[entityType];
        const codeDeclaradaPis = PERCENTUAL_PIS_COFINS?.codigo[entityType];
        const codeDeclaradaIcms = PERCENTUAL_ICMS?.codigo[entityType];
        const codeBase = PIS_COFINS?.base?.[entityType];

        const colunas = [
          codeMontantePis,
          codeMontanteIcms,
          codeDeclaradaPis,
          codeDeclaradaIcms,
          codeBase,
        ].filter((c): c is string => typeof c === "string");
        if (colunas.length === 0) continue;

        const tabela = await getEntityTable(
          db,
          entityType,
          colunas,
          contextoDoPar(snapshot, req),
          snapshot.effectiveDate,
        );
        if (!tabela) continue;

        for (const linha of tabela.rows) {
          const ler = (code: string | undefined): number | null =>
            code ? comoNumero(linha.values[code]?.value ?? null) : null;
          valores.push({
            ponta,
            entityType,
            entityLabel: linha.label,
            valorNf: ler(codeBase),
            pisCofins: ler(codeMontantePis),
            icms: ler(codeMontanteIcms),
            percentualPisCofins: ler(codeDeclaradaPis),
            percentualIcms: ler(codeDeclaradaIcms),
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
    totais: totaisDeImpostosPorVigencia(valores),
    conferencias: conferenciaDeAliquotas(valores),
  });
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * O branco é testado antes de converter, e não é preciosismo: `Number("")` é
 * `0`, e nesta rubrica um zero inventado pela conversão seria lido como
 * "montante declarado zero" — exatamente o achado que a tela existe para
 * distinguir de "coluna nunca preenchida".
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, nos Impostos.
 *
 * `GET /impostos/candidatos?para=<snapshotId>`
 *
 * A quarta irmã de `/finame/candidatos`, e a que faltava. Esta tela oferecia as
 * mesmas vigências que as outras três e era a única que as oferecia **mudas**:
 * a coluna da direita — o dinheiro e a contagem que fazem escolher — só existia
 * em FINAME, IPVA e Lucro Fixo. Escolher às cegas aqui e com os números lá, na
 * mesma família de dados e no mesmo gesto, é a diferença que ninguém sabe
 * explicar olhando a tela.
 *
 * Nenhuma regra própria: o orçamento, o reaproveitamento do que já foi
 * comparado e o recorte por unidade e cobertura moram em
 * `lib/candidatas-do-par.ts`. O que entra aqui é o recorte dos Impostos — quais
 * atributos ler, e como contar o que mudou neles.
 */
router.get("/impostos/candidatos", async (req, res, next): Promise<void> => {
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
          attributeCodes: CODIGOS_DO_DETALHE_DE_IMPOSTOS,
          numeros: (rows) => {
            const linhas = linhasDeImpostos(rows);
            /* A frota entra zerada: esta rota não publica "veículos
               comparados", só o que se moveu. Derivar a frota de um zero seria
               inventar um denominador que ninguém pediu. */
            const { variaveisAlteradas, impacto } = resumirImpostos(linhas, {
              comparados: 0,
              novos: 0,
              ausentes: 0,
            });
            /* Uma natureza só — a linha do menu sai sem prefixo, como as das
               outras três. Ver `BaldeDoImpacto`. */
            return {
              alteracoes: variaveisAlteradas,
              impacto: { baldes: baldesDeUmaNatureza(impacto.porPeriodicidade) },
            };
          },
        },
        { operacao, computedBy: "api:impostos-candidatos" },
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
    req.log.warn({ err }, "Candidatas de Impostos recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
