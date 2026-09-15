import { Info, Percent } from "lucide-react";
import type { LinhaDeImpostos } from "@workspace/comparison/impostos";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  ROTULO_DO_TRIBUTO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/impostos";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/**
 * A tabela da comparação — nove colunas, e nenhuma conta dentro do JSX.
 *
 * Tudo o que aparece aqui já veio decidido: o estado, a diferença, a variação e a
 * unidade de cada uma. O componente escolhe a cor e escreve; enquanto a conta
 * morava na célula, a mesma diferença aparecia formatada de dois jeitos em duas
 * telas.
 *
 * **A coluna "Tributo" é a que esta tabela tem a mais**, e ela não é decoração:
 * ICMS e PIS/COFINS não somam entre si, e sem a coluna as duas rubricas se
 * misturam numa lista ordenada por placa. Com ela, o filtro do topo tem onde
 * morder e o olho separa as duas sem ler o nome de cada variável.
 *
 * **O selo de estado tem texto, e não só cor.** Quem não distingue o verde do
 * vermelho continua lendo "Alterado" e "Conflito" — e a coluna de status é a
 * única em que o estado aparece, então cor sozinha aqui seria informação perdida,
 * não redundância perdida.
 *
 * **Dois avisos moram junto do nome da variável, e não numa coluna própria**,
 * pela mesma razão que o motivo da recusa: eles existem em poucas linhas de cada
 * cem, e uma coluna vazia em noventa e oito por cento delas empurraria as nove
 * colunas úteis para fora da tela.
 *
 * - O **por cento** — esta linha é uma alíquota declarada, não dinheiro. Numa
 *   coluna de números em que a linha de cima é R$ 37.890,84, o `12` da linha de
 *   baixo pede o aviso: ele não entra em soma nenhuma.
 * - O **fora da soma** — o montante de ICMS, zerado nas 1.215 linhas do acervo.
 *   Ele aparece na tabela de propósito: esconder o achado seria apagá-lo, e o
 *   ⓘ ao lado é o que impede alguém de somar a coluna no Excel e concluir que
 *   não há ICMS.
 */
export function TabelaDeImpostos({
  linhas,
  onAbrir,
}: {
  linhas: LinhaDeImpostos[];
  onAbrir: (linha: LinhaDeImpostos) => void;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação dos impostos da compra entre a vigência base e a comparada, por veículo
          e variável.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {[
              "Veículo",
              "Tipo",
              "Tributo",
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
                  i >= 4 && i <= 7 ? "text-right" : "text-left",
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
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {l.tributo ? (
                  <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-semibold">
                    {ROTULO_DO_TRIBUTO[l.tributo]}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2">
                <span className="flex items-center gap-1.5">
                  {l.rotuloDaVariavel}
                  {l.papel === "ALIQUOTA" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label="Esta linha é uma alíquota declarada, e não dinheiro"
                          onClick={(e) => e.stopPropagation()}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Percent className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        <strong className="font-semibold">Alíquota, não montante.</strong>{" "}
                        É a taxa que o ativo declara — nunca entra numa soma de reais. O
                        dinheiro correspondente está na linha do montante do mesmo tributo.
                      </TooltipContent>
                    </Tooltip>
                  )}
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
