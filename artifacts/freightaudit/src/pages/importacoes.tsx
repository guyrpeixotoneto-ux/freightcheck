import { useState } from "react";
import { useListImports, useCreateImport, getListImportsQueryKey } from "@workspace/api-client-react";
import { Layout } from "@/components/layout/layout";
import { PageLoading, ErrorState } from "@/components/ui/loading";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, cn } from "@/lib/utils";
import { FileDown, Plus, Upload, CheckCircle2, XCircle, AlertCircle, FileText } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function Importacoes() {
  const queryClient = useQueryClient();
  const { data: imports, isLoading, error } = useListImports();
  const createMutation = useCreateImport();

  const [isOpen, setIsOpen] = useState(false);
  const [sourceType, setSourceType] = useState("ERP_EXTRACT");
  const [filename, setFilename] = useState("");
  const [notes, setNotes] = useState("");

  if (isLoading) return <Layout><PageLoading /></Layout>;
  if (error) return <Layout><ErrorState error={error} /></Layout>;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createMutation.mutateAsync({
        data: { sourceType, filename, notes }
      });
      queryClient.invalidateQueries({ queryKey: getListImportsQueryKey() });
      setIsOpen(false);
      setFilename("");
      setNotes("");
    } catch (err) {
      alert("Erro ao criar tarefa de importação");
    }
  };

  return (
    <Layout>
      <div className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <FileDown className="w-8 h-8 text-primary" />
                Importação de Faturas
              </h1>
              <p className="text-muted-foreground mt-1">
                Central de cargas e integração de arquivos CTe/Faturas do ERP.
              </p>
            </div>
            <Button onClick={() => setIsOpen(true)} className="gap-2">
              <Upload className="w-4 h-4" />
              Nova Importação
            </Button>
          </div>

          <Card className="flex-1 flex flex-col overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Status</TableHead>
                  <TableHead>Arquivo / Fonte</TableHead>
                  <TableHead>Data da Carga</TableHead>
                  <TableHead className="text-right">Registros Lidos</TableHead>
                  <TableHead className="text-right">Válidos</TableHead>
                  <TableHead className="text-right">Avisos</TableHead>
                  <TableHead className="text-right">Erros</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {imports?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Nenhuma importação encontrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  imports?.map((job) => (
                    <TableRow key={job.id} className="group hover:bg-muted/30">
                      <TableCell>
                        {job.status === 'DONE' ? (
                          <Badge variant="success" className="gap-1"><CheckCircle2 className="w-3 h-3"/> Sucesso</Badge>
                        ) : job.status === 'FAILED' ? (
                          <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3"/> Erro</Badge>
                        ) : job.status === 'PROCESSING' ? (
                          <Badge variant="warning" className="gap-1 animate-pulse">Processando</Badge>
                        ) : (
                          <Badge variant="secondary">{job.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          {job.filename || job.sourceType}
                        </div>
                        {job.notes && <div className="text-xs text-muted-foreground mt-1">{job.notes}</div>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {formatDateTime(job.importedAt)}
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">
                        {job.rowCount?.toLocaleString() || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-emerald-600">
                        {job.validCount?.toLocaleString() || '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-amber-600">
                        {job.warningCount != null && job.warningCount > 0 ? (
                          <span className="flex justify-end items-center gap-1"><AlertCircle className="w-3 h-3"/> {job.warningCount}</span>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-destructive">
                        {job.errorCount != null && job.errorCount > 0 ? job.errorCount : '-'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <form onSubmit={handleCreate}>
          <DialogHeader>
            <DialogTitle>Nova Importação</DialogTitle>
            <DialogDescription>Simule a importação de um novo lote de faturas ou CTe.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Fonte de Dados</Label>
              <select 
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                value={sourceType} onChange={e => setSourceType(e.target.value)}
              >
                <option value="ERP_EXTRACT">Extrato do ERP</option>
                <option value="TMS_XML">XML de CTe (TMS)</option>
                <option value="MANUAL_CSV">Planilha Manual (CSV)</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Nome do Arquivo</Label>
              <Input value={filename} onChange={e => setFilename(e.target.value)} placeholder="faturas_maio_2024.csv" required />
            </div>
            <div className="space-y-2">
              <Label>Observações</Label>
              <Input value={notes} onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={createMutation.isPending}>{createMutation.isPending ? "Iniciando..." : "Iniciar Carga"}</Button>
          </DialogFooter>
        </form>
      </Dialog>
    </Layout>
  );
}
