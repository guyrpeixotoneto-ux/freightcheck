import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, Building2 } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { CadastroCanonicoDeUnidades } from "@/components/unidades/cadastro-canonico";

/**
 * Unidades — as seleções que existem, com o que cada uma já entregou.
 *
 * Esta tela não é um cadastro, e a diferença importa: **unidade aqui é unidade
 * que entregou vigência.** A lista sai de `/contexts`, que agrupa os snapshots
 * vivos por `scope_hash` e canal; uma unidade que exista no mundo e nunca tenha
 * mandado planilha não aparece, porque sobre ela este produto não tem nada a
 * dizer — e listá-la faria a tela prometer um histórico vazio.
 *
 * Cada linha é a chave que o resto do produto usa para filtrar: unidade +
 * canal. É por isso que a mesma unidade pode aparecer duas vezes, uma por
 * canal — são séries separadas, comparadas separadamente, e juntá-las na tela
 * sugeriria um total que o motor recusa a calcular.
 */

interface Contexto {
  scopeHash: string;
  channel: string | null;
  label: string;
  scopes: { scopeType: string; code: string; name: string | null }[];
  latestPeriod: string;
  periods: number;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** `2026-08-01` → `agosto/2026`. Sem `Date`, para o fuso não recuar o mês. */
function periodo(data: string): string {
  const [ano, mes] = data.split("-");
  const indice = Number(mes) - 1;
  return indice >= 0 && indice < 12 ? `${MESES[indice]}/${ano}` : data;
}

function unidadeDe(contexto: Contexto): string {
  const unidade = contexto.scopes.find((s) => s.scopeType === "UNIDADE");
  return unidade?.name ?? unidade?.code ?? contexto.label;
}

function enderecoDe(contexto: Contexto): string {
  const query = new URLSearchParams({ scopeHash: contexto.scopeHash });
  if (contexto.channel !== null) query.set("canal", contexto.channel);
  return `/parametros?${query}`;
}

export default function Unidades() {
  const { data: contextos = [], isLoading, error } = useQuery({
    queryKey: ["contexts"],
    queryFn: () => fetchJson<Contexto[]>("/contexts"),
  });

  const unidades = new Set(contextos.map((c) => c.scopeHash)).size;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="w-6 h-6 text-primary" />
          Unidades
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          O cadastro das unidades do FreightCheck, identificadas pelo CNPJ, e abaixo
          as seleções (unidade + canal) que já entregaram vigência — que é o que o menu
          do topo mostra e o que Parâmetros usa para filtrar. As duas listas respondem
          perguntas diferentes: <strong>quais unidades existem</strong> e{" "}
          <strong>o que cada uma já entregou</strong>.
        </p>
      </header>

      <div className="p-8 space-y-6">
        {/*
          O cadastro mestre vem primeiro porque é a autoridade: a lista de baixo
          é o acervo — o que cada seleção já entregou —, e continua saindo de
          `/contexts` sem mudar uma linha.
        */}
        <CadastroCanonicoDeUnidades />

        {error && (
          <ApiErrorNotice
            error={error}
            what="A lista de unidades não pôde ser carregada."
          />
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {unidades} {unidades === 1 ? "unidade" : "unidades"} ·{" "}
              {contextos.length} {contextos.length === 1 ? "seleção" : "seleções"} (unidade + canal)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && <p className="p-6 text-sm text-muted-foreground">Carregando…</p>}

            {!isLoading && !error && contextos.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">
                Nenhuma vigência importada ainda. A primeira planilha enviada em{" "}
                <Link href="/importacoes" className="text-primary hover:underline">
                  Importações
                </Link>{" "}
                cria a primeira unidade desta lista.
              </p>
            )}

            {contextos.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                    <th className="text-left px-4 py-2 font-medium">Unidade</th>
                    <th className="text-left px-4 py-2 font-medium">Canal</th>
                    <th className="text-left px-4 py-2 font-medium">Regional e operador</th>
                    <th className="text-left px-4 py-2 font-medium">Vigência mais recente</th>
                    <th className="text-right px-4 py-2 font-medium">No histórico</th>
                    <th className="text-right px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {contextos.map((contexto) => {
                    const outros = contexto.scopes.filter(
                      (s) => s.scopeType === "REGIONAL" || s.scopeType === "OPERADOR",
                    );
                    return (
                      <tr
                        key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
                        className="border-b last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-4 py-2.5 font-semibold">{unidadeDe(contexto)}</td>
                        <td className="px-4 py-2.5">
                          {contexto.channel ?? (
                            <span className="text-muted-foreground text-xs">
                              sem canal no rótulo
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          {outros.length === 0 ? (
                            <span className="text-muted-foreground text-xs">
                              não informados na fonte
                            </span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {outros.map((escopo) => (
                                <Badge
                                  key={`${escopo.scopeType}|${escopo.code}`}
                                  variant="outline"
                                  className="font-normal"
                                >
                                  {escopo.name ?? escopo.code}
                                </Badge>
                              ))}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">{periodo(contexto.latestPeriod)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          {contexto.periods}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            href={enderecoDe(contexto)}
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                          >
                            abrir parâmetros
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
