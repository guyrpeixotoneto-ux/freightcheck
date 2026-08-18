# O mapa monetário do cavalo e da carreta

**Medido em 18/08/2026** sobre `attached_assets/Modelo_Cavalo.xlsx` e
`attached_assets/Modelo_Carreta.xlsx` — 9 vigências (dez/2025 a ago/2026),
558 linhas de cavalo e 657 de carreta.

A pergunta que este documento responde é uma só: **de tudo o que a fonte
entrega sobre um equipamento, o que compõe o que ele recebe — e o que
comprova cada decisão?**

## Método, e o que ele recusa

Nenhuma linha abaixo foi deduzida de nome de coluna. O procedimento foi:

1. **Inventariar** todas as colunas dos dois arquivos, sem filtro semântico —
   77 no cavalo, 65 na carreta.
2. **Buscar identidades aditivas** entre *todas* as colunas numéricas, em
   centavos inteiros, com tolerância de R$ 0,01 por linha. A candidata a
   parcela não foi escolhida por parecer dinheiro; entraram todas, e o que
   decide é o ajuste medido.
3. **Cruzar cavalo e carreta** pelo vínculo `cavalo.placa_carreta`, na mesma
   vigência, para separar o que é do equipamento do que é do par.
4. **Testar periodicidade por aritmética**, não por rótulo — a amortização
   dividida pelo prazo do FINAME diz se o prazo está em meses ou em anos.

O que o método recusa é igualmente importante: **onde a medição não decidiu, a
coluna ficou sem classificação e virou pendência declarada.** Não há neste
documento nenhuma coluna promovida a mensal porque o nome dela sugere um valor
mensal.

## O que mudou no produto

| | antes | depois |
|---|---|---|
| Cavalos, ago/2026 | R$ 867.860,23 | R$ 867.860,23 (sem mudança) |
| Carretas, ago/2026 | R$ 336.803,77 | **R$ 302.009,93** |
| Pendências que o cartão da tela contava | 0 | **2.170** (cavalos) e **1.702** (carretas) |
| Equipamentos com pendência declarada | 0 | **62 de 62** e **71 de 71** |
| A tela podia dizer "100% apurado" | sim | **não** |

A queda de R$ 34.793,84 na carreta não é dinheiro que sumiu: é o lucro fixo dos
cavalos, que estava sendo contado na linha da carreta **e** na linha do cavalo.

---

## 1. A árvore do cavalo

```
finameCavalo                          ← a linha do cavalo
├── amortizacaoCavalo
├── jurosFinameCavalo
└── lucroFixomodeloNovoCicloCavalo
```

**Identidade:** `finameCavalo = amortizacaoCavalo + jurosFinameCavalo +
lucroFixomodeloNovoCicloCavalo` — **532 de 554** linhas fecham (377 exatas, 155
por arredondamento).

**As 22 que não fecham têm um padrão, e ele importa:** em 21 delas o total é
**zero** e as parcelas não são — R$ 75.664,62 somados, em 5 ativos de jan a
mar/2026 e 4 em jun–jul/2026. Nenhuma em ago/2026. O produto mostra o total da
fonte (zero) e acende o alerta de integridade `TOTAL_NAO_FECHA`; é a decisão
já registrada em `motor.ts` — exibir o número que a fonte declara e denunciar a
divergência, em vez de escolher qual dos dois lados está certo.

**A periodicidade é medida, não suposta.** `amortizacaoCavalo ÷ (valorNfCompra
× (1 − percentualEntrada) ÷ periodoFiname)` = **1,0817** com desvio 0,0400 em
503 linhas. Razão ≈ 1 significa que o prazo do FINAME está em **meses** — lida
como anual, a conta erraria por um fator de treze.

**Amortização e lucro do novo ciclo nunca coexistem:** 0 linhas em 558 têm as
duas pontas não nulas (503 só com financiamento, 51 só com lucro do novo ciclo,
4 com nenhum). `finameCavalo` é o custo fixo do cavalo — venha ele do
financiamento ou do ciclo novo.

## 2. A árvore da carreta

```
finameImplemento                         ← linha da carreta
├── amortizacaoImplemento
├── jurosFinameImplemento
└── custoAluguel
lucroFixomodeloNovoCicloCarreta          ← linha da carreta
```

**Identidade:** `finameImplemento = amortizacaoImplemento +
jurosFinameImplemento + custoAluguel` — **369 de 369** linhas fecham (346
exatas, 23 por arredondamento, zero falhas). Sem `custoAluguel` a identidade
falha em 18 linhas, todas de implementos alugados, em que o custo inteiro está
no aluguel.

`lucroFixomodeloNovoCicloCarreta` **não** está dentro de `finameImplemento`:
testado em todas as linhas, zero casos. É uma segunda raiz, e não uma parcela.

## 3. O conjunto — e a dupla contagem que a fonte faz

Três colunas da carreta remuneram o **par** cavalo + carreta, e nenhuma delas
pode entrar na linha da carreta:

| coluna | contém | evidência |
|---|---|---|
| `carreta.finame` | `cavalo.finame_cavalo` | `finame − finameImplemento = finameCavalo` em **533/533** pares |
| `carreta.custo_fixo` | `cavalo.finame_cavalo` | `custoFixo = finame + lucroFixomodeloNovoCiclo` em **644/644**, e `finame` contém o cavalo |
| `carreta.lucro_fixomodelo_novo_ciclo` | `cavalo.lucro_fixomodelo_novo_ciclo_cavalo` | `= parcela da carreta + parcela do cavalo` em **284/284** pares |

A terceira é o achado desta rodada, e **corrige uma leitura anterior deste
repositório**. O comentário de `regras.ts` afirmava que essa coluna não era o
lucro fixo do cavalo, apoiado numa contagem de coincidência de valor: 233
linhas iguais à parcela da carreta, 15 iguais à do cavalo. Os números estavam
certos; a pergunta estava errada. "De qual das duas ela copia?" tem uma
terceira resposta que ninguém testou: **de nenhuma — ela é a soma das duas.** O
que decide são as **36 linhas em que as duas parcelas são não nulas ao mesmo
tempo**, e a identidade fecha em todas as 284.

### A fonte conta o cavalo duas vezes

Juntando as identidades:

```
custoFixo = finame + lucroFixomodeloNovoCiclo
          = (finameImplemento + finameCavalo) + (lucroFixoCarreta + lucroFixoCavalo)
```

Nos 51 pares em que o cavalo está no ciclo novo, `finameCavalo` **é** o
`lucroFixoCavalo` — então o `custoFixo` da fonte soma o mesmo real duas vezes.
Medido: **51 de 51**, zero exceções.

Isso muda um contrato do produto. O teste de regressão afirmava que a soma das
duas frotas *reproduz* o `custoFixo` da fonte — e passava. A identidade era
verdadeira e a leitura dela era falsa: reproduzir a fonte significava herdar a
dupla contagem. A identidade que o produto sustenta agora é a **disjunta**:

```
(finameImplemento + lucroFixomodeloNovoCicloCarreta) + finameCavalo
```

Ela fica abaixo do `custoFixo` exatamente pelo valor repetido — R$ 34.793,84 em
ago/2026, 11,5% do total da frota de carretas.

### A pergunta que a medição não responde

Corrigida a linha da carreta, a soma das duas frotas passa a ficar **abaixo** do
`custoFixo` da fonte. Isso abre uma pergunta que só a Ambev fecha:

> O conjunto recebe o `custoFixo` cheio — R$ 1.204.664,11 em ago/2026 — ou a
> soma do que cada equipamento recebe, R$ 1.169.870,16?

A aritmética prova que os dois números diferem e explica exatamente por quê.
Ela **não** prova qual dos dois é pago, e escolher um seria presumir. Por isso:

- a **Composição** (o que cada equipamento recebe) usa a decomposição disjunta —
  é a pergunta dela, e nela o cavalo não pode aparecer dentro da carreta;
- a **DRE do conjunto** continua lendo `carreta.custo_fixo`, que é o que a fonte
  declara como preço do par, e a diferença de R$ 34.793,95 está declarada em
  teste (`dre-real.test.ts`) em vez de escondida numa igualdade que fechava por
  compensação.

E a diferença deixou de ser só um número em teste: a **aba Conjuntos** — que
existe para conferir o par contra o que a fonte declara — passa a apontar
**12 dos 71 conjuntos** de ago/2026 como divergentes, cada um pelo lucro fixo do
seu cavalo. Ela mostrava zero divergências antes, e mostrava porque os dois
lados da conta liam a mesma dupla contagem: a linha da carreta somava a coluna
do conjunto, e o declarado a continha por dentro. Dois erros iguais dos dois
lados dão zero de divergência.

Na série inteira são **64 de 657**, e a contagem cresce de 6 em janeiro para 12
em agosto — acompanhando os cavalos cujo financiamento terminou e migrou para o
lucro do novo ciclo. É o comportamento da fonte, e não deriva do produto.

---

## 4. Atributo por atributo — o que entra

| atributo | gaveta | por quê |
|---|---|---|
| `cavalo.finame_cavalo` | MENSAL | raiz; prazo em meses medido (razão 1,0817) |
| `cavalo.ipva_licenciamento` | ANUAL | 1,000% do valor da NF, desvio zero, jan–jun/2026 |
| `cavalo.valor_nf_compra` | AQUISIÇÃO | nunca varia nas 9 vigências, em nenhum ativo |
| `cavalo.valor_pis_cofins` | AQUISIÇÃO | 9,250% da NF, desvio 0,000000, nos 62 ativos |
| `carreta.finame_implemento` | MENSAL | raiz; identidade 369/369 com as três parcelas |
| `carreta.lucro_fixomodelo_novo_ciclo_carreta` | MENSAL | parcela de um total confirmado MENSAL; 284/284 |
| `carreta.valor_nf_compra` | AQUISIÇÃO | idem cavalo |
| `carreta.valor_pis_cofins` | AQUISIÇÃO | 9,250% da NF, desvio 0,000000 |

Anual e aquisição **não** entram na Remuneração Apurada: elas vivem em gavetas
próprias na ficha do equipamento. Dividir o IPVA por doze exigiria uma regra de
rateio que ninguém confirmou.

## 5. O que não entra, e por qual motivo

**Parcelas já contidas num total que entrou** (somá-las contaria duas vezes):
`cavalo.amortizacao_cavalo`, `cavalo.juros_finame_cavalo`,
`cavalo.lucro_fixomodelo_novo_ciclo_cavalo`, `carreta.amortizacao_implemento`,
`carreta.juros_finame_implemento`, `carreta.custo_aluguel`.

**Escopo de conjunto** (remuneram o par, e aparecem na ficha com a evidência):
`carreta.custo_fixo` (R$ 1.204.664,11), `carreta.finame` (R$ 1.122.608,83) e
`carreta.lucro_fixomodelo_novo_ciclo` (R$ 82.055,25).

`carreta.lucro_variavel_previsto` também está registrada como escopo de
conjunto, mas o motivo que a tela exibe é outro — "semântica não confirmada" —
porque o portão da semântica roda **antes** da decisão de escopo. É deliberado:
anunciar "remunera o conjunto" sobre uma coluna cujo significado ninguém
confirmou daria ao curador a impressão de que não há nada a fazer com ela.

**Já classificados como não-monetários** pela curadoria: alíquotas
(`carreta.icms`, `carreta.pis_cofins`), textos, datas e booleanos.

## 6. As pendências — o que ninguém classificou

Estas colunas **não** foram promovidas a nada. A medição não decidiu a
periodicidade delas, e presumir seria inventar o número. O que mudou é que
elas deixaram de ser invisíveis.

As de maior magnitude em ago/2026 (a soma é ordem de grandeza, não afirmação
de que é dinheiro — é exatamente isso que falta decidir):

| atributo | soma ago/2026 | ativos não zero | o que se sabe |
|---|---|---|---|
| `carreta.lucro_variavel_previsto` | 290.740,11 | 52/71 | é de conjunto (495/495 pares com valor, de 558); periodicidade não medida |
| `cavalo.lucro_variavel_previsto_cavalo` | 206.800,31 | 46/62 | parcela do conjunto acima; periodicidade não medida |
| `carreta.lucro_variavel_previsto_carreta` | 100.373,34 | 61/71 | idem |
| `carreta.seguro` | 36.568,99 | 71/71 | 0,2264% da NF em média, **desvio 0,0899%** — não é alíquota fixa |
| `carreta.ipva_licenciamento_mensal` | 23.343,88 | 71/71 | **não** é o IPVA ÷ 12: razão média 3,24, desvio 2,78, com negativos |
| `carreta.revestimento` | 19.733,74 | 71/71 | R$ 277,94 constante em todos os ativos e vigências |
| `carreta.ipva_licenciamento` | 10.875,69 | 71/71 | tem valores negativos (mín. −1.709,86); parece ajuste |
| `carreta.tacografo` | 1.303,86 | 62/71 | R$ 21,03 constante |
| `carreta.faixa_reflexiva` | 1.131,74 | 71/71 | R$ 15,94 constante |
| `cavalo.manutencao_reais_km` | 15,84 | 46/62 | unidade R$/km; vira dinheiro só com a quilometragem do período |

**O maior deles é o mais tentador e o mais perigoso.** O lucro variável
previsto soma quase R$ 300 mil por mês no conjunto e se decompõe exatamente
como o lucro fixo — `lucroVariavelPrevisto = lucroVariavelPrevistoCarreta +
lucroVariavelPrevistoCavalo`, 495 de 495 pares. Isso prova **escopo**, e não
**periodicidade**: prova de quem é o dinheiro, não de que ele seja mensal. As
razões testadas contra bases mensais não convergiram (`/finameCavalo`: média
0,2464 com desvio 0,1397). Somá-lo ao mensal seria presumir, e por isso ele
está na lista acima em vez de estar no total.

## 7. O que a tela passou a dizer

O cartão "Ainda sem regra financeira: **0**" era estruturalmente incapaz de
contar o que faltava. Ele lia `monetarioPotencial`, que só é verdadeiro quando
a curadoria **já** classificou o atributo como monetário — de modo que uma
coluna nunca lida respondia "não é dinheiro" e sumia da conta. O produto exibia
zero pendências ao lado de 40 colunas numéricas que ninguém tinha aberto.

A inversão está em `ComponenteNaoApurado.semClassificacao`: a pergunta deixa de
ser *"isto é dinheiro?"* e passa a ser *"alguém já descartou que seja?"*.
Enquanto a resposta for não, o número conta como pendência. Classificar uma
coluna como não-monetária é trabalho de curadoria e faz o número cair; o
silêncio, não.

E `ResumoDaFrota.apuracaoCompleta` passa a ser a única resposta autorizada à
pergunta "a frota está apurada?" — falso enquanto houver qualquer pendência.
Três telas chegavam a essa conclusão por caminhos diferentes, e o caminho mais
curto ("todo mundo tem valor apurado") dava a resposta errada com a maior
convicção.

## 8. Como reproduzir

As identidades estão travadas em teste contra o export real:

```
pnpm --filter @workspace/composition run test
```

- `__tests__/composicao-real.test.ts` — os totais de ago/2026, a exclusão do
  lucro fixo do conjunto, a diferença nomeada contra o `custoFixo` da fonte, e
  a impossibilidade de as frotas se declararem apuradas.
- `__tests__/regras.test.ts` — a contagem de pendências, incluindo o que **não**
  deve inflá-la (texto, data, booleano, célula vazia, e o que a curadoria já
  classificou).

As evidências por atributo ficam no código, ao lado da regra que sustentam:
`lib/db/src/semantica-confirmada.ts` (periodicidade e unidade),
`lib/comparison/src/composition.ts` (totais e escopo de conjunto).
