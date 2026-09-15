# O que a medição de crescimento revelou

Rodado em produção em 15/09/2026, com `scripts/diagnostico/crescimento.sql`.
Somente leitura; nada foi escrito.

O resultado reenquadra o diagnóstico de inchaço
(`docs/PLANO-INCHACO-DOS-INDICES.md`). O plano continua correto; a **história**
por trás dele é outra.

---

## O acervo inteiro

| | |
|---|--:|
| Importações vivas | **3** |
| Arquivos distintos | **3** |
| Tamanho somado dos `.xlsx` | **2.351 kB** |
| Primeira importação viva | **2026-09-08** |
| Última | 2026-09-15 |
| Idade do acervo | **7 dias** |
| Células RAW vivas | 430.978 |
| Fatos vivos | 391.824 |
| Tamanho do banco | **1.336 MB** |

**2,3 MB de planilha sustentam 1,3 GB de banco.** Um multiplicador de ~580x.

E o acervo tem uma semana. Este não é um banco que acumulou volume ao longo de
anos: é um banco novo, pequeno, com um ano inteiro de cicatriz.

## De onde vem a cicatriz

| | |
|---|--:|
| Importações **vivas** | 3 |
| Importações **excluídas** | **37** |
| | |
| Exclusões em agosto | 24 |
| Exclusões em setembro | 13 |
| Autores distintos | 1 |
| Com motivo declarado | 8 de 37 |

**92,5% de todas as importações que já existiram foram excluídas.** Nada de
agosto sobreviveu — a primeira importação viva é de 8 de setembro, e a janela de
exclusões começa em 14 de agosto.

E há releitura repetida do mesmo arquivo:

| Arquivo | Exclusões |
|---|--:|
| `Modelo Trecho.xlsx` | 6 |
| `EMPURRADA_Cavalo.xlsx` | 6 |
| `QLP ADM_Remunerado Camaçari_V@.xlsx` | 4 |
| `Importação Cavalo_V2.xlsx` | 3 |
| `Modelo Cavalo.xlsx` | 3 |

`EMPURRADA_Cavalo.xlsx` (sha `22e6fd04`) é o caso completo: **excluído 6 vezes e
vivo na sétima.** Mesmo SHA-256, ou seja, os mesmos bytes, lidos do zero sete
vezes — sete conjuntos completos de `raw_cell`, `staged_fact` e `fact`, seis
deles apagados depois.

## O que isso muda no diagnóstico

Nada da evidência de inchaço — os fatores de 9 a 10x estão medidos e continuam
de pé. O que muda é a **leitura** deles:

**Antes:** "um banco de produção acumulou inchaço ao longo da operação normal."

**Agora:** "uma semana de iteração de desenvolvimento — 37 importações
carregadas e descartadas — deixou 1,1 GB de índice vazio num banco cujo dado
real são 141 MB."

Três consequências práticas:

1. **Reindexar é mais atraente, não menos.** O inchaço é resíduo de um período
   de ajuste que já passou, não subproduto do funcionamento em regime. Limpar
   uma vez tem chance real de resolver por um bom tempo.
2. **A projeção de crescimento não vale.** Sete dias de acervo, e desses sete a
   maior parte foi iteração. Extrapolar daí diz mais sobre a semana medida que
   sobre o ano.
3. **A pergunta que importa mudou.** Não é mais "quanto tempo até 100 GB" — é
   **"o ciclo de excluir-e-reimportar vai continuar?"** Se for padrão de
   desenvolvimento, acaba sozinho. Se for como o produto é operado, o inchaço
   volta, e aí a otimização de reaproveitamento de RAW
   (`docs/PLANO-INCHACO-DOS-INDICES.md`, seção 3) sai do "medir antes" e vira
   trabalho com justificativa medida: seis releituras do mesmo SHA-256 são seis
   cópias evitáveis.

## Dois erros meus, que esta rodada expôs

Registro os dois porque ambos produziram número errado com cara de número certo.

### 1. A coluna de exclusões veio zerada

As seções 3, 3b e 3c devolveram `celulas_removidas = 0`, `fatos_removidos = 0`,
`staged_removidos = 0` — num banco com 37 exclusões.

Não foi o banco: foi minha consulta. As chaves do jsonb `removed` são
**camelCase** (`rawCells`, `facts`, `stagedFacts`), definidas em
`ImportDeletionCounts` (`lib/ingest/src/deletion.ts:43`), e eu escrevi os nomes
das tabelas (`raw_cell`, `fact`, `staged_fact`).

`->>` de chave ausente devolve `NULL`, meu `coalesce` transformou em `0`, e a
consulta concluiu com toda a confiança que nada tinha sido removido — de um
banco onde 92,5% das importações foram apagadas. **Zero silencioso é pior que
erro**: erro para a leitura, zero é lido como fato.

Corrigido. E acrescentei a seção **3e**, que lê do banco quais chaves o
`removed` realmente tem, em vez de confiar que os nomes que escrevi batem com os
que o código grava.

### 2. A projeção dividia por 90 dias fixos

A seção 5 pegava `sum(raw_cell_count)` dos últimos 90 dias e dividia por 90.
Num acervo de 7 dias, ela espalhou uma semana de importação por um trimestre:
devolveu **5.419 MB/ano** onde o ritmo medido dá algo perto de **60 mil
células/dia**, ordem de grandeza ~13x maior.

Corrigido: a janela agora sai de `min(started_at)`, e abaixo de 30 dias a
consulta imprime a ressalva em vez de entregar um número com cara de previsão.
Acrescentei a **5b**, que projeta só pelo heap — o que o banco ocuparia sem o
inchaço —, para as duas juntas darem o intervalo em vez de um ponto falso.

## Recomendação, revisada

Sem mudança no **o quê**; mudança na **ênfase**.

1. **Reindexar os quatro maiores** continua sendo o passo certo, e agora com um
   argumento melhor: é limpeza única de um período de ajuste, não enxugar gelo.
2. **Rodar `crescimento.sql` de novo depois de reindexar.** O
   `bytes_por_celula` é o termômetro: hoje são **3.251 bytes por célula viva**,
   e ele deve cair para perto de 1.000. É a medida mais barata de que a
   reindexação fez efeito, e não depende de extensão nenhuma.
3. **Responder a pergunta do ciclo.** Se as 37 exclusões foram ajuste de
   desenvolvimento, não há mais nada a fazer além da manutenção trimestral. Se
   excluir e reimportar é como o produto vai ser usado, o reaproveitamento de
   RAW passa a ter retorno medido — e `Modelo Trecho.xlsx`, com seis exclusões,
   é o caso de teste pronto.

Essa terceira você responde melhor que qualquer consulta: **as 37 exclusões
foram você ajustando as importações, ou é assim que o trabalho acontece?**
