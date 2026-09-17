import { ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { ResumoDoModulo } from "@workspace/comparison/monitor-custo-fixo";
import { notasDoCustoFixo } from "@workspace/comparison/alteracoes-por-modulo";
import { Superficie } from "@/components/ui/superficie";
import { Button } from "@/components/ui/button";
import { formatBrl, formatNumber } from "@/lib/format";
import {
  corDoValor,
  SUFIXO_DA_PERIODICIDADE,
  rotuloDaPeriodicidade,
} from "@/lib/monitor-custo-fixo";
import { cn } from "@/lib/utils";

/**
 * ALTERAÇÕES POR MÓDULO — o mesmo recorte, quebrado por rubrica.
 *
 * ---------------------------------------------------------------------------
 * As duas ações são duas, e é por isso que elas são duas
 * ---------------------------------------------------------------------------
 * Clicar no cartão **filtra o Monitor** por aquele módulo; o botão ao lado
 * **abre a auditoria** dele. Um clique só, levando direto para a outra tela,
 * tiraria de quem lê a coisa mais útil do consolidado: olhar o IPVA sozinho
 * sem sair do lugar onde os quatro estão.
 *
 * ---------------------------------------------------------------------------
 * Cada módulo mostra as pendências dele, e não a interseção dos quatro
 * ---------------------------------------------------------------------------
 * Alíquota que se moveu sem o montante mexer é achado de Impostos e não existe
 * no FINAME; valor negativo é achado de IPVA; linha coberta pelas parcelas é do
 * FINAME. Um vocabulário comum apagaria os três. O que o cartão mostra é o que
 * o resumo **daquele** módulo publicou — `impactoDeOrigem`, inteiro, como ele
 * veio.
 */
export function AlteracoesPorModulo({
  resumos,
  moduloAberto,
  onFiltrar,
  enderecoDaAuditoria,
}: {
  resumos: readonly ResumoDoModulo[];
  moduloAberto: string | null;
  onFiltrar: (modulo: ResumoDoModulo["modulo"]) => void;
  enderecoDaAuditoria: (resumo: ResumoDoModulo) => string;
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Alterações por módulo</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {resumos.map((r) => {
          const aberto = moduloAberto === r.modulo;
          return (
            <Superficie
              key={r.modulo}
              className={cn(
                "flex flex-col gap-2 px-4 py-3",
                aberto && "border-brand/40 ring-1 ring-brand/15",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  type="button"
                  onClick={() => onFiltrar(r.modulo)}
                  aria-pressed={aberto}
                  className="rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="text-sm font-semibold">{r.rotulo}</span>
                  <span className="block text-xs text-muted-foreground">
                    {aberto ? "Filtrando por este módulo" : "Filtrar o Monitor por este módulo"}
                  </span>
                </button>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link href={enderecoDaAuditoria(r)}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only sm:ml-1 sm:text-xs">
                      Abrir auditoria
                    </span>
                  </Link>
                </Button>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <Par rotulo="Alterações" valor={formatNumber(r.alteracoes, 0)} />
                <Par rotulo="Entidades" valor={formatNumber(r.entidades.length, 0)} />
                <Par rotulo="Ganhos" valor={formatNumber(r.ganhos, 0)} />
                <Par rotulo="Perdas" valor={formatNumber(r.perdas, 0)} />
                <Par
                  rotulo="Sem valoração"
                  valor={formatNumber(r.porSituacao.SEM_VALORACAO, 0)}
                />
                <Par
                  rotulo="Fora do total"
                  valor={formatNumber(r.porSituacao.FORA_DO_TOTAL, 0)}
                />
              </dl>

              <ImpactoDoModulo resumo={r} />
              <PendenciasDoModulo resumo={r} />
            </Superficie>
          );
        })}
      </div>
    </section>
  );
}

function Par({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-1">
      <dt className="text-muted-foreground">{rotulo}</dt>
      <dd className="font-mono tabular-nums">{valor}</dd>
    </div>
  );
}

/** O impacto do módulo, uma linha por periodicidade. Nunca um total só. */
function ImpactoDoModulo({ resumo }: { resumo: ResumoDoModulo }) {
  const baldes = Object.entries(resumo.porPeriodicidade);
  if (baldes.length === 0) {
    return (
      <p className="border-t pt-2 text-[0.7rem] text-muted-foreground">
        Nenhuma alteração deste módulo virou dinheiro neste recorte.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5 border-t pt-2">
      {baldes.map(([periodicidade, valor]) => (
        <div key={periodicidade} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {rotuloDaPeriodicidade(periodicidade)}
          </span>
          <span
            className={cn(
              "font-mono font-semibold tabular-nums",
              /* A régua é o sinal, e é a mesma nos cinco módulos: positivo é
                 ganho e sai em verde, negativo é perda e sai em vermelho. */
              corDoValor(valor),
            )}
          >
            {formatBrl(valor)}
            {SUFIXO_DA_PERIODICIDADE[periodicidade] ?? ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * As situações especiais que **só aquele módulo** conhece.
 *
 * Elas vêm de `impactoDeOrigem`, que é o resumo nativo do módulo. Quem decide
 * quais pendências de cada rubrica merecem aparecer é `notasDoCustoFixo`, no
 * domínio: as mesmas frases saem aqui e no catálogo da Visão executiva, e duas
 * réguas divergiriam no dia em que uma rubrica ganhasse um indicador novo — a
 * tela não atualizada passaria a esconder um achado sem nada quebrar.
 *
 * O número é formatado aqui, e é essa a divisão: a frase é do domínio, o milhar
 * em português é da tela.
 */
function PendenciasDoModulo({ resumo }: { resumo: ResumoDoModulo }) {
  const avisos = notasDoCustoFixo(resumo.impactoDeOrigem);
  if (avisos.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 border-t pt-2 text-[0.7rem] text-muted-foreground">
      {avisos.map((a) => (
        <li key={a.frase}>
          {formatNumber(a.quantidade, 0)} {a.frase}
        </li>
      ))}
    </ul>
  );
}
