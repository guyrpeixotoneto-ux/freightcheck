import { useState } from "react";
import { useListSnapshots, useCreateDiff, useGetDiffItems } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/layout";
import { PageLoading, ErrorState } from "@/components/ui/loading";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL, cn } from "@/lib/utils";
import { GitCompareArrows, ArrowRight, Loader2 } from "lucide-react";
import type { SnapshotDiff } from "@workspace/api-client-react";

export default function Comparar() {
  const { data: snapshots, isLoading: loadingSnapshots } = useListSnapshots();
  const createDiffMutation = useCreateDiff();
  
  const [snapshotAId, setSnapshotAId] = useState<string>("");
  const [snapshotBId, setSnapshotBId] = useState<string>("");
  const [activeDiff, setActiveDiff] = useState<SnapshotDiff | null>(null);

  const { data: items, isLoading: loadingItems } = useGetDiffItems(
    activeDiff?.id || "", 
    {}, 
    { query: { enabled: !!activeDiff?.id } }
  );

  const handleCompare = async () => {
    if (!snapshotAId || !snapshotBId) return;
    try {
      const result = await createDiffMutation.mutateAsync({
        data: { snapshotAId, snapshotBId }
      });
      setActiveDiff(result);
    } catch (err) {
      alert("Erro ao comparar snapshots");
    }
  };

  if (loadingSnapshots) return <Layout><PageLoading /></Layout>;

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8">
          
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <GitCompareArrows className="w-8 h-8 text-primary" />
              Comparar Modelos
            </h1>
            <p className="text-muted-foreground mt-1">
              Gere um relatório de divergências entre duas versões do modelo de remuneração.
            </p>
          </div>

          <Card className="p-6">
            <div className="flex flex-col md:flex-row items-end gap-4">
              <div className="flex-1 space-y-2 w-full">
                <label className="text-sm font-medium">Modelo Base (A)</label>
                <select 
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={snapshotAId}
                  onChange={e => {
                    setSnapshotAId(e.target.value);
                    setActiveDiff(null);
                  }}
                >
                  <option value="" disabled>Selecione o modelo base...</option>
                  {snapshots?.map(s => (
                    <option key={s.id} value={s.id}>{s.label} ({s.status})</option>
                  ))}
                </select>
              </div>
              
              <div className="hidden md:flex h-10 items-center justify-center px-4 text-muted-foreground">
                <ArrowRight className="w-5 h-5" />
              </div>
              
              <div className="flex-1 space-y-2 w-full">
                <label className="text-sm font-medium">Modelo Comparado (B)</label>
                <select 
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                  value={snapshotBId}
                  onChange={e => {
                    setSnapshotBId(e.target.value);
                    setActiveDiff(null);
                  }}
                >
                  <option value="" disabled>Selecione o modelo para comparar...</option>
                  {snapshots?.map(s => (
                    <option key={s.id} value={s.id}>{s.label} ({s.status})</option>
                  ))}
                </select>
              </div>
              
              <div className="w-full md:w-auto">
                <Button 
                  size="lg" 
                  className="w-full md:w-auto" 
                  onClick={handleCompare}
                  disabled={!snapshotAId || !snapshotBId || snapshotAId === snapshotBId || createDiffMutation.isPending}
                >
                  {createDiffMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin"/> Analisando...</> : "Gerar Comparação"}
                </Button>
              </div>
            </div>
          </Card>

          {activeDiff && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Alterados</p>
                      <p className="text-2xl font-bold text-amber-600">{activeDiff.totalChanged}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center font-bold text-amber-700">Δ</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Adicionados</p>
                      <p className="text-2xl font-bold text-emerald-600">{activeDiff.totalAdded}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center font-bold text-emerald-700">+</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Removidos</p>
                      <p className="text-2xl font-bold text-destructive">{activeDiff.totalRemoved}</p>
                    </div>
                    <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center font-bold text-destructive">-</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Impacto Mensal</p>
                      <p className={cn("text-xl font-bold font-mono tracking-tighter", activeDiff.estimatedMonthlyImpact && activeDiff.estimatedMonthlyImpact < 0 ? "text-destructive" : "text-emerald-600")}>
                        {activeDiff.estimatedMonthlyImpact ? formatBRL(activeDiff.estimatedMonthlyImpact) : "R$ 0,00"}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <Card className="flex flex-col overflow-hidden">
                <div className="p-4 border-b bg-muted/10">
                  <h3 className="font-semibold text-lg">Detalhamento das Divergências</h3>
                </div>
                
                <div className="overflow-auto min-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[80px]">Tipo</TableHead>
                        <TableHead>Parâmetro</TableHead>
                        <TableHead>Valor A (Base)</TableHead>
                        <TableHead>Valor B (Novo)</TableHead>
                        <TableHead className="text-right">Variação %</TableHead>
                        <TableHead className="text-right">Impacto/Mês</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loadingItems ? (
                        <TableRow><TableCell colSpan={6} className="h-32 text-center"><PageLoading /></TableCell></TableRow>
                      ) : items?.length === 0 ? (
                        <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Os modelos são idênticos. Nenhuma alteração encontrada.</TableCell></TableRow>
                      ) : (
                        items?.map((item) => (
                          <TableRow key={item.id} className="group hover:bg-muted/30">
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
                            <TableCell className="text-right">
                              {item.deltaPercent != null ? (
                                <Badge variant={item.deltaPercent > 0 ? "destructive" : "success"} className="font-mono ml-auto">
                                  {item.deltaPercent > 0 ? '+' : ''}{item.deltaPercent.toFixed(2)}%
                                </Badge>
                              ) : '-'}
                            </TableCell>
                            <TableCell className="text-right font-mono font-semibold">
                              {item.estimatedMonthlyImpact != null ? (
                                <span className={item.estimatedMonthlyImpact > 0 ? "text-emerald-600" : item.estimatedMonthlyImpact < 0 ? "text-destructive" : ""}>
                                  {item.estimatedMonthlyImpact > 0 ? '+' : ''}{formatBRL(item.estimatedMonthlyImpact)}
                                </span>
                              ) : '-'}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
