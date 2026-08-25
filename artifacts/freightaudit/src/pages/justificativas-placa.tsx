import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileCheck2 } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useParams, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { JustificarDialog } from "@/components/justificativas/justificar-dialog";
import { LinhaDeAlteracao } from "@/components/justificativas/linha-de-alteracao";
import type { ChangeRow } from "@/components/changes/change-table";
import { fetchJson } from "@/lib/api";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";
import { useJustificadaPor, type Justificativa } from "@/lib/justificativas";

/**
 * O detalhe de uma placa — todas as alterações dela nesta vigência, numa
 * tela só, para quando o card de `justificativas.tsx` não basta. É a
 * resposta a "eu pensei que ia poder clicar no card e ver todas as
 * alterações": lá o card já lista as alterações inline, mas para uma placa
 * com várias mudanças relacionadas, ver todas de uma vez — e selecionar
 * qualquer combinação delas para justificar junto — pede uma tela própria.
 *
 * `changeSetId` vem da URL (`?changeSetId=`), não é escolhido aqui: a
 * vigência é decisão da lista, esta tela só mostra o que ela já escolheu.
 * Sem o parâmetro, não há o que buscar — a tela pede para voltar.
 */

interface ChangesResponse {
  total: number;
  rows: ChangeRow[];
}

export default function JustificativasPlaca() {
  const { placa } = useParams<{ placa: string }>();
  const search = useSearch();
  const [, navegar] = useLocation();
  const queryClient = useQueryClient();

  const changeSetId = new URLSearchParams(search).get("changeSetId") || undefined;
  const voltar = changeSetId ? `/justificativas?changeSetId=${changeSetId}` : "/justificativas";

  const consulta = useConsultaResiliente<ChangesResponse>({
    queryKey: ["change-set-changes", changeSetId, "placa", placa],
    endpoint: "/change-sets/:id/changes",
    buscar: () =>
      fetchJson<ChangesResponse>(
        `/change-sets/${changeSetId}/changes?entityLabel=${encodeURIComponent(placa)}`,
      ),
    enabled: !!changeSetId && !!placa,
  });

  const changes = consulta.dados?.rows ?? [];
  const entityType = changes[0]?.entityType ?? null;
  const { justificadaPor } = useJustificadaPor(changeSetId);

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

  if (!changeSetId) {
    return (
      <Layout>
        <div className="px-8 pt-7 max-w-[1400px]">
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">Nenhuma vigência selecionada.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Volte para Justificativas e escolha a vigência antes de abrir uma placa.
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
          Todas as alterações desta placa na vigência selecionada.
        </p>
      </header>

      <div className="px-8 pb-10 space-y-4 max-w-[1400px]">
        {consulta.carregando && (
          <div className="space-y-3" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        )}

        {consulta.indisponivel && (
          <ApiErrorNotice
            error={consulta.erro}
            what="As alterações desta placa não puderam ser carregadas."
            onTentarDeNovo={consulta.tentarDeNovo}
            tentando={consulta.atualizando}
          />
        )}

        {consulta.dados && changes.length === 0 && (
          <section className="bg-card border rounded-xl shadow-sm px-6 py-10 text-center">
            <p className="text-lg font-bold">Esta placa não mudou nesta vigência.</p>
          </section>
        )}

        {changes.length > 0 && (
          <section className="bg-card border rounded-xl shadow-sm overflow-hidden px-5 py-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <span className="text-sm text-muted-foreground">
                {changes.length} {changes.length === 1 ? "alteração" : "alterações"}
              </span>
              {selecionadas.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">
                    {selecionadas.size}{" "}
                    {selecionadas.size === 1 ? "selecionada" : "selecionadas"}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => setSelecionadas(new Set())}>
                    limpar
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      setDialogAlvo(changes.filter((c) => selecionadas.has(c.id)))
                    }
                  >
                    <FileCheck2 className="w-3.5 h-3.5 mr-1.5" />
                    Justificar selecionadas
                  </Button>
                </div>
              )}
            </div>

            <ul className="space-y-2">
              {changes.map((change) => (
                <LinhaDeAlteracao
                  key={change.id}
                  change={change}
                  justificativa={justificadaPor.get(change.id) ?? null}
                  mostrarSelecao
                  selecionada={selecionadas.has(change.id)}
                  onSelecionar={() => alternarSelecao(change.id)}
                  onJustificar={() => setDialogAlvo([change])}
                />
              ))}
            </ul>
          </section>
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
