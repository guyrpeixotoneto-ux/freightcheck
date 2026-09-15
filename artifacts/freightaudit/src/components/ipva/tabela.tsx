import { Info, TriangleAlert } from "lucide-react";
import type { LinhaDeIpva } from "@workspace/comparison/ipva";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CelulaDeJustificativa,
  COLUNA_DE_JUSTIFICATIVA,
  type AbrirJustificativa,
} from "@/components/justificativas/coluna";
import type { Justificativa } from "@/lib/justificativas";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
  temValorNegativo,
} from "@/lib/ipva";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * A tabela da comparação — oito colunas, e nenhuma conta dentro do JSX.
 *
 * Tudo o que aparece aqui já veio decidido: o estado, a diferença, a variação e a
 * unidade de cada uma. O componente escolhe a cor e escreve; enquanto a conta
 * morava na célula, a mesma diferença aparecia formatada de dois jeitos em duas
 * telas.
 *
 * **O selo de estado tem texto, e não só cor.** Quem não distingue o verde do
 * vermelho continua lendo "Alterado" e "Conflito" — e a coluna de status é a
 * única em que o estado aparece, então cor sozinha aqui seria informação perdida,
 * não redundância perdida.
 *
 * **Dois avisos moram na coluna do veículo, e não numa coluna própria**, pela
 * mesma razão que o motivo da recusa: eles existem em poucas linhas de cada cem,
 * e uma coluna vazia em noventa e oito por cento delas empurraria as oito
 * colunas úteis para fora da tela.
 *
 * - O **negativo** — um licenciamento abaixo de zero, que ou é estorno ou é erro
 *   e nos dois casos entra numa soma e a distorce.
 * - O **fora da soma** — a coluna "mensal" da carreta, que não é 1/12 da anual.
 *   Ela aparece na tabela de propósito: esconder o achado seria apagá-lo. O
 *   triângulo ao lado do valor é o que impede alguém de somar a coluna no Excel
 *   sem saber o que está somando.
 */
export function TabelaDeIpva({
  linhas,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  linhas: LinhaDeIpva[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (linha: LinhaDeIpva) => void;
  /** Sem ele a coluna é só de leitura — ver `CelulaDeJustificativa`. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação de IPVA entre a vigência base e a comparada, por veículo e variável.
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
              COLUNA_DE_JUSTIFICATIVA,
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
          {linhas.map((l, indice) => {
            const negativo = temValorNegativo(l);
            return (
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
                  <span className="flex items-center gap-1.5">
                    {l.entityLabel ?? "—"}
                    {negativo && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            aria-label="Valor negativo nesta linha: estorno ou erro de cadastro"
                            onClick={(e) => e.stopPropagation()}
                            className="text-warning-foreground"
                          >
                            <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Uma das pontas é negativa. Continua somando, como a planilha a
                          declarou — mas um licenciamento negativo ou é estorno, ou é erro de
                          cadastro.
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
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
                        <TooltipContent className="max-w-xs text-xs">
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
                {/* O clique da célula é dela: a linha inteira abre o detalhe. */}
                <td className="px-3 py-2 text-xs">
                  <CelulaDeJustificativa
                    linha={l}
                    justificativa={l.id === null ? undefined : justificadaPor?.get(l.id)}
                    onJustificar={onJustificar}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
