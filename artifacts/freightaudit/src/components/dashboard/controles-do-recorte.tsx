import { Link } from "wouter";
import { Bell, ChevronDown, GitCompareArrows, LayoutDashboard, LayoutGrid, Tv } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BOTAO_DE_TROCA } from "@/components/vigencia/seletor-de-vigencia";
import { nomeDaUnidade } from "@/lib/recorte";
import { cn } from "@/lib/utils";
import type { SeriesContext } from "@/components/inicio/types";

/**
 * Os dois controles globais da seção Dashboard — trocar unidade e abrir a
 * Gestão à Vista.
 *
 * Saíram do cabeçalho do Impacto Líquido quando o Impacto Apurado nasceu ao
 * lado dele. Os dois módulos abrem o **mesmo recorte** e oferecem as **mesmas
 * portas**: uma segunda cópia do menu de unidades divergiria da primeira no
 * dia em que alguém acrescentasse uma opção a uma delas — e a divergência
 * apareceria como "o Impacto Apurado não lista a Visão Geral", que ninguém
 * decide de propósito.
 *
 * O que **não** mora aqui é o título, o seletor de vigência e o que cada tela
 * mostra ao lado deles: o cabeçalho é de cada módulo, porque é ele que diz que
 * pergunta a tela responde. Estes dois componentes são as portas, e só isso.
 */

export function SeletorDeUnidade({
  contextos,
  visaoGeral,
  periodoAtual,
  onTrocar,
}: {
  contextos: SeriesContext[];
  visaoGeral: boolean;
  /** A competência aberta, para a Visão Geral abrir na mesma em que se estava. */
  periodoAtual: string | null;
  onTrocar: (mudancas: Record<string, string | null>) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={BOTAO_DE_TROCA}>
        <GitCompareArrows className="w-4 h-4" />
        Trocar unidade
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem
          onSelect={() =>
            onTrocar({
              visaoGeral: "1",
              scopeHash: null,
              canal: null,
              ...(periodoAtual ? { period: periodoAtual } : {}),
            })
          }
          className={cn("flex flex-col items-start gap-0.5", visaoGeral && "font-bold text-brand")}
        >
          <span className="font-semibold">Visão Geral</span>
          <span className="text-xs text-muted-foreground">
            Soma de todas as unidades com dado na competência
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {contextos.length} unidades com vigência importada
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {contextos.map((contexto) => (
          <DropdownMenuItem
            key={`${contexto.scopeHash}|${contexto.channel ?? ""}`}
            onSelect={() =>
              onTrocar({
                scopeHash: contexto.scopeHash,
                canal: contexto.channel,
                period: null,
                visaoGeral: null,
              })
            }
            className="flex flex-col items-start gap-0.5"
          >
            <span className="font-semibold">{nomeDaUnidade(contexto)}</span>
            <span className="text-xs text-muted-foreground">
              {contexto.channel ?? "sem canal no rótulo"} · {contexto.periods}{" "}
              {contexto.periods === 1 ? "vigência" : "vigências"}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * O botão da Gestão à Vista — o único cheio das telas do Dashboard.
 *
 * A régua é a de `pages/inicio.tsx`: a cor sólida da marca fica reservada para
 * a ação que a tela existe para oferecer. Abre um menu porque a Gestão à Vista
 * tem mais de um template — o Financeiro (o telão escuro de sempre), o Alertas
 * (a tabela clara de unidades) e o Radar (a grade unidade × vigência).
 */
export function MenuDaGestaoAVista({ paraGestaoAVista }: { paraGestaoAVista: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-bold text-brand-foreground hover:opacity-90 transition-opacity">
        <Tv className="w-4 h-4" />
        Gestão à Vista
        <ChevronDown className="w-3.5 h-3.5 opacity-80" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Escolha o template
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={comTemplate(paraGestaoAVista, "financeiro")} className="flex items-start gap-2.5">
            <LayoutDashboard className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <span className="block font-semibold">Financeiro</span>
              <span className="block text-xs text-muted-foreground">
                O telão completo: impacto, ranking, pendências e tendência.
              </span>
            </span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={comTemplate(paraGestaoAVista, "alertas")} className="flex items-start gap-2.5">
            <Bell className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <span className="block font-semibold">Alertas</span>
              <span className="block text-xs text-muted-foreground">
                Tabela por unidade: alterações, impacto e a que teve mais mudança.
              </span>
            </span>
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={comTemplate(paraGestaoAVista, "radar")} className="flex items-start gap-2.5">
            <LayoutGrid className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <span className="block font-semibold">Radar</span>
              <span className="block text-xs text-muted-foreground">
                Grade unidade × vigência: quando cada uma mexeu e quanto custou.
              </span>
            </span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Anexa `?template=` (ou acrescenta, se já houver uma consulta) ao link da Gestão à Vista. */
export function comTemplate(
  paraGestaoAVista: string,
  template: "financeiro" | "alertas" | "radar",
): string {
  const [caminho, consulta] = paraGestaoAVista.split("?");
  const parametros = new URLSearchParams(consulta);
  parametros.set("template", template);
  return `${caminho}?${parametros}`;
}
