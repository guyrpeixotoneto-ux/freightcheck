import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { PainelDaEtapa } from "@/components/fluxos/painel-da-etapa";
import type { Catalogo, Etapa, ResumoDeSubfluxo } from "@/lib/fluxos";
import type {
  CampoDaEtapaNoPainel,
  DiagnosticoDaEtapa,
  OpcoesDeResponsavel,
  ValoresDaLinha,
} from "@/lib/fluxos-analise";

/**
 * O DETALHE DA ETAPA — o mesmo conteúdo, na moldura que couber.
 *
 * O painel é um só (`PainelDaEtapa`), e é o mesmo nas seis visualizações. O que
 * este componente resolve é onde ele aparece: numa coluna fixa à direita quando
 * há largura para ela, e numa gaveta por cima quando não há.
 *
 * A escolha não é estética. Numa tela grande, ler o detalhe **ao lado** do
 * desenho é o ponto inteiro — a pergunta "como este processo funciona" se
 * responde no contexto. Num celular, uma coluna de 380px sobre uma tela de
 * 390px é o desenho inteiro tapado; ali a gaveta é o formato honesto, e ela
 * fecha por gesto, por Esc e por toque fora, que é o que já se espera de uma.
 *
 * Nas duas molduras o conteúdo é literalmente o mesmo componente. É por isso
 * que "editar responsável pela Jornada" e "editar responsável pela Lista" não
 * podem divergir: são o mesmo formulário, aberto do mesmo jeito.
 */
export function DetalheDaEtapa({
  etapa,
  catalogo,
  opcoesDeResponsavel,
  podeEditar,
  diagnostico,
  onEditar,
  onSalvarCampo,
  onSalvarLista,
  onSeguinte,
  onExcluir,
  onFechar,
  subfluxo,
  onDetalhar,
  onDesligarSubfluxo,
  detalhando,
}: {
  etapa: Etapa;
  catalogo: Catalogo | undefined;
  /** O cadastro da casa para escolher responsável — ver `PainelDaEtapa`. */
  opcoesDeResponsavel?: OpcoesDeResponsavel;
  podeEditar: boolean;
  diagnostico?: DiagnosticoDaEtapa;
  onEditar: () => void;
  /** Grava um campo de texto direto do painel — ver `PainelDaEtapa`. */
  onSalvarCampo?: (campo: CampoDaEtapaNoPainel, valor: string) => Promise<void>;
  /** Grava uma lista inteira da etapa — ver `PainelDaEtapa`. */
  onSalvarLista?: (chave: string, linhas: ValoresDaLinha[]) => Promise<void>;
  onSeguinte: () => void;
  onExcluir: () => void;
  onFechar: () => void;
  subfluxo?: ResumoDeSubfluxo | null;
  onDetalhar?: () => void;
  onDesligarSubfluxo?: () => void;
  detalhando?: boolean;
}) {
  const noCelular = useIsMobile();

  const painel = (
    <PainelDaEtapa
      etapa={etapa}
      catalogo={catalogo}
      opcoesDeResponsavel={opcoesDeResponsavel}
      podeEditar={podeEditar}
      diagnostico={diagnostico}
      onEditar={onEditar}
      onSalvarCampo={onSalvarCampo}
      onSalvarLista={onSalvarLista}
      onSeguinte={onSeguinte}
      onExcluir={onExcluir}
      onFechar={onFechar}
      subfluxo={subfluxo}
      onDetalhar={onDetalhar}
      onDesligarSubfluxo={onDesligarSubfluxo}
      detalhando={detalhando}
    />
  );

  if (!noCelular) {
    return <div className="w-[380px] shrink-0 border-l">{painel}</div>;
  }

  return (
    <Sheet open onOpenChange={(aberto) => !aberto && onFechar()}>
      <SheetContent side="bottom" className="h-[85vh] overflow-hidden p-0">
        {/* O título existe para o leitor de tela; o painel já mostra o seu. */}
        <SheetTitle className="sr-only">Detalhes da etapa {etapa.nome}</SheetTitle>
        <div className="h-full overflow-y-auto">{painel}</div>
      </SheetContent>
    </Sheet>
  );
}
