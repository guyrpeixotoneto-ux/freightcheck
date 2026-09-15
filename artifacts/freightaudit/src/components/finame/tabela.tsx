import { Info } from "lucide-react";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/finame";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * A tabela da comparação — oito colunas, e nenhuma conta dentro do JSX.
 *
 * Tudo o que aparece aqui já veio decidido: o estado, a diferença, a variação e
 * a unidade de cada uma. O componente escolhe a cor e escreve; enquanto a conta
 * morava na célula, a mesma diferença aparecia formatada de dois jeitos em duas
 * telas.
 *
 * **O selo de estado tem texto, e não só cor.** Quem não distingue o verde do
 * vermelho continua lendo "Alterado" e "Conflito" — e a coluna de status é a
 * única em que o estado aparece, então cor sozinha aqui seria informação
 * perdida, não redundância perdida.
 *
 * O motivo da recusa fica num ⓘ ao lado do selo, e não numa coluna: ele existe
 * em duas linhas de cada cem, e uma coluna vazia em noventa e oito por cento
 * das linhas empurraria as oito colunas úteis para fora da tela.
 */
export function TabelaDeFiname({
  linhas,
  onAbrir,
}: {
  linhas: LinhaDeFiname[];
  onAbrir: (linha: LinhaDeFiname) => void;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação de FINAME entre as duas vigências do par, por veículo e variável.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {[
              "Veículo",
              "Tipo",
              "Variável",
              "De",
              "Para",
              "Diferença",
              "Variação %",
              "Status",
            ].map((titulo, i) => (
              <th
                key={titulo}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
                  i >= 3 && i <= 6 ? "text-right" : "text-left",
                )}
              >
                {titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, indice) => (
            <tr
              key={`${l.id ?? "igual"}-${l.entityLabel}-${l.variavel}-${indice}`}
              className="cursor-pointer border-b border-superficie-borda last:border-0 hover:bg-muted/50"
              onClick={() => onAbrir(l)}
              tabIndex={0}
              role="button"
              aria-label={`Abrir ${l.entityLabel ?? "veículo"} — ${l.rotuloDaVariavel}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAbrir(l);
                }
              }}
            >
              <td className="whitespace-nowrap px-3 py-2 font-mono font-semibold">
                {l.entityLabel ?? "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                {ROTULO_DO_TIPO[l.entityType] ?? l.entityType}
              </td>
              <td className="whitespace-nowrap px-3 py-2">{l.rotuloDaVariavel}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverValor(l.base, l.medida)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverValor(l.comparada, l.medida)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                  corDaDiferenca(l.diferenca, l.medida),
                )}
              >
                {escreverDiferenca(l.diferenca, l.medida)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                  corDaDiferenca(l.diferenca, l.medida),
                )}
              >
                {escreverVariacao(l.variacao)}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                      SELO_DO_ESTADO[l.estado],
                    )}
                  >
                    {ROTULO_DO_ESTADO[l.estado]}
                  </span>
                  {l.motivo && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Por que esta linha não foi comparada: ${l.motivo}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">{l.motivo}</TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
