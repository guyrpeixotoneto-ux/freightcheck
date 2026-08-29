import {
  Activity,
  AlertTriangle,
  Map as MapIcon,
  Milestone,
  Rows3,
  Table2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { VISUALIZACOES, type Visualizacao } from "@/lib/fluxos-visoes";

/**
 * O SELETOR DE VISUALIZAÇÃO — o controle que substituiu o "Modo Processo".
 *
 * O que havia antes anunciava um segundo modo que não existia. O que existe
 * agora são seis ângulos do **mesmo** processo, e a troca entre eles é uma
 * mudança de estado local: nenhuma requisição, nenhuma navegação, nenhuma
 * gravação. O que muda é qual função pura desenha o mesmo `FluxoCompleto` que
 * já está em memória — por isso a troca é imediata e por isso ela não pode
 * criar linha nenhuma no banco.
 *
 * O ícone e a descrição vêm de `VISUALIZACOES`, em `lib/fluxos-visoes.ts`, pela
 * mesma razão que os tipos de etapa vêm do catálogo da API: uma segunda lista
 * escrita aqui seria o jeito conhecido de uma visualização nova existir e não
 * aparecer no seletor.
 */
const ICONES: Record<string, LucideIcon> = {
  Activity,
  Workflow,
  Rows3,
  Milestone,
  Map: MapIcon,
  Table2,
  AlertTriangle,
};

export function SeletorDeVisualizacao({
  valor,
  aoTrocar,
}: {
  valor: Visualizacao;
  aoTrocar: (visualizacao: Visualizacao) => void;
}) {
  return (
    <Select value={valor} onValueChange={(v) => aoTrocar(v as Visualizacao)}>
      <SelectTrigger className="h-8 w-[170px]" aria-label="Visualização">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {VISUALIZACOES.map((v) => {
          const Icone = ICONES[v.icone] ?? Workflow;
          return (
            <SelectItem key={v.valor} value={v.valor}>
              <span className="flex items-center gap-2">
                <Icone className="h-3.5 w-3.5 text-muted-foreground" />
                {v.rotulo}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
