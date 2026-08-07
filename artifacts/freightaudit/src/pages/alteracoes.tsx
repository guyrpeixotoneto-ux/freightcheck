import { useState } from "react";
import { useListDiffs, useGetDiffItems, getGetDiffItemsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/layout";
import { PageLoading, ErrorState } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL, cn } from "@/lib/utils";
import { Activity, Filter } from "lucide-react";

export default function Alteracoes() {
  const { data: diffs, isLoading: loadingDiffs, error: errorDiffs } = useListDiffs();
  
  const [selectedDiffId, setSelectedDiffId] = useState<string>("");
  const [changeType, setChangeType] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");

  // Auto-select most recent diff when loaded
  if (diffs && diffs.length > 0 && !selectedDiffId) {
    setSelectedDiffId(diffs[0].id);
  }

  const { data: items, isLoading: loadingItems } = useGetDiffItems(
    selectedDiffId, 
    { changeType: changeType || undefined, severity: severity || undefined }, 
    { query: { enabled: !!selectedDiffId } }
  );

  if (loadingDiffs && !diffs) return <Layout><PageLoading /></Layout>;
  if (errorDiffs) return <Layout><ErrorState error={errorDiffs} /></Layout>;

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Activity className="w-8 h-8 text-primary" />
                Auditoria de Alterações
              </h1>
              <p className="text-muted-foreground mt-1">
                Histórico detalhado de variações entre modelos.
              </p>
            </div>
          </div>

          <Card className="p-4 border-b flex flex-wrap items-center gap-4 bg-muted/10">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Filter className="w-4 h-4 text-muted-foreground" />
              Filtros:
            </div>
            
            <div className="flex-1 min-w-[200px]">
              <select 
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={selectedDiffId}
                onChange={e => setSelectedDiffId(e.target.value)}
              >
                <option value="" disabled>Selecione uma comparação...</option>
                {diffs?.map(diff => (
                  <option key={diff.id} value={diff.id}>
                    {diff.snapshotALabel} vs {diff.snapshotBLabel}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-40">
              <select 
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={changeType}
                onChange={e => setChangeType(e.target.value)}
              >
                <option value="">Todos os Tipos</option>
                <option value="ADDED">Adicionados (+)</option>
                <option value="REMOVED">Removidos (-)</option>
                <option value="CHANGED">Alterados (Δ)</option>
                <option value="UNCHANGED">Inalterados (=)</option>
              </select>
            </div>

            <div className="w-40">
              <select 
                className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={severity}
                onChange={e => setSeverity(e.target.value)}
              >
                <option value="">Todas Severidades</option>
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Média</option>
                <option value="HIGH">Alta</option>
                <option value="CRITICAL">Crítica</option>
              </select>
            </div>
          </Card>
          
          <Card className="flex-1 flex flex-col overflow-hidden">
            <div className="overflow-auto min-h-[500px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Tipo</TableHead>
                    <TableHead>Entidade / Chave</TableHead>
                    <TableHead>Valor Anterior</TableHead>
                    <TableHead>Novo Valor</TableHead>
                    <TableHead>Variação</TableHead>
                    <TableHead className="text-right">Impacto/Mês</TableHead>
                    <TableHead>Severidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingItems ? (
                    <TableRow><TableCell colSpan={7} className="h-32 text-center"><PageLoading /></TableCell></TableRow>
                  ) : !selectedDiffId ? (
                    <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Selecione uma comparação acima para ver as alterações.</TableCell></TableRow>
                  ) : items?.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="h-32 text-center text-muted-foreground">Nenhuma alteração encontrada com os filtros atuais.</TableCell></TableRow>
                  ) : (
                    items?.map((item) => (
                      <TableRow key={item.id} className="group">
                        <TableCell>
                          <div className={cn(
                            "inline-flex items-center justify-center w-8 h-8 rounded-full font-bold text-xs",
                            item.changeType === 'ADDED' ? "bg-emerald-100 text-emerald-700" :
                            item.changeType === 'REMOVED' ? "bg-destructive/10 text-destructive" :
                            item.changeType === 'CHANGED' ? "bg-amber-100 text-amber-700" :
                            "bg-muted text-muted-foreground"
                          )}>
                            {item.changeType === 'ADDED' ? '+' : item.changeType === 'REMOVED' ? '-' : item.changeType === 'CHANGED' ? 'Δ' : '='}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{item.entityName}</div>
                          <div className="text-xs text-muted-foreground font-mono mt-0.5">{item.entityKey}</div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground line-through opacity-70">
                          {item.valueBeforeText || item.valueBefore || '-'}
                        </TableCell>
                        <TableCell className="font-mono text-sm font-semibold">
                          {item.valueAfterText || item.valueAfter || '-'}
                        </TableCell>
                        <TableCell>
                          {item.deltaPercent != null && (
                            <Badge variant={item.deltaPercent > 0 ? "destructive" : "success"} className="font-mono">
                              {item.deltaPercent > 0 ? '+' : ''}{item.deltaPercent.toFixed(2)}%
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {item.estimatedMonthlyImpact != null ? (
                            <span className={item.estimatedMonthlyImpact > 0 ? "text-emerald-600" : item.estimatedMonthlyImpact < 0 ? "text-destructive" : ""}>
                              {item.estimatedMonthlyImpact > 0 ? '+' : ''}{formatBRL(item.estimatedMonthlyImpact)}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>
                          {item.severity && (
                            <Badge variant={
                              item.severity === 'CRITICAL' ? "destructive" :
                              item.severity === 'HIGH' ? "destructive" :
                              item.severity === 'MEDIUM' ? "warning" : "secondary"
                            } className="text-[10px]">
                              {item.severity}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
