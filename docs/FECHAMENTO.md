# FreightCheck — Os dois ambientes: Auditoria e Fechamento

> **Status:** fundação implementada. Estrutura de navegação, rotas e telas do
> Fechamento existem; nenhuma lógica financeira de fechamento foi construída.

## O que são os dois ambientes

O FreightCheck é **um** produto — um login, uma empresa/unidade, uma base de
frota, uma infraestrutura, um design system — que atende **dois** processos:

| | Auditoria de Remuneração | Fechamento de Remuneração |
|---|---|---|
| Pergunta | O que mudou? Está correto? Qual o impacto? Há valor a recuperar? | Quanto devemos receber nesta competência? O que está pendente? Podemos fechar? |
| Eixo | A vigência (o retrato que o Freightec exporta) | A competência (o período de apuração, com estado e ciclo de vida) |
| Natureza | Investigação contínua | Fluxo com começo, meio e fim |

A relação entre eles é de mão dupla e vive **no modelo, não nas telas**:
o Fechamento apura o valor da competência; a Auditoria confere se aquele valor
se sustenta; a divergência encontrada volta ao Fechamento como pendência ou
ajuste, e o que for cobrável segue para Recuperação.

## A regra que separa os dois

**A URL é a única fonte da verdade sobre o ambiente aberto.**

- Tudo sob `/fechamento/...` é Fechamento.
- Todo o resto é a Auditoria de sempre.

A regra vive em `artifacts/freightaudit/src/lib/ambiente.ts` e é uma função
pura sobre a localização — sem provider, sem `localStorage`, sem estado que
possa divergir do endereço. Compartilhar um link compartilha o ambiente;
voltar no histórico volta o ambiente junto.

**Por que a Auditoria não foi movida para `/auditoria/...`:** as rotas atuais
são o produto em uso — favoritos, links em e-mail, histórico de navegador.
Movê-las daria simetria ao custo de quebrar todos esses links. O prefixo
explícito ficou para o domínio que nasce agora, onde não custa nada.

## Como se troca de ambiente

Pelo seletor no topbar, colado à marca — `FreightCheck | Auditoria ▾` —
implementado em `components/layout/topbar.tsx`. Ele mostra sempre o ambiente
aberto e lista os dois com nome completo e descrição. Trocar navega para a
home do outro (`/visao-gerencial` ou `/fechamento`). A marca também leva à home
**do ambiente aberto**, para que "voltar ao início" nunca troque de espaço de
trabalho sem avisar.

As duas homes são a mesma tela em ambientes diferentes — a **Visão Gerencial**
de cada um —, e isso é deliberado: quem entra entra pelo conjunto, e desce à
unidade depois. A da Auditoria mudou de endereço para isso: `/` deixou de
renderizar o Resumo executivo, que passou a ter endereço próprio
(`/resumo-executivo`), e virou a porta que encaminha — para a Visão Gerencial
quando vem nua, e para o Resumo executivo quando vem com recorte na consulta,
que é o formato de todo link antigo. A regra inteira está em `lib/ambiente.ts`
(`destinoDaRaiz`).

## A lateral contextual

A lateral é o mesmo componente (`components/layout/sidebar.tsx`) com duas
listas:

- **Auditoria** — `NAV_GROUPS`: Visão executiva, Auditoria, Recuperação, QLP,
  Frota, Inteligência, Dados & governança, Administração. As oito seções e a
  ordem delas são as de sempre; o único item acrescentado desde a separação dos
  ambientes é a **Visão Gerencial**, que abre a Visão executiva com o acervo
  inteiro (todas as unidades) acima do Resumo executivo, que responde pela
  unidade aberta — e que, desde que virou a entrada do ambiente, é também a
  tela em que o produto abre. Ver `pages/visao-gerencial.tsx` e a seção
  correspondente no `replit.md`.
- **Fechamento** — `components/layout/nav-fechamento.ts`, cinco seções na
  ordem do processo:
  - **Fechamento**: Visão Gerencial · Importações · Apurações · Resumo geral · Conciliação
  - **Remuneração**: Cadastro
  - **Apuração**: Apuração · Pendências · Conferências
  - **Decisão**: Ajustes · Aprovações · Encerramento
  - **Registro**: Histórico

Cinco desvios deliberados da lista originalmente proposta:

1. **Apuração vem antes de Pendências** — pendência é o que a apuração não
   conseguiu apurar; sem rodar a conta, não há fila.
2. **A primeira seção chama-se "Fechamento", e o ato final, "Encerramento"** —
   o nome do processo fica onde ele começa, e um segundo item com a mesma
   palavra diria dois sentidos de uma vez.
3. **A lista de competências chama-se "Importações"** — o que se faz nela é
   abrir o período e enviar os relatórios da quinzena; a lista é
   consequência. Ao lado dela, **Apurações** mostra o resultado dessa
   importação: o que já foi apurado, quanto foi emitido e quanto há a
   questionar.
4. **Remuneração entrou entre Fechamento e Apuração** — ela não é um momento do
   processo, é a base contra a qual ele roda (ver abaixo). Não foi para o topo
   porque a primeira linha da lateral é a home do ambiente.
5. **A home chama-se "Visão Gerencial"** — ver a seção abaixo. A primeira
   versão, "Visão do fechamento", listava as seis competências mais recentes:
   respondia "o que aconteceu por último", que é pergunta de quem opera.

O cartão de unidade aparece nos dois ambientes (a unidade governa os números
dos dois); no Fechamento ele informa e não vira seletor, porque trocar unidade
hoje leva a uma tela da Auditoria. O convite ao assistente é só da Auditoria
pela mesma razão.

## As telas do Fechamento

Todas nascem no padrão honesto do produto (o mesmo de
`pages/telas-em-preparo.ts`): **nenhum número que o banco não sustente.**
O catálogo em `pages/fechamento/etapas.ts` descreve, por etapa, a pergunta,
o que falta no banco e onde olhar hoje — atalhos que quase sempre cruzam para
a Auditoria e o dizem por extenso, com uma tarja "Auditoria" antes do clique.

Construir uma etapa de verdade é o movimento de sempre: a entrada sai do
catálogo, a rota em `App.tsx` aponta para a tela real, e o menu não muda.

## A Visão Gerencial — o ano por unidade

A home do ambiente (`pages/fechamento/visao.tsx`) responde à pergunta de quem
**responde pelo número**, e não à de quem o produz: *quanto do ano já fechou, em
quais unidades, e onde está o atraso.*

Uma faixa executiva do ano escolhido — fechamentos realizados (%), quinzenas
vencidas em aberto, quinzenas vencidas sem competência, emitido em CT-e e
quanto continua a questionar — e, abaixo, um cartão por unidade em ordem do
atraso, cada um com o seu percentual, o dinheiro apurado e uma faixa de 24
traços que mostra *quando* o ano fechou. Clicar no cartão abre
`/fechamento/unidades/:codigo?ano=AAAA` (`pages/fechamento/unidade.tsx`): as 24
quinzenas do ano daquela unidade, uma a uma, com as competências de cada uma e o
caminho até a tela de dentro.

Quatro decisões que as duas telas materializam:

1. **O percentual de fechamento é sobre a competência, não sobre o
   calendário.** Uma unidade com 12 competências e 7 encerradas está em 58%,
   ainda que o ano tenha 24 quinzenas. Dividir por 24 daria um número menor e
   mais alarmante que também seria falso — o sistema não sabe se a unidade
   deveria ter operado em janeiro, e uma unidade que começou em julho apareceria
   eternamente reprovada por um passado que não é dela.
2. **O que o calendário tem a dizer não se perde: vira lacuna.** A quinzena que
   passou sem competência nenhuma é contada à parte, só entre as que **já
   venceram**, e aparece pelo nome na grade do ano. É a informação que nenhuma
   lista de registros consegue dar, porque não há registro nenhum para listar —
   a mesma razão pela qual o dia sem operação aparece na grade de dias.
3. **Nada aqui recompõe remuneração.** A leitura é a de Apurações
   (`GET /fechamento/apuracoes`), com os totais que a apuração gravou. O
   agrupamento por unidade e a divisão que vira percentual moram em
   `lib/fechamento-gerencial.ts`, fora do JSX e sob teste.
4. **A unidade não está na lateral.** `/fechamento/unidades/:codigo` é
   aprofundamento de um número da home, não uma seção do processo — o menu
   continua sendo as cinco etapas do trabalho.

## A visão por dia — as abas `01`…`31` da planilha

A competência aberta (`pages/fechamento/competencia.tsx`) tem cinco partes, e a
segunda é a **grade de dias**: um ladrilho por dia do período, com o que a
operação rodou naquele dia, e um clique que abre
`/fechamento/competencias/:id/dias/:dia` — a viagem a viagem daquele dia, com
`TOTAL PADRÃO` e `TOTAL SPOT` ao fim de cada grupo de frota.

É a parte da planilha que a apuração não substituía. A conta responde *quanto a
quinzena vale, verba a verba*; a aba diária responde outra pergunta, que é a de
quem opera: **o que aconteceu no dia 3.** Sem ela, discordar de um total exigia
reabrir o 2Art.

O que sustenta a tela:

| onde | o quê |
| --- | --- |
| `lib/fechamento/src/leitores/operacao.ts` | lê a viagem inteira: os 15 campos que a conta soma, e o `detalhe` — veículo, horários, laço, ocupação, remuneração da equipe |
| `lib/fechamento/src/diario.ts` | `diasDaCompetencia` (a grade) e `abrirDia` (a aba), aritmética pura |
| `lib/db` (migration `0042`) | as 47 colunas do retrato, todas anuláveis: coluna que a exportação não trouxe fica `NULL`, nunca `0` |
| `routes/fechamento.ts` | `GET …/dias` e `GET …/dias/:dia` |
| `components/fechamento/` | a grade de ladrilhos, o catálogo de colunas e a tabela larga |

Quatro decisões que a tela materializa:

1. **O dia sem operação aparece na grade**, apagado e clicável. "Não rodou" é
   uma resposta; a grade que esconde o dia vazio obriga a contar ladrilhos para
   descobrir qual falta. O que a tela nunca faz é confundir isso com "o 2Art não
   foi importado" — esse caso é dito por extenso, acima da grade.
2. **Os totais vêm do servidor**, da mesma função que alimenta a apuração. Uma
   soma feita na tela seria uma segunda conta do mesmo dinheiro.
3. **A última coluna da tabela é a linha física do 2Art.** É a ponta da trilha:
   permite conferir a célula de origem sem refazer a conta.
4. **O 2Art de outro período é recusado na porta**, com os dois períodos
   nomeados (`DOCUMENTO_FORA_DO_PERIODO`). Metade do arquivo cair fora é o
   normal — ele é mensal e a quinzena é meio mês —, e essa metade é contada, não
   recusada. *Nenhuma* linha cair dentro é outra coisa: é o arquivo de um
   período aberto na competência de outro. Ele entrava com visto verde e "949
   linhas" na linha da fonte, gravava tudo, e a grade nascia inteira vazia — a
   importação que mente é a que diz ter dado certo. A checagem é só do 2Art,
   porque só nele a data da linha é o dia em que a viagem rodou; nas outras
   fontes é emissão ou aprovação, que atravessa a virada da quinzena de forma
   legítima.

## O Resumo Geral — o mês nas três colunas em que ele é discutido

`/fechamento/resumo` é a aba `Resumo Geral` da planilha, sem planilha. A
apuração tem grão de quinzena, que é o grão certo para apurar; o documento que
a transportadora leva para a mesa tem grão de **mês**. A tela põe 1ª quinzena,
2ª quinzena e TOTAL lado a lado, verba a verba, e fecha com as mesmas linhas
com que a planilha fecha.

Dois seletores no topo, um por pergunta. **Verbas · Planilha** escolhe em que
linguagem se lê o mês; **1ª quinzena · 2ª quinzena · Consolidado** escolhe que
pedaço dele. Nenhum dos dois troca de tela nem de consulta — os quatro recortes
saem do mesmo dado, buscado uma vez, e é justamente entre eles que se fica indo
e voltando.

Quatro decisões que a tela materializa:

1. **Duas abas, e não uma escolha entre dois rótulos.** `Verbas` mostra o
   recorte com que o sistema apura — a VBZ, que os arquivos sustentam uma a uma.
   `Planilha` mostra o recorte com que a Ambev e a transportadora conversam —
   `Custo fixo padronizado`, `Custo variável (agregado)`, `Desconto de
   devolução`. Não dá para escolher um: as linhas do primeiro quadro da planilha
   são um rateio por tipo de frota que o 03.08.20 não faz, e escrevê-las sobre
   as verbas daria cara de conferido ao que não foi; mas conferir só por verba
   obriga quem discute o mês a casar de cabeça com o `.xlsb` aberto ao lado. As
   duas abas fecham no mesmo `Total remuneração (03.08.20)`, e é isso que faz
   delas duas vistas e não duas contas. A aba `Planilha` mostra ainda os dois
   números que a separam dele — a soma dos quadros, sem imposto, e o imposto,
   que é a subtração dos dois e não um fator digitado. As mesmas duas abas
   aparecem em `A conta da quinzena`, no mesmo componente, para que não possam
   divergir. Os rótulos são os da planilha escritos como se escreve: a
   transcrição literal, em caixa alta, viaja no dado e aparece ao abrir a
   linha.
2. **O fecho compara com o 03.08.20, e não com o `TOTAL GERAL UNIDADE`.**
   Aquela coluna é a reconstrução da própria planilha, feita com um fator de
   conversão digitado (1,366960) que não sai de arquivo nenhum — os medidos são
   1,344541 na Rota e 1,377221 no AS. A tela põe lado a lado os dois números
   que têm documento: o emitido em CT-e e o `Total Remuneração` do
   demonstrativo assinado. A diferença entre eles é a linha que a planilha
   chama de `DIFERENÇA - TOTAL GERAL`.
3. **A coluna que falta é traço, e o total não a soma como zero.** Meio mês
   importado é o estado normal de quem está trabalhando, e "esta quinzena valeu
   zero" é diferente de "esta quinzena não foi apurada" — a planilha escreve as
   duas como `R$ -`.
4. **Os descontos do 03.08.20 aparecem fora das somas.** O relatório diz, em
   cada linha, que o valor já foi subtraído da verba correspondente. Eles estão
   ali para conferir contra as linhas de desconto da planilha, não para somar
   de novo.

A aritmética mora em `lib/fechamento/src/resumo.ts`, pura e sob teste, pela
mesma razão de `lib/fechamento-gerencial`: uma soma feita no navegador é uma
segunda opinião sobre remuneração.

A planilha que a operação mantém **não** aparece aqui: conferir o mês contra o
`.xlsb` anexado é outra pergunta, e ela tem tela própria — a Conciliação, logo
abaixo. O Resumo ficou com o que se lê todo dia sem depender de anexo nenhum.

## A Conciliação — o fechamento contra a planilha que a operação mantém

`/fechamento/conciliacao` responde a pergunta que se faz com o `.xlsb` aberto ao
lado: *o meu fechamento — do meu cadastro e das minhas importações — bate com a
minha planilha?* Anexa-se a `Fechamento_Remuneracao.xlsb` daquele mês e cada
linha aparece com o **devido** (do contrato e do diário), o **demonstrado** (do
03.08.20), o que o `RESUMO GERAL` dela **publica**, e a distância entre o devido
e a planilha.

**Por que é um módulo, e não mais duas colunas no Resumo geral.** O Resumo
responde todo dia, sem depender de anexo nenhum: duas fontes que sempre existem
e a diferença entre elas. A conferência contra a planilha só existe depois de
alguém anexar um arquivo — tem gesto próprio (anexar, versionar, trocar de
régua), procedência própria (qual arquivo, quem, quando, `sha256`) e um estado
normal que é "ainda não há planilha". Espremer isso em duas colunas
condicionais fazia a mesma tabela ter duas larguras e duas leituras, e escondia
o anexo dentro de um painel do Resumo.

A separação é de endereço, e não só de tela:

1. **`GET /fechamento/resumo` não lê a referência.** Ele não faz a consulta,
   não a enxerta, e responde igual antes e depois de um anexo — provado em
   `routes/__tests__/fechamento-conciliacao.test.ts`.
2. **`GET /fechamento/conciliacao` lê as duas coisas em paralelo** e as junta
   com `resumoComReferencia`, que é transformação pura. As duas leituras são
   independentes e a ordem entre elas não importa — é o que se quer provar.
3. **As duas endereçam o mês pela mesma régua** (`mesDoFechamento`): a mesma
   URL recebe a mesma recusa, palavra por palavra, nos dois endereços. Uma
   segunda cópia da validação faria um link colado numa mensagem abrir uma tela
   e quebrar a outra.

Três decisões que a tela materializa:

1. **A planilha é régua, e régua não entra na conta.** O enxerto acontece
   **depois** de o devido estar calculado (`painel-referencia.ts`), e o cálculo
   não tem um único import da referência — `contaminacao.test.ts` reprova quem
   escrever o primeiro. Uma régua que mudasse o que ela mede não seria régua.
2. **A diferença com causa conhecida continua inteira.** O nome da investigação
   já feita entra como legenda embaixo do número; o número não é absorvido nem
   arredondado para zero. Um painel que zerasse a divergência cuja causa já se
   sabe concordaria consigo mesmo por construção.
3. **Sem devido não há o que conciliar, e a tela diz isso.** O diagnóstico das
   três portas do cadastro é o mesmo do Resumo, no mesmo componente
   (`components/fechamento/por-que-nao-tem-devido.tsx`), para que as duas telas
   não digam duas coisas sobre o mesmo cadastro. Comparar o arquivo com a
   releitura do próprio 03.08.20 seria uma conferência que concorda consigo
   mesma.

O total de cada quadro é o que a planilha **publica** na linha de total, e não a
soma das linhas dela: a reconciliação encontrou um total (`AJ133`) cuja fórmula
discorda das próprias parcelas, e somar aqui esconderia exatamente esse defeito.

## O de-para — a classificação do sistema conversando com a da planilha

O fechamento classifica dinheiro por **VBZ** (`05 - Frota Fixa Variável`,
`07 - Freteiro`). A planilha classifica o mesmo dinheiro por **quadro do
RESUMO** (`CUSTO FIXO PADRONIZADO`, `CUSTO VARIÁVEL (AGREGADO)`, `TOTAL OUTROS
CUSTOS`). São dois recortes do mesmo total, e quem conferia lia os dois lado a
lado e casava de cabeça. `lib/fechamento/src/de-para.ts` é essa tradução
escrita, com os vinte rótulos do painel da Rota transcritos acento por acento
— e com um segundo nome por linha, o mesmo rótulo escrito como se escreve, que
é o que a tela mostra.

**A aritmética da planilha corrigiu três classificações.** Três linhas estavam
enquadradas pelo que o rótulo delas parecia dizer, e o painel somado desmentiu
as três: `TOTAL REMUNERAÇÃO ROTA DVS` começa com `TOTAL` e é **parcela** (sem
ela o quadro não fecha; com ela fecha ao centavo, nas duas quinzenas);
`DESCONTO DE DEVOLUÇÃO %` termina em `%` e traz **dinheiro**, o mesmo do quadro
de baixo — o `%` é do critério, não da unidade; e a `INDISPONIBILIDADE` do
quadro do variável tem nome de parcela e é o **desconto** de disponibilidade,
centavo por centavo. Em todos os três, quem decidiu foi a soma do quadro contra
o total que a própria planilha escreve. A `INDISPONIBILIDADE` do quadro do fixo
segue sem lastro **no demonstrado**, e seguir é o certo: aquela célula vem vazia
nas duas quinzenas, e vazia não decide sinal nenhum. Do lado do **devido** ela
tem fonte — o faturado das viagens de Rota com marca de indisponibilidade no
2Art, que é o que `Mapa Rota!132` soma. As duas leituras discordarem é o
resultado, não o defeito: é para isso que existem duas colunas. Ver
`docs/MAPA-ROTA.md`.

**O termo que faltava era o desconto.** A planilha escreve a parcela **bruta** e
mostra o abatimento numa linha à parte; o 03.08.20 escreve a verba **já
líquida** — cada desconto dele vem com a frase "Desconto Liquido ja subtraido da
VBZ …". Comparar os dois diretamente não fecha, e era por isso que o produto
registrava que aquelas linhas não fechavam. Somados os descontos de volta, o
quadro fecha contra o demonstrativo.

O que cada linha do painel virou:

| Linha da planilha | O que o FreightCheck põe atrás dela |
| --- | --- |
| `TOTAL REMUNERAÇÃO ROTA DVS` | **sem origem** — o motor calcula esta linha como o custo variável inteiro, e o variável do relatório são as VBZ 05 e 07, que o quadro de baixo já confere. As verbas deste quadro são as VBZ 01 a 04, `FIXO` e `ADMINISTRATIVO`. Dá-la ao conjunto do fixo somaria o variável dentro do fixo |
| `CUSTO FIXO PADRONIZADO` · `CUSTO FIXO INATIVOS` · `CUSTO VANS INATIVAS` · `CUSTO FIXO - ESPECIAIS` · `CUSTO FIXO - VANS` | **em conjunto**: as verbas fixas e administrativas do bloco `FRETE`, brutas dos descontos que o relatório declara ter subtraído delas. O rateio por tipo de frota não existe no 03.08.20 |
| `INDISPONIBILIDADE` (quadro do fixo) | sem origem — a célula vem vazia, e vazia não diz se a linha seria parcela ou abatimento |
| `INDISPONIBILIDADE` (quadro do variável) | os quatro descontos do bloco `DESCONTO DISPONIBILIDADE` — o mesmo número que `DESCONTO DE DISPONIBILIDADE` abate no quadro de cima |
| `DESCONTO DE DEVOLUÇÃO %` | o `Desconto Devolucao` do 03.08.20. A alíquota `% Dev. Resp. Transportadora` viaja na procedência da linha |
| `DESCONTO DE DISPONIBILIDADE` | os quatro descontos do bloco `DESCONTO DISPONIBILIDADE` |
| `DESCONTO COMPLEMENTAR NEGATIVO` | o `DESCONTO FRETE MINIMO` do 03.08.20 — ver a nota abaixo |
| `TOTAL REMUNERAÇÃO ROTA` (fixo) | as verbas fixas e administrativas do bloco `FRETE`, líquidas |
| `CUSTO VARIÁVEL (FROTA FIXA)` · `CUSTO VARIÁVEL (AGREGADO)` | **em conjunto**: as verbas variáveis do `FRETE` (VBZ 05 e 07), **cruas** — nenhum desconto do relatório saiu delas |
| `DESCONTO DE DEVOLUÇÃO` | o `Desconto Devolucao` do 03.08.20 |
| `TOTAL REMUNERAÇÃO ROTA` (variável) | as verbas variáveis e complementares do bloco `FRETE` |
| `TOTAL REMUNERAÇÃO ROTA OUTROS CUSTOS` · `TOTAL OUTROS CUSTOS` | o bloco `OUTROS CUSTOS` **menos a VBZ 06** |
| `REM. VARIÁVEL - EQUIPE DE ENTREGA` · `TOTAL REM. VARIÁVEL - EQUIPE DE ENTREGA` | a `VBZ 06` do bloco `OUTROS CUSTOS`, sozinha — o quadro que a planilha reserva em `AI34` e nunca preenche |

Cinco decisões que o módulo materializa:

1. **Nenhuma linha inventa a origem.** É a regra de `@workspace/remuneracao`
   aplicada aqui: a linha sem correspondência traz `motivo` e `destrava` por
   extenso, e não um número plausível.
2. **O que o arquivo traz junto fica junto.** As cinco linhas do quadro do fixo
   compartilham um número, como `PIS + COFINS` compartilham no cadastro.
   Rachá-lo por semelhança de rótulo seria simples e seria invenção — a tela
   escreve o valor uma vez, na linha do conjunto.
3. **O resíduo é a afirmação verificável.** Cada quadro devolve
   `total − somado`, que é, por construção, o que as linhas sem origem, as
   verbas sem linha e os descontos sem verba de origem somam.
4. **A VBZ do desconto é lida, não deduzida — e é ela que decide o bruto.**
   `ja subtraido da VBZ 01` vira dado (`vbzDeOrigem`), e o conjunto só soma de
   volta o desconto que o relatório atribui às verbas **dele**. Perguntar isso à
   planilha estava errado e tinha tamanho: ela repete a devolução e a
   disponibilidade no quadro do variável, onde são informativas, e o conjunto de
   lá subia por descontos que nunca saíram das VBZ 05 e 07 — R$ 30.442,73 a mais
   na 1ª quinzena de julho/2026 e R$ 157.743,78 na 2ª. O número continua onde a
   planilha o pôs; a discordância continua sendo dita em `origemForaDoQuadro`.
   O desconto que o relatório **não** atribui a verba nenhuma — o frete mínimo,
   que diz apenas "das VBZs de custo Fixo coluna ICMS" — não sobe conjunto
   nenhum, e a diferença fica no resíduo.
5. **O corte é por natureza, com uma exceção declarada.** A `VBZ 06` tem a mesma
   natureza `COMPLEMENTAR` das outras despesas do bloco e ainda assim é um
   quadro à parte da planilha. O corte por código está em
   `VBZ_DA_EQUIPE_DE_ENTREGA` (`verbas.ts`) e não é escolha nossa: é o mesmo
   corte que o 03.08.12.09 usa. Separadas, as duas linhas fecham em R$ 0,00
   contra as requisições — R$ 109.695,38 e R$ 248.834,84 na 2ª quinzena de
   julho/2026, por dois arquivos diferentes, ao centavo.

**Sobre o `DESCONTO COMPLEMENTAR NEGATIVO`.** Por duas versões este de-para
recusou a identificação com o frete mínimo, e a recusa estava certa enquanto o
argumento era só que os dois eram os últimos que sobravam de cada lado. O que a
mudou foram dois fechamentos: na 2ª quinzena de julho/2026 a célula da planilha
traz R$ 14.050,54, que é ao centavo o frete mínimo do relatório; na 1ª ela vem
zerada e os mesmos R$ 11.649,87 do frete mínimo aparecem — brutados pelo fator,
R$ 15.907,37 — na linha da **disponibilidade**, numa quinzena em que o 03.08.20
não traz bloco de disponibilidade nenhum. O número existe nos dois fechamentos,
em duas linhas diferentes, e só uma origem o explica nas duas. O motor já lia
assim. O que continua não lido é a fórmula da célula no `.xlsb`.

`GET /fechamento/competencias/:id/de-para` devolve o painel preenchido nas três
colunas do mês, com só a da quinzena preenchida — a mesma forma que o resumo
mensal entrega, para que a aba `Planilha` seja o mesmo componente nas duas telas
(`?coluna=semImposto|ctrcIcms|valorFaturado`). `GET /fechamento/de-para` devolve o
catálogo dos vinte rótulos sem competência nenhuma. O painel transcrito é o da
Rota; o do AS existe na planilha e os rótulos dele ainda não foram capturados.

## Os relatórios de cada quinzena — quatro esperados na primeira, seis na segunda

O catálogo tem seis fontes; **a quinzena decide quantas delas existem**. A
primeira quinzena espera quatro — 2Art, 03.08.15, 03.08.20 e 03.08.18 — e a
segunda espera as seis: a conciliação do Promax (03.02.59.02) é o fecho do mês e
chega com o fechamento da segunda.

**O 03.08.12.09 é o caso do meio, e por isso são duas listas e não uma.** A
requisição de despesa aprovada entre os dias 1 e 15 sai no relatório *daquela*
quinzena: ele **pode existir** na primeira. O que não dá para afirmar é o
contrário — uma quinzena sem requisição aprovada nenhuma não gera arquivo —,
então nem "é obrigatório" nem "não existe" descrevem o relatório. Ele mora em
`FONTES_OPCIONAIS_DA_QUINZENA`: **a casinha de envio existe, e a falta dela não
é pendência.** Antes disso a primeira quinzena não oferecia onde enviá-lo, e o
complementar dos dias 1 a 15 ficava de fora da conta em silêncio — uma fonte que
a tela não oferece é uma fonte que ninguém sabe que falta.

A regra mora em `FONTES_DA_QUINZENA` e `FONTES_OPCIONAIS_DA_QUINZENA`
(`lib/fechamento/src/dominio.ts`), num lugar só, e desce por três caminhos:

1. **A apuração não chama de ausente o que a quinzena não espera.**
   `fontesAusentes` só nomeia o que é esperado ali — o opcional que não chegou
   fica de fora. Sem isso, toda primeira quinzena do ano nasceria com pendências
   que ninguém pode resolver, e "falta importar", que é trabalho de alguém,
   passaria a se confundir com "não há o que importar", que não é. O opcional
   que **chega** entra na conta como qualquer outra fonte: presente é presente.
2. **A tela oferece o que pode existir e pede o que existe.** São duas listas em
   `lib/fechamento.ts` da interface: `fontesParaEnviar` desenha as casinhas
   (esperadas + opcionais + o que já chegou) e `fontesDaCompetencia` é o
   denominador de "3 de 4 relatórios" (esperadas + o que já chegou). Contar o
   opcional no denominador faria a primeira quinzena completa dizer "4 de 5"
   para sempre. Na lista de Apurações, onde as duas metades convivem na mesma
   tabela, o recorte é por linha.
3. **O catálogo da API diz em que quinzenas cada fonte entra.**
   `GET /fechamento/fontes` devolve sempre as seis, cada uma com `quinzenas` (em
   quais é esperada) e `quinzenasOpcionais` (em quais é admitida sem cobrança);
   quem desenha uma página com quinzenas das duas metades não precisa buscar o
   catálogo duas vezes. São dois campos e não um porque mandam em coisas
   diferentes: um decide se a casinha aparece, o outro se a ausência é
   pendência.

O que a regra **não** faz é recusar. Uma conciliação enviada a uma primeira
quinzena é recebida, lida e apurada como qualquer outra fonte — e a tela a
mostra com a tarja "fora da 1ª quinzena", em vez de escondê-la. A lista diz o
que se espera, não o que se admite: é a mesma regra que faz a conta rodar com o
que houver, e arquivo importado que some da tela é a forma mais rápida de
alguém importá-lo de novo.

## Descartar o que foi importado — o desfazer da competência errada

Ao lado de "Apurar", a competência aberta tem **Descartar dados**: apaga os
relatórios enviados, as linhas que eles produziram e as apurações que saíram
delas, e deixa a competência aberta e vazia, pronta para receber os arquivos
certos. Quem confirma vê antes quantos arquivos vão embora, e depois o que
saiu, contado por fonte.

Ele existe por um caso real: a quinzena de julho lançada na competência de
agosto. Três decisões que o ato materializa:

1. **Apaga de verdade, não despromove.** `receberDocumento` já sabe substituir
   uma exportação por outra, guardando a anterior como histórico — isso resolve
   "a Ambev reenviou o arquivo corrigido". Não resolve este caso: o índice
   `(competência, sha256)` recusaria o reenvio do *mesmo* arquivo depois de a
   data ser corrigida, e o conserto ficaria sem porta.
2. **A apuração cai junto.** Ela é a conta daquelas linhas; mantida sobre um
   banco sem elas, seria um total que nada sustenta.
3. **A competência sobrevive, e volta a `ABERTA`.** Unidade, transportadora e
   datas continuam certas mesmo quando o arquivo estava errado. Encerrada, o
   descarte é recusado com o nome da competência e a saída — reabrir, com
   motivo.

E, desde o 03.08.20, o erro que ele conserta tende a não acontecer mais: aquele
relatório declara o próprio período no cabeçalho, e é recusado na porta quando
não é o da competência.

## Excluir a importação — quando a errada é a quinzena, e não os arquivos

O descarte serve à quinzena certa alimentada com os arquivos errados. O outro
erro é a quinzena que não devia existir: o CDD errado, a transportadora errada,
o período aberto duas vezes. Esvaziá-la deixaria na lista uma linha vazia que
ninguém sabe por que está lá — e que a próxima pessoa abriria por engano.

Em **Importações**, cada linha tem o ícone de lixeira ao lado da ação da
quinzena. Ele abre um painel que diz o que vai junto — quantos relatórios,
se há conta apurada, os dias — antes de qualquer coisa ser apagada, pela mesma
razão do descarte: na lista as quinzenas se parecem, e duas linhas quase
idênticas são dois CDDs no mesmo período. A confirmação apaga a competência e
tudo que aponta para ela (`DELETE /fechamento/competencias/:id`).

**A encerrada é recusada** — o botão da linha está desabilitado e o servidor
recusa com 409. É a mesma regra do envio e do descarte, e pelo mesmo motivo: a
quinzena fechada é o registro do que foi cobrado, e apagá-la de dentro de um
clique de lista apagaria a prova sem que ninguém tenha dito por quê. Reabrir,
com motivo escrito, vem antes.

## O cadastro de unidade e transportadora — o nome sobrevive à importação

O cartão que abre **Importações** chama-se **Realizar Fechamento**. É o gesto
que a tela oferece — ano, mês, quinzena, CDD e transportadora, e começa-se a
fechar a quinzena. O que ele produz continua sendo a competência, e o resto do
ambiente continua chamando-a assim; o rótulo mudou porque quem chega ali vem
fechar, e não criar um registro chamado competência.

Os dois campos de parte se pesquisam e cadastram do próprio lugar
(`ComboboxCriavel`): digitar `443 — CDD Belém` e escolher "Usar" grava a unidade
na hora, por `POST /fechamento/partes`.

**Gravar na hora é o conserto de um defeito com nome.** A lista das partes era
derivada e só — `listarPartes` lia as competências e devolvia os códigos que
apareciam nelas. Quem digitava o nome do CDD, abria a competência e depois
excluía a importação — o desfazer da seção anterior, feito para a quinzena que
não devia existir — perdia o nome junto: o cadastro morava dentro do registro
que ele serve para criar. Hoje ele é tabela própria (`fechamento_parte`, na
`0044`), e excluir a competência apaga só a competência.

Três regras que o cadastro materializa:

1. **Duas fontes, uma verdade.** A lista continua somando o cadastro às partes
   que aparecem em competências: o cadastro responde pelo que ninguém usou
   ainda, e as competências respondem pela contagem de cada código. Toda escrita
   passa por `registrarParte` (o campo que cadastra e a abertura de
   competência), de modo que a linha guarda sempre o **último** nome escrito,
   que é exatamente o que a lista derivada devolvia. A `0044` traz para o
   cadastro o que já existia — sem isso, "o nome sobrevive à exclusão" valeria
   só para o que fosse digitado depois do deploy.
2. **Renomear é reescrever; apagar o nome, não.** `443 — CDD Belém` por cima de
   um `443` sem nome renomeia. `443` sozinho por cima de um nome que já existe
   mantém o nome: abrir uma competência digitando só o código não pode apagar o
   que alguém escreveu antes.
3. **O mesmo código dos dois lados são dois cadastros.** `36` pode ser um CDD e
   uma transportadora ao mesmo tempo; a unicidade é do par (tipo, código).

A parte cadastrada e ainda não usada aparece na lista com "cadastrada — ainda
sem competência", e não como "nova": ela está gravada, e some só se alguém a
apagar.

## Reabrir aparece onde o envio trava

Reabrir é o único caminho de volta de uma quinzena encerrada, e ele pede motivo
— o texto fica no registro da competência e é o que distingue uma correção de
uma alteração silenciosa depois do fato. O formulário mora num componente só
(`components/fechamento/fechar-quinzena`) e aparece onde é procurado:

1. No **cabeçalho da competência**, ao lado do aviso de congelada — a frase
   "nada mais entra nela sem reabertura" traz junto o que fazer a respeito.
2. Dentro do **cartão dos relatórios**, com o que falta nomeado ("Faltam
   03.08.20"). É o caso mais comum: a Ambev manda o relatório que faltava
   depois de a quinzena ter fechado, e quem recebeu está olhando para o botão
   de enviar que não clica.
3. No **painel de fechamento**, na competência e na linha de Importações — a
   outra metade do ato que congelou o período.

Fora do painel de fechamento o bloco começa recolhido: o clique abre o que se
vai fazer, e não o faz. A competência volta para `APURADA`, e não para
`ABERTA` — a apuração que estava lá continua valendo, e é contra ela que se
compara o que mudar depois de o arquivo novo entrar.

## A conta abre na lista — Apurações sem trocar de tela

`/fechamento/apuracoes` é a fila do fechamento: uma linha por competência,
agrupada por quinzena, com o que foi emitido, quanto está conferido e quanto
continua a questionar. A pergunta seguinte a "56% conferido" é sempre a mesma —
*conferido onde?* — e ela custava uma troca de tela: abrir a competência,
voltar, refazer o filtro, reprocurar a linha. Quem comparava dois CDDs pagava
esse pedágio a cada ida e volta.

Agora o clique **abre a conta na própria linha**: os três números da quinzena, a
conversão medida dos arquivos e a tabela de verbas, com a memória de cálculo de
cada uma a um segundo clique. O cabeçalho da quinzena abre o grupo inteiro — e
só o fecha quando não falta nenhuma competência por abrir, para que o clique num
grupo meio aberto termine de abri-lo em vez de fechar o que já se estava lendo.

Três decisões que a tela materializa:

1. **É o mesmo componente nas duas telas.** A conta saiu da competência aberta
   para `components/fechamento/conta-apurada.tsx`, e as duas o desenham. Duas
   cópias do mesmo bloco seriam duas opiniões sobre o mesmo número, e a segunda
   envelheceria calada.
2. **A conta é buscada quando a linha abre**, sob a mesma chave de consulta da
   competência aberta (`["fechamento", "competencia", id]`). A lista é o índice
   de dezenas de quinzenas e cada conta traz verbas, memória e divergências:
   baixar todas para mostrar uma seria pagar o fechamento inteiro para ler uma
   linha. Como a chave é a mesma, quem abre aqui e depois entra na tela de
   dentro a encontra pronta — e quem volta de lá reabre a linha sem nova ida ao
   servidor.
3. **A linha não troca mais de tela; ela abre.** O caminho para a competência
   inteira — enviar relatório, ver os dias, encerrar — fica dentro do painel
   aberto, onde a pergunta seguinte aparece. Competência ainda não apurada abre
   dizendo isso, com o atalho para ir rodar a conta, porque apurar continua
   sendo um botão de lá: rodar grava.

## A quinzena fecha na lista — Importações sem entrar na competência

`/fechamento/competencias` era só a porta de entrada: abria-se o período e
enviavam-se os cinco relatórios. Fechar era outro caminho — entrar na
competência, descer a página e clicar no botão do fim. Quem fecha, porém, não
fecha *uma* competência: fecha a quinzena inteira, CDD a CDD. Entrar e voltar a
cada uma fazia perder a lista justamente a cada fechamento, e a lista é o que
diz quantas ainda faltam.

Agora cada linha traz a ação do seu estado, e o painel abre ali mesmo.

Três decisões que a tela materializa:

1. **É o mesmo painel nas duas telas.** O bloco "Salvar a quinzena" saiu da
   competência aberta para `components/fechamento/fechar-quinzena.tsx`, e as
   duas o desenham — a mesma razão de `conta-apurada.tsx`. Com ele veio o
   resumo: quantos dos cinco relatórios entraram, quanto foi emitido e quanto há
   a questionar, sempre **antes** do botão. Fechar é o ato a partir do qual o
   banco recusa escrita na competência; um botão de lista que congelasse o
   período sem mostrar o que está congelando seria mais rápido e diria menos.
2. **O estado decide o que a linha oferece, e são três respostas, não duas.**
   `acaoDoFechamento` (sob teste em `pages/fechamento/__tests__/`) manda apurar
   quem ainda não apurou — encerrar sem apuração congelaria um período que não
   sabe quanto vale, e o servidor recusa —, oferece fechar a quem tem apuração
   vigente e reabrir a quem já encerrou. "Não dá para fechar" tem duas causas
   diferentes, e um botão cinza sem explicação juntaria as duas numa frustração
   só.
3. **Um painel aberto por vez.** Ao contrário de Apurações, onde abrir várias
   contas serve para comparar CDDs, aqui o que se abre é um ato — e dois atos
   abertos ao mesmo tempo convidam a fechar a quinzena errada.

O formulário de abertura mudou junto, na mesma direção: **o mês é escolhido, e
não digitado.** Ele tem doze valores e nomes que todo mundo sabe de cor, e `7`
num campo de texto é uma pergunta a mais num formulário que existe para não ter
nenhuma. O valor continua sendo o número que a rota espera; só o rótulo é a
palavra. O ano segue digitado — é aberto —, mas a tela agora aplica a mesma
régua da rota (2000 a 2100) antes do clique, para não gastar uma ida ao servidor
dizendo o que já se sabia.

## O tipo de operação — EMPURRADA e ROTA são dois fechamentos

A competência foi, até a `0046`, única por **(unidade, transportadora,
quinzena)**, com a frase "uma quinzena de um CDD com uma transportadora é *um*
fechamento, e dois seria o começo de duas verdades sobre o mesmo dinheiro". A
frase continua verdadeira; o recorte é que estava incompleto. O mesmo CDD roda
**EMPURRADA** e **ROTA** com a mesma transportadora na mesma quinzena, e são
duas operações — cada uma com a sua planilha de remuneração, os seus relatórios
e a sua conta. Somá-las num fechamento só era o que produzia a verdade
misturada.

Hoje a chave é a quádrupla **(unidade, transportadora, tipo de operação,
quinzena)**, e o campo é **obrigatório** ao abrir: sem ele, a segunda abertura
encontrava a primeira e devolvia o fechamento da outra operação — em silêncio,
porque repetir a abertura é o caminho feliz de quem volta à tela no dia
seguinte, e quem abrisse ROTA passaria a mandar os relatórios de rota para
dentro do fechamento de empurrada.

### Por que a coluna não se chama `canal`

Porque **`canal` já existe neste módulo e significa outra coisa**: `ROTA` | `AS`
— distribuição urbana diária contra área de serviço, o primeiro eixo de
agregação de toda a apuração (`lib/fechamento/src/dominio.ts`). As duas
palavras colidem exatamente em `ROTA` e querem dizer coisas diferentes, e as
duas vivem no mesmo objeto: `resumo.canais[].canal` é ROTA/AS enquanto
`competencia.tipoDeOperacao` é EMPURRADA/ROTA. Dois campos com o mesmo nome no
mesmo módulo, um deles capaz de guardar `ROTA` significando outra coisa, é a
forma exata do erro que este repositório escreve ensaios para não cometer.

O eixo de `tipoDeOperacao` é o de `remuneracao_planilha.canal` e o do rótulo da
vigência (`EMPURRADA_1_8_2026` → `EMPURRADA`): é a operação que a planilha de
remuneração descreve, e é por ele que um fechamento se liga ao cadastro que o
remunera.

### O backfill não adivinha

As competências abertas antes da `0046` recebem `NAO_INFORMADO`, e a única coisa
que esse valor afirma é que ninguém disse. Escrever `EMPURRADA` nelas acertaria
hoje — toda vigência deste acervo é empurrada — e seria invenção como regra: o
fechamento não nasce das vigências, e nenhum dos cinco relatórios que ele
consome declara o tipo. É a mesma recusa de `tributoDe` e de `DIZ_QUE_SIM`, que
devolvem nulo em vez de escolher o valor mais provável.

`NAO_INFORMADO` é recusado na porta de entrada (`normalizarTipoDeOperacao`):
ele é o carimbo do backfill, e nada além dele pode escrevê-lo. A tela mostra
essas competências como "Não informado", por extenso — mostrá-las como
empurradas seria escrever na tela um tipo que ninguém declarou.

O `DEFAULT` da coluna fica, e é fail-safe pela razão **oposta** à de
`app_user.role`: lá o default não podia fabricar um administrador; aqui ele não
pode fabricar um tipo.

### Onde o tipo aparece

- **Realizar Fechamento** — campo `Tipo`, obrigatório, com lista fechada
  (Empurrada / Rota). Fechada ao contrário dos campos de unidade e
  transportadora, e a razão é o que cada um protege: lá o vocabulário é da
  operação e cresce; aqui ele é o eixo de uma **chave**, e um campo livre faria
  "Empurrada" e "EMPURRADA" virarem dois fechamentos do mesmo mês. A
  normalização (trim + caixa alta) fecha a mesma porta do lado do servidor.
- **A lista de competências** — na identidade da linha, e não como enfeite:
  duas competências podem diferir só por ele, e sem o tipo à vista a lista
  mostraria duas linhas idênticas.
- **Resumo geral** — um seletor a mais, ao lado da unidade. O resumo tem uma
  coluna por quinzena, e sem o recorte as duas operações cairiam nas mesmas duas
  colunas.

### Abrir e consultar pedem listas de Tipo diferentes

O seletor do Resumo geral nasceu com a lista de **abrir** — Empurrada e Rota —,
e o efeito foi que todo fechamento anterior à `0046` sumiu daquela tela: eles
carregam `NAO_INFORMADO`, nenhuma das duas opções os alcança, e o mês aparecia
vazio com a unidade certa, a transportadora certa e o mês certo escolhidos. Nada
tinha sido perdido; o acervo é que tinha ficado sem endereço.

São duas listas, e a diferença é deliberada:

- `TIPOS_DE_OPERACAO` — o que se pode **abrir**. Sem `NAO_INFORMADO`, porque
  escolhê-lo seria dizer "não sei" num campo que a operação decidiu que é
  obrigatório, e `normalizarTipoDeOperacao` o recusa de qualquer forma.
- `TIPOS_PARA_LER` — o que se pode **consultar**. Com `NAO_INFORMADO`, porque
  é o que o banco tem. Uma tela de leitura que não oferece um valor que existe
  no banco esconde dado em vez de proteger a chave.

As duas vivem em `artifacts/freightaudit/src/lib/fechamento.ts`, e não em cada
tela: foi a cópia que produziu o defeito — o Resumo escreveu a sua própria lista
e ela nasceu incompleta.

### O vazio diz qual dos dois vazios é

`lerResumoDoMes` devolve **sempre** as duas quinzenas do mês, "existam elas ou
não": a que ninguém abriu vem com `competenciaId` nulo. A tela procurava a
quinzena com um `find`, achava esse esqueleto e o lia como competência de
verdade — o ramo "competência não aberta" era código morto, e um mês em que nada
tinha sido aberto se anunciava como **"importada, ainda não apurada"**.

A frase errada não é detalhe de redação: ela manda procurar uma apuração que não
tem onde acontecer, e esconde a causa real. `quinzenaExiste` e `motivoDoVazio`,
em `pages/fechamento/resumo.tsx`, separam os dois estados — `SEM_COMPETENCIA` e
`SEM_APURACAO` —, e o aviso do primeiro nomeia o Tipo escolhido e oferece o
carimbo do backfill como primeira hipótese, que é a única causa que não depende
de erro de quem lê.

## Remuneração — o cadastro, e a única tela que atravessa a fronteira

`/fechamento/remuneracao/unidade` reproduz a aba **CADASTRO DA PLANILHA DE
REMUNERAÇÃO**: as quatro alíquotas, o tamanho da frota fixa, quanto vale cada
parcela por veículo ativo e inativo, as vans, as rotas noturnas, o marketing, a
proporção de documentos dentro e fora do município, e o resumo de impostos. É a
aba que abre a pasta de Excel e de onde todas as outras puxam.

**E `/fechamento/remuneracao` é a lista que vem antes dela.** São duas
perguntas, e a segunda não responde a primeira: o cadastro de uma unidade
responde *quais são os parâmetros dela*; quem abre Remuneração na virada da
quinzena quer saber *onde está o trabalho* — quais CDDs já têm o cadastro de pé
e quais ainda não têm. Sem a lista, descobrir que um deles entregou a frota e
não entregou os trechos custa abri-lo, e com trinta unidades custa abrir trinta
telas para achar as duas que faltam. É o mesmo papel que Apurações cumpre para
as competências.

Cada unidade aparece com um estado de **quatro valores** — `FROTA_E_ALIQUOTAS`,
`SO_FROTA`, `SO_ALIQUOTAS`, `SEM_LASTRO` — e o estado é sobre as duas metades
do cadastro, não sobre um percentual das trinta linhas. A razão está em
`lib/remuneracao/src/situacao.ts`: onze das trinta têm lastro sobre um acervo
completo, e as outras dezenove dependem de decisões de negócio que ninguém
registrou. "37% cadastrado" seria lido como "falta importar alguma coisa"
justamente na unidade que entregou tudo o que tinha para entregar. O que separa
uma unidade da outra são as duas metades que dependem do que ela mandou: a
frota, que vem do export de equipamento, e as alíquotas, que vêm do de frete.

A lista **monta o cadastro de cada unidade** em vez de deduzir o estado do
material entregue, e paga por isso: quatro consultas, cada uma respondendo por
todas as unidades de uma vez no par (unidade, vigência mais recente dela). É o
que garante que a lista e a tela do cadastro nunca discordem — o caso que a
dedução erraria é a vigência que entregou trechos sem as colunas em reais, em
que a tela mostra as alíquotas em branco e a dedução diria "em dia".

**Três vistas, e a padrão é a de duas quinzenas lado a lado** — que é a forma da
planilha: a aba traz os dois blocos um ao lado do outro, e quem confere lê as
duas colunas juntas. A terceira coluna, a da variação, é o que a planilha não
tem e a tela dá. A vista de uma quinzena fica a um clique e é a que traz a
memória de cálculo inteira; a comparação a deixa de fora de propósito, porque
três colunas de número já são o limite do que se lê sem rolar na horizontal.
Unidade sem par abre direto na vista de uma, sem oferecer a outra. A terceira,
**Cadastrar a planilha**, é a única que escreve — ver "A planilha informada",
mais abaixo.

**Ela é do Fechamento e lê o acervo da Auditoria**, e as duas metades dessa
frase são deliberadas:

- A tela é do Fechamento porque é lá que o cadastro serve — é dele que a
  apuração da quinzena tira alíquota, frota e proporção.
- A leitura é do canônico porque todo número que a aba pede é **contratado**, e
  o contratado mora na Auditoria. Uma tabela de *frota* aqui seria uma terceira
  verdade sobre a frota, ao lado da que o export declara e da que a apuração
  usa — e continua não existindo. O que passou a existir, na `0045`, guarda
  outra coisa: o que a **planilha declara**. Ver "A planilha informada".
- Por isso a rota HTTP é `/remuneracao/...` e **não** `/fechamento/...`: o dado
  é da unidade numa vigência, não de uma competência.

O motor é `lib/remuneracao`, e a fronteira dele é a mesma do Fechamento — a
aritmética é pura (`medicao.ts`, `montagem.ts`) e só `leitura.ts` conhece o
banco.

### A regra que rege o módulo

**Nenhuma linha inventa a sua origem.** Cada uma das trinta declara, no
catálogo (`catalogo.ts`), de onde o número sai — e sai de lá com um de três
estados:

| estado | o que significa |
|---|---|
| `APURADO` | O acervo sustenta a linha. Vem com a regra, as colunas e quantos registros entraram. |
| `INFORMADO` | O acervo não sustenta a linha, e **alguém a digitou da aba de Excel**. Vem com o nome de quem digitou, a data e a observação; a procedência diz por extenso que não é medida. |
| `EM_CONJUNTO` | O acervo sustenta a linha **junto com outra**. É o caso de PIS e COFINS: o export os soma em `fretePisCofins`, e rachar o par pela alíquota da lei federal traria para dentro do produto uma premissa que nenhum arquivo do cliente sustenta. |
| `SEM_LASTRO` | Nem o acervo nem a planilha respondem a linha, e o motivo e a destrava estão escritos — com o atalho para a tela que hoje chega mais perto. |

**Onze das trinta linhas têm lastro hoje**, sobre um acervo completo — nove
apuradas e duas em par:

- contagem de frota ativa / inativa / operação, por `cavalo.ativo`;
- alíquotas de ICMS e de ISS, **medidas em reais** (`impostosIcmsIss ÷
  freteCtrc`) e nunca lidas de `percentualIcmsIss`, que pode vir em pontos
  (`17,84`) ou em fração (`0,1784`) sem que nada no arquivo diga qual;
- PIS + COFINS, como par;
- a proporção de documentos dentro / fora do município, ponderada por
  `previsaoViagens`, com recuo declarado para contagem de trechos quando a
  previsão não vem em todos;
- o resumo de impostos — `100% − (PIS + COFINS + tributo)` —, a única linha
  cuja conta a própria planilha demonstra: com as alíquotas da aba de CDD Belém
  ela dá 84,85% dentro do município e 72,91% fora, e um teste prende os dois.

O placar está preso em teste (`montagem.test.ts`), nas duas direções: cair sem
querer é uma linha que perdeu lastro em silêncio; subir é uma linha destravada,
e o texto da tela precisa acompanhar.

### A recusa da comparação: lastro não é dinheiro

Na vista de duas quinzenas, `Movimento` tem **seis** valores e não três, e
a razão é a única forma de esta tela produzir um número perigoso. Uma linha sem
lastro na quinzena passada e apurada nesta não subiu de zero — subiu de *não
sabíamos*. Tratá-la como variação a partir de zero mostraria um "+100%" que
descreve uma coluna que passou a ser importada, e não um centavo a mais na conta
da transportadora.

| movimento | o que é |
|---|---|
| `IGUAL` · `SUBIU` · `DESCEU` | As duas pontas têm número comparável. Só estes três têm `variacao`. |
| `GANHOU_LASTRO` | A esquerda não sustentava a linha e a direita sustenta. Cobertura, não aumento. |
| `PERDEU_LASTRO` | O contrário — e o único movimento que a tela acende em vermelho, porque pede investigação na importação. |
| `SEM_COMPARACAO` | Nenhuma das duas sustenta a linha, ou as duas pontas não são a mesma grandeza. |

O placar do topo conta os cinco separadamente pela mesma razão: somar "ganharam
lastro" a "mudaram" diria que dezenove linhas se moveram numa quinzena em que
ninguém mexeu em nada.

O que ainda não tem lastro são as rubricas monetárias por veículo, as vans, as
rotas noturnas e o marketing. O motivo de cada uma está escrito no catálogo, e
nenhum deles é "falta implementar": são colunas que o export não traz
(marketing), recortes que ele não separa (van vs. cavalo), periodicidades que o
motor ainda não sabe somar (frete por viagem) e enquadramentos que são decisão
de negócio, não dedução por semelhança de nome de coluna.

### A planilha informada — o que a aba declara, ao lado do que o acervo mede

O acervo sustenta onze das trinta linhas. As outras dezenove **não esperam
arquivo nenhum**: esperam decisões de negócio que ninguém registrou — qual
conjunto de colunas forma "Remuneração Fixa - Frota Fixa Ativa", qual valor de
turno marca a rota noturna, o que separa van de cavalo. Enquanto elas não
chegam, o número existe: está digitado na aba que a transportadora manda todo
mês. Recusá-lo não o tornava mais verdadeiro — só o mantinha fora do produto,
onde ninguém o conferia.

`remuneracao_planilha` (migration `0045`) guarda o valor por (escopo, canal,
vigência, chave da linha), com autor e data. **Ela não é a "tabela
própria" que a seção acima recusa**, e a distinção é o eixo do desenho: aquela
seria uma segunda verdade sobre a *frota*; esta guarda o que a *planilha
declara*. São perguntas diferentes, e por isso vivem em campos diferentes até o
fim — da tabela à tela.

Quatro regras sustentam a fronteira, e cada uma existe contra um jeito de
apagá-la:

1. **Digitado nunca vira medido.** O que entra sai como `INFORMADO`, com autor
   e data, e a procedência escreve que não é medida do acervo.
2. **Onde os dois respondem, o do cadastro é o valor.** O declarado vira
   `Conferencia` ao lado, com a diferença e o sinal. A planilha de CAMAÇARI diz
   56 cavalos ativos e o export da mesma vigência traz 62 — deixar o digitado
   ganhar apagaria exatamente o achado. A tela também não pré-preenche o campo
   com o número apurado, nem oferece "usar o apurado": a conferência passaria a
   bater sempre, por construção.
3. **As derivadas herdam a parcela mais fraca.** `Total Custo Frota Fixa sem
   imposto` sobre seis parcelas digitadas é `INFORMADO`, não `APURADO`; o mesmo
   vale para o resumo de impostos calculado sobre alíquotas digitadas — e é por
   ele que todo valor líquido vira valor de documento. Em compensação, as duas
   linhas **destravam**: as quatro alíquotas da aba produzem os 84,85% e os
   72,91%, e o total impresso na aba pode ser conferido contra a soma das
   parcelas da própria aba.
4. **A situação da unidade continua falando do acervo.** `informadas` fica fora
   de `comLastro`, e os quatro estados não mudam com a planilha: uma unidade sem
   arquivo nenhum e com a aba transcrita apareceria "Frota e alíquotas", e quem
   opera pararia de procurar o arquivo que falta.

### A unidade que ainda não importou nada

Uma unidade sempre nasceu de um `snapshot`: `listContexts` agrupa o acervo por
`(scope_hash, canal)`, e quem nunca mandou export não existia em tela nenhuma.
Na Auditoria a regra está certa e continua — lá a pergunta é o que os arquivos
sustentam. No Fechamento era uma parede: a quinzena é de várias unidades, a aba
de Excel costuma chegar antes do arquivo, e a unidade que só tem aba não tinha
onde ser digitada. Não por recusa do produto: por não haver linha para clicar.

`remuneracao_unidade` (migration `0048`) guarda **identidade, e não número** —
nome, código, tipo de operação e a quinzena em que se começa a preencher. Os
números continuam na `remuneracao_planilha`, com as quatro regras acima
intactas: uma unidade registrada nasce **sem lastro**, porque o acervo de fato
não mede nada dela.

**O identificador é calculado, e é isso que impede a unidade duplicada.** Ele
sai do mesmo `hashScopeSet` da importação — `sha256` dos descritores
`TIPO:código` ordenados —, somado na borda da rota e nunca no domínio: uma
segunda implementação da chave de negócio discordaria da primeira algum dia, e
nesse dia a planilha digitada sumiria da unidade sem erro em tela. Registrada
com o código que o export também carrega, a unidade digitada recebe **o mesmo**
identificador que o import produzirá, e no dia em que o arquivo chegar ele cai
na unidade que já estava lá: o rótulo passa a vir do arquivo, a planilha
continua onde estava, e ninguém junta duas linhas.

Daí a exigência que a tela diz por extenso: o código vai **como está na coluna
`Unidade - CNPJ` do export**, com pontuação se lá houver. O hash da importação é
somado sobre o texto da célula, e não sobre o CNPJ canônico — limpar a máscara
aqui pareceria mais caprichado e produziria o identificador de um código que o
arquivo não tem.

**A ordem de procedência é acervo, planilha, registro.** Havendo snapshot para o
par, `contextosDoModulo` ignora a linha registrada e usa o contexto do acervo;
a linha não é apagada, porque quem registrou e quando é a única procedência que
a unidade teve enquanto não havia arquivo. E a lista para de dizer "no acervo"
para quem não tem acervo: a unidade registrada aparece marcada, porque "sem
lastro" numa importada quer dizer "o arquivo veio e não trouxe o que o cadastro
lê" — e manda procurar uma coluna — enquanto numa registrada quer dizer
"arquivo nenhum veio", que não manda procurar nada.

Declarar PIS e COFINS separados destrava as duas linhas do par — é a destrava
que o próprio catálogo já nomeava — e a soma das duas metades é conferida contra
o par medido, que continua visível. Com uma metade só, não há conferência:
comparar `PIS + COFINS` com `PIS` produziria uma divergência inteiramente
artificial.

A escrita é da vigência inteira, numa transação, e é um **merge**: o corpo diz o
que mudou, `valor: null` apaga a linha, e o que ele não menciona fica como
estava — quem edita um bloco não pode apagar os outros oito por não os ter
tocado. Uma célula impossível (chave fora do catálogo, percentual acima de cem,
contagem quebrada) **para a escrita inteira**, antes de qualquer `INSERT`:
gravar metade com uma mensagem de erro deixaria quem digitou sem saber qual
metade valeu.

**Não há herança entre vigências.** Há um botão de copiar, com autor e data de
quem clicou, que traz da vigência escolhida só o que o destino ainda não tem.
Herdar em silêncio faria a aba de julho responder por agosto para sempre,
inclusive depois de a operação mudar.

#### O canal da planilha não precisa do acervo

A aba é de um **tipo de operação** — `EMPURRADA`, `ROTA` —, e não da unidade
inteira: a mesma CAMAÇARI tem uma aba para cada. E a aba de ROTA existe **antes**
de o export de ROTA chegar; é justamente nesse intervalo que digitá-la vale a
pena. Por isso a escrita aceita um canal que o acervo não entregou, desde que a
**unidade** exista:

- canal novo em unidade conhecida é **declaração** — o escopo, o CNPJ e o rótulo
  são da unidade, e o canal descreve a operação;
- unidade nova é **importação**, e continua 404: sem uma série importada não há
  `scope_hash` nem rótulo, e a planilha ficaria pendurada num identificador que
  ninguém sabe ler.

O canal só-da-planilha vira uma linha própria na lista de unidades
(`contextosDoModulo` soma `listContexts` com `canaisComPlanilha`), herdando a
unidade e **nenhum material**: as consultas de cavalo e trecho filtram por canal
e devolvem vazio, então as trinta linhas nascem sem lastro e só o digitado tem
número. É a resposta certa — o acervo de fato não diz nada sobre aquele canal —,
e é o que impede a planilha de fazer o estado da unidade parecer melhor do que é.

A leitura continua recusando canal desconhecido: um canal digitado errado num
link tem de responder 404, e não um cadastro vazio que se parece com uma unidade
que perdeu o lastro. Quem abre o **formulário** pede explicitamente
(`aceitarCanalNovo`, `?canalNovo=1`), porque é o único lugar onde o canal nasce
— as trinta linhas em branco precisam aparecer para que alguém as preencha.

O vocabulário de canais não é fixo, e não podia ser: `parseVigenciaLabel` aceita
qualquer palavra no rótulo pela mesma razão. O seletor oferece os que já existem
e deixa digitar um novo, que passa a existir quando a primeira linha dele for
salva — o mesmo gesto do campo de unidade em Realizar Fechamento.

#### Onde se cadastra

Em dois lugares, e são gestos diferentes. O **botão na lista** (`Cadastrar
planilha`) abre o formulário por cima dela, com o tipo de operação e a vigência
escolhidos ali: é para quem tem a aba aberta ao lado e quer digitar e fechar. A
**aba dentro do cadastro da unidade** tem endereço próprio e as outras duas
vistas ao lado: é para quem vai conferir.

O botão na lista nasceu de um defeito de uso: a coluna dizia "nada informado" e
não oferecia nada a quem lesse isso, numa unidade **sem lastro nenhum** — o caso
em que a planilha é a única forma de o cadastro ter número. A tela mandava
procurar um arquivo e calava a saída que existia.

#### Qual quinzena — o rótulo da vigência neste módulo

A planilha é **quinzenal**: a mesma unidade entrega `2026-08-01` e `2026-08-16`,
e o cadastro de cada uma é o seu. O rótulo genérico do produto (`periodLabel`,
em `@workspace/comparison`) escreve as duas como "agosto/2026" — o que é certo
nas telas da Auditoria, que comparam meses, e errado aqui: o seletor do
formulário oferecia dois itens idênticos, e escolher a quinzena certa virava
sorte.

`rotuloDaVigencia` (`lib/remuneracao/src/vigencia.ts`) decide pelo **conjunto**,
e não pela data sozinha:

| o que a unidade entregou naquele mês | como a vigência se escreve |
| --- | --- |
| uma vigência só | `agosto/2026` — não se inventa quinzena onde o mês veio inteiro |
| duas, uma em cada metade | `1ª quinzena de agosto/2026` / `2ª quinzena de agosto/2026` |
| três, ou duas na mesma metade | `16/08/2026` — o dia, que distingue sempre |

A régua da metade é a do Fechamento (`competenciaDoDia`: até o dia 15 é a
primeira, do 16 é a segunda), restatada e não importada — a Auditoria não
depende do Fechamento. E a lista traz a consequência escrita: a coluna "planilha
informada" conta o que foi digitado **para a vigência daquela linha**, então a
quinzena seguinte começa em branco sem apagar a anterior. Dentro do formulário,
*copiar de outra vigência* parte da quinzena passada.

## O que o Fechamento vai precisar (fora desta fundação)

- A **competência** como registro próprio (estado, dono, ciclo de vida) e a
  regra que a liga às vigências.
- O **realizado** da operação (viagens, km, disponibilidade) — sem ele,
  apuração é tabela, não remuneração devida.
- **Ajustes como lançamentos próprios**, nunca edição da apuração — o
  fechamento não pode destruir a trilha que a Auditoria confere.
- **Aprovação como registro imutável** com o retrato do que foi aprovado, e
  **encerramento irreversível-com-registro** (reabre-se com autor e motivo).

## Testes que guardam o desenho

- `lib/__tests__/ambiente.test.ts` — a regra do prefixo, inclusive o
  quase-prefixo (`/fechamentos` não é o ambiente).
- `components/layout/__tests__/sidebar.test.ts` — nenhum item de nenhum dos
  dois menus leva a rota inexistente; endereços não se repetem; as seções dos
  dois ambientes mantêm a ordem; todo item do menu do Fechamento vive sob
  `/fechamento`; os atalhos "onde olhar hoje" só levam a telas que funcionam.
- `lib/remuneracao/src/__tests__/medicao.test.ts` — as medições do cadastro
  sobre material sintético, com o resumo de impostos preso aos números da
  planilha real (84,85% dentro do município, 72,91% fora).
- `lib/remuneracao/src/__tests__/montagem.test.ts` — a promessa central do
  módulo: **nenhuma linha sai muda**, com dado ou sem ele. E o total que se
  recusa a fechar enquanto qualquer parcela estiver sem lastro.
- `lib/remuneracao/src/__tests__/comparacao.test.ts` — lastro que aparece ou
  some nunca vira variação de valor, nos dois sentidos.
- `lib/remuneracao/src/__tests__/leitura.test.ts` — o SQL, contra um Postgres de
  verdade e com os códigos reais do export; o par sempre em ordem cronológica,
  mesmo pedido ao contrário; e a unidade quinzenal, cujas duas entregas de
  agosto chegam à tela com rótulos diferentes nas três leituras do módulo.
- `lib/remuneracao/src/__tests__/vigencia.test.ts` — o rótulo da vigência: as
  duas quinzenas separadas, o mês inteiro que **não** vira quinzena, e o dia
  como saída quando a quinzena não separa.
- `lib/remuneracao/src/__tests__/informado.test.ts` — a fronteira entre digitado
  e medido, em memória: o declarado que **não** sobrescreve o apurado, o total
  que herda o informado das parcelas, o resumo de impostos derivado de alíquotas
  digitadas sem se chamar apurado, o par PIS + COFINS destravado e conferido, e
  o percentual em fração recusado antes de virar divisor de gross-up.
- `lib/remuneracao/src/__tests__/planilha.test.ts` — a mesma coisa pelo Postgres:
  o `numeric` que volta como texto e precisa virar número, o merge que não apaga
  o que o corpo não menciona, a escrita recusada inteira por uma célula ruim, a
  planilha de uma vigência que não vaza para a outra, e a cópia que não
  sobrescreve o destino.
- `artifacts/api-server/src/routes/__tests__/remuneracao-planilha.test.ts` — a
  borda: o autor sai da sessão e nunca do corpo, cada recusa nomeada chega com o
  número certo (400 para célula impossível, 404 para vigência inexistente), e o
  que entrou pelo `PUT` sai no cadastro como `INFORMADO`.
- `pages/fechamento/__tests__/competencias-fechamento.test.ts` — cada estado da
  competência oferece uma ação só, e nunca a errada; o ano é conferido antes
  da ida ao servidor, nas duas pontas da faixa; só a encerrada é recusada
  pela exclusão; e o texto do campo de parte é lido como `código — nome` pelos
  três separadores, sem partir o nome que tem hífen no meio.
- `lib/fechamento/src/__tests__/persistencia.test.ts` — entre os casos do banco,
  os quatro do cadastro de partes: a parte cadastrada **continua na lista depois
  de a competência ser excluída** (o defeito que a `0044` conserta), renomear
  reescreve e o cadastro sem nome não apaga o que estava lá, o mesmo código dos
  dois lados são dois cadastros, e o código em branco é recusado.
- `components/fechamento/__tests__/fechar-quinzena.test.ts` — a fila do que
  questionar: a divergência informativa fica de fora, e a soma é só do que
  reduz o que a transportadora recebe. É o número que aparece em três lugares.
  E o motivo da reabertura, que em branco não sai daqui.
- `lib/__tests__/fechamento.test.ts` — o recorte por quinzena: quatro
  relatórios pedidos na primeira e seis na segunda, o 03.08.12.09 oferecido na
  primeira sem entrar no denominador, e o que foi enviado fora da quinzena dele
  continua na lista (e nas duas pontas da fração). Do lado do motor,
  `lib/fechamento/src/__tests__/fechamento.test.ts` guarda a outra ponta: a
  primeira quinzena não nomeia como ausente o que ela não espera, e apura o
  03.08.12.09 que chegar nela.
