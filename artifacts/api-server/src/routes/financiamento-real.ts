import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { financiamentoRealDecisaoTable } from "@workspace/db/schema";
import { lerLancamentosDaPlaca, lerPendenciasDoReal } from "@workspace/comparison";
import { somarCentavos } from "@workspace/ingest/dinheiro";
import {
  aplicarDecisaoDoReal,
  AplicacaoRecusada,
} from "@workspace/ingest/financiamento-real";
import { operacaoDaConsulta } from "../lib/operacao";

/**
 * O QUE FICOU DE FORA DO REALIZADO — as pendências e o rastreio.
 *
 * ---------------------------------------------------------------------------
 * Por que estas rotas não são o confronto
 * ---------------------------------------------------------------------------
 * O confronto Remunerado × Realizado mora em `finame.ts` (`GET
 * /finame/confronto`), e o número do realizado chega lá pela fonte registrada —
 * o adaptador que lê o acervo importado. Nada disso se repete aqui.
 *
 * O que estas três rotas respondem é a outra metade da honestidade daquele
 * número: **o que não entrou nele**, e de onde ele veio.
 *
 * - as duas filas que a importação do extrato produz — a linha repetida que
 *   ficou retida e a placa cujo tipo o cadastro não resolveu —, com o valor em
 *   jogo em cada uma;
 * - os lançamentos contábeis por trás de um valor, até a linha do arquivo;
 * - a decisão de uma pessoa sobre uma pendência.
 *
 * Um consolidado que esconde o que ficou de fora é uma soma sem origem, e é por
 * isso que estas rotas existem ao lado do confronto em vez de dentro dele: quem
 * audita precisa das duas coisas, e elas mudam em ritmos diferentes.
 */
const router: IRouter = Router();

/** As três decisões que a tela registra. A lista mora no domínio. */
const TIPOS_DE_DECISAO = [
  "DUPLICATA_CONFIRMADA",
  "LANCAMENTOS_DISTINTOS",
  "CLASSIFICAR_ATIVO",
] as const;

/**
 * A competência no formato que o rastreio usa — `YYYY-MM-01`, o dia 1.
 *
 * `2026-09` (como a auditoria de FINAME escreve uma competência) e `2026-09-01`
 * (como a vigência a guarda) são o mesmo mês; aceitar as duas evita que a tela
 * tenha de saber qual formato esta rota prefere.
 */
function competenciaDaConsulta(query: Record<string, unknown>): string | null {
  const bruta = query["competencia"];
  if (typeof bruta !== "string" || bruta.trim() === "") return null;
  const limpa = bruta.trim();
  if (/^\d{4}-\d{2}$/.test(limpa)) return `${limpa}-01`;
  return /^\d{4}-\d{2}-\d{2}$/.test(limpa) ? limpa : null;
}

/**
 * As pendências: o que ficou de fora da soma, e por quê.
 *
 * As duas filas numa resposta só, porque na tela elas são o mesmo bloco — "o
 * que este número ainda não inclui".
 */
router.get("/financiamento-real/pendencias", async (req, res, next): Promise<void> => {
  try {
    /*
      O recorte por operação, como em toda leitura de acervo deste servidor: uma
      pendência é de uma vigência, a vigência é de um canal, e quem audita a Rota
      não tem por que ver o que ficou de fora na Empurrada.
    */
    const canal = operacaoDaConsulta(req.query as Record<string, unknown>);
    const pendencias = await lerPendenciasDoReal(db, { canal });
    res.json({
      duplicatas: pendencias.duplicatas,
      semClassificacao: pendencias.semClassificacao,
      /*
        `somarCentavos`, e não `Number(soma.toFixed(2))`.

        Era aqui que o produto tinha a segunda regra de arredondamento, e ela
        errava justamente neste número: as cinco duplicatas de 2026 somam
        R$ 21.206,765, e `toFixed` devolvia 21.206,76 porque arredonda o binário
        e não o decimal. Ver `@workspace/ingest/dinheiro`.
      */
      valorRetido: somarCentavos(pendencias.duplicatas.map((d) => d.valor)),
      valorSemClassificacao: somarCentavos(pendencias.semClassificacao.map((s) => s.valor)),
    });
  } catch (err) {
    next(err);
  }
});

/** Os lançamentos por trás de um número — o rastreio até a linha do arquivo. */
router.get("/financiamento-real/lancamentos", async (req, res, next): Promise<void> => {
  try {
    const competencia = competenciaDaConsulta(req.query as Record<string, unknown>);
    const placa = String((req.query as Record<string, unknown>)["placa"] ?? "").trim();
    if (competencia === null || placa === "") {
      res.status(400).json({
        error:
          "Informe a competência (AAAA-MM) e a placa para ver os lançamentos que compõem o valor.",
      });
      return;
    }

    const canal = operacaoDaConsulta(req.query as Record<string, unknown>);
    const lancamentos = await lerLancamentosDaPlaca(db, competencia, placa, { canal });
    res.json({
      competencia,
      placa,
      lancamentos,
      /* A mesma regra única do resto do produto. Este `total` é o que a expansão
         da placa confere contra o consolidado da vigência, e um `toFixed` aqui
         voltaria a discordar dele no meio centavo. Ver
         `@workspace/ingest/dinheiro`. */
      total: somarCentavos(
        lancamentos.filter((l) => l.status === "ACEITO").map((l) => l.valor),
      ),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Registrar uma decisão sobre o que ficou de fora da soma — **sem** aplicá-la.
 *
 * Quem clica "Classificar e aplicar" na tela não passa por aqui: passa por
 * `/financiamento-real/decisoes/aplicar`, abaixo, que grava a decisão e publica
 * a revisão da vigência no mesmo ato. Esta rota continua existindo para o caso
 * em que registrar é o que se quer — anotar a conclusão sem mexer no acervo —,
 * e o texto abaixo descreve exatamente esse caso.
 *
 * ---------------------------------------------------------------------------
 * Por que a decisão é gravada, e não aplicada
 * ---------------------------------------------------------------------------
 * Esta rota escreve uma linha em `financiamento_real_decisao` e nada mais: ela
 * **não** refaz o consolidado. A apuração é função pura das linhas do arquivo
 * mais as decisões conhecidas, e a decisão gravada aqui passa a valer na próxima
 * leitura daquele extrato — a de quem reimportar o mês, ou a que a rota de
 * aplicação abre sozinha.
 *
 * Publicar é o que ela não faz, e é o corte entre as duas: anotar uma conclusão
 * não pede o mesmo de quem chama que abrir revisão de vigência. A resposta diz
 * isso com todas as letras, para que a tela possa dizer também.
 *
 * Append-only: uma decisão revista não apaga a anterior. Quem lê pega a mais
 * recente da chave, e o histórico continua legível — "foi confirmada como
 * duplicata em setembro e desconfirmada em outubro, por fulano, com este
 * motivo". Um `UPDATE` no lugar transformaria a mudança de opinião num estado
 * sem passado.
 */
router.post("/financiamento-real/decisoes", async (req, res, next): Promise<void> => {
  try {
    const corpo = req.body as Record<string, unknown>;
    const tipo = String(corpo["tipo"] ?? "").trim();
    const chave = String(corpo["chave"] ?? "").trim();
    const motivo = String(corpo["motivo"] ?? "").trim();
    const valor =
      typeof corpo["valor"] === "string" && corpo["valor"].trim() !== ""
        ? corpo["valor"].trim()
        : null;

    if (!TIPOS_DE_DECISAO.includes(tipo as (typeof TIPOS_DE_DECISAO)[number])) {
      res.status(400).json({
        error: `"${tipo}" não é uma decisão conhecida. As três são: ${TIPOS_DE_DECISAO.join(", ")}.`,
      });
      return;
    }
    if (chave === "") {
      res.status(400).json({ error: "A decisão precisa dizer sobre o que ela é." });
      return;
    }
    /*
      O motivo é obrigatório, e não é burocracia: uma decisão sem motivo não é
      auditável, e daqui a seis meses ninguém vai lembrar por que aquelas duas
      linhas viraram uma só.
    */
    if (motivo === "") {
      res.status(400).json({
        error:
          "Escreva o motivo da decisão. Sem ele, quem ler o histórico daqui a seis meses " +
          "vê o que foi decidido e não por quê.",
      });
      return;
    }
    if (tipo === "CLASSIFICAR_ATIVO" && valor === null) {
      res.status(400).json({
        error: "Classificar um ativo exige dizer de que tipo ele é.",
      });
      return;
    }

    const [gravada] = await db
      .insert(financiamentoRealDecisaoTable)
      .values({
        tipo,
        chave,
        valor,
        motivo,
        decididoPor: req.user?.email ?? "desconhecido",
      })
      .returning();

    res.status(201).json({
      decisao: gravada,
      efeito:
        "A decisão ficou registrada e vale na próxima leitura deste extrato. O valor " +
        "consolidado não mudou agora: esta rota grava a decisão e não publica. Para " +
        "que ela vire número, use /financiamento-real/decisoes/aplicar — ou reimporte " +
        "o mês.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * Registrar a decisão **e aplicá-la** — o que a tela chama de "Classificar e
 * aplicar".
 *
 * ---------------------------------------------------------------------------
 * Por que é outra rota, e não um campo na de cima
 * ---------------------------------------------------------------------------
 * Porque as duas pedem coisas diferentes de quem chama. Registrar é anotar o
 * que alguém concluiu; aplicar publica no acervo — abre revisão nova da
 * vigência, com os mesmos poderes de aprovar uma importação. O portão de
 * permissão deste servidor é por caminho (`ESCRITAS_POR_MODULO`), então dar à
 * aplicação um caminho próprio é o que permite exigir dela o nível do módulo
 * Importações sem cobrar o mesmo de quem só anota.
 *
 * O trabalho acontece **dentro** da requisição, ao contrário da aprovação de
 * uma importação. A diferença é de tamanho: aquela lê um arquivo inteiro do
 * zero e leva minutos; esta relê um RAW já capturado e promove as competências
 * que a decisão alcança — segundos, no extrato real de 2026. Responder 202 e
 * mandar a tela perguntar depois custaria à pessoa a única coisa que este botão
 * existe para entregar: ver o número mudar no clique.
 */
router.post("/financiamento-real/decisoes/aplicar", async (req, res, next): Promise<void> => {
  try {
    const corpo = req.body as Record<string, unknown>;
    const resultado = await aplicarDecisaoDoReal(
      db,
      {
        tipo: String(corpo["tipo"] ?? ""),
        chave: String(corpo["chave"] ?? ""),
        valor: typeof corpo["valor"] === "string" ? corpo["valor"] : null,
        motivo: String(corpo["motivo"] ?? ""),
        decididoPor: req.user?.email ?? "desconhecido",
      },
      { canal: operacaoDaConsulta(req.query as Record<string, unknown>) },
    );
    res.status(201).json(resultado);
  } catch (err) {
    /*
      A recusa nomeada vira 422 com o código: quem opera precisa saber **qual**
      conferência barrou — uma leitura aberta se resolve em Importações, uma
      decisão sem motivo se resolve no campo ao lado, e as duas viram a mesma
      tela inútil se a resposta for só "não deu".
    */
    if (err instanceof AplicacaoRecusada) {
      res.status(422).json({ error: err.message, codigo: err.codigo, ...err.detalhe });
      return;
    }
    next(err);
  }
});

export default router;
