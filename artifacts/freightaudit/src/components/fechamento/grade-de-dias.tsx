import { Link } from "wouter";
import { formatBrlCompacto, formatNumber } from "@/lib/format";
import { DIAS_DA_SEMANA, type DiaDaOperacao } from "@/lib/fechamento";

/**
 * A grade de dias da quinzena — a porta de entrada do diário.
 *
 * É a versão viva das abas `01`…`31` da `Fechamento_Remuneracao.xlsb`: uma
 * caixinha por dia do período, o que rodou dentro dela, e um clique que abre a
 * operação daquele dia viagem a viagem. Quem fecha a quinzena não pensa em
 * "competência"; pensa em "o dia 3 ficou estranho" — e até aqui não havia por
 * onde descer do total ao dia.
 *
 * **O dia sem operação aparece.** Ele fica apagado e continua clicável, porque
 * "não rodou" é uma resposta, e uma grade que esconde o dia vazio obriga quem
 * confere a contar ladrilhos para descobrir qual falta. O que a grade não faz é
 * inventar a diferença entre "não rodou" e "o 2Art não foi importado": essa
 * quem diz é o aviso acima dela, que sabe se a fonte chegou.
 */
export function GradeDeDias({
  competenciaId,
  dias,
}: {
  competenciaId: string;
  dias: DiaDaOperacao[];
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {dias.map((dia) => (
        <Ladrilho key={dia.dia} competenciaId={competenciaId} dia={dia} />
      ))}
    </div>
  );
}

function Ladrilho({ competenciaId, dia }: { competenciaId: string; dia: DiaDaOperacao }) {
  const rodou = dia.totais.viagens > 0;

  return (
    <Link
      href={`/fechamento/competencias/${competenciaId}/dias/${dia.dia}`}
      className={`rounded-lg border p-3 transition-colors block ${
        rodou
          ? "bg-card hover:border-primary/50 hover:bg-muted/50"
          : "bg-muted/30 border-dashed hover:bg-muted/50"
      }`}
      data-testid={`ladrilho-dia-${dia.dia}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-bold ${rodou ? "" : "text-muted-foreground"}`}>
          Dia {String(dia.numeroDoDia).padStart(2, "0")}
        </span>
        <span className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
          {DIAS_DA_SEMANA[dia.diaDaSemana]}
        </span>
      </div>

      {rodou ? (
        <>
          <p className="text-sm font-semibold tabular-nums mt-1.5">
            {formatBrlCompacto(dia.totais.freteComImposto)}
          </p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {dia.totais.viagens} viagem(ns) · {formatNumber(dia.totais.caixasEntregues, 0)} cx
          </p>
        </>
      ) : (
        <p className="text-xs text-muted-foreground mt-1.5">Sem viagem no 2Art</p>
      )}
    </Link>
  );
}
