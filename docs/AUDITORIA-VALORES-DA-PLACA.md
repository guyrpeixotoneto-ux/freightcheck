# Auditoria: todos os valores importados de uma placa aparecem na ficha?

> **Pergunta que originou este documento.** Na ficha do cavalo QYP6C04
> (PERNAMBUCO · EMPURRADA, agosto/2026) o cabeçalho diz *"R$ 10.197,25/mês ·
> 4 componentes apurados · 36 sem classificação"* e a aba Composição mostra
> quatro linhas. **Falta alguma coisa que a importação trouxe?**
>
> **Resposta curta: não faltava nada no dado — faltava na tela.** Os valores
> estavam todos na resposta da API e todos na aba Parâmetros; a aba Composição
> não nomeava os 36 números "sem classificação" que ela mesma contava, e
> nenhuma tela do produto sabia afirmar que a conta do arquivo até a ficha
> fecha. As duas coisas foram corrigidas, e a segunda virou teste.

---

## 1. Como a auditoria foi feita

Não por leitura de código: contra o export real da Freightec
(`Remuneração_Equipamento_Análise_FT`, 9 vigências, 144 ativos), importado pelo
pipeline de verdade — `receiveFile → captureRaw → stage → preview → promote` —
mais a curadoria (`seedTaxonomy`, `runProposalPass`, `applyConfirmations`), que
é o mesmo caminho que um arquivo percorre na tela de Importações.

A placa QYP6C04 é da base de produção da Ambev e não está neste export. A
auditoria foi feita sobre **todos os 144 ativos** do arquivo e detalhada num
cavalo de forma idêntica à da tela (4 apurados · IPVA anual · NF e PIS/COFINS
em aquisição · dezenas sem classificação). O §5 traz a consulta para repetir a
conferência na base de produção, na placa que se quiser.

## 2. O que foi medido, e o que fechou

Para cada equipamento, em agosto/2026:

| Etapa | Medição |
|---|---|
| Linha do arquivo → células | **77 células** na linha da placa naquela vigência |
| Células → fatos | **75 viraram fato**; as 2 restantes são `Placa` e `Vigencia` |
| Fatos → resposta da API | **75 de 75** na ficha (`linhas` + `naoApurados`) |
| Conferência inversa | nenhum código na ficha sem fato no banco |
| Perdas | **0** coluna sem cabeçalho, **0** coluna ambígua, **0** sem destino |

`Placa` e `Vigencia` não viram valor porque são o **endereço** do valor: uma diz
de quem ele é, a outra de quando. É a mesma classificação que o Rastreio de
Dados (`lib/balance`) aplica ao arquivo inteiro, aqui no grão de um ativo.

Rodado nos 144 ativos das 9 vigências e nos 133 presentes em agosto/2026:
**nenhum equipamento deixou de fechar.** Nenhum fato sem célula de origem,
nenhuma célula sem destino declarado.

A placa também aparece numa linha da aba `Análise Cavalo` (10 células), que é
uma aba de apoio — tabela dinâmica calculada sobre dados que já entraram pela
aba `cavalos`. Importá-la contaria a mesma massa duas vezes; é descarte
declarado em `lib/balance/src/destinos.ts`, e não perda.

## 3. O que estava errado — na tela, não no dado

Dos 75 valores da ficha, a aba **Composição** mostrava **11**: os 4 apurados e
os 7 que a curadoria já reconhece como dinheiro e ainda não sabe somar. Os
demais 64 só existiam na aba Parâmetros.

Entre os invisíveis estavam **27 dos 34 números sem classificação** que o
próprio cabeçalho contava (os outros 7 já apareciam por serem reconhecidos como
montante) — e um deles é `lucroVariavelPrevistoCavalo`, R$ 3.723,82 no
ativo medido, cerca de R$ 216 mil por mês na frota. Ler *"parcialmente
apurada · 36 sem classificação"* sem conseguir ver **quais** é a forma mais
cara de informação incompleta que esta tela podia dar: o número existe, tem
valor, e a aba que fala de dinheiro não o nomeava.

O motivo era o filtro de `SemImpactoApurado`, que só listava
`monetarioPotencial || ESCOPO_DE_CONJUNTO`. Um número que ninguém classificou
tem `monetarioPotencial = false` por definição — a curadoria ainda não disse
que é dinheiro —, então caía fora da lista **e** continuava na contagem.

## 4. O que passou a existir

**`lib/composition/src/rastreio.ts`** — a conta de conservação de uma placa numa
vigência. Parte dos fatos que a ficha mostra, sobe até as células que os
originaram, e exige que **toda** célula daquelas linhas tenha destino
declarado: virou fato, é endereço do fato, ou é perda com nome e endereço
(coluna sem cabeçalho, coluna ambígua, sem destino). É leitura do que ficou
gravado — células, mapeamentos de coluna e fatos —, nunca uma segunda execução
das regras de leitura.

Na ficha (`GET /composition/equipment/:id`), o campo `rastreio`, e na aba
Composição a seção **"Conferência: do arquivo até esta tela"**, que diz em uma
frase se nenhum valor importado ficou de fora — e, quando não fecha, o endereço
do que faltou.

**Os números sem classificação passaram a aparecer na aba Composição**, num
bloco que abre por clique ("*N números que ninguém classificou*"), com valor,
unidade e motivo. Fechado por padrão porque são dezenas e nenhum tem valor
apurado; presente porque uma contagem sem lista é um número que não se pode
conferir.

**Testes de regressão** em `composicao-real.test.ts`: a conta fecha na placa
medida (77 = 75 + 2), o que virou fato é exatamente o que a ficha mostra, e a
conta fecha para os 133 equipamentos de agosto/2026 sem exceção. A frota
inteira e não uma placa: uma coluna que colide com outra pode sumir só nas
linhas em que as duas vêm preenchidas, e uma placa só não veria a diferença.

## 5. Como repetir a conferência em produção

Para uma placa e uma vigência quaisquer, direto no banco:

```sql
WITH fato_da_ficha AS (
  SELECT f.id, f.raw_cell_id
    FROM fato_visivel f
    JOIN snapshot s ON s.id = f.snapshot_id
    JOIN entity e   ON e.id = f.entity_id
    JOIN entity_identifier ei ON ei.entity_id = e.id AND ei.is_current
                             AND ei.identifier_type = 'PLACA'
   WHERE ei.identifier_value = 'QYP6C04'          -- a placa
     AND s.effective_date = DATE '2026-08-01'     -- a vigência
     AND s.status <> 'SUPERSEDED'
     AND NOT EXISTS (SELECT 1 FROM import_run ir
                      WHERE ir.id = s.import_run_id AND ir.hidden_at IS NOT NULL)
),
linha_do_arquivo AS (
  SELECT DISTINCT r.id, r.raw_sheet_id
    FROM fato_da_ficha ff
    JOIN raw_cell c ON c.id = ff.raw_cell_id
    JOIN raw_row r  ON r.id = c.raw_row_id
)
SELECT CASE
         WHEN EXISTS (SELECT 1 FROM fato_da_ficha ff WHERE ff.raw_cell_id = c.id)
                                      THEN 'virou fato'
         WHEN cm.id IS NULL           THEN 'coluna sem cabeçalho'
         WHEN cm.status = 'AMBIGUOUS' THEN 'coluna ambígua'
         WHEN cm.status = 'IGNORED'   THEN 'endereço (placa/vigência)'
         ELSE 'SEM DESTINO'
       END AS destino,
       count(*) AS celulas
  FROM linha_do_arquivo l
  JOIN raw_cell c ON c.raw_row_id = l.id
  LEFT JOIN column_mapping cm ON cm.raw_sheet_id = l.raw_sheet_id
                             AND cm.column_index = c.column_index
 GROUP BY 1 ORDER BY 2 DESC;
```

A conta fecha quando só aparecem `virou fato` e `endereço`. Qualquer linha em
`SEM DESTINO`, `coluna sem cabeçalho` ou `coluna ambígua` é um valor que o
arquivo trouxe para aquela placa e a ficha não mostra — e a seção
"Conferência" da ficha passa a dizer isso sozinha, em vermelho, com o endereço
da célula.

## 6. O que esta auditoria **não** afirma

Que a remuneração está completa. Ela não está, e a ficha diz: 4 componentes
apurados, 36 números que ninguém classificou. A diferença entre as duas
afirmações é o ponto deste documento —

- **completude do dado** (auditada aqui): tudo o que a importação trouxe para a
  placa está na ficha, conferível célula a célula. **Fecha.**
- **completude da apuração** (não auditada aqui): quantos daqueles valores o
  produto sabe somar. Depende da curadoria confirmar o significado de cada
  coluna, e de bases que este export não traz — quilometragem rodada por ativo
  e preço do diesel, sem as quais quatro colunas em R$/km não viram um real.
  Ver `docs/COMPOSICAO.md`, §4.

Nenhum número foi movido de gaveta, nenhum total mudou, nenhuma semântica foi
confirmada para fazer a conta crescer. O que mudou é que a tela agora mostra o
que já sabia — e sabe dizer quando não sabe.
