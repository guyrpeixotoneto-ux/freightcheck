import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  ChevronRight,
  LayoutGrid,
  LogOut,
  MapPin,
  Settings,
} from "lucide-react";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import {
  BASES_DE_FECHAMENTO,
  descricaoDoAmbiente,
  ehFechamento,
  type Ambiente,
} from "@/lib/ambiente";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { useAuth } from "@/lib/auth";
import { unidadeDe, useContextosDaCasca } from "@/lib/contextos";
import { enderecoDoAssistente } from "@/lib/entrada-do-assistente";
import { enderecoDoMenu } from "@/lib/navegacao-do-escopo";
import { cn } from "@/lib/utils";
import {
  useAlteracoesDaVigencia,
  useCuradoriaPendente,
  useImportacoesEmAndamento,
} from "./contadores";
import type { NavGroup, NavItem } from "./nav";
import { navGroupsAuditoria } from "./nav-auditoria";
import { navGroupsFechamento } from "./nav-fechamento";
import { filtrarGrupos, usePermissoes } from "@/lib/permissoes";
import { barraMobile, type AtalhoMobile } from "./nav-mobile";
import { detalheDe, estaAtivo } from "./sidebar";

/**
 * O menu do celular: uma barra na borda de baixo e a folha "Mais".
 *
 * **Por que não é a lateral.** A lateral do computador é uma coluna fixa de
 * 19rem ao lado do conteúdo — no telefone ela não tem "ao lado": ou toma a tela
 * inteira, ou vira uma faixa de cinquenta ícones sem nome ocupando um quarto da
 * largura, que foi o que a versão anterior fazia (ver as capturas que
 * originaram este arquivo: a faixa de ícones comia a esquerda e o conteúdo lia
 * seis palavras por linha). Aqui a lateral simplesmente não existe: ela é
 * `hidden md:flex`, e quem navega é esta barra.
 *
 * **O desenho.** Cinco slots na borda inferior, que é onde o polegar descansa:
 * dois destinos, o gesto do ambiente num botão redondo elevado, mais um destino
 * e a porta do resto. É a forma que o aplicativo de referência usa, e ela é
 * padrão de telefone há uma década — a mão já sabe onde procurar antes de a
 * tela carregar.
 *
 * **A folha "Mais" é o menu inteiro, e não um resumo dele.** Ela traz as mesmas
 * nove seções da lateral (cinco, no Fechamento), na mesma ordem, com os mesmos
 * itens e os mesmos contadores — nenhuma tela do produto fica inalcançável no
 * telefone. O que muda é a forma de ler: cada seção é um cartão com ícone
 * colorido, título e a frase que diz o que se faz nela (`NavGroup.descricao`),
 * e a lista abre sob toque. Fechada, a folha inteira cabe num polegar de
 * rolagem; aberta uma seção, lê-se só o que se procurava.
 *
 * **Três regras herdadas da lateral, e mantidas aqui de propósito:**
 *
 * 1. Contador zero não aparece — nem no cartão da seção, nem no item.
 * 2. A seção que contém a tela aberta fica acesa mesmo fechada: fechar esconde
 *    a lista, nunca a informação de onde se está.
 * 3. Nenhum endereço novo. Todo `href` daqui é um `href` da lateral, e
 *    `sidebar.test.ts` confere os dois contra o roteador.
 */
export function BarraMobile() {
  const [location] = useLocation();
  const busca = useSearch();
  const [maisAberto, setMaisAberto] = useState(false);

  const ambiente = useAmbiente();
  const { esquerda, centro, direita } = barraMobile(ambiente);

  const alteracoes = useAlteracoesDaVigencia();
  const importacoes = useImportacoesEmAndamento();
  const curadoria = useCuradoriaPendente();
  const contadores = { alteracoes, importacoes, curadoria };

  const paraOAssistente = enderecoDoAssistente(busca);
  /*
    O mesmo endereço da lateral, item por item: o caminho nu chega sem unidade,
    e quem estava em CAMAÇARI e tocava numa tela vizinha chegava lá em
    PERNAMBUCO — o primeiro contexto do banco. Ver `enderecoDoMenu`, em
    `lib/navegacao-do-escopo.ts`.
  */
  const enderecoDe = (item: NavItem) =>
    item.href === "/assistente"
      ? paraOAssistente
      : enderecoDoMenu(item.href, location, busca);

  /*
    A folha fecha ao navegar. Ela não fecha sozinha: quem toca num item vai para
    outra tela e a folha continuaria por cima dela, tapando exatamente o que a
    pessoa acabou de pedir. Fechar no `onClick` de cada link resolveria o caso
    comum e deixaria de fora o botão "voltar" do telefone, que também muda a
    rota — daí a escuta ser sobre a rota, e não sobre o toque.
  */
  useEffect(() => {
    setMaisAberto(false);
  }, [location]);

  return (
    <>
      {/*
        A barra é `fixed`, e o `main` reserva a altura dela (ver `layout.tsx`):
        conteúdo que rola por baixo de uma barra opaca perde a última linha, e a
        última linha de uma tabela é onde costuma estar o total.

        `pb-[env(safe-area-inset-bottom)]` é o que impede a barra de nascer
        embaixo da alça do iPhone — sem isso, o slot do meio fica a um
        milímetro do gesto de voltar à tela inicial.
      */}
      <nav
        aria-label="Navegação principal"
        className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 items-end h-16 px-1">
          {esquerda.map((atalho) => (
            <SlotDaBarra
              key={atalho.href}
              atalho={atalho}
              href={enderecoDe(atalho)}
              ativo={estaAtivo(location, atalho.href)}
              contagem={atalho.contador ? contadores[atalho.contador] : 0}
            />
          ))}

          <SlotDoCentro
            atalho={centro}
            href={enderecoDe(centro)}
            ativo={estaAtivo(location, centro.href)}
          />

          {direita.map((atalho) => (
            <SlotDaBarra
              key={atalho.href}
              atalho={atalho}
              href={enderecoDe(atalho)}
              ativo={estaAtivo(location, atalho.href)}
              contagem={atalho.contador ? contadores[atalho.contador] : 0}
            />
          ))}

          {/*
            "Mais" é botão, e não link: o que ele abre é uma folha sobre a tela
            atual, e não uma tela. Um link aqui poria um endereço no histórico
            para um estado que o endereço não descreve — e o "voltar" do
            telefone passaria a alternar a folha em vez de voltar de tela.
          */}
          <button
            type="button"
            onClick={() => setMaisAberto(true)}
            aria-expanded={maisAberto}
            aria-haspopup="dialog"
            className={cn(
              "flex flex-col items-center justify-end gap-1 h-full pb-2 rounded-lg transition-colors",
              maisAberto ? "text-brand" : "text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex items-center justify-center w-11 h-7 rounded-lg transition-colors",
                maisAberto && "bg-sidebar-accent",
              )}
            >
              <LayoutGrid className="w-[1.375rem] h-[1.375rem]" />
            </span>
            <span className="text-[0.625rem] font-semibold leading-none">Mais</span>
          </button>
        </div>
      </nav>

      <FolhaDoMais
        aberto={maisAberto}
        onFechar={() => setMaisAberto(false)}
        location={location}
        contadores={contadores}
        enderecoDoItem={enderecoDe}
      />
    </>
  );
}

type Contadores = Record<NonNullable<NavItem["contador"]>, number>;

/**
 * Um dos quatro slots comuns.
 *
 * O ícone aceso mora dentro de uma pastilha azul-clara, e não sobre um traço ou
 * um ponto: no telefone o item ativo precisa se ler de relance, com o dedo por
 * cima de metade da barra. É a mesma cor (`--sidebar-accent`) que acende o item
 * ativo da lateral — o produto tem um jeito só de dizer "você está aqui".
 */
function SlotDaBarra({
  atalho,
  href,
  ativo,
  contagem,
}: {
  atalho: AtalhoMobile;
  href: string;
  ativo: boolean;
  contagem: number;
}) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      aria-label={
        contagem > 0 ? `${atalho.descricao ?? atalho.label}: ${contagem}` : atalho.descricao ?? atalho.label
      }
      className={cn(
        "flex flex-col items-center justify-end gap-1 h-full pb-2 rounded-lg transition-colors",
        ativo ? "text-brand" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "relative flex items-center justify-center w-11 h-7 rounded-lg transition-colors",
          ativo && "bg-sidebar-accent",
        )}
      >
        <atalho.icon className="w-[1.375rem] h-[1.375rem]" />
        {contagem > 0 && (
          <span
            className={cn(
              "absolute -top-1 right-1 min-w-4 h-4 px-1 rounded-full text-[0.5625rem] font-bold flex items-center justify-center tabular-nums",
              atalho.contador === "alteracoes"
                ? "bg-brand text-brand-foreground"
                : "bg-warning text-warning-foreground",
            )}
          >
            {contagem > 99 ? "99+" : contagem}
          </span>
        )}
      </span>
      <span className="text-[0.625rem] font-semibold leading-none truncate max-w-full px-0.5">
        {atalho.label}
      </span>
    </Link>
  );
}

/**
 * O botão redondo do meio — o gesto do ambiente.
 *
 * Ele sobe acima da barra porque é o único slot que não é "mais uma tela": na
 * Auditoria é perguntar ao assistente, no Fechamento é apurar a competência. O
 * halo é discreto de propósito — marca o alvo do polegar sem virar um segundo
 * foco de leitura em cima de uma tabela.
 */
function SlotDoCentro({
  atalho,
  href,
  ativo,
}: {
  atalho: AtalhoMobile;
  href: string;
  ativo: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-end h-full pb-2">
      <Link
        href={href}
        aria-current={ativo ? "page" : undefined}
        aria-label={atalho.descricao ?? atalho.label}
        className={cn(
          "-mt-6 w-14 h-14 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95",
          "bg-brand text-brand-foreground shadow-lg shadow-brand/40 ring-4 ring-sidebar",
          ativo && "ring-sidebar-accent",
        )}
      >
        <atalho.icon className="w-6 h-6" />
      </Link>
      <span className="text-[0.625rem] font-semibold leading-none text-muted-foreground mt-1 truncate max-w-full px-0.5">
        {atalho.label}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A folha "Mais"
// ---------------------------------------------------------------------------

/**
 * O menu inteiro, numa folha que sobe.
 *
 * Três blocos, na mesma ordem da lateral: **onde estou** (a unidade aberta ou o
 * alcance do fechamento), **para onde vou** (as seções, em cartões) e **quem
 * sou** (o rodapé com Configurações e Sair). Quem aprendeu a lateral encontra
 * aqui a mesma coisa nos mesmos lugares — a folha é a lateral deitada, não
 * outro menu.
 *
 * A altura é 88% da tela, e não 100%: a faixa de tela que sobra em cima diz que
 * há uma tela por baixo e que arrastar a folha para baixo a devolve. Uma folha
 * de tela cheia se lê como navegação, e navegação teria de aparecer no
 * endereço.
 */
function FolhaDoMais({
  aberto,
  onFechar,
  location,
  contadores,
  enderecoDoItem,
}: {
  aberto: boolean;
  onFechar: () => void;
  location: string;
  contadores: Contadores;
  enderecoDoItem: (item: NavItem) => string;
}) {
  const ambiente = useAmbiente();
  /* O mesmo filtro da lateral, pela mesma razão — ver `sidebar.tsx`. */
  const { permissoes } = usePermissoes();
  const grupos = filtrarGrupos(
    ehFechamento(ambiente)
      ? navGroupsFechamento(BASES_DE_FECHAMENTO[ambiente], descricaoDoAmbiente(ambiente).nome)
      : navGroupsAuditoria(ambiente),
    permissoes,
  );

  return (
    <Drawer open={aberto} onOpenChange={(estado) => !estado && onFechar()}>
      <DrawerContent className="md:hidden max-h-[88dvh]">
        <div className="px-4 pt-2 pb-1">
          <DrawerTitle className="text-2xl font-extrabold tracking-tight">Mais</DrawerTitle>
        </div>

        <div className="overflow-y-auto px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-2.5">
          <ContextoNaFolha ambiente={ambiente} />

          {grupos.map((grupo) => (
            <CartaoDaSecao
              key={grupo.titulo}
              grupo={grupo}
              location={location}
              contadores={contadores}
              enderecoDoItem={enderecoDoItem}
            />
          ))}

          <RodapeDaFolha />
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * A primeira linha da folha: onde a pessoa está.
 *
 * Na Auditoria é a unidade aberta, porque todo número de toda tela depende dela
 * — e no telefone, onde o cabeçalho da página costuma estar fora do campo de
 * visão, é ainda mais fácil esquecer qual é. No Fechamento não há unidade
 * aberta: a competência é de várias, e afirmar uma seria afirmar um recorte que
 * nenhuma tela honra (a mesma decisão de `AlcanceDoFechamento`, na lateral).
 *
 * Falha de rede não vira frase sobre o acervo: sem resposta, o cartão diz que
 * não sabe. "Nenhuma vigência importada" é afirmação sobre o banco, e só vale
 * quando o servidor respondeu.
 */
function ContextoNaFolha({ ambiente }: { ambiente: Ambiente }) {
  const { contextos, indisponivel } = useContextosDaCasca();

  if (ehFechamento(ambiente)) {
    return (
      <div className="rounded-2xl border border-sidebar-border bg-muted/40 px-4 py-3">
        <p className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Alcance
        </p>
        <p className="text-sm font-semibold mt-0.5">
          {descricaoDoAmbiente(ambiente).nomeCompleto}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          A competência é de todas as unidades da operação
        </p>
      </div>
    );
  }

  const atual = contextos[0];

  return (
    <div className="rounded-2xl border border-sidebar-border bg-muted/40 px-4 py-3 flex items-center gap-3">
      <span className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
        <MapPin className="w-[1.125rem] h-[1.125rem] text-brand" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          Unidade aberta
        </span>
        <span className="block text-sm font-semibold truncate">
          {atual !== undefined
            ? unidadeDe(atual)
            : indisponivel
              ? "Indisponível no momento"
              : "Nenhuma vigência importada"}
        </span>
        {atual !== undefined && (
          <span className="block text-xs text-muted-foreground truncate">{detalheDe(atual)}</span>
        )}
      </span>
    </div>
  );
}

/**
 * Uma seção, em cartão.
 *
 * O ícone mora numa pastilha quadrada colorida, o título é a primeira linha e a
 * `descricao` é a segunda — é o par que deixa o cartão ser lido sem abrir a
 * lista. Tocar abre os itens ali mesmo, dentro do cartão: as seções da lateral
 * não têm tela própria, e mandar o toque para algum lugar exigiria inventar
 * uma.
 *
 * Cada cartão guarda o próprio estado de aberto, e nada disso vai para o
 * `localStorage`: a folha nasce e morre com o toque em "Mais", então "o que eu
 * tinha aberto" é uma pergunta que não se chega a fazer. A lateral guarda
 * porque ela sobrevive à navegação; esta não sobrevive nem ao clique.
 */
function CartaoDaSecao({
  grupo,
  location,
  contadores,
  enderecoDoItem,
}: {
  grupo: NavGroup;
  location: string;
  contadores: Contadores;
  enderecoDoItem: (item: NavItem) => string;
}) {
  const contemAtivo = grupo.itens.some((item) => estaAtivo(location, item.href));
  /*
    A seção que contém a tela aberta nasce aberta. Quem toca em "Mais" estando
    dentro de Auditoria quase sempre quer a tela vizinha, e fazê-lo tocar duas
    vezes para chegar a ela seria cobrar pelo que já se sabe.
  */
  const [aberto, setAberto] = useState(contemAtivo);

  const escondido = aberto
    ? 0
    : grupo.itens.reduce((soma, item) => soma + (item.contador ? contadores[item.contador] : 0), 0);

  return (
    <div
      className={cn(
        "rounded-2xl border overflow-hidden transition-colors",
        contemAtivo ? "border-brand/40 bg-sidebar-accent/40" : "border-sidebar-border",
      )}
    >
      <button
        type="button"
        onClick={() => setAberto((atual) => !atual)}
        aria-expanded={aberto}
        className="w-full flex items-center gap-3 px-3 py-3 text-left"
      >
        <span
          className={cn(
            "w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-current/10",
            grupo.cor,
          )}
        >
          <grupo.icon className="w-[1.375rem] h-[1.375rem]" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[0.9375rem] font-bold truncate">{grupo.titulo}</span>
          {grupo.descricao && (
            <span className="block text-xs text-muted-foreground truncate">{grupo.descricao}</span>
          )}
        </span>
        {escondido > 0 && (
          <span className="min-w-6 h-6 px-2 rounded-full bg-brand text-brand-foreground text-[0.6875rem] font-bold flex items-center justify-center tabular-nums shrink-0">
            {escondido > 99 ? "99+" : escondido}
          </span>
        )}
        <ChevronRight
          className={cn(
            "w-5 h-5 shrink-0 text-muted-foreground transition-transform",
            aberto && "rotate-90",
          )}
        />
      </button>

      {aberto && (
        <div className="border-t border-sidebar-border">
          {grupo.itens.map((item) => {
            const ativo = estaAtivo(location, item.href);
            const contagem = item.contador ? contadores[item.contador] : 0;

            return (
              <Link
                key={item.href}
                href={enderecoDoItem(item)}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  /*
                    `min-h-12` é alvo de toque, não estética: um item de menu
                    mais baixo do que isso erra o dedo em movimento, e no
                    telefone errar o item significa carregar a tela errada e
                    voltar.
                  */
                  "flex items-center gap-3 px-3.5 min-h-12 py-2.5 border-l-[3px] text-sm transition-colors",
                  ativo
                    ? "border-brand bg-sidebar-accent text-brand font-semibold"
                    : "border-transparent text-sidebar-foreground",
                )}
              >
                <item.icon
                  className={cn("w-[1.125rem] h-[1.125rem] shrink-0", !ativo && "text-muted-foreground")}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {contagem > 0 && (
                  <span
                    className={cn(
                      "min-w-6 h-6 px-1.5 rounded-full text-[0.6875rem] font-bold flex items-center justify-center tabular-nums shrink-0",
                      item.contador === "alteracoes"
                        ? "bg-brand text-brand-foreground"
                        : "bg-warning text-warning-foreground",
                    )}
                  >
                    {contagem > 99 ? "99+" : contagem}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * O pé da folha: quem entrou, e o par Configurações/Sair.
 *
 * É o mesmo do pé da lateral, e está aqui pela mesma razão que lá — no
 * telefone, com mais força: a faixa do topo encolheu para caber, e o menu do
 * usuário que morava nela sobrou sem lugar. Este é o lugar.
 */
function RodapeDaFolha() {
  const { user, logout, isSubmitting } = useAuth();

  if (!user) return null;

  return (
    <div className="pt-1 pb-2">
      <div className="rounded-2xl border border-sidebar-border overflow-hidden">
        <div className="flex items-center gap-3 px-3 py-3">
          <span className="w-10 h-10 rounded-full bg-brand text-brand-foreground text-sm font-bold flex items-center justify-center shrink-0">
            {iniciaisDe(user.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold truncate">{user.name}</span>
            <span className="block text-xs text-muted-foreground truncate">{user.email}</span>
          </span>
        </div>
        <div className="border-t border-sidebar-border grid grid-cols-2">
          <Link
            href="~/configuracoes"
            className="flex items-center justify-center gap-2 min-h-12 text-sm font-semibold text-sidebar-foreground"
          >
            <Settings className="w-4 h-4" />
            Configurações
          </Link>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              void logout();
            }}
            className="flex items-center justify-center gap-2 min-h-12 border-l border-sidebar-border text-sm font-semibold text-destructive disabled:opacity-60"
          >
            <LogOut className="w-4 h-4" />
            Sair
          </button>
        </div>
      </div>
    </div>
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
