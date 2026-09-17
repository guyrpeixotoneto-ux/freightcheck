# As definições do confronto de FINAME

Este documento define, com uma precisão que o código tem de obedecer, os cinco
termos que a Auditoria de FINAME escreve na tela — **conciliado**, **sem
realizado**, **pendente de classificação**, **déficit** e **sobra** — e os dois
números que eles produzem: o **saldo dos veículos conciliados** e a
**cobertura**.

Ele existe porque a tela já estava certa na aritmética e errada na leitura. Em
setembro/2026, recorte Cavalo, ela mostrava `Resultado líquido −R$ 87.393,05` em
destaque, e esse número foi lido como *o déficit de FINAME do mês*. Não é: é o
saldo de 17 dos 64 cavalos remunerados. Os outros 47 levam R$ 630.919,82 de
remuneração sem nenhum lançamento no razão, e 32 deles estão declarados
`FINANCIADO`. A conta estava certa; o rótulo convidava à conclusão errada.

A regra que atravessa tudo o que vem abaixo é uma só:

> **Nenhum total desta tela fala da frota. Todo total desta tela fala de um
> universo nomeado, e o nome viaja junto com o número.**

---

## Os três universos, e por que eles não se somam

Uma competência divide os veículos e o dinheiro em três universos **disjuntos**
e **incompletos entre si** — a união deles não é a frota, e é por isso que eles
aparecem separados em vez de empilhados num total.

| Universo | Unidade | O que ele responde |
|---|---|---|
| 1. Conciliados | veículos | Quanto a remuneração se distanciou do custo, onde dá para medir |
| 2. Sem realizado | veículos + R$ remunerado | Quanta remuneração não tem contrapartida no razão |
| 3. Real pendente de classificação | placas + R$ realizado | Quanto custo o razão traz sem ativo a que atribuí-lo |

Somar 1 e 2 daria um "remunerado total"; somar 1 e 3 daria um "realizado total";
somar os três não dá nada. As unidades do universo 2 e do universo 3 são de
lados opostos do confronto — uma é remuneração sem custo, a outra é custo sem
ativo —, e a tela nunca as apresenta como parcelas de um mesmo bolo.

---

## 1. Conciliado

> **Conciliado** é a placa que, numa competência, tem **remunerado mensal
> consolidado** e **realizado** para o **mesmo tipo de ativo**, com **um único**
> lançamento consolidado de cada lado.

As cinco condições, todas obrigatórias:

1. **Existe remunerado.** A placa aparece nas vigências do mês.
2. **O remunerado está consolidado** — `situacao === "CONSOLIDADO"`. As demais
   situações (`DIVERGENCIA_INTRAMENSAL`, `COBERTURA_PARCIAL`, `SEM_VALOR`) não
   produzem um valor mensal único e por isso não conciliam. Ver
   `competencia-de-finame.ts`.
3. **Existe realizado** para a mesma competência.
4. **O tipo de ativo é o mesmo nos dois lados.** A mesma placa como `CAVALO` no
   remunerado e `CARRETA` no realizado não é uma coisa medida duas vezes; são
   duas coisas.
5. **O realizado não é ambíguo.** Duas linhas de realizado para a mesma placa na
   mesma competência (duplicata não decidida) impedem a conciliação: somá-las
   exigiria uma regra de rateio que esta instalação não declarou.

Conciliado é `cobertura === "COMPLETA"`, e **só** a placa conciliada entra em
`totalRemunerado`, `totalRealizado` e `saldoDosConciliados`.

**Conciliado não quer dizer comparável em natureza.** Ele afirma que os dois
lados existem e falam do mesmo ativo no mesmo intervalo — não que estejam
medindo a mesma coisa. Um cavalo quitado cuja remuneração já migrou para lucro
fixo concilia perfeitamente com um lançamento de financiamento no razão, e a
diferença entre os dois não é déficit de remuneração. É para isso que existem
os alertas (ver adiante).

## 2. Sem realizado

> **Sem realizado** é a placa com remunerado mensal consolidado na competência e
> **nenhum** lançamento realizado correspondente nela.

É `cobertura === "SEM_REALIZADO"`. O que a define é a ausência, e ausência
**nunca** é R$ 0,00: a placa sai com `realizado: null`, `diferenca: null` e
`resultado: "NAO_CALCULAVEL"`. Escrever zero ali afirmaria que a operação
incorreu zero de FINAME naquele veículo — uma afirmação forte, às vezes
verdadeira (ativo quitado) e impossível de distinguir do silêncio da fonte.

Duas subpopulações, e a segunda é a que exige ação:

- **Sem realizado, financiamento encerrado.** A placa está declarada `QUITADO`.
  A falta de lançamento é coerente com o contrato.
- **Sem realizado, declarada financiada.** A placa está declarada `FINANCIADO`
  ou `FINAME` e mesmo assim não há parcela no razão do mês. Isso é uma das duas
  coisas, e as duas são achado: ou o razão não registrou uma parcela devida, ou
  a base remunera um financiamento que não existe mais.

A segunda subpopulação tem **destaque próprio na tela** e não pode ficar apenas
em linha de tabela paginada. Em setembro/2026 ela são 32 veículos.

Uma placa `SEM_REALIZADO` não entra em nenhum total do universo 1. O dinheiro
dela é publicado à parte, em `foraDoConfronto.remuneradoSemRealizado`.

## 3. Real pendente de classificação

> **Pendente de classificação** é a placa que **o razão traz** e que **o cadastro
> não resolve**: não há tipo de ativo para ela, e o tipo não é dedutível da conta
> contábil.

É o status `PENDENTE_DE_CLASSIFICACAO` em `finame_real_lancamento`. A conta
`C.D.C. - VP` — *crédito direto ao consumidor, veículo pesado* — vale para
cavalo, caminhão e carreta igualmente; deduzir o tipo dela acertaria na maioria e
erraria calado no resto, e o erro apareceria como um cavalo somado entre as
carretas.

Estes lançamentos:

- **estão preservados**, nunca descartados;
- **não entram** em `totalRealizado` nem em nenhum recorte por tipo de ativo,
  porque não têm tipo pelo qual serem recortados;
- **não são "sem remunerado"**: `SEM_REMUNERADO` é uma placa *classificada* cujo
  remunerado falta. Aqui é o oposto — falta a classificação, não o outro lado.

Por isso este é um universo à parte, e não uma linha da tabela: ele é anterior
ao confronto.

**Dois recortes, e os dois são publicados.** O valor pendente da **competência
analisada** é o que fica fora daquele confronto; o valor pendente do **extrato
inteiro** é o tamanho da fila de trabalho. Em setembro/2026 a tela mostrava
R$ 174.826,25 ao lado de um painel de setembro — esse número é do extrato de 2026
inteiro, e passa a vir dito assim.

## Déficit

> **Déficit** é a placa **conciliada** em que `remunerado − realizado < 0`, além
> da tolerância de meio centavo.

Descritivo, não avaliativo: diz que a remuneração ficou abaixo do custo daquele
mês, e não que alguém errou. A tolerância é `TOLERANCIA_DO_CENTAVO = 0,005` —
menor que a menor unidade monetária, de modo que ela nunca esconde uma
divergência de dinheiro, só o ruído de `numeric(18,6)` virando `number`.

Uma placa **não conciliada nunca é déficit**, ainda que o remunerado dela seja
visivelmente menor que qualquer realizado plausível. Sem os dois lados não há
subtração.

## Sobra

> **Sobra** é a placa **conciliada** em que `remunerado − realizado > 0`, além da
> mesma tolerância.

**Sobra não é boa notícia por definição.** Uma sobra grande costuma ser um ativo
que saiu da operação e continuou sendo remunerado — achado de auditoria, não
vitória. É por isso que a classificação é `SOBRA`/`DEFICIT` e nunca
`FAVORAVEL`/`DESFAVORAVEL`, e que a cor da sobra na tela é azul e não verde.

E há um caso em que o **percentual** da sobra é parcialmente artefato: quando a
placa tem lançamento retido como duplicata provável naquela competência, o
realizado que entrou na conta é o de **uma** cópia. Se a decisão pendente vier a
ser "são dois pagamentos", o realizado dobra e a sobra encolhe. O sinal
costuma sobreviver; a magnitude não. A tela marca essas linhas.

### Equilíbrio, e o que não é resultado nenhum

`EQUILIBRIO` é `|remunerado − realizado| < 0,005` numa placa conciliada.
`NAO_CALCULAVEL` é tudo o mais — e é um estado de **cobertura**, não de
resultado: significa que a pergunta não pôde ser feita, e não que a resposta
tenha sido zero.

---

## Saldo dos veículos conciliados

> **Saldo dos veículos conciliados** = `Σ remunerado dos conciliados − Σ
> realizado dos conciliados`.

O indicador chamava-se *Resultado líquido*. O nome novo é a correção de fundo
deste documento: *líquido* sugere que o que sobrou depois de tudo considerado,
e o que o número é, é o saldo de um subconjunto nomeado.

Três regras fecham o significado:

1. **É a diferença dos dois totais arredondados**, e não a soma das diferenças
   por linha — nessa ordem o cartão bate ao centavo com os dois cartões ao lado
   dele, que é o que alguém confere na tela.
2. **Só conciliados entram**, nos três números. Uma placa fora do universo 1 não
   entra nem no saldo nem em nenhum dos dois totais que o produzem; se entrasse
   em um só, a identidade `saldo = remunerado − realizado` deixaria de fechar na
   própria tela.
3. **A cobertura viaja com ele, sempre.** `X de Y veículos` aparece ao lado do
   saldo em toda renderização, inclusive quando `X = Y` — um aviso que só
   aparece às vezes é lido como exceção, e a incompletude aqui é a regra.

`Y` é o número de **veículos remunerados na competência**, não o número de linhas
da tabela. A tabela também traz as placas que só o realizado tem, e contá-las no
denominador daria um "17 de 94" que não responde à pergunta *quantos dos meus
veículos remunerados eu consegui medir*.

## Cobertura

O censo do universo 1 contra o total remunerado:

```
cobertura = conciliados / veiculosRemunerados
```

Em setembro/2026, recorte Cavalo: **17 de 64** — 27% dos veículos e 30% do
dinheiro remunerado (R$ 268.580,16 de R$ 899.499,98).

---

## Os alertas

Um alerta é uma afirmação sobre uma linha que a aritmética do confronto não
consegue fazer, porque depende de evidência que não está nos dois números. Eles
são **regras**, nunca placas escritas no código, e cada um declara o que
observou.

### `QUITADO_COM_REALIZADO_RECORRENTE`

A placa está declarada `QUITADO` na base remunerada, a parcela remunerada não
tem amortização nem juros — o valor migrou para lucro fixo do novo ciclo —, e o
razão traz lançamento de financiamento para ela na competência.

O déficit dessa linha **não é déficit de remuneração**: os dois lados medem
coisas diferentes. Ou o razão paga um financiamento que a base dá por encerrado,
ou a base parou de remunerar um financiamento vivo.

Quando, além disso, a identidade da parcela não fecha — `parcela ≠ amortização +
juros + lucro fixo` acima da tolerância —, o alerta diz também que a **composição
remunerada está inconsistente**, com os dois números.

*Em setembro/2026: QYP0I48. Quitada em 01/02/2026, amortização e juros zerados,
remunerado R$ 4.103,53 (dos quais R$ 3.323,86 de lucro fixo — a identidade não
fecha por R$ 779,67), e o razão lança R$ 9.958,86 todo mês, de janeiro a
setembro, com documento sequencial.*

### `SOBRA_COM_DUPLICATA_RETIDA`

A placa é conciliada, o resultado é `SOBRA`, e existe pelo menos um lançamento
retido como duplicata provável para ela naquela competência. O alerta traz o
realizado que entrou na conta, o que entraria se as cópias fossem somadas, e a
sobra nas duas hipóteses — para que quem decide veja o que a decisão muda antes
de tomá-la.

*Em setembro/2026: RZG5A37. Sobra de R$ 9.725,56 (+234,5%) sobre um realizado de
R$ 4.147,88; somando a cópia retida, R$ 8.295,76 de realizado e sobra de
R$ 5.577,68 (+67,2%). O sinal sobrevive à dúvida, o percentual não.*

---

## Arredondamento monetário

**Uma regra, um módulo: `@workspace/ingest/dinheiro`.**

O produto tinha duas. `Math.round((v + Number.EPSILON) * 100) / 100`, na
apuração, e `Number(v.toFixed(2))`, nas rotas. Elas discordam exatamente onde
mais importa — no valor que cai sobre o meio centavo, que é o único caso em que
arredondar é uma decisão. Medido: a soma das cinco duplicatas retidas de 2026 é
R$ 21.206,765; a primeira regra devolve **21.206,77** e a segunda **21.206,76**,
porque em `float64` o 21.206,765 mora um fio abaixo do meio e `toFixed` lê o
binário, não o decimal que a pessoa escreveu.

A regra que ficou é a primeira — meio centavo arredonda **para cima**, que é o
que qualquer pessoa conferindo à mão faz. `arredondarCentavos` é a única função
autorizada a produzir um valor monetário de duas casas neste produto, e mora em
`@workspace/ingest` por ser o pacote mais baixo que a apuração, o confronto e as
rotas conseguem alcançar.
