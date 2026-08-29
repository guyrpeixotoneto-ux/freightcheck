import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { rotuloCurtoDaVigencia } from "@workspace/comparison/labels";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  useAlteracoesPorVigencia,
  useAlteracoesPorVigenciaGeral,
} from "@/hooks/use-alteracoes-por-vigencia";
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
 * O seletor de vigência do cabeçalho — data à esquerda, quantas alterações
 * aquela vigência trouxe à direita.
 *
 * A contagem é o que faz a lista valer a abertura: entre seis datas iguais,
 * "714 alterações" e "6 alterações" são a diferença entre a vigência que
 * mudou o contrato e a que corrigiu um cadastro. Quem abre o menu já está
 * procurando *onde* algo aconteceu, e a data sozinha não responde isso.
 *
 * A contagem vem de `/changes/range` (o mesmo dado da Linha do Tempo) e é
 * opcional por construção: enquanto ela não chega — ou para a vigência mais
 * antiga do histórico, que não tem anterior contra a qual ser comparada —, a
 * linha mostra só a data. Nada aqui inventa "0 alterações" para preencher a
 * coluna.
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
  const alteracoesPorVigencia = useAlteracoesPorVigencia(view, consulta);

  // Com uma vigência só não há troca a oferecer.
  if (!view || view.periods.length <= 1) return null;

  return (
    <MenuDeVigencias
      rotulo={rotulo}
      className={className}
      cabecalho={`${view.periods.length} vigências no histórico`}
      opcoes={[...view.periods]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((periodo) => ({
          valor: periodo.date,
          rotulo: periodo.label,
          alteracoes: alteracoesPorVigencia.get(periodo.date) ?? null,
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
 * (`2026-08-02`) e sem contagem nenhuma. Duas listas de vigência que se abrem
 * do mesmo botão, no mesmo cabeçalho, e escrevem a data de dois jeitos
 * diferentes obrigam quem lê a traduzir entre elas; e sem a contagem a lista
 * só oferece seis datas, sem dizer o que houve em cada uma.
 *
 * O cabeçalho também é o mesmo texto do seletor da unidade ("N vigências no
 * histórico"). Ele dizia "N competências disponíveis" — a mesma lista, do
 * mesmo botão, com dois nomes conforme a tela tivesse ou não uma unidade
 * escolhida, o que só obriga quem alterna entre as duas a reparar na
 * diferença antes de concluir que não há nenhuma.
 *
 * A contagem aqui é a soma entre unidades, e vem de `/changes/range/overview`
 * — a mesma leitura que a Linha do Tempo já faz para o ranking de unidades,
 * agora também com `changes` por competência. **Ela só sai quando o menu
 * abre**: é uma análise do intervalo inteiro por unidade × contexto, cara
 * demais para disparar no carregamento de quatro telas por causa de uma
 * coluna de um menu que pode nunca ser aberto.
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
  const alteracoesPorVigencia = useAlteracoesPorVigenciaGeral(periodos, aberto);

  if (periodos.length <= 1) return null;

  return (
    <MenuDeVigencias
      rotulo={rotulo}
      className={className}
      cabecalho={`${periodos.length} vigências no histórico`}
      /*
        `rotuloCurtoDaVigencia` é a mesma regra que o servidor aplica ao montar
        `view.periods` — mês com uma entrega vira `agosto/2026`, mês com duas
        vira `02/08/2026` —, aqui aplicada no navegador porque
        `periodosOverview` chega de `/contexts` como data crua. Uma função só,
        para que os dois seletores nunca chamem a mesma vigência de dois nomes.
      */
      opcoes={periodos.map((data) => ({
        valor: data,
        rotulo: rotuloCurtoDaVigencia(data, periodos),
        alteracoes: alteracoesPorVigencia.get(data) ?? null,
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
 * desenho: o mesmo botão "Trocar vigência", o mesmo cabeçalho e a mesma
 * contagem à direita, venha de onde vier a lista.
 */
export function MenuDeVigencias({
  rotulo,
  className,
  cabecalho,
  opcoes,
  ativa,
  onEscolher,
  aberto,
  onAbrir,
}: {
  rotulo: string;
  className?: string;
  cabecalho: string;
  opcoes: {
    valor: string;
    rotulo: string;
    /** A unidade, quando a lista precisa dela para separar linhas de mesma data. */
    detalhe?: string | null;
    alteracoes: number | null;
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
      <DropdownMenuContent align="end" className="w-80 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {cabecalho}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {opcoes.map((opcao) => (
          <DropdownMenuItem
            key={opcao.valor}
            onSelect={() => onEscolher(opcao.valor)}
            className={cn(
              "flex items-center justify-between gap-2",
              opcao.valor === ativa && "font-bold text-brand",
            )}
          >
            <span>
              {opcao.rotulo}
              {opcao.detalhe && (
                <span className="font-normal text-muted-foreground"> · {opcao.detalhe}</span>
              )}
            </span>
            {opcao.alteracoes !== null && (
              <span className="text-xs font-normal text-muted-foreground tabular-nums">
                {opcao.alteracoes.toLocaleString("pt-BR")}{" "}
                {opcao.alteracoes === 1 ? "alteração" : "alterações"}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
