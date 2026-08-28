import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import compression from "compression";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { requireSession } from "./middlewares/require-session";
import { portaoDePermissao } from "./middlewares/portao-de-permissao";
import { portaoDeProntidao } from "./middlewares/portao-de-prontidao";
import { erroEmJson, rotaDesconhecida } from "./middlewares/contrato-json";
import { logger } from "./lib/logger";

const app: Express = express();

/**
 * O protocolo original vem do roteador, não do socket.
 *
 * Quem termina o TLS no Replit é o roteador; para este processo toda conexão
 * chega em http. Sem isto, `req.protocol` diria "http" atrás de uma URL https e
 * o cookie de sessão sairia sem `Secure` — ver `routes/auth.ts`.
 */
app.set("trust proxy", true);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());

/**
 * As respostas saem comprimidas — e antes não saía nenhuma.
 *
 * Toda resposta desta API é JSON, e JSON comprime como poucas coisas: os
 * mesmos nomes de campo se repetem em cada registro. Medido sobre as respostas
 * reais do acervo:
 *
 *   /api/changes/consolidated    87 KB →  5 KB   (19,4x)
 *   /api/frota/panorama          46 KB →  4 KB   (11,3x)
 *   /api/dre/unit/:id            56 KB →  6 KB    (9,3x)
 *   /api/composition/fleet       29 KB →  3 KB    (8,6x)
 *   /api/changes/families        95 KB → 12 KB    (8,2x)
 *   /api/dre/fleet               84 KB → 11 KB    (7,4x)
 *
 * O que isso devolve depende da rede de quem está do outro lado, e é por isso
 * que não aparecia na medição local — em `localhost` a diferença entre 95 KB e
 * 12 KB é ruído. Numa conexão de 8 Mb/s, `/api/changes/families` cai de 98ms
 * para 13ms de download; numa de 2 Mb/s, de 391ms para 49ms. É a tela do
 * Resumo executivo, do Dashboard, da Linha do tempo, de Parâmetros e da Gestão
 * à Vista.
 *
 * O custo é de 0,2 a 0,9ms de CPU por resposta, medido comprimindo cada uma
 * delas vinte vezes. Contra 44 a 342ms de rede economizados, a troca não é
 * dúvida.
 *
 * gzip, e não brotli: sobre estas respostas o brotli entrega 9 KB onde o gzip
 * entrega 12 KB — não paga a CPU a mais nem a dependência a mais.
 *
 * O piso de 1 KB é o padrão do middleware e é decisão: abaixo disso o
 * cabeçalho da compressão come o ganho, e a maioria das rotas deste servidor
 * responde poucas centenas de bytes.
 *
 * **Antes do parser de corpo, e depois do CORS.** O middleware precisa
 * envolver `res.write`/`res.end` antes de qualquer rota escrever, e não tem o
 * que fazer com a requisição que chega — por isso vem cedo, mas depois do CORS,
 * que precisa responder o preflight sem passar por aqui.
 */
app.use(compression());
/**
 * The limit exists for one route: uploading a workbook, which arrives as
 * base64 inside a JSON body.
 *
 * It has to be set here rather than on that route, because this parser runs
 * first and would reject the body before the route's own parser ever saw it —
 * which it did, with a 413 that pointed nowhere useful. The Freightec's
 * workbooks are a few hundred KB; 64 MB is room to spare without inviting
 * anything unbounded.
 */
app.use(express.json({ limit: "64mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

/**
 * Antes de tudo o que toca o banco: o portão de prontidão.
 *
 * A partida abre a porta antes de a fila rodar — tem de abrir, senão o startup
 * probe do autoscale desiste (ver `index.ts`). O que não pode é o tráfego de
 * produto atravessar essa janela: entre o `listen` e a convergência, o código
 * deste build e o schema deste banco podem falar versões diferentes do mesmo
 * contrato, e foi assim que um 03.08.18 perfeito virou "o servidor falhou" em
 * 22/08/2026. Ver `middlewares/portao-de-prontidao.ts`.
 *
 * **Antes de `requireSession`, e a ordem é a correção**: a sessão também é lida
 * do banco. Autenticar primeiro faria a primeira consulta do pedido acontecer
 * dentro da janela que o portão existe para manter vazia.
 */
app.use("/api", portaoDeProntidao);

/**
 * Antes das rotas, e uma vez só: a autenticação é do servidor inteiro, não de
 * cada rota. O que responde sem sessão está listado em `lib/auth.ts`.
 */
app.use("/api", requireSession);

/**
 * Depois da sessão, antes das rotas: quem já entrou pode mudar o quê.
 *
 * A ordem é a regra: sem sessão não há permissão a consultar, e depois das
 * rotas seria tarde — a escrita já teria acontecido. Ver
 * `middlewares/portao-de-permissao.ts`, inclusive para o que ele
 * deliberadamente não bloqueia.
 */
app.use("/api", portaoDePermissao);
app.use("/api", router);

/**
 * Depois das rotas, e nesta ordem: o que não casou, e o que quebrou.
 *
 * Estas duas linhas são o que transforma "toda resposta desta API é JSON" de
 * promessa escrita nos comentários em propriedade do servidor. Sem elas quem
 * responde é o `finalhandler` do Express, em `text/html` — e um corpo em HTML
 * faz a interface concluir que a requisição não chegou à API, mandando
 * procurar um processo derrubado quando o defeito está numa linha de código.
 * O porquê inteiro está em `middlewares/contrato-json.ts`.
 *
 * A ordem importa e não é estética: o handler de erro tem quatro parâmetros e
 * o Express só o reconhece como tal se ele for registrado depois de tudo o que
 * pode falhar — inclusive depois do 404.
 */
app.use(rotaDesconhecida);
app.use(erroEmJson);

export default app;
