import { cn } from "@/lib/utils";

/**
 * A faixa executiva — o vocabulário que as duas Visões Gerenciais partilham.
 *
 * O número grande com denominador embaixo e a barra de percentual nasceram na
 * Visão Gerencial do Fechamento e são lidos igual na da Auditoria: mesma
 * altura de leitura, mesma promessa. Mora aqui, e não em cada ambiente, porque
 * duas cópias divergem — e a divergência entre duas telas que se dizem "a visão
 * gerencial" é lida como duas verdades sobre a mesma casa.
 *
 * O que **não** mora aqui é a cor de situação: encerrada, vencida, auditada,
 * pendente. Aquilo é vocabulário de domínio, e cada ambiente define o seu — ver
 * `components/fechamento/gerencial.tsx` e `components/auditoria/gerencial.tsx`.
 */

/**
 * Um número grande com o rótulo em cima e o denominador embaixo.
 *
 * O `detalhe` não é enfeite: é o que impede o número de ser lido sozinho. "68%"
 * sem "17 de 25 vigências" é um percentual sem denominador, e percentual sem
 * denominador é o que vira slide — repetido numa reunião por quem nunca abriu a
 * tela de dentro. Toda faixa executiva deste produto carrega os dois.
 *
 * `barra` desenha o percentual dentro do próprio tijolo, e não sob a faixa
 * inteira: uma barra atravessando cinco números não diz de qual deles ela é.
 */
export function Numero({
  rotulo,
  valor,
  sufixo,
  detalhe,
  alerta,
  barra,
}: {
  rotulo: string;
  valor: string;
  /**
   * A unidade do número, em corpo menor ao lado dele — "/mês", "/ano".
   *
   * Separada do valor porque ela **não pode sumir** na redução de corpo: um
   * "R$ 39.936" sem o "/mês" é a mesma frase com outro significado. É a mesma
   * decisão do `ValorGrande` da Visão geral, e o mesmo tamanho.
   */
  sufixo?: string;
  detalhe: string;
  alerta?: boolean;
  barra?: number;
}) {
  return (
    <div className="px-6 py-5 flex-1 min-w-[13rem]">
      <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
        {rotulo}
      </p>
      <p
        className={cn(
          "font-bold tabular-nums mt-1.5 whitespace-nowrap",
          /*
            O corpo cede ao comprimento, e não o contrário. Cinco tijolos numa
            faixa dão pouco mais de 12rem de texto a cada um: "100%" e
            "−R$ 735,3 mil" moram no mesmo lugar, e em corpo único o segundo
            quebra — no pior caso logo depois do sinal, o que põe o menos
            sozinho numa linha e faz uma perda ser lida como ganho.
          */
          valor.length > 9 ? "text-2xl" : "text-3xl",
          alerta && "text-destructive",
        )}
      >
        {valor}
        {sufixo && (
          <span className="text-sm font-normal text-muted-foreground">{sufixo}</span>
        )}
      </p>
      {barra !== undefined && (
        <div className="mt-2">
          <Barra percentual={barra} />
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-1.5">{detalhe}</p>
    </div>
  );
}

/**
 * A barra do percentual.
 *
 * Escrita à mão em vez de reaproveitar `ui/progress`: aquele componente pinta o
 * trilho com `bg-primary/20`, o que num cartão de fundo claro faz a barra vazia
 * parecer meio cheia. Aqui o trilho é neutro e só o que está feito é da cor do
 * produto.
 */
export function Barra({ percentual }: { percentual: number }) {
  return (
    <div className="h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.max(0, Math.min(100, percentual))}%` }}
      />
    </div>
  );
}
