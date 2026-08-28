import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { fetchJson } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * As três peças que as seções de Configurações repetem.
 *
 * Elas moravam dentro da tela única de Configurações; quando ela virou índice e
 * cada seção ganhou o seu arquivo, ficar em uma delas faria as outras
 * importarem de uma irmã por acaso — o `post` de Usuários sendo o `post` de
 * Perfil porque foi ali que ele nasceu.
 */

export function post(path: string, body?: unknown): Promise<unknown> {
  return fetchJson<unknown>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

export function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className="text-xs uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

/** A recusa vem do servidor escrita para ser lida; a tela só a emoldura. */
export function Refusal({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/40",
        "bg-destructive/10 p-3 text-sm text-destructive",
      )}
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
