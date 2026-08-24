import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * A caixa modal — e a garantia de que o botão do fim sempre alcança a tela.
 *
 * O conteúdo destas caixas não tem tamanho fixo: a prévia de uma exclusão
 * cresce com o que a importação sustenta — dezenas de vigências viram dezenas
 * de etiquetas —, e uma caixa centrada e sem limite de altura simplesmente
 * transborda para fora da janela nos dois sentidos, levando junto o rodapé com
 * "Excluir importação". Por isso a rolagem mora aqui, na camada de fora: a
 * caixa fica presa à altura da janela, e o que não couber se alcança rolando.
 */
const Dialog = ({ open, onOpenChange, children }: { open?: boolean, onOpenChange?: (open: boolean) => void, children: React.ReactNode }) => {
  // Com a caixa aberta, a roda do mouse é dela. Sem isto a página de trás
  // rola por baixo do modal e a leitura se perde.
  React.useEffect(() => {
    if (!open) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = anterior };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === "Escape") onOpenChange?.(false) };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [open, onOpenChange]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange?.(false)} />
      {/* O clique no vazio ao redor fecha, como o do fundo — mas só quando é
          neste vazio mesmo, e não num filho que borbulhou até aqui. */}
      <div
        className="relative flex min-h-full items-center justify-center p-4"
        onClick={(e) => { if (e.target === e.currentTarget) onOpenChange?.(false) }}
      >
        <div className="relative z-50 w-full max-w-lg rounded-xl border bg-background p-6 shadow-lg animate-in fade-in zoom-in-95">
          {children}
        </div>
      </div>
    </div>
  );
}

const DialogHeader = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left mb-4", className)}>
    {children}
  </div>
)

const DialogTitle = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)}>
    {children}
  </h2>
)

const DialogDescription = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <p className={cn("text-sm text-muted-foreground", className)}>
    {children}
  </p>
)

/**
 * O rodapé encosta no fim do conteúdo, e a rolagem da camada de fora o traz
 * para a tela. Fica grudado na base da caixa (sticky) para que, numa prévia
 * longa, o botão apareça assim que se começa a rolar — não só lá no fim.
 */
const DialogFooter = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <div className={cn("sticky bottom-0 -mx-6 -mb-6 px-6 pb-6 pt-4 bg-background rounded-b-xl flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", className)}>
    {children}
  </div>
)

export { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
