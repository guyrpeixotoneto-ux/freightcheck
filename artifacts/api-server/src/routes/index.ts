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
import coverageRouter from "./coverage";
import dreRouter from "./dre";
import ticketsRouter from "./tickets";
import impactoRouter from "./impacto";
import clienteRouter from "./cliente";
import frotaRouter from "./frota";

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
 * `coverage` é Cobertura de dados: o que já temos versus o que deveríamos ter.
 * Fica separada de `imports` de propósito, e a fronteira é a que o produto
 * inteiro respeita — Importações responde "o que entrou", com arquivos, linhas
 * e estados; Cobertura responde "quanto do universo esperado nós possuímos",
 * consolidando **todas** as importações e sem nunca usar arquivo como unidade
 * de medida. Nenhuma rota daqui calcula: todas chamam `@workspace/coverage`,
 * que é a autoridade única do cálculo e da classificação.
 *
 * `dre` é a DRE: o resultado por unidade econômica — cavalo, carreta ou
 * conjunto. Também não tem tabela própria: reorganiza em seções contábeis o que
 * a Composição já apura, acrescenta a normalização de periodicidade e a métrica
 * de cobertura, e recusa-se a fechar subtotal cujo componente essencial falte.
 * Fica separada da Composição de propósito: uma responde "por que este
 * equipamento recebe este valor" e a outra "o que sobra depois dos custos", e as
 * duas leem os mesmos fatos pelo mesmo motor.
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
 *
 * `impacto` é a terceira aba da mesma tela, e a única que não parte da
 * alteração: ela lê o valor de cada ativo em cada quinzena e deixa a alteração
 * aparecer como a diferença entre duas colunas. É o que permite ver o ativo que
 * **não** mudou — que não existe em lista de alteração nenhuma e sem o qual o
 * total da coluna não fecha com o que foi pago.
 *
 * `cliente` é a quarta, e é a camada seguinte à do impacto: das alterações
 * apuradas, quais fazem sentido levar ao cliente como proposta de ajuste, quais
 * precisam de investigação e quais não são assunto. Não recalcula nada — chama
 * `@workspace/advisory`, que compõe o panorama de alterações com o
 * comportamento econômico declarado em `@workspace/knowledge`. A regra que a
 * separa da aba Impacto: lá está o universo do que mudou; aqui, o subconjunto
 * em que o movimento nos prejudica **e** existe algo objetivo a pedir.
 *
 * `frota` é o cabeçalho de Cavalo 360° e Carreta 360°: quem existe, antes de
 * perguntar o que mudou. É a única leitura daquelas telas que não sai das
 * quatro abas de Alterações — e existe porque nenhuma delas conhece o ativo que
 * não mudou, que é justamente o que um seletor de placa não pode deixar de
 * oferecer.
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
router.use(coverageRouter);
router.use(dreRouter);
router.use(ticketsRouter);
router.use(impactoRouter);
router.use(clienteRouter);
router.use(frotaRouter);

export default router;
