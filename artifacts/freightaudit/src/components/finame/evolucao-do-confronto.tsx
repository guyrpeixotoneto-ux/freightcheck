import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, FileText } from "lucide-react";

import type { Competencia } from "@workspace/comparison/competencia-de-finame";
import type { RecorteDeTipo } from "@/components/comparacao/recorte-de-equipamento";
import { ApiErrorNotice } from "@/components/api-error";
import { EstadoVazio } from "@/components/ui/estado-vazio";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchJson } from "@/lib/api";
import { formatNumber } from "@/lib/format";
import { escreverDinheiro } from "@/lib/confronto-de-finame";
import { consultaDoConfronto } from "@/lib/fonte-de-finame";
import { cn } from "@/lib/utils";

/**
 * A EVOLUÇÃO DA FONTE REAL — os dois lados, competência a competência.
 *
 * Três séries e não uma: remunerado, realizado e a distância entre eles. Só o
 * realizado responderia "quanto custou", que não é a pergunta desta fonte — a
 * pergunta é se o que foi pago acompanhou o que foi gasto, e ela precisa dos
 * dois traçados no mesmo eixo.
 *
 * Cada ponto diz quantos veículos o sustentam. Sem isso, um mês com cobertura
 * pela metade desceria no gráfico como se o custo tivesse caído — o movimento
 * seria da conciliação, e o gráfico o atribuiria ao dinheiro.
 */
interface PontoDaEvolucao {
  competencia: Competencia;
  rotulo: string;
  remunerado: number;
  realizado: number;
  diferenca: number;
  conciliados: number;
}

interface RespostaDaEvolucao {
  serie: PontoDaEvolucao[] | null;
  realizado:
    | { disponivel: true; fonte: string }
    | { disponivel: false; fonte: string; frase: string; oQueFalta?: string };
}

export function EvolucaoDoConfronto({
  consulta,
  tipo,
}: {
  consulta: URLSearchParams;
  tipo: RecorteDeTipo;
}) {
  const evolucao = useQuery({
    queryKey: ["finame", "confronto", "evolucao", consulta.toString(), tipo],
    queryFn: () =>
      fetchJson<RespostaDaEvolucao>(
        `/finame/confronto/evolucao?${consultaDoConfronto(consulta, null, tipo)}`,
      ),
  });

  if (evolucao.error) {
    return (
      <ApiErrorNotice
        error={evolucao.error}
        what="a evolução do confronto"
        onTentarDeNovo={() => void evolucao.refetch()}
      />
    );
  }

  if (evolucao.isLoading || !evolucao.data) return <Skeleton className="h-72 w-full" />;

  if (!evolucao.data.realizado.disponivel) {
    return (
      <EstadoVazio
        icone={AlertTriangle}
        tom="atencao"
        titulo="Fonte sem dados"
        descricao={
          <>
            {evolucao.data.realizado.frase}
            {evolucao.data.realizado.oQueFalta && (
              <>
                <br />
                <span className="text-xs">{evolucao.data.realizado.oQueFalta}</span>
              </>
            )}
          </>
        }
      />
    );
  }

  const serie = evolucao.data.serie ?? [];
  if (serie.length === 0) {
    return (
      <EstadoVazio
        icone={FileText}
        titulo="Nenhuma competência com os dois lados"
        descricao="Não há mês em que remunerado e realizado tenham placas conciliadas. Nada foi somado."
      />
    );
  }

  /* A escala sai do maior valor **das duas séries**: escalas independentes
     fariam duas linhas de alturas incomparáveis parecerem próximas. */
  const teto = Math.max(...serie.flatMap((p) => [p.remunerado, p.realizado, 0]));

  return (
    <div className="rounded-lg border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold">FINAME remunerado × realizado por competência</h2>
        <p className="text-xs text-muted-foreground">
          Totais dos veículos conciliados em cada competência — o número de conciliados vai
          em cada linha, porque um mês com cobertura menor não é comparável a um mês cheio.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2 text-left font-semibold">Competência</th>
              <th className="px-4 py-2 text-right font-semibold">Remunerado</th>
              <th className="px-4 py-2 text-right font-semibold">Realizado</th>
              <th className="px-4 py-2 text-right font-semibold">Diferença</th>
              <th className="px-4 py-2 text-right font-semibold">Conciliados</th>
              <th className="px-4 py-2 text-left font-semibold">Proporção</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((p) => (
              <tr key={p.competencia} className="border-b last:border-0">
                <td className="px-4 py-2 font-medium">{p.rotulo}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {escreverDinheiro(p.remunerado)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {escreverDinheiro(p.realizado)}
                </td>
                <td
                  className={cn(
                    "px-4 py-2 text-right tabular-nums font-medium",
                    p.diferenca < 0 ? "text-warning-foreground" : "text-brand",
                  )}
                >
                  {escreverDinheiro(p.diferenca)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                  {formatNumber(p.conciliados, 0)}
                </td>
                <td className="px-4 py-2">
                  <span className="flex flex-col gap-1" aria-hidden="true">
                    <Barra valor={p.remunerado} teto={teto} className="bg-brand" />
                    <Barra valor={p.realizado} teto={teto} className="bg-muted-foreground/50" />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Barra({
  valor,
  teto,
  className,
}: {
  valor: number;
  teto: number;
  className: string;
}) {
  const fracao = teto <= 0 ? 0 : Math.max(0, Math.min(1, valor / teto));
  return (
    <span className="block h-1.5 w-32 rounded-full bg-muted">
      <span
        className={cn("block h-1.5 rounded-full", className)}
        style={{ width: `${fracao * 100}%` }}
      />
    </span>
  );
}
