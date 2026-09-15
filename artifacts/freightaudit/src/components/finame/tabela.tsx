import { Info } from "lucide-react";
import type { LinhaDeFiname } from "@workspace/comparison/finame";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverDataDeCadastro,
  escreverDiferenca,
  escreverPeriodo,
  escreverValor,
  escreverVariacao,
} from "@/lib/finame";
import type { Justificativa } from "@/lib/justificativas";

const ROTULO_DO_TIPO: Record<string, string> = { CAVALO: "Cavalo", CARRETA: "Carreta" };

/** As colunas, na ordem da tela — e de que lado cada número encosta. */
const COLUNAS: { titulo: string; direita?: boolean }[] = [
  { titulo: "Veículo" },
  { titulo: "Tipo" },
  { titulo: "Período FINAME", direita: true },
  { titulo: "Data de cadastro", direita: true },
  { titulo: "Variável" },
  { titulo: "De", direita: true },
  { titulo: "Para", direita: true },
  { titulo: "Diferença", direita: true },
  { titulo: "Variação %", direita: true },
  { titulo: "Status" },
  { titulo: "Justificativa" },
];

/**
 * A tabela da comparação — onze colunas, e nenhuma conta dentro do JSX.
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
 * das linhas empurraria as colunas úteis para fora da tela.
 *
 * **Período FINAME, Data de cadastro e Justificativa são colunas de contexto**,
 * e por isso moram nas pontas: prazo e data junto do veículo, que são dele e não
 * da variável da linha, e a justificativa no fim, depois do veredito que ela
 * explica. Nenhuma das três entra em conta nenhuma — prazo e data vêm da leitura
 * da vigência comparada (a base responde pelo veículo que saiu) e a justificativa
 * vem de `/justificativas`, escrita por um gestor sobre aquela alteração.
 *
 * A justificativa só existe para a linha que o motor produziu: uma linha "sem
 * alteração" não tem `change.id`, e portanto não tem o que justificar. Ali a
 * célula fica em branco, e não com um traço que sugerisse pendência.
 */
export function TabelaDeFiname({
  linhas,
  justificadaPor,
  onAbrir,
}: {
  linhas: LinhaDeFiname[];
  /** A justificativa mais recente de cada alteração, por `change.id`. */
  justificadaPor?: ReadonlyMap<number, Justificativa>;
  onAbrir: (linha: LinhaDeFiname) => void;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[80rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação de FINAME entre as duas vigências do par, por veículo e variável.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {COLUNAS.map((coluna) => (
              <th
                key={coluna.titulo}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
                  coluna.direita ? "text-right" : "text-left",
                )}
              >
                {coluna.titulo}
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
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {escreverPeriodo(l.periodoFiname)}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">
                {escreverDataDeCadastro(l.dataDeCadastro)}
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
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {(() => {
                  const justificativa = l.id === null ? undefined : justificadaPor?.get(l.id);
                  if (!justificativa) {
                    return l.id === null ? (
                      ""
                    ) : (
                      <span className="text-muted-foreground/70">Sem justificativa</span>
                    );
                  }
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="block max-w-[18rem] truncate text-left">
                          {justificativa.texto}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-sm text-xs">
                        {justificativa.texto}
                        <span className="mt-1 block text-muted-foreground">
                          {justificativa.criadoPor}
                        </span>
                      </TooltipContent>
                    </Tooltip>
                  );
                })()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
