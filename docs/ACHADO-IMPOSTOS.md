# Os impostos do acervo — o que é montante, o que é alíquota, e a coluna que ninguém preencheu

> Escrito para sustentar a Auditoria de Impostos (`/custo-fixo-impostos`).
> **Nada aqui é medição nova.** Cada número abaixo já estava medido e publicado
> noutro documento deste repositório ou em `CONFIRMED_SEMANTICS`, e a fonte de
> cada um está citada ao lado. O que este documento faz é reuni-los na ordem em
> que a tela os usa, e escrever as quatro decisões que eles obrigam.

---

## 1. As seis colunas de imposto do acervo

O export de remuneração por equipamento traz seis colunas de imposto sobre a
**compra do ativo** — duas de montante e quatro de alíquota:

| Coluna | Papel | Tipo | O que o time declara que ela é |
|---|---|---|---|
| `cavalo.valor_pis_cofins` | montante | BRL, PONTUAL | PIS/COFINS sobre a nota de compra |
| `carreta.valor_pis_cofins` | montante | BRL, PONTUAL | PIS/COFINS sobre a nota de compra |
| `cavalo.valor_icms` | montante | BRL | crédito de ICMS sobre insumos |
| `carreta.valor_icms` | montante | BRL | valor de ICMS conforme a compra |
| `cavalo.percentual_icms` | alíquota | PERCENT | % de ICMS conforme a compra do veículo |
| `carreta.percentual_icms` | alíquota | PERCENT | % de ICMS conforme o parâmetro da região da operação |
| `carreta.icms` | alíquota | PERCENT | ICMS de entrada do implemento (faixa 0 a 12) |
| `carreta.pis_cofins` | alíquota | PERCENT | alíquota de PIS/COFINS (faixa 0 a 9,3) |

Fontes: `docs/DICIONARIO-TABELA-DE-CAVALO.md`,
`docs/DICIONARIO-TABELA-DE-CARRETA.md` e `lib/db/src/semantica-confirmada.ts`
(as quatro alíquotas confirmadas como `PERCENT` / `aggregation: NONE`, e os dois
`valor_pis_cofins` como `BRL` / `PONTUAL`).

**A distinção montante × alíquota é a decisão mais cara desta rubrica.** Doze por
cento e R$ 37.890,84 são duas células numéricas; somadas, produzem um número que
não é de nada. É por isso que o papel de cada coluna é um campo do catálogo
(`VariavelDeImpostos.papel`), e não um comentário.

---

## 2. O PIS/COFINS de aquisição é fórmula, e é PONTUAL

Medido em `docs/AUDITORIA-PERIODICIDADE.md` (§ Cadeia C), sobre os 132 ativos:

```
valor_pis_cofins  =  9,250% × valor_nf_compra     desvio 0,0000
e nunca varia ao longo das 9 vigências
```

Duas consequências, e as duas aparecem na tela:

1. **Desvio zero não é dado, é fórmula.** A alíquota medida — montante sobre o
   valor de nota — cai exatamente no mesmo percentual em todos os ativos. O
   veredito da conferência chama isso de "percentual único da nota", com a cor de
   aviso, pela mesma razão que a Auditoria de IPVA usa: ninguém calculou ativo a
   ativo.
2. **É tributo de aquisição, não dedução do mês.** `PONTUAL` em
   `CONFIRMED_SEMANTICS`; incide uma vez, sobre a nota de compra. Somá-lo a uma
   rubrica mensal daria um número que não descreve nem o mês nem a compra — daí o
   impacto sair **por periodicidade**, nunca num total único.

E uma consequência sobre o que a tela mostra quando nada mudou: como o montante
não varia entre vigências, **a comparação vazia é o resultado esperado**. A
conferência da alíquota continua valendo, porque ela não olha o que mudou — olha
o que cada vigência declara.

---

## 3. `valor_icms` é coluna sem dado, não imposto zero

Medido em `docs/CLASSIFICACAO-DOS-NAO-APURADOS.md` e repetido em
`docs/DRE-DIAGNOSTICO.md`:

```
cavalo.valor_icms    zero em 558 de 558 fatos
carreta.valor_icms   zero em 657 de 657 fatos
                     ──────────────────────
                     zero em 1.215 de 1.215
```

Ao lado disso, as **alíquotas** de ICMS existem e são declaradas em toda linha —
`cavalo.percentual_icms`, `carreta.percentual_icms` e `carreta.icms`, esta última
com faixa observada de 0 a 12.

Alguém declarou a taxa; o dinheiro correspondente nunca foi preenchido. As duas
leituras erradas possíveis são simétricas, e a tela recusa as duas:

- **Somar a coluna** produziria um total de ICMS de R$ 0,00 com cara de medição —
  a forma mais fácil de o produto afirmar que não há ICMS. Por isso o montante de
  ICMS carrega `foraDaSoma`, aparece na tabela e no detalhe com o aviso, e em
  soma nenhuma.
- **Medi-la como alíquota** produziria "0,000% da nota, desvio zero, percentual
  único" — uma frase tecnicamente verdadeira e inteiramente enganosa, que
  descreveria como fórmula aplicada o que é coluna nunca preenchida. Por isso
  `aliquotaMedida` devolve `null` para montante zero, e o veredito próprio é
  **"alíquota declarada, montante ausente"**.

É o caso em que a distinção entre ausência e zero, que este produto aplica em
toda parte, vale um veredito inteiro.

---

## 4. A carreta declara duas alíquotas de ICMS, e nada diz qual vale

`carreta.icms` é o ICMS **de entrada do implemento**; `carreta.percentual_icms` é
o ICMS **conforme o parâmetro da região da operação**. São duas taxas declaradas
para o mesmo ativo, e os próprios nomes gerenciais dizem que têm origens
diferentes.

Com o montante zerado, **não há medida que diga qual delas foi aplicada** — a
conferência que resolveria a dúvida é justamente a que a coluna vazia impede.
Então:

- a conferência usa `percentual_icms`, que é a coluna que os dois tipos têm;
- `carreta.icms` fica no detalhe, dita por extenso, fora da conferência.

Escolher uma das duas seria adivinhar; esconder a segunda seria apagar o fato de
que há duas.

---

## 5. O imposto do frete não está aqui — e é metade do verbete

O verbete de `/custo-fixo-impostos`, enquanto ela era tela em preparo, pedia duas
coisas. A primeira — a alíquota **medida**, e não a declarada — está entregue, e é
o painel central da tela.

A segunda era a separação entre o imposto da compra do ativo e o imposto do
frete. Ela continua valendo, e a tela a cumpre **não fazendo a soma**:

- o imposto sobre a prestação mora na tabela de frete — `fretePisCofins`,
  `impostosIcmsIss`, `percentualIcmsIss`, `icmsIss` (`docs/DICIONARIO-TABELA-DE-FRETE.md`);
- aquele dicionário abre dizendo que a tabela de frete **não é a mesma fonte que
  este repositório apura hoje**, e que nenhuma das classificações dele foi
  confirmada contra valores reais;
- `docs/DRE-DIAGNOSTICO.md` registra a mesma coisa pelo outro lado: ICMS e
  PIS/COFINS **sobre a receita** não existem neste acervo.

Somar as duas grandezas sob o rótulo "Impostos" daria um total que não é de
nenhuma das duas. A tela diz isso no rodapé da conferência e na gaveta de cada
veículo, em vez de fingir a conta.

---

## 6. O que a tela faz com cada um destes fatos

| Fato | Onde ele vira comportamento |
|---|---|
| Alíquota não é montante | `papel` no catálogo; alíquotas fora do impacto e contadas em `aliquotasAlteradas`; coluna "Papel" no CSV |
| PIS/COFINS é 9,250% com desvio zero | veredito `FORMULA_UNICA`, com a cor de aviso |
| PIS/COFINS é PONTUAL | impacto por periodicidade, nunca um total único |
| `valor_icms` zerada em 1.215 linhas | `foraDaSoma` no catálogo; veredito `SEM_MONTANTE`; aviso sob o gráfico de total |
| Declarada × medida discordam | veredito `DIVERGEM`, com a maior distância medida ao lado |
| Declaração com uma casa decimal | tolerância de 0,05 p.p. — meia casa da última publicada |
| Duas alíquotas de ICMS na carreta | `carreta.icms` só no detalhe, fora da conferência |
| Imposto do frete em outra fonte | recusa escrita no rodapé da conferência e na gaveta |

---

## 7. O que continua faltando

1. **O regime tributário do ativo e o estado da operação.** São eles que diriam
   se 9,250% é a alíquota **devida**, e não só a praticada. A tela mede e
   confronta; ela não emite veredito fiscal, e diz isso por extenso.
2. **O montante de ICMS.** Enquanto a coluna não for preenchida, o ICMS deste
   acervo é uma taxa sem dinheiro. Vale perguntar à Ambev se ela deixou de ser
   preenchida — é a mesma pergunta que `docs/CLASSIFICACAO-DOS-NAO-APURADOS.md`
   já registrava.
3. **O imposto sobre a prestação.** Ele é o que pesa todo mês, e chega quando a
   tabela de frete virar fonte apurada por este banco. Aí serão duas rubricas
   lado a lado — nunca uma só.
