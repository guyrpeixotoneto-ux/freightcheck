import { Info } from "lucide-react";
import type { LinhaDeLucroFixo } from "@workspace/comparison/lucro-fixo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/lucro-fixo";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * A tabela da comparação — oito colunas, e nenhuma conta dentro do JSX.
 *
 * Tudo o que aparece aqui já veio decidido: o estado, a diferença, a variação e
 * a unidade de cada uma. O componente escolhe a cor e escreve.
 *
 * **A cor passa a variável junto**, e é a única diferença estrutural em relação
 * às tabelas de FINAME e IPVA: nesta tela convivem uma receita (o lucro fixo) e
 * um custo (a amortização), e a mesma seta para cima significa coisas opostas
 * nas duas linhas. `corDaDiferenca` decide por variável — ver `lib/lucro-fixo.ts`.
 *
 * **O selo de estado tem texto, e não só cor**: quem não distingue o verde do
 * vermelho continua lendo "Alterado" e "Conflito".
 */
export function TabelaDeLucroFixo({
  linhas,
  onAbrir,
}: {
  linhas: LinhaDeLucroFixo[];
  onAbrir: (linha: LinhaDeLucroFixo) => void;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação de lucro fixo entre as duas vigências, por veículo e variável.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {["Veículo", "Tipo", "Variável", "De", "Para", "Diferença", "Variação %", "Status"].map(
              (titulo, i) => (
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
              ),
            )}
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
              <td className="whitespace-nowrap px-3 py-2">
                <span className="flex items-center gap-1.5">
                  {l.rotuloDaVariavel}
                  {l.foraDaSoma && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Esta coluna não entra em soma nenhuma: ${l.foraDaSoma}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Info className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm text-xs">
                        <strong className="font-semibold">Fora de toda soma.</strong>{" "}
                        {l.foraDaSoma}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverValor(l.base, l.medida)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                {escreverValor(l.comparada, l.medida)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                  corDaDiferenca(l.diferenca, l.medida, l.variavel),
                )}
              >
                {escreverDiferenca(l.diferenca, l.medida)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                  corDaDiferenca(l.diferenca, l.medida, l.variavel),
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
