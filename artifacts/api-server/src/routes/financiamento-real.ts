import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  compararCompetencia,
  GRANULARIDADE_DO_REALIZADO,
  GRANULARIDADE_DO_REMUNERADO,
  lerLancamentosDaPlaca,
  lerPendenciasDoReal,
  lerRealizadoDaCompetencia,
  lerRemuneradoDoMes,
  listarCompetenciasDoReal,
  notaDaQuinzenaIsolada,
  resumirCompetencia,
} from "@workspace/comparison";
import { periodLabel } from "@workspace/comparison/labels";
import { classificarFalha } from "../lib/classificar-falha";
import { operacaoDaConsulta } from "../lib/operacao";

/**
 * O FINANCIAMENTO REAL — o que o banco cobrou, ao lado do que a Ambev paga.
 *
 * ---------------------------------------------------------------------------
 * O que esta rota não faz
 * ---------------------------------------------------------------------------
 * Não compara e não soma. `compararCompetencia` e `resumirCompetencia`
 * (`@workspace/comparison/finame-real`) decidem, e são funções puras que o
 * navegador importa também — é isso que faz o cartão do topo e a linha da tabela
 * nunca discordarem. Aqui se lê os dois lados e se costura os três.
 *
 * ---------------------------------------------------------------------------
 * A regra que atravessa o recorte inteiro
 * ---------------------------------------------------------------------------
 * **Um valor de cada lado.** O remunerado é mensal dentro de uma vigência
 * quinzenal (medido: em agosto/2026, 111 de 111 placas trazem o mesmo número
 * nas duas quinzenas), então somar as duas dobraria o custo. Quando elas
 * discordam — o que não acontece no acervo de hoje —, a linha sai como achado,
 * nunca como média.
 */
const router: IRouter = Router();

/** A competência que a consulta pediu, ou a mais recente que existir. */
function competenciaDaConsulta(query: Record<string, unknown>): string | null {
  const bruta = query["competencia"];
  if (typeof bruta !== "string" || bruta.trim() === "") return null;
  const limpa = bruta.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(limpa) ? limpa : null;
}

/**
 * As competências disponíveis, com o estado de cada uma.
 *
 * A marca de parcial é calculada aqui sobre a contagem de lançamentos por
 * competência — a mesma régua da importação (abaixo de 70% da mediana das
 * demais), aplicada ao que está no banco em vez de ao que estava no arquivo.
 * Um mês que chegou parcial e foi completado depois deixa de ser parcial sem
 * que ninguém precise reimportar nada.
 */
router.get("/financiamento-real/competencias", async (req, res, next): Promise<void> => {
  try {
    const canal = operacaoDaConsulta(req.query as Record<string, unknown>);
    const [competencias, pendencias] = await Promise.all([
      listarCompetenciasDoReal(db, { canal }),
      lerPendenciasDoReal(db),
    ]);

    const contagens = pendencias.porCompetencia.map((c) => c.lancamentos).sort((a, b) => a - b);
    const mediana =
      contagens.length === 0
        ? 0
        : contagens.length % 2 === 0
          ? (contagens[contagens.length / 2 - 1] + contagens[contagens.length / 2]) / 2
          : contagens[Math.floor(contagens.length / 2)];

    res.json({
      granularidade: {
        remunerado: GRANULARIDADE_DO_REMUNERADO,
        realizado: GRANULARIDADE_DO_REALIZADO,
      },
      competencias: competencias.map((c) => {
        const apurada = pendencias.porCompetencia.find(
          (p) => p.competencia === c.competencia,
        );
        const lancamentos = apurada?.lancamentos ?? 0;
        const proporcao = mediana === 0 ? 1 : lancamentos / mediana;
        const parcial = contagens.length > 2 && proporcao < 0.7;
        return {
          ...c,
          rotulo: periodLabel(c.competencia),
          lancamentos,
          placas: apurada?.placas ?? 0,
          parcial,
          motivoParcial: parcial
            ? `A competência traz ${lancamentos} lançamentos, ${Math.round(proporcao * 100)}% da ` +
              `mediana das demais (${mediana}). Pode estar parcial — confira antes de comparar.`
            : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * A comparação de uma competência: remunerado mensal contra realizado mensal.
 */
router.get("/financiamento-real/comparacao", async (req, res, next): Promise<void> => {
  try {
    const canal = operacaoDaConsulta(req.query as Record<string, unknown>);
    const pedida = competenciaDaConsulta(req.query as Record<string, unknown>);

    const competencias = await listarCompetenciasDoReal(db, { canal });
    if (competencias.length === 0) {
      res.json({
        competencia: null,
        motivo:
          "Nenhuma competência do financiamento real foi importada ainda. O extrato do ERP entra " +
          "pela aba Real da tela de Importações, escolhendo a unidade e o mês.",
        linhas: [],
        resumo: null,
        competencias: [],
      });
      return;
    }

    /*
      A competência pedida, ou a mais recente. Uma competência pedida que não
      existe cai na mais recente **de propósito**: o endereço é compartilhável, e
      um link para um mês que ainda não foi importado precisa abrir a tela em vez
      de dar erro — a resposta diz qual competência respondeu.
    */
    const alvo =
      competencias.find((c) => c.competencia === pedida) ?? competencias[0];

    const [realizado, remunerado, pendencias] = await Promise.all([
      lerRealizadoDaCompetencia(db, alvo.competencia, { canal }),
      lerRemuneradoDoMes(db, alvo.competencia, { canal }),
      lerPendenciasDoReal(db),
    ]);

    /*
      A marca de parcial é da competência, e viaja com cada linha dela: quem
      olha uma placa isolada precisa saber que o mês pode não ter fechado tanto
      quanto quem olha o total.
    */
    const contagens = pendencias.porCompetencia.map((c) => c.lancamentos).sort((a, b) => a - b);
    const mediana =
      contagens.length === 0 ? 0 : contagens[Math.floor(contagens.length / 2)];
    const daCompetencia = pendencias.porCompetencia.find(
      (p) => p.competencia === alvo.competencia,
    );
    const proporcao =
      mediana === 0 || !daCompetencia ? 1 : daCompetencia.lancamentos / mediana;
    const parcial = contagens.length > 2 && proporcao < 0.7;
    const motivoParcial = parcial
      ? `A competência traz ${daCompetencia?.lancamentos ?? 0} lançamentos, ` +
        `${Math.round(proporcao * 100)}% da mediana das demais (${mediana}). ` +
        `Pode estar parcial — confira antes de comparar.`
      : null;

    const linhas = compararCompetencia(
      alvo.competencia,
      remunerado,
      realizado.map((r) => ({ ...r, parcial, motivoParcial })),
    );

    res.json({
      competencia: alvo.competencia,
      rotulo: periodLabel(alvo.competencia),
      canal: alvo.canal,
      sourceLabel: alvo.sourceLabel,
      unidades: alvo.unidades,
      granularidade: {
        remunerado: GRANULARIDADE_DO_REMUNERADO,
        realizado: GRANULARIDADE_DO_REALIZADO,
        /* A frase da regra 4: o realizado é do mês, e não da quinzena aberta. */
        quinzenaIsolada: notaDaQuinzenaIsolada(1, periodLabel(alvo.competencia)),
      },
      parcial,
      motivoParcial,
      quinzenasLidas: [...new Set(remunerado.map((r) => r.label))].sort(),
      resumo: resumirCompetencia(alvo.competencia, linhas),
      linhas,
      competencias: competencias.map((c) => ({
        competencia: c.competencia,
        rotulo: periodLabel(c.competencia),
      })),
    });
  } catch (err) {
    /*
      Uma recusa de regra é 422 com a frase dela; qualquer outra coisa segue
      para o tratador geral, que a registra inteira e responde genérico. É a
      mesma divisão das outras rotas — o banco não fala com quem opera.
    */
    const falha = classificarFalha(err);
    if (falha.tipo === "REGRA") {
      res.status(422).json({ error: falha.mensagem });
      return;
    }
    next(err);
  }
});

/**
 * As pendências: o que ficou de fora da soma, e por quê.
 *
 * As duas filas que a importação produz — duplicata provável e placa sem
 * classificação — numa resposta só, porque na tela elas são o mesmo bloco: "o
 * que este número ainda não inclui".
 */
router.get("/financiamento-real/pendencias", async (_req, res, next): Promise<void> => {
  try {
    const pendencias = await lerPendenciasDoReal(db);
    res.json({
      duplicatas: pendencias.duplicatas,
      semClassificacao: pendencias.semClassificacao,
      valorRetido: Number(
        pendencias.duplicatas.reduce((soma, d) => soma + d.valor, 0).toFixed(2),
      ),
      valorSemClassificacao: Number(
        pendencias.semClassificacao.reduce((soma, s) => soma + s.valor, 0).toFixed(2),
      ),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Os lançamentos por trás de um número — o rastreio até a linha do arquivo.
 */
router.get("/financiamento-real/lancamentos", async (req, res, next): Promise<void> => {
  try {
    const competencia = competenciaDaConsulta(req.query as Record<string, unknown>);
    const placa = String((req.query as Record<string, unknown>)["placa"] ?? "").trim();
    if (competencia === null || placa === "") {
      res.status(400).json({
        error:
          "Informe a competência (YYYY-MM-01) e a placa para ver os lançamentos que compõem o valor.",
      });
      return;
    }

    const lancamentos = await lerLancamentosDaPlaca(db, competencia, placa);
    res.json({
      competencia,
      placa,
      lancamentos,
      total: Number(
        lancamentos
          .filter((l) => l.status === "ACEITO")
          .reduce((soma, l) => soma + l.valor, 0)
          .toFixed(2),
      ),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
