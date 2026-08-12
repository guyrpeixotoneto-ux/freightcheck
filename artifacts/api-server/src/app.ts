import express, { type Express } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { requireSession } from "./middlewares/require-session";
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

export default app;
