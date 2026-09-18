import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  aliquotaImplicita,
  aliquotaPorAtivo,
  alteracoesPorVariavelDeIpva,
  CODIGOS_DA_TABELA_DE_IPVA,
  CODIGOS_DO_DETALHE_DE_IPVA,
  computeChangeSet,
  distribuicaoPorEstadoDeIpva,
  getChangeSetForPair,
  getEntityTable,
  linhaDeIpvaSemAlteracao,
  linhasDeIpva,
  listChanges,
  frotaDoEquipamento,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirIpva,
  totaisDeIpvaPorVigencia,
  variavelDeIpvaDoCodigo,
  VARIAVEIS_DE_IPVA,
  type LinhaDeIpva,
  type ValorDeIpva,
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
 * AUDITORIA DE IPVA — o recorte do tributo entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `ipva.ts` traduz; aqui só se costura os três e se responde. É a mesma rota de
 * `finame.ts` sobre outro recorte, e é de propósito que seja: uma rota que
 * fizesse conta própria seria a segunda régua da mesma pergunta — e a que
 * ficasse para trás mostraria um impacto diferente do de Alterações para o
 * mesmo par de vigências.
 *
 * As três garantias do par vêm de graça, porque vêm do motor: escopo igual,
 * cobertura igual e **canal igual** (`engine.ts`). Uma vigência da Empurrada
 * comparada com uma da Rota é recusada com a frase do motor, traduzida aqui em
 * 422 — como já acontece em `POST /change-sets`.
 */
const router: IRouter = Router();

/** A rubrica — a variável que soma. Lida do catálogo, nunca redigitada. */
const IPVA = VARIAVEIS_DE_IPVA.find((v) => v.chave === "ipva");

/**
 * As linhas "sem alteração" — a leitura completa que o alternador liga.
 *
 * Desligado por padrão, e não por economia de bytes: a pergunta da tela é o que
 * mudou, e o `change_set` só guarda isso. Ligado, são duas leituras de
 * `getEntityTable` (uma por vigência) casadas por `entity_id` — e só entram as
 * linhas em que os dois lados existem e são iguais, porque as diferentes já
 * vieram do motor, com o veredito dele.
 */
async function linhasIguais(
  snapshotA: { id: string; effectiveDate: string },
  snapshotB: { id: string; effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeIpva[]> {
  const linhas: LinhaDeIpva[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA_DE_IPVA.filter(
      (c) => variavelDeIpvaDoCodigo(c)?.codigo[entityType] === c,
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
        const chave = `${linha.label}${entityType}${code}`;
        if (jaListadas.has(chave)) continue;
        const semAlteracao = linhaDeIpvaSemAlteracao({
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
 * O par de vigências, recortado no tributo.
 *
 * `GET /ipva/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência. Negar o sinal no cliente daria a variação errada — 100→110 é +10%,
 * e 110→100 é −9,09%.
 */
router.get("/ipva/comparacao", async (req, res, next): Promise<void> => {
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
      É o mesmo caminho de Comparar e o mesmo da Auditoria de FINAME — e é o que
      faz as três telas mostrarem o mesmo número para o mesmo par, em vez de
      três contas independentes.
    */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:ipva" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_IPVA],
      limit: 5000,
    });

    const linhas = linhasDeIpva(rows);
    const vigencias = await listComparableSnapshots(db, {
      operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
    });
    const snapshotA = vigencias.find((v) => v.id === base);
    const snapshotB = vigencias.find((v) => v.id === comparada);
    /*
      A frota dos cartões sai de `frotaPorTipo` **recortada no equipamento**, e
      não do resumo do `change_set` com o `entity_count` do snapshot.

      Os dois falavam da vigência inteira, e a vigência inteira pode trazer
      trecho: um arquivo de trecho fazia cada perna de rota entrar em "Novos na
      vigência" desta tela, ao lado de placas, sem que uma linha de equipamento
      tivesse mudado. Ver `frotaDoEquipamento`.
    */
    const frotaPorEquipamento = await frotaPorTipo(db, resumo.id, comparada);
    const frota = frotaDoEquipamento(frotaPorEquipamento);

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
      resumo: resumirIpva(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavelDeIpva(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeIpva(linhas, frota),
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
              resumo: resumirIpva(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavelDeIpva(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstadoDeIpva(doTipo, frotaDoTipo),
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
    req.log.warn({ err }, "Comparação de IPVA recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O total de IPVA de cada ponta **e a alíquota implícita** — as duas séries.
 *
 * Separado da comparação porque a pergunta é outra: um total tem de incluir quem
 * **não** mudou, e o `change_set` não conhece esses veículos.
 *
 * A mesma leitura serve às duas respostas, e por isso elas vêm juntas: o IPVA e
 * o valor de nota do mesmo ativo saem da mesma linha de `getEntityTable`.
 * Separá-las em duas rotas significaria ler o acervo inteiro duas vezes para
 * responder a duas metades da mesma pergunta — e correr o risco de as duas
 * metades caírem em leituras diferentes.
 */
router.get("/ipva/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeIpva[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        /* Os dois códigos saem do catálogo, e não de uma segunda lista aqui: a
           decisão de qual coluna é "o IPVA" e qual é a base da alíquota é uma só,
           e mora lá. */
        const code = IPVA?.codigo[entityType];
        const codeBase = IPVA?.base?.[entityType];
        if (!code) continue;
        const colunas = codeBase ? [code, codeBase] : [code];
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
            ipva: comoNumero(linha.values[code]?.value ?? null),
            valorNf: codeBase ? comoNumero(linha.values[codeBase]?.value ?? null) : null,
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
    totais: totaisDeIpvaPorVigencia(valores),
    aliquotas: aliquotaImplicita(valores),
    /*
      A mesma leitura, sem agregar — uma linha por placa, com o percentual das
      duas pontas lado a lado. Vem daqui, e não de uma rota nova, porque é a
      mesma pergunta em dois níveis: a média da tabela de cima e o percentual de
      cada ativo têm de sair dos mesmos ativos, ou a tela publica um veredito
      sobre uma população e a lista sobre outra.
    */
    porAtivo: aliquotaPorAtivo(valores),
  });
});

/** Texto do acervo virando número — e nulo continuando nulo, nunca zero. */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no IPVA.
 *
 * `GET /ipva/candidatos?para=<snapshotId>`
 *
 * Irmã de `/finame/candidatos`, e deliberadamente sem uma linha de regra
 * própria: o orçamento, o reaproveitamento do que já foi comparado e o recorte
 * por unidade e cobertura moram em `lib/candidatas-do-par.ts`. O que entra aqui
 * é o recorte do IPVA — quais atributos ler, e como contar o que mudou neles.
 *
 * Fosse por cópia, as duas telas responderiam com fôlegos diferentes à mesma
 * pergunta no dia em que uma das cópias ganhasse um segundo a mais de
 * orçamento, e nada na tela diria por quê.
 */
router.get("/ipva/candidatos", async (req, res, next): Promise<void> => {
  const para = typeof req.query.para === "string" ? req.query.para : "";
  if (!para) {
    res.status(400).json({ error: "Informe a vigência de destino." });
    return;
  }
  await exigirOperacaoDoRecurso(req, "vigência", para, () => operacaoDoSnapshot(db, para));
  const operacao = operacaoDaConsulta(req.query as Record<string, unknown>);

  try {
    /*
      A resposta sai **fora** do teto, e não de dentro dele.

      Dentro, `res.json` era a última linha da função que `comTetoDeRota`
      embrulha — então o HTTP terminava antes de o `finally` daquela função
      devolver a conexão ao pool. Quem recebeu a resposta seguia adiante com
      uma consulta de limpeza (`SET statement_timeout = DEFAULT`) ainda em voo,
      e um `pool.end()` logo em seguida a pegava no meio da devolução e não
      resolvia mais. Foi assim que o `afterAll` de
      `monitor-custo-fixo-candidatos.test.ts` estourou em CI, e as quatro
      rotas de candidatas tinham a mesma ordem.

      Calcular dentro e responder fora fecha a janela pela ordem: quando a
      resposta sai, a conexão já voltou inteira. É o que
      `<rota>-candidatos.test.ts` afere — "a conexão já voltou ao pool quando
      a resposta chega".
    */
    const resposta = await comTetoDeRota(TETO_DE_CANDIDATAS_MS, (dbComTeto) =>
      candidatasDoPar(
        dbComTeto,
        para,
        {
          attributeCodes: CODIGOS_DO_DETALHE_DE_IPVA,
/* Custo Fixo audita placa: cavalo e carreta, e mais nada. O trecho pode
             existir no acervo e até vir dentro da mesma vigência — ele não é
             assunto desta tela, e não entra nem na lista nem na conta. */
          entityTypes: TIPOS_DE_EQUIPAMENTO,
          numeros: (rows) => {
            const linhas = linhasDeIpva(rows);
            /* A frota entra zerada: esta rota não publica "veículos
               comparados", só o que se moveu. Derivar a frota de um zero seria
               inventar um denominador que ninguém pediu. */
            const { variaveisAlteradas, impacto } = resumirIpva(linhas, {
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
        { operacao, computedBy: "api:ipva-candidatos" },
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
    req.log.warn({ err }, "Candidatas de IPVA recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
