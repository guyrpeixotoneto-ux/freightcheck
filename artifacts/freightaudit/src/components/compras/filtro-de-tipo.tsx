/**
 * Cavalo, carreta, ou os dois.
 *
 * Some quando a vigência trouxe um tipo só: um seletor com uma opção e um
 * "Todos" que dá no mesmo pede uma decisão que não existe.
 */

import { cn } from "@/lib/utils";
import type { MatrizDaFrota } from "./tipos";

export function FiltroDeTipo({
  matriz,
  tipo,
  onEscolher,
}: {
  matriz: MatrizDaFrota;
  tipo: string | null;
  onEscolher: (tipo: string | null) => void;
}) {
  const tipos = matriz.resumo.porTipo.filter((t) => t.veiculos > 0);
  if (tipos.length < 2) return null;

  return (
    <div className="flex items-center gap-1">
      {[{ entityType: null, rotulo: "Todos" }, ...tipos].map((t) => (
        <button
          key={t.entityType ?? "todos"}
          type="button"
          onClick={() => onEscolher(t.entityType)}
          className={cn(
            "px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors",
            tipo === t.entityType
              ? "border-brand text-brand bg-brand/5"
              : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          {t.rotulo}
        </button>
      ))}
    </div>
  );
}
