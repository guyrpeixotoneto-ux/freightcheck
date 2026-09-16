import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  ROTULO_DO_ESTADO,
  SELO_DO_ESTADO,
  corDaDiferenca,
  escreverCargo,
  escreverDiferenca,
  escreverValor,
  escreverVariacao,
  type LinhaDeQlpComparado,
} from "@/lib/qlp-comparacao";

/**
 * A tabela da comparação — uma linha por cargo e variável.
 *
 * É a mesma forma das seis auditorias de rubrica, com a coluna do ativo
 * trocada: onde elas escrevem placa, esta escreve **cargo**, e o cargo tem duas
 * metades — a unidade e o posto —, porque a chave do quadro é composta. Escrevê-
 * las juntas numa célula só faria a coluna dobrar de largura para repetir o
 * mesmo CNPJ em quarenta linhas.
 *
 * **O selo de estado tem texto, e não só cor**: quem não distingue o verde do
 * vermelho continua lendo "Alterado" e "Conflito".
 *
 * **A coluna que não entra em soma diz isso no ⓘ.** Um subtotal muda junto com
 * as parcelas dele, e a linha do subtotal ao lado das linhas das parcelas é a
 * forma mais fácil de contar a mesma mudança duas vezes.
 */
export function TabelaDaComparacaoDeQlp({
  linhas,
  rotulos,
}: {
  linhas: LinhaDeQlpComparado[];
  rotulos: Record<string, string>;
}) {
  return (
    <div className="superficie overflow-x-auto">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <caption className="sr-only">
          Comparação do quadro entre as duas vigências, por cargo e variável.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60">
            {["Cargo", "Variável", "De", "Para", "Diferença", "Variação %", "Status"].map(
              (titulo, i) => (
                <th
                  key={titulo}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap px-3 py-2.5 text-[0.65rem] font-bold uppercase tracking-[0.07em] text-muted-foreground",
                    i >= 2 && i <= 5 ? "text-right" : "text-left",
                  )}
                >
                  {titulo}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha, indice) => {
            const { unidade, cargo } = escreverCargo(linha.entityLabel, rotulos);
            return (
              <tr
                key={`${linha.entityLabel}-${linha.variavel}-${linha.id ?? indice}`}
                className="border-b border-superficie-borda hover:bg-muted/40"
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{cargo}</div>
                  {unidade && (
                    <div className="font-mono text-[0.7rem] text-muted-foreground">
                      {unidade}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    {linha.rotuloDaVariavel}
                    {linha.foraDaSoma && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info
                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                            aria-label={`Por que ${linha.rotuloDaVariavel} não entra em soma`}
                          />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                          {linha.foraDaSoma}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {escreverValor(linha.base, linha.medida)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {escreverValor(linha.comparada, linha.medida)}
                </td>
                <td
                  className={cn(
                    "px-3 py-2 text-right tabular-nums font-medium",
                    corDaDiferenca(linha.diferenca, linha.medida),
                  )}
                >
                  {escreverDiferenca(linha.diferenca, linha.medida)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {escreverVariacao(linha.variacao)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "inline-block rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
                      SELO_DO_ESTADO[linha.estado],
                    )}
                  >
                    {ROTULO_DO_ESTADO[linha.estado]}
                  </span>
                  {linha.motivo && (
                    <p className="mt-1 max-w-xs text-[0.7rem] text-muted-foreground">
                      {linha.motivo}
                    </p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
