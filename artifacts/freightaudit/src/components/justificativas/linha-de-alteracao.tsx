import { CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ChangeRow } from "@/components/changes/change-table";
import type { Justificativa } from "@/lib/justificativas";

/**
 * Uma alteração, justificada ou não — a mesma linha que a lista de
 * Justificativas usa dentro do card de cada placa, e que a tela de detalhe
 * por placa (`justificativas-placa.tsx`) usa sozinha, uma por alteração.
 *
 * `mostrarSelecao` existe porque as duas telas discordam de quando o
 * checkbox por linha vale a pena: no card agrupado por placa, uma placa com
 * 1 alteração só já tem o checkbox do cabeçalho — repetir na linha seria
 * ruído. Na tela de detalhe, que existe justamente para decidir alteração a
 * alteração, o checkbox aparece sempre.
 */
export function LinhaDeAlteracao({
  change,
  justificativa,
  mostrarSelecao,
  selecionada,
  onSelecionar,
  onJustificar,
}: {
  change: ChangeRow;
  justificativa: Justificativa | null;
  mostrarSelecao: boolean;
  selecionada: boolean;
  onSelecionar: () => void;
  onJustificar: () => void;
}) {
  return (
    <li className="text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {mostrarSelecao && (
          <Checkbox
            checked={selecionada}
            onCheckedChange={onSelecionar}
            aria-label={`Selecionar alteração ${change.attributeName ?? change.attributeCode ?? change.id}`}
          />
        )}
        <span className="font-medium">
          {change.attributeName ?? change.attributeCode ?? "—"}
        </span>
        <span className="text-muted-foreground font-mono text-xs">
          {change.valueBefore ?? "—"} → {change.valueAfter ?? "—"}
        </span>
        {justificativa ? (
          <Badge variant="success" className="gap-1">
            <CheckCircle2 className="w-3 h-3" /> Justificada
          </Badge>
        ) : (
          <Badge variant="warning">Pendente</Badge>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onJustificar}
        >
          {justificativa ? "Justificar de novo" : "Justificar"}
        </Button>
      </div>

      {justificativa && (
        <div className="mt-1.5 rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <p>{justificativa.texto}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {justificativa.criadoPor} ·{" "}
            {new Date(justificativa.criadoEm).toLocaleString("pt-BR")}
          </p>
        </div>
      )}
    </li>
  );
}
