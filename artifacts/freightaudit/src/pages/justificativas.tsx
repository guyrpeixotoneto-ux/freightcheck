import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, FileCheck2, WifiOff } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorNotice } from "@/components/api-error";
import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import type { ChangeRow } from "@/components/changes/change-table";
import { cn } from "@/lib/utils";

/**
 * Plano de Ação — Justificativas.
 *
 * A pergunta é uma só: o que mudou de uma vigência para a outra, e por quê —
 * mas quem justifica é a alteração, não a placa. A tela lê a mesma comparação
 * que a aba Planilha de Alterações lê (`/changes/latest`) e agrupa as linhas
 * por placa só para navegação — é assim que o gestor reconhece o ativo —,
 * mas cada alteração dentro do grupo tem sua própria seleção, seu próprio
 * status e sua própria justificativa. Marcar o cabeçalho da placa seleciona
 * todas as alterações dela de uma vez; marcar uma alteração isolada permite
 * justificar só aquela, mesmo que a placa tenha outras pendentes.
 */

interface ChangesLatestResponse {
  set: { id: string };
  total: number;
  rows: ChangeRow[];
}

interface Justificativa {
  id: string;
  changeSetId: string;
  changeId: number;
  entityLabel: string;
  entityType: string | null;
  texto: string;
  criadoPor: string;
  criadoEm: string;
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
  const queryClient = useQueryClient();

  /*
    Resiliente, como as demais consultas que abrem uma tela inteira (ver
    `pages/unidades.tsx`). Antes esta tela usava `useQuery` cru: uma falha de
    transporte — a origem acordando, um soluço de rede — chegava como painel
    de erro sem botão de repetir, e sem nada em tela para além dele. `useQuery`
    já repete sozinho por conta da política global (`App.tsx`); o que faltava
    era o desfecho de quando as tentativas se esgotam: `indisponivel` diz
    quando não há nada para mostrar, `avisarSobreDadoGuardado` diz quando há
    uma lista válida e só a atualização falhou, e as duas trazem
    `tentarDeNovo` — a única forma de recuperar sem recarregar a página.
  */
  const consulta = useConsultaResiliente<ChangesLatestResponse>({
    queryKey: ["changes-latest", "justificativas"],
    endpoint: "/changes/latest",
    buscar: () => fetchJson<ChangesLatestResponse>("/changes/latest"),
  });

  const data = consulta.dados;
  const isLoading = consulta.carregando;
  const changeSetId = data?.set.id;
  const grupos = useMemo(() => agruparPorPlaca(data?.rows ?? []), [data]);

  /*
    Resiliente pelo mesmo motivo da lista de alterações: uma justificativa já
    carregada não pode sumir da tela porque uma atualização de fundo tropeçou.
    `enabled: !!changeSetId` continua igual — só passa a buscar quando há uma
    comparação para perguntar.
  */
  const justificativasConsulta = useConsultaResiliente<{
    justificativas: Justificativa[];
  }>({
    queryKey: ["justificativas", changeSetId],
    endpoint: "/justificativas",
    buscar: () =>
      fetchJson<{ justificativas: Justificativa[] }>(
        `/justificativas?changeSetId=${changeSetId}`,
      ),
    enabled: !!changeSetId,
  });
  const justificativasData = justificativasConsulta.dados;

  const justificadaPor = useMemo(() => {
    const mapa = new Map<number, Justificativa>();
    for (const j of justificativasData?.justificativas ?? []) mapa.set(j.changeId, j);
    return mapa;
  }, [justificativasData]);

  const [selecionadas, setSelecionadas] = useState<Set<number>>(new Set());
  const [dialogAlvo, setDialogAlvo] = useState<ChangeRow[] | null>(null);

  const alternarSelecao = (changeId: number) => {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(changeId)) proximo.delete(changeId);
      else proximo.add(changeId);
      return proximo;
    });
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
          O que mudou nesta vigência, agrupado por placa. Marque uma ou várias
          alterações e justifique de uma vez — a justificativa fica registrada com
          quem escreveu e quando.
        </p>
      </header>

      <div className="px-8 pb-10 space-y-4 max-w-[1400px]">
        {isLoading && (
          <div className="space-y-3" aria-hidden>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
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

        {grupos.length > 0 && (
          <>
            <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
              <span>
                {grupos.length} {grupos.length === 1 ? "placa alterada" : "placas alteradas"}
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
                        grupos.flatMap((g) => g.changes).filter((c) => selecionadas.has(c.id)),
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
              {grupos.map((grupo) => (
                <LinhaPlaca
                  key={grupo.entityLabel}
                  grupo={grupo}
                  selecionadas={selecionadas}
                  justificadaPor={justificadaPor}
                  onSelecionarGrupo={() => alternarSelecaoGrupo(grupo)}
                  onSelecionarChange={alternarSelecao}
                  onJustificarGrupo={() => setDialogAlvo(grupo.changes)}
                  onJustificarChange={(change) => setDialogAlvo([change])}
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
  onSelecionarChange,
  onJustificarGrupo,
  onJustificarChange,
}: {
  grupo: PlacaGroup;
  selecionadas: Set<number>;
  justificadaPor: Map<number, Justificativa>;
  onSelecionarGrupo: () => void;
  onSelecionarChange: (changeId: number) => void;
  onJustificarGrupo: () => void;
  onJustificarChange: (change: ChangeRow) => void;
}) {
  const multiplas = grupo.changes.length > 1;
  const todasJustificadas = grupo.changes.every((c) => justificadaPor.has(c.id));
  const algumaJustificada = grupo.changes.some((c) => justificadaPor.has(c.id));
  const grupoSelecionado = grupo.changes.every((c) => selecionadas.has(c.id));

  return (
    <section
      className={cn(
        "bg-card border rounded-xl shadow-sm overflow-hidden",
        grupoSelecionado && "ring-2 ring-brand",
      )}
    >
      <div className="flex items-start gap-3 px-5 py-4">
        <Checkbox
          checked={grupoSelecionado}
          onCheckedChange={onSelecionarGrupo}
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

          <ul className="mt-3 space-y-2">
            {grupo.changes.map((change) => {
              const justificativa = justificadaPor.get(change.id) ?? null;
              return (
                <li key={change.id} className="text-sm">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {multiplas && (
                      <Checkbox
                        checked={selecionadas.has(change.id)}
                        onCheckedChange={() => onSelecionarChange(change.id)}
                        aria-label={`Selecionar alteração ${change.attributeName ?? change.attributeCode ?? change.id}`}
                      />
                    )}
                    <span className="font-medium">
                      {change.attributeName ?? change.attributeCode ?? "—"}
                    </span>
                    <span className="text-muted-foreground font-mono text-xs">
                      {change.valueBefore ?? "—"} → {change.valueAfter ?? "—"}
                    </span>
                    {multiplas &&
                      (justificativa ? (
                        <Badge variant="success" className="gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Justificada
                        </Badge>
                      ) : (
                        <Badge variant="warning">Pendente</Badge>
                      ))}
                    {multiplas && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => onJustificarChange(change)}
                      >
                        {justificativa ? "Justificar de novo" : "Justificar"}
                      </Button>
                    )}
                  </div>

                  {justificativa && (
                    <div className="mt-1.5 rounded-lg bg-muted/40 px-3 py-2 text-sm">
                      <p>{justificativa.texto}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {justificativa.criadoPor} ·{" "}
                        {new Date(justificativa.criadoEm).toLocaleString("pt-BR")}
                      </p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <Button variant="outline" size="sm" onClick={onJustificarGrupo} className="shrink-0">
          <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
          {multiplas
            ? "Justificar todas"
            : todasJustificadas
              ? "Justificar de novo"
              : "Justificar"}
        </Button>
      </div>
    </section>
  );
}

function JustificarDialog({
  alvo,
  pendente,
  erro,
  onClose,
  onConfirmar,
}: {
  alvo: ChangeRow[] | null;
  pendente: boolean;
  erro: unknown;
  onClose: () => void;
  onConfirmar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState("");

  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setTexto("");
        }
      }}
    >
      {alvo && (
        <>
          <DialogHeader>
            <DialogTitle>
              Justificar{" "}
              {alvo.length === 1
                ? `${alvo[0].entityLabel} — ${alvo[0].attributeName ?? alvo[0].attributeCode ?? "alteração"}`
                : `${alvo.length} alterações`}
            </DialogTitle>
            <DialogDescription>
              {alvo.length === 1
                ? "O texto abaixo fica registrado com esta alteração."
                : "O mesmo texto vale para todas as alterações selecionadas, uma justificativa por alteração."}
            </DialogDescription>
          </DialogHeader>

          {alvo.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {alvo.map((change) => (
                <Badge key={change.id} variant="secondary" className="font-mono">
                  {change.entityLabel} · {change.attributeName ?? change.attributeCode ?? "—"}
                </Badge>
              ))}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Justificativa
            </span>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: troca de eixo aprovada pela manutenção em 12/08"
              rows={4}
              autoFocus
            />
          </label>

          {erro != null && (
            <div className="mt-4">
              <ApiErrorNotice error={erro} what="A justificativa não pôde ser salva." />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={texto.trim() === "" || pendente}
              onClick={() => onConfirmar(texto.trim())}
            >
              {pendente ? "Salvando…" : "Salvar justificativa"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
