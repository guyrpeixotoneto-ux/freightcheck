import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import Login from '@/pages/login';

import Inicio from '@/pages/inicio';
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
import BookOperador from '@/pages/book-operador';
import Assistente from '@/pages/assistente';
import Vigencias from '@/pages/vigencias';
import Versoes from '@/pages/versoes';
import Unidades from '@/pages/unidades';
import Configuracoes from '@/pages/configuracoes';

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
 * Insistir só onde insistir adianta.
 *
 * O padrão do React Query são três tentativas com espera crescente — desenhado
 * para rede instável, e errado para as falhas desta API, que são quase todas
 * definitivas: um 400 sobre o arquivo enviado e um 503 de "falta a migration"
 * respondem igual na quarta tentativa e na primeira. O preço eram sete segundos
 * de "Carregando…" antes de a tela dizer o que houve — tempo em que quem está
 * olhando conclui que travou.
 *
 * Fica a insistência para o que ela resolve: 5xx sem código nosso, que é onde
 * mora a queda momentânea de conexão.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (falhas, erro) => {
        if (erro instanceof ApiError && (erro.status < 500 || erro.code)) {
          return false;
        }
        return falhas < 2;
      },
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Inicio} />
      <Route path="/vigencia" component={Vigencia} />
      <Route path="/dados" component={Dados} />
      <Route path="/apresentacao" component={ApresentacaoVideo} />
      <Route path="/parametros" component={Parametros} />
      <Route path="/book-operador" component={BookOperador} />
      <Route path="/assistente" component={Assistente} />
      <Route path="/alteracoes" component={Alteracoes} />
      <Route path="/comparar" component={Comparar} />
      <Route path="/importacoes" component={Importacoes} />
      <Route path="/composicao" component={Composicao} />
      <Route path="/composicao/:entityId" component={ComposicaoEquipamento} />
      <Route path="/dre" component={DRE} />
      <Route path="/dre/:entityId" component={DREVeiculo} />
      <Route path="/balanco-massa" component={BalancoMassa} />
      <Route path="/analise-equipamentos" component={AnaliseEquipamentos} />
      <Route path="/curadoria" component={Curadoria} />
      <Route path="/vigencias" component={Vigencias} />
      <Route path="/versoes" component={Versoes} />
      <Route path="/unidades" component={Unidades} />
      <Route path="/configuracoes" component={Configuracoes} />
      <Route component={NotFound} />
    </Switch>
  );
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
