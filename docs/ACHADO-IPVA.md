# O par `ipvaLicenciamento` — investigação e resolução

> Aberto em F2 como "conflito de periodicidade bloqueante". Fechado como
> **homonímia**, mais um achado de mudança de fórmula que ninguém tinha visto.

---

## 1. O que eu tinha diagnosticado — e por que estava errado

O detector original comparava os **totais da frota**:

```
ipvaLicenciamentoMensal  soma R$ 23.343,88
ipvaLicenciamento        soma R$ 10.875,69   →  razão 2,15×
```

Como 2,15 não é 1/12, concluí "a nomenclatura mente" e bloqueei os dois lados.

O raciocínio tinha um furo: **comparar totais não distingue "mesma grandeza com
rótulo errado" de "duas grandezas diferentes com nomes parecidos".** Duas
colunas sem relação nenhuma somam para qualquer razão que se queira.

O teste correto é a razão **por ativo**. Uma grandeza medida duas vezes
acompanha ativo a ativo; duas grandezas distintas, não.

---

## 2. O que os dados dizem

### As duas colunas de carreta não se acompanham

Razão `mensal / anual` entre as 71 carretas, em Ago/2026:

| | |
|---|--:|
| menor | −3,01× |
| média | 2,10× |
| maior | 5,23× |
| dispersão (desvio/média) | **63%** |

Se fossem a mesma grandeza, a razão seria constante. Ela varia de negativa a
5×. **São coisas diferentes que compartilham o prefixo do nome.**

O que cada uma parece ser:

- **`ipvaLicenciamento`** — praticamente fixa em **R$ 140–152 por carreta**,
  independente do valor do implemento (R$ 140,34 tanto para uma carreta de
  R$ 156 mil quanto para uma de R$ 283 mil). 438 das 657 linhas são exatamente
  R$ 150,00. Comportamento de **taxa fixa de licenciamento**, não de IPVA — o
  que é coerente com semirreboque, isento de IPVA na maior parte dos estados.
- **`ipvaLicenciamentoMensal`** — varia de R$ 435 a R$ 733, sem proporção nem
  com a coluna anterior nem com o valor da NF.

### Cavalos: aqui a resposta é aritmética

`cavalo.ipvaLicenciamento` como percentual de `valorNfCompra`, por vigência:

| Vigência | Placas | % mín. | % médio | % máx. | Desvio |
|---|--:|--:|--:|--:|--:|
| Dez/2025 | 60 | 0,815 | 2,521 | 3,711 | 0,849 |
| **Jan/2026** | 60 | **1,000** | **1,000** | **1,000** | **0,0000** |
| Fev/2026 | 62 | 1,000 | 1,000 | 1,000 | 0,0000 |
| Mai/2026 | 62 | 1,000 | 1,000 | 1,000 | 0,0000 |
| Jun/2026 | 62 | 1,000 | 1,000 | 1,000 | 0,0000 |
| **Jul/2026** | 62 | 0,535 | **0,651** | 1,193 | 0,119 |
| Ago/2026 | 62 | 0,535 | 0,651 | 1,193 | 0,119 |

**De Janeiro a Junho de 2026 o valor é exatamente 1,000% do valor da nota, para
todas as 62 placas, com desvio zero.** Isso não é dado — é fórmula.

---

## 3. O achado que a investigação revelou

A queda de R$ 720 mil que eu tinha reportado na arquitetura **não foi uma
mudança de valor. Foi uma troca de fórmula, duas vezes:**

1. **Dez/2025** — valor real por veículo, variando de 0,8% a 3,7% da NF
   (média 2,52%). Parece IPVA de verdade, calculado placa a placa.
2. **Jan/2026** — todo mundo passa a **1,000% da NF**, fixo. O cálculo por
   veículo foi substituído por um percentual único.
3. **Jul/2026** — muda de novo, agora para uma média de **0,651%**, variável
   outra vez.

Do primeiro para o último regime, a linha de IPVA da frota de cavalos caiu de
**R$ 989.844 para R$ 268.952**.

E a periodicidade fica resolvida por aritmética: **1% do valor do veículo ao
ano** é uma alíquota anual plausível. Se fosse mensal, daria 12% ao ano — o que
não existe.

---

## 4. Qualidade de dado, de quebra

| Achado | Onde |
|---|---|
| **15 valores negativos** em `carreta.ipvaLicenciamento`, até **−R$ 1.709,86** | crédito/estorno, ou erro |
| 6 valores negativos em `carreta.ipvaLicenciamentoMensal` | idem |
| Nenhum negativo em `cavalo.ipvaLicenciamento` | — |

Um custo de licenciamento negativo ou é estorno, ou é erro de cadastro. Nos
dois casos, entra numa soma e a distorce.

---

## 5. O que mudou no código

O detector deixou de assumir a premissa e passou a testá-la. Agora ele calcula
a razão por ativo e classifica em quatro veredictos — `CONSISTENT`,
`PERIODICITY_CONTRADICTION`, `DISTINCT_BASES` e `INSUFFICIENT_DATA` — e só o
segundo bloqueia. Homonímia é problema de vocabulário da fonte, não
contradição; bloquear os dois lados punia o curador pelo nome que a Ambev
escolheu.

Resultado no dado real: o par sai de bloqueado para **`PRESUMED` dos dois
lados**, com aviso de homonímia na justificativa. `cavalo.ipvaLicenciamento`
nunca foi afetado — não tem par.

Estado da curadoria: **3 CONFIRMED · 111 PRESUMED · 24 UNKNOWN** (eram 110/28).

---

## 6. O que ainda precisa de você

A periodicidade continua sendo decisão sua — o motor não propõe, por desenho.
Mas agora com evidência:

| Atributo | Evidência | Minha leitura |
|---|---|---|
| `cavalo.ipva_licenciamento` | 1,000% da NF, desvio zero, 6 vigências | **ANUAL** — mensal daria 12% a.a. |
| `carreta.ipva_licenciamento` | R$ 140–152 fixos, independentes do valor | **ANUAL**, e é licenciamento, não IPVA |
| `carreta.ipva_licenciamento_mensal` | R$ 435–733, sem relação com as outras | não sei o que é. Precisa da Ambev |

E três perguntas que a investigação levantou:

1. **Você sabia da troca de fórmula do IPVA?** Cálculo por veículo → 1% fixo →
   0,65% variável, em oito meses, R$ 720 mil a menos.
2. **O que é `ipvaLicenciamentoMensal` nas carretas?** Não é 1/12 do outro
   campo nem percentual da NF.
3. **Os 15 licenciamentos negativos são estorno ou erro?**
