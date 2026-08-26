import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { AlertCircle, HelpCircle, Minus, Radar, Search, TrendingDown, TrendingUp } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Paginacao } from "@/components/ui/paginacao";
import { LoadingSpinner } from "@/components/ui/loading";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import { lerRecorte, paramsDoRecorte } from "@/lib/recorte";
import { DiagnosticoDoTrecho } from "@/components/radar-trechos/diagnostico-do-trecho";

/**
 * Radar de Trechos — camada gerencial acima de Trecho 360° e de Alterações.
 *
 * A pergunta que esta tela responde é "quais trechos pioraram, quais
 * melhoraram e quais preciso investigar", não "o que mudou em cada atributo"
 * — essa segunda pergunta continua sendo de Trecho 360°/Alterações, para onde
 * cada linha desta tabela linka. O veredito de cada trecho vem pronto do
 * backend (`GET /trechos/radar`, `@workspace/comparison#classificarTrecho`):
 * esta tela não reclassifica nada, só filtra, ordena e mostra.
 *
 * **Piorou não é "trecho ruim".** É a evolução desta vigência para a
 * anterior — um trecho excelente que caiu de +R$4.000 para +R$3.500 continua
 * excelente e ainda aparece como Piorou. O rótulo é sobre direção, não sobre
 * saúde absoluta do trecho, que este produto não afirma sem a economia
 * completa dele.
 */

export type Veredito = "PIOROU" | "MELHOROU" | "IGUAL" | "MISTO" | "INCONCLUSIVO";

export interface Contribuicao {
  attributeCode: string;
  attributeName: string;
  impactoAssinado: number;
}

export interface ResumoDoTrecho {
  veredito: Veredito;
  impactoLiquido: number | null;
  totalAlteracoes: number;
  alteracoesMateriais: number;
  alteracoesClassificadas: number;
  coberturaPorQuantidade: number | null;
  coberturaPorImpacto: number | null;
  confiabilidade: number | null;
  principalCausa: Contribuicao | null;
  contribuicoes: Contribuicao[];
}

export interface TrechoDoRadar {
  entityId: string;
  entityLabel: string | null;
  resumo: ResumoDoTrecho;
}

interface RespostaDoRadar {
  context: { scopeHash: string; channel: string | null; label: string };
  effectiveDate: string;
  sourceLabel: string;
  previousLabel: string | null;
  changeSetId: string;
  total: number;
  contagens: Record<Veredito, number>;
  trechos: TrechoDoRadar[];
}

const APARENCIA: Record<
  Veredito,
  { rotulo: string; emoji: string; badge: "destructive" | "success" | "secondary" | "warning" | "outline"; icon: typeof TrendingUp }
> = {
  PIOROU: { rotulo: "Piorou", emoji: "🔴", badge: "destructive", icon: TrendingDown },
  MELHOROU: { rotulo: "Melhorou", emoji: "🟢", badge: "success", icon: TrendingUp },
  IGUAL: { rotulo: "Igual", emoji: "⚪", badge: "outline", icon: Minus },
  MISTO: { rotulo: "Misto", emoji: "🟡", badge: "warning", icon: AlertCircle },
  INCONCLUSIVO: { rotulo: "Inconclusivo", emoji: "⚫", badge: "secondary", icon: HelpCircle },
};

const ORDEM_DOS_CARDS: Veredito[] = ["PIOROU", "MELHOROU", "IGUAL", "MISTO", "INCONCLUSIVO"];

function brl(valor: number | null): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function percentual(valor: number | null): string {
  if (valor === null) return "—";
  return `${Math.round(valor * 100)}%`;
}

function VeredictoBadge({ veredito }: { veredito: Veredito }) {
  const a = APARENCIA[veredito];
  return (
    <Badge variant={a.badge} className="gap-1 whitespace-nowrap">
      <span>{a.emoji}</span>
      {a.rotulo}
    </Badge>
  );
}

function principalCausaTexto(trecho: TrechoDoRadar): string {
  const r = trecho.resumo;
  if (r.principalCausa) {
    const seta = r.principalCausa.impactoAssinado < 0 ? "↓" : "↑";
    return `${r.principalCausa.attributeName} ${seta}`;
  }
  if (r.totalAlteracoes === 0) return "Sem alterações";
  if (r.alteracoesClassificadas === 0) return "Falta classificação";
  return "Sem causa apurada";
}

export default function RadarTrechos() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);

  const status = (params.get("status") as Veredito | null) ?? undefined;
  const busca = params.get("busca") ?? "";
  const pagina = Number(params.get("pagina") ?? "1");
  const porPagina = 25;

  const [buscaLocal, setBuscaLocal] = useState(busca);
  const [aberto, setAberto] = useState<TrechoDoRadar | null>(null);

  function atualizar(mudancas: Record<string, string | null>) {
    const novo = new URLSearchParams(search);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === "") novo.delete(chave);
      else novo.set(chave, valor);
    }
    if (!("pagina" in mudancas)) novo.delete("pagina");
    setLocation(`/radar-trechos?${novo}`, { replace: true });
  }

  /*
    scopeHash/canal vêm da própria URL — o mesmo par que a barra lateral lê
    para decidir "unidade atual" (`UnidadeAberta`, em `sidebar.tsx`). Sem eles
    o servidor cairia no contexto mais recente por conta própria, que pode não
    ser o mesmo que a caixa da lateral mostra: foi exatamente esse
    descompasso que produzia "este contexto não tem trecho importado" com a
    unidade certa visível na tela. `/radar-trechos` está em
    `TELAS_QUE_HONRAM_ESCOPO`, então trocar de unidade na lateral preserva
    esta tela e só troca o par na URL.
  */
  const recorte = lerRecorte(search);
  const contexto = paramsDoRecorte(recorte, { comPeriodo: false });

  const queryParams = new URLSearchParams(contexto);
  if (status) queryParams.set("status", status);
  if (busca) queryParams.set("busca", busca);
  queryParams.set("limit", String(porPagina));
  queryParams.set("offset", String((Math.max(pagina, 1) - 1) * porPagina));

  const consulta = useQuery({
    queryKey: ["radar-trechos", queryParams.toString()],
    queryFn: ({ signal }) =>
      fetchJson<RespostaDoRadar>(`/trechos/radar?${queryParams}`, { signal }),
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Radar className="w-6 h-6 text-primary" />
          Radar de Trechos
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Veja rapidamente quais trechos pioraram, melhoraram ou precisam de
          investigação nesta vigência.
        </p>
      </header>

      <div className="p-8 space-y-6">
        {consulta.isLoading && (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <LoadingSpinner className="w-5 h-5" />
            Carregando o Radar…
          </div>
        )}

        {consulta.isError && !consulta.data && (
          <ApiErrorNotice
            error={consulta.error}
            what="Não foi possível carregar o Radar de Trechos."
            onTentarDeNovo={() => consulta.refetch()}
            tentando={consulta.isFetching}
          />
        )}

        {consulta.data && (
          <>
            <p className="text-sm text-muted-foreground">
              {consulta.data.sourceLabel}
              {consulta.data.previousLabel ? ` · comparado com ${consulta.data.previousLabel}` : ""}
              {" · "}
              {consulta.data.context.label}
            </p>

            {/* Cards — total + um por status, clicáveis como filtro. */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <button
                type="button"
                onClick={() => atualizar({ status: null })}
                className={cn(
                  "rounded-xl border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/50",
                  !status && "ring-2 ring-primary",
                )}
              >
                <div className="text-sm text-muted-foreground">Total de trechos</div>
                <div className="text-2xl font-bold mt-1">
                  {ORDEM_DOS_CARDS.reduce((s, v) => s + consulta.data!.contagens[v], 0)}
                </div>
              </button>
              {ORDEM_DOS_CARDS.map((v) => {
                const a = APARENCIA[v];
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => atualizar({ status: status === v ? null : v })}
                    className={cn(
                      "rounded-xl border bg-card px-4 py-4 text-left shadow-sm transition-colors hover:bg-muted/50",
                      status === v && "ring-2 ring-primary",
                    )}
                  >
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <span>{a.emoji}</span> {a.rotulo}
                    </div>
                    <div className="text-2xl font-bold mt-1">{consulta.data!.contagens[v]}</div>
                  </button>
                );
              })}
            </div>

            {/* Busca */}
            <div className="flex items-center gap-3">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={buscaLocal}
                  onChange={(e) => setBuscaLocal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") atualizar({ busca: buscaLocal || null });
                  }}
                  onBlur={() => atualizar({ busca: buscaLocal || null })}
                  placeholder="Buscar trecho…"
                  className="pl-8"
                />
              </div>
              {status && (
                <button
                  type="button"
                  onClick={() => atualizar({ status: null })}
                  className="text-sm text-muted-foreground underline underline-offset-2"
                >
                  Limpar filtro de status
                </button>
              )}
            </div>

            {consulta.data.trechos.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Radar className="w-6 h-6" />
                  </EmptyMedia>
                  <EmptyTitle>Nenhum trecho encontrado</EmptyTitle>
                  <EmptyDescription>
                    {busca || status
                      ? "Nenhum trecho corresponde aos filtros aplicados."
                      : "Este contexto não tem trechos comparáveis nesta vigência."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <div className="rounded-xl border bg-card overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Trecho</TableHead>
                      <TableHead>Evolução</TableHead>
                      <TableHead className="text-right">Impacto apurado</TableHead>
                      <TableHead className="text-right">Alterações</TableHead>
                      <TableHead>Principal causa</TableHead>
                      <TableHead className="text-right">Cobertura</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consulta.data.trechos.map((t) => (
                      <TableRow key={t.entityId}>
                        <TableCell className="font-medium">{t.entityLabel ?? "—"}</TableCell>
                        <TableCell>
                          <VeredictoBadge veredito={t.resumo.veredito} />
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            t.resumo.impactoLiquido !== null &&
                              (t.resumo.impactoLiquido < 0 ? "text-red-700" : "text-emerald-700"),
                          )}
                        >
                          {brl(t.resumo.impactoLiquido)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{t.resumo.totalAlteracoes}</TableCell>
                        <TableCell className="text-muted-foreground">{principalCausaTexto(t)}</TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {percentual(t.resumo.confiabilidade)}
                        </TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => setAberto(t)}
                            className="text-sm text-primary underline underline-offset-2 whitespace-nowrap"
                          >
                            Ver diagnóstico
                          </button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Paginacao
                  pagina={Math.max(pagina, 1)}
                  porPagina={porPagina}
                  total={consulta.data.total}
                  onPagina={(p) => atualizar({ pagina: String(p) })}
                  unidade="trechos"
                />
              </div>
            )}
          </>
        )}
      </div>

      <DiagnosticoDoTrecho
        trecho={aberto}
        context={consulta.data?.context ?? null}
        aoFechar={() => setAberto(null)}
      />
    </Layout>
  );
}
