import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeAquisicao,
  CODIGOS_DA_TABELA_DE_AQUISICAO,
  CODIGOS_DO_DETALHE_DE_AQUISICAO,
  computeChangeSet,
  conferenciaDaEntrada,
  distribuicaoPorEstadoDeAquisicao,
  getChangeSetForPair,
  getEntityTable,
  linhaDeAquisicaoSemAlteracao,
  linhasDeAquisicao,
  listChanges,
  frotaDoEquipamento,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirAquisicao,
  resumirCoerenciaDoCadastro,
  totaisDeAquisicaoPorVigencia,
  variavelDeAquisicaoDoCodigo,
  VARIAVEIS_DE_AQUISICAO,
  VARIAVEIS_DE_DETALHE_DE_AQUISICAO,
  type LinhaDeAquisicao,
  type ValorDeAquisicao,
  type RequestedContext,
  TIPOS_DE_EQUIPAMENTO,
} from "@workspace/comparison";
import { classificarFalha } from "../lib/classificar-falha";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { contextoDoPar } from "../lib/recorte-do-par";
import { comTetoDeRota } from "../lib/timeout-de-rota";
import {
  baldesDoImpacto,
  candidatasDoPar,
  TETO_DE_CANDIDATAS_MS,
} from "../lib/candidatas-do-par";

/**
 * AUDITORIA DE AQUISIÇÃO — o que se pagou pelo ativo, entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `aquisicao.ts` traduz; aqui só se costura os três e se responde. É a mesma
 * rota de `ipva.ts` sobre outro recorte, e é de propósito que seja: uma rota que
 * fizesse conta própria seria a segunda régua da mesma pergunta.
 *
 * ---------------------------------------------------------------------------
 * A diferença desta rota para as outras quatro do Custo Fixo
 * ---------------------------------------------------------------------------
 * `/aquisicao/totais` carrega **três** leituras, e não uma: o valor de nota
 * somado, a conferência do percentual de entrada e a coerência do cadastro
 * (`data` × `ano` × `mes_de_entrada`). As três saem da **mesma** linha de
 * `getEntityTable`, e é por isso que vêm juntas — separá-las em três rotas
 * significaria ler o acervo três vezes para responder a três partes da mesma
 * pergunta, e correr o risco de caírem em leituras diferentes.
 *
 * E elas carregam o peso da tela, porque a comparação vem vazia: no acervo
 * inteiro, nenhuma coluna de aquisição produziu uma linha de `change`
 * (`docs/ACHADO-AQUISICAO.md`). O que esta rota entrega de mais valioso é a
 * base conferida, não o delta.
 */
const router: IRouter = Router();

/** A rubrica — a variável que soma. Lida do catálogo, nunca redigitada. */
const VALOR_NF = VARIAVEIS_DE_AQUISICAO.find((v) => v.chave === "valor_nf");
const ENTRADA = VARIAVEIS_DE_AQUISICAO.find((v) => v.chave === "percentual_entrada");
const DATA = VARIAVEIS_DE_AQUISICAO.find((v) => v.chave === "data_de_entrada");
const ANO = VARIAVEIS_DE_DETALHE_DE_AQUISICAO.find((v) => v.chave === "ano");
const MES = VARIAVEIS_DE_DETALHE_DE_AQUISICAO.find((v) => v.chave === "mes_de_entrada");

/**
 * As linhas "sem alteração" — a leitura completa que o alternador liga.
 *
 * Nas outras rubricas ele é conforto; aqui ele é **o conteúdo**. Como nenhuma
 * coluna de aquisição se move no acervo, é por este caminho que a tabela mostra
 * a base que a tela existe para conferir: a nota de cada ativo, a entrada e a
 * data. Continua desligado por padrão, porque a pergunta de um par de vigências
 * é o que mudou — e a tela diz, com todas as letras, que não mudou nada.
 */
async function linhasIguais(
  snapshotA: { id: string; effectiveDate: string },
  snapshotB: { id: string; effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeAquisicao[]> {
  const linhas: LinhaDeAquisicao[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA_DE_AQUISICAO.filter(
      (c) => variavelDeAquisicaoDoCodigo(c)?.codigo[entityType] === c,
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
        const semAlteracao = linhaDeAquisicaoSemAlteracao({
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
 * O par de vigências, recortado na aquisição.
 *
 * `GET /aquisicao/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência.
 */
router.get("/aquisicao/comparacao", async (req, res, next): Promise<void> => {
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
    /* Reaproveita a comparação já calculada; só calcula quando ela não existe.
       É o mesmo caminho de Comparar e o das outras quatro auditorias do Custo
       Fixo — e é o que faz todas mostrarem o mesmo número para o mesmo par. */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:aquisicao" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_AQUISICAO],
      limit: 5000,
    });

    const linhas = linhasDeAquisicao(rows);
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
      resumo: resumirAquisicao(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavelDeAquisicao(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeAquisicao(linhas, frota),
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
              resumo: resumirAquisicao(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavelDeAquisicao(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstadoDeAquisicao(doTipo, frotaDoTipo),
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
    req.log.warn({ err }, "Comparação de aquisição recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * As três leituras da base: o valor de nota, a entrada e a coerência do cadastro.
 *
 * `GET /aquisicao/totais?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Separado da comparação porque a pergunta é outra: a base inclui quem **não**
 * mudou — que aqui é todo mundo —, e o `change_set` não conhece esses veículos.
 */
router.get("/aquisicao/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeAquisicao[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        /* As cinco colunas saem do catálogo, e não de uma segunda lista aqui: a
           decisão de qual é a nota, qual é a entrada e quais são as derivadas da
           data é uma só, e mora em `aquisicao.ts`. */
        const codeNf = VALOR_NF?.codigo[entityType];
        const codeEntrada = ENTRADA?.codigo[entityType];
        const codeData = DATA?.codigo[entityType];
        const codeAno = ANO?.codigo[entityType];
        const codeMes = MES?.codigo[entityType];
        const colunas = [codeNf, codeEntrada, codeData, codeAno, codeMes].filter(
          (c): c is string => Boolean(c),
        );
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
          valores.push({
            ponta,
            entityType,
            entityLabel: linha.label,
            valorNf: codeNf ? comoNumero(linha.values[codeNf]?.value ?? null) : null,
            percentualEntrada: codeEntrada
              ? comoNumero(linha.values[codeEntrada]?.value ?? null)
              : null,
            dataDeEntrada: codeData ? (linha.values[codeData]?.value ?? null) : null,
            ano: codeAno ? comoNumero(linha.values[codeAno]?.value ?? null) : null,
            mesDeEntrada: codeMes ? comoNumero(linha.values[codeMes]?.value ?? null) : null,
          });
        }
      }
    }
  } catch (err) {
    /* Pedir o escopo do par é pedir um recorte que pode não ter contexto — e a
       recusa de recorte é frase para quem opera, não 500. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais de aquisição recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({
    totais: totaisDeAquisicaoPorVigencia(valores),
    entrada: conferenciaDaEntrada(valores),
    coerencia: resumirCoerenciaDoCadastro(valores),
  });
});

/** Texto do acervo virando número — e nulo continuando nulo, nunca zero. */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, na aquisição.
 *
 * `GET /aquisicao/candidatos?para=<snapshotId>`
 *
 * Irmã de `/finame/candidatos`, e deliberadamente sem uma linha de regra
 * própria: o orçamento, o reaproveitamento do que já foi comparado e o recorte
 * por unidade e cobertura moram em `lib/candidatas-do-par.ts`. O que entra aqui
 * é o recorte da aquisição.
 *
 * Nesta rubrica a lista tende a vir toda zerada, e isso é a verdade do acervo —
 * não um defeito da rota. Uma candidata com "0 alterações" aqui quer dizer que
 * a nota não se mexeu entre aquelas duas vigências, que é exatamente o que se
 * espera de uma compra já feita.
 */
router.get("/aquisicao/candidatos", async (req, res, next): Promise<void> => {
  const para = typeof req.query.para === "string" ? req.query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);

  try {
    /* A resposta sai fora do teto, e não de dentro dele — quando ela sai, a
       conexão já voltou inteira ao pool. A mesma ordem das outras quatro rotas
       de candidatas, pelo motivo escrito em `ipva.ts`. */
    const resposta = await comTetoDeRota(TETO_DE_CANDIDATAS_MS, (dbComTeto) =>
      candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_DETALHE_DE_AQUISICAO,
          /* Custo Fixo audita placa: cavalo e carreta, e mais nada. */
          entityTypes: TIPOS_DE_EQUIPAMENTO,
          numeros: (rows) => {
            const linhas = linhasDeAquisicao(rows);
            /* A frota entra zerada: esta rota não publica "veículos
               comparados", só o que se moveu. */
            const { variaveisAlteradas, impacto } = resumirAquisicao(linhas, {
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
        { operacao, computedBy: "api:aquisicao-candidatos" },
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
    req.log.warn({ err }, "Candidatas de aquisição recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
