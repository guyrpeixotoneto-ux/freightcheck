# Diff conceitual — bloco de curadoria aprovada

> O que mudou no comportamento do produto, não no código.
> **A semântica versionada não foi implementada** — segue como proposta.

---

## 1. Impacto calculável: 47 → 345

Confirmado. As 298 previstas na auditoria entraram, e nada mais.

```
antes:  CALCULATED  47      NOT_CALCULABLE  3.177
depois: CALCULATED  345     NOT_CALCULABLE  2.879
```

O número de alterações não se moveu: **3.202** antes e depois. Curadoria
precifica alterações, nunca as cria nem as destrói. Isso agora é um teste.

---

## 2. O defeito que a aprovação expôs

Enquanto só `custoFixo` estava confirmado, o total de impacto era homogêneo —
tudo mensal. No instante em que `cavalo.ipvaLicenciamento` foi confirmado como
**anual**, o campo escalar `calculated_impact` passou a somar coisas que não
somam:

```
Dez/2025 → Jan/2026
  antes da correção:  R$ -757.009,57            ← R$/ano + R$/mês num número só
  depois:             R$ -590.437,65 / anual
                    + R$ -166.571,92 / mensal
```

Esse era exatamente o erro que o produto existe para pegar, cometido pelo
produto. A causa foi minha: ao ampliar o conjunto confirmado, não revi a
agregação que dependia de haver uma única periodicidade.

**Correção (migration `0004_impact_by_periodicity`):** o escalar
`calculated_impact` foi **removido** e substituído por
`calculated_impact_by_periodicity`, um jsonb com um valor por periodicidade.
Não é rename — é coluna nova com semântica diferente, e a antiga foi
descartada porque seu conteúdo era justamente o número inválido. Nenhum dado
de origem foi tocado: change sets são derivados e foram recomputados.

Três invariantes agora travadas por teste:

- mensal e anual nunca colapsam num total;
- nenhuma conversão implícita: o impacto de um atributo anual é a diferença
  crua, sem dividir nem multiplicar por 12;
- um impacto sem periodicidade declarada ganha bucket próprio
  (`SEM_PERIODICIDADE`), nunca é jogado em MENSAL por omissão.

Conversão para base comum continua **fora de escopo** — é F4, e precisa de
regra explícita e determinística, não de um `/12` escondido numa agregação.

---

## 3. As 11 mudanças de classificação

Cinco eram as identificadas na auditoria. Seis vieram junto porque a causa era
uma só: a ordem das regras em `guessTaxonomyCode`, que testava palavra
descritiva antes de palavra de custo.

### Os 5 aprovados

| Atributo | Antes | Depois | Motivo |
|---|---|---|---|
| `carreta.finame_implemento` | Especificação técnica | **Financiamento e juros** | "implemento" vencia "finame" |
| `carreta.juros_finame_implemento` | Especificação técnica | **Financiamento e juros** | idem |
| `carreta.amortizacao_implemento` | Especificação técnica | **Depreciação e amortização** | idem |
| `carreta.lucro_fixomodelo_novo_ciclo` | Identificação do ativo | **Remuneração de capital** | "modelo" vencia "lucro_fixo" |
| `cavalo.lucro_fixomodelo_novo_ciclo_cavalo` | Identificação do ativo | **Remuneração de capital** | idem |

### Os 6 que vieram junto

| Atributo | Antes | Depois | Motivo | Julgamento |
|---|---|---|---|---|
| `carreta.lucro_fixomodelo_novo_ciclo_carreta` | Identificação do ativo | **Remuneração de capital** | "modelo" vencia "lucro_fixo" — mesma família dos dois acima | Correção clara |
| `carreta.pneu_medida_empurrada` | Especificação técnica | **Pneus** | "medida" vencia "pneu" | Correção clara |
| `cavalo.pneu_medida_empurrada` | Especificação técnica | **Pneus** | idem | Correção clara |
| `cavalo.combustivel_capacidade` | Especificação técnica | **Combustível** | "capacidade" vencia "combustivel" | Correção clara |
| `carreta.periodo_finame` | Contrato e vigência | **Financiamento e juros** | "periodo" vencia "finame" | **Decisão sua** |
| `cavalo.periodo_finame` | Contrato e vigência | **Financiamento e juros** | idem | **Decisão sua** |

**Nenhum dos 6 é monetário confirmado**, então nenhum valor financeiro se
moveu por causa deles:

```
carreta.lucro_fixomodelo_novo_ciclo_carreta   PRESUMED   monetário
carreta.periodo_finame                        UNKNOWN    —
cavalo.periodo_finame                         UNKNOWN    —
carreta.pneu_medida_empurrada                 PRESUMED   —
cavalo.pneu_medida_empurrada                  PRESUMED   —
cavalo.combustivel_capacidade                 PRESUMED   não monetário
```

### O `periodoFiname` é o único discutível

É o prazo do FINAME em meses (60), não um custo. Sob "Financiamento e juros"
ele aparece no filtro de **custo fixo**, o que se defende — um prazo caindo de
60 para 48 meses é uma mudança de financiamento que muda o custo fixo. Mas é
uma coluna não monetária dentro de um grupo de custo, e se você preferir
"Contrato e vigência" eu reverto: é uma linha.

As 11 estão agora travadas **atributo a atributo** em teste, com o motivo de
cada uma. Nenhuma reordenação futura consegue mover uma classificação em
silêncio.

---

## 4. Suíte

| Pacote | Testes | Novos neste bloco |
|---|--:|--:|
| `ingest` | 63 | — |
| `curation` | 45 | 3 |
| `comparison` | 35 | 6 |
| **total** | **143** | **9** |

Os novos, um por invariante que você pediu:

- mensal + anual exibido como total único → impossível (2 testes: unitário e
  na série real);
- conversão implícita de periodicidade → o delta anual permanece cru;
- bucket próprio para periodicidade não declarada;
- regressão das 298 → 345 calculáveis e 3.202 alterações, na série real;
- classificação indevida → as 11 travadas com motivo, mais 8 casos cadastrais
  que **não** podem se mover.

---

## 5. O que não foi feito

A **semântica versionada** segue como proposta em
`docs/PROPOSTA-SEMANTICA-VERSIONADA.md`, aguardando suas três decisões
(`calculation_basis`, vigência por data × snapshot, retroatividade da
correção).

Vale registrar que este bloco reforçou o argumento dela: o impacto anual de
**R$ -590.437,65** em Dez→Jan é majoritariamente a troca de fórmula do IPVA —
de 2,52% médio para 1,000% fixo. O número está aritmeticamente certo, mas sua
*causa* não é representável hoje. É para isso que `calculation_basis` existe
na proposta.
