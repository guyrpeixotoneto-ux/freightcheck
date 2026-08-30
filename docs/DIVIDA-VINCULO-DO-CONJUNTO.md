# Dívida: o CONJUNTO conta o par de hoje, não o da vigência

**Registrada em** 30/08/2026, durante a Fase 3 de performance.
**Estado:** não corrigida, de propósito. Nenhuma mudança funcional foi feita.

## O que foi encontrado

Em `lib/comparison/src/tipos-da-vigencia.ts`, a subconsulta `por_conjunto`
conta o par cavalo→carreta de cada vigência. O comentário que a acompanha diz:

> O conjunto não é entidade: é o par, contado pelo vínculo **da própria
> vigência**. Ler o vínculo de hoje para contar março atribuiria o par errado —
> a mesma razão que `vinculos.ts` já escreve.

O SQL logo abaixo faz exatamente o que o comentário proíbe:

```sql
JOIN entity_identifier carreta
  ON carreta.identifier_type = 'PLACA'
 AND carreta.is_current                 -- ← o vínculo de HOJE
 AND carreta.identifier_value = f.value_text
```

`is_current` é estado do presente. A contagem de CONJUNTO de uma vigência de
março é feita com o emplacamento vigente no instante da leitura, não com o que
valia em março.

## Por que hoje não dá problema

Nenhum caminho do produto fecha um identificador. As três escritas em
`entity_identifier` (`lib/ingest/src/pipeline.ts`) inserem sempre
`is_current: true`, e a importação **recusa** transferir um vínculo já
reivindicado — emite apontamento e manda para a curadoria, com a frase "o
vínculo existente fica de pé até alguém decidir". Medido no acervo real:
**zero linhas com `is_current = false`**.

## Por que vai dar

O schema contempla o fechamento explicitamente — o cabeçalho de
`entityIdentifierTable` descreve o re-emplacamento Mercosul fechando a linha
antiga e abrindo outra —, e o índice único parcial
`entity_identifier_current_uq` existe justamente para admitir mais de uma linha
por placa desde que só uma esteja aberta. O dia em que a curadoria implementar a
transferência de vínculo, ou em que um re-emplacamento for registrado, as
contagens históricas de CONJUNTO mudam retroativamente — sem nada apontando o
erro.

## Por que não foi corrigido na Fase 3

Duas razões, e as duas importam:

1. **É mudança de semântica**, não de performance. A Fase 3 se propôs a mudar de
   onde o número sai, provando que ele não muda. Corrigir o vínculo mudaria o
   número — legitimamente, mas é outra decisão, que merece ser tomada olhando
   para a tela e não para o plano de execução.
2. **Foi explicitamente excluída do escopo** pela pessoa que aprovou a fase.

Por isso o CONJUNTO ficou **fora** de `snapshot_presenca` e continua sendo
apurado ao vivo, e há teste que trava essa decisão
(`presenca-da-vigencia.test.ts`, "CONJUNTO continua sendo apurado ao vivo").
Congelá-lo na tabela seria pior do que a dívida atual: transformaria um erro
que ainda não aconteceu num erro gravado.

## O que a correção exigiria

Contar o par pelo vínculo **da vigência**, e não pelo vigente. O caminho provável
é a janela de validade que `entity_identifier` já tem (`effective_from`,
`effective_until`) comparada com `snapshot.effective_date`, em vez de
`is_current`. Antes de fazer, é preciso responder o que acontece com vínculo sem
`effective_until` — hoje todos — e se a janela foi preenchida corretamente pelo
histórico, o que esta nota não investigou.
