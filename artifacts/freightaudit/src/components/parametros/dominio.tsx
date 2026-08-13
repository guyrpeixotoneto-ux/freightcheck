import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { TabelaFreightech, type ColunaTabela } from "@/components/parametros/tabela";

/**
 * O cadastro do Freightech, reconstruído do export.
 *
 * Boa parte dos cartões de lá abre uma lista de valores registrados — PADRÃO
 * traz 6X4, 6X2, 4X2, 6X6, 8X2 e nada mais. O FreightCheck não recebe esses
 * cadastros; recebe a coluna correspondente do export, uma por ativo. Esta
 * tabela é a ponte: os valores que **de fato existem na frota**.
 *
 * A coluna que o Freightech não tem é a que mais interessa aqui: **quantos
 * ativos estão em cada valor**. Lá, 8X2 aparece porque está cadastrado; aqui
 * aparece com a informação de que nenhum caminhão o usa — a diferença entre uma
 * opção viva e uma que sobrou no cadastro.
 *
 * Ausência ganha linha própria, com o motivo, e nunca é contada como um valor
 * do cadastro: misturar "sem informação" com os padrões faria a lista mentir
 * sobre o que a frota tem.
 */

interface DominioAtributo {
  attributeCode: string;
  title: string;
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  entities: number;
  values: {
    value: string | null;
    entities: number;
    share: number;
    nullReason: string | null;
  }[];
}

type LinhaDominio = DominioAtributo["values"][number];

export function TabelaDominio({
  attributeCode,
  rotuloDaColuna,
  contexto,
}: {
  attributeCode: string;
  /** O nome que o Freightech dá à coluna de valor — "Descricao" no PADRÃO. */
  rotuloDaColuna: string;
  contexto: URLSearchParams;
}) {
  const query = new URLSearchParams(contexto);

  const { data, isLoading, error } = useQuery({
    queryKey: ["dominio", attributeCode, query.toString()],
    queryFn: async () => {
      const sufixo = query.toString() ? `?${query}` : "";
      const resposta = await fetch(
        getApiUrl(`/attributes/${encodeURIComponent(attributeCode)}/domain${sufixo}`),
      );
      if (resposta.status === 404) return null;
      if (!resposta.ok) {
        throw new Error((await resposta.json()).error ?? "Falha ao carregar");
      }
      return (await resposta.json()) as DominioAtributo;
    },
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  if (error) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm">
        {(error as Error).message}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm">
        A coluna <span className="font-mono">{attributeCode}</span> não veio nesta
        vigência. O cartão existe e a coluna é conhecida — o arquivo desta vigência é que
        não a trouxe.
      </div>
    );
  }

  const colunas: ColunaTabela<LinhaDominio>[] = [
    {
      titulo: rotuloDaColuna,
      alinhar: "center",
      valor: (linha) => linha.value ?? "",
      celula: (linha) =>
        linha.value === null ? (
          <span className="text-muted-foreground italic">
            sem valor — {linha.nullReason}
          </span>
        ) : (
          <span className="font-medium">{linha.value}</span>
        ),
    },
    {
      titulo: "Ativos",
      alinhar: "right",
      valor: (linha) => linha.entities,
      celula: (linha) => <span className="tabular-nums">{linha.entities}</span>,
    },
    {
      titulo: "Fatia da frota",
      alinhar: "right",
      valor: (linha) => linha.share,
      celula: (linha) => (
        <div className="flex items-center justify-end gap-2">
          <span className="tabular-nums text-xs text-muted-foreground w-12 text-right">
            {linha.share.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
          </span>
          {/*
            A barra é leitura de relance e nada mais: o número ao lado é a
            medida. Barra sem número ao lado convida a estimar de olho.
          */}
          <span className="w-24 h-2 bg-muted overflow-hidden" role="presentation">
            <span
              className={cn("block h-full", linha.value === null ? "bg-muted-foreground/40" : "bg-brand")}
              style={{ width: `${Math.min(linha.share, 100)}%` }}
            />
          </span>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {data.values.length}{" "}
        {data.values.length === 1 ? "valor distinto" : "valores distintos"} em{" "}
        <strong className="text-foreground">{data.entities}</strong> ativos —{" "}
        {data.periodLabel}
        {data.sourceLabels.length > 0 && (
          <>
            {" · "}
            <span className="font-mono">{data.sourceLabels.join(", ")}</span>
          </>
        )}
        . Coluna <span className="font-mono">{data.attributeCode}</span>.
      </p>

      <TabelaFreightech
        id={`dominio:${attributeCode}`}
        colunas={colunas}
        linhas={data.values}
        chave={(linha) => linha.value ?? "__sem_valor__"}
        vazio={
          <span className="text-sm text-muted-foreground">
            Nenhum ativo tem valor nesta coluna nesta vigência.
          </span>
        }
      />
    </div>
  );
}
