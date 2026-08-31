import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import usersRouter from "./users";
import papeisRouter from "./papeis";
import modulosUniversaisRouter from "./modulos-universais";
import fleetAnalysisRouter from "./fleet-analysis";
import curationRouter from "./curation";
import changesRouter from "./changes";
import gerencialRouter from "./gerencial";
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
import fechamentoRouter from "./fechamento";
import qlpRouter from "./qlp";
import remuneracaoRouter from "./remuneracao";
import unidadesRouter from "./unidades";
import cadastroRouter from "./cadastro";
import comprasRouter from "./compras";
import justificativasRouter from "./justificativas";
import trechosRouter from "./trechos";
import fluxosRouter from "./fluxos";
import integracoesRouter from "./integracoes";

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
 * `gerencial` é a Visão Gerencial da Auditoria: o acervo inteiro numa leitura
 * só — toda vigência viva, de toda unidade, com a comparação que a explica.
 * Fica fora de `changes` porque o grão é outro: lá tudo responde sobre uma
 * comparação de um contexto, e esta é a única leitura do ambiente que atravessa
 * contextos. Não calcula comparação nenhuma; a vigência que nunca foi comparada
 * volta como buraco, que é o que a tela existe para mostrar.
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
 * `fechamento` é a superfície do **outro ambiente**: a competência, os cinco
 * relatórios que a Ambev exporta por quinzena, e a conta reconstruída deles.
 * Não calcula nada — a aritmética inteira mora em `@workspace/fechamento`,
 * testada sem banco e sem HTTP.
 *
 * `balance` é o Rastreio de Dados: a conta de conservação da importação —
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
 *
 * `remuneracao` é o módulo Remuneração: o CADASTRO DA PLANILHA DE REMUNERAÇÃO
 * — alíquotas, tamanho de frota, valor de cada parcela por veículo, proporção
 * de documentos — montado por unidade a partir do acervo canônico. Não tem
 * tabela própria e não guarda nada: um cadastro com tabela própria seria uma
 * terceira verdade sobre a frota, ao lado da que o export declara e da que a
 * apuração usa. A tela dele é do Fechamento (é lá que ele serve), mas a rota
 * não vive sob `/fechamento` de propósito — o cadastro é da unidade numa
 * vigência, não de uma competência.
 *
 * `qlp` é a tela QLP Administrativo: o quadro de pessoal da estrutura
 * administrativa, lido dos mesmos fatos canônicos — a família de dados é
 * QUADRO_DE_PESSOAL, o grão é unidade + cargo, e nenhuma tabela nova existe
 * por causa dela. A superfície responde o quadro de uma vigência, a ficha de
 * um cargo com a célula de origem, e a série de presença; o que ela
 * deliberadamente **não** responde é diferença de valor entre vigências, que
 * continua sendo de `changes` — as vigências de QLP são snapshots como
 * quaisquer outros e o motor de comparação as compara entre si.
 *
 * `compras` é o balcão do Remunerado: o que a Ambev paga por um produto, antes
 * de um pedido de compra ser liberado. Não tem dado próprio nem cálculo próprio
 * — a leitura da frota é `montarComposicao` reagrupada por produto, e a do QLP
 * é o quadro administrativo lido pelos papéis que o dicionário declara. O que
 * ela acrescenta é o eixo do comprador: da rubrica do modelo para a coisa que
 * se compra. O que ela deliberadamente **não** faz é comparar com o preço do
 * pedido, que não está no banco.
 *
 * `trechos` é o Radar de Trechos: a camada gerencial acima de Trecho 360° e
 * de Alterações — centenas de trechos, um veredito por trecho
 * (Piorou/Melhorou/Igual/Misto/Inconclusivo), não centenas de atributos para
 * o usuário interpretar sozinho. Não recalcula a comparação — chama a mesma
 * engine (`computeChangeSet`) e consolida o que ela já apurou por
 * `economic_direction` do atributo. Rota própria porque os motores
 * compartilhados de `changes` excluem TRECHO desde o commit #345.
 */
const router: IRouter = Router();

/**
 * A raiz do serviço responde 200 sem sessão porque o deployer do Replit a
 * sonda (`GET /api`) antes de promover o build — um 401 aqui derruba a
 * publicação. Nada de dado atravessa: só a confirmação de que o processo está
 * de pé; a saúde de verdade continua em `/healthz`.
 */
router.get("/", (_req, res) => {
  res.status(200).json({ ok: true, service: "freightcheck-api" });
});

router.use(authRouter);
router.use(usersRouter);
/* Papéis é a mesma casa que `users` — o cadastro de acesso, e o portão o trata
   como Configurações (ver `ESCRITAS_POR_MODULO`). */
router.use(papeisRouter);
/* Os módulos universais são a mesma casa: a decisão da instalação sobre que
   partes do produto ela usa, e o portão a trata como Configurações. */
router.use(modulosUniversaisRouter);
router.use(healthRouter);
router.use(fleetAnalysisRouter);
router.use(curationRouter);
router.use(changesRouter);
router.use(gerencialRouter);
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
router.use(qlpRouter);
router.use(remuneracaoRouter);
/*
  O cadastro mestre de unidades — a autoridade canônica. Entra ao lado de
  Remuneração porque as duas telas falam da mesma unidade, e é justamente
  isso que deixou de ser duas identidades. Ver `routes/unidades.ts`.
*/
router.use(unidadesRouter);
/*
  O cadastro da casa — departamento, cargo e negócio. Vem logo depois do
  cadastro de unidades porque é a mesma família de decisão: coisas que existem
  na empresa por ato de gente, e não porque uma planilha as nomeou. As três
  telas eram páginas de "em preparo"; ver `routes/cadastro.ts`.
*/
router.use(cadastroRouter);
router.use(comprasRouter);
router.use(fechamentoRouter);
/*
  Plano de Ação: a justificativa por placa sobre o que mudou de uma vigência
  para a outra. Não tem leitura própria de "o que mudou" — usa `/changes/latest`,
  de `changesRouter` — só guarda o texto que o gestor escreveu.

  As duas rotas do Painel de Justificativas (`/justificativas/painel` e
  `/justificativas/pendencias`) são a exceção a essa frase, e por um motivo: o
  painel pergunta quanto do que mudou já está explicado, e essa é uma junção
  entre `change` e `justificativa` que nenhum dos dois lados responde sozinho.
  Ela mora aqui, e não em `changesRouter`, porque o assunto é a justificativa.
*/
router.use(justificativasRouter);
/*
  Radar de Trechos: camada gerencial acima de Trecho 360°/Alterações — uma
  linha por trecho, com o veredito Piorou/Melhorou/Igual/Misto/Inconclusivo
  consolidado por `@workspace/comparison`. Ver `routes/trechos.ts`.
*/
router.use(trechosRouter);
/*
  Fluxos Operacionais: o mapa dos processos da empresa, na seção Processos. É a
  única superfície deste servidor escopada por **empresa** — a unidade canônica
  —, e o escopo é resolvido em `lib/empresa-da-requisicao.ts`, nunca lido do
  corpo. O motor inteiro mora em `@workspace/fluxos`; esta rota só traduz.
*/
router.use(fluxosRouter);
/*
  Integrações: a gestão da porta de API — quem fala com este sistema por
  máquina, com que chave e o que já fez. Superfície **administrativa**, com
  sessão como todas as outras daqui; a porta que os sistemas externos chamam é
  `routes/v1.ts`, montada em `app.ts` antes de `requireSession` porque
  autentica por chave e não por cookie. Uma chave de integração nunca administra
  integrações, e uma sessão de pessoa nunca é credencial de máquina.
*/
router.use(integracoesRouter);

export default router;
