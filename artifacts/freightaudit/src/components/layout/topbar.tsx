import { Link, useLocation } from "wouter";
import { Check, ChevronDown, Menu } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AMBIENTES, ambienteDe, descricaoDoAmbiente } from "@/lib/ambiente";
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
 */
export function Topbar({
  menuAberto,
  onToggleSidebar,
}: {
  menuAberto: boolean;
  onToggleSidebar: () => void;
}) {
  const { user, logout, isSubmitting } = useAuth();
  const [location] = useLocation();
  const ambiente = descricaoDoAmbiente(ambienteDe(location));

  return (
    <header className="h-16 bg-topbar text-topbar-foreground flex items-center gap-4 px-4 shrink-0 sticky top-0 z-40">
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
        className="p-2 -ml-1 rounded hover:bg-white/10 transition-colors"
      >
        <Menu className="w-6 h-6" />
      </button>

      {/*
        A marca leva à home **do ambiente aberto**. Quando ela apontava sempre
        para `/`, clicar nela dentro do Fechamento trocava de ambiente sem
        avisar — e "voltar ao início" não pode significar "voltar para outro
        espaço de trabalho".
      */}
      <Link href={ambiente.home} className="shrink-0">
        <Logotipo />
      </Link>

      <SeletorDeAmbiente atual={ambiente.id} />

      <div className="flex-1" />

      {user && (
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-1.5 text-[0.8125rem] font-semibold uppercase tracking-wide px-2 py-2 rounded hover:bg-white/10 transition-colors max-w-[22rem]">
            <span className="truncate">{user.email}</span>
            <ChevronDown className="w-4 h-4 shrink-0" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <div className="font-semibold">{user.name}</div>
              <div className="text-xs text-muted-foreground truncate">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/configuracoes">Configurações</Link>
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
 * O seletor de ambiente — `FreightCheck | Auditoria ▾`.
 *
 * O produto tem dois espaços de trabalho, Auditoria e Fechamento
 * (`lib/ambiente.ts`), e este é o único lugar onde se troca de um para o
 * outro. Ele fica colado à marca, e não no menu lateral, de propósito: o
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
 */
function SeletorDeAmbiente({ atual }: { atual: (typeof AMBIENTES)[number]["id"] }) {
  return (
    <>
      <span aria-hidden className="h-7 w-px bg-white/25 shrink-0" />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Ambiente de trabalho: ${descricaoDoAmbiente(atual).nomeCompleto}`}
          className="flex items-center gap-1.5 px-2 py-1.5 -ml-1 rounded text-[0.9375rem] font-semibold tracking-wide hover:bg-white/10 transition-colors shrink-0"
        >
          {descricaoDoAmbiente(atual).nome}
          <ChevronDown className="w-4 h-4 shrink-0 opacity-80" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Ambiente de trabalho
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {AMBIENTES.map((ambiente) => (
            <DropdownMenuItem key={ambiente.id} asChild>
              <Link href={ambiente.home} className="flex items-start gap-2.5 py-2.5">
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
