# Dívida: a classe de custo dos conjuntos de comparação já calculados

**Registrada em 17/08/2026, junto da correção que passou a garantir a taxonomia
na promoção. Não decidida — é isto que este documento pede.**

## O que aconteceu

`change.cost_class` e `change.taxonomy_name` **não são lidos por junção**: são
gravados na linha, no instante em que a comparação é calculada, com a
classificação vigente naquele momento. É uma decisão boa e deliberada — a linha
de uma comparação descreve o que se sabia quando ela foi feita, e não o que se
passou a saber depois.

O efeito colateral é a dívida. Enquanto a árvore da taxonomia não existia em
produção — ver `lib/db/src/taxonomia-canonica.ts` para a medição —, **toda**
comparação calculada nasceu com as duas colunas nulas. Corrigir a taxonomia dali
para a frente não as reescreve.

## O tamanho, medido

Num banco importado do export real (9 vigências), o par julho→agosto/2026:

| | Sem taxonomia | Com a árvore |
|---|---|---|
| Linhas de `change` | 267 | 267 |
| com `cost_class` | **0** | 19 |
| com `taxonomy_name` | **0** | 19 |
| Grupos da tela Início com classe | **0** de 20 | 7 de 20 |

Nenhum número fica *errado*: `panorama.ts` colapsa classe ausente em
`SEM_CLASSE`, e a DRE mapeia seção por código de atributo, não por taxonomia. O
que se perde é filtro, agrupamento e o eixo "fixo vs. variável" das telas de
Alterações e Início — sobre os conjuntos antigos.

## O que **não** foi feito, e por quê

Recomputar não é gratuito nem neutro:

- `computeChangeSet` com `force` reescreve as linhas do conjunto. Um conjunto
  recomputado hoje carrega a classificação de hoje, e não a da data em que a
  vigência entrou — o que é justamente o que a gravação na linha existe para
  evitar.
- Recomputar em massa também recarimba `impact_*`, que já mudou por causa das
  confirmações canônicas. A conta muda de valor sem que a fonte tenha mudado, e
  a tela de Alterações não tem como dizer isso a quem estiver olhando.
- Nada recomputa sozinho hoje: `computeMissingChangeSets` só era chamado pelo
  handler morto de `overview.ts`, removido na mesma correção. Os conjuntos
  nascem sob demanda (ficha da Composição, rotas de Alterações, garantia do
  Assistente) e, uma vez gravados, ficam.

## As saídas possíveis, para decidir

1. **Backfill cirúrgico.** Um `UPDATE` que preenche só `cost_class` e
   `taxonomy_name` a partir da classificação **na data daquela vigência**
   (`loadAttributeClassificationsAt`), sem tocar em `impact_*`. Preserva a
   história do impacto e conserta só o eixo de classificação. É o mais barato e
   o mais defensável; precisa de migration e de um registro do que foi
   reescrito.
2. **Recomputação declarada.** Uma ação de operador — "recalcular as
   comparações desta série" — que refaz tudo e deixa registrado quem pediu e
   quando. Honesta, mas muda números na tela sem que a fonte tenha mudado.
3. **Não fazer nada.** As séries antigas continuam sem eixo de classe; as novas
   nascem certas. Aceitável se ninguém filtra por classe olhando para trás — e
   isso é uma pergunta para quem usa o produto, não para quem o escreve.

A recomendação de quem escreveu esta nota é a **(1)**, pela preservação do
`impact_*`. A decisão não é técnica: depende de a auditoria olhar ou não para
trás por classe de custo.
