# Auditoria — os 27 atributos monetários sem periodicidade

> Nada foi alterado. Tudo abaixo é evidência para você decidir.
>
> Estado atual: **3.202 alterações de valor, das quais 47 têm impacto apurado
> (1,5%)**. Os outros 3.155 esperam por semântica.

---

## 1. As cadeias de evidência

Três delas são aritméticas — não interpretam nome de coluna, conferem contas.

### Cadeia A — a identidade do `custoFixo`

`carreta.custo_fixo` **você já confirmou como MENSAL**. E ele é a soma de duas
parcelas:

```
custo_fixo = finame + lucroFixomodeloNovoCiclo
```

Confere em **611 de 657 linhas (93,0%)**, em todas as 9 vigências. Exemplo real
(placa QYW3J49, Ago/2026): `11.858,88 = 4.395,36 + 7.463,52`.

Uma soma não muda de periodicidade no meio. Se o total é mensal, as parcelas
são mensais.

### Cadeia B — a matemática do FINAME

A amortização mensal de um financiamento é o valor financiado dividido pelo
prazo **em meses**. Testei exatamente isso:

```
amortizacao_implemento ÷ (valorNF × (1 − entrada%) ÷ periodoFiname)
```

| | Carretas | Cavalos |
|---|--:|--:|
| razão média | **1,108** | **1,081** |
| desvio | 0,018 | 0,040 |
| se fosse anual, a razão seria | 13,29 | ~13,0 |

A razão bate em ~1 com dispersão de 1,6%. O excedente de ~8–11% é
provavelmente ICMS ou tarifa embutida na base financiada. Lida como anual, a
conta erra por um fator de treze.

E a decomposição fecha: `finameImplemento = amortizacao + juros` em **37 de 38**
carretas com ambas as parcelas não nulas.

### Cadeia C — os valores de aquisição

Cinco colunas **nunca variam** ao longo das 9 vigências, para nenhum ativo:

```
valor_nf_compra, valor_pis_cofins, valor_icms, valor_pneus, custo_aluguel(cavalo)
→ 100% dos ativos com um único valor distinto
```

E `valor_pis_cofins` é **exatamente 9,250% de `valor_nf_compra`**, desvio
**0,0000**, nos 132 ativos. É tributo sobre a nota de compra — valor de
aquisição, não fluxo mensal.

### Cadeia D — o IPVA (da investigação anterior)

`cavalo.ipva_licenciamento` foi exatamente **1,000% do valor da NF, desvio
zero**, de Jan a Jun/2026. Um por cento ao ano é alíquota plausível; ao mês
daria 12% a.a.

---

## 2. A lista priorizada

Ordenada por quantas alterações hoje `NOT_CALCULABLE` cada confirmação
destrava.

### Alta confiança — evidência aritmética

| Atributo | Exemplo real | Grupo | Hoje | Proposta | Destrava |
|---|--:|---|---|---|--:|
| `cavalo.ipva_licenciamento` | 2.513,19 | Seguros e tributos | — | **ANUAL** | **122** |
| `carreta.finame` | 19.213,13 | Financiamento e juros | — | **MENSAL** | **47** |
| `cavalo.finame_cavalo` | 3.318,01 | Financiamento e juros | — | **MENSAL** | **37** |
| `cavalo.juros_finame_cavalo` | 6.857,67 | Financiamento e juros | — | **MENSAL** | **27** |
| `carreta.lucro_fixomodelo_novo_ciclo` | 7.463,52 | ⚠ Identificação | — | **MENSAL** | **16** |
| `carreta.finame_implemento` | 6.094,94 | ⚠ Especificação | — | **MENSAL** | **11** |
| `carreta.juros_finame_implemento` | 1.809,63 | ⚠ Especificação | — | **MENSAL** | **11** |
| `cavalo.amortizacao_cavalo` | 11.190,29 | Depreciação | — | **MENSAL** | **10** |
| `cavalo.lucro_fixomodelo_novo_ciclo_cavalo` | 3.318,01 | ⚠ Identificação | — | **MENSAL** | **10** |
| `carreta.amortizacao_implemento` | 4.285,31 | ⚠ Especificação | — | **MENSAL** | **7** |
| `carreta.valor_nf_compra` | 289.258,45 | Outros custos fixos | — | **PONTUAL** | 0 |
| `cavalo.valor_nf_compra` | 409.630,71 | Outros custos fixos | — | **PONTUAL** | 0 |
| `carreta.valor_pis_cofins` | 26.756,41 | Seguros e tributos | — | **PONTUAL** | 0 |
| `cavalo.valor_pis_cofins` | 37.890,84 | Seguros e tributos | — | **PONTUAL** | 0 |

**Subtotal: 298 alterações destravadas.** Levaria o impacto apurado de 47 para
**345** — 7,3× mais, cobrindo 10,8% de todas as alterações.

### Média confiança — evidência forte, mas indireta

| Atributo | Exemplo real | Grupo | Hoje | Proposta | Base | Destrava |
|---|--:|---|---|---|---|--:|
| `carreta.ipva_licenciamento` | 140,34 | Seguros e tributos | — | **ANUAL** | Fixo em R$ 140–152 independente do valor do implemento; 438 de 657 linhas são exatamente R$ 150. Taxa de licenciamento (semirreboque é isento de IPVA na maioria dos estados) | **144** |
| `carreta.lucro_fixomodelo_novo_ciclo_carreta` | 3.068,16 | ⚠ Identificação | — | **MENSAL** | Mesma família e mesmo perfil de estabilidade (91%) das confirmadas por aritmética, mas **sem identidade própria verificada** | **7** |
| `carreta.seguro` | 634,66 | Seguros e tributos | — | **MENSAL** | Ordem de grandeza (R$ 635/mês por implemento) e estabilidade de 91% são compatíveis; não achei identidade que feche | **8** |

### Baixa confiança — não recomendo confirmar

| Atributo | Exemplo real | Grupo | Destrava | Por que eu não sei |
|---|--:|---|--:|---|
| `carreta.ipva_licenciamento_mensal` | 733,49 | Seguros e tributos | **149** | É o caso da homonímia. Não é 1/12 do outro campo, não é percentual da NF, e não acompanha nenhuma outra coluna. Precisa da Ambev |
| `carreta.lucro_variavel_previsto` | 8.212,01 | Lucro variável | **113** | Varia muito (50% de estabilidade) e não fecha com nenhuma identidade que testei |
| `cavalo.lucro_variavel_previsto_cavalo` | 5.005,00 | Lucro variável | **107** | Idem |
| `carreta.lucro_variavel_previsto_carreta` | 3.207,01 | Lucro variável | **47** | Idem |

Juntos são **416 alterações** — mais do que todo o bloco de alta confiança.
São o maior prêmio e a maior incerteza ao mesmo tempo.

### Sem evidência possível — colunas zeradas

| Atributo | Situação | Destrava |
|---|---|--:|
| `carreta.valor_icms`, `cavalo.valor_icms` | 100% zero (657 e 558 fatos) | 0 |
| `carreta.valor_pneus`, `cavalo.valor_pneu` | 100% zero | 0 |
| `cavalo.custo_aluguel` | 100% zero | 0 |
| `carreta.custo_aluguel` | 633 de 651 zerados | 0 |

Não há o que inferir de uma coluna que só contém zero. Nenhuma delas produz
alteração hoje, então confirmá-las não destrava nada — mas o zero permanente
do ICMS é, por si, uma pergunta para a Ambev.

---

## 3. Um erro meu que a auditoria expôs

Cinco atributos marcados com ⚠ estão **classificados errado na taxonomia**:

| Atributo | Está em | Deveria estar em |
|---|---|---|
| `carreta.finame_implemento` | Especificação técnica | Financiamento e juros |
| `carreta.juros_finame_implemento` | Especificação técnica | Financiamento e juros |
| `carreta.amortizacao_implemento` | Especificação técnica | Depreciação e amortização |
| `carreta.lucro_fixomodelo_novo_ciclo` | Identificação do ativo | Remuneração de capital |
| `cavalo.lucro_fixomodelo_novo_ciclo_cavalo` | Identificação do ativo | Remuneração de capital |

A causa está em `guessTaxonomyCode`: a regra de "especificação técnica" testa
`implemento` **antes** da regra de financiamento, e a de "identificação" testa
`modelo` antes da de remuneração. `finameImplemento` contém "implemento";
`lucroFixomodeloNovoCiclo` contém "modelo".

O efeito é concreto: **R$ 6.094,94 por carreta de financiamento estão contados
como "especificação técnica"** no filtro de classe de custo da tela de
Alterações. É proposta, não confirmação, então nada financeiro saiu errado —
mas o filtro mente hoje, e o conserto é barato.

---

## 4. O que eu faria, se a decisão fosse minha

1. Confirmar o bloco de alta confiança (14 atributos) — 298 alterações, 7,3× o
   impacto apurado. A evidência é aritmética, não interpretativa.
2. Corrigir as 5 classificações erradas junto.
3. Levar à Ambev as três perguntas que só eles respondem:
   `ipvaLicenciamentoMensal`, a família `lucroVariavelPrevisto` (416 alterações
   dependem delas) e o ICMS permanentemente zerado.
4. Deixar `carreta.seguro` e o `_carreta` para depois: valem 15 alterações e a
   evidência é só circunstancial.
