import { useMemo, useState } from "react";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, FileCheck2, LayoutGrid } from "lucide-react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import type { ChangeRow } from "@/components/changes/change-table";
import { fetchJson } from "@/lib/api";
import { useComparacoes, type Justificativa } from "@/lib/justificativas";
import {
  janelaDeVigencias,
  lerJanela,
  montarGradeDaPlaca,
  OPCOES_DE_JANELA,
  pendentesDaVigencia,
  resumoDaPlaca,
  type CelulaDaPlaca,
  type VigenciaDaGrade,
} from "@/lib/historico-da-placa";
import { cn } from "@/lib/utils";

/**
 * O detalhe de uma placa — a grade atributo × vigência, e o lugar onde se
 * justifica.
 *
 * A tela nasceu como a lista das alterações de **uma** vigência, uma embaixo
 * da outra, cada linha com o seu botão "Justificar". Respondia "o que mudou
 * agora" e nada mais: para saber se `manutencaoReaisKm` vinha subindo há três
 * competências, ou se o cavalo já tinha ficado ATIVO e PARADO duas vezes no
 * semestre, era preciso voltar para a fila, trocar a vigência no seletor,
 * entrar na placa de novo — e guardar de cabeça o que a tela anterior dizia.
 *
 * Agora cada linha é um atributo e cada coluna é uma vigência, com o mesmo
 * desenho do Radar de Alterações da Gestão à Vista: a janela é escolhida em
 * número de vigências (`?colunas=`, 3/6/12), o histórico se lê da esquerda
 * para a direita, e a célula é a alteração daquele atributo naquela vigência.
 * Clicar na célula é justificar aquela alteração — não há uma segunda tela
 * entre ver e explicar.
 *
 * A cor da célula é a régua, e é o que permite varrer a grade sem ler
 * atributo por atributo: âmbar é pendente, verde é justificada, e a célula
 * com duas alterações das quais só uma foi explicada continua âmbar com a
 * borda verde — meio explicada não é resolvida. Célula vazia é vazia mesmo, e
 * uma coluna cuja leitura ainda não voltou aparece como leitura pendente, e
 * nunca como "nada mudou aqui" (a regra inteira, com testes, vive em
 * `lib/historico-da-placa.ts`).
 *
 * `?changeSetId=` continua vindo da fila e continua mandando: ele é o **fim**
 * da janela, não a única coluna. Quem entrou na placa a partir de junho está
 * justificando junho, e a grade termina em junho mostrando o que veio antes.
 */

interface ChangesResponse {
  total: number;
  rows: ChangeRow[];
}

/** O que o diálogo precisa saber: a comparação em que se grava, e o que se grava. */
interface AlvoDaJustificativa {
  changeSetId: string;
  rotulo: string;
  changes: ChangeRow[];
  /** A justificativa que já existe, quando se está reescrevendo uma célula verde. */
  atual: Justificativa | null;
}

/**
 * `2026-08-01` → `01/08/26`, como a planilha do cliente escreve.
 *
 * Vivia em `lib/justificativas.ts` até o seletor de vigências passar a nomear
 * as competências por extenso (`rotuloCurtoDaVigencia`) e levá-la junto. Aqui o
 * rótulo é cabeçalho de coluna de uma grade de até doze vigências, onde "agosto
 * de 2026" não cabe — e a data curta é a que a planilha de origem usa, que é a
 * régua desta tela.
 */
function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return ano && mes && dia ? `${dia}/${mes}/${ano.slice(2)}` : iso;
}

export default function JustificativasPlaca() {
  const { placa } = useParams<{ placa: string }>();
  const search = useSearch();
  const [, navegar] = useLocation();
  const queryClient = useQueryClient();

  const params = new URLSearchParams(search);
  const changeSetId = params.get("changeSetId") || undefined;
  const colunas = lerJanela(params.get("colunas"));

  /*
    O voltar devolve a fila como ela estava — a vigência **e** a aba de tipo.
    Sem o `tipo`, quem abriu uma placa a partir da aba Trecho voltava para
    "Todas" e tinha de reencontrar onde estava, que é a mesma perda que o
    `changeSetId` no endereço já existia para evitar.
  */
  const voltarParams = new URLSearchParams();
  if (changeSetId) voltarParams.set("changeSetId", changeSetId);
  const tipo = params.get("tipo");
  if (tipo) voltarParams.set("tipo", tipo);
  const voltar = voltarParams.toString()
    ? `/justificativas?${voltarParams.toString()}`
    : "/justificativas";

  /** A janela vive na URL, como a vigência e pelo mesmo motivo: sobrevive ao ir e voltar. */
  const escolherJanela = (valor: string) => {
    const proximo = new URLSearchParams(search);
    proximo.set("colunas", valor);
    navegar(`/justificativas/placa/${encodeURIComponent(placa)}?${proximo}`, { replace: true });
  };

  const comparacoes = useComparacoes();
  const janela = useMemo(
    () => janelaDeVigencias(comparacoes.data ?? [], colunas, changeSetId),
    [comparacoes.data, colunas, changeSetId],
  );

  /*
    Uma leitura por vigência, e não uma leitura só: `/change-sets/:id/changes`
    responde por uma comparação de cada vez. As duas listas de consultas ficam
    na mesma ordem de `janela` — `useQueries` monta um observador por item, e
    uma ordem que dança faria cada refetch reembaralhar o cache. As chaves são
    as mesmas que a fila (`justificativas.tsx`) já usa, de propósito: as duas
    telas perguntando o mesmo compartilham cache em vez de disparar duas
    requisições idênticas, e o `invalidateQueries` de uma acerta a outra.
  */
  const consultasDeAlteracoes = useQueries({
    queries: janela.map((vigencia) => ({
      queryKey: ["change-set-changes", vigencia.id, "placa", placa],
      queryFn: () =>
        fetchJson<ChangesResponse>(
          `/change-sets/${vigencia.id}/changes?entityLabel=${encodeURIComponent(placa)}`,
        ),
      staleTime: 60_000,
    })),
  });

  const consultasDeJustificativas = useQueries({
    queries: janela.map((vigencia) => ({
      queryKey: ["justificativas", vigencia.id],
      queryFn: () =>
        fetchJson<{ justificativas: Justificativa[] }>(
          `/justificativas?changeSetId=${vigencia.id}`,
        ),
      staleTime: 60_000,
    })),
  });

  const carimboDasAlteracoes = consultasDeAlteracoes.map((c) => c.dataUpdatedAt).join("|");
  const carimboDasJustificativas = consultasDeJustificativas.map((c) => c.dataUpdatedAt).join("|");
  const carregandoAlteracoes = consultasDeAlteracoes.map((c) => c.isPending).join("|");

  /** A justificativa de cada alteração da janela inteira, por `changeId`. */
  const justificadaPor = useMemo(() => {
    const mapa = new Map<number, Justificativa>();
    for (const consulta of consultasDeJustificativas) {
      for (const j of consulta.data?.justificativas ?? []) mapa.set(j.changeId, j);
    }
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carimboDasJustificativas]);

  const vigencias: VigenciaDaGrade<ChangeRow>[] = useMemo(
    () =>
      janela.map((vigencia, indice) => {
        const alteracoes = consultasDeAlteracoes[indice]?.data?.rows ?? [];
        const justificativas = consultasDeJustificativas[indice]?.data?.justificativas ?? [];
        return {
          changeSetId: vigencia.id,
          rotulo: dataCurta(vigencia.snapshotBDate),
          alteracoes,
          justificadas: new Set(justificativas.map((j) => j.changeId)),
          carregando: consultasDeAlteracoes[indice]?.isPending ?? true,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [janela, carimboDasAlteracoes, carimboDasJustificativas, carregandoAlteracoes],
  );

  const linhas = useMemo(() => montarGradeDaPlaca(vigencias), [vigencias]);
  const resumo = resumoDaPlaca(linhas);

  const entityType =
    vigencias.flatMap((v) => v.alteracoes).find((c) => c.entityType)?.entityType ?? null;

  const [dialogAlvo, setDialogAlvo] = useState<AlvoDaJustificativa | null>(null);

  const abrirCelula = (celula: CelulaDaPlaca<ChangeRow>) => {
    if (celula.alteracoes.length === 0) return;
    /*
      Célula meio explicada abre com as **pendentes**: o texto novo é para o
      que ainda não tem texto, e regravar por cima do que já foi explicado
      seria o clique fazendo mais do que quem clicou pediu. Célula inteira
      verde abre com tudo — ali o clique é deliberadamente "reescrever".
    */
    const changes = celula.pendentes.length > 0 ? celula.pendentes : celula.alteracoes;
    setDialogAlvo({
      changeSetId: celula.changeSetId,
      rotulo: celula.rotulo,
      changes,
      atual: celula.pendentes.length === 0 ? (justificadaPor.get(changes[0].id) ?? null) : null,
    });
  };

  const mutation = useMutation({
    mutationFn: (input: { changeSetId: string; changeIds: number[]; texto: string }) =>
      fetchJson<{ justificativas: Justificativa[] }>("/justificativas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId: input.changeSetId,
          changeIds: input.changeIds,
          texto: input.texto,
        }),
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["justificativas", input.changeSetId] });
      setDialogAlvo(null);
    },
  });

  const carregando = comparacoes.isPending || consultasDeAlteracoes.some((c) => c.isPending);
  const erro =
    comparacoes.error ??
    consultasDeAlteracoes.find((c) => c.error)?.error ??
    null;
  const semLeituraNenhuma =
    !comparacoes.isPending && consultasDeAlteracoes.every((c) => c.data === undefined);

  if (!changeSetId && !comparacoes.isPending && janela.length === 0) {
    return (
      <Layout>
        <div className="px-8 pt-7 max-w-[1400px]">
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">Nenhuma vigência calculada.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Sem comparação gravada não há alterações para justificar nesta placa.
            </p>
            <Link href="/justificativas">
              <Button variant="outline" size="sm" className="mt-4">
                <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
                Voltar
              </Button>
            </Link>
          </section>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <header className="px-8 pt-7 pb-5 max-w-[1400px]">
        <Link
          href={voltar}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Justificativas
        </Link>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <h1 className="text-4xl font-bold tracking-tight font-mono">{placa}</h1>
          {entityType && <Badge variant="secondary">{entityType}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          O histórico desta placa — uma linha por atributo, uma coluna por vigência. Clique na
          célula para justificar a alteração que aconteceu ali.
        </p>
      </header>

      <div className="px-8 pb-10 space-y-4 max-w-[1400px]">
        <div className="flex flex-wrap items-center gap-3">
          <Select value={String(colunas)} onValueChange={escolherJanela}>
            <SelectTrigger className="w-[16rem]" aria-label="Janela de vigências">
              <LayoutGrid className="w-4 h-4 text-muted-foreground mr-1.5 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OPCOES_DE_JANELA.map((opcao) => (
                <SelectItem key={opcao} value={String(opcao)}>
                  Últimas {opcao} vigências
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {janela.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {dataCurta(janela[0].snapshotBDate)} — {dataCurta(janela[janela.length - 1].snapshotBDate)}
              {janela.length < colunas && " (todo o histórico gravado)"}
            </span>
          )}
        </div>

        {carregando && linhas.length === 0 && (
          <div className="space-y-3" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        )}

        {erro != null && semLeituraNenhuma && (
          <ApiErrorNotice
            error={erro}
            what="As alterações desta placa não puderam ser carregadas."
            onTentarDeNovo={() => {
              queryClient.invalidateQueries({ queryKey: ["change-set-changes"] });
              queryClient.invalidateQueries({ queryKey: ["justificativas"] });
            }}
            tentando={consultasDeAlteracoes.some((c) => c.isFetching)}
          />
        )}

        {!carregando && !semLeituraNenhuma && linhas.length === 0 && (
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">Esta placa não mudou nesta janela.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Aumente a janela para procurar alterações em vigências mais antigas.
            </p>
          </section>
        )}

        {linhas.length > 0 && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <CartaoDoResumo rotulo="Alterações na janela" valor={resumo.alteracoes} />
              <CartaoDoResumo rotulo="Pendentes" valor={resumo.pendentes} tom="pendente" />
              <CartaoDoResumo rotulo="Justificadas" valor={resumo.justificadas} tom="justificada" />
              <CartaoDoResumo
                rotulo="Vigências com alteração"
                valor={`${resumo.vigenciasComAlteracao} de ${janela.length}`}
              />
            </div>

            <section className="bg-card border rounded-xl shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground border-b">
                      <th className="py-3 pl-5 pr-4 font-semibold text-left sticky left-0 bg-card min-w-[13rem]">
                        Atributo
                      </th>
                      {vigencias.map((vigencia) => (
                        <th
                          key={vigencia.changeSetId}
                          className={cn(
                            "py-3 px-2 font-semibold text-center min-w-[9rem]",
                            vigencia.changeSetId === changeSetId && "text-foreground",
                          )}
                        >
                          {vigencia.rotulo}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((linha) => (
                      <tr key={linha.attributeCode} className="border-t">
                        <td className="py-2 pl-5 pr-4 sticky left-0 bg-card">
                          <span
                            className="block font-medium truncate max-w-[16rem]"
                            title={linha.attributeName}
                          >
                            {linha.attributeName}
                          </span>
                          <span className="block text-[0.6875rem] text-muted-foreground">
                            {linha.totalDeAlteracoes}{" "}
                            {linha.totalDeAlteracoes === 1 ? "alteração" : "alterações"}
                            {linha.pendentes > 0 && ` · ${linha.pendentes} pendente${linha.pendentes === 1 ? "" : "s"}`}
                          </span>
                        </td>
                        {linha.celulas.map((celula) => (
                          <td key={celula.changeSetId} className="py-1.5 px-1.5 align-middle">
                            <CelulaNaTela
                              celula={celula}
                              atributo={linha.attributeName}
                              justificadaPor={justificadaPor}
                              onAbrir={() => abrirCelula(celula)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-muted/30">
                      <td className="py-2 pl-5 pr-4 sticky left-0 bg-muted/30 text-xs text-muted-foreground">
                        Justificar em lote
                      </td>
                      {vigencias.map((vigencia) => {
                        const pendentes = pendentesDaVigencia(linhas, vigencia.changeSetId);
                        return (
                          <td key={vigencia.changeSetId} className="py-2 px-1.5 text-center">
                            {pendentes.length === 0 ? (
                              <span className="text-[0.6875rem] text-muted-foreground">—</span>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  setDialogAlvo({
                                    changeSetId: vigencia.changeSetId,
                                    rotulo: vigencia.rotulo,
                                    changes: pendentes,
                                    atual: null,
                                  })
                                }
                              >
                                <FileCheck2 className="w-3.5 h-3.5 mr-1" />
                                {pendentes.length} pendente{pendentes.length === 1 ? "" : "s"}
                              </Button>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>

              <LegendaDaGrade />
            </section>
          </>
        )}
      </div>

      <JustificarDialog
        alvo={dialogAlvo?.changes ?? null}
        contexto={dialogAlvo ? `vigência ${dialogAlvo.rotulo}` : undefined}
        justificativaAtual={dialogAlvo?.atual ?? null}
        pendente={mutation.isPending}
        erro={mutation.error}
        onClose={() => {
          setDialogAlvo(null);
          mutation.reset();
        }}
        onConfirmar={(texto) => {
          if (!dialogAlvo) return;
          mutation.mutate({
            changeSetId: dialogAlvo.changeSetId,
            changeIds: dialogAlvo.changes.map((c) => c.id),
            texto,
          });
        }}
      />
    </Layout>
  );
}

/**
 * Uma célula: o que mudou naquele atributo naquela vigência, e em que estado
 * está.
 *
 * A cor vem antes do texto — quem varre a grade procura âmbar, e só então lê o
 * `antes → agora`. Célula sem alteração continua clicável? Não: não há o que
 * justificar num mês em que o atributo não mexeu, e um botão que não faz nada
 * é pior que nenhum botão.
 */
function CelulaNaTela({
  celula,
  atributo,
  justificadaPor,
  onAbrir,
}: {
  celula: CelulaDaPlaca<ChangeRow>;
  atributo: string;
  justificadaPor: Map<number, Justificativa>;
  onAbrir: () => void;
}) {
  if (celula.estado === "sem-leitura") {
    return <Skeleton className="h-11 w-full rounded-lg" />;
  }

  if (celula.estado === "sem-alteracao") {
    return (
      <div className="h-11 flex items-center justify-center text-muted-foreground/30" aria-hidden>
        ·
      </div>
    );
  }

  const primeira = celula.alteracoes[0];
  const justificativa = justificadaPor.get(primeira.id) ?? null;
  const explicada = celula.estado === "justificada";

  return (
    <button
      type="button"
      onClick={onAbrir}
      title={
        justificativa
          ? `${justificativa.texto} — ${justificativa.criadoPor}`
          : `Justificar ${atributo} em ${celula.rotulo}`
      }
      aria-label={`${atributo} em ${celula.rotulo}: ${
        explicada ? "justificada" : "pendente"
      }. Clique para justificar.`}
      className={cn(
        "w-full h-11 rounded-lg border px-2 flex flex-col items-center justify-center transition-colors cursor-pointer",
        explicada
          ? "bg-emerald-50 border-emerald-200 hover:bg-emerald-100 text-emerald-900"
          : celula.estado === "parcial"
            ? "bg-amber-50 border-emerald-300 hover:bg-amber-100 text-amber-900"
            : "bg-amber-50 border-amber-200 hover:bg-amber-100 text-amber-900",
      )}
    >
      <span className="font-mono text-[0.6875rem] leading-tight truncate max-w-full">
        {primeira.valueBefore ?? "—"} → {primeira.valueAfter ?? "—"}
      </span>
      <span className="text-[0.625rem] leading-tight flex items-center gap-1">
        {explicada && <CheckCircle2 className="w-3 h-3" />}
        {celula.alteracoes.length > 1
          ? `${celula.alteracoes.length - celula.pendentes.length}/${celula.alteracoes.length} justificadas`
          : explicada
            ? "justificada"
            : "pendente"}
      </span>
    </button>
  );
}

function CartaoDoResumo({
  rotulo,
  valor,
  tom,
}: {
  rotulo: string;
  valor: number | string;
  tom?: "pendente" | "justificada";
}) {
  return (
    <div className="bg-card border rounded-xl shadow-sm px-4 py-3">
      <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">{rotulo}</p>
      <p
        className={cn(
          "text-2xl font-bold tabular-nums mt-0.5",
          tom === "pendente" && "text-amber-600",
          tom === "justificada" && "text-emerald-600",
        )}
      >
        {typeof valor === "number" ? valor.toLocaleString("pt-BR") : valor}
      </p>
    </div>
  );
}

function LegendaDaGrade() {
  return (
    <div className="flex flex-wrap items-center gap-4 px-5 py-3 border-t bg-muted/20 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded border bg-amber-50 border-amber-200" />
        pendente
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded border bg-emerald-50 border-emerald-200" />
        justificada
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded border bg-amber-50 border-emerald-300" />
        parte justificada
      </span>
      <span className="flex items-center gap-1.5">
        <span className="w-3.5 h-3.5 rounded border border-dashed" />
        não mudou nesta vigência
      </span>
    </div>
  );
}
