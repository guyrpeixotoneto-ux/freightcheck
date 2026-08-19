# FreightCheck — Os dois ambientes: Auditoria e Fechamento

> **Status:** fundação implementada. Estrutura de navegação, rotas e telas do
> Fechamento existem; nenhuma lógica financeira de fechamento foi construída.

## O que são os dois ambientes

O FreightCheck é **um** produto — um login, uma empresa/unidade, uma base de
frota, uma infraestrutura, um design system — que atende **dois** processos:

| | Auditoria de Remuneração | Fechamento de Remuneração |
|---|---|---|
| Pergunta | O que mudou? Está correto? Qual o impacto? Há valor a recuperar? | Quanto devemos receber nesta competência? O que está pendente? Podemos fechar? |
| Eixo | A vigência (o retrato que o Freightec exporta) | A competência (o período de apuração, com estado e ciclo de vida) |
| Natureza | Investigação contínua | Fluxo com começo, meio e fim |

A relação entre eles é de mão dupla e vive **no modelo, não nas telas**:
o Fechamento apura o valor da competência; a Auditoria confere se aquele valor
se sustenta; a divergência encontrada volta ao Fechamento como pendência ou
ajuste, e o que for cobrável segue para Recuperação.

## A regra que separa os dois

**A URL é a única fonte da verdade sobre o ambiente aberto.**

- Tudo sob `/fechamento/...` é Fechamento.
- Todo o resto é a Auditoria de sempre.

A regra vive em `artifacts/freightaudit/src/lib/ambiente.ts` e é uma função
pura sobre a localização — sem provider, sem `localStorage`, sem estado que
possa divergir do endereço. Compartilhar um link compartilha o ambiente;
voltar no histórico volta o ambiente junto.

**Por que a Auditoria não foi movida para `/auditoria/...`:** as rotas atuais
são o produto em uso — favoritos, links em e-mail, histórico de navegador.
Movê-las daria simetria ao custo de quebrar todos esses links. O prefixo
explícito ficou para o domínio que nasce agora, onde não custa nada.

## Como se troca de ambiente

Pelo seletor no topbar, colado à marca — `FreightCheck | Auditoria ▾` —
implementado em `components/layout/topbar.tsx`. Ele mostra sempre o ambiente
aberto e lista os dois com nome completo e descrição. Trocar navega para a
home do outro (`/` ou `/fechamento`). A marca também leva à home **do ambiente
aberto**, para que "voltar ao início" nunca troque de espaço de trabalho sem
avisar.

## A lateral contextual

A lateral é o mesmo componente (`components/layout/sidebar.tsx`) com duas
listas:

- **Auditoria** — `NAV_GROUPS`, intacta: Visão executiva, Auditoria,
  Recuperação, QLP, Frota, Inteligência, Dados & governança, Administração.
- **Fechamento** — `components/layout/nav-fechamento.ts`, quatro seções na
  ordem do processo:
  - **Competência**: Visão do fechamento · Competências
  - **Apuração**: Apuração · Pendências · Conferências
  - **Decisão**: Ajustes · Aprovações · Encerramento
  - **Registro**: Histórico

Dois desvios deliberados da lista originalmente proposta:

1. **Apuração vem antes de Pendências** — pendência é o que a apuração não
   conseguiu apurar; sem rodar a conta, não há fila.
2. **"Fechamento" virou "Encerramento"** — um item com o nome do próprio
   ambiente diria a mesma palavra com dois sentidos.

O cartão de unidade aparece nos dois ambientes (a unidade governa os números
dos dois); no Fechamento ele informa e não vira seletor, porque trocar unidade
hoje leva a uma tela da Auditoria. O convite ao assistente é só da Auditoria
pela mesma razão.

## As telas do Fechamento

Todas nascem no padrão honesto do produto (o mesmo de
`pages/telas-em-preparo.ts`): **nenhum número que o banco não sustente.**
O catálogo em `pages/fechamento/etapas.ts` descreve, por etapa, a pergunta,
o que falta no banco e onde olhar hoje — atalhos que quase sempre cruzam para
a Auditoria e o dizem por extenso, com uma tarja "Auditoria" antes do clique.

Construir uma etapa de verdade é o movimento de sempre: a entrada sai do
catálogo, a rota em `App.tsx` aponta para a tela real, e o menu não muda.

## O que o Fechamento vai precisar (fora desta fundação)

- A **competência** como registro próprio (estado, dono, ciclo de vida) e a
  regra que a liga às vigências.
- O **realizado** da operação (viagens, km, disponibilidade) — sem ele,
  apuração é tabela, não remuneração devida.
- **Ajustes como lançamentos próprios**, nunca edição da apuração — o
  fechamento não pode destruir a trilha que a Auditoria confere.
- **Aprovação como registro imutável** com o retrato do que foi aprovado, e
  **encerramento irreversível-com-registro** (reabre-se com autor e motivo).

## Testes que guardam o desenho

- `lib/__tests__/ambiente.test.ts` — a regra do prefixo, inclusive o
  quase-prefixo (`/fechamentos` não é o ambiente).
- `components/layout/__tests__/sidebar.test.ts` — nenhum item de nenhum dos
  dois menus leva a rota inexistente; endereços não se repetem; as seções dos
  dois ambientes mantêm a ordem; todo item do menu do Fechamento vive sob
  `/fechamento`; os atalhos "onde olhar hoje" só levam a telas que funcionam.
