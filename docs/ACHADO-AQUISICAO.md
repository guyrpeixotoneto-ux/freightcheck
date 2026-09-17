# A aquisição do ativo — a base que explica quatro rubricas e que nunca se mexe

> Escrito para sustentar a Auditoria de Aquisição (`/custo-fixo-aquisicao`).
> Tudo abaixo foi medido no acervo do `dev:seed` — 18 vigências de
> `Modelo_Carreta` sobre 80 carretas (1.314 fatos) e 9 vigências de
> `Modelo_Cavalo` sobre 64 cavalos (558 fatos) —, e as consultas estão no corpo
> de cada seção para que qualquer uma possa ser refeita.

---

## 1. As cinco colunas da aquisição

| Coluna | Papel | Classe de custo | O que a curadoria declara |
|---|---|---|---|
| `cavalo.valor_nf_compra` | montante | **FIXO**, BRL, PONTUAL | valor da nota de compra do ativo |
| `carreta.valor_nf_compra` | montante | **FIXO**, BRL, PONTUAL | valor da nota de compra do ativo |
| `cavalo.percentual_entrada` | alíquota | **FIXO**, PERCENT | % de entrada na aquisição |
| `carreta.percentual_entrada` | alíquota | **FIXO**, PERCENT | % de entrada na aquisição |
| `cavalo.data` / `carreta.data` | cadastro | `NAO_APLICAVEL` | data de entrada do ativo |
| `cavalo.ano` / `carreta.ano` | cadastro | `NAO_APLICAVEL` | ano |
| `cavalo.mes_de_entrada` / `carreta.mes_de_entrada` | cadastro | `NAO_APLICAVEL` | mês de entrada |

As duas primeiras são a rubrica; as três últimas são o cadastro que a emoldura,
e é a curadoria que diz isso — `attribute.cost_class`, não uma segunda
classificação escrita na tela.

**Nenhuma delas era rubrica de tela nenhuma antes desta.** As três telas que já
liam o valor de nota — Finame, IPVA e Impostos — o leem como *base* do próprio
número, e por isso o código é reivindicado pelas três; pela regra de desempate de
`lib/comparison/src/modulos-de-justificativa.ts`, um código reivindicado por
várias não é rubrica de nenhuma. O resultado é que a coluna que explica quatro
rubricas não tinha onde ser cobrada.

---

## 2. A aquisição não se move — e é isso que a tela tem de dizer

Medido duas vezes, por caminhos independentes.

No **fato**, para cada ativo, quantos valores distintos a coluna tem ao longo de
todas as vigências:

```sql
select a.code, count(distinct f.entity_id) ativos,
       sum(case when d.distintos > 1 then 1 else 0 end) ativos_que_mudaram
from fact f join attribute a on a.id = f.attribute_id
join lateral (select count(distinct coalesce(f2.value_numeric::text, f2.value_text)) distintos
              from fact f2
              where f2.entity_id = f.entity_id and f2.attribute_id = f.attribute_id) d on true
where a.code in ('cavalo.valor_nf_compra','carreta.valor_nf_compra',
                 'cavalo.percentual_entrada','carreta.percentual_entrada',
                 'cavalo.data','carreta.data')
group by 1;
```

```
carreta.data               80 ativos   0 mudaram
carreta.percentual_entrada 80 ativos   0 mudaram
carreta.valor_nf_compra    80 ativos   0 mudaram
cavalo.data                64 ativos   0 mudaram
cavalo.percentual_entrada  64 ativos   0 mudaram
cavalo.valor_nf_compra     64 ativos   0 mudaram
```

E no **motor**: nas 8 comparações calculadas, nenhuma das dez colunas de
aquisição produziu uma única linha em `change`. Zero.

O que se move na frota é outra coisa — o ativo inteiro entrando e saindo:

```
ENTITY_ADDED    CAVALO 4   CARRETA 7
ENTITY_REMOVED  CAVALO 2   CARRETA 9
```

**As três decisões que isso obriga:**

1. **A tela não pode ser um painel de "o que mudou".** Os cartões de alteração
   viriam zerados em todo par de vigências que o acervo tem hoje, e uma tela
   permanentemente zerada promete uma fila que não existe — o mesmo motivo pelo
   qual o TMA está fora do Monitor de Justificativas. O centro da tela é a
   **conferência da base**: quanto custou o ativo, com que entrada, em que data,
   e se as alíquotas que saem dessa nota fecham.
2. **O que ela mostra de movimento são as 11 entradas e as 11 saídas de ativo**,
   que é a única coisa que de fato muda — e são justamente as linhas em que uma
   nota nova entra no acervo sem ninguém a ter conferido.
3. **Uma alteração de valor de nota, se aparecer, é o achado mais caro do
   produto**, e é por isso que a rubrica ganha tela mesmo quieta: a nota é o
   denominador do PIS/COFINS, do ICMS, do IPVA do cavalo e do que o FINAME
   financia. Mexer nela move quatro rubricas de uma vez, e hoje não há nenhuma
   tela onde esse movimento apareça como rubrica própria.

---

## 3. `ano` e `mes_de_entrada` são a data de entrada, escrita três vezes

```sql
select count(*) linhas,
       count(*) filter (where extract(year  from (dt.t)::timestamptz) = an.n) ano_bate,
       count(*) filter (where extract(month from (dt.t)::timestamptz) = me.n) mes_bate
from ... -- cavalo.data × cavalo.ano × cavalo.mes_de_entrada, por (snapshot, entidade)
```

```
cavalo    558 linhas   558 ano_bate   558 mes_bate
carreta  1314 linhas  1314 ano_bate  1314 mes_bate
```

Cem por cento nas duas. `ano` **não é o ano-modelo do veículo**: é o ano da data
de entrada, e `mes_de_entrada` é o mês da mesma data. São três colunas para um
fato só.

Duas consequências:

1. As duas derivadas ficam **no detalhe**, marcadas como derivadas, e fora de
   toda soma — a mesma decisão que `manutencao.ts` tomou para
   `cavalo.valor_reajustado`, que é `cavalo.manutencao_contrato` em 558 de 558.
2. Uma linha em que `ano` mudar e `data` não — ou o contrário — é defeito de
   cadastro, e não alteração de duas coisas. A tela consegue dizer isso porque as
   três estão na mesma tabela.

> **Cuidado ao refazer esta medição.** `data` é gravada em `value_text` (texto
> ISO, `2021-01-01T12:00:00Z`), não em `value_date`. Comparar contra
> `f.value_date` devolve zero coincidências em 100% das linhas, o que parece um
> achado e é um defeito de consulta.

---

## 4. A entrada é 20%, ou é nada

```sql
select value_numeric, count(*) from fact f join attribute a on a.id = f.attribute_id
where a.code = 'carreta.percentual_entrada' group by 1;
```

```
 0.00     18 linhas
20.00  1.296 linhas
```

No cavalo são 20,00% nas 558 linhas, sem exceção. Dois valores no acervo inteiro,
e um deles é ausência: **não é um parâmetro por ativo, é uma constante do
modelo.** A tela mede o percentual e diz isso com todas as letras, pela mesma
razão que a Auditoria de Impostos diz do PIS/COFINS: desvio zero não é medição,
é fórmula, e quem lê precisa saber que ninguém calculou ativo a ativo.

---

## 5. A nota zerada é frota alugada — mas frota alugada não implica nota zerada

```sql
-- carreta.valor_nf_compra × carreta.custo_aluguel, por (vigência, ativo)
```

```
NF com valor   aluguel > 0     18 linhas   1 ativo
NF com valor   sem aluguel  1.278 linhas  78 ativos
NF zero        aluguel > 0     18 linhas   1 ativo
```

Duas carretas do acervo têm custo de aluguel. Uma delas tem nota zerada nas 18
vigências — o que se lê sozinho: não foi comprada, foi alugada, e o zero é
afirmação, não lacuna. **A outra declara nota de R$ 252.086,16 e aluguel ao mesmo
tempo**, e ninguém explicou por quê.

Por isso a tela **não** trata nota zerada como erro, e **não** a conta no
denominador de alíquota nenhuma (dividir por zero produziria um percentual
infinito onde o certo é "não se aplica"). A carreta que tem as duas coisas
aparece marcada, com a pergunta escrita ao lado, em vez de ser escondida por
qualquer um dos dois critérios.

---

## 6. O que a nota explica, e o que ela não explica

Alíquotas implícitas — montante dividido pelo valor de nota, por (vigência,
ativo), excluídas as notas zeradas:

| Razão | Linhas | Mínimo | Máximo | Desvio |
|---|---|---|---|---|
| `valor_pis_cofins` / NF (cavalo) | 558 | 9,2500% | 9,2500% | 0,0000 |
| `valor_pis_cofins` / NF (carreta) | 1.296 | 9,2500% | 9,2500% | 0,0000 |
| `valor_icms` / NF (cavalo) | 558 | 0,0000% | 0,0000% | 0,0000 |
| `valor_icms` / NF (carreta) | 1.296 | 0,0000% | 0,0000% | 0,0000 |
| `ipva_licenciamento` / NF (cavalo) | 558 | 0,0000% | 3,7110% | 0,5973 |

As duas primeiras linhas confirmam, do lado da nota, o que
`docs/ACHADO-IMPOSTOS.md` já tinha medido do lado do imposto: PIS/COFINS é
9,250% da nota com desvio zero. A terceira é a coluna de ICMS que ninguém
preencheu, também já documentada lá. A quarta é o IPVA, que **varia** — e o
`docs/ACHADO-IPVA.md` mostra que a variação é temporal: as vigências de 2026
caem todas em exatamente 1,000%.

O que a nota **não** explica é o FINAME: a razão entre a parcela e a nota vai de
0 a 12,13% com desvio de 3,2 pontos, porque parcela é fluxo mensal e nota é
estoque. A tela não escreve essa razão, para não convidar à leitura de que uma
explica a outra.

A faixa da própria nota, para quem precisa de ordem de grandeza:

| | Ativos | Mínimo | Máximo | Média |
|---|---|---|---|---|
| Cavalo | 64 | R$ 409.630,71 | R$ 770.000,00 | R$ 665.929,99 |
| Carreta | 80 | R$ 0,00 | R$ 493.386,90 | R$ 239.236,47 |

---

## 7. O impacto: PONTUAL, e nunca somado a um mês

`valor_nf_compra` é `PONTUAL` em `attribute.periodicity`, confirmado pela
curadoria. Ele incide uma vez, na compra, e somá-lo a uma rubrica mensal daria um
número que não descreve nem o mês nem a aquisição. O impacto desta tela sai
**por periodicidade**, como o de todas as outras rubricas, e o balde dela é
`PONTUAL` — sozinho.

E o percentual de entrada nunca entra em soma de reais nenhuma: é alíquota,
e a distinção montante × alíquota é a mesma que `impostos.ts` já carrega no
campo `papel` do catálogo.
