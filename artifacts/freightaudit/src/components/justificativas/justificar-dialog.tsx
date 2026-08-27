import { useEffect, useState } from "react";
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
import type { Justificativa } from "@/lib/justificativas";

/**
 * O formulário de justificar — uma ou várias alterações de uma vez, mesmo
 * texto para todas. Compartilhado entre a lista de Justificativas e a tela
 * de detalhe por placa: nenhuma das duas muda o que significa justificar,
 * só de onde a lista de alterações-alvo vem.
 *
 * `contexto` e `justificativaAtual` são o que a grade da tela de placa
 * precisou acrescentar. Na fila, justificar é sempre na vigência que o
 * seletor mostra, e dizer qual seria repetir o cabeçalho; na grade, o clique
 * pode cair em qualquer coluna, e um diálogo que não diz **em que vigência**
 * se está gravando deixa a decisão sem a metade que a torna verificável.
 * `justificativaAtual` aparece quando se clica numa célula já verde: o texto
 * que já está gravado abre no campo, porque quem reabre uma célula explicada
 * quase sempre quer corrigir o que escreveu, e não redigir do zero sem saber
 * o que está substituindo.
 */
export function JustificarDialog({
  alvo,
  contexto,
  justificativaAtual,
  pendente,
  erro,
  onClose,
  onConfirmar,
}: {
  alvo: ChangeRow[] | null;
  /** Onde isto vai ser gravado — "vigência 01/08/26". Opcional: a fila não precisa. */
  contexto?: string;
  /** A justificativa que já existe para o alvo, quando se está reescrevendo. */
  justificativaAtual?: Justificativa | null;
  pendente: boolean;
  erro: unknown;
  onClose: () => void;
  onConfirmar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState("");

  /*
    O campo é semeado quando o alvo muda, e não a cada render: semear a cada
    render apagaria o que está sendo digitado. `alvo` é estado da tela que
    abre o diálogo, então trocar de célula troca a referência — que é
    exatamente quando o texto deve ser resemeado.
  */
  useEffect(() => {
    if (alvo !== null) setTexto(justificativaAtual?.texto ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alvo]);

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
              {contexto && ` Gravado na ${contexto}.`}
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

          {justificativaAtual && (
            <div className="mb-3 rounded-lg bg-muted/40 px-3 py-2 text-sm">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
                Justificativa atual
              </p>
              <p>{justificativaAtual.texto}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {justificativaAtual.criadoPor} ·{" "}
                {new Date(justificativaAtual.criadoEm).toLocaleString("pt-BR")}
              </p>
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
              {pendente
                ? "Salvando…"
                : justificativaAtual
                  ? "Salvar nova justificativa"
                  : "Salvar justificativa"}
            </Button>
          </DialogFooter>
        </>
      )}
    </Dialog>
  );
}
