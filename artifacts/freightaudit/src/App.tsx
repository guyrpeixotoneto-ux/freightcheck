import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';
import { AuthProvider, useAuth } from '@/lib/auth';
import Login from '@/pages/login';

import Inicio from '@/pages/inicio';
import Alteracoes from '@/pages/alteracoes';
import Comparar from '@/pages/comparar';
import Importacoes from '@/pages/importacoes';
import ApresentacaoVideo from '@/components/video/ApresentacaoVideo';
import AnaliseEquipamentos from '@/pages/analise-equipamentos';
import Curadoria from '@/pages/curadoria';
import Vigencias from '@/pages/vigencias';
import Versoes from '@/pages/versoes';

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
const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Inicio} />
      <Route path="/apresentacao" component={ApresentacaoVideo} />
      <Route path="/alteracoes" component={Alteracoes} />
      <Route path="/comparar" component={Comparar} />
      <Route path="/importacoes" component={Importacoes} />
      <Route path="/analise-equipamentos" component={AnaliseEquipamentos} />
      <Route path="/curadoria" component={Curadoria} />
      <Route path="/vigencias" component={Vigencias} />
      <Route path="/versoes" component={Versoes} />
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
