# A linguagem visual do FreightCheck

Este documento é o mapa da evolução visual feita nesta rodada e o manual de como
propagá-la para o resto do sistema. Ele não descreve um redesenho: a paleta, a
navegação, a escala de tipografia e o comportamento das telas são os mesmos. O
que mudou é **onde as decisões visuais moram** — antes copiadas dezenas de
vezes, agora em um lugar só — e como o cartão, o cabeçalho, o vazio e o KPI se
apresentam.

## O diagnóstico

Três medidas do estado anterior explicam tudo o que foi feito:

1. **64 chamadas** escreviam `bg-card border rounded-xl shadow-sm` à mão, mais
   umas vinte variações próximas (`rounded-xl border bg-card shadow-sm`,
   `rounded-lg border bg-card`, `bg-card border rounded-xl`). Era uma decisão
   copiada, e por isso sem alavanca: evoluir o cartão exigia acertar 64 arquivos.
2. **Quarenta e três páginas** escreviam o próprio cabeçalho, em cinco formatos:
   `px-8 pt-7 pb-2` sobre o cinza (a leitura executiva), `border-b bg-card px-8
   py-6` (a faixa branca com borda, em vinte e cinco telas), `px-8 pt-6`,
   `px-8 pt-5`, e um punhado que nem `<header>` usava — era um `<div>` com um
   `<h1>` dentro. O título saía em `text-[2rem]`, `text-4xl`, `text-3xl`,
   `text-2xl` ou `text-xl` conforme a idade da tela, e o ícone ora estava dentro
   do `<h1>`, ora num medalhão, ora não existia. Nenhuma dessas diferenças
   queria dizer nada.
3. **Quatro** desenhos diferentes de cartão de KPI e **três** de estado vazio,
   todos dizendo a mesma coisa em corpos e respiros diferentes.

O resultado é a "aparência quadrada": muitos retângulos contornados, todos com o
mesmo peso, e nenhuma hierarquia além da posição na página.

## As decisões

### 1. A elevação separa; o contorno só confirma

`index.css` ganhou `--sombra-1`, `--sombra-2` e `--sombra-3` — tingidas do
marinho do texto, e não de preto puro, que sobre o cinza-azulado do fundo suja
para o amarelo. O traço do cartão clareou para `--superficie-borda`, porque
traço cheio **mais** sombra pesa mais do que o traço sozinho pesava.

No tema escuro a conta se inverte: a sombra encolhe (sobre 11% de luz ela não
existe como fenômeno) e o traço volta a ser quem separa. Em impressão e em
`forced-colors`, a sombra some por completo.

### 2. As classes de casca

Em `@layer components`, no fim de `index.css`:

| Classe                  | O que é                                                    |
| ----------------------- | ---------------------------------------------------------- |
| `.superficie`           | O cartão do produto. Sem `p-*`: o respiro é de quem usa.    |
| `.superficie-interativa` | O cartão que é botão ou link — levanta sob o cursor.       |
| `.superficie-destaque`  | O véu de 4% do marinho. **Uma por tela.**                   |
| `.superficie-flutuante` | Menu, popover, gaveta — a camada que flutua (`--sombra-3`). |
| `.rotulo-secao`         | O versalete que abre um bloco.                              |
| `.medalhao`             | A geometria do quadrado do ícone. A cor vem de fora.        |

Elas não são um segundo sistema ao lado do Tailwind: são o **nome** do que o
Tailwind já escrevia, e continuam aceitando utilitário por cima
(`class="superficie px-6 py-5"`). São CSS, e não uma constante em TypeScript,
porque uma constante não alcança `:hover`, `@media print` nem `forced-colors`.

### 3. Os componentes compartilhados

| Componente                                | Arquivo                                       |
| ----------------------------------------- | --------------------------------------------- |
| `Superficie`, `CabecalhoDaSuperficie`, `Medalhao` | `components/ui/superficie.tsx`         |
| `CartaoDeIndicador`                       | `components/ui/cartao-de-indicador.tsx`       |
| `EstadoVazio`                             | `components/ui/estado-vazio.tsx`              |
| `CabecalhoDePagina`, `CorpoDaPagina`      | `components/layout/cabecalho-de-pagina.tsx`   |
| `useTrilha`, `Trilha`                     | `components/layout/trilha.tsx`                |

`CabecalhoDePagina` tem seis encaixes, e todos existem porque alguma tela já
fazia aquilo à mão: `titulo`, `icone` (o medalhão à esquerda — antes dentro do
`<h1>`, colado à primeira letra), `descricao`, `acoes` (à direita do título),
`contexto` (o canto superior direito — "Dados atualizados às 20:19"), `voltar`
(o caminho de volta **específico**, que ocupa o lugar da trilha nas telas de
terceiro nível) e `rodape` (abas, filtros e faixas de estado que moram no
cabeçalho).

A **trilha** merece nota: ela lê a mesma árvore de `nav-auditoria.ts` /
`nav-fechamento.ts` que a lateral desenha, com o mesmo `estaAtivo`. Por isso ela
não pode discordar do menu, e nasce de graça em toda página que use
`CabecalhoDePagina` — nenhuma delas escreve a própria migalha. Ela não pergunta
por permissão de propósito: a lateral filtra porque **oferece** telas; a trilha
nomeia a tela que já está aberta.

### 4. Os primitivos do shadcn, evoluídos por composição

Nada foi duplicado. `Card` passou a usar `.superficie`. `Button` ganhou os três
níveis de hierarquia declarados, foco de teclado visível (2px com afastamento) e
`active:`. `Badge` perdeu a sombra de botão e trocou `emerald`/`amber` crus pelos
tokens `--success`/`--warning`. `Alert` ganhou `warning`, `success` e `info` além
dos dois que tinha, todos com fundo esmaecido da própria cor. `Table` ganhou
cabeçalho com fundo e versalete, divisórias a 60% e linha sob o cursor no azul do
produto. `Tabs` virou um segmentado com a elevação da casca.

### 5. A casca

A **lateral** deixou de desenhar cada seção como um cartão contornado — eram dez
retângulos dentro de uma coluna que já tem contorno, numa página feita de
cartões. O que agrupa agora é o versalete, o espaço e um traço fino entre
blocos. Os itens ganharam canto arredondado.

O **topo** ganhou a elevação `--sombra-2` (ele é escuro sobre claro, nunca
precisou de traço) e o bloco da conta passou a ser medalhão + nome + e-mail, no
lugar do e-mail em caixa alta — que é o identificador do banco, e o pior dos dois
para se reconhecer de relance.

## O Panorama como vitrine

`pages/panorama.tsx` é a tela onde a linguagem está inteira:

- cabeçalho da casca, com trilha e "Dados atualizados às" no canto;
- andar 1 (o veredito) como **a** superfície de destaque da tela, com medalhão;
- andar 2 (o placar) em `CartaoDeIndicador`, com medalhão por medida — o ícone
  mora em `components/panorama/placar.tsx`, e não em `lib/panorama.ts`, porque é
  desenho e não dado;
- estados vazios com ícone, título e explicação, no lugar da frase cinza solta;
- carregamento em esqueleto com a silhueta dos dois primeiros andares.

Nenhuma linha de `lib/panorama.ts` mudou. Os 1982 testes do pacote continuam
passando, incluindo os seis da página do Panorama.

## Como propagar para uma tela nova

1. **A casca da página**: troque o `<header>` próprio por `CabecalhoDePagina` e o
   `<div className="px-8 py-6 space-y-5 max-w-[...]">` por `CorpoDaPagina`.
   `largura` acompanha a régua da tela (`1600px` para leitura executiva,
   `1400px` para operação).
2. **Os cartões**: `className="superficie px-6 py-5"`, ou o componente
   `Superficie` quando a seção tiver título — aí o par é
   `CabecalhoDaSuperficie`.
3. **Os KPIs**: `CartaoDeIndicador`. Passe `href` quando o cartão inteiro levar a
   algum lugar; passe `destaque` em no máximo um por fileira.
4. **Os vazios**: `EstadoVazio`. `tom="neutro"` é o padrão — laranja só quando o
   vazio for pendência, e vermelho só quando for falha.
5. **O resto**: `Button`, `Badge`, `Alert`, `Table`, `Tabs` já evoluíram; use-os
   em vez de reescrever a casca deles à mão.

## A faixa branca

Vinte e cinco telas abriam com `border-b bg-card px-8 py-6`: uma faixa branca
com borda embaixo, logo abaixo da faixa marinho do topo. Ela **saiu**, e a razão
está escrita desde antes desta rodada no Resumo executivo, que já a havia
abandonado sozinho: são duas barras empilhadas no alto da página, e juntas elas
empurram o primeiro número para baixo da dobra em tela de 13 polegadas. O que
qualifica um título é o texto, não o fundo atrás dele.

Onde a borda dessa faixa tinha função — as fileiras de abas sublinhadas, cujo
`border-b-2` se apoiava nela —, a régua desceu para a própria `<nav>`
(`border-b`, com o botão aceso subindo um pixel para cobri-la). Nada de aba mudou
de comportamento.

## O que não foi convertido, e por quê

Seis telas continuam com cabeçalho próprio, e as seis por um motivo:

- **Gestão à Vista** não usa a casca. É o painel de parede — `<div>` de tela
  cheia, sem `Layout`, sem lateral e sem faixa do topo —, e um cabeçalho de
  página dentro dele seria a casca que a tela existe para não ter.
- **Assistente** e **Fluxo** montam `<Layout alturaDeJanela>`: o cabeçalho deles
  é `shrink-0` dentro de uma coluna que mede exatamente uma janela, e o do
  Assistente ainda encolhe no celular para devolver cem pixels à conversa.
  `CabecalhoDePagina` não mede janela nem encolhe, e forçá-lo ali quebraria a
  rolagem interna das duas.
- **Login** e **Não encontrado** não estão dentro da casca — não têm menu, não
  têm trilha e não são item de lugar nenhum.
- **Unidades** não é uma página: é o painel que Configurações desenha por
  dentro, e o cabeçalho é o de Configurações.

Fora essas seis, **toda página do produto abre pelo mesmo cabeçalho** — as
quarenta e poucas restantes, incluindo as onze do Fechamento.
