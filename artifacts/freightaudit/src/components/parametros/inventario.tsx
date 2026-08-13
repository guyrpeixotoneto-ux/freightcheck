import { useQuery } from "@tanstack/react-query";
import { getApiUrl } from "@/lib/api";
import { TabelaFreightech, type ColunaTabela } from "@/components/parametros/tabela";

/**
 * O inventário: uma linha por ativo, uma coluna por atributo.
 *
 * É a tela mais larga do Freightech — CARRETA abre com a placa à esquerda e
 * cinquenta colunas ao lado — e a que o operador usa para conferir um ativo
 * específico. Aqui ela é a mesma tabela, com a mesma ordem de colunas, lida do
 * nosso modelo canônico.
 *
 * **Três diferenças, e nenhuma é enfeite.**
 *
 * 1. **Célula sem valor não vira zero.** O Freightech mostra `0` onde o dado
 *    não veio; aqui a célula fica vazia com o motivo no `title`. Numa tabela de
 *    custo, "não informado" e "zero" são a diferença entre um ativo sem
 *    contrato e um ativo de graça.
 * 2. **Coluna que o dicionário não conhece é dita, não escondida.** Se o cartão
 *    pede uma coluna que o export não tem, ela aparece na nota acima da tabela.
 *    Sumir com ela faria a tabela parecer completa.
 * 3. **Colunas e ordenação são de quem lê.** Cinquenta colunas não cabem numa
 *    tela; o trilho lateral guarda quais ficam à mostra, por cartão.
 */

interface TabelaEntidades {
  seriesDelivered: boolean;
  attributesKnown: number;
  entityType: string;
  effectiveDate: string;
  periodLabel: string;
  sourceLabels: string[];
  columns: { code: string; title: string }[];
  missingColumns: string[];
  rows: {
    entityId: string;
    label: string | null;
    values: Record<string, { value: string | null; nullReason: string | null }>;
  }[];
}

type LinhaInventario = TabelaEntidades["rows"][number];

export function TabelaInventario({
  entidade,
  atributos,
  contexto,
  idDaTabela,
}: {
  entidade: string;
  atributos: string[];
  contexto: URLSearchParams;
  idDaTabela: string;
}) {
  const query = new URLSearchParams(contexto);
  query.set("entityType", entidade);
  query.set("attributes", atributos.join(","));

  const { data, isLoading, error } = useQuery({
    queryKey: ["inventario", entidade, query.toString()],
    queryFn: async () => {
      const resposta = await fetch(getApiUrl(`/entities/table?${query}`));
      if (resposta.status === 404) return null;
      if (!resposta.ok) {
        throw new Error((await resposta.json()).error ?? "Falha ao carregar");
      }
      return (await resposta.json()) as TabelaEntidades;
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
        Nenhuma vigência deste contexto tem estes ativos.
      </div>
    );
  }

  /*
    Quando não voltou nada, dizer **por quê** — e a causa não é a que a tela
    supunha.

    A mensagem antiga era sempre a mesma: "estas 38 colunas não existem no
    dicionário do export". Ela é verdadeira e responde à pergunta errada quando
    a causa real é outra: o arquivo daquele equipamento nunca foi importado
    neste contexto. Aí não há coluna alguma dele no dicionário, todas as 38
    caem em `missingColumns`, e a frase culpa o cartão por uma planilha que
    falta. As duas causas mandam fazer coisas opostas — uma manda importar, a
    outra manda conferir o cartão — e por isso viraram duas frases.
  */
  if (data.rows.length === 0 && data.attributesKnown === 0) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand-red px-6 py-4 text-sm space-y-2">
        <p className="font-medium">
          Nenhum arquivo de <span className="font-mono">{data.entityType}</span> foi
          importado neste contexto.
        </p>
        <p className="text-muted-foreground">
          Não é que este cartão peça colunas erradas: o dicionário não conhece{" "}
          <strong className="text-foreground">nenhuma</strong> coluna deste equipamento,
          porque a planilha dele nunca chegou. As {atributos.length} colunas do cartão
          existem no Freightech e continuarão sem dado até a importação — o que falta é o
          arquivo, e não o cartão.
        </p>
      </div>
    );
  }

  if (data.rows.length === 0 && !data.seriesDelivered) {
    return (
      <div className="bg-card border border-l-[6px] border-l-brand px-6 py-4 text-sm space-y-2">
        <p className="font-medium">
          {data.periodLabel} não trouxe a série{" "}
          <span className="font-mono">{data.entityType}</span>.
        </p>
        <p className="text-muted-foreground">
          O equipamento existe no dicionário — {data.attributesKnown} colunas dele são
          conhecidas — mas o arquivo desta vigência não veio. A ausência não está contada
          como zero; escolha outra vigência ou importe a que falta.
        </p>
      </div>
    );
  }

  /*
    A coluna de identidade só entra quando a placa **não voltou** — e a
    diferença entre "não voltou" e "não foi pedida" é o que importa aqui.
    CARRETA e CAVALO pedem a placa como primeira coluna, e repetir um "Ativo"
    idêntico ao lado seria a mesma informação duas vezes na tela mais larga do
    produto. Mas se o dicionário não conhecer aquela coluna, ela não volta — e
    olhar só para o que foi pedido deixaria a tabela sem nenhuma identidade,
    setenta e cinco colunas de números sem dizer de qual caminhão são.
  */
  const jaTemIdentidade = data.columns.some((coluna) => coluna.code.endsWith(".placa"));

  const colunas: ColunaTabela<LinhaInventario>[] = [
    ...(jaTemIdentidade
      ? []
      : [
          {
            titulo: "Ativo",
            alinhar: "left" as const,
            fixa: true,
            valor: (linha: LinhaInventario) => linha.label ?? "",
            celula: (linha: LinhaInventario) =>
              linha.label ? (
                <span className="font-mono font-medium">{linha.label}</span>
              ) : (
                <span className="text-muted-foreground italic text-xs">sem placa</span>
              ),
          },
        ]),
    ...data.columns.map(
      (coluna): ColunaTabela<LinhaInventario> => ({
        titulo: coluna.title,
        alinhar: "center",
        fixa: coluna.code.endsWith(".placa"),
        valor: (linha) => {
          const celula = linha.values[coluna.code];
          if (!celula || celula.value === null) return null;
          // Ordena por número quando o valor é número: numa coluna de custo,
          // ordenar "9.547,99" como texto o põe depois de "18.269,97".
          const numero = Number(celula.value);
          return Number.isFinite(numero) && celula.value.trim() !== ""
            ? numero
            : celula.value;
        },
        celula: (linha) => {
          const celula = linha.values[coluna.code];
          if (!celula) {
            return (
              <span className="text-muted-foreground" title="Coluna ausente neste ativo">
                —
              </span>
            );
          }
          if (celula.value === null) {
            return (
              <span
                className="text-muted-foreground italic text-xs"
                title={`Sem valor: ${celula.nullReason}`}
              >
                sem valor
              </span>
            );
          }
          return <span>{celula.value}</span>;
        },
      }),
    ),
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">{data.rows.length}</strong>{" "}
        {data.rows.length === 1 ? "ativo" : "ativos"} · {data.columns.length}{" "}
        {data.columns.length === 1 ? "coluna" : "colunas"} — {data.periodLabel}
        {data.sourceLabels.length > 0 && (
          <>
            {" · "}
            <span className="font-mono">{data.sourceLabels.join(", ")}</span>
          </>
        )}
        .
      </p>

      {data.missingColumns.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.missingColumns.length}{" "}
          {data.missingColumns.length === 1
            ? "coluna deste cartão não existe no dicionário do export e ficou de fora"
            : "colunas deste cartão não existem no dicionário do export e ficaram de fora"}
          :{" "}
          <span className="font-mono">{data.missingColumns.join(", ")}</span>.{" "}
          {data.missingColumns.length === 1
            ? "Ela aparece no Freightech e não chega aqui."
            : "Elas aparecem no Freightech e não chegam aqui."}
        </p>
      )}

      <TabelaFreightech
        id={idDaTabela}
        colunas={colunas}
        linhas={data.rows}
        chave={(linha) => linha.entityId}
        vazio={
          <span className="text-sm text-muted-foreground">
            Nenhum ativo deste tipo nesta vigência.
          </span>
        }
      />
    </div>
  );
}
