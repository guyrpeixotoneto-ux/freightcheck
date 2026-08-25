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
 * A pergunta é uma só: o que mudou de uma vigência para a outra, placa a
 * placa, e por que. A tela lê a mesma comparação que a aba Planilha de
 * Alterações lê (`/changes/latest`) e reagrupa as linhas por placa — o
 * gestor não olha "o atributo X mudou em 40 ativos", olha "o que mudou nesta
 * placa" — com a opção de marcar uma ou várias placas e justificar todas de
 * uma vez.
 */

interface ChangesLatestResponse {
  set: { id: string };
  total: number;
  rows: ChangeRow[];
}

interface Justificativa {
  id: string;
  changeSetId: string;
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
    const mapa = new Map<string, Justificativa>();
    for (const j of justificativasData?.justificativas ?? []) mapa.set(j.entityLabel, j);
    return mapa;
  }, [justificativasData]);

  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [dialogAlvo, setDialogAlvo] = useState<string[] | null>(null);

  const alternarSelecao = (placa: string) => {
    setSelecionadas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(placa)) proximo.delete(placa);
      else proximo.add(placa);
      return proximo;
    });
  };

  const mutation = useMutation({
    mutationFn: (input: { entityLabels: string[]; texto: string }) =>
      fetchJson<{ justificativas: Justificativa[] }>("/justificativas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          changeSetId,
          entityLabels: input.entityLabels,
          texto: input.texto,
        }),
      }),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: ["justificativas", changeSetId] });
      setSelecionadas((atual) => {
        const proximo = new Set(atual);
        for (const placa of input.entityLabels) proximo.delete(placa);
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
          O que mudou nesta vigência, agrupado por placa. Marque uma ou várias e
          justifique de uma vez — a justificativa fica registrada com quem escreveu e
          quando.
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
                    {selecionadas.size === 1 ? "placa selecionada" : "placas selecionadas"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setSelecionadas(new Set())}>
                    limpar
                  </Button>
                  <Button size="sm" onClick={() => setDialogAlvo([...selecionadas])}>
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
                  selecionada={selecionadas.has(grupo.entityLabel)}
                  justificativa={justificadaPor.get(grupo.entityLabel) ?? null}
                  onSelecionar={() => alternarSelecao(grupo.entityLabel)}
                  onJustificar={() => setDialogAlvo([grupo.entityLabel])}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <JustificarDialog
        placas={dialogAlvo}
        pendente={mutation.isPending}
        erro={mutation.error}
        onClose={() => {
          setDialogAlvo(null);
          mutation.reset();
        }}
        onConfirmar={(texto) => {
          if (!dialogAlvo) return;
          mutation.mutate({ entityLabels: dialogAlvo, texto });
        }}
      />
    </Layout>
  );
}

function LinhaPlaca({
  grupo,
  selecionada,
  justificativa,
  onSelecionar,
  onJustificar,
}: {
  grupo: PlacaGroup;
  selecionada: boolean;
  justificativa: Justificativa | null;
  onSelecionar: () => void;
  onJustificar: () => void;
}) {
  return (
    <section
      className={cn(
        "bg-card border rounded-xl shadow-sm overflow-hidden",
        selecionada && "ring-2 ring-brand",
      )}
    >
      <div className="flex items-start gap-3 px-5 py-4">
        <Checkbox
          checked={selecionada}
          onCheckedChange={onSelecionar}
          aria-label={`Selecionar placa ${grupo.entityLabel}`}
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
            {justificativa ? (
              <Badge variant="success" className="gap-1">
                <CheckCircle2 className="w-3 h-3" /> Justificada
              </Badge>
            ) : (
              <Badge variant="warning">Pendente</Badge>
            )}
          </div>

          <ul className="mt-3 space-y-1.5">
            {grupo.changes.map((change) => (
              <li key={change.id} className="text-sm flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">
                  {change.attributeName ?? change.attributeCode ?? "—"}
                </span>
                <span className="text-muted-foreground font-mono text-xs">
                  {change.valueBefore ?? "—"} → {change.valueAfter ?? "—"}
                </span>
              </li>
            ))}
          </ul>

          {justificativa && (
            <div className="mt-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <p>{justificativa.texto}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {justificativa.criadoPor} ·{" "}
                {new Date(justificativa.criadoEm).toLocaleString("pt-BR")}
              </p>
            </div>
          )}
        </div>

        <Button variant="outline" size="sm" onClick={onJustificar} className="shrink-0">
          <ClipboardList className="w-3.5 h-3.5 mr-1.5" />
          {justificativa ? "Justificar de novo" : "Justificar"}
        </Button>
      </div>
    </section>
  );
}

function JustificarDialog({
  placas,
  pendente,
  erro,
  onClose,
  onConfirmar,
}: {
  placas: string[] | null;
  pendente: boolean;
  erro: unknown;
  onClose: () => void;
  onConfirmar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState("");

  return (
    <Dialog
      open={placas !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setTexto("");
        }
      }}
    >
      {placas && (
        <>
          <DialogHeader>
            <DialogTitle>
              Justificar {placas.length === 1 ? placas[0] : `${placas.length} placas`}
            </DialogTitle>
            <DialogDescription>
              {placas.length === 1
                ? "O texto abaixo fica registrado com o que mudou nesta placa."
                : "O mesmo texto vale para todas as placas selecionadas, uma justificativa por placa."}
            </DialogDescription>
          </DialogHeader>

          {placas.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {placas.map((placa) => (
                <Badge key={placa} variant="secondary" className="font-mono">
                  {placa}
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
