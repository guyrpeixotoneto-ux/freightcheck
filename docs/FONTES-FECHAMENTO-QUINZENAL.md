# As fontes do fechamento quinzenal — e como elas se conversam

> **Origem:** aprendizado sobre um conjunto real de arquivos da quinzena
> **16–31/07/2026**, CDD Belém, transportadora **036 – Horizonte Logística**.
> Todos os vínculos descritos aqui foram conferidos numericamente contra os
> próprios arquivos — os valores citados fecham ao centavo, salvo onde dito o
> contrário. Este documento alimenta o ambiente **Fechamento** (ver
> `FECHAMENTO.md`) e é a especificação de que `lib/fechamento` nasceu — o
> pacote lê as fontes e reconstrói esta conta inteira, com testes.

## O ciclo em uma frase

A operação diária gera o **variável** (2Art), a indisponibilidade de frota gera
**descontos no fixo** (03.08.18), as despesas extras aprovadas viram
**complemento** (03.08.12.09); tudo se materializa em **CT-es por verba**
(03.08.15), o Promax **concilia** CT-e emitido contra o calculado pelo SRTrans
(03.02.59.02), e a planilha **Fechamento_Remuneracao.xlsb** é onde a
transportadora/CDD reconstrói e confere cada uma dessas pontas.

## Em que formato cada fonte chega

Os nomes de arquivo citados abaixo (`2art.xlsx`, `03.08.15.xlsx`, `.txt`,
`.csv`) são os do conjunto real de que este documento nasceu — **não** são a
única forma em que cada relatório sai. O mesmo relatório vem em `.xlsx` quando
alguém o exporta pela tela do Promax e em `.csv` quando o exporta pela fila de
relatórios, e chega em `.txt` quando o caminho passou por um sistema que
renomeia. Uma exportação já vista no CDD Belém:
`03.08.15_1Q_JUL.csv` ao lado de `2artq_congel_01_072026_0443_0036.xlsx` e de
`03.02.59.02_1Q_07.txt`.

Por isso o produto **decide o formato pelo conteúdo do arquivo, não pela
extensão** (ver `lib/fechamento/src/leitores/formato.ts`): assinatura de ZIP ou
de OLE2 é planilha; o resto é texto, e aí a pergunta seguinte é se ele é
delimitado ou de largura fixa. O que cada fonte aceita está em
`FORMATOS_DA_FONTE` (`lib/fechamento/src/dominio.ts`), e é a lista que a tela
mostra em cada linha de envio:

| fonte | formatos aceitos |
| --- | --- |
| 2Art | `.xlsx` `.xls` `.csv` `.txt` |
| 03.08.15 | `.xlsx` `.xls` `.csv` `.txt` |
| 03.08.18 | `.xlsx` `.xls` `.csv` `.txt` |
| 03.08.12.09 | `.csv` `.txt` `.xlsx` `.xls` |
| 03.08.20 | `.txt` `.csv` |
| 03.02.59.02 | `.txt` `.csv` |

Três consequências que não são detalhe de implementação:

1. **A data muda de forma com o formato.** Num `.xlsx` o 03.08.15 data em
   serial (`46219`); num `.csv` não existe serial, e a mesma coluna vem
   `16/07/2026`. As três formas (serial, `dd/mm/aaaa`, `ddmmaaaa`) são lidas
   por `diaDeCelula`, e não se confundem entre si — os intervalos não se
   sobrepõem.
2. **O 03.08.18 é o único em que a aba é dado.** É o nome dela (`FF`, `Van`)
   que diz de que frota é a linha, e as duas descontam coisas diferentes. Um
   `.csv` dele só é aceito quando alguma coluna declara a frota; sem ela, a
   recusa é do arquivo inteiro e pede a planilha.
3. **O 03.02.59.02 é o único em que a coluna do número é o sentido.** No
   `.txt`, a régua de caracteres resolve (emitido termina na 75, calculado na
   88). No `.csv`, quem resolve é o índice do campo, descoberto no cabeçalho do
   próprio arquivo (`(Emitido)` / `(Calculado)`) ou nas duas únicas colunas que
   trazem valor. Quando nem uma coisa nem outra resolve, o leitor **recusa** —
   escolher a coluna daria um fechamento plausível e errado.

As duas fontes de largura fixa não aceitam planilha, e isso é deliberado:
coladas numa planilha elas perdem a forma em que o relatório escreveu o valor,
e o resultado seria uma verba lida a menos, em silêncio.

## As sete fontes

### 1. Relatório 2Art (`2art.xlsx`, aba `2Art_07`)

O diário operacional, **uma linha por mapa/viagem** (949 linhas, 14 dias úteis
de 16/07 a 31/07, ~120 colunas). Traz data (`ddmmaaaa`), veículo e placa,
**Frota** (`Padrao` | `Spot` | `Fixo` | `Espec.`), canal **Entrega**
(`Rota` | `AS`), mapa, caixas carregadas/entregues, ocupação, horários e km de
saída/retorno, e a cadeia monetária da viagem: `ValorFrete` (= `CustoVariavel`),
`TipoImposto` (`CTRC-ICMS`), `PercImposto` (27,39), `ValorImposto` e
`ValorFaturado` (= frete com gross-up de imposto). Também abre a remuneração da
equipe (`ValorUnitPontoMot/Ajd`, `ValorEquipeEntrMot/Ajd`) e o previsto do
roteirizador (`TempoPrevistoRoad`, `KmPrevistoRoad`).

**É a origem do custo variável por viagem** — e, desde a visão por dia, a fonte
que a tela `/fechamento/competencias/:id/dias/:dia` reproduz linha a linha: o
2Art é lido inteiro (as ~60 colunas que a aba diária mostra), e não só as quinze
que a conta soma. Ver `FECHAMENTO.md`.

### 2. Relatório 03.08.18 — disponibilidade de frota (`03.08.18.xlsx`, abas `FF` e `Van`)

**Uma linha por dia** do mês (datas em serial Excel; 46204 = 01/07/2026), por
tipo de frota (FF = caminhões da frota fixa; Van). Compara frota **Contratada**
contra o **Real** (1ª e 2ª viagem) e decompõe o gap por responsabilidade:
`Gap Cia.` (da Ambev, não desconta) versus `Gap TP …` (da transportadora,
cancelado/não cancelado). Cada gap da transportadora vira desconto:
`Desc.FF Custo Fixo`, `Desc.FF Equipe`, `Desc.FF Indiretos`, `Desconto FA`
(fator ajudante) e `Desconto Total`. Traz ainda % de utilização e
disponibilidade.

**É a origem dos descontos sobre a parcela fixa da remuneração.**

### 3. Relatório 03.08.12.09 — requisições de despesas extras (`.csv`, `;`, latin-1)

**Uma linha por requisição** aprovada no SRTrans para a quinzena (coluna
`Quinzena Pagamento` = rótulo `16/07/2026`, isto é, a quinzena 16–31/07). Cada
requisição tem canal (`Rota`/`AS`), tipo de despesa (incentivo, hora extra,
RV equipe de entrega, taxa de descarga, pernoite, pedágio…), a **VBZ** de
destino (`000006` RV EE, `000009` Rota-Outras, `000029` AS-Estadias, `000030`
AS-Outras…), o valor **sem imposto** e a trilha de aprovação (solicitante →
aprovador regional → aprovador AC, com data/hora de cada decisão).

Na amostra: total 291.097,69 = **Rota 262.282,80** + **AS 28.814,89**.

**É a origem do pagamento complementar (o que não nasce do cálculo automático).**

### 4. Relatório 03.08.15 — CT-es emitidos por verba (`03.08.15.xlsx`)

**Uma linha por CT-e/NF** (23.250 linhas), todas com `Data` = 46219
(o rótulo 16/07/2026 da quinzena). Cada linha: **VBZ** (verba: Rota/AS ×
Frota Fixa Ativa/Inativa/Variável, Equipe Entrega, Despesa Administrativa,
Freteiro, Outras Despesas, Estadias…), número do CT-e e da NF, `Valor CT-e` e a
abertura de impostos (`Vlr. Frete` + ICMS + PIS + COFINS = CT-e), e a chave de
acesso (`Nr Controle`). Total da amostra: 1.473.432,61 — aqui aparecem **também
as parcelas fixas** (Frota Fixa Ativa 74.050,40; Equipe Entrega 203.160,40;
Despesa Administrativa 352.946,00…), que a conciliação de variável (03.02.59.02)
não cobre.

**É o extrato fiscal: tudo que foi efetivamente faturado, verba a verba.**

### 5. Relatório 03.08.20 — demonstrativo de pagamento (`.txt`, largura fixa, latin-1)

O documento que **as duas partes assinam** ("declaramos estar de acordo com os
valores acima"), por canal (ROTA e AS) e em dois blocos por canal (**FRETE** e
**OUTROS CUSTOS**). Cada verba vem em seis colunas: `S/Imposto`, `NF-ISS`,
`CTRC-ICMS`, `Valor Faturado` e as duas de VLC. Os percentuais das duas
naturezas de documento estão no próprio cabeçalho (2,38% / 97,62% na Rota;
0% / 100% no AS). Depois das verbas vêm os descontos — devolução (com base e
percentual), os quatro de disponibilidade e o frete mínimo —, cada um com a
frase que diz **de qual VBZ ele já foi subtraído**. Fecha em `Total
Remuneração` por canal: 1.355.682,61 (Rota) e 89.748,02 (AS) na amostra.

**É a fonte que abre a parcela fixa** — a única. A coluna `CTRC-ICMS` é a que
vira CT-e, e ela bate **ao centavo** com o 03.08.15 nas seis verbas fixas dos
dois canais (VBZ 01, 02, 03, 04, 20, 23): os R$ 654.310,24 que nenhuma outra
fonte sustentava. Nas cinco verbas variáveis (05, 07, 08, 24, 26) os dois
documentos discordam em R$ 54.841,96 — e isso é achado, não erro de leitura: o
demonstrativo é tirado numa data e o CT-e carrega saldo de quinzenas
anteriores.

**É também o único relatório que declara o próprio período**, em letra, no
cabeçalho de toda página (`Periodo: 16/07/2026 a 31/07/2026`). Nas outras
fontes o que existe é data de emissão, de aprovação, ou o rótulo da quinzena —
e rótulo não é data. Por isso é nele que a competência aberta no mês errado é
recusada na porta.

### 6. Relatório 03.02.59.02 — conciliação CT-e × SRTrans (`.txt`, Promax)

Relatório sintético do Promax por transportadora e quinzena, em duas seções
(**ROTA** e **AS**), cada uma com duas colunas: **R$ CT-e (Emitido)** e
**R$ SRTrans (Calculado)**. Traz as pendências (saldo de quinzenas anteriores,
NF-e sem CT-e, CT-es represados), o resumo da quinzena (Frota Fixa + Freteiro +
S.Diversos = Total Variável), o **Desconto Frete Mínimo** (só na coluna
calculada), o **complementar variável** por alteração de perfil/cancelamento, e
o total geral. Na amostra: CT-es recebidos 417.970,31 = Rota 336.221,62 +
AS 81.748,69; calculado SRTrans 371.946,03; saldo para a próxima quinzena
22.043,27 = 16.096,70 (Rota) + 5.946,57 (AS).

**É o fecho: o que foi faturado contra o que o sistema diz que era devido.**

### 7. `Fechamento_Remuneracao.xlsb` — a planilha-mãe da conferência

Pasta de trabalho "FECHAMENTO SRTRANS" com ~44 abas que **espelham as fontes
acima**, aba por aba:

- **`01`…`31`** — uma aba por dia do mês, alimentada pelo 2Art, com
  `TOTAL PADRAO` e `TOTAL SPOT` do dia;
- **`Mapa Rota`** e **`Resumo Geral`** — matrizes dia × indicador (frota fixa
  em rota, spot, etc.) para o mês;
- **`Outros Custos`** — as despesas extras por quinzena, alimentada pelo
  03.08.12.09;
- **`03.08.15`** e **`03.08.18`** — cópias dos relatórios homônimos (a
  `03.08.18` com coluna auxiliar `Concatenar` para PROCV);
- **`748`** e **`305`** — conferência de NF/frete fixo (código, tabela de
  frete, alíquota, ICMS, frete total, coluna `Conferência`);
- **`Base`**, **`Cadastro`**, **`Conferência`**, **`Abertura`**,
  **`Justificativa`** — parametrização (datas de fechamento, filial
  "BELÉM ROTA", legenda, motivos de gap: absenteísmo, atraso de carregamento,
  bloqueio telemetria, desconto indevido…) e os totais NF × CT-e por quinzena.

## Como elas se conversam (vínculos conferidos)

```
2Art (viagem a viagem) ──────────────► xlsb abas 01..31 / Mapa Rota / Resumo Geral
03.08.18 (indisponibilidade) ────────► descontos no fixo · xlsb aba 03.08.18
03.08.12.09 (requisições) ──► × gross-up de imposto ──► CT-es no 03.08.15 (VBZs 06/09/29/30)
                          └─────────────────────────────► xlsb aba Outros Custos
03.08.15 (CT-es por verba) ── variáveis = "R$ CT-e Emitido" + complementar ──► 03.02.59.02
03.02.59.02 (conciliação) ── saldos e pendências ──► próxima quinzena
```

1. **2Art → abas diárias do xlsb.** A aba `16` do xlsb tem
   `TOTAL PADRAO = 12.406,10` e `TOTAL SPOT = 5.312,62`; no 2Art, dia
   16/07, canal **Rota**, a soma de `ValorFaturado` dá exatamente
   12.406,10 (frota Padrao) e 5.312,62 (frota Spot). As abas diárias são o
   2Art filtrado por canal Rota e agrupado por tipo de frota.

2. **03.08.12.09 → aba Outros Custos do xlsb.** A soma das requisições de
   canal Rota (262.282,80, sem imposto) é exatamente o valor "2ª QZN" da aba
   `Outros Custos`; a mesma aba mostra o valor com imposto (358.530,22).

3. **A igualdade central: como cada CT-e se forma.** Todo CT-e emitido em uma
   verba é a soma de no máximo três parcelas:

   ```
   CT-e da verba  =  o que o SRTrans calculou      (03.02.59.02, quinzena atual)
                  +  o complementar de perfil       (03.02.59.02, bloco complementar)
                  +  requisições aprovadas × fator  (03.08.12.09, convertido)
   ```

   Essa igualdade fecha nas **quinze** verbas da quinzena conferida, com
   resíduo máximo de R$ 0,01 quando o fator é medido dos próprios arquivos.
   Exemplos:

   - VBZ 5 (Rota Frota Fixa Variável) 208.498,46 = 206.283,08 + 2.215,38
   - VBZ 7 (Rota Freteiro) 139.431,82 = 129.938,54 + 1.426,03 + 6.000,00 × 1,34454
   - VBZ 9 (Rota Outras Despesas) 99.828,99 = 74.247,66 × 1,34454
   - VBZ 29 (AS Estadias) 39.420,04 = 28.622,89 × 1,37724
   - VBZ 26 (AS Freteiro) 75.685,88 = 70.765,03 + 4.920,85

   As verbas *fixas* (Ativa, Inativa, Equipe Entrega, Despesa Administrativa)
   ficam fora desta igualdade — ela cobre o que nasce da operação e do
   complementar. Elas são R$ 654.310,24 dos R$ 1.473.432,61 emitidos, e quem
   as sustenta é o **03.08.20**, numa igualdade de uma parcela só:

   ```
   CT-e da verba fixa = a coluna CTRC-ICMS do 03.08.20
   ```

   Ela fecha ao centavo nas seis: VBZ 01 (74.050,40), 02 (203.160,40),
   03 (352.946,00), 04 (23.442,14), 20 (355,65) e 23 (355,65).

4. **Há três percentuais de imposto no mesmo fechamento, e eles não são iguais.**
   Este é o achado que a planilha não tinha como mostrar:

   | percentual | onde aparece | medido |
   | --- | --- | --- |
   | pagamento, canal Rota | requisição → CT-e | **25,6252%** (fator 1,344541) |
   | pagamento, canal AS | requisição → CT-e | **27,3900%** (fator 1,377240) |
   | fiscal, dentro do CT-e | `Vlr. Imposto` ÷ `Valor CT-e` | **26,477%** (fator 1,360112) |

   Os dois primeiros são regra de remuneração e mudam por canal; o terceiro é a
   composição tributária do documento (ICMS 19% + PIS 1,336% + COFINS 6,156%).
   No canal Rota o complementar é convertido a 25,63% enquanto o CT-e compõe a
   26,48% — **1,17% a menos** do que a carga fiscal do próprio documento. É uma
   pergunta legítima para a Ambev. Nenhum desses percentuais deve ser escrito em
   código: `lib/fechamento` os **mede** dos arquivos a cada apuração.

5. **O 2Art fecha contra o calculado do SRTrans.** A soma de `ValorFaturado`
   por canal, no período, é diretamente comparável ao `Total Variavel Calculado
   SRTRANS` da conciliação. No canal **AS** bate ao centavo — R$ 49.352,25 dos
   dois lados —, o que prova que a comparação é legítima; no canal **Rota** o
   2Art soma R$ 328.169,46 contra R$ 322.593,78 calculados, abrindo
   **R$ 5.575,68** sem explicação nas fontes.

7. **03.08.18 → parcela fixa.** Os descontos diários (`Desconto Total` de FF e
   Van) reduzem o custo fixo pago; a aba espelho no xlsb existe para cruzá-los
   com o que foi faturado. O vínculo aritmético com uma linha específica do
   03.08.15 não foi fechado nesta amostra (o fixo é mensal, a amostra é de uma
   quinzena).

8. **03.02.59.02 fecha o ciclo.** Dentro do TXT: 417.970,31 (recebido) =
   336.221,62 + 81.748,69; 371.946,03 (calculado) = 322.593,78 + 49.352,25 —
   a diferença entre recebido e calculado é o **Desconto Frete Mínimo**
   (17.398,54 na Rota + 37.552,94 no AS); e o saldo que atravessa para a
   próxima quinzena (22.043,27) carrega NF-e sem CT-e e saldos anteriores.

## Convenções que valem para todas

- **A primeira quinzena tem quatro relatórios; a segunda, seis.** O 2Art, o
  03.08.15, o 03.08.20 e o 03.08.18 entram nas duas; as requisições
  (03.08.12.09) e a conciliação (03.02.59.02) chegam com o fechamento da
  segunda. A amostra deste documento é uma segunda quinzena — por isso ela traz
  as seis. No código a regra mora em `FONTES_DA_QUINZENA`
  (`lib/fechamento/src/dominio.ts`): a apuração não chama de ausente uma fonte
  que a quinzena não tem, e a tela não pede um arquivo que ninguém pode enviar.
  Ela também não recusa o contrário — o que chegar fora da quinzena dele é
  lido e apurado como qualquer outra fonte.
- **"Quinzena 16/07/2026"** é rótulo, não data de emissão: significa o período
  16–31/07. Datas aparecem em três formatos: serial Excel (46219 = 16/07/2026;
  46204 = 01/07/2026), `ddmmaaaa` (2Art) e `dd/mm/aaaa` (CSV/TXT).
- **O `ddmmaaaa` do 2Art tem sete dígitos nos dias 1 a 9.** A coluna é
  numérica, e todo número perde o zero à esquerda: 01/07/2026 chega como
  `1072026`. O zero perdido só pode ser o do dia — o do mês fica no meio do
  número (`10072026` para 10/07), e o Excel não corta dígito interno.
- **O cabeçalho do 2Art vem em duas grafias.** A exportação direta do Promax
  escreve `CxCarreg` e `ValorFrete`; a mesma planilha salva de dentro da pasta
  de fechamento escreve `CX CARREG` e `VALOR FRETE`. São as mesmas colunas, e o
  leitor reconhece as duas (`compactarColuna`, em `leitores/planilha.ts`).
- **Canal** (`Rota` = distribuição urbana; `AS` = área de serviço/interior) e
  **tipo de frota** (`Padrao`, `Spot`, `Fixo`/Van, `Espec.`) são os dois eixos
  de agregação de tudo.
- **VBZ** é a verba orçamentária que liga requisição → CT-e → conciliação; é a
  chave semântica entre 03.08.12.09, 03.08.15 e o TXT.
- Valores do SRTrans circulam **sem imposto**; CT-e é **com imposto**
  (fator por canal). Comparar os dois sem essa conversão é o erro clássico —
  e o fator nunca deve ser presumido, porque há três percentuais diferentes no
  mesmo fechamento (item 4).

## O que ainda não se sabe

Duas pontas continuam abertas, e estão aqui para não serem confundidas com
coisa resolvida:

- **O que forma cada parcela fixa.** O 03.08.20 diz *quanto* é cada verba fixa
  e fecha ao centavo com o CT-e, o que tira os R$ 654.310,24 do escuro. O que
  ele não abre é a formação: quantos veículos, a que valor contratado, com que
  desconto — a tabela de contrato, que é justamente o que a Auditoria do
  FreightCheck já conhece. Ligar as duas troca "o demonstrativo diz 74.050,40"
  por "74.050,40 = 8 veículos × R$ … − R$ … de indisponibilidade".
- **Os R$ 54.841,96 entre o 03.08.20 e o 03.08.15** nas cinco verbas variáveis.
  Saldo de quinzena anterior, CT-e represado e frete mínimo são os candidatos —
  o 03.02.59.02 traz os três, e cruzá-los é o próximo passo.
- **Por que o canal Rota abre R$ 5.575,68** entre o 2Art e o calculado do
  SRTrans, se o canal AS bate ao centavo.
