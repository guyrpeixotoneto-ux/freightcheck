import { useState } from "react";
import { useListSnapshots, useListSimulations, useCreateSimulation } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/layout";
import { PageLoading, ErrorState } from "@/components/ui/loading";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBRL, formatDate, formatDateTime, cn } from "@/lib/utils";
import { Calculator, Play, TrendingUp, TrendingDown, Clock, BarChart3 } from "lucide-react";
import type { SimulationRun } from "@workspace/api-client-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";

export default function Simulacao() {
  const { data: snapshots, isLoading: loadingSnapshots } = useListSnapshots();
  const { data: simulations, isLoading: loadingSimulations, refetch: refetchSimulations } = useListSimulations();
  const createSimMutation = useCreateSimulation();
  
  const [label, setLabel] = useState("");
  const [snapshotAId, setSnapshotAId] = useState("");
  const [snapshotBId, setSnapshotBId] = useState("");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [dateUntil, setDateUntil] = useState(() => new Date().toISOString().split('T')[0]);
  
  const [activeSim, setActiveSim] = useState<SimulationRun | null>(null);

  const handleSimulate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!label || !snapshotAId || !dateFrom || !dateUntil) return;
    try {
      const result = await createSimMutation.mutateAsync({
        data: { label, snapshotAId, snapshotBId: snapshotBId || undefined, dateFrom, dateUntil }
      });
      setActiveSim(result);
      refetchSimulations();
    } catch (err) {
      alert("Erro ao executar simulação");
    }
  };

  if (loadingSnapshots || loadingSimulations) return <Layout><PageLoading /></Layout>;

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8">
          
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <Calculator className="w-8 h-8 text-primary" />
              Simulação Financeira
            </h1>
            <p className="text-muted-foreground mt-1">
              Avalie o impacto real de novos modelos rodando contra o histórico de faturas passadas.
            </p>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-1 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Nova Simulação</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleSimulate} className="space-y-4">
                    <div className="space-y-2">
                      <Label>Nome da Simulação</Label>
                      <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex: Impacto Reajuste 2024" required />
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Modelo Base (A)</Label>
                      <select 
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        value={snapshotAId} onChange={e => setSnapshotAId(e.target.value)} required
                      >
                        <option value="" disabled>Selecione...</option>
                        {snapshots?.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label>Modelo Alternativo (B) - Opcional</Label>
                      <select 
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                        value={snapshotBId} onChange={e => setSnapshotBId(e.target.value)}
                      >
                        <option value="">Nenhum (Apenas recálculo do Base)</option>
                        {snapshots?.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Data Inicial (Histórico)</Label>
                        <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label>Data Final (Histórico)</Label>
                        <Input type="date" value={dateUntil} onChange={e => setDateUntil(e.target.value)} required />
                      </div>
                    </div>

                    <Button type="submit" className="w-full" disabled={createSimMutation.isPending}>
                      {createSimMutation.isPending ? "Processando..." : <><Play className="w-4 h-4 mr-2"/> Executar Simulação</>}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Histórico de Simulações</CardTitle>
                </CardHeader>
                <div className="divide-y max-h-[400px] overflow-auto">
                  {simulations?.length === 0 && <div className="p-4 text-center text-muted-foreground">Nenhuma simulação anterior.</div>}
                  {simulations?.map(sim => (
                    <div 
                      key={sim.id} 
                      className={cn(
                        "p-4 hover:bg-muted/50 cursor-pointer transition-colors",
                        activeSim?.id === sim.id && "bg-primary/5 border-l-4 border-l-primary"
                      )}
                      onClick={() => setActiveSim(sim)}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <h4 className="font-semibold text-sm">{sim.label}</h4>
                        {sim.status === 'DONE' ? (
                          <Badge variant="success" className="text-[10px]">Concluída</Badge>
                        ) : sim.status === 'FAILED' ? (
                          <Badge variant="destructive" className="text-[10px]">Falhou</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]"><Clock className="w-3 h-3 mr-1"/>{sim.status}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground line-clamp-1">{sim.snapshotALabel} vs {sim.snapshotBLabel || 'Realizado'}</p>
                      <p className="text-[10px] text-muted-foreground mt-2">{formatDateTime(sim.createdAt)}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            <div className="xl:col-span-2">
              {activeSim ? (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <Card className="bg-primary/5 border-primary/20">
                    <CardContent className="p-6">
                      <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        <div>
                          <h2 className="text-2xl font-bold tracking-tight">{activeSim.label}</h2>
                          <p className="text-muted-foreground text-sm mt-1">
                            Período: {formatDate(activeSim.dateFrom)} a {formatDate(activeSim.dateUntil)}
                          </p>
                        </div>
                        <div className="flex items-center gap-6">
                          <div className="text-right">
                            <p className="text-sm font-medium text-muted-foreground">Faturas Analisadas</p>
                            <p className="text-2xl font-bold font-mono">{activeSim.totalShipments?.toLocaleString() || 0}</p>
                          </div>
                          {activeSim.totalDelta != null && activeSim.deltaPercent != null && (
                            <div className={cn(
                              "px-4 py-3 rounded-lg flex flex-col items-end",
                              activeSim.totalDelta > 0 ? "bg-destructive/10 text-destructive" : "bg-emerald-100 text-emerald-800"
                            )}>
                              <p className="text-xs font-bold uppercase tracking-wider opacity-80">Impacto Total</p>
                              <div className="flex items-center gap-2">
                                {activeSim.totalDelta > 0 ? <TrendingUp className="w-5 h-5"/> : <TrendingDown className="w-5 h-5"/>}
                                <span className="text-2xl font-bold font-mono">{activeSim.deltaPercent > 0 ? '+' : ''}{activeSim.deltaPercent.toFixed(2)}%</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm text-muted-foreground font-medium">Modelo A (Base)</CardTitle>
                        <p className="font-semibold text-lg">{activeSim.snapshotALabel}</p>
                      </CardHeader>
                      <CardContent>
                        <p className="text-3xl font-bold font-mono tracking-tighter">
                          {formatBRL(activeSim.totalAmountA)}
                        </p>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm text-muted-foreground font-medium">Modelo B (Comparado)</CardTitle>
                        <p className="font-semibold text-lg">{activeSim.snapshotBLabel || 'Custo Real Histórico'}</p>
                      </CardHeader>
                      <CardContent>
                        <p className="text-3xl font-bold font-mono tracking-tighter">
                          {formatBRL(activeSim.totalAmountB)}
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {activeSim.totalAmountA != null && activeSim.totalAmountB != null && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <BarChart3 className="w-5 h-5 text-primary" /> Visão Comparativa
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="h-[300px] w-full mt-4">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={[
                                { name: 'Modelo A', valor: activeSim.totalAmountA },
                                { name: 'Modelo B', valor: activeSim.totalAmountB }
                              ]}
                              margin={{ top: 20, right: 30, left: 40, bottom: 5 }}
                            >
                              <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontWeight: 600}} />
                              <YAxis 
                                tickFormatter={(value) => `R$ ${(value / 1000000).toFixed(1)}M`} 
                                axisLine={false} 
                                tickLine={false} 
                                width={80}
                              />
                              <Tooltip 
                                formatter={(value: number) => formatBRL(value)}
                                cursor={{fill: 'transparent'}}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                              />
                              <Bar dataKey="valor" radius={[6, 6, 0, 0]} maxBarSize={100}>
                                <Cell fill="hsl(var(--primary))" />
                                <Cell fill={activeSim.totalAmountB > activeSim.totalAmountA ? "hsl(var(--destructive))" : "hsl(var(--success))"} />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        {activeSim.annualizedDelta && (
                          <div className="mt-6 p-4 rounded-lg bg-muted text-center flex flex-col items-center">
                            <p className="text-sm font-medium text-muted-foreground mb-1">Impacto Anualizado Estimado</p>
                            <p className={cn("text-xl font-bold font-mono", activeSim.annualizedDelta > 0 ? "text-destructive" : "text-emerald-600")}>
                              {activeSim.annualizedDelta > 0 ? '+' : ''}{formatBRL(activeSim.annualizedDelta)} / ano
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="h-full flex items-center justify-center border-2 border-dashed rounded-xl p-12 text-center">
                  <div className="max-w-md">
                    <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mx-auto mb-4">
                      <Calculator className="w-8 h-8 text-muted-foreground" />
                    </div>
                    <h3 className="text-lg font-semibold text-foreground mb-2">Nenhuma Simulação Selecionada</h3>
                    <p className="text-sm text-muted-foreground">
                      Crie uma nova simulação no painel ao lado ou selecione uma existente no histórico para visualizar os resultados detalhados e o impacto financeiro.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}
