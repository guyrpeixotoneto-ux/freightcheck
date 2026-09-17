# O aluguel de implemento — o que ocupa o lugar do financiamento

> Escrito para sustentar a Auditoria de Aluguel de Frota (`/custo-fixo-aluguel`).
> As medições são do acervo do `dev:seed` — 18 vigências de `Modelo_Carreta`
> sobre 80 carretas e 9 de `Modelo_Cavalo` sobre 64 cavalos —, e as consultas
> estão no corpo de cada seção. A semântica citada é a que a curadoria já
> aprovou, em `lib/db/src/semantica-confirmada.ts`.

---

## 1. As duas colunas, e por que só uma delas tem rubrica

| Coluna | Classe | Unidade | Periodicidade | Semântica |
|---|---|---|---|---|
| `carreta.custo_aluguel` | **FIXO** | BRL | **MENSAL** | `CONFIRMED` |
| `cavalo.custo_aluguel` | FIXO | BRL | — | `PRESUMED` |

A da carreta é dinheiro do mês, confirmado, com `aggregation: SUM` e taxonomia
`cf_financiamento`. A base da aprovação está escrita na própria entrada, e ela é
aritmética — não opinião:

> Aprovado em 18/08/2026 com base aritmética: `finameImplemento =
> amortizacaoImplemento + jurosFinameImplemento + custoAluguel` em 369 de 369
> linhas (346 exatas, 23 por arredondamento, zero falhas); sem esta terceira
> parcela a identidade falha em 18 linhas, todas de implementos alugados, em que
> o custo inteiro está no aluguel. (…) **Fica na classe do financiamento porque é
> o que ocupa o lugar dele: são os implementos que a frota aluga em vez de
> financiar.**

Essa última frase é o desenho desta tela inteira, e o motivo de ela ficar ao
lado do FINAME no menu em vez de virar uma gaveta à parte.

A do cavalo é **zero em 558 de 558 linhas**, e a semântica dela é presumida. Ela
entra no catálogo — a coluna existe, e sumir com ela deixaria quem confere a
planilha procurando o nosso número —, mas entra como coluna sem dado, dita por
extenso, e fora de toda soma. É a mesma decisão que `seguro.ts` tomou para o
rastreador.

---

## 2. A identidade, remedida no acervo de hoje

A aprovação foi medida sobre 9 vigências (369 linhas). O `dev:seed` de hoje traz
18 vigências de carreta, e a identidade continua fechando:

```sql
select count(*) linhas,
       count(*) filter (where abs(coalesce(am.n,0)+coalesce(ju.n,0)+coalesce(al.n,0) - fi.n) <= 0.01) fecham,
       count(*) filter (where al.n > 0) com_aluguel,
       count(*) filter (where al.n > 0
                        and abs(coalesce(am.n,0)+coalesce(ju.n,0) - fi.n) > 0.01) falhariam_sem_aluguel
from carreta.finame_implemento fi
left join carreta.amortizacao_implemento am using (vigência, ativo)
left join carreta.juros_finame_implemento ju using (vigência, ativo)
left join carreta.custo_aluguel          al using (vigência, ativo);
```

```
1.314 linhas   1.314 fecham   36 com aluguel   36 falhariam sem ele
```

**As 36 linhas com aluguel são exatamente as que a identidade precisa dele para
fechar.** Não é uma parcela acrescentada para a conta dar certo: ela explica as
36 exceções e zera a diferença nas 36.

---

## 3. Nos implementos alugados, a parcela FINAME **é** o aluguel

```
placa      vigências   aluguel/mês   Σ amortização   Σ juros   parcela
CUL0J25       18       R$ 5.363,55       0,00         0,00     R$ 5.363,55
FCW7D86       18       R$ 6.414,37       0,00         0,00     R$ 6.414,37
```

Amortização e juros são **zero em todas as 36 linhas**: não há financiamento
nenhum nesses dois implementos, e o custo inteiro está no aluguel.

**A consequência é um defeito que estava em tela.** A Auditoria de FINAME
declara `parcela = juros + amortização` (`finame.ts`), e para essas duas placas
ela mostrava uma parcela de R$ 5.363,55 ao lado de duas parcelas zeradas, sem
nada dizendo por quê. Quem abrisse a placa via um total que as partes exibidas
não explicavam.

Por isso esta mudança acrescenta o aluguel como **terceira parcela** no catálogo
do FINAME — a mesma decomposição que `composition.ts` já media —, marcada como
rubrica do módulo Aluguel e fora da soma dele. É o mesmo padrão que o FINAME já
usa para o ICMS, que é rubrica do módulo Impostos.

---

## 4. Quem soma o quê — a regra que impede a dupla contagem

Sem cuidado, criar este módulo contaria o mesmo dinheiro duas vezes: o FINAME
soma a parcela do implemento, e a parcela **contém** o aluguel.

O que impede isso é a regra que o FINAME já tem (`cobertasPorParcelasEm`): **o
total sai quando uma parcela dele se move.** Com o aluguel declarado como
terceira parcela, uma alteração de aluguel tira a parcela FINAME do total
daquele veículo, e quem soma o aluguel é este módulo. Nenhuma compensação nova,
nenhuma segunda régua — a máquina que já estava lá, com a parcela que faltava
nela.

`__tests__/posse-da-soma-do-custo-fixo.test.ts` mede exatamente isso, e passa a
nomear o Aluguel como dono de `carreta.custo_aluguel`.

---

## 5. O que a coluna vale, e o que isso não autoriza a concluir

Neste acervo são **2 carretas de 80**, com R$ 5.363,55 e R$ 6.414,37 por mês, e
o valor de cada uma é único nas 18 vigências — o aluguel não se mexeu.

**Isso descreve uma unidade, não a operação.** O `dev:seed` traz uma única
unidade (CAMAÇARI), e a proporção de frota alugada é decisão comercial que varia
de unidade para unidade. Uma tela dimensionada pelas duas placas deste acervo
seria uma tela dimensionada por uma amostra de uma, e é por isso que este módulo
existe com a mesma estrutura das outras rubricas — recorte por equipamento,
totais por vigência, tabela por placa e justificativa na linha — em vez de um
cartão fixo com duas linhas dentro.

O que o acervo autoriza a afirmar é o que a tela afirma: **quantos implementos
desta unidade são alugados em vez de financiados, quanto isso custa por mês, e
se esse custo mudou entre as duas vigências.**

---

## 6. A parcela FINAME confere o aluguel — e não é linha desta rubrica

A primeira versão desta tela trazia `carreta.finame_implemento` no catálogo do
aluguel, marcada como fora da soma, para que a conferência aparecesse placa a
placa. O acervo real mostrou o preço disso: a linha do módulo no Monitor Custo
Fixo passou a contar **33 alterações**, todas de parcela de frota *financiada*,
sob o rótulo "Aluguel de Frota". O número estava certo e a leitura, errada.

A regra que a rota já escrevia vale para a parcela como vale para a amortização
e para os juros: **uma tela não reivindica a coluna de outra só porque precisa
lê-la.** As três são lidas em `/aluguel/totais`, alimentam a conferência, e não
viram linha de tabela nem entram em soma nenhuma.

O que se perde é a parcela ao lado do aluguel na tabela por placa. O que se ganha
é a contagem deste módulo ser, em toda tela que a publica, o número de contratos
de locação que se moveram — e nada mais. Hoje esse número é **22 em todos os
pares do acervo, e os 22 são entradas e saídas de ativo**: nenhum aluguel mudou
de valor.

---

## 7. O que o aluguel não é

- **Não é aparato.** Ele aparece hoje na Auditoria de Seguro e Aparato,
  declarado `foraDaSoma` com a razão certa — "outro contrato e outra pergunta".
  Ali ele continua visível e continua fora da soma; a rubrica dele passa a ser
  esta tela.
- **Não é do cavalo.** A identidade do cavalo é `finame_cavalo = amortização +
  juros + lucro fixo` (`composition.ts`), sem aluguel, e a coluna
  `cavalo.custo_aluguel` é zero em todas as linhas. Ela aparece no detalhe, dita
  como coluna sem dado.
- **Não é a linha da DRE.** `fixo.aluguel_implemento` (`lib/dre/src/plano.ts`)
  já apura este mesmo dinheiro na seção CUSTO_FIXO, e continua apurando: as duas
  leituras partem do mesmo fato e não se somam uma à outra. A DRE responde
  "quanto sobra depois dos custos"; esta tela responde "o que mudou no aluguel
  entre duas vigências, e em que placa".
