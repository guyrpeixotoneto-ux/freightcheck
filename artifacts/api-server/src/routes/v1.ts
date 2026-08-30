import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  ensureImportStorageDir,
  getImportRun,
  getImportRunStatus,
  listImportRuns,
  receiveFile,
} from "@workspace/ingest";
import { CATALOGO_DE_ESCOPOS } from "@workspace/integrations";
import { chaveDeIntegracao } from "../middlewares/chave-de-integracao";
import { contextoDeSchema } from "../middlewares/contexto-de-schema";
import { operacaoDaConsulta } from "../lib/operacao";
import { decodeUpload, readInBackground } from "./imports";

/**
 * A PORTA DE API — o que um sistema de fora alcança, e onde ela para.
 *
 * Esta é a única superfície deste servidor que **não** tem sessão. Ela é
 * montada em `app.ts` antes de `requireSession`, e cada rota daqui declara o
 * escopo que exige; quem autentica e registra é `chaveDeIntegracao`.
 *
 * ---------------------------------------------------------------------------
 * A fronteira que ela não atravessa
 * ---------------------------------------------------------------------------
 *
 * **Nada aqui promove.** Um arquivo que chega por API é recebido, lido e
 * conferido, e para em PREVIEWED — exatamente onde para o arquivo que sobe pela
 * tela. A aprovação continua sendo o clique de uma pessoa em Importações,
 * porque é ela quem responde pelo que passou a valer no acervo, e porque a
 * separação entre "entrou" e "vale" é o produto inteiro.
 *
 * O efeito prático, e ele é bom: um sistema externo pode empurrar a planilha
 * todo dia às seis da manhã, e quem opera chega de manhã com o resumo pronto
 * para conferir e aprovar — em vez de precisar exportar, baixar e subir o
 * arquivo à mão antes de começar a trabalhar.
 *
 * ---------------------------------------------------------------------------
 * Por que `/v1`
 * ---------------------------------------------------------------------------
 *
 * Porque quem está do outro lado é um sistema que ninguém aqui controla, e
 * mudar o formato de uma resposta deixa de ser um deploy para virar uma
 * negociação. O número no endereço é o que permite a versão seguinte existir ao
 * lado desta em vez de por cima dela. As telas deste produto continuam em
 * `/api/...` sem número: lá cliente e servidor sobem juntos, e versionar seria
 * cerimônia sem ganho.
 *
 * ---------------------------------------------------------------------------
 * O contrato de erro é o mesmo do resto
 * ---------------------------------------------------------------------------
 *
 * `{ error, code, requestId }`, em JSON, sempre — inclusive no 404 e no 500,
 * que são escritos por `middlewares/contrato-json.ts` no fim da pilha. Nenhuma
 * rota daqui escreve 5xx por conta própria, como nenhuma outra deste servidor.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use(
  contextoDeSchema(
    "A porta de API não tem onde registrar as chamadas: as tabelas que a " +
      "migration 0082_integracoes cria não existem neste banco.",
  ),
);

/**
 * Quem sou eu, na visão de vocês? — a primeira chamada de toda integração.
 *
 * Não exige escopo nenhum, e é de propósito: é a rota que responde "a chave que
 * eu configurei está certa?" sem que quem configurou precise arriscar um envio
 * de verdade para descobrir. Devolve o nome da integração, o prefixo da chave e
 * os escopos que ela alcança — o bastante para um script de partida conferir
 * que está falando com o ambiente certo, com a chave certa.
 */
router.get("/ping", chaveDeIntegracao(null), (req, res): void => {
  const chave = req.integracao!;
  res.json({
    integracao: chave.integracaoNome,
    prefixo: chave.prefixo,
    escopos: chave.escopos,
    /*
      O catálogo inteiro vai junto: quem integra descobre o que **poderia**
      pedir sem precisar de documentação ao lado — e descobre pelo servidor que
      está atendendo, que é a única fonte que não fica desatualizada.
    */
    escoposDisponiveis: CATALOGO_DE_ESCOPOS,
    em: new Date().toISOString(),
  });
});

/**
 * ENTRADA — o export do Freightec chegando por máquina.
 *
 * O corpo é o mesmo de `POST /api/imports`, e não por preguiça: é o mesmo
 * arquivo, lido pelo mesmo pipeline, com as mesmas recusas de formato
 * (`decodeUpload`). Um segundo formato de envio seria uma segunda lista de
 * recusas, e a que ficasse para trás deixaria entrar por API o CSV renomeado
 * que a tela recusa.
 *
 * ```
 * POST /api/v1/importacoes
 * Authorization: Bearer fck_…
 * { "filename": "vigencia.xlsx", "contentBase64": "UEsDBBQ…", "declaredType": "FRETE" }
 * ```
 *
 * Responde 202 com o id da importação: a leitura continua depois da resposta,
 * porque são dezenas de milhares de células e a conexão morreria antes. Quem
 * enviou acompanha por `GET /api/v1/importacoes/:id` até `PREVIEWED` — e então
 * espera a aprovação de uma pessoa, que esta porta não faz.
 *
 * O 409 de arquivo repetido não é falha da integração: é o pipeline dizendo
 * que aquele conteúdo já entrou. Um agendador que reenvia o mesmo export duas
 * vezes recebe 409 na segunda, e está tudo certo — a defesa é por conteúdo
 * (`content_sha256`), e não por quem enviou.
 */
router.post(
  "/importacoes",
  chaveDeIntegracao("importacoes:enviar"),
  async (req, res): Promise<void> => {
    const decoded = decodeUpload(req.body);
    if (!decoded.ok) {
      res.status(400).json({ error: decoded.error, code: "ARQUIVO_RECUSADO" });
      return;
    }

    const { filename, bytes, declaredType } = decoded.value;
    // O nome em disco é o próprio sha256, como no envio pela tela: dois envios
    // do mesmo conteúdo apontam para o mesmo arquivo, e nome vindo de fora
    // nunca vira caminho.
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const filePath = path.join(ensureImportStorageDir(), `${contentSha256}.xlsx`);
    writeFileSync(filePath, bytes);

    const received = await receiveFile(db, {
      filePath,
      filename,
      /*
        O autor é a integração, e não uma pessoa. É o que faz o cartão em
        Importações dizer "Freightec (API)" em vez de atribuir a alguém que não
        clicou em nada — e é o que permite, meses depois, saber que aquele
        arquivo entrou sozinho.
      */
      receivedBy: `${req.integracao!.integracaoNome} (API)`,
      declaredType,
    });

    req.importRunDaChamada = received.importRunId;

    if (received.isDuplicate) {
      const run = await getImportRunStatus(db, received.importRunId);
      res.status(409).json({
        error:
          run?.failureReason ??
          `Este arquivo já havia sido recebido (sha256 ${contentSha256.slice(0, 16)}…).`,
        code: "ARQUIVO_JA_RECEBIDO",
        importacaoId: received.importRunId,
      });
      return;
    }

    res.status(202).json({
      importacaoId: received.importRunId,
      contentSha256: received.contentSha256,
      status: "PENDING",
      acompanhe: `/api/v1/importacoes/${received.importRunId}`,
      /*
        A frase existe porque a pergunta seguinte de quem integra é sempre a
        mesma — "e agora, entrou?" —, e a resposta é o desenho do produto. Dizer
        isso aqui é mais barato do que descobrir depois de um dia esperando um
        estado que nunca vem sozinho.
      */
      aviso:
        "O arquivo foi recebido e está sendo lido. Ele para em PREVIEWED e " +
        "aguarda aprovação humana em Importações — nenhuma chave de API promove.",
    });

    void readInBackground(received.importRunId, req.log);
  },
);

/**
 * SAÍDA — o histórico, para quem enviou saber o que aconteceu com o que enviou.
 *
 * É a outra metade da integração de entrada, e sem ela a primeira seria cega:
 * um agendador que empurra arquivo sem poder ler o desfecho não tem como
 * avisar ninguém quando o arquivo passou a falhar.
 */
router.get(
  "/importacoes",
  chaveDeIntegracao("importacoes:ler"),
  async (req, res): Promise<void> => {
    res.json(
      await listImportRuns(db, {
        operacao: operacaoDaConsulta(req.query as Record<string, unknown>),
      }),
    );
  },
);

/** Uma importação: em que estado está, e por que parou aí, quando parou. */
router.get(
  "/importacoes/:id",
  chaveDeIntegracao("importacoes:ler"),
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    if (!UUID.test(id)) {
      res.status(400).json({
        error: "Identificador de importação inválido.",
        code: "IDENTIFICADOR_INVALIDO",
      });
      return;
    }
    const run = await getImportRun(db, id);
    if (!run) {
      res.status(404).json({
        error: "Não há importação com este identificador.",
        code: "IMPORTACAO_NAO_ENCONTRADA",
      });
      return;
    }
    res.json(run);
  },
);

/**
 * O que não existe nesta porta responde daqui, e não do 404 geral.
 *
 * Sem isto, um endereço errado sob `/api/v1` atravessa este router e cai em
 * `requireSession`, que responde "Faça login para usar o FreightCheck" — uma
 * frase escrita para uma pessoa numa tela, entregue a um script que não tem
 * login nenhum a fazer e que passaria a tarde procurando a sessão que falta em
 * vez do caminho que digitou errado.
 */
router.use((req, res): void => {
  res.status(404).json({
    error: `A porta de API não atende ${req.method} ${req.originalUrl.split("?")[0]}. O que ela atende está em GET /api/v1/ping.`,
    code: "ROTA_DESCONHECIDA",
    requestId: req.id,
  });
});

export default router;
