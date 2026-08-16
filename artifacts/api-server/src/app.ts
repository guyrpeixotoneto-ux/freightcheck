import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { requireSession } from "./middlewares/require-session";
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
 * Antes das rotas, e uma vez só: a autenticação é do servidor inteiro, não de
 * cada rota. O que responde sem sessão está listado em `lib/auth.ts`.
 */
app.use("/api", requireSession);
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
