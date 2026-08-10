import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import Dashboard from '@/pages/dashboard';
import SnapshotsList from '@/pages/snapshots';
import SnapshotDetail from '@/pages/snapshots/[id]';
import Alteracoes from '@/pages/alteracoes';
import Comparar from '@/pages/comparar';
import Simulacao from '@/pages/simulacao';
import Importacoes from '@/pages/importacoes';
import ApresentacaoVideo from '@/components/video/ApresentacaoVideo';
import AnaliseEquipamentos from '@/pages/analise-equipamentos';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/apresentacao" component={ApresentacaoVideo} />
      <Route path="/snapshots" component={SnapshotsList} />
      <Route path="/snapshots/:id" component={SnapshotDetail} />
      <Route path="/alteracoes" component={Alteracoes} />
      <Route path="/comparar" component={Comparar} />
      <Route path="/simulacao" component={Simulacao} />
      <Route path="/importacoes" component={Importacoes} />
      <Route path="/analise-equipamentos" component={AnaliseEquipamentos} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
