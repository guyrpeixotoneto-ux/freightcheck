import { cn } from "@/lib/utils";
import {
  QUANTIDADES,
  UNIDADES,
  rotuloDaUnidade,
  type Janela,
} from "@/lib/janela-de-vigencias";

/**
 * O seletor de janela — "quantas, e de quê" — acima de um gráfico de vigências.
 *
 * São dois grupos e não seis botões soltos: o número e a unidade são duas
 * perguntas independentes ("quantas?" e "de quê?"), e trocar de unidade
 * preserva o número já escolhido — quem está em 6 vigências e quer 6 meses dá
 * um clique, não dois.
 *
 * Quem chama decide **se** ele aparece: com menos histórico do que a menor
 * janela mostra, todos os botões desenhariam o mesmo gráfico e prometeriam uma
 * escolha que não existe.
 */
export function SeletorDeJanela({
  janela,
  onJanela,
  className,
}: {
  janela: Janela;
  onJanela: (janela: Janela) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2 shrink-0", className)}>
      <div className="flex items-center gap-1" role="group" aria-label="Tamanho da janela">
        {QUANTIDADES.map((quantidade) => (
          <button
            key={quantidade}
            type="button"
            onClick={() => onJanela({ ...janela, quantidade })}
            aria-pressed={janela.quantidade === quantidade}
            title={`Mostrar ${quantidade} ${rotuloDaUnidade(janela.unidade)}`}
            className={cn(
              "rounded-lg border px-2 py-1 text-xs font-semibold transition-colors",
              janela.quantidade === quantidade
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {quantidade}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1" role="group" aria-label="Unidade da janela">
        {UNIDADES.map((unidade) => (
          <button
            key={unidade}
            type="button"
            onClick={() => onJanela({ ...janela, unidade })}
            aria-pressed={janela.unidade === unidade}
            title={`Contar a janela em ${rotuloDaUnidade(unidade)}`}
            className={cn(
              "rounded-lg border px-2 py-1 text-xs font-semibold transition-colors",
              janela.unidade === unidade
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            {rotuloDaUnidade(unidade)}
          </button>
        ))}
      </div>
    </div>
  );
}
