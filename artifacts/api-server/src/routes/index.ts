import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import usersRouter from "./users";
import fleetAnalysisRouter from "./fleet-analysis";
import curationRouter from "./curation";
import changesRouter from "./changes";
import importsRouter from "./imports";
import overviewRouter from "./overview";
import versionsRouter from "./versions";
import bookRouter from "./book";
import assistantRouter from "./assistant";
import balanceRouter from "./balance";
import compositionRouter from "./composition";
import ticketsRouter from "./tickets";

/**
 * F0/F1 surface.
 *
 * The routes built on the previous schema (dashboard, snapshots, parameters,
 * diffs, shipments, simulations, alerts) were removed together with that
 * schema — see docs/ARQUITETURA.md §1. They are rebuilt on the canonical model
 * in F5, once the comparison engine and the impact policy exist.
 *
 * `imports` is the F1 pipeline over HTTP: receber, ler e conferir num pedido;
 * promover em outro, porque entre os dois existe uma decisão humana.
 *
 * `curation` is the F2 surface; `changes` is F3 — Alterações and Comparar.
 *
 * `fleet-analysis` is kept as-is for now: it reads the workbook directly and
 * does not depend on the database, so the existing Fleet Analysis screen keeps
 * working while the canonical layer is being built.
 *
 * `auth` is the only surface below that answers without sessão — ver
 * `middlewares/require-session.ts`, montado antes deste router. `users` é a
 * tela de Configurações: quem tem acesso, e quem deu.
 *
 * `book` é o Book do Operador: um documento por bloco, versionado, sem DELETE.
 * É a única superfície que guarda arquivo dentro do banco, e o motivo está em
 * `lib/db/src/schema/book.ts` — aqui o documento é o conteúdo, não há cópia
 * derivada dele, e o disco desta plataforma não sobrevive a um deploy.
 *
 * `balance` é o Balanço de Massa: a conta de conservação da importação —
 * quantas células o arquivo trouxe, por quais destinos declarados elas saíram,
 * e o que sobrou sem destino. É a pergunta inversa da rastreabilidade, e a
 * única superfície que responde "sumiu alguma coisa?" em vez de "de onde veio
 * este número?".
 *
 * `composition` é a Composição: a memória de cálculo da remuneração por
 * equipamento. Não tem tabela própria nem dado próprio — lê o canônico pelas
 * mesmas funções de classificação e comparação que as outras telas usam, e
 * acrescenta a única coisa que faltava: a decisão, atributo a atributo, de
 * **o que compõe o que aquele ativo recebe** e o que fica de fora, com o
 * motivo escrito.
 *
 * `assistant` é o Assistente de IA. É a única superfície que **não** tem dado
 * próprio: ela responde a partir do conhecimento registrado em código e de
 * consultas às mesmas funções que as telas usam. Um número que aparece lá
 * apareceu antes numa tela, e a resposta diz em qual.
 *
 * `tickets` é a aba Chamados de Alterações — o outro caminho pelo qual a
 * remuneração muda. Fica separada de `changes` de propósito: um chamado não é
 * uma diferença apurada entre duas vigências, e o impacto de um nunca é somado
 * ao do outro. Duas contas, duas réguas, lado a lado e nunca adicionadas.
 */
const router: IRouter = Router();

router.use(authRouter);
router.use(usersRouter);
router.use(healthRouter);
router.use(fleetAnalysisRouter);
router.use(curationRouter);
router.use(changesRouter);
router.use(importsRouter);
router.use(overviewRouter);
router.use(versionsRouter);
router.use(bookRouter);
router.use(assistantRouter);
router.use(balanceRouter);
router.use(compositionRouter);
router.use(ticketsRouter);

export default router;
