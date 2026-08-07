import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetSnapshot, 
  useGetSnapshotParameters, 
  useUpdateSnapshot, 
  useCreateParameter,
  getGetSnapshotQueryKey,
  getGetSnapshotParametersQueryKey
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout/layout";
import { PageLoading, ErrorState } from "@/components/ui/loading";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatDate, formatDateTime, cn } from "@/lib/utils";
import { ArrowLeft, Check, Edit2, Play, Archive, Plus, ShieldAlert } from "lucide-react";

export default function SnapshotDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  
  const { data: snapshot, isLoading: loadingSnapshot, error: errorSnapshot } = useGetSnapshot(id!, { query: { enabled: !!id } });
  const { data: parameters, isLoading: loadingParams } = useGetSnapshotParameters(id!, undefined, { query: { enabled: !!id } });
  
  const updateMutation = useUpdateSnapshot();
  const createParamMutation = useCreateParameter();

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const [isParamOpen, setIsParamOpen] = useState(false);
  const [paramForm, setParamForm] = useState({
    key: "", name: "", category: "RATE", dataType: "NUMBER", valueNum: "", valueText: "", unit: "BRL"
  });

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    try {
      await updateMutation.mutateAsync({
        id,
        data: { label: editLabel, notes: editNotes }
      });
      queryClient.invalidateQueries({ queryKey: getGetSnapshotQueryKey(id) });
      setIsEditOpen(false);
    } catch (err) {
      alert("Erro ao atualizar snapshot");
    }
  };

  const handleStatusChange = async (newStatus: "ACTIVE" | "ARCHIVED", makeCurrent: boolean = false) => {
    if (!id) return;
    try {
      await updateMutation.mutateAsync({
        id,
        data: { status: newStatus, isCurrent: makeCurrent }
      });
      queryClient.invalidateQueries({ queryKey: getGetSnapshotQueryKey(id) });
    } catch (err) {
      alert("Erro ao alterar status");
    }
  };

  const handleCreateParam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    try {
      await createParamMutation.mutateAsync({
        data: {
          snapshotId: id,
          parameterKey: paramForm.key,
          parameterName: paramForm.name,
          category: paramForm.category,
          dataType: paramForm.dataType,
          unit: paramForm.unit || undefined,
          valueNumeric: paramForm.dataType === 'NUMBER' ? Number(paramForm.valueNum) : undefined,
          valueText: paramForm.dataType === 'STRING' ? paramForm.valueText : undefined,
          effectiveFrom: snapshot?.snapshotDate || new Date().toISOString().split('T')[0],
        }
      });
      queryClient.invalidateQueries({ queryKey: getGetSnapshotParametersQueryKey(id) });
      queryClient.invalidateQueries({ queryKey: getGetSnapshotQueryKey(id) });
      setIsParamOpen(false);
      setParamForm({ key: "", name: "", category: "RATE", dataType: "NUMBER", valueNum: "", valueText: "", unit: "BRL" });
    } catch (err) {
      alert("Erro ao criar parâmetro");
    }
  };

  if (loadingSnapshot) return <Layout><PageLoading /></Layout>;
  if (errorSnapshot || !snapshot) return <Layout><ErrorState error={errorSnapshot} /></Layout>;

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6">
          
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/snapshots" className="hover:text-foreground flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> Voltar
            </Link>
            <span>/</span>
            <span className="font-mono">{snapshot.id.substring(0,8)}...</span>
          </div>

          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 bg-card p-6 rounded-xl border shadow-sm">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{snapshot.label}</h1>
                {snapshot.isCurrent && <Badge variant="success" className="px-2 py-1"><Check className="w-3 h-3 mr-1"/> Atual</Badge>}
                {!snapshot.isCurrent && snapshot.status === 'ACTIVE' && <Badge variant="default">Ativo</Badge>}
                {snapshot.status === 'DRAFT' && <Badge variant="secondary">Rascunho</Badge>}
                {snapshot.status === 'ARCHIVED' && <Badge variant="outline">Arquivado</Badge>}
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                <div><span className="text-muted-foreground">Data Vigência:</span> <span className="font-mono font-medium">{formatDate(snapshot.snapshotDate)}</span></div>
                <div><span className="text-muted-foreground">Parâmetros:</span> <span className="font-mono font-medium">{snapshot.parameterCount}</span></div>
                <div><span className="text-muted-foreground">Criado em:</span> <span className="font-mono font-medium">{formatDateTime(snapshot.createdAt)}</span></div>
                {snapshot.notes && (
                  <div className="w-full mt-2"><span className="text-muted-foreground">Notas:</span> {snapshot.notes}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => {
                setEditLabel(snapshot.label);
                setEditNotes(snapshot.notes || "");
                setIsEditOpen(true);
              }}>
                <Edit2 className="w-4 h-4 mr-2" /> Editar Info
              </Button>
              
              {snapshot.status === 'DRAFT' && (
                <Button size="sm" onClick={() => handleStatusChange('ACTIVE')} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                  <Play className="w-4 h-4 mr-2" /> Ativar Modelo
                </Button>
              )}
              {snapshot.status === 'ACTIVE' && !snapshot.isCurrent && (
                <Button size="sm" onClick={() => handleStatusChange('ACTIVE', true)} className="bg-primary hover:bg-primary/90">
                  <ShieldAlert className="w-4 h-4 mr-2" /> Definir como Atual
                </Button>
              )}
              {(snapshot.status === 'ACTIVE' || snapshot.status === 'DRAFT') && !snapshot.isCurrent && (
                <Button variant="destructive" size="sm" onClick={() => handleStatusChange('ARCHIVED')}>
                  <Archive className="w-4 h-4 mr-2" /> Arquivar
                </Button>
              )}
            </div>
          </div>

          <Card className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between bg-muted/10">
              <h3 className="font-semibold text-lg">Parâmetros & Tabela de Frete</h3>
              <Button size="sm" variant="secondary" onClick={() => setIsParamOpen(true)} disabled={snapshot.status === 'ARCHIVED'}>
                <Plus className="w-4 h-4 mr-2" /> Adicionar Parâmetro
              </Button>
            </div>
            
            <div className="overflow-auto min-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chave</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead>Vigência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingParams ? (
                    <TableRow><TableCell colSpan={6} className="h-32 text-center"><PageLoading /></TableCell></TableRow>
                  ) : parameters?.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">Nenhum parâmetro cadastrado neste snapshot.</TableCell></TableRow>
                  ) : (
                    parameters?.map((param) => (
                      <TableRow key={param.id} className={param.isSuperseded ? "opacity-50 bg-muted/50" : ""}>
                        <TableCell className="font-mono text-xs">{param.parameterKey}</TableCell>
                        <TableCell className="font-medium">{param.parameterName}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{param.category}</Badge></TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {param.dataType === 'NUMBER' ? param.valueNumeric?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : param.valueText}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">{param.unit || '-'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(param.effectiveFrom)} {param.effectiveUntil ? `até ${formatDate(param.effectiveUntil)}` : 'em diante'}
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

      {/* Modals */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <form onSubmit={handleUpdate}>
          <DialogHeader>
            <DialogTitle>Editar Snapshot</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Nome</Label>
              <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label>Notas</Label>
              <Input value={editNotes} onChange={e => setEditNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsEditOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={updateMutation.isPending}>{updateMutation.isPending ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </form>
      </Dialog>

      <Dialog open={isParamOpen} onOpenChange={setIsParamOpen}>
        <form onSubmit={handleCreateParam}>
          <DialogHeader>
            <DialogTitle>Novo Parâmetro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Chave (Código)</Label>
                <Input value={paramForm.key} onChange={e => setParamForm({...paramForm, key: e.target.value})} placeholder="ex: TAXA_PEDAGIO" required />
              </div>
              <div className="space-y-2">
                <Label>Nome de Exibição</Label>
                <Input value={paramForm.name} onChange={e => setParamForm({...paramForm, name: e.target.value})} placeholder="ex: Taxa de Pedágio" required />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Categoria</Label>
                <select 
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={paramForm.category} 
                  onChange={e => setParamForm({...paramForm, category: e.target.value})}
                >
                  <option value="RATE">Tarifa Base (RATE)</option>
                  <option value="SURCHARGE">Adicional (SURCHARGE)</option>
                  <option value="DISCOUNT">Desconto (DISCOUNT)</option>
                  <option value="RULE">Regra (RULE)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label>Tipo de Dado</Label>
                <select 
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={paramForm.dataType} 
                  onChange={e => setParamForm({...paramForm, dataType: e.target.value})}
                >
                  <option value="NUMBER">Número</option>
                  <option value="STRING">Texto</option>
                  <option value="BOOLEAN">Booleano</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valor</Label>
                {paramForm.dataType === 'NUMBER' ? (
                  <Input type="number" step="any" value={paramForm.valueNum} onChange={e => setParamForm({...paramForm, valueNum: e.target.value})} required />
                ) : (
                  <Input value={paramForm.valueText} onChange={e => setParamForm({...paramForm, valueText: e.target.value})} required />
                )}
              </div>
              <div className="space-y-2">
                <Label>Unidade</Label>
                <Input value={paramForm.unit} onChange={e => setParamForm({...paramForm, unit: e.target.value})} placeholder="BRL, %, KM, etc" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsParamOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={createParamMutation.isPending}>{createParamMutation.isPending ? "Adicionando..." : "Adicionar"}</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </Layout>
  );
}
