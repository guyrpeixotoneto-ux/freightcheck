import { Link } from "wouter";
import { Check, ChevronDown, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AMBIENTES, descricaoDoAmbiente } from "@/lib/ambiente";
import { ambientesPermitidos, usePermissoes } from "@/lib/permissoes";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Logotipo } from "./logotipo";

/**
 * A faixa marinho do topo.
 *
 * É o primeiro elemento que o usuário reconhece, e por isso é o primeiro que
 * este produto passou a ter: o mesmo lugar para o menu, a mesma marca à
 * esquerda, o mesmo e-mail com a seta.
 *
 * **Os três indicadores saíram daqui.** A nuvem contava importações em
 * andamento, o sino contava atributos monetários sem semântica confirmada, e o
 * filtro levava à seleção de contexto — os três agora estão no menu, ao lado do
 * item que resolve cada um, e a unidade aberta está escrita no topo dele. O
 * mesmo número em dois lugares da mesma tela não é reforço: é a pergunta "estes
 * seis são os mesmos seis?" toda vez que os dois entram no campo de visão, e uma
 * defasagem de cache entre eles bastaria para a resposta ser não.
 *
 * O que fica aqui é o que não tem lugar melhor: a marca, o botão que recolhe a
 * lateral e quem está logado.
 *
 * **No celular a faixa perde dois desses três.** O hambúrguer some porque não
 * há lateral para recolher — quem navega ali é a barra da borda de baixo
 * (`barra-mobile.tsx`) —, e o e-mail vira as iniciais, porque escrito por
 * extenso ele empurrava o seletor de ambiente para fora da tela. O par
 * Configurações/Sair continua a um toque, no pé da folha "Mais". O que sobra
 * na faixa é o que responde onde se está: a marca e o ambiente aberto.
 */
export function Topbar({
  menuAberto,
  onToggleSidebar,
}: {
  menuAberto: boolean;
  onToggleSidebar: () => void;
}) {
  const { user, logout, isSubmitting } = useAuth();
  const ambiente = descricaoDoAmbiente(useAmbiente());

  return (
    <header className="h-16 bg-topbar text-topbar-foreground flex items-center gap-2 md:gap-4 px-3 md:px-4 shrink-0 sticky top-0 z-40">
      <button
        type="button"
        onClick={onToggleSidebar}
        /*
          O rótulo diz o que o clique faz, e não o que o botão é. "Abrir ou
          fechar o menu" obriga quem ouve a descobrir em qual dos dois estados
          está antes de decidir se quer clicar.
        */
        aria-label={menuAberto ? "Recolher o menu" : "Expandir o menu"}
        aria-expanded={menuAberto}
        className="hidden md:block p-2 -ml-1 rounded hover:bg-white/10 transition-colors"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/*
        A marca leva à home **do ambiente aberto**. Quando ela apontava sempre
        para `/`, clicar nela dentro do Fechamento trocava de ambiente sem
        avisar — e "voltar ao início" não pode significar "voltar para outro
        espaço de trabalho".
      */}
      {/*
        `~` diz ao wouter que o endereço é absoluto, e não relativo ao roteador
        aberto. Dentro de uma auditoria prefixada — `/auditoria-rota`, por
        exemplo — os links são resolvidos sobre a base do ambiente (`App.tsx`),
        e um `home` já absoluto viraria `/auditoria-rota/auditoria-rota/...`. É
        o mesmo motivo do `~` no seletor, logo abaixo, e na Administração
        (`nav-administracao.ts`).
      */}
      <Link href={`~${ambiente.home}`} className="shrink-0 min-w-0">
        <Logotipo soSimboloNoCelular />
      </Link>

      <SeletorDeAmbiente atual={ambiente.id} />

      <div className="flex-1" />

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-wide px-2 py-2 rounded hover:bg-white/10 transition-colors max-w-[22rem]">
            {/*
              O e-mail por extenso não cabe num telefone: ele ocupava a faixa
              inteira e cortava o seletor de ambiente ao meio. As iniciais dizem
              a mesma coisa — quem está logado — no espaço que há.
            */}
            <span className="hidden md:block truncate">{user.email}</span>
            <span
              aria-hidden
              className="md:hidden w-8 h-8 rounded-full bg-white/15 text-xs font-bold flex items-center justify-center shrink-0"
            >
              {iniciaisDe(user.name)}
            </span>
            <ChevronDown className="w-4 h-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="font-semibold">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="~/configuracoes">Configurações</Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isSubmitting}
              onSelect={() => {
                void logout();
              }}
            >
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </header>
  );
}

/**
 * O seletor de ambiente — `FreightCheck | Auditoria Empurrada ▾`.
 *
 * O produto tem oito espaços de trabalho — quatro auditorias e quatro
 * fechamentos, uma de cada operação (`lib/ambiente.ts`) —, e este é o único
 * lugar onde se troca de um para o outro. Ele fica colado à marca, e não no
 * menu lateral, de propósito: o
 * lateral lista as telas **de um** ambiente, e o que está acima dele decide
 * **qual**. Pôr a troca dentro da lista rebaixaria um espaço de trabalho a
 * mais um item de menu.
 *
 * O nome do ambiente aberto está sempre escrito no botão — é ele, junto com o
 * menu lateral trocado, que diz onde a pessoa está. Trocar navega para a home
 * do outro ambiente: as telas de um não têm equivalente no outro, então
 * "manter a tela e trocar o contexto" não existe como operação.
 *
 * Selecionar o ambiente já aberto só fecha o menu — o `Link` para a própria
 * home é navegação inofensiva, não um estado a proteger.
 *
 * **A lista é a dos ambientes que a pessoa alcança**, e não os oito. Quem
 * trabalha só na Empurrada não tem o que fazer no Fechamento AS, e oferecer a
 * troca para depois recusá-la na chegada é oferecer trabalho perdido — a mesma
 * razão pela qual a própria conta fica fora da lista de Permissões. Quem
 * recusa de verdade continua sendo a casca, na chegada, e o servidor, na
 * escrita: esconder aqui é conveniência.
 *
 * O ambiente aberto entra na lista mesmo restrito, e é de propósito: ele está
 * escrito no botão, e uma lista que não contém o que o botão diz é uma lista
 * que parece quebrada. Quem chegou a um ambiente que não alcança já está vendo
 * a tela que explica isso.
 */
function SeletorDeAmbiente({ atual }: { atual: (typeof AMBIENTES)[number]["id"] }) {
  const { permissoes } = usePermissoes();
  const alcancaveis = ambientesPermitidos(permissoes);
  const lista = alcancaveis.some((a) => a.id === atual)
    ? alcancaveis
    : AMBIENTES.filter((a) => alcancaveis.includes(a) || a.id === atual);

  return (
    <>
      <span aria-hidden className="h-7 w-px bg-white/25 shrink-0" />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Ambiente de trabalho: ${descricaoDoAmbiente(atual).nomeCompleto}`}
          className="flex items-center gap-1.5 px-2 py-1.5 -ml-1 rounded text-sm md:text-[0.9375rem] font-semibold tracking-wide hover:bg-white/10 transition-colors min-w-0"
        >
          {descricaoDoAmbiente(atual).nome}
          <ChevronDown className="w-4 h-4 shrink-0 opacity-80" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Ambiente de trabalho
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {lista.map((ambiente) => (
            <DropdownMenuItem key={ambiente.id} asChild>
              <Link href={`~${ambiente.home}`} className="flex items-start gap-2.5 py-2.5">
                <Check
                  className={cn(
                    "w-4 h-4 mt-0.5 shrink-0 text-brand",
                    ambiente.id !== atual && "invisible",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{ambiente.nomeCompleto}</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    {ambiente.descricao}
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/** `Guy Peixoto` → `GP`; nome de uma palavra só rende uma letra. */
function iniciaisDe(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primeira = partes[0][0];
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : "";
  return `${primeira}${ultima}`.toUpperCase();
}
