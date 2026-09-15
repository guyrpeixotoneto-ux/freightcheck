# O TMA — o tempo de porta, e o lugar declarado de dois jeitos

> Escrito para sustentar a **Auditoria de TMA** (`/custo-variavel-tma`), a tela
> de dois grãos: **por local** e **por trecho**.
>
> **Nada aqui é medição nova.** Tudo sai do que a tabela de frete declara e do
> que `docs/DICIONARIO-TABELA-DE-FRETE.md` define. O que este documento faz é
> mostrar por que a mesma leitura precisa ser feita em dois grãos, e o que cada
> um enxerga que o outro não enxerga.

---

## 1. O verbete pedia duas coisas. Uma chegou.

O catálogo de telas em preparo dizia que esta rota dependia de:

1. *"O registro de cada atendimento com começo e fim: média de tempo sem os dois
   carimbos é média de nada."*
2. *"A regra do que conta como atendimento — o que entra, o que é espera e o que
   é interrupção —, sem a qual duas unidades com a mesma operação exibiriam TMAs
   que não se comparam."*

**A segunda chegou, e são duas regras, não uma.** O dicionário da tabela de
frete define as duas portas com palavras diferentes:

| | Definição |
|---|---|
| **TMA de origem** | da chegada à **saída carregado** |
| **TMA de destino** | da chegada à **liberação**, incluindo fila e descarga |

Carregar não é descarregar. É por isso que a tela nunca junta as duas médias:
um "TMA médio" único exigiria somar o tempo de carregar com o de descarregar e
dividir por dois, o que descreveria uma espera que não acontece em lugar nenhum.

**A primeira continua faltando, e é a que dá sentido à palavra "médio".** O que
este acervo tem é o TMA **parametrizado** — o tempo que o modelo de remuneração
reconhece para aquela porta —, e não o medido. A tela não afirma quanto um
caminhão esperou; afirma quanto o contrato reconhece que ele espera, e diz a
diferença num painel próprio.

**É uma pergunta menor? Não: é o número que remunera.** Um TMA parametrizado
acima do praticado é tempo pago que não acontece; abaixo, é operação absorvendo
espera que ninguém reconhece. As duas conversas existem hoje, com o dado que já
chegou.

---

## 2. O achado: o mesmo lugar declarado com dois tempos

É o motivo de o grão de local existir, e ele **não aparece em nenhuma tela por
trecho**.

O acervo declara o tempo de porta **por trecho**, e o tempo de porta é uma
propriedade do **lugar** — a doca, a portaria, a fila daquele CDD. A mesma
origem aparece em dezenas de trechos, e é preciso virar a tabela do avesso para
perguntar o óbvio:

> **O mesmo local está declarado com o mesmo tempo de porta em todos os trechos
> que passam por ele?**

Quando não está, nenhuma linha individual acusa nada. Cada trecho é internamente
coerente: o ciclo fecha, a velocidade fecha. E ainda assim duas linhas podem
declarar a mesma doca com 90 e 150 minutos. **Ou o modelo distingue trechos por
uma razão que ninguém escreveu, ou alguém parametrizou de dois jeitos** — e as
duas respostas são conversas legítimas com quem publica a tabela.

A tolerância é de **um minuto**. A fonte declara tempo em minutos, e dois
trechos que dizem 90 e 90,5 para a mesma doca estão dizendo a mesma coisa com
arredondamentos diferentes. Um minuto está muito abaixo do que interessa: uma
doca declarada com 90 e 150 erra por uma hora, não por um minuto.

---

## 3. Por que dois grãos, e não um

| Grão | A pergunta | O que só ele vê |
|---|---|---|
| **local** | O mesmo lugar está declarado do mesmo jeito em todos os seus trechos? | a contradição entre trechos que passam pela mesma porta |
| **trecho** | Quanto deste ciclo é porta? | as duas portas **somadas**, a folga por percurso, o peso no ciclo |

O verbete pede o TMA *"por unidade"*, e é o grão de local que responde a isso.
Mas quem negocia um contrato negocia **trechos**, e a pergunta *"quanto deste
ciclo é espera?"* é do percurso: ela compara percursos entre si, e é dela que sai
a fila de quem tem espera demais.

**Os dois saem da mesma leitura** — a mesma linha de trecho, lida uma vez, pelas
mesmas duas chamadas a `getEntityTable`. É isso que garante que nunca discordem:
o tempo de porta de um local é a média dos mesmos números que aparecem no grão de
trecho. O alternador no topo da tabela troca a pergunta, e não a fonte.

---

## 4. A única soma entre as duas portas, e onde ela vale

A tela separa carregar de descarregar em toda parte — **menos em dois lugares**,
e nos dois a soma descreve algo que acontece de verdade:

1. **`tempoDePorta`, no grão de trecho.** É o mesmo caminhão, no mesmo ciclo,
   parado nas duas pontas. Somar as duas ali é descrever o ciclo.
2. **`pesoDasPortasNoCiclo`, no cartão.** A mesma leitura, como número único da
   vigência.

Fora daí, somá-las daria a média de uma operação que não existe — e é por isso
que a média de um local **nunca** junta as duas portas, ainda que o mesmo CDD
seja origem de uns trechos e destino de outros. Ele conta como **um local e duas
portas**.

E a soma se recusa quando falta metade: **meia soma não é um tempo de porta
menor, é um tempo de porta que não se sabe.** Escrevê-la pela metade diria que o
caminhão só para de um lado.

---

## 5. A folga entre o pago e o praticado — e por que nenhum lado é vermelho

Os pares `…Lucro` existem porque o tempo que remunera pode não ser o tempo que a
operação pratica. A tela mede os dois lados e o tamanho, e **não pinta nenhum
deles de vermelho**:

| Folga | O que pode ser |
|---|---|
| positiva — paga-se **mais** porta do que se pratica | folga negociada |
| negativa — paga-se **menos** | espera que a operação absorve sem reconhecimento |

Nenhum dos dois é um erro, e pintar um de vermelho afirmaria um juízo que esta
tela não tem como sustentar. É a mesma decisão que a Auditoria de Velocidade
Média tomou sobre os mesmos pares, e pela razão que o dicionário escreve: *"a
diferença entre os dois é exatamente onde a conversa comercial acontece — não a
apague escolhendo um só"*.

---

## 6. Ausência não vira zero, três vezes

A regra do produto aparece aqui em três formas diferentes, e todas as três
importam:

1. **Um trecho sem TMA declarado não entra na média do local.** Ele não é uma
   espera de zero minuto, e um zero inventado puxaria a média para baixo e
   inventaria uma amplitude que não existe. A conversão de texto para número na
   rota guarda isso: `Number("")` é `0`, e a rota devolve `null`.
2. **Um trecho sem nome de ponta não entra em local nenhum.** Agrupá-lo sob
   "(sem nome)" criaria um lugar que não existe e misturaria docas de unidades
   diferentes numa linha só.
3. **Um local presente numa vigência só aparece com a outra em branco**, e não
   em zero — que seria uma doca que passou a atender instantaneamente.

---

## 7. Por que esta tela não tem change set

As auditorias de rubrica têm duas rotas: uma para o que o motor comparou, e outra
para o que só a leitura das duas pontas sabe. Esta tem **uma só**, e a razão é o
grão:

- **Um local não é uma entidade do acervo.** É um nome que aparece em duas
  colunas de trecho, e o motor pareia entidades — não há change set de "CAMAÇARI
  como origem".
- **O tempo de porta de um ciclo é uma grandeza derivada.** Ele não existe como
  coluna, e portanto não existe como linha de change set.

Então as duas leituras saem da mesma fonte: as duas vigências lidas inteiras,
agregadas em memória pelo núcleo. É o mesmo caminho de `/ipva/totais` e
`/km-rodado/totais`.

**O que mudou em cada coluna de cada trecho continua sendo do motor**, em
Alterações e na Auditoria de Velocidade Média — e a tela diz isso por extenso no
rodapé do painel de evolução.

---

## 8. O que esta tela não repete da Auditoria de Velocidade Média

As duas colunas de TMA já aparecem lá, como duas das três parcelas de tempo
parado dentro do ciclo. **Lá o TMA é parcela de outra conta; aqui ele é a
conta**, e isso muda o que se pergunta dele:

| | Velocidade Média | TMA |
|---|---|---|
| grão | trecho | local **e** trecho |
| o TMA é | uma parcela do tempo parado | o assunto |
| as duas portas | duas linhas entre muitas | separadas por local, somadas por ciclo |
| a folga `…Lucro` | por variável, no par de vigências | por porta de local e por trecho |
| o local | não existe como linha | é o primeiro grão |

---

## 9. O que a auditoria faz com cada fato

| Fato | Onde ele vira comportamento |
|---|---|
| Origem e destino têm definições diferentes | duas linhas por local, e nunca uma média só |
| O mesmo CDD é origem e destino | um local, duas portas — e o cartão conta os dois separados |
| O TMA é declarado por trecho, e é do lugar | `locaisDoTma` inverte a tabela |
| Dois trechos podem discordar sobre a mesma doca | `VARIA_POR_TRECHO`, com a amplitude ao lado da média |
| Arredondamento não é discordância | tolerância de um minuto |
| O ciclo passa pelas duas portas | `tempoDePorta` — a única soma entre elas |
| Falta uma das duas pontas | `tempoDePorta` nulo, com o motivo no ⓘ |
| Pago e praticado podem divergir | folga com sinal, sem cor de erro |
| O TMA daqui é o parametrizado | painel próprio dizendo isso, antes de qualquer número |
| Um local não é entidade do acervo | uma rota, sem change set, com a recusa escrita |

---

## 10. O que continua faltando

1. **O registro de cada atendimento com começo e fim.** Sem os dois carimbos não
   existe TMA medido, e o que a tela mostra continua sendo o parametrizado. É a
   primeira linha do verbete, e ela segue exata.
2. **Quanto do custo variável o TMA responde.** O tempo vira custo pela jornada e
   pelo fator motorista, e essa conta depende das **viagens realizadas** — o
   mesmo realizado que falta a Km Rodado e a Velocidade Média.
3. **A razão de um local ser declarado de dois jeitos.** A tela encontra a
   contradição e a mede; se ela é regra (um trecho que exige conferência extra
   naquela doca) ou erro de parametrização é resposta de quem publica a tabela.
