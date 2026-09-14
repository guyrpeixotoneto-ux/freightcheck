import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  balancoDaImportacao,
  celulasEmFato,
  listarBalancos,
  runsDeProveniencia,
  type BalancoResumo,
} from "@workspace/balance";
import {
  alcanceDosRuns,
  resolveContext,
  vigenciasVivasDoRecorte,
} from "@workspace/comparison";
import { parseContext } from "../lib/contexto";
import { recorteDaAuditoria } from "../lib/ambiente-da-auditoria";
import { nivelDoAmbiente, permissoesDe } from "../lib/permissoes";

/**
 * Rastreio de Dados — a conta de conservação de cada importação (o balanço
 * de massa).
 *
 * Duas rotas, e a diferença entre elas é a pergunta: a lista responde *se* a
 * massa fecha, em todas as importações; o detalhe responde *onde* ela não
 * fecha, com o endereço da célula.
 *
 * Só leitura, e sem parâmetro de recorte. Este módulo não pergunta por unidade
 * nem por canal de propósito: o balanço é sobre o arquivo que chegou, e um
 * arquivo é de uma importação só. Filtrar por contexto aqui daria a impressão
 * de que existe massa "de outra unidade" que explicaria a que falta.
 *
 * ---------------------------------------------------------------------------
 * E uma terceira rota, que faz a pergunta inversa: `/balance/recorte`
 * ---------------------------------------------------------------------------
 *
 * O parágrafo acima continua valendo **para `/balance`**, e é por isso que ele
 * não foi reescrito: a conservação é do arquivo, e ela é global por contrato.
 * O que ele não responde é a outra pergunta, que uma leitura de auditoria faz o
 * tempo todo: *qual a qualidade das fontes que alimentam o recorte que está na
 * tela?* Responder a essa com o número global foi um defeito de verdade — o
 * Panorama de uma unidade publicava a cobertura de todo o acervo, e a Visão
 * Geral publicava o mesmo número, porque ele nunca foi de unidade nenhuma.
 *
 * São duas rotas porque são duas perguntas, e a diferença entre elas é o que
 * `lib/balance/src/proveniencia.ts` já escrevia antes de existir chamador:
 * *"não se afirma que uma célula residual pertence a PERNAMBUCO, e sim que ela
 * pertence a um arquivo que alimentou PERNAMBUCO naquele recorte"*. A métrica é
 * **qualidade das fontes deste recorte**, nunca uma partição exclusiva da massa.
 *
 * Daí as três recusas do contrato de `/balance/recorte`:
 *
 * 1. **Não existe percentual na resposta.** Cobertura auditada recortada não é
 *    grandeza bem definida: o resíduo — célula que não chegou a destino — nunca
 *    virou fato, logo não tem unidade nem vigência a que pertencer. Um
 *    percentual convidaria a tela a publicá-lo como se tivesse.
 * 2. **Resíduo não se rateia.** Ele é do arquivo, e mora em `conservacao`.
 * 3. **`celulasDosArquivos` não é "células deste recorte".** É a massa integral
 *    dos arquivos que o alimentaram, e pode conter célula de outros recortes; o
 *    nome carrega a ressalva porque a soma de três recortes daria o triplo do
 *    acervo. A grandeza do recorte é `atribuido.celulasEmFato`.
 *
 * **Isolamento.** Diferente de `/balance`, esta rota exige `operacao` e
 * `ambiente`, e o ambiente é a autoridade sobre a operação
 * (`lib/ambiente-da-auditoria.ts`). É a primeira rota de **leitura** deste
 * servidor a consultar permissão, e a exceção é nomeada: o portão
 * (`middlewares/portao-de-permissao.ts`) recusa só escrita porque as leituras
 * são compartilhadas entre telas — `/changes` serve o Dashboard, as Alterações e
 * o Resumo —, e fingir bloqueio sobre endpoint compartilhado quebraria tela
 * permitida para proteger nada. Esta rota nasce com **uma** tela e uma
 * pergunta: a justificativa daquela regra não a alcança.
 */
const router: IRouter = Router();

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/balance", async (req, res): Promise<void> => {
  res.json(await listarBalancos(db));
});

/** A procedência de um recorte — as fontes que alimentaram o que está na tela. */
export interface BalancoDoRecorte {
  /** O recorte **resolvido**, nunca o pedido. É o que a tela deve rotular. */
  recorte: {
    operacao: string;
    scopeHash: string;
    canal: string | null;
    period: string;
    label: string;
  };
  /**
   * Os arquivos que trouxeram os fatos deste recorte, com o balanço de cada um.
   *
   * O balanço é o do **arquivo inteiro** — a única conta em que resíduo
   * significa algo. `alcance` diz o que mais aquele arquivo alimentou, para que
   * a tela não leia a massa dele como massa deste recorte.
   */
  importacoes: Array<
    BalancoResumo & {
      alcance: {
        contextos: number;
        vigencias: string[];
        exclusivoDesteRecorte: boolean;
        /**
         * Se o alcance deste arquivo foi de fato medido.
         *
         * `false` é o caso que não deveria acontecer — todo run de origem tem ao
         * menos uma vigência —, e existe para que ele não passe como
         * exclusividade. Afirmar "este arquivo só alimenta este recorte" sobre
         * um arquivo que ninguém mediu é a classe de erro que esta rota existe
         * para desfazer.
         */
        medido: boolean;
      };
    }
  >;
  conservacao: {
    arquivos: number;
    fecham: number;
    /**
     * A massa **integral** dos arquivos acima.
     *
     * Inclui células atribuídas a outros recortes — não é "células deste
     * recorte". A grandeza deste recorte é {@link atribuido}.
     */
    celulasDosArquivos: number;
    /** Do arquivo, e nunca rateado: célula sem destino não tem recorte. */
    residuo: number;
    /** `true` quando todo arquivo acima alimentou só este recorte. */
    exclusivaDesteRecorte: boolean;
  };
  /** A grandeza deste recorte. Contagem, e nunca percentual. */
  atribuido: { vigenciasVivas: number; celulasEmFato: number };
  /** A última importação **deste recorte** — não a do acervo. */
  ultima: { importRunId: string; filename: string; status: string; receivedAt: string } | null;
}

router.get("/balance/recorte", async (req, res, next): Promise<void> => {
  const query = req.query as Record<string, unknown>;

  /*
    A ordem das recusas é parte do contrato: forma primeiro (400), pessoa depois
    (403), acervo por último (404). Nenhuma das duas primeiras resolve contexto,
    e é isso que as mantém mudas sobre a existência de unidade e vigência.
  */
  const recorte = recorteDaAuditoria(query);
  if (!recorte.ok) {
    res.status(400).json({ error: recorte.error, code: recorte.code });
    return;
  }

  if (!req.user) {
    res.status(401).json({ error: "Sessão necessária." });
    return;
  }

  try {
    /*
      `VISUALIZAR` passa. O nível separa leitura de escrita, e recusar leitura a
      quem tem leitura seria inventar um terceiro significado para o enum.

      A conta que vale é `req.user` — num "visualizar como", a **visualizada**:
      ver o produto pelos olhos de alguém é exactamente o que se foi fazer, e é
      a conta que o menu e as permissões seguem. `donoDaSessao` responde pelo
      log e pela recusa de escrita, nunca pela leitura.
    */
    const nivel = nivelDoAmbiente(await permissoesDe(db, req.user.id), recorte.ambiente);
    if (nivel !== "VISUALIZAR" && nivel !== "EDITAR") {
      res.status(403).json({
        error: "Você não trabalha neste ambiente. Peça a um administrador em Configurações › Permissões.",
        code: "SEM_ACESSO_AO_AMBIENTE",
        ambiente: recorte.ambiente,
        nivel,
      });
      return;
    }

    /*
      O recorte não é filtro recebido do cliente: `parseContext` lê a query e
      `resolveContext` o resolve contra os contextos **daquela operação**. Um
      `scopeHash` de outra auditoria não acha contexto e vira 404 — a recusa é
      escrita, e nunca uma tela de rota mostrando números de empurrada.

      A operação vem do ambiente, e não do que o cliente mandou: o par já foi
      conferido acima, e sobrescrevê-la aqui é o que garante que a consulta use a
      autorizada mesmo que a query traga outra coisa.
    */
    const pedido = { ...(parseContext(query) ?? {}), operacao: recorte.operacao };
    const contexto = await resolveContext(db, pedido);
    if (contexto === null) {
      res.status(404).json({
        error: "Nenhuma vigência importada nesta operação.",
        code: "SEM_ACERVO",
      });
      return;
    }

    /*
      Sem `?period=`, a competência é a mais recente **deste contexto** — a
      mesma régua dos outros módulos. Com ela, tem de ser uma vigência que este
      contexto entregou: responder a mais próxima seria o número certo sob o
      título errado.
    */
    const pedida = typeof query["period"] === "string" ? query["period"] : null;
    const period = pedida ?? contexto.latestPeriod;
    if (pedida !== null && !contexto.periodosDisponiveis.includes(pedida)) {
      res.status(400).json({
        error: "Esta competência não é uma vigência deste recorte.",
        code: "PERIODO_FORA_DO_RECORTE",
      });
      return;
    }

    const vivas = await vigenciasVivasDoRecorte(db, contexto, period);
    const snapshotIds = vivas.map((v) => v.snapshotId);

    /*
      `runsDeProveniencia` e não os donos das vigências: a origem é do **fato**
      (`fact.origin_import_run_id`), e numa revisão parcial o dono da vigência é
      a última revisão que a tocou — ela atribuiria as carretas ao arquivo que
      não as trouxe. Ver o cabeçalho de `lib/balance/src/proveniencia.ts`.
    */
    const runs = await runsDeProveniencia(db, snapshotIds);
    const [importacoes, alcance, celulas] = await Promise.all([
      listarBalancos(db, { importRunIds: runs }),
      alcanceDosRuns(db, runs),
      celulasEmFato(db, snapshotIds),
    ]);

    const comAlcance = importacoes.map((b) => {
      const dele = alcance.get(b.importRunId);
      /*
        Sem medição não há exclusividade a declarar. O contrário — o que esta
        rota fazia antes — era assumir `contextos: 1` e chamar o arquivo de
        exclusivo, o que punha a ressalva da tela em silêncio justamente no caso
        em que ela é necessária.
      */
      if (dele === undefined) {
        return {
          ...b,
          alcance: {
            contextos: 0,
            vigencias: [],
            exclusivoDesteRecorte: false,
            medido: false,
          },
        };
      }
      return {
        ...b,
        alcance: {
          contextos: dele.contextos,
          vigencias: dele.vigencias,
          exclusivoDesteRecorte: dele.contextos <= 1 && dele.vigencias.length <= 1,
          medido: true,
        },
      };
    });

    const ultima = comAlcance.reduce<BalancoDoRecorte["ultima"]>((maior, b) => {
      const quando = new Date(b.recebidoEm).toISOString();
      if (maior !== null && maior.receivedAt >= quando) return maior;
      return {
        importRunId: b.importRunId,
        filename: b.filename,
        status: b.status,
        receivedAt: quando,
      };
    }, null);

    const corpo: BalancoDoRecorte = {
      recorte: {
        operacao: recorte.operacao,
        scopeHash: contexto.scopeHash,
        canal: contexto.channel,
        period,
        label: contexto.label,
      },
      importacoes: comAlcance,
      conservacao: {
        arquivos: comAlcance.length,
        fecham: comAlcance.filter((b) => b.fecha).length,
        celulasDosArquivos: comAlcance.reduce((t, b) => t + b.entrada, 0),
        residuo: comAlcance.reduce((t, b) => t + b.residuo, 0),
        /*
          Exclusiva só quando **todo** arquivo foi medido e é exclusivo. Um
          arquivo sem medição derruba a exclusividade em vez de ser ignorado: a
          tela publica a ressalva, que é a resposta conservadora certa.
        */
        exclusivaDesteRecorte: comAlcance.every(
          (b) => b.alcance.medido && b.alcance.exclusivoDesteRecorte,
        ),
      },
      atribuido: { vigenciasVivas: vivas.length, celulasEmFato: celulas },
      ultima,
    };

    res.json(corpo);
  } catch (err) {
    /*
      `next(err)` e nada mais. `ContextNotFoundError` → 404 e `JanelaInvalida
      Error` → 400 já são doutrina do produto, numa tabela só
      (`lib/recusa-de-dominio.ts`), aplicada pelo contrato de erro
      (`middlewares/contrato-json.ts`). Mapear aqui daria uma segunda opinião
      sobre o mesmo erro — e é assim que duas rotas passam a discordar sobre o
      que é 404.
    */
    next(err);
  }
});

/*
  **Esta rota vem depois de `/balance/recorte`, e a ordem é carga.** `:importRunId`
  casa com qualquer segmento, `recorte` incluído: declarada antes, ela atenderia
  a rota do recorte e responderia "identificador de importação inválido" sobre um
  endereço perfeitamente válido. Quem prova que a ordem está de pé são os casos de
  `balance-recorte.test.ts`, que receberiam 400 no lugar de 200.
*/
router.get("/balance/:importRunId", async (req, res): Promise<void> => {
  const { importRunId } = req.params;
  if (!UUID.test(importRunId)) {
    res.status(400).json({ error: "Identificador de importação inválido." });
    return;
  }
  const balanco = await balancoDaImportacao(db, importRunId);
  if (!balanco) {
    res.status(404).json({ error: "Importação não encontrada." });
    return;
  }
  res.json(balanco);
});

export default router;
