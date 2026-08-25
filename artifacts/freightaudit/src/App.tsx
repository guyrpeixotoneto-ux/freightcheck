import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, useSearch, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@/lib/auth';
import {
  BASES_DE_FECHAMENTO,
  DASHBOARD,
  destinoDaRaiz,
  GESTAO_A_VISTA,
  LINHA_DO_TEMPO,
  RESUMO_EXECUTIVO,
} from '@/lib/ambiente';
import { publicarNoConsole } from '@/lib/registro-de-falhas';
import { PADRAO_DAS_CONSULTAS } from '@/lib/chamada-resiliente';
import Login from '@/pages/login';

import Inicio from '@/pages/inicio';
import Dashboard from '@/pages/dashboard';
import GestaoAVista from '@/pages/gestao-a-vista';
import LinhaDoTempo from '@/pages/linha-do-tempo';
import VisaoGerencialDaAuditoria from '@/pages/visao-gerencial';
import Vigencia from '@/pages/vigencia';
import Dados from '@/pages/dados';
import Alteracoes from '@/pages/alteracoes';
import Parametros from '@/pages/parametros';
import Comparar from '@/pages/comparar';
import Importacoes from '@/pages/importacoes';
import BalancoMassa from '@/pages/balanco-massa';
import Composicao from '@/pages/composicao';
import ComposicaoEquipamento from '@/pages/composicao-equipamento';
import DRE from '@/pages/dre';
import DREVeiculo from '@/pages/dre-veiculo';
import ApresentacaoVideo from '@/components/video/ApresentacaoVideo';
import AnaliseEquipamentos from '@/pages/analise-equipamentos';
import Curadoria from '@/pages/curadoria';
import Categorias from '@/pages/categorias';
import BookOperador from '@/pages/book-operador';
import Assistente from '@/pages/assistente';
import Vigencias from '@/pages/vigencias';
import Versoes from '@/pages/versoes';
import Unidades from '@/pages/unidades';
import Configuracoes from '@/pages/configuracoes';
import Frota360 from '@/pages/frota-360';
import QlpAdministrativo from '@/pages/qlp-administrativo';
import Remunerado from '@/pages/remunerado';
import { EmPreparo } from '@/pages/em-preparo';
import { TELAS_EM_PREPARO } from '@/pages/telas-em-preparo';
import VisaoGerencial from '@/pages/fechamento/visao';
import UnidadeDoFechamento from '@/pages/fechamento/unidade';
import Competencias from '@/pages/fechamento/competencias';
import Apuracoes from '@/pages/fechamento/apuracoes';
import ResumoGeral from '@/pages/fechamento/resumo';
import Conciliacao from '@/pages/fechamento/conciliacao';
import CompetenciaAberta from '@/pages/fechamento/competencia';
import DiaDoFechamento from '@/pages/fechamento/dia';
import FrotaDaCompetencia from '@/pages/fechamento/frota';
import Frotas from '@/pages/fechamento/frotas';
import RemuneracaoCadastro from '@/pages/fechamento/remuneracao';
import RemuneracaoUnidades from '@/pages/fechamento/remuneracao-unidades';
import { EtapaDoFechamento } from '@/pages/fechamento/etapa';
import { etapasDoFechamento } from '@/pages/fechamento/etapas';

/**
 * As rotas do produto.
 *
 * Saíram daqui `/simulacao`, `/snapshots` e `/snapshots/:id`. As três chamavam
 * endpoints removidos junto com o schema antigo (`/simulations`,
 * `/snapshots/{id}/parameters`), então **nenhuma delas jamais funcionou** sobre
 * o modelo canônico: abriam, pediam dados a rotas que respondem 404 e paravam
 * numa tela de erro. Manter uma rota que só produz erro é o mesmo pecado de
 * mostrar um número sem lastro, e este produto existe para não cometê-lo.
 *
 * As telas continuam no repositório e o desenho da Simulação continua em
 * `docs/PROPOSTA-SIMULACAO.md`; o que saiu foi a promessa de que clicar leva a
 * algum lugar. Quando `lib/simulation` ganhar as rotas que lhe faltam, a
 * Simulação volta ao roteador — funcionando.
 */
/**
 * A política de resiliência da aplicação inteira — e por que ela é global.
 *
 * Insistir só onde insistir adianta. O padrão do React Query são três tentativas
 * com espera crescente, desenhado para rede instável e errado para as falhas
 * desta API, que são quase todas definitivas: um 400 sobre o arquivo enviado e
 * um 503 de "falta a migration" respondem igual na quarta tentativa e na
 * primeira. O preço eram sete segundos de "Carregando…" antes de a tela dizer o
 * que houve — tempo em que quem está olhando conclui que travou.
 *
 * O que mudou é o alcance. A regra de repetição já morava aqui, mas escrita à
 * mão e sem tipo; agora é `deveTentarDeNovo`, a mesma autoridade que as telas
 * resilientes consultam, e vem acompanhada das duas opções que faltavam. As
 * três valem para as 104 consultas da aplicação, e não só para as telas que
 * alguém lembrar de converter — que é a diferença entre resolver isto
 * estruturalmente e resolver tela por tela.
 *
 * ---------------------------------------------------------------------------
 * O que muda, exatamente
 * ---------------------------------------------------------------------------
 *
 * **`retry`.** Antes: qualquer erro que não fosse `ApiError` 4xx ou com `code`
 * era repetido duas vezes. Agora: `ehFalhaTransitoria` decide. Os desfechos
 * coincidem em tudo que importa — `TypeError`, 5xx sem código e 5xx com código
 * continuam se comportando igual — e divergem em três, todos para melhor: um
 * 4xx de corpo vazio e um HTML de proxy com status de sucesso deixam de ser
 * repetidos (repetir devolve o mesmo), e um erro que não é de nenhuma classe
 * nossa — `undefined is not a function`, um contrato que mudou — passa a
 * falhar de primeira, em vez de esconder um defeito de código atrás da espera
 * inteira.
 *
 * **`retryDelay`.** Antes: o padrão do React Query, 1s e 2s. Agora: 400ms,
 * 1200ms, 3600ms e 8000ms. Os dois primeiros degraus são curtos porque a maior
 * parte das quedas de transporte se resolve entre um pacote e o seguinte; os
 * dois últimos existem porque a causa mais comum de "não houve resposta" neste
 * ambiente não é um pacote perdido, é a origem acordando — Repl dormindo, cold
 * start, reinício —, e essa é da ordem de segundos. Ver `resiliencia.ts`, onde
 * a conta e o que ela custa estão escritos.
 *
 * **`refetchOnWindowFocus`.** Antes: `true`, o padrão. Agora: `false`. É a única
 * mudança com perda, e é a que resolve o defeito: toda volta à aba disparava um
 * refetch em todas as queries montadas, e um refetch que falha repõe o erro na
 * tela sem ninguém ter pedido nada. Quem só voltou para a aba lê aquilo como "o
 * produto quebrou de novo", e o "de novo" não descreve o produto — descreve o
 * gatilho.
 *
 * O que se perde: uma aba deixada aberta numa tela deixa de se atualizar sozinha
 * quando alguém volta a ela. O que **não** se perde, e é por isso que o preço é
 * pequeno: `staleTime` é 0 por padrão neste app, então `refetchOnMount` continua
 * refazendo a consulta a cada navegação; e toda mutação invalida as chaves que
 * tocou. Fica descoberto só o caso de ficar parado na mesma tela enquanto outra
 * pessoa muda o dado.
 *
 * **`refetchOnReconnect`.** Já era `true` por padrão. Declarado porque agora é
 * decisão, e não herança: é a contrapartida de ter desligado o foco, e é o que
 * garante que a tela se recupere sozinha quando a conexão volta.
 *
 * ---------------------------------------------------------------------------
 * As exceções, todas explícitas
 * ---------------------------------------------------------------------------
 *
 * Três lugares continuam refazendo por foco, e cada um declara isso na própria
 * query — um default global não some com nenhum deles:
 *
 * 1. **A sessão** (`lib/auth.tsx`). É o motivo de o refetch por foco existir:
 *    a sessão pode morrer no servidor enquanto a aba está de lado, e sem
 *    reperguntar a tela seguiria mostrando um sistema que já não responde. Já
 *    declarava `refetchOnWindowFocus: true` antes desta mudança.
 * 2. **Os contadores do menu** (`components/layout/contadores.ts`). São os
 *    únicos que dependem do foco *implicitamente*: o layout nunca desmonta,
 *    então `refetchOnMount` não os alcança, e sem foco eles congelariam no
 *    número da primeira carga. Passam a declarar o `true`.
 * 3. **O seletor de contexto** (`components/layout/sidebar.tsx`), pela mesma
 *    razão e no mesmo lugar da tela.
 *
 * As três engolem erro (devolvem `[]` ou `0`) e usam `retry: false`: nenhuma
 * delas chega a mostrar falha a ninguém, e por isso o foco ligado não repõe
 * painel nenhum. É o que as torna exceções seguras.
 *
 * **Não** são exceções, e não precisavam ser: as telas que acompanham progresso
 * — o cartão de importação (`pages/importacoes.tsx`) e a aba de Chamados
 * (`components/changes/aba-chamados.tsx`). Elas se atualizam por
 * `refetchInterval` condicional, que é independente do foco e continua
 * funcionando igual.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: PADRAO_DAS_CONSULTAS },
});

/*
  O registro de falhas de transporte fica alcançável pelo console.

  Uma linha, na partida, e é a única forma de a evidência sair de um navegador
  que não está conseguindo falar com o servidor — mandá-la pela rede seria
  mandá-la justamente pelo caminho que acabou de quebrar. Ver
  `lib/registro-de-falhas.ts`.
*/
publicarNoConsole();

/**
 * A raiz, que só encaminha.
 *
 * Sem tela e sem "Carregando…": o que ela faz é trocar o endereço e sair de
 * cena, e por isso devolve `null` — um esqueleto piscando aqui apareceria por
 * um quadro e sumiria, que é ruído puro num caminho que ninguém deveria ver.
 *
 * **A troca é `replace`, e isso não é detalhe.** Empilhar `/visao-gerencial`
 * por cima de `/` deixaria o botão Voltar apontando para uma rota que
 * imediatamente encaminha de novo: quem apertasse voltar não sairia do lugar.
 * Substituindo, `/` não chega a existir no histórico, e o voltar leva de volta
 * ao que havia antes do produto.
 *
 * A decisão de para onde ir mora em `destinoDaRaiz` (`lib/ambiente.ts`), fora
 * do JSX, e é testada lá — aqui só se obedece a ela.
 */
function EntradaDaAuditoria() {
  const busca = useSearch();
  const [, navegar] = useLocation();
  const destino = destinoDaRaiz(busca);

  useEffect(() => {
    navegar(destino, { replace: true });
  }, [destino, navegar]);

  return null;
}

function Router() {
  return (
    <Switch>
      {/*
        A raiz não é mais tela: é a porta.

        Quem abre o produto entra pelo conjunto — a Visão Gerencial, todas as
        unidades de uma vez —, e não dentro de uma unidade que ninguém escolheu.
        A regra inteira, com o porquê e com o que ela deve aos links antigos,
        mora em `lib/ambiente.ts`; aqui só se obedece.
      */}
      <Route path="/" component={EntradaDaAuditoria} />
      {/*
        A Visão Gerencial da Auditoria — o acervo inteiro, unidade a unidade.

        Endereço próprio *e* destino da raiz. O endereço próprio é o que a
        lateral aponta e o que acende o item do menu; a raiz encaminha para cá,
        e não renderiza a tela por conta própria, para que a Visão Gerencial
        tenha um endereço só. Duas rotas mostrando a mesma tela seriam duas
        respostas para "onde eu estou" — e a lateral só sabe acender uma.
      */}
      <Route path="/visao-gerencial" component={VisaoGerencialDaAuditoria} />
      {/*
        O Resumo executivo, no endereço que diz o nome dele.

        Morava em `/` por antiguidade, e não por decisão: era a primeira tela do
        produto. Ele continua respondendo pela unidade aberta e continua sendo a
        segunda linha da Visão executiva — o que mudou foi a ordem em que se
        chega, que agora é a do trabalho: o acervo, depois a unidade.
      */}
      <Route path={RESUMO_EXECUTIVO} component={Inicio} />
      {/*
        O Dashboard e a Gestão à Vista, a dupla que vigia mudança de vigência.

        Endereço próprio nos dois, como o Resumo executivo: a lateral aponta
        para o primeiro, e o segundo é o destino do botão "Gestão à Vista" —
        um telão que carrega o mesmo recorte, e por isso não aparece no menu.
      */}
      <Route path={DASHBOARD} component={Dashboard} />
      <Route path={GESTAO_A_VISTA} component={GestaoAVista} />
      <Route path={LINHA_DO_TEMPO} component={LinhaDoTempo} />
      <Route path="/vigencia" component={Vigencia} />
      <Route path="/dados" component={Dados} />
      <Route path="/apresentacao" component={ApresentacaoVideo} />
      <Route path="/parametros" component={Parametros} />
      <Route path="/remunerado" component={Remunerado} />
      <Route path="/book-operador" component={BookOperador} />
      <Route path="/assistente" component={Assistente} />
      {/*
        Nas duas rotas abaixo a tela entra como filha, e não por `component`:
        ela recebe em que aba abrir, e `component` só passa os parâmetros da
        rota.

        As `key` não são enfeite. As duas rotas rendem o mesmo componente na
        mesma posição da árvore, e sem elas o React reaproveita a instância ao
        trocar de rota — os filtros da lista, que nascem do endereço uma vez e
        depois são estado da tela, atravessariam de uma entrada para a outra.
        Chaves diferentes dizem que são duas telas, e cada entrada abre limpa.
        (A aba em si já não depende disto: ela mora no endereço, e `abaInicial`
        só responde quando ninguém a escreveu.)
      */}
      <Route path="/alteracoes">
        <Alteracoes key="alteracoes" />
      </Route>
      {/*
        Impacto financeiro é a mesma tela, aberta na aba que responde a pergunta
        dele. O item saiu de `TELAS_EM_PREPARO` e o menu não mudou uma vírgula —
        é o passo final descrito lá: some do catálogo, e a rota passa a apontar
        para a tela de verdade.

        Rota própria, e não um redirecionamento para `/alteracoes?aba=impacto`:
        o endereço do menu é o que a barra lateral marca como ativo, e trocá-lo
        no caminho acenderia "Alterações" para quem clicou em "Impacto
        financeiro".
      */}
      <Route path="/impacto-financeiro">
        <Alteracoes key="impacto-financeiro" abaInicial="impacto" />
      </Route>
      {/*
        As três telas 360° são a mesma tela, parametrizada pelo tipo — e chaves
        diferentes pela mesma razão que separa `/alteracoes` de
        `/impacto-financeiro`: a placa e o De/Até são estado, e atravessar de
        cavalo para carreta com a placa do outro tipo na barra abriria a tela num
        ativo que não é dela.

        Cavalo e carreta saíram de `TELAS_EM_PREPARO` quando nasceram, e o menu
        não mudou uma vírgula — os itens já estavam lá, no lugar certo, com o
        nome certo. `/trecho-360` é a entrada nova: o trecho não é equipamento,
        é a perna da rota, e o que o traz para cá é o fato de as quatro
        perguntas serem exatamente as mesmas sobre ele.
      */}
      <Route path="/cavalo-360">
        <Frota360 key="cavalo-360" equipamento="CAVALO" />
      </Route>
      <Route path="/carreta-360">
        <Frota360 key="carreta-360" equipamento="CARRETA" />
      </Route>
      <Route path="/trecho-360">
        <Frota360 key="trecho-360" equipamento="TRECHO" />
      </Route>
      <Route path="/comparar" component={Comparar} />
      {/*
        QLP Administrativo saiu de `TELAS_EM_PREPARO` quando a importação
        passou a receber o export próprio dele (tipo QLP_ADMINISTRATIVO) — o
        menu não mudou uma vírgula, como manda o catálogo.
      */}
      <Route path="/qlp-administrativo" component={QlpAdministrativo} />
      <Route path="/importacoes" component={Importacoes} />
      <Route path="/composicao" component={Composicao} />
      <Route path="/composicao/:entityId" component={ComposicaoEquipamento} />
      <Route path="/dre" component={DRE} />
      <Route path="/dre/:entityId" component={DREVeiculo} />
      <Route path="/balanco-massa" component={BalancoMassa} />
      <Route path="/analise-equipamentos" component={AnaliseEquipamentos} />
      <Route path="/curadoria" component={Curadoria} />
      <Route path="/categorias" component={Categorias} />
      <Route path="/vigencias" component={Vigencias} />
      <Route path="/versoes" component={Versoes} />
      <Route path="/unidades" component={Unidades} />
      <Route path="/configuracoes" component={Configuracoes} />

      {/*
        As telas que o menu anuncia e o banco ainda não sustenta.

        Elas entram no roteador pela mesma razão que `/simulacao` saiu, e não
        pela razão oposta: o pecado nunca foi a rota existir, foi a rota abrir
        uma tela que pede dado a um endereço morto e para num erro. Estas abrem
        uma página que não pede nada a ninguém e diz o que falta — ver
        `pages/telas-em-preparo.ts`, onde mora o texto de cada uma.

        A rota vem daqui, e não de dezoito linhas escritas à mão, para que
        construir a tela de verdade seja um movimento só: tira-se a entrada do
        catálogo e escreve-se o `<Route>` acima. Enquanto as duas coexistirem, a
        linha explícita ganha — o `Switch` entrega ao primeiro que casa.
      */}
      {TELAS_EM_PREPARO.map((tela) => (
        <Route key={tela.href} path={tela.href}>
          <EmPreparo tela={tela} />
        </Route>
      ))}

      {/*
        Os dois ambientes de fechamento, cada um inteiro sob a própria base.

        `/fechamento/...` é o Fechamento Rota e `/fechamento-empurrada/...` é o
        Fechamento Empurrada — ver `lib/ambiente.ts` para a regra e o porquê de
        a Auditoria ter ficado nos endereços de sempre. As rotas dos dois saem
        do **mesmo** `rotasDoFechamento`, e é isso que garante o que se pediu
        deles: mesma estrutura, mesmas telas, mesmo desenho. Uma tela nova entra
        uma vez e nasce nos dois; uma tela escrita duas vezes começaria a
        divergir no primeiro conserto feito só de um lado.

        O laço devolve um vetor de `<Route>`, e não um fragmento: o `Switch` do
        wouter examina os próprios filhos para achar o que casa, e um fragmento
        chegaria a ele como um filho só, que não casa com nada.
      */}
      {Object.values(BASES_DE_FECHAMENTO).flatMap((base) => rotasDoFechamento(base))}

      <Route component={NotFound} />
    </Switch>
  );
}

/**
 * Todas as rotas de um fechamento, montadas sobre a base que recebe.
 *
 * Chamada uma vez por ambiente de fechamento (`BASES_DE_FECHAMENTO`), é ela que
 * faz o Rota e a Empurrada serem o mesmo produto em dois endereços. As etapas
 * ainda sem tela vêm do catálogo pela mesma razão que as telas em preparo vêm
 * do delas: construir a tela de verdade é tirar a entrada de lá e escrever o
 * `<Route>` explícito aqui, e enquanto os dois coexistirem a linha explícita
 * ganha — o `Switch` entrega ao primeiro que casa.
 */
function rotasDoFechamento(base: string) {
  return [
    <Route key={base} path={base} component={VisaoGerencial} />,
    /*
      O ano de uma unidade, atrás do cartão da Visão Gerencial. Não está na
      lateral de propósito: é aprofundamento de um número da home, e não uma
      seção do processo — o menu do Fechamento continua sendo as cinco etapas do
      trabalho.
    */
    <Route key={`${base}/unidades`} path={`${base}/unidades/:codigo`}>
      {(params) => <UnidadeDoFechamento codigo={decodeURIComponent(params.codigo)} />}
    </Route>,
    <Route key={`${base}/competencias`} path={`${base}/competencias`} component={Competencias} />,
    <Route key={`${base}/competencias/:id`} path={`${base}/competencias/:id`}>
      {(params) => <CompetenciaAberta id={params.id} />}
    </Route>,
    /*
      O dia da quinzena vem depois da competência, e o `Switch` entrega ao
      primeiro que casa: como os dois caminhos têm profundidades diferentes, a
      ordem aqui é só leitura — `/dias/:dia` nunca é confundido com `/:id`.
    */
    <Route key={`${base}/dias`} path={`${base}/competencias/:id/dias/:dia`}>
      {(params) => <DiaDoFechamento id={params.id} dia={params.dia} />}
    </Route>,
    /*
      A frota, como o dia: subordinada à competência, e por isso resolvida
      antes de `/:id` — mesma razão da nota acima sobre profundidade e ordem.
    */
    <Route key={`${base}/frota`} path={`${base}/competencias/:id/frota`}>
      {(params) => <FrotaDaCompetencia id={params.id} />}
    </Route>,
    <Route key={`${base}/frotas`} path={`${base}/frotas`} component={Frotas} />,
    <Route key={`${base}/apuracoes`} path={`${base}/apuracoes`} component={Apuracoes} />,
    <Route key={`${base}/resumo`} path={`${base}/resumo`} component={ResumoGeral} />,
    /*
      A Conciliação é irmã do Resumo e não uma aba dele: ela responde outra
      pergunta — o fechamento contra a planilha que a operação mantém — e só
      existe depois de alguém anexar um arquivo. Endereço próprio é o que
      permite mandar "abre a conciliação de julho" numa mensagem.
    */
    <Route key={`${base}/conciliacao`} path={`${base}/conciliacao`} component={Conciliacao} />,
    /*
      Remuneração é a única tela do Fechamento que lê o acervo da Auditoria e
      não uma competência. Ela mora aqui porque é aqui que serve — o cadastro é
      o que a apuração da quinzena consome —, e a rota HTTP dela fica fora da
      base pelo motivo simétrico: o dado é da unidade numa vigência. Ver
      `routes/remuneracao.ts`.

      São duas telas e duas perguntas: a lista responde *quais unidades já têm
      cadastro de pé*, e a de dentro, *quais são os parâmetros desta unidade*. A
      lista fica no endereço curto porque é por onde se entra — e porque era ele
      que a lateral já apontava. O endereço antigo do cadastro era este mesmo,
      com a unidade na query; a lista encaminha quem chegar com `scopeHash` para
      `/unidade`, e nenhum link guardado por aí morre.
    */
    <Route
      key={`${base}/remuneracao`}
      path={`${base}/remuneracao`}
      component={RemuneracaoUnidades}
    />,
    <Route
      key={`${base}/remuneracao/unidade`}
      path={`${base}/remuneracao/unidade`}
      component={RemuneracaoCadastro}
    />,
    ...etapasDoFechamento(base).map((etapa) => (
      <Route key={etapa.href} path={etapa.href}>
        <EtapaDoFechamento etapa={etapa} />
      </Route>
    )),
  ];
}

/**
 * Nada do produto aparece antes de a sessão ser confirmada.
 *
 * O portão é aqui, e não dentro de cada página, por um motivo prático: página
 * que se protege sozinha é página que alguém esquece de proteger. Enquanto a
 * resposta não chega, a tela é neutra — mostrar o sistema "só um instante" e
 * então trocar pelo login é vazar o que ele contém, e ainda por cima pisca.
 *
 * O servidor recusa por conta própria (401): este portão é o que a pessoa vê,
 * não o que a protege.
 */
function Gate() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="sr-only">Verificando a sessão…</span>
      </div>
    );
  }

  if (!user) return <Login />;

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ErrorBoundary>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Gate />
            </WouterRouter>
          </AuthProvider>
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
