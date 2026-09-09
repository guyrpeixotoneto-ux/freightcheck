import * as React from 'react';
import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';

/**
 * A faixa de aviso.
 *
 * Ela tinha dois tons — neutro e destrutivo — e o destrutivo era só texto
 * vermelho sobre fundo branco com uma borda de 50% de opacidade: sobre o cinza
 * da página, uma faixa dessas não se distingue de um cartão comum até que
 * alguém leia a primeira palavra. As faixas que precisavam ser vistas escapavam
 * para `bg-red-50 border-red-200` escrito à mão, com um vermelho que não é o do
 * produto.
 *
 * Aqui os tons são quatro, e cada um é o **fundo esmaecido da própria cor**
 * mais o traço dela — que é como um aviso se separa do conteúdo sem gritar. Os
 * quatro cobrem exatamente a régua que o produto já usava em palavras:
 *
 * - `destructive` — o número está errado, ou a operação falhou;
 * - `warning` — há pendência humana; é o laranja, e é escasso de propósito;
 * - `success` — fechou, conferiu, terminou;
 * - `info` — o marinho: contexto sobre o que está em tela, sem gravidade.
 *
 * `default` continua neutro e continua sendo o padrão. A cor do ícone acompanha
 * o tom sem que quem chama precise pintá-lo.
 */
const alertVariants = cva(
  'relative w-full rounded-xl border px-4 py-3.5 text-sm [&>svg+div]:translate-y-[-2px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:w-4 [&>svg]:h-4 [&>svg~*]:pl-7',
  {
    variants: {
      variant: {
        default: 'bg-card text-foreground border-superficie-borda [&>svg]:text-muted-foreground',
        destructive:
          'border-destructive/25 bg-destructive/[0.06] text-foreground [&>svg]:text-destructive [&_[data-slot=alert-title]]:text-destructive',
        warning:
          'border-warning/35 bg-warning/[0.10] text-foreground [&>svg]:text-warning',
        success:
          'border-success/25 bg-success/[0.07] text-foreground [&>svg]:text-success',
        info: 'border-brand/20 bg-brand/[0.05] text-foreground [&>svg]:text-brand',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = 'Alert';

const AlertTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    data-slot="alert-title"
    className={cn('mb-1 font-bold leading-snug tracking-tight', className)}
    {...props}
  />
));
AlertTitle.displayName = 'AlertTitle';

const AlertDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-sm text-muted-foreground [&_p]:leading-relaxed', className)}
    {...props}
  />
));
AlertDescription.displayName = 'AlertDescription';

export { Alert, AlertTitle, AlertDescription };
