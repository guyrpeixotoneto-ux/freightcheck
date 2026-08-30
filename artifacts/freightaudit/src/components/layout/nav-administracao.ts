import { Cog, Settings2, Shield } from "lucide-react";
import type { NavGroup } from "./nav";

/**
 * A casa — e por que ela é a mesma nos três ambientes.
 *
 * Administração não é uma seção da Auditoria: é onde mora o que os três
 * ambientes consomem. As unidades que a apuração do Fechamento lê são as mesmas
 * que a Auditoria compara; os usuários que entram no Rota são os que entram na
 * Empurrada; integrações, segurança e ajustes da instalação valem para o
 * produto inteiro, não para o processo aberto no momento. Enquanto a seção
 * vivia só na lista da Auditoria, trocar de ambiente escondia o cadastro de que
 * o ambiente depende — e quem estava fechando a competência tinha de sair do
 * fechamento, achar a tela, e voltar.
 *
 * Por isso o grupo vive em arquivo próprio, e não dentro de `sidebar.tsx`: as
 * duas listas — a da Auditoria, em `sidebar.tsx`, e a do Fechamento, em
 * `nav-fechamento.ts` — precisam dele, e `nav-fechamento.ts` não pode importar
 * o componente que a renderiza sem criar um ciclo (é a mesma razão de `nav.ts`
 * guardar os tipos).
 *
 * **Os endereços são absolutos, e continuam sendo — agora com o `~` que diz
 * isso ao roteador.** Estas telas não têm versão por ambiente: `/unidades` é a
 * mesma tela vinda de onde se vier, porque o cadastro é um só. O til é a marca
 * de "endereço absoluto" do wouter, e ele passou a ser necessário quando as
 * auditorias ganharam base própria: dentro de `/auditoria-rota` um `href`
 * escrito `/unidades` seria resolvido como `/auditoria-rota/unidades`, que é
 * uma tela que não existe — a lateral prometeria a casa e entregaria um 404.
 * Fora das auditorias prefixadas o `~` não muda nada: `~/unidades` e
 * `/unidades` chegam ao mesmo lugar. Duplicá-las sob a base de cada fechamento criaria três
 * cadastros de unidade na cabeça de quem usa — e um só no banco. O efeito é
 * que abrir um item daqui sai do fechamento e cai na tela da instalação, que é
 * exatamente o que ela é: sair do processo para mexer na casa.
 *
 * É a seção que fecha as três laterais, pela razão de sempre: por baixo de todo
 * o resto está a casa.
 */
export const GRUPO_ADMINISTRACAO: NavGroup = {
  titulo: "Administração",
  descricao: "Configurações, integrações e segurança da instalação",
  icon: Cog,
  cor: "text-nav-admin",
  itens: [
    /*
      Um item só, e não três.

      Havia "Unidades", "Usuários" e uma "Configurações" que apontava para
      `/ajustes` — tela que não existe. A terceira saiu do menu junto com o seu
      verbete do catálogo de telas em preparo: os padrões do produto continuam
      escritos onde são usados, e um item que só sabe dizer isso cobra um
      clique para devolver a mesma frase. As duas que restaram viraram seções
      de `/configuracoes`, porque são a mesma pergunta — o que a instalação tem
      cadastrado — e separá-las em dois itens obrigava a escolher antes de
      olhar. Hoje são sete seções, e `/configuracoes` é o índice delas: o item
      do menu continua sendo um, e quem abre escolhe olhando a lista, com o
      estado de cada seção escrito na linha. `/unidades` continua atendendo,
      abrindo a seção de unidades.
    */
    { href: "~/configuracoes", label: "Configurações", icon: Settings2 },
    /*
      "Integrações" saiu daqui, e não sumiu: virou tela de verdade e passou a
      morar em **Dados & governança** (`nav-auditoria.ts`), ao lado de
      Importações. A mudança de lugar é a mesma da tela: enquanto era um verbete
      de "em preparo" — "que sistemas entregam e consomem dados aqui" —, ela era
      ajuste da instalação, e a casa era o lugar. Agora que existe, o que ela
      governa é o **material**: quem escreve no acervo por API, com que chave e o
      que já escreveu — a mesma pergunta que Importações e Rastreio de Dados
      fazem sobre o arquivo que sobe pela tela.

      O efeito colateral está escrito para quem for mexer: a lateral do
      Fechamento não tem a seção Dados & governança, então a tela deixou de
      aparecer lá. Quem administra chave de API administra o acervo da auditoria,
      e o endereço continua sendo `/integracoes` — quem tiver o link entra por
      ele de qualquer ambiente.
    */
    { href: "~/seguranca", label: "Segurança", icon: Shield },
  ],
};
