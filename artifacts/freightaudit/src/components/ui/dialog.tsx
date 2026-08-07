import * as React from "react"
import { cn } from "@/lib/utils"

const Dialog = ({ open, onOpenChange, children }: { open?: boolean, onOpenChange?: (open: boolean) => void, children: React.ReactNode }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => onOpenChange?.(false)} />
      <div className="relative z-50 w-full max-w-lg rounded-xl border bg-background p-6 shadow-lg animate-in fade-in zoom-in-95">
        {children}
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

const DialogFooter = ({ className, children }: { className?: string, children: React.ReactNode }) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 mt-6", className)}>
    {children}
  </div>
)

export { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter }
