import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GitCompareArrows } from "lucide-react";
import {
  parReconciliado,
  rotulosDasVigencias,
} from "@workspace/comparison/recorte-de-rubrica";
import { Layout } from "@/components/layout/layout";
import { CabecalhoDePagina } from "@/components/layout/cabecalho-de-pagina";
import { ApiErrorNotice } from "@/components/api-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeletorDoPar } from "@/components/comparacao/seletor-do-par";
import { fetchJson, getApiUrl } from "@/lib/api";
import {
  ChangeTable,
  FilterBar,
  emptyFilters,
  toQuery,
  type Breakdown,
  type ChangeRow,
  type Filters,
} from "@/components/changes/change-table";
import { ImpactoPorPeriodicidade } from "@/components/changes/cartoes";
import { primeiraPagina, type Janela } from "@/lib/paginacao";

/**
 * Comparar Vigências — duas quaisquer, escolhidas por você.
 *
 * A mesma tabela de Alterações, com o par definido à mão em vez de "a última
 * contra a anterior".
 */

interface Snapshot {
  id: string;
  sourceLabel: string;
  effectiveDate: string;
  entityTypeSet: string;
  /*
    A unidade e a revisão entraram com o seletor padrão, e não são enfeite: uma
    importação do arquivo da Ambev produz uma vigência por unidade com o mesmo
    nome e a mesma data, e é o `scopeHash` que impede o par CAMAÇARI ×
    PERNAMBUCO — o único que o motor recusa por construção.
  */
  scopeHash: string;
  revision?: number | null;
  entityCount: number;
  factCount: number;
}

interface ChangeSet {
  id: string;
  valueChanges: number;
  entitiesAdded: number;
  entitiesRemoved: number;
  attributesAdded: number;
  attributesRemoved: number;
  unchanged: number;
  inconclusive: number;
  /**
   * O impacto desta comparação. `oficial` é o que a tela publica; `bruto` é
   * conferência técnica e nunca aparece rotulado "Impacto apurado".
   */
  impacto: {
    oficial: Record<string, number>;
    bruto: Record<string, number>;
    mudancasForaDoTotal: number;
  };
  impactNotCalculable: number;
}

export default function Comparar() {
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [set, setSet] = useState<ChangeSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [janela, setJanela] = useState<Janela>(primeiraPagina);

  // Filtrar encurta a lista; a página em que se estava pode não existir mais.
  useEffect(() => {
    setJanela((atual) => (atual.pagina === 1 ? atual : { ...atual, pagina: 1 }));
  }, [filters, set?.id]);

  const { data: snapshots = [], error: snapshotsError } = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<Snapshot[]>("/snapshots"),
  });

  /**
   * O texto de cada vigência — `junho/2026 · 1ª quinzena`, como no resto da casa.
   *
   * Aqui se escrevia `CAVALO+CARRETA · EMPURRADA_1_6_2026 · 44 ativos`: o nome
   * do arquivo e a contagem de linhas, que é o idioma do acervo e não o de quem
   * audita. `rotulosDasVigencias` desempata olhando a lista inteira, e só
   * acrescenta a unidade, a cobertura ou o arquivo nas linhas que sem isso
   * ficariam indistinguíveis.
   */
  const rotulos = useMemo(() => rotulosDasVigencias(snapshots), [snapshots]);

  /**
   * O par de partida, pela mesma função das sete auditorias de rubrica.
   *
   * Ela preserva a ponta que já está escolhida e só decide o que ninguém
   * decidiu — e o par que ela escolhe é da **mesma série**, que era a razão de
   * este arquivo ter a sua própria versão disto: pegar as duas últimas linhas
   * da lista emparelhava Cavalo com Carreta, porque as duas séries compartilham
   * as datas. Uma cópia a menos que pode divergir da regra do motor.
   */
  useEffect(() => {
    if (snapshots.length === 0) return;
    const par = parReconciliado(snapshots, { base: aId, comparada: bId });
    if (par.base !== aId) setAId(par.base);
    if (par.comparada !== bId) setBId(par.comparada);
  }, [snapshots, aId, bId]);

  const compare = useMutation({
    mutationFn: async () => {
      const response = await fetch(getApiUrl("/change-sets"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotAId: aId, snapshotBId: bId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao comparar");
      return body as ChangeSet;
    },
    onSuccess: (result) => {
      setError(null);
      setSet(result);
    },
    onError: (err: Error) => {
      setSet(null);
      setError(err.message);
    },
  });

  const { data: changes } = useQuery({
    queryKey: ["change-set", set?.id, filters, janela],
    queryFn: () =>
      fetchJson<{
        breakdown: Breakdown;
        total: number;
        rows: ChangeRow[];
      }>(`/change-sets/${set!.id}/changes?${toQuery(filters, {}, janela)}`),
    enabled: set !== null,
  });

  /* O título da tabela escreve a vigência como o seletor a escreve — um rótulo
     só para a tela inteira, e não `CAVALO+CARRETA · EMPURRADA_1_6_2026` em cima
     de `junho/2026 · 1ª quinzena`. */
  const label = (id: string) => rotulos.get(id) ?? "—";

  return (
    <Layout>
      <CabecalhoDePagina
        icone={GitCompareArrows}
        titulo="Comparar Vigências"
        descricao={
          <>
            Duas vigências quaisquer, comparadas pela identidade do ativo e do
            atributo — nunca pela posição da linha na planilha.
          </>
        }
        rodape={
          <div className="flex flex-col gap-3">
            {/*
              O mesmo seletor das sete auditorias — "De" e "Para", o botão de
              inverter e a lista que já não oferece par que o motor recusaria.

              Esta tela tinha dois campos próprios, com "Vigência anterior" e
              "Vigência nova" por rótulo e o aviso de séries misturadas depois da
              escolha. Os dois nomes afirmam um estado que o par não tem — a
              direção é escolhida, e inverter a deixaria mentindo —, e o aviso
              chegava tarde: o campo dependente aqui já não lista a vigência
              incompatível.
            */}
            <SeletorDoPar
              vigencias={snapshots}
              rotulos={rotulos}
              base={aId}
              comparada={bId}
              onBase={setAId}
              onComparada={setBId}
              onInverter={() => {
                setAId(bId);
                setBId(aId);
              }}
              carregando={compare.isPending}
              idPrefixo="comparar"
            />

            {/*
              O botão continua, e a comparação continua sendo um gesto.

              Nas telas de rubrica o par consultado é o par escolhido; aqui o
              clique **grava** um `change_set` novo quando ele não existe, e
              disparar isso a cada mexida no seletor faria a tela calcular
              comparações que ninguém pediu.
            */}
            <div>
              <Button
                onClick={() => compare.mutate()}
                disabled={!aId || !bId || aId === bId || compare.isPending}
              >
                {compare.isPending ? "Comparando…" : "Comparar"}
              </Button>
            </div>
          </div>
        }
      />

      <div className="p-8 space-y-6">
        {snapshotsError && (
          <ApiErrorNotice
            error={snapshotsError}
            what="As vigências disponíveis não puderam ser carregadas."
          />
        )}

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        )}

        {set && (
          <>
            <div
              /*
                Pelo espaço que sobra, não pelo tamanho da janela: seis colunas
                fixas ignoram os 304px da lateral e entregam ladrilhos de 139px
                numa tela de 1280 — estreitos demais para um valor em reais, que
                então era escrito por cima do ladrilho vizinho. Com `auto-fit`, o
                que cede é o número de colunas.
              */
              className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]"
            >
              <Tile label="Valores alterados" value={set.valueChanges} />
              <Tile label="Sem alteração" value={set.unchanged} />
              <Tile label="Ativos entraram" value={`+${set.entitiesAdded}`} />
              <Tile label="Ativos saíram" value={`−${set.entitiesRemoved}`} />
              <Tile
                label="Colunas +/−"
                value={`+${set.attributesAdded} / −${set.attributesRemoved}`}
              />
              {/*
                O mesmo componente dos cartões das abas, e não uma cópia com as
                mesmas regras: uma linha por periodicidade — R$/mês e R$/ano não
                somam —, e o corpo do número escolhido pela largura que este
                ladrilho tem. Emendadas numa string só, as duas periodicidades
                saíam do ladrilho pela direita.
              */}
              <Tile
                label="Impacto apurado"
                value={
                  <ImpactoPorPeriodicidade
                    buckets={set.impacto.oficial}
                    escala="ladrilho"
                    colorido={false}
                  />
                }
                hint={`${set.impactNotCalculable} fora destes valores`}
              />
            </div>

            <FilterBar
              comClasse
              filters={filters}
              onChange={setFilters}
              breakdown={changes?.breakdown}
            />

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {label(aId)} → {label(bId)}
                  {changes && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      · {changes.total} alterações
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {changes && (
                  <ChangeTable
                    rows={changes.rows}
                    total={changes.total}
                    janela={janela}
                    onJanela={setJanela}
                  />
                )}
              </CardContent>
            </Card>
          </>
        )}

        {!set && !error && (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              Escolha duas vigências e clique em Comparar.
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  /**
   * Um número, ou o que não cabe em um: o impacto é uma linha por
   * periodicidade, e um ladrilho que só aceitasse texto obrigaria a emendar as
   * duas numa string — que é como elas saíam pela direita do cartão.
   */
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    // `@container`: a largura do ladrilho é a régua que o valor consulta para
    // escolher o próprio corpo.
    <div className="rounded-lg border bg-card px-4 py-3 @container">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums mt-1">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
