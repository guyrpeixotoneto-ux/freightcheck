# O quilômetro do trecho — o que o acervo tem, o que ele não tem, e as duas contas que ninguém tinha fechado

> Escrito para sustentar a Auditoria de Km Rodado (`/custo-variavel-km-rodado`),
> a primeira tela de custo variável e a primeira de grão **trecho**.
>
> **Nada aqui é medição nova.** As três primeiras decisões saem dos avisos que o
> próprio `docs/DICIONARIO-TABELA-DE-FRETE.md` publica, e a quarta sai da
> descrição que ele dá ao pedágio. O que este documento faz é transformar esses
> avisos em régua: se o dicionário diz que somar duas colunas dobra o custo, o
> produto tem de recusar a soma — e se ele publica uma identidade entre colunas,
> o produto pode **conferi-la**.

---

## 1. Por que esta tela é por trecho, e não por placa

As quatro auditorias de rubrica anteriores — FINAME, IPVA, Lucro Fixo, Impostos —
são por **placa**: todas tratam de um ativo, e todas leem o export de remuneração
por equipamento.

Custo variável é outra coisa. Ele é provocado por **rodar**, e o que roda é um
percurso: origem, destino, distância, e o preço que o contrato dá a cada
quilômetro daquele percurso. O grão certo é a linha da tabela de frete,
identificada pela chave do trecho (`chaveTrecho`), e é o tipo `TRECHO` do
acervo — o mesmo que o Radar de Trechos já usa.

Isso tem uma consequência prática que a tela precisou tratar: no acervo, o arquivo
de equipamento e o de trecho chegam em **vigências separadas**, com
`entity_type_set` diferente. Um par de vigências escolhido sem olhar a cobertura
cai na vigência de cavalo mais recente, e a tela de trecho abre com zero linhas —
correta e inexplicável. Daí `vigenciasQueCobrem`, no núcleo compartilhado.

---

## 2. R$/km e R$/viagem são o mesmo dinheiro contado duas vezes

É o primeiro dos três avisos que o dicionário da tabela de frete publica logo
acima da tabela de atributos:

> **R$/km e R$/viagem são o mesmo dinheiro contado duas vezes.** Cada grupo de
> custo aparece nas duas formas — `freteReaisKMDiesel` e `freteReaisViagemDiesel`
> — e a segunda é a primeira multiplicada pelo km do ciclo. Somar as duas colunas
> numa apuração dobra o custo.

São nove componentes, cada um com as duas formas:

| Componente | R$/km | R$/viagem |
|---|---|---|
| Diesel | `freteReaisKMDiesel` | `freteReaisViagemDiesel` |
| Manutenção do cavalo | `freteReaisKMManutencaoCavalo` | `freteReaisViagemManutencaoCavalo` |
| Manutenção do implemento | `freteReaisKMManutencaoCarreta` | `freteReaisViagemManutencaoCarreta` |
| Pneus | `freteReaisKMPneu` | `freteReaisViagemPneus` |
| Pedágio | `freteReaisKMPedagio` | `freteReaisViagemPedagio` |
| Lavagem | `freteReaisKMLavagem` | `freteReaisViagemLavagem` |
| Seguro de carga | `freteReaisKMSeguro` | `freteReaisViagemSeguro` |
| Prêmio de produtividade | `freteReaisKMSalarioVariavel` | `freteReaisViagemSalarioVariavel` |
| Lucro variável | `freteReaisKMLucroVariavel` | `freteReaisViagemLucroVariavel` |

(O par `…Pneu` / `…Pneus`, no singular e no plural, é como a fonte os entrega.
Corrigir a grafia no catálogo quebraria o vínculo com o acervo; o lugar de
consertar isso é a origem.)

**O que a tela faz com isso:** as nove colunas de R$/viagem ficam **fora da tabela
e de toda soma** (`foraDaSoma` no catálogo), aparecem no detalhe com o aviso
viajando junto — inclusive para dentro do CSV — e servem para uma coisa só:
conferir o km, que é o único uso que não conta o mesmo dinheiro duas vezes.

---

## 3. Razão não é montante — e aqui nada é dinheiro do período

R$/km é uma **taxa**. Ela vira dinheiro multiplicada por uma quilometragem; sem
essa quilometragem, somá-la a qualquer coisa produz um número que não é de nada.
É a mesma distinção que a Auditoria de Impostos faz entre alíquota e montante,
e nesta rubrica ela é mais dura, porque **nenhuma** coluna da tela é dinheiro do
período:

| Coluna | O que é | Por que não é dinheiro do período |
|---|---|---|
| `kmRodado`, `kmIda`, `kmVolta` | distância | quilômetro não é real |
| os nove R$/km | razão | vira dinheiro só multiplicada por km rodado |
| os nove R$/viagem | reais por ciclo | é o R$/km já multiplicado; e um ciclo não é um mês |
| `previsaoViagens` | volume | **previsão**, não realizado |

Por isso o cartão de impacto desta tela diz, quase sempre, "sem impacto
precificável" — e diz **o que mudou** ao lado, para que a frase não seja lida
como "nada mudou no preço".

---

## 4. Lucro variável é margem, não custo

O segundo aviso do dicionário, na linha de `freteReaisKMLucroVariavel`:

> Margem variável remunerada ao transportador por km rodado. **Não é custo**: é o
> lucro que o contrato embute no preço.

**O que a tela faz com isso:** o preço por km sai em duas leituras separadas — o
**custo por km** (as oito parcelas) e a **margem por km** (só o lucro variável) —,
e o total delas é o preço. Somá-las num "custo" único dobraria o resultado, e é o
mesmo erro que o dicionário avisa em `Lucro variável (margem)`.

---

## 5. As duas contas que o acervo permite fechar

Esta é a parte que não estava escrita em lugar nenhum, e é a razão de a tela
existir apesar de o realizado não existir. O dicionário publica duas identidades;
nenhuma delas tinha sido conferida contra o acervo.

### Conta 1 — ida + volta = km do ciclo

`kmRodado` é descrito como "Km total do ciclo (ida + volta)". Quando a soma das
pontas não dá o ciclo, **a própria linha discorda sobre a distância que ela
cobra** — e o R$/km dela passa a valer sobre uma distância que o próprio trecho
não confirma.

A folga é de **meio quilômetro**: as três colunas são distâncias declaradas na
mesma linha e na mesma unidade, a soma entre elas é aritmética exata, e a única
folga que ela precisa é a do arredondamento com que a fonte escreve cada uma.
Meio quilômetro está muito abaixo de qualquer diferença que signifique alguma
coisa — um retorno por outra rota, uma perna de sinergia (F-MOV), um destino que
mudou.

### Conta 2 — R$/viagem ÷ R$/km = km do ciclo

Se cada R$/viagem é o R$/km multiplicado pelo km do ciclo, então a divisão de
volta **devolve o quilômetro sobre o qual aquele preço foi montado**. Quando ele
não é o km declarado, o preço daquele trecho saiu de outra distância — a projeção
mensal (`kmRodadoMesPorEquipe`), o km de ida, ou a versão "lucro"
(`kmRodadoMesPorEquipeLucro`), que o próprio dicionário diz existir justamente
porque o tempo pago e o tempo real podem divergir.

**É a conta que só esta tela faz.** Um recorte que mostrasse apenas o delta do
R$/km entre duas vigências nunca veria isso: as duas colunas continuariam
coerentes cada uma na sua linha, e a comparação entre vigências não olha para
dentro de uma vigência só.

Três cuidados, e cada um evita um falso achado:

1. **A tolerância é relativa, de 1%**, e não absoluta. O km implícito sai de uma
   divisão entre dois valores já arredondados: um R$/km publicado com duas casas
   carrega até meio centésimo de erro relativo, que num trecho de 900 km vira
   vários quilômetros sem que nada esteja errado. Um por cento absorve o
   arredondamento em qualquer distância e continua acusando o que importa — um
   preço montado sobre a projeção mensal erra por ordens de grandeza.
2. **A distância do preço é a mediana entre os componentes**, não a média. Basta
   um componente ter sido montado sobre outra distância para a média cair no meio
   do caminho entre duas respostas certas — um número que não é o de nenhum dos
   dois grupos. A mediana devolve a distância que a maioria concorda em usar, que
   é a pergunta; os divergentes continuam contados ao lado.
3. **Zero de um lado não confere nada.** Um componente que o trecho não cobra
   (R$ 0,00 por km e por viagem) é coerente com qualquer distância, e dividir zero
   por zero não produz quilometragem. Ele sai da conta em vez de entrar como uma
   concordância que não existe.

---

## 6. O pedágio fica fora da segunda conta, e o motivo é publicado

O dicionário descreve `freteReaisViagemPedagio` assim:

> Pedágio em reais por viagem — pelo R$/km quando há tabela própria, ou pelo
> pedágio por eixo da tabela de frete mínimo (ANTT) quando não há.

São **duas vias de cálculo**. Quando a segunda é usada, dividir o valor por viagem
pelo R$/km não produz quilometragem nenhuma: produz a razão entre duas contas
diferentes, e o trecho apareceria como "preço montado sobre outro km" sem que
nada estivesse errado.

O pedágio é o único componente excluído do km implícito, e está excluído por um
motivo publicado — não por conveniência de fazer o número fechar.

---

## 7. O que continua faltando, e é o que o verbete pedia

**A quilometragem realizada por quinzena.** O export que abastece este banco traz
a tabela de **preço** por trecho, não o apontamento de viagens. Sem ele:

- não há "quanto a operação rodou";
- não há "quanto a operação gastou";
- e não há R$/km **da operação** — o dinheiro total sobre a quilometragem total —,
  que é uma coisa diferente da média entre trechos que esta tela mostra.

Por isso a média do preço por km é **simples entre trechos**, e a tela diz isso:
ponderar pelo km do ciclo pesaria um trecho de 900 km nove vezes mais do que um de
100 km **como se os dois rodassem o mesmo número de viagens** — que é exatamente a
suposição que falta o dado para sustentar.

O que a tela responde, inteiro, é a outra pergunta: **quanto custa o quilômetro
contratado de cada trecho, parcela a parcela, e se o preço de cada um foi montado
sobre a distância que ele declara.**

---

## 8. O que a tela faz com cada um destes fatos

| Fato | Onde ele vira comportamento |
|---|---|
| R$/km e R$/viagem são o mesmo dinheiro | as nove de R$/viagem com `foraDaSoma`, fora da tabela, no detalhe, e o aviso no CSV |
| Razão não é montante | `papel` no catálogo; razões contadas em `razoesAlteradas`, nunca somadas; coluna "Unidade" no CSV |
| Lucro variável é margem | custo por km e margem por km separados; cor própria na composição |
| Ida + volta = ciclo | veredito `CICLO_NAO_FECHA`, com folga de 0,5 km |
| R$/viagem ÷ R$/km = ciclo | veredito `PRECO_USA_OUTRO_KM`, com folga de 1% e mediana entre componentes |
| Pedágio com duas vias | único componente fora do km implícito, com o motivo no rodapé e na gaveta |
| Realizado inexistente | cartão de impacto, rodapé da conferência e gaveta; média simples entre trechos, dita como tal |
| Trecho e equipamento em vigências separadas | `vigenciasQueCobrem` no seletor, e uma tela vazia que explica qual das duas causas ocorreu |
