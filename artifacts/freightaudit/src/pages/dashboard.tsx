import { useGetDashboardSummary, useGetDashboardRecentChanges, useListAlerts } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBRL, formatDate, cn } from "@/lib/utils";
import { PageLoading, ErrorState } from "@/components/ui/loading";
import { ArrowUpRight, ArrowDownRight, AlertTriangle, AlertCircle, TrendingUp, Info, Activity } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: summary, isLoading: loadingSummary, error: errorSummary } = useGetDashboardSummary();
  const { data: recentChanges, isLoading: loadingChanges } = useGetDashboardRecentChanges({ limit: 5 });
  const { data: alerts, isLoading: loadingAlerts } = useListAlerts({ isRead: false });

  if (loadingSummary) return <Layout><PageLoading /></Layout>;
  if (errorSummary || !summary) return <Layout><ErrorState error={errorSummary} /></Layout>;

  const hasImpact = summary.estimatedMonthlyImpact !== null;
  const isNegative = hasImpact && summary.estimatedMonthlyImpact! < 0;

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
              <p className="text-muted-foreground mt-1">Visão executiva do modelo de remuneração de fretes</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-white px-3 py-1.5 rounded-md border shadow-sm">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Modelo Ativo: <span className="font-semibold text-foreground">{summary.currentSnapshot.label}</span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Impacto Mensal Estimado</p>
                    <div className="flex items-baseline gap-2">
                      <h2 className={cn("text-2xl font-bold font-mono tracking-tight", isNegative ? "text-destructive" : "text-emerald-600")}>
                        {hasImpact ? formatBRL(summary.estimatedMonthlyImpact) : "N/D"}
                      </h2>
                    </div>
                  </div>
                  <div className={cn("p-2 rounded-md", isNegative ? "bg-destructive/10 text-destructive" : "bg-emerald-100 text-emerald-700")}>
                    {isNegative ? <ArrowDownRight className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Alterações Não Revisadas</p>
                    <h2 className="text-2xl font-bold font-mono tracking-tight">{summary.recentChangesCount}</h2>
                  </div>
                  <div className="p-2 rounded-md bg-amber-100 text-amber-700">
                    <Activity className="w-5 h-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Alertas Ativos</p>
                    <h2 className="text-2xl font-bold font-mono tracking-tight">{summary.unreadAlertsCount}</h2>
                  </div>
                  <div className={cn("p-2 rounded-md", summary.unreadAlertsCount > 0 ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex justify-between items-start">
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">Última Importação</p>
                    <h2 className="text-lg font-bold font-mono tracking-tight mt-1">
                      {summary.lastImportAt ? formatDate(summary.lastImportAt) : "Nunca"}
                    </h2>
                  </div>
                  <div className="p-2 rounded-md bg-primary/10 text-primary">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">Últimas Alterações Detectadas</h3>
                <Link href="/alteracoes" className="text-sm font-medium text-primary hover:underline">
                  Ver todas
                </Link>
              </div>
              
              <Card>
                <div className="divide-y">
                  {loadingChanges ? (
                    <div className="p-8 flex justify-center"><PageLoading /></div>
                  ) : recentChanges?.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground">Nenhuma alteração recente encontrada.</div>
                  ) : (
                    recentChanges?.map((change) => (
                      <div key={change.id} className="p-4 hover:bg-muted/30 transition-colors flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className={cn(
                            "w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
                            change.changeType === 'ADDED' ? "bg-emerald-100 text-emerald-700" :
                            change.changeType === 'REMOVED' ? "bg-destructive/10 text-destructive" :
                            "bg-amber-100 text-amber-700"
                          )}>
                            {change.changeType === 'ADDED' ? '+' : change.changeType === 'REMOVED' ? '-' : 'Δ'}
                          </div>
                          <div>
                            <p className="font-medium text-sm">{change.entityName}</p>
                            <p className="text-xs text-muted-foreground truncate max-w-sm">
                              {change.entityType} • {change.snapshotBLabel}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-mono text-sm font-semibold">
                            {change.changeType === 'CHANGED' ? (
                              <span className="flex items-center gap-1">
                                <span className="line-through text-muted-foreground opacity-70">{change.valueBeforeText || change.valueBefore}</span>
                                <span className="text-muted-foreground">→</span>
                                <span>{change.valueAfterText || change.valueAfter}</span>
                              </span>
                            ) : change.changeType === 'ADDED' ? (
                              change.valueAfterText || change.valueAfter
                            ) : (
                              change.valueBeforeText || change.valueBefore
                            )}
                          </p>
                          {change.estimatedMonthlyImpact && (
                            <p className={cn(
                              "text-xs font-medium font-mono mt-0.5",
                              change.estimatedMonthlyImpact > 0 ? "text-emerald-600" : "text-destructive"
                            )}>
                              {change.estimatedMonthlyImpact > 0 ? '+' : ''}{formatBRL(change.estimatedMonthlyImpact)}/mês
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold tracking-tight">Alertas</h3>
              </div>
              
              <div className="space-y-3">
                {loadingAlerts ? (
                  <PageLoading />
                ) : alerts?.length === 0 ? (
                  <Card>
                    <CardContent className="p-8 text-center text-muted-foreground flex flex-col items-center justify-center">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-3">
                        <Info className="w-6 h-6 text-muted-foreground/50" />
                      </div>
                      Nenhum alerta pendente.
                    </CardContent>
                  </Card>
                ) : (
                  alerts?.slice(0, 5).map(alert => (
                    <Card key={alert.id} className={cn(
                      "border-l-4",
                      alert.severity === 'CRITICAL' ? "border-l-destructive" :
                      alert.severity === 'HIGH' ? "border-l-destructive/80" :
                      alert.severity === 'MEDIUM' ? "border-l-amber-500" :
                      "border-l-primary"
                    )}>
                      <CardContent className="p-4 flex gap-3">
                        <AlertCircle className={cn(
                          "w-5 h-5 shrink-0",
                          alert.severity === 'CRITICAL' || alert.severity === 'HIGH' ? "text-destructive" :
                          alert.severity === 'MEDIUM' ? "text-amber-500" : "text-primary"
                        )} />
                        <div>
                          <h4 className="text-sm font-semibold">{alert.title}</h4>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{alert.body}</p>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-[10px] uppercase font-bold text-muted-foreground">{formatDate(alert.createdAt)}</span>
                            {alert.estimatedImpact && (
                              <Badge variant={alert.estimatedImpact > 0 ? "success" : "destructive"} className="text-[10px] px-1.5 py-0 h-4">
                                {formatBRL(alert.estimatedImpact)}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
