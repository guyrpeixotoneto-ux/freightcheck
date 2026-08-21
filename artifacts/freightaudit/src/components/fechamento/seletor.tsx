import { cn } from "@/lib/utils";

/**
 * O SELETOR DE RECORTE — um botão por posição, e a posição na URL.
 *
 * O mesmo controle no Resumo geral e na Conciliação: escolher a 1ª quinzena, a
 * 2ª ou o consolidado é a mesma pergunta nas duas telas, e quem troca de tela
 * não deveria reaprender o gesto. Ele não guarda estado — quem chama põe o
 * valor na URL, para que o endereço colado numa mensagem abra exatamente o que
 * quem colou estava vendo.
 */
export function Seletor<T extends string>({
  valor,
  opcoes,
  onTrocar,
}: {
  valor: T;
  opcoes: readonly (readonly [T, string])[];
  onTrocar: (valor: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted p-1">
      {opcoes.map(([v, rotulo]) => (
        <button
          key={v}
          type="button"
          onClick={() => onTrocar(v)}
          className={cn(
            "rounded-md px-4 py-1.5 text-sm font-medium transition-colors",
            valor === v
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {rotulo}
        </button>
      ))}
    </div>
  );
}

