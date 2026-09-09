# Ativos e Parados

Em **Visão executiva → Ativos e Parados**. A tela responde uma pergunta, e
responde a série dela:

> **Quantos veículos estão ativos e quantos estão parados, quinzena a
> quinzena — e o que mudou de uma para a seguinte?**

---

## 1. O que "parado" quer dizer aqui

Parado é o veículo que o **Promax marca como inativo** no 01.22.08.00 da
quinzena; ativo, o que ele lista no 01.22.02.00. É um retrato de **cadastro**.

A definição precisa ser explícita porque três leituras deste acervo respondem a
perguntas parecidas e discordam de propósito:

| leitura                           | fonte                        | o que "parado" significa lá                                      |
| --------------------------------- | ---------------------------- | ---------------------------------------------------------------- |
| **esta tela**                     | 01.22.02.00 / 01.22.08.00    | o cadastro do Promax marca o veículo como inativo                |
| conferência de frota (Fechamento) | as mesmas duas               | não responde por isso: compara **uma** quinzena com o contrato   |
| diário 2Art                       | `fechamento_viagem`          | não rodou — e um veículo ativo pode passar a quinzena sem viagem |
| disponibilidade (03.08.18)        | `fechamento_disponibilidade` | o gap contra a frota contratada, que **gera desconto no fixo**   |

Um veículo ativo aqui pode não ter rodado; um parado não desconta por estar
parado. A tela imprime isso no rodapé, e não só neste documento.

---

## 2. Por que na Visão executiva, e não no Fechamento

O Fechamento já tem uma tela de frota — `Fechamento → Frota` —, e ela **fica**.
São duas alturas da mesma fonte:

- **no Fechamento**, a frota é a conferência _de uma competência_, contra o
  cadastro do contrato, dentro do fluxo de fechar o período. Entra-se nela pela
  competência;
- **aqui**, é a série: quantos de pé e quantos parados ao longo do tempo, sem
  escolher competência antes. Entra-se pela pergunta.

É a mesma razão de o Painel de Unidades não ser uma aba do Resumo executivo.

---

## 3. A decisão que atravessa tudo: `null` não é zero

Se o relatório de parados de uma quinzena não chegou, contar zero desenharia uma
queda a pique no gráfico — e o que aconteceu foi um arquivo que não veio.

Então a contagem de uma situação **sem fonte** é `null`, e o `null` atravessa
todas as contas derivadas — total, percentual, variação — sem virar zero em
nenhuma. Na tela isso aparece em quatro lugares:

1. a barra daquela situação **não é desenhada**;
2. o número vira `—`;
3. a variação some, em vez de virar `-40`;
4. a quinzena ganha o aviso dizendo **qual relatório faltou e de qual unidade**.

Esse último ponto é o que torna o filtro "todas as unidades" honesto: a quinzena
em que um CDD não enviou arquivo tem menos placas, e sem o aviso o gráfico
mostraria uma frota encolhendo.

Zero, quando o relatório veio e não trouxe placa nenhuma, continua sendo zero —
é uma medição, e a tela a distingue da ausência.

---

## 4. As outras duas recusas

**Não se arbitra contradição.** A placa que aparece como ativa **e** como parada
na mesma quinzena conta nas duas contagens, e o número dessas placas vai para a
tela em vermelho (`emAmbasAsSituacoes`). Escolher uma das duas seria inventar
uma verdade que o arquivo não tem — a mesma postura de
`frota-promax-comparacao.ts`, que devolve `quantidadePromax: null` no conflito.

**Não se lê arquivo substituído.** A contagem passa sempre pelo documento
`vigente` da competência. Um reenvio derruba o anterior e apaga as linhas dele,
mas a quarentena entra já com `vigente = false` e as linhas de pé — contar por
`competencia_id` misturaria as duas.

---

## 5. Onde cada coisa mora

```
lib/fechamento
  frota-quinzenal.ts                a régua, pura: competências + placas → contagem e variação
  frota-quinzenal-persistencia.ts   a leitura do banco (documento vigente, recorte, cobertura)

artifacts/api-server
  routes/fechamento.ts              GET /fechamento/frota/quinzenas

artifacts/freightaudit
  lib/ativos-e-parados.ts           tipos e apresentação (rótulo, sinal, aviso de cobertura)
  pages/ativos-e-parados.tsx        a tela
```

**Nenhuma migration, e nenhuma tabela nova.** A contagem é feita na leitura, a
partir de `fechamento_frota_promax`, que já guarda as duas casinhas por
quinzena. Gravar a série seria uma segunda cópia de um número que já tem dono e
que se refaz sozinho quando um reenvio corrige o relatório.

`frota-quinzenal-persistencia.ts` fica fora de `persistencia.ts` pela mesma razão
que `referencia-persistencia.ts`: aquele módulo é onde o cálculo lê o que vira
dinheiro, este só conta placas, e a fronteira é conferível por leitura de
imports.

---

## 6. A rota

```
GET /fechamento/frota/quinzenas?unidade=081-0443&tipoDeOperacao=EMPURRADA&limite=12
```

Os três parâmetros são opcionais: sem `unidade`, a série é do conjunto (com a
cobertura ao lado); sem `tipoDeOperacao`, o acervo inteiro; `limite` é a janela
em quinzenas, de 1 a 24, e um valor fora da faixa é `400`.

Resposta: `{ recorte, unidades, quinzenas[] }`, cada quinzena com `ativos`,
`parados`, `total`, `percentualParado`, `emAmbasAsSituacoes`, `cobertura` e
`variacao` contra a quinzena anterior da janela.

---

## 7. A bateria

| arquivo                                                                        | o que prende                                                                           |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `lib/fechamento/src/__tests__/frota-quinzenal.test.ts`                         | a contagem, o `null` que não vira zero, a placa nas duas situações, a soma de unidades |
| `artifacts/api-server/src/routes/__tests__/fechamento-frota-quinzenas.test.ts` | o documento vigente, o recorte, a janela, a cobertura e os códigos HTTP                |
| `artifacts/freightaudit/src/lib/__tests__/ativos-e-parados.test.ts`            | os rótulos (o mês 1-indexado), o travessão da ausência e o aviso de cobertura          |
| `components/layout/__tests__/sidebar.test.ts`                                  | o item novo na lateral, e que o roteador o atende                                      |
