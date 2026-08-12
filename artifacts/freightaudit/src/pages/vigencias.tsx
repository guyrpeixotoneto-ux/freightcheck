import { useQuery } from "@tanstack/react-query";
import { Database, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";

/**
 * Vigências — as versões de remuneração recebidas, em ordem.
 *
 * O rótulo é o que a Freightec escreveu; a data é derivada dele por regra
 * explícita e mostrada ao lado, nunca no lugar.
 */

interface Snapshot {
  id: string;
  sourceLabel: string;
  effectiveDate: string;
  entityTypeSet: string;
  revision: number;
  status: string;
  entityCount: number;
  factCount: number;
}

export default function Vigencias() {
  const { data: snapshots = [], isLoading, error } = useQuery({
    queryKey: ["snapshots"],
    queryFn: () => fetchJson<Snapshot[]>("/snapshots"),
  });

  const totalFacts = snapshots.reduce((sum, s) => sum + s.factCount, 0);

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          Vigências
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl">
          Cada vigência é uma versão da remuneração, congelada no momento em que
          foi recebida. O rótulo é o texto original do arquivo; a data ao lado é
          derivada dele por regra explícita.
        </p>
      </header>

      <div className="p-8 space-y-6">
        {error && (
          <ApiErrorNotice
            error={error}
            what="A lista de vigências não pôde ser carregada."
          />
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {snapshots.length} vigências ·{" "}
              {totalFacts.toLocaleString("pt-BR")} fatos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading && (
              <p className="p-6 text-sm text-muted-foreground">Carregando…</p>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                  <th className="text-left px-4 py-2 font-medium">Rótulo da fonte</th>
                  <th className="text-left px-4 py-2 font-medium">Vigência</th>
                  <th className="text-left px-4 py-2 font-medium">Cobertura</th>
                  <th className="text-right px-4 py-2 font-medium">Ativos</th>
                  <th className="text-right px-4 py-2 font-medium">Fatos</th>
                  <th className="text-left px-4 py-2 font-medium">Situação</th>
                  <th className="text-right px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {snapshots.map((s, index) => (
                  <tr key={s.id} className="border-b last:border-0 hover:bg-muted/40">
                    <td className="px-4 py-2.5 font-mono text-xs">{s.sourceLabel}</td>
                    <td className="px-4 py-2.5 tabular-nums">{s.effectiveDate}</td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {s.entityTypeSet.replace("+", " · ")}
                      {s.revision > 1 && (
                        <Badge variant="outline" className="ml-2">
                          revisão {s.revision}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {s.entityCount}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {s.factCount.toLocaleString("pt-BR")}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        className={
                          s.status === "CLOSED"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300 hover:bg-emerald-100"
                            : "bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100"
                        }
                      >
                        {s.status === "CLOSED" ? "fechada" : s.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {index > 0 && (
                        <Link
                          href="/comparar"
                          className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                        >
                          comparar com a anterior
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground mt-4 max-w-3xl">
          Uma vigência fechada é imutável — o banco recusa qualquer alteração
          nela. Uma correção reentrega a mesma vigência como nova revisão, e a
          anterior é preservada.
        </p>
      </div>
    </Layout>
  );
}
