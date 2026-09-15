# Por que `staged_fact` tem o mesmo tamanho de `fact`

Medido em produção em 15/09/2026:

| | linhas vivas | total | heap | índices |
|---|--:|--:|--:|--:|
| `fact` | 274.995 | 555 MB | 36 MB | 519 MB |
| `staged_fact` | 274.995 | 509 MB | 62 MB | 447 MB |

As duas com **exatamente** o mesmo número de linhas, e juntas 83% do banco.
Este documento responde três perguntas: essa retenção é necessária, quem lê
`staged_fact` depois da promoção, e o que quebraria se ela fosse limpa.

---

## O que `staged_fact` é

A etapa do meio do pipeline. `raw_cell` guarda a célula como texto; `fact`
guarda o número já ligado à identidade canônica; `staged_fact` é o candidato
**tipado mas ainda no vocabulário do arquivo** — rótulo de vigência como estava
escrito, placa como o arquivo trouxe, nome da coluna como veio
(`lib/db/src/schema/staging.ts`).

```
raw_cell ──stage()──► staged_fact ──promote()──► fact
```

## Por que os números batem exatamente

Não é coincidência de arredondamento: é o caminho normal. Cada célula que vira
fato passa por uma linha de `staged_fact`, e o purge de exclusão de importação
apaga as duas juntas, na mesma transação
(`lib/ingest/src/deletion.ts:738-743`).

**Mas a igualdade exata merece uma conferência**, e não uma dedução: `promote()`
também escreve fatos **herdados** — a revisão que corrige só os cavalos copia as
carretas da revisão anterior para o snapshot novo
(`lib/ingest/src/pipeline.ts:3849-3868`). Fato herdado **não tem**
`staged_fact`: ele nasce de outro fato, não de uma célula desta importação. Com
herança no acervo, `fact` deveria ser *maior* que `staged_fact`, não igual.

A consulta que fecha isso — somente leitura, e é uma contagem exata, então
custa segundos:

```sql
SELECT (SELECT count(*) FROM fact)                                            AS fatos,
       (SELECT count(*) FROM fact WHERE inherited_from_snapshot_id IS NOT NULL) AS herdados,
       (SELECT count(*) FROM staged_fact)                                     AS staged,
       (SELECT count(*) FROM fact WHERE inherited_from_snapshot_id IS NULL)   AS nascidos_de_celula;
```

Se `nascidos_de_celula = staged` e `herdados = 0`, a igualdade é o caminho
normal e o acervo simplesmente nunca teve uma revisão parcial. Se `herdados > 0`
e mesmo assim os totais batem, há algo a explicar — e aí a pergunta muda de
"posso limpar?" para "por que estes números coincidem?".

---

## Quem lê `staged_fact` depois da promoção

Levantamento completo das leituras fora de teste. **Três delas são de tela
viva**, não de importação em curso:

### 1. Detalhe do Balanço — `lib/balance/src/balanco.ts`

A tela de uma importação específica, aberta a qualquer momento, para qualquer
importação já feita. Três leituras:

| Onde | O que lê |
|---|---|
| `:476` | `classificacao(importRunId)` → destino de cada célula, por aba |
| `:494` | `classificacao(importRunId)` → amostra das células que se perderam |
| `:523` | `SELECT snapshot_label, count(*) FROM staged_fact WHERE import_run_id = …` |

As duas primeiras são a mais séria. `classificacao()`
(`lib/balance/src/classificacao.ts`) usa `staged_fact` para decidir que uma
célula chegou ao destino `PREPARADO`. **Sem as linhas, a célula não vira
"sem destino" por engano — ela vira "sem destino" por construção**, e a tela que
existe para denunciar dado perdido passaria a acusar perda que não houve. O
defeito não seria um painel vazio; seria um painel errado, e convincente.

### 2. Resumo da importação — `artifacts/api-server/src/routes/overview.ts:238`

```ts
.selectDistinct({ label: stagedFactTable.snapshotLabel })
.from(stagedFactTable)
.where(eq(stagedFactTable.importRunId, importRunId))
```

Quais vigências aquele arquivo trouxe. Some da tela sem as linhas.

### 3. O recenseamento pendente — `lib/balance/src/balanco.ts:334`

`listarBalancos` lê o censo gravado (`import_run_censo`), e só recalcula ao vivo
o run que ainda não foi recenseado. Esse caminho de exceção passa por
`classificacao()`, logo por `staged_fact`.

### As outras, que não são leitura de tela

- `lib/balance/src/censo.ts:128` — `gravarCenso`, no fim de `stage()`. É a
  escrita do censo, não leitura posterior.
- `lib/db/src/bridge.ts:123` — a reconvergência confere que a coluna
  `entity_key_raw` existe. Olha o schema, não os dados.
- `lib/ingest/src/deletion.ts:741` — o purge.
- `lib/ingest/src/history.ts` — usa `import_run.staged_fact_count`, o
  **contador**, nunca a tabela.

---

## A retenção é necessária para rastreabilidade?

**Não.** E esta é a parte que surpreende.

A cadeia de rastreabilidade não passa por aqui: `fact.raw_cell_id` aponta
**direto** para a célula de origem (`lib/db/src/schema/canonical.ts`). De um
número na tela até a célula da planilha, `staged_fact` não é degrau. Apagá-la
não quebraria nenhuma auditoria de valor.

O que `staged_fact` guarda de único é outra coisa: **o vocabulário do arquivo
antes da tradução canônica** — `entity_key_raw` (a placa como estava escrita,
com hífen e espaço), `snapshot_label` (o rótulo de vigência como veio),
`attribute_code`, e o `status` de cada candidato. Isso serve para explicar *como
o arquivo foi lido*, que é exatamente a pergunta do Balanço.

Então a resposta honesta é: **não é necessária para auditar números; é
necessária para auditar leitura** — e hoje três telas dependem dela para isso.

---

## O que quebraria se fosse limpa após a promoção

| | efeito |
|---|---|
| Rastreabilidade fato → célula | **intacta** (`fact.raw_cell_id`) |
| Revisões, curadoria, comparação, fechamento | **intactos** — nenhum lê `staged_fact` |
| Detalhe do Balanço, quadro por aba | **errado**: células preparadas viram `SEM_DESTINO` |
| Detalhe do Balanço, amostra de perdidas | **errado**: mostra perda que não houve |
| Detalhe do Balanço, vigências preparadas | **vazio** |
| Resumo da importação, lista de vigências | **vazio** |
| Recenseamento de run pendente | **errado**, pelo mesmo motivo do quadro por aba |
| Exclusão da importação | intacta (o `DELETE` vira no-op) |
| Chave estrangeira | nenhuma aponta para `staged_fact` — nada impede o `DELETE` |

## O caminho que tornaria a limpeza segura

Já existe precedente no próprio repositório, e é o modelo a seguir.

Em 29/08/2026 `listarBalancos` varria `raw_cell` e `staged_fact` inteiras a cada
requisição — 1.022.946 linhas lidas para devolver 2,5 KB, 2.267 ms. A correção
não foi apagar nada: foi **gravar o resultado quando ele para de mudar**, em
`import_run_censo`, no fim de `stage()` (`lib/balance/src/censo.ts`).

`import_run_censo` guarda hoje só o agregado: `(import_run_id, destino,
celulas)`. Falta o que o detalhe precisa:

1. destino **por aba** (`raw_sheet_id`, não só por run);
2. contagem de preparados **por vigência** (`snapshot_label`);
3. a amostra de células perdidas — que já pode ser reconstruída de `raw_cell`,
   porque o que falta ali é só saber quais NÃO foram preparadas.

Com esses três gravados no fim de `stage()`, `staged_fact` deixa de ter leitor
posterior à promoção e pode ser apagada no fim da promoção — pelo mesmo
argumento do censo: depois de `stage()`, o conteúdo dela é constante.

## Recomendação

**Não limpe `staged_fact` agora**, e por um motivo que não é o risco.

O motivo é que o ganho quase não existe depois de reindexar. Dos 509 MB de
`staged_fact`, **447 MB são índice** — e o inchaço de índice, não o volume, é o
que enche este banco (ver `docs/PLANO-INCHACO-DOS-INDICES.md`). Reconstruídos,
os índices de `staged_fact` devem cair para ~40 MB, e a tabela inteira para
~100 MB. Apagar as linhas depois disso recuperaria ~100 MB de um limite de
100 GB, ao custo de três telas quebradas e de uma migration que grava por aba e
por vigência.

Ordem correta, então:

1. **Reindexar** — recupera ~410 MB só de `staged_fact`, sem tocar em regra de
   negócio e sem quebrar tela nenhuma.
2. **Medir de novo.** Se `staged_fact` ainda incomodar depois disso, aí sim
3. **Gravar por aba e por vigência** no fim de `stage()`, e só então
4. **Apagar `staged_fact` no fim da promoção.**

Os passos 3 e 4 são trabalho de produto com migration e mudança de tela. Só
valem a pena se o passo 2 mostrar que ainda há problema — e a aritmética diz
que não vai mostrar.
