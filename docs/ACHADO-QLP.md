# O QLP — a rubrica em que nada soma, e as contas que mesmo assim se conferem

> Escrito para sustentar a Auditoria do QLP: a aba **Auditoria** do QLP
> Administrativo e a tela **QLP Operacional**, as duas de grão **cargo**.
>
> **Nada aqui é medição nova.** Tudo sai do que
> `docs/DICIONARIO-TABELA-DE-QLP-ADM.md` e `docs/DICIONARIO-TABELA-DE-EQUIPE.md`
> declaram, e do que o Book registra sobre a auditoria bimestral. O que este
> documento faz é mostrar que essas declarações **fecham contas** — e que fechar
> contas é uma auditoria possível mesmo numa rubrica travada.

---

## 1. O paradoxo que torna esta tela possível

O QLP é a rubrica mais travada do produto. A tela do quadro administrativo diz
isso na primeira linha do próprio código:

> Efetivo total e custo da estrutura nascem **travados**: os atributos do QLP
> chegam sem semântica confirmada, e agregar sem curadoria seria adivinhação.

E é verdade: sem curadoria, o produto não pode dizer quanto custa a estrutura
administrativa de uma unidade. Somar despesa de ordenados com despesa de
encargos exige saber que as duas são montantes da mesma natureza, e isso é
decisão de curadoria, não de código.

**Mas conferir uma multiplicação não exige semântica nenhuma.** Se a tabela
declara que `Quantidade Ordenados × Salário Ordenados = Despesa Ordenados`, a
aritmética confere sozinha — e uma linha em que ela não fecha é uma pergunta
legítima para quem publica a tabela, com ou sem curadoria.

É essa distinção que esta auditoria explora:

| | Depende de curadoria? |
|---|---|
| "A estrutura administrativa custa R$ 312 mil" | **Sim.** Somar montantes exige saber que são montantes da mesma natureza. |
| "Em 7 cargos, quantidade × valor não dá a despesa declarada" | **Não.** É aritmética sobre colunas declaradas. |

---

## 2. O grão é o cargo — e um cargo não é uma pessoa

Nem placa nem trecho:

- **administrativo**: um cargo por unidade;
- **operacional**: um cargo por unidade e turno.

O dicionário do QLP ADM é explícito sobre a armadilha:

> `Cargo` — **É a chave da tabela**: cada linha é um cargo do quadro, e não uma
> pessoa. Quem diz quantas pessoas há é a coluna Quantidade correspondente.

Por isso a tela tem **dois** cartões onde uma tela descuidada teria um: *cargos
no quadro* (linhas) e *efetivo remunerado* (a soma das quantidades). Um quadro de
30 cargos pode remunerar 96 posições, e trocar um número pelo outro é o erro mais
fácil de cometer aqui.

O efetivo é, aliás, **a única soma que esta tela faz** — e ela é de gente, não de
dinheiro. Somar quantidade não depende de curadoria de semântica monetária.

---

## 3. Administrativo: a forma que resolve 21 das 37 colunas

O dicionário abre declarando a forma da tabela inteira:

```
Quantidade <rubrica>  ×  Valor <rubrica>  =  Despesa <rubrica>
```

para seis rubricas — Benefício, Encargos, Frota Leve, Ordenados, Telefonia e
Uniformes. **Só a Despesa é dinheiro.** A quantidade é efetivo, o valor é preço
unitário, e somar qualquer um dos três com outro conta a mesma estrutura duas
vezes.

Nos ordenados e nos encargos o par muda de nome mas não de natureza — o "valor"
se chama `Salário Ordenados` e `Salário Encargos`. É por isso que, no código, o
trio é uma função com três códigos explícitos e não uma convenção de sufixo:
emparelhar por nome quebraria justamente nas duas rubricas que mais pesam.

### O benchmark é régua, não custo

Duas colunas ficam fora de qualquer total e ganham conferência própria:

> `QLP Benchmark Quantidade` — **É a régua da auditoria bimestral do QLP ADM**: a
> diferença entre benchmark e realizado é o que vira não conformidade, e a
> consequência financeira dela está no bloco DESCONTO QLP ADM do Book.

A tela mostra quantos cargos estão acima, abaixo e iguais à referência, e a maior
distância entre salário praticado e salário de referência. **Ela não calcula
desconto nenhum:** a regra que transforma diferença em dinheiro está no Book, não
em coluna alguma do acervo. O que a tela entrega é o insumo daquela conversa.

### O vale-transporte fica fora de toda soma

É a segunda das "três coisas a resolver antes de somar" do dicionário:

> **`Vale Transporte` pode já estar dentro de `Despesa Benefício`.** Os rótulos
> admitem as duas leituras, e a diferença entre elas é o valor inteiro do
> vale-transporte do quadro.

Enquanto a Ambev não responder qual é, ele fica fora de toda soma — marcado e
dito, não escondido.

### E o rótulo que ninguém adivinharia

A terceira: `Quantidade Encargos` veio como "QUANTIDADE DE BENEFICIO ENCARGO
REMUNERADO", aparentemente herdando a palavra da linha de cima. A dúvida está no
ⓘ da coluna, onde quem lê a conferência daquela rubrica vai encontrá-la.

---

## 4. Operacional: a cadeia dos subtotais

A tabela de equipe tem o problema inverso, e maior. Nove colunas são **subtotais
das outras**, e convivem com elas na mesma linha:

> **Nove destas colunas são subtotais, e somá-las com as parcelas dobra a
> folha.** A cadeia que a tabela sugere — **a confirmar, não medida**:
>
> ```
> piso + adicional noturno + DSR + abono                → salarioFixo
> salarioFixo + parcelas de folha                       → remuneracaoContraCheque
> remuneracaoContraCheque + encargos e provisões        → remuneracaoFixa
> alimentação + saúde + transporte + seguro de vida     → totalBeneficioFixo
> remuneracaoFixa + totalBeneficioFixo + uniforme/EPI   → total
> ```

**"A confirmar, não medida" é exatamente a lacuna que esta tela preenche.** Ela
recalcula cada degrau a partir das parcelas e compara com a coluna que o declara.
No dia em que o primeiro export entrar, a cadeia deixa de ser proposta.

### Três degraus, e não cinco

A tela confere **três**:

| Degrau | Confere? | Por quê |
|---|---|---|
| `salarioFixo` | sim | as quatro parcelas têm coluna |
| `remuneracaoContraCheque` | **não** | "parcelas de folha" não nomeia colunas |
| `remuneracaoFixa` | sim | as duas parcelas têm coluna |
| `totalBeneficioFixo` | **não** | "alimentação, saúde, transporte e seguro" agrupa sete colunas por rótulo analítico, e a composição exata não está declarada |
| `total` | sim | as três parcelas têm coluna |

Inventar quais são as "parcelas de folha" para fazer a conta fechar seria
exatamente o que este produto não faz. A ligação fica declarada na tela como não
conferível, que é a informação verdadeira.

### O abono explica a queda que ninguém negociou

O dicionário guarda uma observação que vale uma tela inteira:

> Quando a janela do abono se encerra, `valorAbonoAplicado` deixa de acompanhar
> `valorAbono` e o total cai sozinho. **É o tipo de movimento que, sem estas duas
> colunas à vista, vira um chamado procurando erro onde há regra.**

O painel do abono é essa vista: quantos cargos têm abono acordado, em quantos ele
já não é aplicado por inteiro, em quantos a janela parece encerrada, e quanto
dinheiro está nessa diferença. É **regra, não achado** — e é justamente por isso
que precisa estar visível.

### E a coluna sem nome

`outro` não soma, e o motivo é do dicionário: *"uma coluna sem nome dentro de um
total é a forma mais silenciosa de dobrar ou esconder um custo"*.

---

## 5. As decisões de medida

**A folga é de meio por cento, com piso de um centavo.** As colunas chegam
arredondadas a centavos, e um produto de dois valores arredondados carrega no
máximo a soma dos erros relativos dos dois — muito abaixo disso para qualquer
salário ou quantidade realista. O piso existe porque meio por cento de R$ 1,20 é
menos de um centavo, e uma diferença de arredondamento apareceria como
divergência numa rubrica de valor baixo.

**Uma parcela ausente não vira zero.** Uma despesa conferida contra uma
quantidade que não veio daria "esperado R$ 0,00, declarado R$ 48 mil" e acusaria
de divergência uma linha que só está incompleta. *Falta base* é uma resposta, e é
diferente de *diverge*.

**Divergir decide antes de faltar base.** Uma linha em que cinco contas fecham e
uma não é uma linha que diverge, não uma linha incompleta — e chamá-la de
incompleta esconderia a única conta que importa ali.

**A soma das diferenças vai com sinal.** Dois cargos que erram R$ 500 para lados
opostos não são um erro de R$ 1.000 na estrutura.

---

## 6. Por que esta auditoria não compara vigências

Porque a pergunta já tem dono. As vigências de QLP são snapshots como quaisquer
outros, e o motor canônico as compara — a aba **Alterações** do QLP
Administrativo faz exatamente isso desde que existe, e o cabeçalho de
`routes/qlp.ts` registra a decisão.

O que não tinha tela é a conferência **dentro** de uma vigência. São duas
perguntas diferentes:

| Pergunta | Onde |
|---|---|
| O que mudou entre duas vigências? | aba Alterações, sobre o motor canônico |
| O quadro fecha as contas que ele mesmo declara? | aba Auditoria / tela do QLP Operacional |

---

## 7. A tela do operacional existe antes do arquivo

É a única desta série que sai do catálogo de telas em preparo **sem o dado**, e
vale dizer por quê.

O que o verbete pedia continua faltando: as linhas de QLP operacional não chegam
neste banco. Mas o grão está definido na importação (`QLP_OPERACIONAL`, unidade +
cargo + turno), as colunas estão no dicionário, e as contas estão declaradas.
Uma tela que confere essas contas é o instrumento que as confirma no dia em que o
export entrar — e, até lá, ela diz a frase verdadeira em vez de mostrar um quadro
vazio que pareceria uma operação sem gente.

É o mesmo desenho que `lib/ingest/src/tipos.ts` já adota para caminhão,
carroceria e empilhadeira: *"Até chegar o primeiro arquivo, a tela 360° de cada
um diz que aquele tipo não existe neste contexto, que é a verdade."*

---

## 8. O que a auditoria faz com cada fato

| Fato | Onde ele vira comportamento |
|---|---|
| Quantidade, valor e despesa são três naturezas | `papel` no catálogo; nenhuma soma entre elas |
| `Quantidade × Valor = Despesa`, seis vezes | as seis contas do administrativo |
| Benchmark é régua da auditoria bimestral | painel próprio, sem calcular desconto |
| VT pode estar dentro da despesa de benefício | `foraDaSoma` com a dúvida escrita |
| Nove subtotais na tabela de equipe | `papel: SUBTOTAL` e `foraDaSoma` em todos |
| A cadeia é "a confirmar, não medida" | três degraus conferidos, dois declarados não conferíveis |
| O abono explica a queda sem negociação | painel do abono acordado × aplicado |
| `outro` é coluna sem nome | fora de toda soma, com o motivo |
| Um cargo não é uma pessoa | dois cartões: cargos e efetivo |
| A chave não se lê | `labelRaw` em `getEntityTable`, nome legível na tabela |

---

## 9. O que continua faltando

1. **A curadoria da semântica.** Enquanto os atributos do QLP não forem
   confirmados, o custo da estrutura continua travado — nesta tela e na do
   quadro. A auditoria das contas não substitui isso: ela confere a planilha
   contra si mesma, não contra a realidade.
2. **O export do QLP operacional.** Sem ele, a tela do operacional é um
   instrumento pronto e sem o que medir.
3. **A regra do DESCONTO QLP ADM.** A diferença contra o benchmark está medida; a
   fórmula que a transforma em desconto está no Book, e não em coluna nenhuma
   deste acervo.
4. **As duas ligações da cadeia que não se conferem.** "Parcelas de folha" e a
   composição exata de `totalBeneficioFixo` são perguntas para a Ambev — e, com o
   arquivo em mãos, perguntas que a própria tela ajuda a formular.
