import { useState } from "react";
import { useListSnapshots, useCreateSnapshot, getListSnapshotsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/layout";
import { PageLoading, ErrorState } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/utils";
import { Plus, Database, ChevronRight, Search } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner"; // Using sonner directly or window.alert if not available, wait, we have toaster? Let's use simple alert if toast fails, but we have `@/components/ui/toaster` supposedly. Actually sonner is in package.json.

export default function SnapshotsList() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: snapshots, isLoading, error } = useListSnapshots();
  const createMutation = useCreateSnapshot();

  const [search, setSearch] = useState("");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newNotes, setNewNotes] = useState("");

  if (isLoading) return <Layout><PageLoading /></Layout>;
  if (error) return <Layout><ErrorState error={error} /></Layout>;

  const filteredSnapshots = snapshots?.filter(s => 
    s.label.toLowerCase().includes(search.toLowerCase()) || 
    s.id.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const result = await createMutation.mutateAsync({
        data: { label: newLabel, snapshotDate: newDate, notes: newNotes }
      });
      queryClient.invalidateQueries({ queryKey: getListSnapshotsQueryKey() });
      setIsCreateOpen(false);
      setLocation(`/snapshots/${result.id}`);
    } catch (err) {
      console.error(err);
      alert("Erro ao criar snapshot");
    }
  };

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Database className="w-8 h-8 text-primary" />
                Modelos de Remuneração (Snapshots)
              </h1>
              <p className="text-muted-foreground mt-1">
                Gerencie as versões e estados dos modelos de frete.
              </p>
            </div>
            <Button onClick={() => setIsCreateOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Novo Snapshot
            </Button>
          </div>

          <Card className="flex-1 flex flex-col overflow-hidden">
            <div className="p-4 border-b flex items-center gap-4 bg-muted/20">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input 
                  placeholder="Buscar por nome ou ID..." 
                  className="pl-9 bg-white"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[80px]">Status</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Data de Vigência</TableHead>
                  <TableHead>Parâmetros</TableHead>
                  <TableHead>Criado Em</TableHead>
                  <TableHead className="text-right">Ação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSnapshots.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                      Nenhum snapshot encontrado.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSnapshots.map((snapshot) => (
                    <TableRow key={snapshot.id} className="group">
                      <TableCell>
                        {snapshot.isCurrent ? (
                          <Badge variant="success">Atual</Badge>
                        ) : snapshot.status === 'ACTIVE' ? (
                          <Badge variant="default">Ativo</Badge>
                        ) : snapshot.status === 'DRAFT' ? (
                          <Badge variant="secondary">Rascunho</Badge>
                        ) : (
                          <Badge variant="outline">Arquivado</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {snapshot.label}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDate(snapshot.snapshotDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono">{snapshot.parameterCount}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDateTime(snapshot.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/snapshots/${snapshot.id}`} className="inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-medium hover:bg-accent hover:text-accent-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                            Detalhes <ChevronRight className="w-4 h-4 ml-1" />
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Novo Snapshot</DialogTitle>
            <DialogDescription>
              Crie uma nova versão do modelo de remuneração.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="label">Nome da Versão</Label>
              <Input 
                id="label" 
                placeholder="Ex: Tabela Maio/2024 - Reajuste Combustível" 
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date">Data de Vigência</Label>
              <Input 
                id="date" 
                type="date"
                value={newDate}
                onChange={e => setNewDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Observações (Opcional)</Label>
              <Input 
                id="notes" 
                placeholder="Motivo da criação..." 
                value={newNotes}
                onChange={e => setNewNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsCreateOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={createMutation.isPending || !newLabel || !newDate}>
              {createMutation.isPending ? "Criando..." : "Criar Snapshot"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    </Layout>
  );
}
