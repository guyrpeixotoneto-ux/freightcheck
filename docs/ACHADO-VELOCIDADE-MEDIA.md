# O tempo do ciclo — a separação que o verbete pedia, e a identidade que ninguém tinha invertido

> Escrito para sustentar a Auditoria de Velocidade Média
> (`/custo-variavel-velocidade-media`), a segunda tela de custo variável e a
> segunda de grão **trecho**.
>
> **Nada aqui é medição nova.** Tudo sai da definição que
> `docs/DICIONARIO-TABELA-DE-FRETE.md` dá a cada coluna. O que este documento faz
> é mostrar que essas definições, lidas juntas, **fecham duas contas** — e que
> fechá-las é uma auditoria que o produto não fazia.

---

## 1. O verbete pedia duas coisas, e as duas existem neste grão

O verbete de `/custo-variavel-velocidade-media`, enquanto ela era tela em
preparo, dizia depender de:

1. **"Distância e tempo realizados na mesma linha: velocidade é razão entre os
   dois, e sem os dois não há média nenhuma para mostrar."**
2. **"A separação entre tempo rodando e tempo parado — o ativo esperando carga
   não abaixa a velocidade de quem dirigiu, e somar os dois daria uma média que
   não descreve nem uma coisa nem outra."**

A segunda é a difícil, e é a que a tabela de frete resolve de graça. O dicionário
define o ciclo por extenso:

> `cargaHorariaPorTrajetoMinuto` — **Tempo total de ciclo.** Duração do ciclo
> completo em minutos: **deslocamento ida e volta + TMA na origem + TMA no
> destino + refeição.**

E cada uma das três paradas tem coluna própria: `tempoInternoOrigem`,
`tempoInternoDestino`, `tempoRefeicaoMinuto`. Subtrair as três do ciclo devolve
**o tempo rodando** — exatamente a separação que o verbete dizia faltar, sem uma
coluna nova no banco.

**A primeira metade tem uma ressalva, e ela é a recusa desta tela:** o tempo e a
distância aqui são os **contratados**, não os realizados. O modelo de remuneração
parametriza quanto tempo o trecho leva e a que velocidade; o apontamento de
viagens da quinzena não chega neste export. A tela não afirma a que velocidade
alguém dirigiu — afirma a que velocidade o contrato supõe que se dirija.

---

## 2. A identidade que ninguém tinha invertido

O dicionário diz duas coisas sobre velocidade e tempo:

> `velocidadeMediaKmH` — Velocidade média praticada no trecho. **Com o km, produz
> o tempo de deslocamento.**

> `tempoTrajetoFabricaCDMinuto` — Tempo puro de deslocamento entre fábrica e CDD,
> sem tempos internos. **É o que a velocidade média e o km produzem.**

Invertendo: **o tempo rodando, com o km do ciclo, produz uma velocidade** — e ela
tem de ser a declarada.

```
rodando  = ciclo − (TMA origem + TMA destino + refeição)
medida   = km do ciclo ÷ (rodando ÷ 60)
medida  ≟ velocidadeMediaKmH
```

Quando as duas não batem, há duas leituras possíveis, e a tela não escolhe entre
elas porque as duas são perguntas para quem publica a tabela:

- ou o **ciclo** foi montado com outro tempo de deslocamento;
- ou a **velocidade declarada** não é a que o modelo usou para montá-lo.

**Por que isso não aparecia antes.** Uma comparação entre vigências mostra o
delta de cada coluna; cada uma continua coerente na sua linha. A incoerência está
**dentro de uma vigência só**, entre colunas que ninguém tinha posto na mesma
conta.

A folga é de **dois por cento**, e o argumento é a aritmética: o tempo rodando sai
de uma subtração entre quatro tempos arredondados em minutos, e a velocidade
declarada costuma vir com uma casa decimal. Somados, esses arredondamentos ficam
abaixo de um por cento num ciclo de algumas horas. Dois por cento cobre isso com
folga e continua acusando o que importa — um ciclo montado sobre o trajeto de ida
em vez do de ida e volta erra por um fator de dois, não por dois por cento.

---

## 3. A base do tempo de trajeto é medida, não suposta

O dicionário diz que `tempoTrajetoFabricaCDMinuto` é "o que a velocidade média e
o km produzem", mas **não diz qual km** — o de ida ou o do ciclo. "Fábrica × CDD"
sugere uma perna só; o ciclo é ida e volta.

Escolher um dos dois seria adivinhar, e a escolha errada acusaria metade da
tabela de divergir. Então a tela **mede**: multiplica a velocidade declarada pelo
tempo de trajeto e vê em qual das duas distâncias o resultado cai.

```
distância do trajeto = velocidade × (trajeto ÷ 60)
cai sobre km de ida?  cai sobre km do ciclo?  nem um nem outro?
```

A contagem por vigência fica na última coluna da conferência. Ela é **informação
sobre a tabela**, não um erro: saber que 380 trechos calculam o trajeto sobre a
ida e 12 sobre o ciclo é o tipo de coisa que só aparece quando alguém pergunta.

---

## 4. Tempo pago e tempo praticado são duas medidas, e a diferença é o assunto

O dicionário da tabela de frete não é ambíguo aqui — é o segundo dos três avisos
que ele publica antes da tabela de atributos:

> **Os pares `…Lucro` são a base remuneratória, não a operacional.**
> `tempoInternoOrigemLucro`, `cargaHorariaPorTrajetoMinutoLucro` e
> `kmRodadoMesPorEquipeLucro` existem porque o tempo pago e o tempo real podem
> divergir. **A diferença entre os dois é exatamente onde a conversa comercial
> acontece — não a apague escolhendo um só.**

O que a tela faz com isso:

- as colunas da versão lucro ficam **fora de toda soma** (`foraDaSoma` no
  catálogo) — somá-las às operacionais contaria o mesmo minuto duas vezes;
- elas aparecem no detalhe, marcadas, e o CSV ganha uma coluna **"Versão"**
  (Operação / Remuneração), porque num arquivo sem ela duas linhas com o mesmo
  nome e números diferentes parecem erro de importação;
- e a **folga** entre as duas ganha painel próprio: quantos trechos pagam mais
  tempo do que rodam, quantos pagam menos, e de quanto.

**A folga não tem lado bom por si.** Um ciclo pago maior que o operacional pode
ser uma folga negociada ou um tempo que a operação deixou de praticar. A tela
mostra os dois lados e o tamanho, e não chama nenhum deles de erro.

---

## 5. Ausência não vira zero — e aqui isso decide uma velocidade

É a regra que atravessa o produto, e nesta rubrica ela é mais cara do que de
costume. Se qualquer das três paradas não veio, **o tempo parado é nulo e o tempo
rodando também**.

Lida como zero, uma refeição ausente num ciclo de 696 minutos daria 486 minutos
rodando em vez de 426, e uma velocidade de 50,9 km/h contra 58 declarados: uma
divergência inteiramente inventada pela conversão. O portão está no núcleo
(`somaEstrita`) e repetido na rota, onde `Number("")` é `0`.

---

## 6. Velocidade é razão, e razão não se soma

A média de duas velocidades **não é** a velocidade média de dois percursos: para
isso seria preciso ponderar por tempo ou por distância rodada, e a distância
rodada depende de quantas viagens cada trecho fez — o realizado que não existe.

A tela mostra a média **simples entre trechos**, dita como tal no rodapé, e nunca
a chama de velocidade da operação. É a mesma decisão que a Auditoria de Km Rodado
tomou para o R$/km médio, e pela mesma razão.

---

## 7. O que a tela faz com cada um destes fatos

| Fato | Onde ele vira comportamento |
|---|---|
| O ciclo se decompõe | painel da partição: rodando, TMA origem, TMA destino, refeição |
| Rodando × km = velocidade | veredito `VELOCIDADE_DIVERGE`, com folga de 2% |
| Paradas maiores que o ciclo | veredito `CICLO_NAO_COMPORTA_PARADAS`, que decide antes da velocidade |
| Base do trajeto indefinida no dicionário | medida contra ida e ciclo, contada por vigência |
| Pares `…Lucro` | fora de toda soma, coluna "Versão" no CSV, painel próprio da folga |
| Ausência não é zero | `somaEstrita` no núcleo, `comoNumero` na rota, frase na gaveta |
| Velocidade é razão | média simples entre trechos, dita como tal |
| Realizado inexistente | cartão, rodapé da conferência e gaveta |
| Trecho e equipamento em vigências separadas | `vigenciasQueCobrem` no seletor, com a tela vazia explicando a causa |

---

## 8. O que continua faltando

1. **O realizado.** Quantas viagens cada trecho rodou na quinzena, e em quanto
   tempo. Com ele, a velocidade contratada vira uma régua contra a praticada — e
   é aí que esta tela responde a pergunta que o verbete fazia, e não só a que o
   acervo sustenta.
2. **O tempo virando dinheiro.** O dicionário liga o ciclo ao custo de pessoal
   pelo fator motorista (`cargaHorariaMotoristaPuxadaMensal` dividida pelo tempo
   de ciclo), e a tela mostra o fator ajustado ao lado do de referência — mas não
   refaz a conta: a fórmula exata não está publicada, e inventá-la seria
   exatamente o que este produto não faz.
