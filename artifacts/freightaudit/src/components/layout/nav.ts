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
  /**
   * Outras rotas que acendem **este** item.
   *
   * Existe para o caso em que um item de menu abre um módulo com mais de uma
   * rota dentro — hoje, o QLP: a lateral tem um item só, e as duas populações
   * (`/qlp-operacional` e `/qlp-administrativo`) são abas trocadas dentro da
   * tela, cada uma na rota que sempre teve. Sem isto, abrir a aba
   * Administrativo apagaria o item do menu, e a lateral diria que o usuário
   * está fora do QLP justamente enquanto ele o lê.
   *
   * Não é atalho para agrupar telas parecidas: são rotas do mesmo item, e o
   * `href` continua sendo a chave por item em Permissões (`lib/permissoes.ts`)
   * e o endereço que o clique abre.
   */
  tambemAceso?: string[];
}

export interface NavGroup {
  /**
   * O id da seção — estável, e **independente do título**.
   *
   * Ele é a chave da decisão da casa sobre a seção inteira (`#chamados-ambev`,
   * em `lib/permissoes.ts`), e por isso não pode ser derivado do rótulo. A mesma
   * seção já se chamou "Plano de Ação", "Chamados" e "Chamados Ambev" no espaço
   * de um mês; se a chave saísse do título, cada renomeação teria apagado em
   * silêncio a decisão de quem a tinha desligado — que é exatamente o defeito
   * que a chave de seção existe para não ter.
   *
   * Escreve-se uma vez, e não se troca. Trocar é desligar a decisão de quem já a
   * tomou, sem aviso.
   *
   * A primeira seção do Fechamento leva o nome do ambiente no `titulo` — que
   * muda entre os quatro — e um `id` só, porque é uma seção só.
   */
  id: string;
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
