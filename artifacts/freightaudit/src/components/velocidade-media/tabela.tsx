import { Info } from "lucide-react";
import type { LinhaDeVelocidade } from "@workspace/comparison/velocidade-media";
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
  UNIDADE_DO_PAPEL,
  corDaDiferenca,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
} from "@/lib/velocidade-media";

/**
 * A tabela da comparação — nove colunas, e nenhuma conta dentro do JSX.
 *
 * Tudo o que aparece aqui já veio decidido: o estado, a diferença, a variação e a
 * unidade de cada uma. O componente escolhe a cor e escreve.
 *
 * **Duas colunas que a tela por placa não precisava ter.** A de **unidade**,
 * porque numa mesma coluna de valores convivem km/h, minutos, km e motoristas
 * por conjunto; e a de **versão**, porque o mesmo TMA aparece duas vezes na
 * tabela — o que a operação pratica e o que a remuneração paga. Sem ela, duas
 * linhas com o mesmo nome e números diferentes parecem um erro de importação, e
 * são o assunto.
 *
 * **O selo de estado tem texto, e não só cor.** Quem não distingue o verde do
 * vermelho continua lendo "Alterado" e "Conflito".
 */
export function TabelaDeVelocidade({
  linhas,
  justificadaPor,
  onAbrir,
  onJustificar,
}: {
  linhas: LinhaDeVelocidade[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (linha: LinhaDeVelocidade) => void;
  /** Sem ele a coluna é só de leitura — ver `CelulaDeJustificativa`. */
  onJustificar?: AbrirJustificativa;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[62rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação do tempo de ciclo e da velocidade entre a vigência base e a comparada, por
          trecho e variável.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {[
              "Trecho",
              "Variável",
              "Unidade",
              "Versão",
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
              aria-label={`Abrir ${l.entityLabel ?? "trecho"} — ${l.rotuloDaVariavel}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAbrir(l);
                }
              }}
            >
              <td className="max-w-[16rem] truncate px-3 py-2 font-mono text-xs font-semibold">
                {l.entityLabel ?? "—"}
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
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono">
                  {UNIDADE_DO_PAPEL[l.papel]}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {l.versaoLucro ? (
                  <span className="rounded-full border border-brand/25 bg-brand/10 px-2 py-0.5 font-semibold text-brand">
                    Remuneração
                  </span>
                ) : (
                  <span className="text-muted-foreground">Operação</span>
                )}
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
                  corDaDiferenca(l.diferenca, l.papel),
                )}
              >
                {escreverDiferenca(l.diferenca, l.medida)}
              </td>
              <td
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums",
                  corDaDiferenca(l.diferenca, l.papel),
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
          ))}
        </tbody>
      </table>
    </div>
  );
}
