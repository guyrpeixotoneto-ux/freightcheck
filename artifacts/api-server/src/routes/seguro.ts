import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  alteracoesPorVariavelDeSeguro,
  CODIGOS_DA_TABELA_DE_SEGURO,
  CODIGOS_DO_DETALHE_DE_SEGURO,
  computeChangeSet,
  conferenciaDoAparato,
  distribuicaoPorEstadoDeSeguro,
  getChangeSetForPair,
  getEntityTable,
  linhaDeSeguroSemAlteracao,
  linhasDeSeguro,
  listChanges,
  frotaDoEquipamento,
  frotaPorTipo,
  listComparableSnapshots,
  operacaoDoSnapshot,
  resumirSeguro,
  SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO,
  totaisDeSeguroPorVigencia,
  variavelDeSeguroDoCodigo,
  VARIAVEIS_DE_SEGURO,
  type LinhaDeSeguro,
  type ValorDeSeguro,
  type RequestedContext,
  TIPOS_DE_EQUIPAMENTO,
} from "@workspace/comparison";
import { classificarFalha } from "../lib/classificar-falha";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { contextoDoPar } from "../lib/recorte-do-par";
import { comTetoDeRota } from "../lib/timeout-de-rota";
import {
  candidatasDoPar,
  impactoPublicavel,
  TETO_DE_CANDIDATAS_MS,
} from "../lib/candidatas-do-par";

/**
 * AUDITORIA DE SEGURO E APARATO — o que se paga por equipar a carreta.
 *
 * ---------------------------------------------------------------------------
 * Por que esta rota é tão curta
 * ---------------------------------------------------------------------------
 * Porque ela não compara nada. `computeChangeSet` compara, `listChanges` lê e
 * `seguro.ts` traduz; aqui só se costura os três e se responde. É a mesma rota
 * de `ipva.ts` sobre outro recorte, e é de propósito que seja: uma rota que
 * fizesse conta própria seria a segunda régua da mesma pergunta.
 *
 * As três garantias do par vêm de graça, porque vêm do motor: escopo igual,
 * cobertura igual e canal igual (`engine.ts`).
 *
 * ---------------------------------------------------------------------------
 * A coluna a mais que `/totais` lê, e por quê
 * ---------------------------------------------------------------------------
 * Além das cinco do aparato, `/seguro/totais` lê `carreta.custo_fixo` e as duas
 * parcelas que o compõem — `carreta.finame` e
 * `carreta.lucro_fixomodelo_novo_ciclo`. Não é curiosidade: é o que permite
 * **medir** que o aparato está fora do total declarado, em vez de afirmá-lo num
 * cabeçalho. Ver `conferenciaDoAparato`.
 */
const router: IRouter = Router();

/** As colunas que compõem o custo fixo declarado da carreta. */
const PARCELAS_DO_CUSTO_FIXO = {
  custoFixo: "carreta.custo_fixo",
  finame: "carreta.finame",
  lucroFixoConjunto: "carreta.lucro_fixomodelo_novo_ciclo",
} as const;

/**
 * As linhas "sem alteração" — a leitura completa que o alternador liga.
 *
 * Nesta rubrica elas importam mais do que nas outras: três das cinco colunas
 * são taxa fixa, e a comparação típica não move nada. Desligado, a tela diz
 * "nada mudou" e para aí; ligado, ela mostra **quanto** é o aparato de cada
 * carreta, que é a outra metade da pergunta.
 */
async function linhasIguais(
  snapshotA: { id: string; effectiveDate: string },
  snapshotB: { id: string; effectiveDate: string },
  jaListadas: Set<string>,
  recorte: RequestedContext | undefined,
): Promise<LinhaDeSeguro[]> {
  const linhas: LinhaDeSeguro[] = [];
  for (const entityType of ["CAVALO", "CARRETA"] as const) {
    const codigos = CODIGOS_DA_TABELA_DE_SEGURO.filter(
      (c) => variavelDeSeguroDoCodigo(c)?.codigo[entityType] === c,
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
        const semAlteracao = linhaDeSeguroSemAlteracao({
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
 * O par de vigências, recortado no aparato.
 *
 * `GET /seguro/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * Inverter as pontas é trocar os dois parâmetros: o motor calcula o par
 * invertido de verdade, com a base do percentual passando a ser a outra
 * vigência.
 */
router.get("/seguro/comparacao", async (req, res, next): Promise<void> => {
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
      É o mesmo caminho de Comparar e o das outras auditorias — e é o que faz
      todas as telas mostrarem o mesmo número para o mesmo par.
    */
    const resumo =
      (await getChangeSetForPair(db, base, comparada)) ??
      (await computeChangeSet(db, base, comparada, { computedBy: "api:seguro" }));

    const { rows } = await listChanges(db, resumo.id, {
      attributeCodes: [...CODIGOS_DO_DETALHE_DE_SEGURO],
      limit: 5000,
    });

    const linhas = linhasDeSeguro(rows);
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
      resumo: resumirSeguro(linhas, frota),
      alteracoesPorVariavel: alteracoesPorVariavelDeSeguro(linhas),
      distribuicaoPorEstado: distribuicaoPorEstadoDeSeguro(linhas, frota),
      /*
        Os mesmos três agregados, um por tipo de equipamento — o que as abas
        Cavalo e Carreta mostram. Aqui a aba Cavalo é sempre vazia, e isso é o
        dado: o cavalo não declara nenhuma das cinco colunas.
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
              resumo: resumirSeguro(doTipo, frotaDoTipo),
              alteracoesPorVariavel: alteracoesPorVariavelDeSeguro(doTipo),
              distribuicaoPorEstado: distribuicaoPorEstadoDeSeguro(doTipo, frotaDoTipo),
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
    req.log.warn({ err }, "Comparação de seguro e aparato recusada");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * O aparato total de cada ponta **e a conferência contra o custo fixo** — as
 * duas séries.
 *
 * Separado da comparação porque a pergunta é outra: um total tem de incluir quem
 * **não** mudou, e o `change_set` não conhece esses veículos. Nesta rubrica isso
 * é quase tudo — três das cinco colunas são taxa fixa.
 *
 * A mesma leitura serve às duas respostas, e por isso elas vêm juntas: o aparato
 * e as parcelas do custo fixo do mesmo ativo saem da mesma linha de
 * `getEntityTable`. Separá-las em duas rotas significaria ler o acervo inteiro
 * duas vezes para responder a duas metades da mesma pergunta — e correr o risco
 * de as duas metades caírem em leituras diferentes.
 */
router.get("/seguro/totais", async (req, res): Promise<void> => {
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

  const valores: ValorDeSeguro[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      for (const entityType of ["CAVALO", "CARRETA"] as const) {
        /*
          Os códigos do aparato saem do catálogo, e não de uma segunda lista
          aqui: a decisão de quais colunas compõem esta rubrica é uma só, e mora
          em `seguro.ts`. As três parcelas do custo fixo entram por fora porque
          não são desta rubrica — são o que permite conferi-la.
        */
        const doTipo = new Map<string, string>();
        for (const v of VARIAVEIS_DE_SEGURO) {
          const code = v.codigo[entityType];
          if (code) doTipo.set(v.chave, code);
        }
        const parcelas = entityType === "CARRETA" ? PARCELAS_DO_CUSTO_FIXO : null;
        const colunas = [...doTipo.values(), ...(parcelas ? Object.values(parcelas) : [])];
        if (colunas.length === 0) continue;

        const tabela = await getEntityTable(
          db,
          entityType,
          colunas,
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
            seguro: ler(linha, doTipo.get("seguro")),
            revestimento: ler(linha, doTipo.get("revestimento")),
            tacografo: ler(linha, doTipo.get("tacografo")),
            faixaReflexiva: ler(linha, doTipo.get("faixa_reflexiva")),
            rastreador: ler(linha, doTipo.get("rastreador")),
            custoFixo: ler(linha, parcelas?.custoFixo),
            finame: ler(linha, parcelas?.finame),
            lucroFixoConjunto: ler(linha, parcelas?.lucroFixoConjunto),
          });
        }
      }
    }
  } catch (err) {
    /* Pedir o escopo do par é pedir um recorte que pode não ter contexto — e a
       recusa de recorte é frase para quem opera, não 500. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Totais de seguro e aparato recusados");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  res.json({
    totais: totaisDeSeguroPorVigencia(valores),
    conferencias: conferenciaDoAparato(valores),
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
 * `GET /seguro/candidatos?para=<snapshotId>`
 *
 * Irmã de `/ipva/candidatos`, e deliberadamente sem uma linha de regra própria:
 * o orçamento, o reaproveitamento do que já foi comparado e o recorte por
 * unidade e cobertura moram em `lib/candidatas-do-par.ts`. O que entra aqui é o
 * recorte do aparato — quais atributos ler, e como contar o que mudou neles.
 *
 * **O dinheiro desce por `impactoPublicavel`, e não em cru.** Nesta rubrica o
 * caso comum é o terceiro estado daquela função: o aparato se move e nada disso
 * vira real, porque a curadoria ainda não confirmou a semântica das colunas. A
 * rota que publicava `baldes: []` sem mais nada punha `R$ 0,00` no menu ao lado
 * do cartão que dizia, do mesmo par, "Sem impacto precificável" — o menu
 * afirmando uma conta que o portão de `viraDinheiro` tinha acabado de recusar.
 */
router.get("/seguro/candidatos", async (req, res, next): Promise<void> => {
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
          attributeCodes: CODIGOS_DO_DETALHE_DE_SEGURO,
/* Placa é o grão desta tela: cavalo e carreta, e mais nada. O trecho
             pode existir no acervo e até vir dentro da mesma vigência — ele
             não é assunto daqui, e não entra nem na lista nem na conta. */
          entityTypes: TIPOS_DE_EQUIPAMENTO,
          numeros: (rows) => {
            const linhas = linhasDeSeguro(rows);
            /* A frota entra zerada: esta rota não publica "veículos
               comparados", só o que se moveu. */
            const { variaveisAlteradas, impacto } = resumirSeguro(linhas, {
              comparados: 0,
              novos: 0,
              ausentes: 0,
            });
            /*
              O `naoCalculavel` decide se a linha pode escrever `R$ 0,00`.

              Sem ele, a resposta desta rota descia com `baldes: []` e o menu
              escrevia zero — enquanto o cartão da mesma tela, lendo o mesmo
              `porPeriodicidade`, dizia "Sem impacto precificável". Duas telas,
              o mesmo par, e só uma delas contando a verdade: as alterações de
              seguro existem, e é a semântica que falta, não o movimento.
            */
            return {
              alteracoes: variaveisAlteradas,
              ...impactoPublicavel(impacto.porPeriodicidade, {
                naoPublicadas: impacto.naoCalculavel,
                semImpacto: SEM_IMPACTO_PRECIFICAVEL_DE_SEGURO,
              }),
            };
          },
        },
        { operacao, computedBy: "api:seguro-candidatos" },
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
    req.log.warn({ err }, "Candidatas de seguro e aparato recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

export default router;
