import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { periodicitySuffix, rotuloDeListaDaVigencia } from "@workspace/comparison/labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatBrlShort } from "@/lib/format";
import {
  useResumoPorVigencia,
  useResumoPorVigenciaGeral,
} from "@/hooks/use-resumo-por-vigencia";
import type { FamiliesView } from "@/components/inicio/types";

/**
 * A casca visual do botão de troca — contorno da marca, fundo do cartão.
 *
 * Estava copiada em cada tela que abre o seletor; aqui ela mora junto do
 * menu que a usa, para que "Trocar vigência" seja o mesmo botão em todas.
 */
export const BOTAO_DE_TROCA =
  "flex items-center gap-2 rounded-lg border border-brand bg-card px-4 py-2.5 " +
  "text-sm font-bold text-brand hover:bg-accent transition-colors";

/**
 * O seletor de vigência do cabeçalho — a vigência à esquerda, o que ela
 * custou e quantas alterações a produziram à direita.
 *
 * As duas colunas são o que faz a lista valer a abertura. Entre seis datas
 * iguais, "714 alterações" e "6 alterações" separam a vigência que mudou o
 * contrato da que corrigiu um cadastro; e entre duas de 400 alterações,
 * `−R$ 82.140` e `−R$ 1.200` separam a que custou dinheiro da que só mexeu em
 * muita linha. Quem abre o menu já está procurando *onde* algo aconteceu, e
 * nem a data nem a contagem sozinhas respondem isso.
 *
 * Os números vêm de `/changes/range` (o mesmo dado da Linha do Tempo) e são
 * opcionais por construção: enquanto não chegam — ou para a vigência mais
 * antiga do histórico, que não tem anterior contra a qual ser comparada —, a
 * linha mostra só a vigência. Nada aqui inventa "0 alterações" nem "R$ 0" para
 * preencher coluna.
 *
 * Estava escrito três vezes (Visão Geral, Linha do Tempo, Dashboard) e nas
 * três com uma diferença: no Dashboard a contagem simplesmente não existia.
 * Um menu que se abre igual em três telas e responde diferente em uma delas é
 * um bug de leitura, não uma variação de estilo — daí este componente.
 */
export function SeletorDeVigencia({
  view,
  consulta,
  onTrocar,
  className,
  rotulo = "Trocar vigência",
}: {
  view: FamiliesView | null;
  consulta: URLSearchParams;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  className?: string;
  rotulo?: string;
}) {
  // O hook vem antes do corte: um `return null` acima dele mudaria a ordem
  // dos hooks entre renderizações quando a vigência ainda está carregando.
  const resumo = useResumoPorVigencia(view, consulta);

  // Com uma vigência só não há troca a oferecer.
  if (!view || view.periods.length <= 1) return null;

  /*
    O rótulo é remontado aqui, e não lido de `periodo.label`, pela mesma razão
    que o seletor da Visão Geral o monta: a lista precisa do mês e do
    desempate **separados** para empilhá-los numa coluna só de meses. O
    servidor entrega o rótulo já colado (`01/08/2026`), que é a forma certa
    para uma frase e a errada para uma lista.

    O denominador é `periodosDisponiveis`, e não as datas de `view.periods` —
    a mesma escolha que o servidor faz em `grouped.ts`, e pela mesma razão: com
    uma janela aplicada, `periods` mostra só o recorte, e agosto pareceria um
    mês de uma entrega só. A vigência perderia o `dia 02` numa tela e o
    manteria na outra. Sem a lista completa (contextos antigos, antes de
    `/contexts` passar a mandá-la), o recorte visível serve de denominador: é
    a melhor régua disponível, e nunca pior do que o rótulo colado.
  */
  const datas = view.periods.map((periodo) => periodo.date);
  const doContexto = view.context.periodosDisponiveis?.length
    ? view.context.periodosDisponiveis
    : datas;

  return (
    <MenuDeVigencias
      rotulo={rotulo}
      className={className}
      cabecalho={`${view.periods.length} vigências no histórico`}
      periodicidade={resumo.periodicidade}
      opcoes={[...datas]
        .sort((a, b) => b.localeCompare(a))
        .map((data) => ({
          valor: data,
          ...rotuloDeListaDaVigencia(data, doContexto),
          ...(resumo.porVigencia.get(data) ?? { alteracoes: null, impacto: null }),
        }))}
      ativa={view.period}
      onEscolher={(data) => onTrocar({ period: data })}
    />
  );
}

/**
 * O mesmo seletor em Visão Geral, onde não existe um `FamiliesView` por trás.
 *
 * Ele lista a união das competências de todas as unidades (`periodosOverview`)
 * e vinha desenhado à mão em quatro telas — Visão Geral, Linha do Tempo,
 * Dashboard e Gestão à Vista —, nas quatro com a data crua do banco
 * (`2026-08-02`) e sem número nenhum. Duas listas de vigência que se abrem
 * do mesmo botão, no mesmo cabeçalho, e escrevem a data de dois jeitos
 * diferentes obrigam quem lê a traduzir entre elas.
 *
 * O cabeçalho também é o mesmo texto do seletor da unidade ("N vigências no
 * histórico"). Ele dizia "N competências disponíveis" — a mesma lista, do
 * mesmo botão, com dois nomes conforme a tela tivesse ou não uma unidade
 * escolhida, o que só obriga quem alterna entre as duas a reparar na
 * diferença antes de concluir que não há nenhuma.
 *
 * Os números aqui são a soma entre unidades, e vêm de
 * `/changes/range/overview` — a mesma leitura que a Linha do Tempo já faz para
 * o ranking de unidades, que traz `changes` e `impact` por competência.
 * **Ela só sai quando o menu abre**: é uma análise do intervalo inteiro por
 * unidade × contexto, cara demais para disparar no carregamento de quatro
 * telas por causa de duas colunas de um menu que pode nunca ser aberto.
 */
export function SeletorDeVigenciaGeral({
  periodos,
  ativa,
  onTrocar,
  className,
  rotulo = "Trocar vigência",
}: {
  /** A união das competências das unidades, mais recente primeiro. */
  periodos: string[];
  ativa: string | null;
  onTrocar: (mudancas: Record<string, string | null>) => void;
  className?: string;
  rotulo?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const resumo = useResumoPorVigenciaGeral(periodos, aberto);

  if (periodos.length <= 1) return null;

  return (
    <MenuDeVigencias
      rotulo={rotulo}
      className={className}
      cabecalho={`${periodos.length} vigências no histórico`}
      periodicidade={resumo.periodicidade}
      /*
        `rotuloDeListaDaVigencia` é a mesma regra que o servidor aplica ao
        montar `view.periods` — mês com uma entrega é `agosto/2026`, mês com
        duas ganha `dia 02` ao lado —, aqui aplicada no navegador porque
        `periodosOverview` chega de `/contexts` como data crua. Uma função só,
        para que os dois seletores nunca chamem a mesma vigência de dois nomes.
      */
      opcoes={periodos.map((data) => ({
        valor: data,
        ...rotuloDeListaDaVigencia(data, periodos),
        ...(resumo.porVigencia.get(data) ?? { alteracoes: null, impacto: null }),
      }))}
      ativa={ativa}
      onEscolher={(data) => onTrocar({ period: data })}
      aberto={aberto}
      onAbrir={setAberto}
    />
  );
}

/**
 * A casca comum dos seletores — o que faz as listas serem uma só.
 *
 * `valor` é opaco de propósito: nos dois seletores acima ele é a data da
 * vigência, e nas Justificativas é o `id` da comparação — lá a mesma data
 * pode ter cinco comparações, uma por série. O que a casca garante é o
 * desenho: o mesmo botão "Trocar vigência", o mesmo cabeçalho e as mesmas
 * colunas à direita, venha de onde vier a lista.
 *
 * A coluna da esquerda é sempre um **mês**. O desempate de uma vigência —
 * `dia 02`, `2ª quinzena` — entra como marca discreta ao lado, e não no lugar
 * do mês, porque a lista é lida na vertical: `setembro/2026` sobre
 * `02/08/2026` sobre `julho/2026` é uma coluna em dois idiomas, e quem
 * procura agosto tem de traduzir o único item escrito em dígitos.
 */
export function MenuDeVigencias({
  rotulo,
  className,
  cabecalho,
  periodicidade,
  opcoes,
  ativa,
  onEscolher,
  aberto,
  onAbrir,
}: {
  rotulo: string;
  className?: string;
  cabecalho: string;
  /**
   * A periodicidade em que a coluna de impacto está escrita — o menu a nomeia
   * no cabeçalho.
   *
   * Sem ela, `−R$ 82.140` numa lista de vigências não diz se é por mês, por
   * ano ou de uma vez; e como a coluna é a mesma periodicidade em todas as
   * linhas (ver `ResumoDasVigencias`), dizê-la uma vez no topo basta e poupa
   * repetir "/mês" onze vezes.
   */
  periodicidade?: string | null;
  opcoes: {
    valor: string;
    /** O mês da vigência — `agosto/2026`. */
    mes: string;
    /** O desempate dentro do mês, quando ele tem mais de uma entrega. */
    marca?: string | null;
    /** A unidade, quando a lista precisa dela para separar linhas de mesma data. */
    detalhe?: string | null;
    alteracoes: number | null;
    /** O líquido da vigência na periodicidade acima — ver `ResumoDaVigencia`. */
    impacto?: number | null;
  }[];
  ativa: string | null;
  onEscolher: (valor: string) => void;
  aberto?: boolean;
  onAbrir?: (aberto: boolean) => void;
}) {
  return (
    <DropdownMenu open={aberto} onOpenChange={onAbrir}>
      <DropdownMenuTrigger className={className}>
        <CalendarDays className="w-4 h-4" />
        {rotulo}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-h-96 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {cabecalho}
          {periodicidade && (
            <span className="block">Impacto líquido em R${periodicitySuffix(periodicidade)}</span>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {opcoes.map((opcao) => (
          <DropdownMenuItem
            key={opcao.valor}
            onSelect={() => onEscolher(opcao.valor)}
            className={cn(
              "flex items-center justify-between gap-3",
              opcao.valor === ativa && "font-bold text-brand",
            )}
          >
            <span>
              {opcao.mes}
              {(opcao.marca || opcao.detalhe) && (
                <span className="font-normal text-muted-foreground">
                  {" · "}
                  {[opcao.marca, opcao.detalhe].filter(Boolean).join(" · ")}
                </span>
              )}
            </span>
            {(opcao.impacto != null || opcao.alteracoes !== null) && (
              <span className="flex flex-col items-end shrink-0 leading-tight">
                {opcao.impacto != null && (
                  <span
                    /*
                      Zero não é ganho. Um saldo em que ganhos e perdas se
                      anularam é um empate, e pintá-lo de verde — que é o que
                      um ternário entre vermelho e verde faz com o zero —
                      afirmaria uma vigência que subiu a remuneração onde ela
                      não mexeu no total. Fica no cinza do texto de apoio, como
                      a contagem embaixo dele.
                    */
                    className={cn(
                      "text-xs font-semibold tabular-nums",
                      opcao.impacto === 0
                        ? "text-muted-foreground"
                        : opcao.impacto < 0
                          ? "text-red-700"
                          : "text-emerald-700",
                    )}
                  >
                    {formatBrlShort(opcao.impacto)}
                  </span>
                )}
                {opcao.alteracoes !== null && (
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">
                    {opcao.alteracoes.toLocaleString("pt-BR")}{" "}
                    {opcao.alteracoes === 1 ? "alteração" : "alterações"}
                  </span>
                )}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
