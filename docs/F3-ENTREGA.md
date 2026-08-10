# FreightCheck — Entrega F3 (Alterações e Comparar)

> Auditoria do modelo, motor de comparação, API e telas.
> Waterfall, IA, alertas, fórmulas e simulação **não** foram implementados.

---

## 1. Auditoria do modelo — o veredito

**O modelo sustenta a comparação.** Verifiquei empiricamente antes de escrever
qualquer código: a consulta de diff sobre `fact`, pareando por
`(entity_id, attribute_id)`, reproduz exatamente o baseline estabelecido na
análise original do arquivo.

| Pergunta | Sustentada por | Verificado |
|---|---|---|
| 1. O que mudou? | `fact` de A × B, pareado por identidade | 593 alterações Jun→Jul — bate com o baseline |
| 2. Antes / agora | colunas tipadas dos dois lados | ✓ |
| 3. Variação abs. e % | `value_numeric` dos dois lados | ✓ |
| 4. Aba, linha, coluna | `fact.raw_cell_id` → `raw_row` → `raw_sheet`, **dos dois lados** | L374 → L436, coluna AU |
| 5. Materialidade | `attribute` (unidade, periodicidade, agregação, semântica) | ✓ (depende de curadoria, por desenho) |
| 6. Custo fixo / variável | `taxonomy_node.cost_class` | **✗ — era a lacuna** |
| 7. Atributo novo | `snapshot_attribute` de B − A | ✓ |
| 8. Atributo removido | `snapshot_attribute` de A − B | ✓ |
| 9. Textual × valor efetivo | `attribute.data_type` + colunas tipadas | ✓ |
| 10. Inconclusivo por semântica | `attribute.semantics_status` | ✓ |

### A lacuna encontrada

**`cost_class` não era consultável.** Ela é declarada nos nós CLASS
(`custo_fixo`, `custo_variavel`) e herdada pelos descendentes, mas **todo
atributo está pendurado num nó GROUP**. Um join simples
`attribute → taxonomy_node` devolvia `NULL` para os 138 atributos:

```
 cost_class | atributos
------------+-----------
            |       138
```

A pergunta 6 era, literalmente, irrespondível.

**Fechada sem migration.** `taxonomy_node.path` já é materializado, então o
ancestral mais próximo que declara classe é o maior `path` que é prefixo do
meu — um lateral join, sem recursão. Está em `classification.ts`.

### Outras observações da auditoria

| Observação | Tratamento |
|---|---|
| `value_hash` é produzido pelo importador, então snapshots lidos por versões diferentes do parser poderiam divergir | O motor compara a **tupla tipada**, não o hash. Imune a mudança de parser, e não custa nada a mais dado o join |
| Não havia regra para "snapshot anterior" | `findPreviousSnapshot`: mesma fonte, escopo e cobertura, maior data anterior, **excluindo superseded** |
| Comparar escopos ou coberturas diferentes produziria ruído puro | O motor **recusa**, com mensagem explicando |
| `_id` (UUID por linha) poderia gerar ruído | Verificado: 0 alterações. É estável por placa dentro do arquivo |
| Semântica da **fonte** mudando entre snapshots | Não representável hoje: `attribute.unit` é global. Fora do escopo de F3 — fica registrado |

---

## 2. Os três eixos

Conflatá-los esconde os dois. O motor separa:

| Categoria | O que é | Exemplo real |
|---|---|---|
| `SOURCE_CHANGE` | valor mudou num ativo presente nos dois lados | IPVA 4.096,31 → 2.513,19 |
| `FLEET_CHANGE` | ativo entrou ou saiu | Abr→Mai: +4 / −11 |
| `LAYOUT_CHANGE` | coluna apareceu ou sumiu do export | nenhuma neste arquivo |

Um ativo que sai gera **uma** mudança, não ~70. É o que faz Abr→Mai render
368 alterações em vez de ~1.100.

---

## 3. Regras que você pediu, e onde cada uma vive

| Regra | Implementação |
|---|---|
| Nunca comparar por posição da linha | Pareamento por `(entity_id, attribute_id)`. Teste: mesma frota em ordem invertida → 1 alteração, não 3 |
| Identidade semântica estável | `entity_id` vem de `entity_identifier` (placa/chassi com histórico) |
| Não transformar UNKNOWN em certeza | `assessImpact` barra tudo abaixo de `CONFIRMED`, com motivo |
| Comparação inconclusiva explícita | `comparability` + `inconclusive_reason` em cada linha |
| Rastrear os dois lados até o arquivo | `fact_a_id` / `fact_b_id` → `raw_cell`. Visível ao expandir a linha |
| Não esconder baixo valor | Materialidade só **ordena**. Teste: variação de R$ 1 fica em último, mas está lá |
| Reimportar não gera alteração falsa | Teste: revisão 2 × revisão 1 do mesmo arquivo → **0 alterações**, 9.123 sem alteração |

---

## 4. Política de impacto

Herdada de §7 da arquitetura, agora executável. As travas disparam nesta ordem:

1. comparação inconclusiva → não há variação a monetizar;
2. semântica ≠ `CONFIRMED` → *"somar sua variação seria adivinhação"*;
3. não é montante financeiro → a variação existe, mas não vira dinheiro;
4. agregação ≠ `SUM` → não se acumula num total;
5. algum lado não numérico → não há diferença a calcular.

Passando por tudo: `impact = valor novo − valor anterior`, **na periodicidade
do próprio atributo**. Anualizar é F4.

Hoje isso significa que só `carreta.custo_fixo` produz impacto apurado — os
outros 262 ficam fora da soma, e a tela diz isso em vez de exibir zero.

---

## 5. Resultado sobre o arquivo real

```
EMPURRADA_2_12_2025 → 2_1_2026    560 valores   impacto  R$ -33.783,13
EMPURRADA_2_1_2026  → 2_2_2026    346 valores   +4 ativos
EMPURRADA_2_2_2026  → 2_3_2026    397 valores   75 inconclusivas
EMPURRADA_2_3_2026  → 2_4_2026    402 valores   impacto  R$  16.588,39
EMPURRADA_2_4_2026  → 2_5_2026    368 valores   +4/-11 ativos
EMPURRADA_2_5_2026  → 2_6_2026    269 valores   impacto  R$ -20.996,92
EMPURRADA_2_6_2026  → 2_7_2026    593 valores   impacto  R$ -11.712,29
EMPURRADA_2_7_2026  → 1_8_2026    267 valores   62 inconclusivas
                                ─────
                                3.202   ← exatamente o baseline
```

As inconclusivas são legítimas e explicadas:

- **75** — `frotaEmprestada` passou a existir onde não havia valor. Não há
  variação a calcular.
- **62** — `dataFimContrato`, a coluna que a fonte tipa de dois jeitos.

---

## 6. Telas

**Alterações** — a última vigência contra a anterior, calculada sob demanda.
Cartões no topo (valores alterados, ativos +/−, colunas +/−, impacto apurado,
inconclusivas), aviso de quantas ficaram fora da soma e por quê, filtros, e a
tabela pedida:

`Atributo | Antes | Agora | Variação | Impacto | Classificação | Origem`

Expandir uma linha mostra os dois lados até a célula — aba, linha, coluna,
cabeçalho, valor e tipo originais.

**Comparar** — as mesmas ferramentas, com o par escolhido à mão.

**Filtros:** classe (fixo/variável/sem classe), tipo de mudança, status
semântico, comparabilidade, impacto apurado, materialidade mínima e busca por
atributo ou placa. Todos com contagem ao lado.

---

## 7. API

| Método | Rota |
|---|---|
| GET | `/api/snapshots` |
| GET | `/api/changes/latest` — a última vigência contra a anterior |
| GET | `/api/change-sets` |
| POST | `/api/change-sets` — comparar duas quaisquer |
| GET | `/api/change-sets/:id/changes` — com filtros |
| GET | `/api/changes/:id/provenance` — os dois lados até a célula |

---

## 8. Testes — 29 em F3 (134 no total)

| Arquivo | Testes | Cobre |
|---|--:|---|
| `comparison.test.ts` | 19 | Snapshots idênticos; numérica; percentual (e recusa de dividir por zero); zeramento; textual; UNKNOWN; aparecimento/desaparecimento; troca de motivo de ausência; entrada/saída de ativo; coluna nova/removida; identidade × posição; herança de classe de custo; ordenação por materialidade |
| `comparison-real.test.ts` | 10 | Baseline por transição e total; movimentação de frota; rastreabilidade dos dois lados; inconclusivas classificadas e não escondidas; filtros somam o todo; **revisão 2 × revisão 1 → zero**; escolha do anterior; recomputar não acumula |

---

## 9. Ainda em aberto

1. **A periodicidade dos 25 monetários.** É o que separa "267 alterações" de
   "267 alterações valendo R$ X". Sem isso, 262 das 267 ficam sem preço.
2. **Semântica da fonte mudando entre snapshots** não é representável.
3. **Anualização e waterfall** são F4.
