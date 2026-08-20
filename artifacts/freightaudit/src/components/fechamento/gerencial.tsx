import {
  CircleDashed,
  CircleSlash,
  Clock,
  Lock,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  EXPLICACAO_DA_SITUACAO,
  NOME_DA_SITUACAO,
  type QuinzenaDoAno,
  type SituacaoDaQuinzena,
} from "@/lib/fechamento-gerencial";
import { cn } from "@/lib/utils";

/**
 * O vocabulário visual da Visão Gerencial do Fechamento — as cinco situações de
 * uma quinzena, a faixa do ano e a legenda.
 *
 * Mora aqui, e não em cada tela, porque a mesma cor tem de querer dizer a mesma
 * coisa na faixa do ano do cartão e na grade da unidade: duas telas com dois
 * verdes diferentes para "encerrada" obrigariam quem lê a reaprender a legenda
 * a cada clique.
 *
 * **Só uma situação é alarme.** `VENCIDA` — a quinzena acabou e a competência
 * continua aberta — é a única pintada em destaque de erro, porque é a única em
 * que alguém está atrasado. `SEM_COMPETENCIA` é buraco e usa o traço
 * pontilhado da ausência, o mesmo do dia sem operação na grade de dias; o resto
 * é o calendário seguindo o seu curso, e calendário não é alarme.
 */
export const APARENCIA_DA_SITUACAO: Record<
  SituacaoDaQuinzena,
  { ladrilho: string; etiqueta: string; icon: LucideIcon }
> = {
  ENCERRADA: {
    ladrilho: "bg-primary border-primary",
    etiqueta: "border-primary bg-primary text-primary-foreground",
    icon: Lock,
  },
  VENCIDA: {
    ladrilho: "bg-destructive border-destructive",
    etiqueta: "border-destructive bg-destructive text-destructive-foreground",
    icon: TriangleAlert,
  },
  EM_CURSO: {
    ladrilho: "bg-primary/30 border-primary/40",
    etiqueta: "border-primary/40 bg-primary/10 text-primary",
    icon: Clock,
  },
  SEM_COMPETENCIA: {
    ladrilho: "bg-muted border-border border-dashed",
    etiqueta: "border-border border-dashed bg-muted text-muted-foreground",
    icon: CircleSlash,
  },
  FUTURA: {
    ladrilho: "bg-muted/40 border-border/60",
    etiqueta: "border-border bg-muted text-muted-foreground",
    icon: CircleDashed,
  },
};

/** A situação por extenso, na etiqueta que as duas telas usam. */
export function EtiquetaDaSituacao({
  situacao,
  className,
}: {
  situacao: SituacaoDaQuinzena;
  className?: string;
}) {
  const { etiqueta, icon: Icone } = APARENCIA_DA_SITUACAO[situacao];
  return (
    <span
      title={EXPLICACAO_DA_SITUACAO[situacao]}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide whitespace-nowrap",
        etiqueta,
        className,
      )}
    >
      <Icone className="w-3 h-3" />
      {NOME_DA_SITUACAO[situacao]}
    </span>
  );
}

/**
 * O ano inteiro em 24 traços — a faixa do cartão da unidade.
 *
 * Doze pares de janeiro a dezembro, um traço por quinzena, na ordem do
 * calendário. Não é gráfico e não pretende ser lido número a número: é o
 * formato da barra de progresso de um ano, em que o olho pega o padrão antes da
 * palavra — três vermelhos seguidos em maio dizem "maio atrasou" sem que
 * ninguém precise ler maio.
 *
 * Cada traço leva o nome do período no `title` porque a faixa é pequena demais
 * para rotular, e uma faixa sem rótulo nenhum viraria decoração.
 */
export function FaixaDoAno({ quinzenas }: { quinzenas: QuinzenaDoAno[] }) {
  return (
    <div className="flex items-end gap-[3px]" aria-hidden>
      {quinzenas.map((q) => (
        <span
          key={q.chave}
          title={`${q.inicio.slice(8, 10)}/${q.inicio.slice(5, 7)} a ${q.fim.slice(8, 10)}/${q.fim.slice(5, 7)} — ${NOME_DA_SITUACAO[q.situacao]}`}
          className={cn(
            "h-4 flex-1 rounded-[2px] border",
            APARENCIA_DA_SITUACAO[q.situacao].ladrilho,
            // O primeiro traço de cada mês fica um pouco mais alto: sem essa
            // marca, contar até "a segunda de julho" exige contar 14 traços.
            q.quinzena === 1 && "h-5",
          )}
        />
      ))}
    </div>
  );
}

/** A legenda das cinco situações, para quem lê a faixa pela primeira vez. */
export function LegendaDasSituacoes({ className }: { className?: string }) {
  const situacoes: SituacaoDaQuinzena[] = [
    "ENCERRADA",
    "VENCIDA",
    "EM_CURSO",
    "SEM_COMPETENCIA",
    "FUTURA",
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      {situacoes.map((situacao) => (
        <li
          key={situacao}
          title={EXPLICACAO_DA_SITUACAO[situacao]}
          className="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span
            className={cn(
              "w-3 h-3 rounded-[2px] border shrink-0",
              APARENCIA_DA_SITUACAO[situacao].ladrilho,
            )}
          />
          {NOME_DA_SITUACAO[situacao]}
        </li>
      ))}
    </ul>
  );
}

/*
  O número grande e a barra moram em `components/gerencial/executivo.tsx` desde
  que a Visão Gerencial da Auditoria passou a ler a faixa executiva pela mesma
  régua. Continuam saindo daqui para as duas telas do Fechamento que já os
  importavam deste arquivo — o que é altura de leitura não é vocabulário de
  domínio, e só o segundo é que muda de ambiente para ambiente.
*/
export { Barra, Numero } from "@/components/gerencial/executivo";
