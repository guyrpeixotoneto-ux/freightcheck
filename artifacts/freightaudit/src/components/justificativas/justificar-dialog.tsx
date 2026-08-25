import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { ApiErrorNotice } from "@/components/api-error";
import type { ChangeRow } from "@/components/changes/change-table";

/**
 * O formulário de justificar — uma ou várias alterações de uma vez, mesmo
 * texto para todas. Compartilhado entre a lista de Justificativas e a tela
 * de detalhe por placa: nenhuma das duas muda o que significa justificar,
 * só de onde a lista de alterações-alvo vem.
 */
export function JustificarDialog({
  alvo,
  pendente,
  erro,
  onClose,
  onConfirmar,
}: {
  alvo: ChangeRow[] | null;
  pendente: boolean;
  erro: unknown;
  onClose: () => void;
  onConfirmar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState("");

  return (
    <Dialog
      open={alvo !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
          setTexto("");
        }
      }}
    >
      {alvo && (
        <>
          <DialogHeader>
            <DialogTitle>
              Justificar{" "}
              {alvo.length === 1
                ? `${alvo[0].entityLabel} — ${alvo[0].attributeName ?? alvo[0].attributeCode ?? "alteração"}`
                : `${alvo.length} alterações`}
            </DialogTitle>
            <DialogDescription>
              {alvo.length === 1
                ? "O texto abaixo fica registrado com esta alteração."
                : "O mesmo texto vale para todas as alterações selecionadas, uma justificativa por alteração."}
            </DialogDescription>
          </DialogHeader>

          {alvo.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {alvo.map((change) => (
                <Badge key={change.id} variant="secondary" className="font-mono">
                  {change.entityLabel} · {change.attributeName ?? change.attributeCode ?? "—"}
                </Badge>
              ))}
            </div>
          )}

          <label className="block space-y-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
              Justificativa
            </span>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="ex.: troca de eixo aprovada pela manutenção em 12/08"
              rows={4}
              autoFocus
            />
          </label>

          {erro != null && (
            <div className="mt-4">
              <ApiErrorNotice error={erro} what="A justificativa não pôde ser salva." />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              size="sm"
              disabled={texto.trim() === "" || pendente}
              onClick={() => onConfirmar(texto.trim())}
            >
              {pendente ? "Salvando…" : "Salvar justificativa"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
