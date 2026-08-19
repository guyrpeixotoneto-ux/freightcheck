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
- **Fechamento** — `components/layout/nav-fechamento.ts`, cinco seções na
  ordem do processo:
  - **Fechamento**: Visão Gerencial · Importações · Apurações
  - **Remuneração**: Cadastro
  - **Apuração**: Apuração · Pendências · Conferências
  - **Decisão**: Ajustes · Aprovações · Encerramento
  - **Registro**: Histórico

Cinco desvios deliberados da lista originalmente proposta:

1. **Apuração vem antes de Pendências** — pendência é o que a apuração não
   conseguiu apurar; sem rodar a conta, não há fila.
2. **A primeira seção chama-se "Fechamento", e o ato final, "Encerramento"** —
   o nome do processo fica onde ele começa, e um segundo item com a mesma
   palavra diria dois sentidos de uma vez.
3. **A lista de competências chama-se "Importações"** — o que se faz nela é
   abrir o período e enviar os cinco relatórios da quinzena; a lista é
   consequência. Ao lado dela, **Apurações** mostra o resultado dessa
   importação: o que já foi apurado, quanto foi emitido e quanto há a
   questionar.
4. **Remuneração entrou entre Fechamento e Apuração** — ela não é um momento do
   processo, é a base contra a qual ele roda (ver abaixo). Não foi para o topo
   porque a primeira linha da lateral é a home do ambiente.
5. **A home chama-se "Visão Gerencial"** — ver a seção abaixo. A primeira
   versão, "Visão do fechamento", listava as seis competências mais recentes:
   respondia "o que aconteceu por último", que é pergunta de quem opera.

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

## A Visão Gerencial — o ano por unidade

A home do ambiente (`pages/fechamento/visao.tsx`) responde à pergunta de quem
**responde pelo número**, e não à de quem o produz: *quanto do ano já fechou, em
quais unidades, e onde está o atraso.*

Uma faixa executiva do ano escolhido — fechamentos realizados (%), quinzenas
vencidas em aberto, quinzenas vencidas sem competência, emitido em CT-e e
quanto continua a questionar — e, abaixo, um cartão por unidade em ordem do
atraso, cada um com o seu percentual, o dinheiro apurado e uma faixa de 24
traços que mostra *quando* o ano fechou. Clicar no cartão abre
`/fechamento/unidades/:codigo?ano=AAAA` (`pages/fechamento/unidade.tsx`): as 24
quinzenas do ano daquela unidade, uma a uma, com as competências de cada uma e o
caminho até a tela de dentro.

Quatro decisões que as duas telas materializam:

1. **O percentual de fechamento é sobre a competência, não sobre o
   calendário.** Uma unidade com 12 competências e 7 encerradas está em 58%,
   ainda que o ano tenha 24 quinzenas. Dividir por 24 daria um número menor e
   mais alarmante que também seria falso — o sistema não sabe se a unidade
   deveria ter operado em janeiro, e uma unidade que começou em julho apareceria
   eternamente reprovada por um passado que não é dela.
2. **O que o calendário tem a dizer não se perde: vira lacuna.** A quinzena que
   passou sem competência nenhuma é contada à parte, só entre as que **já
   venceram**, e aparece pelo nome na grade do ano. É a informação que nenhuma
   lista de registros consegue dar, porque não há registro nenhum para listar —
   a mesma razão pela qual o dia sem operação aparece na grade de dias.
3. **Nada aqui recompõe remuneração.** A leitura é a de Apurações
   (`GET /fechamento/apuracoes`), com os totais que a apuração gravou. O
   agrupamento por unidade e a divisão que vira percentual moram em
   `lib/fechamento-gerencial.ts`, fora do JSX e sob teste.
4. **A unidade não está na lateral.** `/fechamento/unidades/:codigo` é
   aprofundamento de um número da home, não uma seção do processo — o menu
   continua sendo as cinco etapas do trabalho.

## A visão por dia — as abas `01`…`31` da planilha

A competência aberta (`pages/fechamento/competencia.tsx`) tem cinco partes, e a
segunda é a **grade de dias**: um ladrilho por dia do período, com o que a
operação rodou naquele dia, e um clique que abre
`/fechamento/competencias/:id/dias/:dia` — a viagem a viagem daquele dia, com
`TOTAL PADRÃO` e `TOTAL SPOT` ao fim de cada grupo de frota.

É a parte da planilha que a apuração não substituía. A conta responde *quanto a
quinzena vale, verba a verba*; a aba diária responde outra pergunta, que é a de
quem opera: **o que aconteceu no dia 3.** Sem ela, discordar de um total exigia
reabrir o 2Art.

O que sustenta a tela:

| onde | o quê |
| --- | --- |
| `lib/fechamento/src/leitores/operacao.ts` | lê a viagem inteira: os 15 campos que a conta soma, e o `detalhe` — veículo, horários, laço, ocupação, remuneração da equipe |
| `lib/fechamento/src/diario.ts` | `diasDaCompetencia` (a grade) e `abrirDia` (a aba), aritmética pura |
| `lib/db` (migration `0042`) | as 47 colunas do retrato, todas anuláveis: coluna que a exportação não trouxe fica `NULL`, nunca `0` |
| `routes/fechamento.ts` | `GET …/dias` e `GET …/dias/:dia` |
| `components/fechamento/` | a grade de ladrilhos, o catálogo de colunas e a tabela larga |

Três decisões que a tela materializa:

1. **O dia sem operação aparece na grade**, apagado e clicável. "Não rodou" é
   uma resposta; a grade que esconde o dia vazio obriga a contar ladrilhos para
   descobrir qual falta. O que a tela nunca faz é confundir isso com "o 2Art não
   foi importado" — esse caso é dito por extenso, acima da grade.
2. **Os totais vêm do servidor**, da mesma função que alimenta a apuração. Uma
   soma feita na tela seria uma segunda conta do mesmo dinheiro.
3. **A última coluna da tabela é a linha física do 2Art.** É a ponta da trilha:
   permite conferir a célula de origem sem refazer a conta.

## A conta abre na lista — Apurações sem trocar de tela

`/fechamento/apuracoes` é a fila do fechamento: uma linha por competência,
agrupada por quinzena, com o que foi emitido, quanto está conferido e quanto
continua a questionar. A pergunta seguinte a "56% conferido" é sempre a mesma —
*conferido onde?* — e ela custava uma troca de tela: abrir a competência,
voltar, refazer o filtro, reprocurar a linha. Quem comparava dois CDDs pagava
esse pedágio a cada ida e volta.

Agora o clique **abre a conta na própria linha**: os três números da quinzena, a
conversão medida dos arquivos e a tabela de verbas, com a memória de cálculo de
cada uma a um segundo clique. O cabeçalho da quinzena abre o grupo inteiro — e
só o fecha quando não falta nenhuma competência por abrir, para que o clique num
grupo meio aberto termine de abri-lo em vez de fechar o que já se estava lendo.

Três decisões que a tela materializa:

1. **É o mesmo componente nas duas telas.** A conta saiu da competência aberta
   para `components/fechamento/conta-apurada.tsx`, e as duas o desenham. Duas
   cópias do mesmo bloco seriam duas opiniões sobre o mesmo número, e a segunda
   envelheceria calada.
2. **A conta é buscada quando a linha abre**, sob a mesma chave de consulta da
   competência aberta (`["fechamento", "competencia", id]`). A lista é o índice
   de dezenas de quinzenas e cada conta traz verbas, memória e divergências:
   baixar todas para mostrar uma seria pagar o fechamento inteiro para ler uma
   linha. Como a chave é a mesma, quem abre aqui e depois entra na tela de
   dentro a encontra pronta — e quem volta de lá reabre a linha sem nova ida ao
   servidor.
3. **A linha não troca mais de tela; ela abre.** O caminho para a competência
   inteira — enviar relatório, ver os dias, encerrar — fica dentro do painel
   aberto, onde a pergunta seguinte aparece. Competência ainda não apurada abre
   dizendo isso, com o atalho para ir rodar a conta, porque apurar continua
   sendo um botão de lá: rodar grava.

## Remuneração — o cadastro, e a única tela que atravessa a fronteira

`/fechamento/remuneracao` reproduz a aba **CADASTRO DA PLANILHA DE
REMUNERAÇÃO**: as quatro alíquotas, o tamanho da frota fixa, quanto vale cada
parcela por veículo ativo e inativo, as vans, as rotas noturnas, o marketing, a
proporção de documentos dentro e fora do município, e o resumo de impostos. É a
aba que abre a pasta de Excel e de onde todas as outras puxam.

**Duas vistas, e a padrão é a de duas quinzenas lado a lado** — que é a forma da
planilha: a aba traz os dois blocos um ao lado do outro, e quem confere lê as
duas colunas juntas. A terceira coluna, a da variação, é o que a planilha não
tem e a tela dá. A vista de uma quinzena fica a um clique e é a que traz a
memória de cálculo inteira; a comparação a deixa de fora de propósito, porque
três colunas de número já são o limite do que se lê sem rolar na horizontal.
Unidade sem par abre direto na vista de uma, sem oferecer a outra.

**Ela é do Fechamento e lê o acervo da Auditoria**, e as duas metades dessa
frase são deliberadas:

- A tela é do Fechamento porque é lá que o cadastro serve — é dele que a
  apuração da quinzena tira alíquota, frota e proporção.
- A leitura é do canônico porque todo número que a aba pede é **contratado**, e
  o contratado mora na Auditoria. Um cadastro com tabela própria seria uma
  terceira verdade sobre a frota, ao lado da que o export declara e da que a
  apuração usa.
- Por isso a rota HTTP é `/remuneracao/...` e **não** `/fechamento/...`: o dado
  é da unidade numa vigência, não de uma competência.

O motor é `lib/remuneracao`, e a fronteira dele é a mesma do Fechamento — a
aritmética é pura (`medicao.ts`, `montagem.ts`) e só `leitura.ts` conhece o
banco.

### A regra que rege o módulo

**Nenhuma linha inventa a sua origem.** Cada uma das trinta declara, no
catálogo (`catalogo.ts`), de onde o número sai — e sai de lá com um de três
estados:

| estado | o que significa |
|---|---|
| `APURADO` | O acervo sustenta a linha. Vem com a regra, as colunas e quantos registros entraram. |
| `EM_CONJUNTO` | O acervo sustenta a linha **junto com outra**. É o caso de PIS e COFINS: o export os soma em `fretePisCofins`, e rachar o par pela alíquota da lei federal traria para dentro do produto uma premissa que nenhum arquivo do cliente sustenta. |
| `SEM_LASTRO` | O acervo não sustenta a linha, e o motivo e a destrava estão escritos — com o atalho para a tela que hoje chega mais perto. |

**Onze das trinta linhas têm lastro hoje**, sobre um acervo completo — nove
apuradas e duas em par:

- contagem de frota ativa / inativa / operação, por `cavalo.ativo`;
- alíquotas de ICMS e de ISS, **medidas em reais** (`impostosIcmsIss ÷
  freteCtrc`) e nunca lidas de `percentualIcmsIss`, que pode vir em pontos
  (`17,84`) ou em fração (`0,1784`) sem que nada no arquivo diga qual;
- PIS + COFINS, como par;
- a proporção de documentos dentro / fora do município, ponderada por
  `previsaoViagens`, com recuo declarado para contagem de trechos quando a
  previsão não vem em todos;
- o resumo de impostos — `100% − (PIS + COFINS + tributo)` —, a única linha
  cuja conta a própria planilha demonstra: com as alíquotas da aba de CDD Belém
  ela dá 84,85% dentro do município e 72,91% fora, e um teste prende os dois.

O placar está preso em teste (`montagem.test.ts`), nas duas direções: cair sem
querer é uma linha que perdeu lastro em silêncio; subir é uma linha destravada,
e o texto da tela precisa acompanhar.

### A recusa da comparação: lastro não é dinheiro

Na vista de duas quinzenas, `Movimento` tem **seis** valores e não três, e
a razão é a única forma de esta tela produzir um número perigoso. Uma linha sem
lastro na quinzena passada e apurada nesta não subiu de zero — subiu de *não
sabíamos*. Tratá-la como variação a partir de zero mostraria um "+100%" que
descreve uma coluna que passou a ser importada, e não um centavo a mais na conta
da transportadora.

| movimento | o que é |
|---|---|
| `IGUAL` · `SUBIU` · `DESCEU` | As duas pontas têm número comparável. Só estes três têm `variacao`. |
| `GANHOU_LASTRO` | A esquerda não sustentava a linha e a direita sustenta. Cobertura, não aumento. |
| `PERDEU_LASTRO` | O contrário — e o único movimento que a tela acende em vermelho, porque pede investigação na importação. |
| `SEM_COMPARACAO` | Nenhuma das duas sustenta a linha, ou as duas pontas não são a mesma grandeza. |

O placar do topo conta os cinco separadamente pela mesma razão: somar "ganharam
lastro" a "mudaram" diria que dezenove linhas se moveram numa quinzena em que
ninguém mexeu em nada.

O que ainda não tem lastro são as rubricas monetárias por veículo, as vans, as
rotas noturnas e o marketing. O motivo de cada uma está escrito no catálogo, e
nenhum deles é "falta implementar": são colunas que o export não traz
(marketing), recortes que ele não separa (van vs. cavalo), periodicidades que o
motor ainda não sabe somar (frete por viagem) e enquadramentos que são decisão
de negócio, não dedução por semelhança de nome de coluna.

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
- `lib/remuneracao/src/__tests__/medicao.test.ts` — as medições do cadastro
  sobre material sintético, com o resumo de impostos preso aos números da
  planilha real (84,85% dentro do município, 72,91% fora).
- `lib/remuneracao/src/__tests__/montagem.test.ts` — a promessa central do
  módulo: **nenhuma linha sai muda**, com dado ou sem ele. E o total que se
  recusa a fechar enquanto qualquer parcela estiver sem lastro.
- `lib/remuneracao/src/__tests__/comparacao.test.ts` — lastro que aparece ou
  some nunca vira variação de valor, nos dois sentidos.
- `lib/remuneracao/src/__tests__/leitura.test.ts` — o SQL, contra um Postgres de
  verdade e com os códigos reais do export; e o par sempre em ordem
  cronológica, mesmo pedido ao contrário.
