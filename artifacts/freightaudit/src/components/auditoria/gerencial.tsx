import {
  CircleDashed,
  CircleSlash,
  Flag,
  ScanSearch,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import {
  EXPLICACAO_DA_SITUACAO,
  NOME_DA_SITUACAO,
  type QuinzenaAuditada,
  type SituacaoDaAuditoria,
} from "@/lib/auditoria-gerencial";
import { cn } from "@/lib/utils";

/**
 * O vocabulário visual da Visão Gerencial da Auditoria — as cinco situações de
 * uma quinzena, a faixa do ano e a legenda.
 *
 * A forma é a mesma da Visão Gerencial do Fechamento de propósito: quem lê as
 * duas não deve ter de reaprender a faixa. O que muda é o que cada cor quer
 * dizer, e isso não podia ser partilhado — lá a casa cheia é a competência
 * encerrada, aqui é a vigência comparada.
 *
 * **Só uma situação é alarme.** `PENDENTE` — a vigência chegou, tem anterior e
 * continua sem comparação — é a única pintada em destaque de erro, porque é a
 * única em que alguém deixou de olhar. `SEM_VIGENCIA` é ausência e usa o traço
 * pontilhado, e ausência aqui não é atraso: a fonte publica quando muda, e uma
 * quinzena sem publicação é o cadastro parado. `INICIAL` tem cor própria — a
 * primeira vigência de uma série não pode ser comparada com nada, e pintá-la de
 * pendente faria toda unidade estrear reprovada.
 */
export const APARENCIA_DA_SITUACAO: Record<
  SituacaoDaAuditoria,
  { ladrilho: string; etiqueta: string; icon: LucideIcon }
> = {
  AUDITADA: {
    ladrilho: "bg-primary border-primary",
    etiqueta: "border-primary bg-primary text-primary-foreground",
    icon: ScanSearch,
  },
  PENDENTE: {
    ladrilho: "bg-destructive border-destructive",
    etiqueta: "border-destructive bg-destructive text-destructive-foreground",
    icon: TriangleAlert,
  },
  INICIAL: {
    ladrilho: "bg-primary/30 border-primary/40",
    etiqueta: "border-primary/40 bg-primary/10 text-primary",
    icon: Flag,
  },
  SEM_VIGENCIA: {
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

/** A situação por extenso, na etiqueta. */
export function EtiquetaDaSituacao({
  situacao,
  className,
}: {
  situacao: SituacaoDaAuditoria;
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
 * palavra — quatro casas apagadas seguidas dizem "esta unidade parou de
 * publicar em maio" sem que ninguém precise ler maio.
 *
 * Cada traço leva no `title` o período, quantas vigências caíram nele e a
 * situação: a faixa é pequena demais para rotular, e uma faixa sem rótulo
 * nenhum viraria decoração.
 */
export function FaixaDoAno({ quinzenas }: { quinzenas: QuinzenaAuditada[] }) {
  return (
    <div className="flex items-end gap-[3px]" aria-hidden>
      {quinzenas.map((q) => (
        <span
          key={q.chave}
          title={[
            `${q.inicio.slice(8, 10)}/${q.inicio.slice(5, 7)} a ${q.fim.slice(8, 10)}/${q.fim.slice(5, 7)}`,
            NOME_DA_SITUACAO[q.situacao],
            q.vigencias.length > 0 &&
              `${q.vigencias.length} vigência${q.vigencias.length === 1 ? "" : "s"}`,
            q.alteracoes > 0 &&
              `${q.alteracoes} alteraç${q.alteracoes === 1 ? "ão" : "ões"}`,
          ]
            .filter((p): p is string => typeof p === "string")
            .join(" — ")}
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
  const situacoes: SituacaoDaAuditoria[] = [
    "AUDITADA",
    "PENDENTE",
    "INICIAL",
    "SEM_VIGENCIA",
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
