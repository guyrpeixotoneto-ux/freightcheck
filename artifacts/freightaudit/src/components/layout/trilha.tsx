import { useLocation } from "wouter";
import { ChevronRight } from "lucide-react";
import { BASES_DE_FECHAMENTO, descricaoDoAmbiente, ehFechamento } from "@/lib/ambiente";
import { useAmbiente } from "@/lib/ambiente-aberto";
import { cn } from "@/lib/utils";
import { navGroupsAuditoria } from "./nav-auditoria";
import { navGroupsFechamento } from "./nav-fechamento";
import { estaAtivo } from "./sidebar";

/**
 * A trilha — *Visão executiva › Panorama Executivo*.
 *
 * Ela **não é uma segunda lista de navegação**, e é isto que decide como ela é
 * construída: o produto já tem uma árvore de telas, escrita uma vez em
 * `nav-auditoria.ts` e `nav-fechamento.ts`, e a lateral a desenha. A trilha lê
 * exatamente a mesma árvore com o mesmo `estaAtivo` da lateral, e por isso ela
 * não pode discordar do menu — nem no dia em que uma tela mudar de seção, nem
 * no dia em que alguém for renomeada.
 *
 * O caminho alternativo era cada página escrever a própria trilha à mão. São
 * quarenta e poucas páginas: seria a quadragésima cópia de um dado que já
 * existe, e a primeira delas a ficar velha ninguém veria.
 *
 * **Ela não pergunta por permissão, e é de propósito.** A lateral filtra a
 * árvore porque ela **oferece** telas, e oferecer o que a conta não abre é
 * anunciar uma porta trancada. A trilha não oferece nada: ela nomeia a seção da
 * tela que já está aberta na frente da pessoa. Perguntar por permissão aqui
 * custaria a sessão inteira — `usePermissoes` exige `AuthProvider` — para pôr
 * uma migalha atrás de uma decisão que a chegada nesta tela já tomou, e
 * amarraria o cabeçalho de toda página do produto ao contexto de autenticação.
 *
 * **Ela é `null` quando não sabe.** Uma tela fora do menu — a raiz de um
 * ambiente, um endereço solto, uma gaveta — não recebe migalha inventada; o
 * cabeçalho simplesmente não desenha a linha. Trilha adivinhada é pior do que
 * trilha nenhuma: ela ensina um caminho que não existe.
 */
export function useTrilha(): { secao: string; tela: string } | null {
  const [location] = useLocation();
  const ambiente = useAmbiente();

  const grupos = ehFechamento(ambiente)
    ? navGroupsFechamento(BASES_DE_FECHAMENTO[ambiente], descricaoDoAmbiente(ambiente).nome)
    : navGroupsAuditoria(ambiente);

  for (const grupo of grupos) {
    /*
      O item mais específico ganha. `estaAtivo` casa por prefixo — é o que
      mantém `/fluxos/123` aceso em `/fluxos` na lateral —, então dois itens
      podem responder ao mesmo endereço e o mais longo é o que descreve a tela
      aberta.
    */
    const casados = grupo.itens.filter((item) => estaAtivo(location, item.href));
    if (casados.length === 0) continue;
    const item = casados.reduce((a, b) => (b.href.length > a.href.length ? b : a));
    return { secao: grupo.titulo, tela: item.label };
  }

  return null;
}

/**
 * A trilha desenhada.
 *
 * Ela é `nav`, e não uma linha de texto: quem navega por leitor de tela chega
 * a ela pela mesma tecla com que chega a qualquer navegação. A seção **não é
 * link** de propósito — não existe tela de seção neste produto, e uma migalha
 * clicável que não leva a lugar nenhum é uma promessa quebrada por clique.
 *
 * O `aria-current="page"` fica na última, que é a única que o leitor de tela
 * precisa distinguir das outras.
 */
export function Trilha({
  secao,
  tela,
  className,
}: {
  secao: string;
  tela: string;
  className?: string;
}) {
  return (
    <nav
      aria-label="Trilha de navegação"
      className={cn("flex items-center gap-1.5 text-xs min-w-0", className)}
    >
      <span className="text-muted-foreground truncate">{secao}</span>
      <ChevronRight aria-hidden className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />
      <span aria-current="page" className="font-semibold text-foreground/80 truncate">
        {tela}
      </span>
    </nav>
  );
}
