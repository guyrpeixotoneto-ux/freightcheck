import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, CheckCircle2, ChevronRight, ClipboardList, FileCheck2, WifiOff } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiErrorNotice } from "@/components/api-error";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import { useContextosDaCasca } from "@/lib/contextos";
import {
  abaDoTipo,
  abasDaVigencia,
  placasDaAba,
  useComparacoes,
  useContagensPorTipo,
  useJustificadaPor,
  vigenciasDaAba,
  type Justificativa,
} from "@/lib/justificativas";
import type { ChangeRow } from "@/components/changes/change-table";
import {
  equipamentosDoAmbiente,
  palavrasDoTipo,
  rotuloDoTipo,
  rotuloEmFrase,
} from "@/lib/frota";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { cn } from "@/lib/utils";

/**
 * Plano de Ação — Justificativas.
 *
 * A pergunta é uma só: o que mudou de uma vigência para a outra, e por quê —
 * mas quem justifica é a alteração, não a placa. A tela agrupa por placa só
 * para navegação — é assim que o gestor reconhece o ativo —, mas cada
 * alteração dentro do grupo tem sua própria seleção, seu próprio status e sua
 * própria justificativa. Marcar o cabeçalho da placa seleciona todas as
 * alterações dela de uma vez; marcar uma alteração isolada permite justificar
 * só aquela. Clicar no card (fora dos controles) abre a placa em
 * `/justificativas/placa/:placa` — a grade atributo × vigência, onde a mesma
 * alteração aparece ao lado do histórico dela nas vigências anteriores.
 *
 * As abas recortam por tipo de ativo — Cavalo, Carreta, Trecho — porque
 * justificar é trabalho por tipo: quem explica o reajuste de um cavalo não é
 * quem explica a quilometragem de um trecho, e sem o recorte a fila chega
 * misturada. A escolha vive na URL (`?tipo=`), como a da vigência e pelo mesmo
 * motivo. A regra das abas é `abasDaVigencia` / `placasDaAba`, em
 * `lib/justificativas.ts`.
 *
 * A vigência é escolhida **dentro da aba**, e não acima dela. Uma comparação
 * pertence a uma série — `(escopo, entity_type_set)` —, então o arquivo de
 * trecho e o de equipamento da mesma unidade na mesma data são duas
 * comparações, que um seletor único listava como duas linhas idênticas: a
 * lista crescia misturando cavalo, carreta e trecho, e escolher ali era
 * chutar. Dentro da aba, cada lista só oferece as vigências que têm o que a
 * aba mostra, e a contagem à direita é a do tipo. Quem sabe disso é
 * `/change-sets/tipos`; a regra é `vigenciasDaAba` / `abasDaVigencia`, em
 * `lib/justificativas.ts`.
 *
 * O seletor continua lendo `/change-sets` (comparações já calculadas — nunca
 * `/changes/latest`, que calcularia sob demanda só por a tela estar aberta) e
 * a escolha continua vivendo na URL, para sobreviver a ir para o detalhe de
 * uma placa e voltar.
 */

/**
 * O valor da aba "Todas" no `Tabs`, que não aceita string vazia — o mesmo
 * recurso da Curadoria, e pelo mesmo motivo: `null` é o recorte que não
 * recorta, e ele precisa de um nome para viajar pelo componente.
 */
const TODAS = "__todas__";

interface ChangesResponse {
  total: number;
  rows: ChangeRow[];
}

interface PlacaGroup {
  entityLabel: string;
  entityType: string | null;
  changes: ChangeRow[];
}

function agruparPorPlaca(rows: ChangeRow[]): PlacaGroup[] {
  const grupos = new Map<string, PlacaGroup>();
  for (const row of rows) {
    if (!row.entityLabel) continue; // LAYOUT_CHANGE não tem placa — não é assunto desta tela.
    const atual = grupos.get(row.entityLabel);
    if (atual) {
      atual.changes.push(row);
    } else {
      grupos.set(row.entityLabel, {
        entityLabel: row.entityLabel,
        entityType: row.entityType,
        changes: [row],
      });
    }
  }
  return [...grupos.values()].sort((a, b) => a.entityLabel.localeCompare(b.entityLabel));
}

export default function Justificativas() {
  const ambiente = useAmbiente();
  const queryClient = useQueryClient();
  const [, navegar] = useLocation();
  const search = useSearch();

  const comparacoes = useComparacoes();
  const opcoes = comparacoes.data ?? [];
  /*
    Os nomes das unidades vêm da mesma `/contexts` que a casca já leu — é o que
    separa cinco comparações da mesma data umas das outras. Ver
    `opcoesDeVigencia`.
  */
  const contextos = useContextosDaCasca();
  /* Quantas placas e alterações de cada tipo cada vigência tem — o que faz a
     lista da aba Trecho oferecer só vigências com trecho. */
  const { contagens } = useContagensPorTipo();

  const params = new URLSearchParams(search);
  const changeSetIdDaUrl = params.get("changeSetId") || undefined;
  /* `null` é a aba "Todas" — um endereço truncado abre a fila inteira. */
  const tipo = params.get("tipo") || null;

  /*
    As abas fixas são as da operação auditada — cavalo e carreta na Empurrada,
    caminhão e carroceria na Rota e no AS, empilhadeira no Apoio. Ver
    `EQUIPAMENTOS_DO_AMBIENTE`, em `lib/frota.ts`.
  */
  const abas = useMemo(
    () => abasDaVigencia(opcoes, contagens, changeSetIdDaUrl, equipamentosDoAmbiente(ambiente)),
    [opcoes, contagens, changeSetIdDaUrl, ambiente],
  );
  /*
    A vigência aberta é a **da aba**: a do endereço quando ela tem deste tipo,
    e a mais recente que tem quando não. É o que impede a aba Trecho de abrir
    sobre uma comparação de equipamento — que existe, tem a mesma data e o
    mesmo nome de unidade, e não tem trecho nenhum.
  */
  const abaAtual = abaDoTipo(abas, tipo);
  const changeSetId = abaAtual?.changeSetId ?? changeSetIdDaUrl ?? opcoes[0]?.id;

  const opcoesDoSeletor = useMemo(
    () => vigenciasDaAba(opcoes, contextos.contextos, contagens, tipo),
    [opcoes, contextos.contextos, contagens, tipo],
  );

  const endereco = (proximo: { changeSetId?: string; tipo?: string | null }) => {
    const q = new URLSearchParams();
    const id = proximo.changeSetId ?? changeSetId;
    const t = proximo.tipo === undefined ? tipo : proximo.tipo;
    if (id) q.set("changeSetId", id);
    if (t) q.set("tipo", t);
    const query = q.toString();
    return query ? `/justificativas?${query}` : "/justificativas";
  };

  const escolherVigencia = (id: string) => {
    navegar(endereco({ changeSetId: id }));
  };

  /*
    Resiliente, como as demais consultas que abrem uma tela inteira (ver
    `pages/unidades.tsx`). `indisponivel` diz quando não há nada para mostrar,
    `avisarSobreDadoGuardado` diz quando há uma lista válida e só a
    atualização falhou, e as duas trazem `tentarDeNovo` — a única forma de
    recuperar sem recarregar a página.
  */
  const consulta = useConsultaResiliente<ChangesResponse>({
    queryKey: ["change-set-changes", changeSetId],
    endpoint: "/change-sets/:id/changes",
    buscar: () => fetchJson<ChangesResponse>(`/change-sets/${changeSetId}/changes`),
    enabled: !!changeSetId,
  });

  const data = consulta.dados;
  const isLoading = comparacoes.isLoading || (!!changeSetId && consulta.carregando);
  const grupos = useMemo(() => agruparPorPlaca(data?.rows ?? []), [data]);
  const visiveis = useMemo(() => placasDaAba(grupos, tipo), [grupos, tipo]);

  const { justificadaPor } = useJustificadaPor(changeSetId);

  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogAlvo, setDialogAlvo] = useState<ChangeRow[] | null>(null);

  /*
    Trocar de aba limpa a seleção de propósito. A barra "Justificar
    selecionadas" fala do que está em tela; guardar seleção de uma aba que o
    gestor não está mais vendo faria o diálogo abrir com alterações de trecho
    dentro de uma justificativa escrita sobre cavalos.
  */
  const escolherTipo = (proximo: string | null) => {
    setSelecionadas(new Set());
    /*
      A vigência viaja junto: a aba de destino já sabe qual comparação abre —
      a mesma, quando ela também tem deste tipo, e a mais recente que tem,
      quando não. Sem isso o endereço levaria a vigência da aba de origem e a
      tela abriria vazia, com um seletor que nem oferece a linha que ela está
      mostrando.
    */
    navegar(endereco({ tipo: proximo, changeSetId: abaDoTipo(abas, proximo)?.changeSetId }));
  };

  const alternarSelecaoGrupo = (grupo: PlacaGroup) => {
    const ids = grupo.changes.map((c) => c.id);
    const todasSelecionadas = ids.every((id) => selecionadas.has(id));
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      for (const id of ids) {
        if (todasSelecionadas) proximo.delete(id);
        else proximo.add(id);
      }
      return proximo;
    });
  };

  const mutation = useMutation({
    mutationFn: (input: { changeIds: number[]; texto: string }) =>
      fetchJson<{ justificativas: Justificativa[] }>("/justificativas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId,
          changeIds: input.changeIds,
          texto: input.texto,
        }),
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["justificativas", changeSetId] });
      setSelecionadas((atual) => {
        const proximo = new Set(atual);
        for (const changeId of input.changeIds) proximo.delete(changeId);
        return proximo;
      });
      setDialogAlvo(null);
    },
  });

  return (
    <Layout>
      <header className="px-8 pt-7 pb-5 max-w-[1400px]">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Plano de Ação
        </p>
        <h1 className="text-4xl font-bold tracking-tight mt-1">Justificativas</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          O que mudou por tipo de ativo, agrupado por placa: escolha a aba e,
          dentro dela, a vigência. Marque uma ou várias alterações e justifique
          de uma vez — a justificativa fica registrada com quem escreveu e
          quando.
        </p>

        {/* As abas vêm primeiro, e a vigência dentro delas — na ordem em que a
            pergunta se faz para quem justifica: primeiro de que tipo de ativo
            se fala, e só então de que vigência dele. Invertida, a lista de
            vigências era a mesma para as três abas e trazia as comparações de
            todas as séries juntas: cavalo, carreta e trecho da mesma unidade e
            da mesma data escreviam linhas idênticas, e nenhuma dizia qual
            tinha o que a aba mostra.

            As três abas ficam mesmo quando nenhuma vigência tem aquele tipo —
            é a aba com zero que diz que nenhum trecho mudou, em vez de deixar
            a dúvida de se a tela sabe mostrá-lo. */}
        <Tabs
          value={tipo ?? TODAS}
          onValueChange={(valor) => escolherTipo(valor === TODAS ? null : valor)}
          className="mt-4"
        >
          <TabsList>
            {abas.map((aba) => (
              <TabsTrigger key={aba.tipo ?? TODAS} value={aba.tipo ?? TODAS}>
                {aba.rotulo}
                {aba.total !== null && (
                  <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                    {aba.total}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {opcoesDoSeletor.length > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <span className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
              <CalendarRange className="w-3.5 h-3.5" />
              Vigência
            </span>
            <Select
              value={changeSetId ?? ""}
              onValueChange={escolherVigencia}
              disabled={opcoesDoSeletor.length === 1}
            >
              <SelectTrigger className="h-8 w-80 text-sm">
                <SelectValue placeholder="Selecionar vigência…" />
              </SelectTrigger>
              <SelectContent>
                {opcoesDoSeletor.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    <span className="flex w-full items-center justify-between gap-3">
                      <span>
                        {o.competencia}
                        {o.unidade && (
                          <span className="text-muted-foreground"> · {o.unidade}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {o.alteracoes.toLocaleString("pt-BR")}{" "}
                        {o.alteracoes === 1 ? "alteração" : "alterações"}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      <div className="px-8 pb-10 space-y-4 max-w-[1400px]">
        {isLoading && (
          <div className="space-y-3" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!comparacoes.isLoading && opcoes.length === 0 && (
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">Nenhuma comparação calculada ainda.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Abra a aba Alterações para calcular a comparação entre as vigências
              importadas — depois ela aparece aqui.
            </p>
          </section>
        )}

        {consulta.indisponivel && (
          <ApiErrorNotice
            error={consulta.erro}
            what="As placas alteradas não puderam ser carregadas."
            onTentarDeNovo={consulta.tentarDeNovo}
            tentando={consulta.atualizando}
          />
        )}

        {consulta.avisarSobreDadoGuardado && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span>
              A atualização não completou. O que está em tela é de{" "}
              {new Date(consulta.respondidoEm ?? 0).toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              })}
              , e continua válido.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-7"
              disabled={consulta.atualizando}
              onClick={consulta.tentarDeNovo}
            >
              {consulta.atualizando ? "Tentando…" : "Tentar de novo"}
            </Button>
          </div>
        )}

        {data && grupos.length === 0 && (
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">Nenhuma placa mudou nesta vigência.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Sem alteração por ativo, não há o que justificar.
            </p>
          </section>
        )}

        {/* A vigência mexeu em alguma coisa, mas não neste tipo. A frase diz
            de qual — "nenhum trecho" —, porque a mesma tela vazia sem o nome
            do tipo se lê como se a vigência inteira não tivesse mudado nada,
            que é o oposto do que as outras abas mostram. */}
        {/* A aba não tem vigência nenhuma: nenhuma comparação do acervo mexeu
            neste tipo. É diferente de "não mudou nesta vigência" — não há
            vigência para oferecer, e o seletor ao lado está vazio de fato. */}
        {tipo && opcoesDoSeletor.length === 0 && !!contagens && (
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">
              Nenhum{palavrasDoTipo(tipo).artigo === "a" ? "a" : ""}{" "}
              {rotuloEmFrase(tipo)} mudou em nenhuma vigência.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Nenhuma comparação calculada até aqui alterou este tipo de ativo —
              troque de aba para ver as que alteraram.
            </p>
          </section>
        )}

        {grupos.length > 0 && visiveis.length === 0 && (
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">
              {tipo
                ? `Nenhum${palavrasDoTipo(tipo).artigo === "a" ? "a" : ""} ${rotuloEmFrase(tipo)}`
                : "Nenhuma placa"}{" "}
              mudou nesta vigência.
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Há alterações em outros tipos de ativo — troque de aba para vê-las.
            </p>
          </section>
        )}

        {visiveis.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {visiveis.length} {visiveis.length === 1 ? "placa alterada" : "placas alteradas"}
                {tipo ? ` · ${rotuloDoTipo(tipo)}` : ""}
              </span>
              {selecionadas.size > 0 && (
                <div className="flex items-center gap-2 sticky top-2 z-10">
                  <span className="font-semibold text-foreground">
                    {selecionadas.size}{" "}
                    {selecionadas.size === 1 ? "alteração selecionada" : "alterações selecionadas"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setSelecionadas(new Set())}>
                    limpar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setDialogAlvo(
                        visiveis.flatMap((g) => g.changes).filter((c) => selecionadas.has(c.id)),
                      )
                    }
                  >
                    <FileCheck2 className="w-3.5 h-3.5 mr-1.5" />
                    Justificar selecionadas
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {visiveis.map((grupo) => (
                <LinhaPlaca
                  key={grupo.entityLabel}
                  grupo={grupo}
                  selecionadas={selecionadas}
                  justificadaPor={justificadaPor}
                  onSelecionarGrupo={() => alternarSelecaoGrupo(grupo)}
                  onJustificarGrupo={() => setDialogAlvo(grupo.changes)}
                  onAbrirDetalhe={() =>
                    navegar(
                      `/justificativas/placa/${encodeURIComponent(grupo.entityLabel)}?changeSetId=${changeSetId}${tipo ? `&tipo=${encodeURIComponent(tipo)}` : ""}`,
                    )
                  }
                />
              ))}
            </div>
          </>
        )}
      </div>

      <JustificarDialog
        alvo={dialogAlvo}
        pendente={mutation.isPending}
        erro={mutation.error}
        onClose={() => {
          setDialogAlvo(null);
          mutation.reset();
        }}
        onConfirmar={(texto) => {
          if (!dialogAlvo) return;
          mutation.mutate({ changeIds: dialogAlvo.map((c) => c.id), texto });
        }}
      />
    </Layout>
  );
}

function LinhaPlaca({
  grupo,
  selecionadas,
  justificadaPor,
  onSelecionarGrupo,
  onJustificarGrupo,
  onAbrirDetalhe,
}: {
  grupo: PlacaGroup;
  selecionadas: Set<number>;
  justificadaPor: Map<number, Justificativa>;
  onSelecionarGrupo: () => void;
  onJustificarGrupo: () => void;
  onAbrirDetalhe: () => void;
}) {
  const multiplas = grupo.changes.length > 1;
  const todasJustificadas = grupo.changes.every((c) => justificadaPor.has(c.id));
  const algumaJustificada = grupo.changes.some((c) => justificadaPor.has(c.id));
  const grupoSelecionado = grupo.changes.every((c) => selecionadas.has(c.id));

  return (
    <section
      className={cn(
        "bg-card border rounded-xl shadow-sm overflow-hidden cursor-pointer hover:border-brand/50 transition-colors",
        grupoSelecionado && "ring-2 ring-brand",
      )}
      onClick={onAbrirDetalhe}
      role="link"
      aria-label={`Ver todas as alterações da placa ${grupo.entityLabel}`}
    >
      <div className="flex items-start gap-3 px-5 py-4">
        <Checkbox
          checked={grupoSelecionado}
          onCheckedChange={onSelecionarGrupo}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Selecionar todas as alterações da placa ${grupo.entityLabel}`}
          className="mt-1"
        />

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold text-base">{grupo.entityLabel}</span>
            {grupo.entityType && <Badge variant="secondary">{grupo.entityType}</Badge>}
            <span className="text-xs text-muted-foreground">
              {grupo.changes.length}{" "}
              {grupo.changes.length === 1 ? "alteração" : "alterações"}
            </span>
            {todasJustificadas ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="w-3 h-3" /> Justificada
              </Badge>
            ) : algumaJustificada ? (
              <Badge variant="warning">Parcialmente justificada</Badge>
            ) : (
              <Badge variant="warning">Pendente</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onJustificarGrupo();
            }}
          >
            <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
            {multiplas
              ? "Justificar todas"
              : todasJustificadas
                ? "Justificar de novo"
                : "Justificar"}
          </Button>
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            ver todas <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </div>
    </section>
  );
}
