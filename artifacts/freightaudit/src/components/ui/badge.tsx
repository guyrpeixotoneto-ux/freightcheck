import * as React from "react"
import { cn } from "@/lib/utils"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}

/**
 * A pastilha de estado.
 *
 * Duas correções nesta rodada, e as duas são de consistência:
 *
 * 1. **`success` e `warning` deixaram de ser `emerald` e `amber` crus.** Eram as
 *    únicas duas cores do produto que vinham da paleta do Tailwind e não da
 *    paleta do FreightCheck (`--success`, `--warning`, em `index.css`), o que
 *    fazia a pastilha de "ok" ser um verde e o número de ganho ao lado dela ser
 *    outro — dois verdes na mesma linha, sem que a diferença dissesse nada. Aqui
 *    elas passam a ser o mesmo verde e o mesmo laranja do resto da tela, em
 *    fundo esmaecido.
 * 2. **A elevação saiu.** Uma pastilha é um rótulo, não um objeto apoiado no
 *    papel; a sombra nela era a de um botão, e ela convidava ao clique que não
 *    existe. O que separa a pastilha do fundo agora é a própria cor.
 */
function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        {
          "border-transparent bg-primary text-primary-foreground": variant === "default",
          "border-transparent bg-secondary text-secondary-foreground": variant === "secondary",
          "border-transparent bg-destructive text-destructive-foreground": variant === "destructive",
          "border-superficie-borda text-muted-foreground": variant === "outline",
          "border-transparent bg-success/12 text-success dark:bg-success/20": variant === "success",
          "border-transparent bg-warning/15 text-warning-foreground dark:bg-warning/20 dark:text-warning": variant === "warning",
        },
        className
      )}
      {...props}
    />
  )
}

export { Badge }
