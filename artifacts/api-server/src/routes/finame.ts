import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  CODIGOS_DA_TABELA,
  CODIGOS_DO_DETALHE,
  CODIGOS_DO_CONTEXTO,
  codigoDaDataDeCadastro,
  codigoDoFimDoContrato,
  codigoDoPeriodo,
  coberturaComum,
  comContextoDoVeiculo,
  alteracoesPorVariavel,
  computeChangeSet,
  distribuicaoPorEstado,
  getChangeSetForPair,
  getEntityTable,
  linhaSemAlteracao,
  linhasDeFiname,
  listChanges,
  frotaDoEquipamento,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirFiname,
  evolucaoPorTipo,
  totaisPorVigencia,
  variavelDoCodigo,
  VARIAVEIS_DE_FINAME,
  type ContextoDoVeiculo,
  type LinhaDeFiname,
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
 * AUDITORIA DE FINAME — o recorte do financiamento entre duas vigências.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `finame.ts` traduz; aqui só se costura os três e se responde. Uma rota que
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

/** A parcela — a variável que soma. Lida do catálogo, nunca redigitada. */
const PARCELA = VARIAVEIS_DE_FINAME.find((v) => v.chave === "parcela");

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
  contexto: RequestedContext | undefined,
): Promise<LinhaDeFiname[]> {
  const linhas: LinhaDeFiname[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA.filter(
      (c) => variavelDoCodigo(c)?.codigo[entityType] === c,
    );
    if (codigos.length === 0) continue;

    const [a, b] = await Promise.all([
      getEntityTable(db, entityType, codigos, contexto, snapshotA.effectiveDate),
      getEntityTable(db, entityType, codigos, contexto, snapshotB.effectiveDate),
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
        const chave = `${linha.label}\u001f${entityType}\u001f${code}`;
        if (jaListadas.has(chave)) continue;
        const semAlteracao = linhaSemAlteracao({
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
 * O prazo, a data de cadastro e o fim do contrato de cada veículo numa vigência.
 *
 * Três atributos (`periodo_finame`, a data de entrada e `data_fim_contrato`),
 * lidos das duas pontas para alimentar as colunas de contexto da tabela. Não
 * saem do `change_set` de propósito: o change set só conhece o que mudou, e o
 * prazo, a data de cadastro e o fim do contrato da imensa maioria dos veículos
 * não mudam — derivá-los dali deixaria as colunas vazias exatamente nas linhas
 * em que elas explicam a queda da parcela.
 */
async function contextoDaVigencia(
  snapshot: { effectiveDate: string } | undefined,
  recorte: RequestedContext | undefined,
): Promise<ContextoDoVeiculo[]> {
  if (!snapshot || CODIGOS_DO_CONTEXTO.length === 0) return [];
  const contexto: ContextoDoVeiculo[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DO_CONTEXTO.filter(
      (c) => variavelDoCodigo(c)?.codigo[entityType] === c,
    );
    if (codigos.length === 0) continue;
    const codigoPeriodo = codigoDoPeriodo(entityType);
    const codigoData = codigoDaDataDeCadastro(entityType);
    const codigoFim = codigoDoFimDoContrato(entityType);
    const tabela = await getEntityTable(
      db,
      entityType,
      codigos,
      recorte,
      snapshot.effectiveDate,
    );
    if (!tabela) continue;
    for (const linha of tabela.rows) {
      contexto.push({
        entityLabel: linha.label,
        entityType,
        periodo: codigoPeriodo ? (linha.values[codigoPeriodo]?.value ?? null) : null,
        dataDeCadastro: codigoData ? (linha.values[codigoData]?.value ?? null) : null,
        fimDoContrato: codigoFim ? (linha.values[codigoFim]?.value ?? null) : null,
      });
    }
  }
  return contexto;
}

/**
 * O par de vigências, recortado no financiamento.
 *
 * `GET /finame/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência. Negar o sinal no cliente daria a variação errada — 100→110 é +10%,
 * e 110→100 é −9,09%.
 */
router.get("/finame/comparacao", async (req, res, next): Promise<void> => {
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
      É o mesmo caminho de Comparar — e é o que faz as duas telas mostrarem o
      mesmo número para o mesmo par, em vez de duas contas independentes.
    */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:finame" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE],
      limit: 5000,
    });

    const linhas = linhasDeFiname(rows);
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
        linhas.map((l) => `${l.entityLabel}\u001f${l.entityType}\u001f${l.attributeCode}`),
      );
      todas = [
        ...linhas,
        ...(await linhasIguais(snapshotA, snapshotB, jaListadas, contextoDoPar(snapshotB, req))),
      ];
    }

    /* As colunas de contexto: o prazo, a data de cadastro e o fim do contrato
       do veículo na vigência comparada, com a base respondendo pelos que
       saíram. Duas leituras de três atributos. */
    const [contextoDaBase, contextoDaComparada] = await Promise.all([
      contextoDaVigencia(snapshotA, contextoDoPar(snapshotA, req)),
      contextoDaVigencia(snapshotB, contextoDoPar(snapshotB, req)),
    ]);
    todas = comContextoDoVeiculo(todas, {
      base: contextoDaBase,
      comparada: contextoDaComparada,
    });

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
      resumo: resumirFiname(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavel(linhas),
      distribuicaoPorEstado: distribuicaoPorEstado(linhas, frota),
      /*
        Os mesmos três agregados, um por tipo de equipamento — o que as abas
        Cavalo e Carreta mostram.

        Calculados **aqui**, com as mesmas três funções, e não recompostos no
        navegador. A tela recebe as linhas e poderia filtrá-las sozinha; o que
        ela não tem é o denominador — "veículos comparados" sai do acervo
        (`frotaPorTipo`), nunca da lista de alterações, porque um veículo em que
        nada mudou não produz linha nenhuma. Uma aba que derivasse o número da
        lista diria zero comparados sobre 135 veículos parados.

        E são as mesmas funções de propósito: a aba "Cavalo" e o total precisam
        contar do mesmo jeito. Duas réguas dariam, mais cedo ou mais tarde, uma
        soma de abas que não fecha com o número que a tela publica ao lado.
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
              resumo: resumirFiname(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavel(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstado(doTipo, frotaDoTipo),
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
    req.log.warn({ err }, "Comparação de FINAME recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O total de parcela FINAME de cada ponta — a série do primeiro gráfico.
 *
 * Separado da comparação porque a pergunta é outra: um total tem de incluir
 * quem **não** mudou, e o `change_set` não conhece esses veículos. Sai das duas
 * leituras de vigência, somando só a parcela — nunca os juros, nunca a
 * amortização e nunca o total composto da carreta, que embute a parcela do
 * cavalo vinculado.
 *
 * Devolve também a `evolucao`: a mesma leitura aberta nas três parcelas que
 * produzem a diferença — o que se moveu em quem está nas duas pontas, o que
 * entrou de frota e o que saiu. Sai daqui, e não de uma segunda consulta, para
 * que o total e a decomposição não possam discordar: são a mesma leitura.
 *
 * E lê **a unidade do par**, e não a primeira do acervo: ver
 * {@link contextoDoPar}. Sem isso, este total era o único número da tela que
 * podia estar respondendo por outra unidade — e é justamente o número que a
 * Evolução subtrai, o que fazia a diferença do gráfico não reconciliar com
 * nada.
 */
router.get("/finame/totais", async (req, res): Promise<void> => {
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

  const valores: {
    ponta: "BASE" | "COMPARADA";
    entityType: string;
    /* Quem sustenta o valor. O total não precisa dele; a decomposição precisa,
       porque é por veículo que se sabe se um real é alteração ou entrada. */
    entityId: string;
    attributeCode: string;
    valor: number | null;
  }[] = [];

  /*
    OS TIPOS QUE **AS DUAS PONTAS** TRAZEM — o mesmo recorte do motor.

    Sem ele, um tipo que só existe de um lado saía deste painel como movimento
    de frota: comparando uma vigência com carreta contra uma sem, as 71 carretas
    que nunca foram importadas apareciam como "Saídas · 71 veíc." — ao lado de
    um cartão, na mesma tela, dizendo "Ausentes na comparada: 0". Os dois
    números liam o mesmo par e discordavam, porque um já recortava e o outro
    não.

    A regra é a de `engine.ts`: um tipo presente numa ponta só não é frota que
    entrou nem que saiu; é cobertura de arquivo. Aqui ele simplesmente não entra
    na leitura — e o painel passa a falar do que as duas vigências têm.
  */
  const tiposDoPar = coberturaComum(
    pontas[0].snapshot?.entityTypeSet,
    pontas[1].snapshot?.entityTypeSet,
  );

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        if (!tiposDoPar.includes(entityType)) continue;
        /* O código da parcela sai do catálogo, e não de uma segunda lista aqui:
           a decisão de qual coluna é "a parcela" da carreta é uma só, e mora lá. */
        const code = PARCELA?.codigo[entityType];
        if (!code) continue;
        const tabela = await getEntityTable(
          db,
          entityType,
          [code],
          contextoDoPar(snapshot, req),
          snapshot.effectiveDate,
        );
        if (!tabela) continue;
        for (const linha of tabela.rows) {
          const bruto = linha.values[code]?.value ?? null;
          const numero = bruto === null ? null : Number(bruto);
          valores.push({
            ponta,
            entityType,
            entityId: linha.entityId,
            attributeCode: code,
            valor: numero !== null && Number.isFinite(numero) ? numero : null,
          });
        }
      }
    }
  } catch (err) {
    /* Pedir o escopo do par é pedir um recorte que pode não ter contexto — e a
       recusa de recorte é frase para quem opera, não 500. A mesma tradução de
       `/finame/comparacao`, pela mesma razão. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais de FINAME recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({ totais: totaisPorVigencia(valores), evolucao: evolucaoPorTipo(valores) });
});

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no FINAME.
 *
 * `GET /finame/candidatos?para=<snapshotId>`
 *
 * A pergunta desta rota não é a do seletor do cabeçalho
 * (`components/vigencia/seletor-de-vigencia.tsx`), que mostra cada vigência
 * contra a **anterior dela** — uma leitura de série. Aqui o número é **do
 * par**: fixado o Para, quanto cada candidata produz contra ele. Trazer os
 * números de lá seria mostrar, ao lado de um par, o impacto de outro.
 *
 * O orçamento, o reaproveitamento do que já foi comparado e o recorte por
 * unidade e cobertura moram em `lib/candidatas-do-par.ts`, com o IPVA. O que
 * sobra aqui é o recorte do FINAME: quais atributos ler, e como contar o que
 * mudou neles.
 */
router.get("/finame/candidatos", async (req, res, next): Promise<void> => {
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
          attributeCodes: CODIGOS_DO_DETALHE,
/* Custo Fixo audita placa: cavalo e carreta, e mais nada. O trecho pode
             existir no acervo e até vir dentro da mesma vigência — ele não é
             assunto desta tela, e não entra nem na lista nem na conta. */
          entityTypes: TIPOS_DE_EQUIPAMENTO,
          numeros: (rows) => {
            const linhas = linhasDeFiname(rows);
            /* A frota entra zerada de propósito: aqui não se publica "veículos
               comparados" — só o que se moveu. Os campos que dependem da frota
               não saem desta rota, e inventá-los a partir de um zero seria pior
               do que não tê-los. */
            const { variaveisAlteradas, impacto } = resumirFiname(linhas, {
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
        { operacao, computedBy: "api:finame-candidatos" },
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
    req.log.warn({ err }, "Candidatas de FINAME recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
