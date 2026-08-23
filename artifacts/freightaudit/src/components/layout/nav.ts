import type { LucideIcon } from "lucide-react";

/**
 * A forma de um menu lateral, seja de que ambiente for.
 *
 * Os tipos moram aqui, e não em `sidebar.tsx`, porque agora há duas listas com
 * esta forma — a da Auditoria, que continua em `sidebar.tsx`, e a do
 * Fechamento, em `nav-fechamento.ts` — e a lista não pode importar o componente
 * que a renderiza sem criar um ciclo.
 *
 * A forma é uma só de propósito: a lateral do Fechamento é **a mesma lateral**
 * com outro conteúdo, não um segundo componente. Seções que recolhem, borda
 * marinho no item aberto, contador quando houver fila — tudo o que a Auditoria
 * ensinou o olho a ler vale igual no outro ambiente.
 */

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** O número à direita, quando há um para mostrar. */
  contador?: "alteracoes" | "importacoes" | "curadoria";
}

export interface NavGroup {
  titulo: string;
  /**
   * A frase que diz o que se faz na seção, para onde ela é lida sem a lista
   * aberta — hoje, o menu do celular, onde cada seção é um cartão e o cartão
   * tem espaço para uma linha a mais. A lateral do desktop não a usa: lá as
   * seções abrem com um clique e a própria lista responde o que o texto diria.
   */
  descricao?: string;
  icon: LucideIcon;
  /** A classe de cor da seção — ver o bloco `--nav-*` em `index.css`. */
  cor: string;
  itens: NavItem[];
}
