import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  CODIGOS_DO_TMA,
  CODIGOS_LIDOS_DO_TMA,
  evolucaoDosLocais,
  evolucaoDosTrechos,
  getEntityTable,
  listComparableSnapshots,
  locaisDoTma,
  operacaoDoSnapshot,
  resumoPorVigencia,
  SEM_IMPACTO_DE_TMA,
  TIPO_DA_FONTE_DO_TMA,
  trechosDoTma,
  variaveisAlteradasDeTma,
  type ValorDeTma,
} from "@workspace/comparison";
import { candidatasDoPar, TETO_DE_CANDIDATAS_MS } from "../lib/candidatas-do-par";
import { classificarFalha } from "../lib/classificar-falha";
import { comTetoDeRota } from "../lib/timeout-de-rota";
import { exigirOperacaoDoRecurso, operacaoDaConsulta } from "../lib/operacao";
import { contextoDoPar } from "../lib/recorte-do-par";

/**
 * AUDITORIA DE TMA — o tempo de porta, por local e por trecho.
 *
 * ---------------------------------------------------------------------------
 * Uma rota só, e sem change set
 * ---------------------------------------------------------------------------
 * As auditorias de rubrica têm duas rotas: uma para o que o motor comparou, e
 * outra para o que só a leitura das duas pontas sabe. Esta tem uma só, e a razão
 * é o grão.
 *
 * **Um local não é uma entidade do acervo.** Ele é um nome que aparece em duas
 * colunas de trecho, e o motor pareia entidades — não há change set de "CAMAÇARI
 * como origem". O tempo de porta de um ciclo, que é a soma das duas colunas,
 * também não existe como coluna e portanto não existe como linha de change set.
 *
 * Então as duas leituras desta tela saem da mesma fonte: as duas vigências lidas
 * inteiras, agregadas em memória pelo núcleo. É o mesmo caminho de
 * `/ipva/totais` e `/km-rodado/totais` — e a tela diz por extenso que o que
 * mudou **em cada coluna de cada trecho** continua sendo do motor, em Alterações
 * e na Auditoria de Velocidade Média.
 *
 * Nenhuma conta mora aqui. `@workspace/comparison/tma` agrega, e esta rota lê e
 * devolve.
 */
const router: IRouter = Router();

/**
 * O par de vigências, recortado no tempo de porta.
 *
 * `GET /tma/comparacao?base=<snapshotId>&comparada=<snapshotId>`
 *
 * As duas pontas vêm na mesma resposta porque saem da mesma leitura, e porque a
 * pergunta da tela é sempre comparativa: um TMA de 90 minutos não se lê sozinho,
 * lê-se contra o da quinzena anterior e contra os outros trechos do mesmo local.
 */
router.get("/tma/comparacao", async (req, res): Promise<void> => {
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
  const snapshotA = vigencias.find((v) => v.id === base);
  const snapshotB = vigencias.find((v) => v.id === comparada);
  const pontas = [
    { ponta: "BASE" as const, snapshot: snapshotA },
    { ponta: "COMPARADA" as const, snapshot: snapshotB },
  ];

  const valores: ValorDeTma[] = [];

  try {
    for (const { ponta, snapshot } of pontas) {
      if (!snapshot) continue;
      const tabela = await getEntityTable(
        db,
        TIPO_DA_FONTE_DO_TMA,
        [...CODIGOS_LIDOS_DO_TMA],
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
          origem: texto(CODIGOS_DO_TMA.origem),
          destino: texto(CODIGOS_DO_TMA.destino),
          tmaOrigem: ler(CODIGOS_DO_TMA.tmaOrigem),
          tmaDestino: ler(CODIGOS_DO_TMA.tmaDestino),
          tmaOrigemLucro: ler(CODIGOS_DO_TMA.tmaOrigemLucro),
          tmaDestinoLucro: ler(CODIGOS_DO_TMA.tmaDestinoLucro),
          ciclo: ler(CODIGOS_DO_TMA.ciclo),
        });
      }
    }
  } catch (err) {
    /* Pedir o escopo do par é pedir um recorte que pode não ter contexto — e a
       recusa de recorte é frase para quem opera, não 500. */
    const desfecho = classificarFalha(err);
    if (desfecho.tipo !== "REGRA") throw err;
    req.log.warn({ err }, "Comparação de TMA recusada");
    res.status(422).json({ error: desfecho.mensagem });
    return;
  }

  const locais = locaisDoTma(valores);
  const trechos = trechosDoTma(valores);

  res.json({
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
    resumo: resumoPorVigencia(locais),
    locais,
    trechos,
    evolucaoDosLocais: evolucaoDosLocais(locais),
    evolucaoDosTrechos: evolucaoDosTrechos(trechos),
  });
});

/**
 * O que cada candidata a "De" produz contra o "Para" escolhido, no TMA.
 *
 * `GET /tma/candidatos?para=<snapshotId>`
 *
 * ---------------------------------------------------------------------------
 * Por que esta tela tem menu com número se a comparação dela não tem change set
 * ---------------------------------------------------------------------------
 * São duas perguntas diferentes, e só a segunda precisa do grão de local. O que
 * a tela mostra depois do clique é agregado — o tempo de porta de um local é a
 * média das linhas de trecho, e local não é entidade do acervo, daí a leitura
 * direta das duas pontas. O que o menu responde é anterior a isso: *vale a pena
 * abrir este par?* — e essa é exatamente a pergunta que o change set responde,
 * no grão em que o motor pareia, a coluna de cada trecho.
 *
 * Sem ela, esta era a única auditoria cujo seletor abria mudo: sete telas
 * escrevendo o que cada vigência produz, e uma lista de datas sem nada ao lado —
 * e coluna em branco, no seletor desta casa, quer dizer *ainda não calculei*.
 *
 * O número é de coluna movida, e não de dinheiro: `semImpacto` carrega a frase
 * do porquê (`SEM_IMPACTO_DE_TMA`), como no QLP. Minuto não vira real aqui.
 */
router.get("/tma/candidatos", async (req, res, next): Promise<void> => {
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
          attributeCodes: CODIGOS_LIDOS_DO_TMA,
          numeros: (rows) => ({
            alteracoes: variaveisAlteradasDeTma(rows),
            impacto: { baldes: [] },
            semImpacto: SEM_IMPACTO_DE_TMA,
          }),
        },
        { operacao, computedBy: "api:tma-candidatos" },
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
    req.log.warn({ err }, "Candidatas de TMA recusadas");
    res.status(422).json({ error: desfecho.mensagem });
  }
});

/**
 * Texto do acervo virando número — e nulo continuando nulo, nunca zero.
 *
 * Nesta rubrica o branco é uma espera que ninguém declarou, e não uma espera de
 * zero minuto: `Number("")` é `0`, e um zero inventado pela conversão puxaria a
 * média de um local para baixo e inventaria uma amplitude que não existe.
 */
function comoNumero(bruto: string | null): number | null {
  if (bruto === null || bruto.trim() === "") return null;
  const n = Number(bruto);
  return Number.isFinite(n) ? n : null;
}

export default router;
