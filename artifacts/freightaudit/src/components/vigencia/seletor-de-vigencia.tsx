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
          data: periodo.date,
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
      cabecalho={`${periodos.length} competências disponíveis`}
      opcoes={periodos.map((data) => ({
        data,
        rotulo: rotuloDaCompetencia(data, periodos),
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
 * `2026-08-02` como a tela chama a vigência.
 *
 * É a mesma regra que o servidor aplica ao montar `view.periods` — mês com uma
 * entrega vira `agosto/2026`, mês com duas vira `02/08/2026` —, aqui aplicada
 * no navegador porque `periodosOverview` chega de `/contexts` como data crua.
 * Uma função só (`rotuloCurtoDaVigencia`, em `@workspace/comparison`) para que
 * os dois seletores nunca chamem a mesma vigência de dois nomes.
 */
export function rotuloDaCompetencia(data: string, doConjunto: readonly string[]): string {
  return rotuloCurtoDaVigencia(data, doConjunto);
}

/** A casca comum dos dois seletores — o que faz as duas listas serem uma só. */
function MenuDeVigencias({
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
  opcoes: { data: string; rotulo: string; alteracoes: number | null }[];
  ativa: string | null;
  onEscolher: (data: string) => void;
  aberto?: boolean;
  onAbrir?: (aberto: boolean) => void;
}) {
  return (
    <DropdownMenu open={aberto} onOpenChange={onAbrir}>
      <DropdownMenuTrigger className={className}>
        <CalendarDays className="w-4 h-4" />
        {rotulo}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {cabecalho}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {opcoes.map((opcao) => (
          <DropdownMenuItem
            key={opcao.data}
            onSelect={() => onEscolher(opcao.data)}
            className={cn(
              "flex items-center justify-between gap-2",
              opcao.data === ativa && "font-bold text-brand",
            )}
          >
            <span>{opcao.rotulo}</span>
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
