import { ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { ResumoDoModuloDeEquipe } from "@workspace/comparison/monitor-equipe";
import { ROTULO_DO_QUADRO } from "@workspace/comparison/monitor-equipe";
import { notasDaEquipe } from "@workspace/comparison/alteracoes-por-modulo";
import { Superficie } from "@/components/ui/superficie";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { escreverModulo } from "@/lib/monitor-equipe";
import { cn } from "@/lib/utils";

/**
 * ALTERAÇÕES POR MÓDULO — o mesmo recorte, quebrado por assunto.
 *
 * ---------------------------------------------------------------------------
 * As duas ações são duas, e é por isso que elas são duas
 * ---------------------------------------------------------------------------
 * Clicar no cartão **filtra o Monitor** por aquele assunto; o botão ao lado
 * **abre a tela** dele. Um clique só, levando direto para a outra tela, tiraria
 * de quem lê a coisa mais útil do consolidado: olhar o vale-transporte sozinho
 * sem sair do lugar onde os dezesseis estão.
 *
 * ---------------------------------------------------------------------------
 * O cartão diz em que quadro o assunto se moveu
 * ---------------------------------------------------------------------------
 * Porque um módulo pode existir nos dois e mudar num só — e essa é a leitura
 * que a seção Equipe existe para dar. O export administrativo traz benefício
 * numa coluna só e o operacional o decompõe em nove, de modo que vários
 * assuntos só têm coluna num dos lados: dizer "3 alterações" sem dizer onde
 * mandaria quem lê procurar no quadro errado.
 *
 * E não há número em reais em cartão nenhum, pela razão que o consolidado
 * escreve por extenso: no QLP, somar dinheiro é adivinhar.
 */
export function AlteracoesPorModuloDeEquipe({
  resumos,
  moduloAberto,
  onFiltrar,
  enderecoDoModulo,
}: {
  resumos: readonly ResumoDoModuloDeEquipe[];
  moduloAberto: string | null;
  onFiltrar: (modulo: string) => void;
  enderecoDoModulo: (resumo: ResumoDoModuloDeEquipe) => string;
}) {
  if (resumos.length === 0) return null;

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
                  <span className="text-sm font-semibold">{escreverModulo(r.modulo)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {aberto ? "Filtrando por este módulo" : "Filtrar o Monitor por este módulo"}
                  </span>
                </button>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link href={enderecoDoModulo(r)}>
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only sm:not-sr-only sm:ml-1 sm:text-xs">Abrir</span>
                  </Link>
                </Button>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <Par rotulo="Alterações" valor={formatNumber(r.alteracoes, 0)} />
                <Par rotulo="Cargos" valor={formatNumber(r.cargos.length, 0)} />
                <Par rotulo="Valores alterados" valor={formatNumber(r.variaveisAlteradas, 0)} />
                <Par
                  rotulo="Sem valoração"
                  valor={formatNumber(r.porSituacao.SEM_VALORACAO, 0)}
                />
                <Par rotulo="Efetivo" valor={formatNumber(r.porSituacao.EFETIVO, 0)} />
                <Par
                  rotulo="Fora da soma"
                  valor={formatNumber(r.porSituacao.FORA_DA_SOMA, 0)}
                />
              </dl>

              <QuadrosDoModulo resumo={r} />
              <MovimentosDoModulo resumo={r} />
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

/**
 * Em que quadro este assunto se moveu, e quanto em cada um.
 *
 * Com uma população só na leitura — que é como a tela abre, por aba —, a quebra
 * repetiria o número que o cartão já publica acima, sob o nome que a aba já
 * disse. Aí ela some.
 */
function QuadrosDoModulo({ resumo }: { resumo: ResumoDoModuloDeEquipe }) {
  if (resumo.porQuadro.length <= 1) return null;
  return (
    <div className="flex flex-col gap-0.5 border-t pt-2">
      {resumo.porQuadro.map(({ quadro, alteracoes }) => (
        <div key={quadro} className="flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted-foreground">
            {ROTULO_DO_QUADRO[quadro].replace("QLP ", "")}
          </span>
          <span className="font-mono tabular-nums">{formatNumber(alteracoes, 0)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * O que **só este módulo** viu mexer — e nada quando ele não viu nada.
 *
 * A lista some inteira quando não há movimento a relatar, em vez de escrever
 * "0 cargos entraram". Zero é uma medição, e escrevê-la em quatro linhas por
 * cartão faria o cartão inteiro parecer um formulário em branco.
 *
 * Quem decide o que é movimento é `notasDaEquipe`, no domínio — as mesmas
 * frases saem aqui e no catálogo da Visão executiva, pela razão que
 * `notasDoCustoFixo` dá do outro lado. O milhar em português continua sendo da
 * tela.
 */
function MovimentosDoModulo({ resumo }: { resumo: ResumoDoModuloDeEquipe }) {
  const avisos = notasDaEquipe(resumo);
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
