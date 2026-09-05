import { ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  posicaoDaRegua,
  type DiaDaRegua,
  type EstadoDoDia,
} from "@/lib/monitoramento-de-chamados";

/**
 * A RÉGUA DE DIAS — por onde o dia começa.
 *
 * Cada posição é um dia da operação, e o que ela mostra é **se chegou arquivo
 * naquele dia, e de que tamanho**. Duas cores dão conta: cinza é a ausência —
 * ninguém mandou arquivo —, e azul é o dia que tem o que ler.
 *
 * **A régua já pintou cinco estados, e três eram do trabalho de revisão**:
 * vermelho para o dia com movimentação pendente, verde para o dia todo
 * revisado. A revisão saiu desta tela, e uma cor que promete trabalho sem ter
 * onde fazê-lo é pior do que cor nenhuma — o vermelho de um dia nunca mais
 * desceria, porque não há mais o clique que o apaga.
 *
 * Os cinco continuam vindo do servidor, e continuam certos: o que mudou é o
 * que este módulo lê deles, que agora é uma coisa só — houve importação ou
 * não. A diferença entre "primeira carga", "nada se mexeu" e "chamados se
 * mexeram" não se perdeu: ela está na dica de cada posição, e por extenso na
 * frase do dia aberto.
 *
 * **O número na posição é o tamanho do envio** — quantos chamados o arquivo
 * daquele dia trouxe —, que é o grão da tela. Era o de pendências, e ele
 * respondia por uma fila que não existe mais aqui.
 */

/* A ausência, e o dia que tem arquivo. A cor não promete mais trabalho. */
const SEM_ARQUIVO = "border-border bg-card text-muted-foreground";
const COM_ARQUIVO = "border-blue-200 bg-blue-50 text-blue-700";

const DESCRICAO: Record<EstadoDoDia, string> = {
  SEM_IMPORTACAO: "nenhuma importação neste dia",
  PRIMEIRA_CARGA: "primeira importação da unidade — estado inicial registrado",
  SEM_MOVIMENTACAO: "importação concluída, nenhum chamado se mexeu",
  PENDENTE: "importação concluída, com chamados que se mexeram",
  REVISADO: "importação concluída, com chamados que se mexeram",
};

/**
 * A dica da posição — onde mora o que a cor deixou de dizer.
 *
 * Com duas cores, "primeira carga", "nada se mexeu" e "houve movimentação"
 * passam a se separar por aqui. Os dois números entram na mesma frase porque a
 * posição só tem espaço para um deles, e o que fica em tela é o do arquivo.
 *
 * Cada parte só aparece quando tem o que dizer: um "0 chamados no arquivo"
 * pendurado num dia cinza seria a mesma ausência dita duas vezes.
 */
function dicaDoDia(d: DiaDaRegua, numero: string, mes: string): string {
  const partes = [DESCRICAO[d.estado]];
  if (d.chamadosNoEnvio > 0) {
    partes.push(
      `${d.chamadosNoEnvio.toLocaleString("pt-BR")} chamados no arquivo`,
    );
  }
  if (d.movimentacoes > 0) {
    partes.push(`${d.movimentacoes.toLocaleString("pt-BR")} se mexeram`);
  }
  if (d.enviosComFalha > 0) partes.push("há importação com falha neste dia");
  return `${numero}/${mes} — ${partes.join(" · ")}`;
}

export function ReguaDeDias({
  dias,
  diaAberto,
  hoje,
  carregando,
  onDia,
  onDeslocar,
}: {
  dias: DiaDaRegua[];
  diaAberto: string;
  hoje: string;
  carregando: boolean;
  onDia: (dia: string) => void;
  /** Passos na janela: negativo anda para trás. */
  onDeslocar: (passos: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-3">
      <button
        onClick={() => onDeslocar(-7)}
        aria-label="Semana anterior"
        className="h-10 w-10 shrink-0 rounded-lg border grid place-content-center text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex flex-1 gap-2 overflow-x-auto">
        {carregando && dias.length === 0
          ? Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-16 flex-1 min-w-[64px] rounded-lg" />
            ))
          : dias.map((d) => {
              const { numero, mes } = posicaoDaRegua(d.dia);
              const aberto = d.dia === diaAberto;
              const ehHoje = d.dia === hoje;
              return (
                <button
                  key={d.dia}
                  onClick={() => onDia(d.dia)}
                  aria-current={aberto ? "date" : undefined}
                  title={dicaDoDia(d, numero, mes)}
                  className={cn(
                    "flex-1 min-w-[64px] rounded-lg border px-2 py-2 transition-colors",
                    d.estado === "SEM_IMPORTACAO" ? SEM_ARQUIVO : COM_ARQUIVO,
                    aberto && "ring-2 ring-primary ring-offset-1",
                    /*
                      A importação que falhou ganha contorno tracejado, e não uma
                      terceira cor: ela não diz se chegou arquivo — diz que o
                      arquivo que chegou pode estar incompleto. Ver `resumoDoDia`,
                      que escreve a frase inteira.
                    */
                    d.enviosComFalha > 0 && "border-dashed border-amber-400",
                  )}
                >
                  <div className="text-lg font-bold leading-none tabular-nums">
                    {numero}
                  </div>
                  <div className="text-[10px] uppercase tracking-wide mt-0.5 opacity-80">
                    {mes}
                  </div>
                  {ehHoje ? (
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide">
                      Hoje
                    </div>
                  ) : (
                    /*
                      Só o dia que recebeu arquivo ganha número. Um `0` em cada
                      dia sem importação encheria a régua de zeros e faria o
                      olho procurar diferença onde só há ausência — e a ausência
                      já está dita pela cor.
                    */
                    <div className="mt-1 h-4 text-[11px] font-semibold tabular-nums">
                      {d.chamadosNoEnvio > 0
                        ? d.chamadosNoEnvio.toLocaleString("pt-BR")
                        : ""}
                    </div>
                  )}
                </button>
              );
            })}
      </div>

      <button
        onClick={() => onDeslocar(7)}
        aria-label="Semana seguinte"
        className="h-10 w-10 shrink-0 rounded-lg border grid place-content-center text-muted-foreground hover:text-foreground hover:bg-muted"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
