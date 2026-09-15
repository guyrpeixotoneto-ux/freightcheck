# Resultado da reindexação dos quatro maiores índices

Executado em produção em 15/09/2026 por Guy, com
`scripts/manutencao/reindexar-os-quatro.sh --confirmar`, após autorização
explícita para estes quatro índices e mais nada.

Conferências prévias, todas limpas antes de qualquer escrita: nenhuma
importação em andamento ou aguardando decisão, nenhuma transação aberta há mais
de 30s, nenhum índice inválido preexistente, os quatro índices presentes.

---

## Antes e depois

| Índice | Antes | Depois | Redução | Tempo |
|---|--:|--:|--:|--:|
| `fact_raw_cell_idx` | 60 MB | 8.592 kB | 7,1x | 2s |
| `fact_snapshot_attribute_idx` | 159 MB | 25 MB | 6,4x | 2s |
| `fact_grain_uq` | 172 MB | 25 MB | 6,9x | 1s |
| `staged_fact_grain_uq` | 355 MB | 54 MB | 6,6x | 3s |
| **soma** | **746 MB** | **112 MB** | | **8s** |

| | Antes | Depois |
|---|--:|--:|
| Banco | 1.337 MB | **704 MB** |
| Recuperado | | **633 MB** |
| `bytes_por_celula` | 3.252 | **1.713** |
| Índices inválidos | 0 | **0** |
| Sobras `%_ccnew%` | 0 | **0** |

Nenhum dado alterado, nenhum schema alterado, nenhuma tela afetada.

## A segunda execução, e por que ela vale ser registrada

O script foi rodado uma segunda vez logo em seguida. Os quatro índices voltaram
**idênticos** — 8.592 kB → 8.592 kB, 25 → 25, 25 → 25, 54 → 54 — e o resultado
foi `recuperado: 0 bytes`.

Isso é a prova de idempotência: a primeira passada recuperou tudo o que havia, e
os índices estão agora no tamanho natural deles. O script é seguro para repetir,
e repetir não é como se conserta nada — é como se confirma que já está
consertado.

## Onde a estimativa errou

**Previ 671 MB de recuperação para os quatro; vieram 633 MB — 6% a mais do que
havia.** E previ que `bytes_por_celula` cairia "para perto de 1.000"; caiu para
1.713.

A causa é a mesma nas duas: o "mínimo teórico" de
`densidade-dos-indices.sql` §2 calcula o espaço das **chaves** com páginas 90%
cheias, e ignora as páginas internas da árvore. Um btree saudável fica ~1,4 a
1,6x acima desse piso:

| Índice | Piso calculado | Real depois | Fator |
|---|--:|--:|--:|
| `fact_raw_cell_idx` | 5.968 kB | 8.592 kB | 1,44x |
| `fact_snapshot_attribute_idx` | 17 MB | 25 MB | 1,47x |
| `fact_grain_uq` | 17 MB | 25 MB | 1,47x |
| `staged_fact_grain_uq` | 34 MB | 54 MB | 1,59x |

**Era um piso, e eu o tratei como previsão.** Para a próxima estimativa, o piso
da consulta multiplicado por ~1,5 é o número a usar. Os fatores de inchaço
medidos (9 a 10x) não mudam — o que muda é para onde eles caem.

## O que sobrou

```
heap      195 MB
índices   482 MB     ← ainda 2,5x o heap
banco     704 MB
```

Os doze índices não tocados ainda carregam inchaço — `raw_cell_row_column_uq`,
`fact_pkey`, `raw_cell_pkey`, `staged_fact_pkey` e os menores. A estimativa
original dava ~210 MB ali; corrigida pelo erro de 6% e pelo fator 1,5 acima,
fica em **~180 MB**. Uma segunda passada levaria o banco a ~520 MB.

**Autorizado por Guy em 15/09/2026, logo após esta primeira passada.** Rodar
com:

```bash
PRODUCTION_DATABASE_URL='postgres://…' \
  ./scripts/manutencao/reindexar.sh --confirmar --os-restantes
```

São **treze** índices, não doze: os doze que a medição listou acima do corte de
8 MB, mais `change_pkey`, que ficou de fora daquela consulta por ser pequeno
(3,7 MB) e é o **maior fator do banco** (~20x).

Expectativa, já usando o fator 1,5 aprendido nesta primeira passada:

| Índice | Hoje | Esperado | Recupera |
|---|--:|--:|--:|
| `raw_cell_row_column_uq` | 53 MB | ~17 MB | ~36 MB |
| `fact_pkey` | 42 MB | ~9 MB | ~33 MB |
| `staged_fact_pkey` | 35 MB | ~9 MB | ~26 MB |
| `staged_fact_raw_cell_idx` | 35 MB | ~9 MB | ~26 MB |
| `raw_cell_pkey` | 37 MB | ~14 MB | ~23 MB |
| `fact_entity_attribute_idx` | 35 MB | ~20 MB | ~15 MB |
| `change_pkey` | 3,7 MB | ~0,3 MB | ~3,4 MB |
| `fact_attribute_idx` | 15 MB | ~12 MB | ~3 MB |
| `fact_origin_import_run_idx` | 13 MB | ~12 MB | ~1 MB |
| `fact_snapshot_entity_idx` | 20 MB | ~20 MB | ~0,5 MB |
| `raw_cell_row_idx` | 11 MB | ~11 MB | **~0** |
| `staged_fact_run_idx` | 11 MB | ~11 MB | **~0** |
| `staged_fact_run_label_idx` | 12 MB | ~12 MB | **~0** |
| **total** | **322 MB** | **~156 MB** | **~167 MB** |

Banco esperado depois: **~540 MB**.

**Quatro deles vão recuperar praticamente nada, e isso é o esperado, não
falha.** `raw_cell_row_idx`, `staged_fact_run_idx`, `staged_fact_run_label_idx`
e `fact_origin_import_run_idx` mediram fator 0,9 a 1,6 — já estão sadios. Entram
porque custam segundos e porque um "0 bytes" neles é a confirmação disso. Se
vierem com recuperação alta, aí sim é a estimativa que está errada, e vale
parar para entender.

## O que mudou na projeção

Com a janela corrigida (7 dias reais, não 90 fixos) e o banco já reindexado:

| | |
|---|--:|
| Ritmo medido | 62.420 células/dia |
| `bytes_por_celula` | 1.713 |
| Se o ritmo se mantiver | **~36 GB/ano** |
| Só heap, sem inchaço nenhum | ~10 GB/ano |
| Heap com índices saudáveis (~3x) | ~30 GB/ano |

Contra 100 GB de limite, isto deixou de ser "1,28% e esqueça". **Com a ressalva
que a própria consulta imprime**: 7 dias de janela, e desses sete a maior parte
foi iteração de desenvolvimento — o mesmo período das 37 exclusões que Guy
confirmou serem ajuste e teste.

Se o ritmo de importação também for de desenvolvimento, a projeção cai junto.
**Refazer a conta quando houver um mês de uso real** é a única forma honesta de
saber, e é barata: `crescimento.sql` §5.

## O churn, agora com os números certos

Com as chaves do `removed` corrigidas (§3e confirma as 15 que existem):

| | |
|---|--:|
| Células removidas por exclusão | **3.002.687** |
| Fatos removidos | 2.448.540 |
| Staged removidos | 2.601.961 |
| Células vivas | 430.978 |

**Sete vezes mais massa já saiu do que existe hoje.** É a origem do inchaço, e
casa exatamente com os `n_tup_del` da primeira medição.

`EMPURRADA_Trecho.xlsx` sozinho, em 2 exclusões, levou 1.633.920 células — mais
da metade de todo o churn. `EMPURRADA_Cavalo.xlsx`, em 6 exclusões, 391.930.

Nota de rodapé: 34 das 37 exclusões trazem as chaves de contagem. As outras três
não têm `removed` preenchido — são anteriores à coluna, ou exclusões que não
chegaram a contar. Não afeta nenhuma conclusão; fica dito para o número 34 não
parecer erro de digitação ao lado do 37.

## Próximos passos

1. **Nada urgente.** O banco está em 704 MB de 100 GB.
2. **Segunda passada nos doze restantes** — ~180 MB, proposta, não autorizada.
3. **Refazer `crescimento.sql` §5 com um mês de uso real**, para saber se os
   36 GB/ano são reais ou artefato da semana de desenvolvimento.
4. **Conferência trimestral** de `bytes_por_celula`. Linha de base nova:
   **1.713**. Subir muito acima disso sem o acervo crescer é inchaço voltando.
