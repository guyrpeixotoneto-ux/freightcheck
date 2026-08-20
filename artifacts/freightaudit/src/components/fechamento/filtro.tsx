import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * O recorte de uma lista, na etiqueta que as telas do Fechamento usam.
 *
 * Nasceu em Apurações e passou a servir também a lista de Remuneração — as duas
 * fazem a mesma pergunta ("mostre só este pedaço") e devem tê-la com a mesma
 * cara. Uma segunda cópia da etiqueta acabaria com dois formatos de filtro no
 * mesmo produto, e a diferença entre eles não diria nada a quem lê.
 *
 * A etiqueta escreve o **rótulo e a escolha juntos** — "Quinzena todas" — em vez
 * de um seletor cinza com um valor dentro: assim uma fila de quatro filtros
 * continua legível de longe, e o que está recortado se distingue do que não
 * está sem precisar abrir nenhum deles. O filtro ativo ganha a cor de destaque
 * pela mesma razão.
 */

/** O sentinela: nenhum recorte aplicado. */
export const TUDO = "*";

export function Filtro({
  rotulo,
  valor,
  aoTrocar,
  opcoes,
  tudo,
}: {
  rotulo: string;
  valor: string;
  aoTrocar: (v: string) => void;
  opcoes: { valor: string; rotulo: string }[];
  /** Como se escreve "sem recorte" neste filtro — "todas", "todos". */
  tudo: string;
}) {
  const escolhida = opcoes.find((o) => o.valor === valor);
  const ativo = valor !== TUDO;
  return (
    <Select value={valor} onValueChange={aoTrocar}>
      <SelectTrigger
        className={cn(
          "h-auto w-auto gap-2 rounded-full px-4 py-2 shadow-none",
          ativo && "border-primary text-primary",
        )}
        aria-label={rotulo}
      >
        <span className="font-semibold">{rotulo}</span>
        <span className={cn("font-normal", ativo ? "text-primary/80" : "text-muted-foreground")}>
          {escolhida?.rotulo ?? tudo}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={TUDO}>{tudo}</SelectItem>
        {opcoes
          .filter((o) => o.valor !== TUDO)
          .map((o) => (
            <SelectItem key={o.valor} value={o.valor}>
              {o.rotulo}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
