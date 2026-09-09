import * as React from "react"
import { cn } from "@/lib/utils"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  asChild?: boolean;
}

/**
 * Os três níveis de botão, e o que os separa.
 *
 * A escala não mudou — as alturas são as mesmas, e nenhuma tela muda de layout
 * por causa desta rodada. O que mudou é o que cada nível **parece**:
 *
 * - **primário** (`default`) é marinho cheio e é o único com elevação. Um por
 *   bloco: dois botões cheios lado a lado não têm hierarquia nenhuma.
 * - **secundário** (`outline`, `secondary`) é o contorno sobre o branco do
 *   cartão. O contorno era `border-input` — o cinza de campo de formulário —, o
 *   que fazia botão e caixa de texto se lerem como a mesma coisa. Agora ele é o
 *   cinza da superfície, e o `hover` traz o marinho da marca para a borda: a
 *   afinidade com o produto aparece no toque, e não em repouso.
 * - **terciário** (`ghost`, `link`) não tem casca nenhuma até o cursor chegar.
 *
 * O anel de foco ganhou 2px e um afastamento (`ring-offset`). Com 1px colado na
 * borda, o foco de teclado sobre o botão marinho era invisível — e teclado é
 * como se opera uma tela de auditoria o dia inteiro.
 *
 * `active:` existe nos três: o botão afunda um fio ao ser pressionado. É a
 * única animação que se acrescenta aqui, e ela não é decorativa — é a
 * confirmação de que o clique chegou, num produto em que boa parte dos cliques
 * dispara uma leitura que demora.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold",
          "transition-[background-color,border-color,color,box-shadow] duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          "disabled:pointer-events-none disabled:opacity-50",
          "[&_svg]:shrink-0 [&_svg]:pointer-events-none",
          {
            "bg-primary text-primary-foreground shadow-[var(--sombra-1)] hover:bg-primary/92 active:bg-primary": variant === "default",
            "bg-destructive text-destructive-foreground shadow-[var(--sombra-1)] hover:bg-destructive/90": variant === "destructive",
            "border border-superficie-borda bg-card text-foreground hover:border-brand/50 hover:bg-accent/60 hover:text-brand": variant === "outline",
            "bg-secondary text-secondary-foreground hover:bg-secondary/70": variant === "secondary",
            "text-muted-foreground hover:bg-accent hover:text-accent-foreground": variant === "ghost",
            "text-brand underline-offset-4 hover:underline": variant === "link",
            "active:translate-y-px": variant !== "link",
            "h-9 px-4 py-2": size === "default",
            "h-8 rounded-md px-3 text-xs": size === "sm",
            "h-10 rounded-md px-6": size === "lg",
            "h-9 w-9": size === "icon",
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
