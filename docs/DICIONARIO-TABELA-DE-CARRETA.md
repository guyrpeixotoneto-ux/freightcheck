# Dicionário da tabela de carreta

Os 64 atributos do export de carreta, com nome gerencial, o que cada um mede e em
que linha da DRE ele cai.

Como o dicionário do cavalo, este descreve uma fonte que o repositório apura, e
por isso quase toda descrição cita a medição que a sustenta —
`CONFIRMED_SEMANTICS`, a identidade de `lib/composition/src/regras.ts`, o
componente de `lib/dre/src/plano.ts`, `docs/ACHADO-IPVA.md`. A ótica é a mesma:
o que a Ambev paga é receita, e as parcelas com que ela monta esse preço são as
linhas de custo — a circularidade que `AVISO_DE_CIRCULARIDADE` já registra.

| Categoria | O que reúne |
| --- | --- |
| `Receita bruta` | O que é do implemento: `finameImplemento` e `lucroFixomodeloNovoCicloCarreta`. |
| `Receita bruta — escopo conjunto (não somar na carreta)` | `custoFixo`, `finame` e `lucroFixomodeloNovoCiclo`: cobrem cavalo + carreta. Ver o aviso 1. |
| `Receita bruta (não confirmada — não soma)` | Os dois lucros variáveis **previstos**. |
| `(−) Deduções` | Alíquotas de ICMS e PIS/COFINS, e o valor de ICMS. |
| `(−) Custo variável — Pneus` | Medida e valor de pneus do implemento — o valor vem zerado. |
| `(−) Custo fixo` | Incide independentemente de rodar: licenciamento, seguro, rastreador, faixa reflexiva, tacógrafo, revestimento, aluguel. |
| `(−) Custo fixo (não confirmado — não soma)` | Custo fixo cuja semântica ninguém sustentou ainda: `custoAluguel`, `seguro`, `ipvaLicenciamentoMensal`. |
| `(−) Depreciação e financeiro` | Amortização e juros do FINAME do implemento, e os parâmetros que produzem a parcela. |
| `Grandeza de aquisição (não entra na DRE do período)` | `valorNfCompra` e `valorPisCofins`. |
| `Cadastral (não entra na DRE)` | Identificação, escopo, contrato e especificação técnica. |

**Quatro avisos que valem mais que a tabela.**

1. **Três colunas desta tabela são do conjunto, não da carreta — e somá-las na
   frota de carretas conta cada cavalo duas vezes.** Medido em 14/08/2026, 558
   de 558 pares, tolerância R$ 0,01, zero exceções:

   ```
   carreta.finame − carreta.finameImplemento = cavalo.finameCavalo
   ```

   E `custoFixo = finame + lucroFixomodeloNovoCiclo` fecha em 657 de 657 linhas.
   Ou seja: `custoFixo` — a coluna cujo nome convida a ler como "o custo fixo da
   carreta" — é o do conjunto. Sobre a última vigência, somá-la com a frota de
   cavalos poria R$ 1,05 milhão/mês de cavalo dentro do número das carretas. O
   que é da carreta são `finameImplemento` e `lucroFixomodeloNovoCicloCarreta`.

2. **`ipvaLicenciamento` e `ipvaLicenciamentoMensal` não são a mesma grandeza.**
   A razão mensal ÷ anual entre as 71 carretas vai de −3,01× a 5,23×, com 63% de
   dispersão — se fossem a mesma coisa, seria constante. A primeira é
   licenciamento (R$ 140–152 fixos, 438 das 657 linhas em exatamente R$ 150,00,
   coerente com semirreboque isento de IPVA); a segunda varia de R$ 435 a R$ 733
   e ninguém sabe o que é. É homonímia de prefixo, e a pergunta segue aberta —
   `docs/ACHADO-IPVA.md`.

3. **Zero é ausência, não valor.** `rastreador`, `valorIcms` e `valorPneus` vêm
   zerados nas 657 linhas. Coluna sem dado não é custo zero, e somá-la como zero
   afirma que o custo não existe. Some-se a isso o inverso: `ipvaLicenciamento`
   tem 15 valores **negativos**, até −R$ 1.709,86 — estorno ou erro, e nos dois
   casos distorce a soma.

4. **`lucroFixomodeloNovoCiclo` não é o lucro fixo do cavalo**, embora alguns
   pares coincidam. Entre as 284 linhas não nulas, 233 coincidem com
   `lucroFixomodeloNovoCicloCarreta` e apenas 15 com o do cavalo: a coincidência
   é de valor — a frota usa poucos valores-padrão —, não de significado.

**Nota sobre os rótulos desta planilha.** Cinco linhas chegaram com o nome
gerencial danificado, e todas foram mantidas exatamente como vieram — a coluna
`O que é` diz o que o campo mede:

| Atributo | O que veio | O que parece ser |
| --- | --- | --- |
| `Empresa locadora` | "CUSTO VARIAVEL SIMULADO DO VEICULO" | rótulo da tabela de cavalo, colado na linha errada |
| `Taxa Finame (%)` | "CA}As TAXA  FINAMET(%) CA+ AOA" | ilegível — é a soma dos spreads com a TJLP |
| `amortizacaoImplemento` | "A CAOI ZA AMMELEM" | ilegível — é a amortização do implemento |
| `Spread BNDES` | "SPREAD BANCO IMPLEMENTO" | diz "banco"; pelo atributo, é o spread do BNDES |
| `implemento` | "MONTADORA" | está certo, e é o nome que engana: o campo guarda a fabricante |

| Atributo | Nome Gerencial | O que é | Categoria DRE |
| --- | --- | --- | --- |
| Vigencia | Quinzena | Quinzena de validade da linha. Cada implemento tem uma linha por vigência, e é a comparação entre elas que mostra o que mudou. | Cadastral (não entra na DRE) |
| Unidade - CNPJ | CNPJ da Unidade | CNPJ da unidade Ambev a que o implemento está alocado. | Cadastral (não entra na DRE) |
| Unidade - Nome | Nome da Unidade | Nome da unidade (fábrica ou CDD) onde a carreta opera. | Cadastral (não entra na DRE) |
| Unidade SAP | Codigo da unidade | Código da unidade no SAP — chave de conciliação com o razão contábil. | Cadastral (não entra na DRE) |
| Unidade TMS | Código TMS da Unidade | Código da mesma unidade no TMS. | Cadastral (não entra na DRE) |
| Unidade - Promax UNB | UNB Promax da Unidade | Código da unidade de negócio no Promax. | Cadastral (não entra na DRE) |
| Unidade - Regional | Regional da Unidade | Regional a que a unidade pertence — o nível em que a frota é lida agregada. | Cadastral (não entra na DRE) |
| Operador - CNPJ | CNPJ do Transportador | CNPJ do transportador dono ou operador do implemento. | Cadastral (não entra na DRE) |
| Operador - Nome | Nome do Transportador | Razão social do transportador. | Cadastral (não entra na DRE) |
| Operador - SAP | Codigo do Transportador | Código do transportador como fornecedor no SAP — chave do pagamento da remuneração. | Cadastral (não entra na DRE) |
| Operador - TMS | Código TMS do Transportador | Código do transportador no TMS. | Cadastral (não entra na DRE) |
| Operador - Promax | Código Promax do Transportador | Código do transportador no Promax. | Cadastral (não entra na DRE) |
| Organizacao de Compras | Organização de Compras | Organização de compras (SAP) sob a qual o contrato do equipamento foi firmado. | Cadastral (não entra na DRE) |
| Prazo Pagamento | Prazo de Pagamento | Condição de pagamento acordada, em dias. Muda o caixa, não o resultado. | Cadastral (não entra na DRE) |
| Empresa locadora | CUSTO VARIAVEL SIMULADO DO VEICULO | Locadora do implemento, quando ele é alugado em vez de financiado. Anda junto de frotaEmprestada e custoAluguel. Atenção: o nome gerencial que veio nesta linha é o do 'Custo Variável Simulado' da tabela de cavalo — ver a nota de rótulos no topo. | Cadastral (não entra na DRE) |
| Placa | PLACA IMPLEMENTO | Placa do implemento. É a identidade da carreta na série, e o alvo de cavalo.placaCarreta quando o par cavalo–carreta é montado. | Cadastral (não entra na DRE) |
| Spread BNDES | SPREAD BANCO IMPLEMENTO | Spread do BNDES no financiamento do implemento — componente de Taxa Finame (%). O rótulo escreve 'banco'; pelo nome do atributo e pelo par do cavalo, é o do BNDES. | (−) Depreciação e financeiro |
| Spread Banco | SPREA D BANCO IMPLEMENTO | Spread do banco repassador. Segundo componente de Taxa Finame (%). | (−) Depreciação e financeiro |
| TJLP | TJLP ENTRADA IMPLEMENTO | TJLP aplicada ao financiamento do implemento. Terceiro componente da taxa — publicada por terceiro, não é premissa que se negocie. | (−) Depreciação e financeiro |
| Taxa Finame (%) | CA}As TAXA  FINAMET(%) CA+ AOA | Soma de TJLP + spread BNDES + spread banco: a taxa que produz os juros do FINAME do implemento. No Freightech o campo se chama taxaFiname; a planilha escreve 'Taxa Finame (%)'. O rótulo desta linha veio ilegível no arquivo. | (−) Depreciação e financeiro |
| amortizacaoImplemento | A CAOI ZA AMMELEM | Amortização do principal do FINAME do implemento, mensal. Confirmada MENSAL em 10/08/2026: amortização ÷ (valor da NF × (1 − entrada%) ÷ periodoFiname) = 1,108 nas carretas, desvio 0,018 — o prazo está em meses; lida como anual, erraria por um fator de treze. Não é depreciação contábil. O rótulo desta linha veio ilegível no arquivo. | (−) Depreciação e financeiro |
| ano | ANO ENTRADA IMPLEMENTO | Ano de entrada do implemento. É ano de calendário, não quantidade — não soma nem tira média. | Cadastral (não entra na DRE) |
| capacidadeEmpurrada | CAPACIDADE PARA CALCULO DE CUSTO VARIAVEL | Capacidade contratada do conjunto, em pallets — chega como 'Pallets: 28' e 'Pallets: 42'. É um dos eixos da matriz de consumo do Freightech (capacidade × montadora), e por isso entra no custo variável pela régua, e não como valor. | Cadastral (não entra na DRE) |
| capacidadePalletsRealEmpurrada | CAPACIDADE REAL DA CARRETA | Capacidade real da carreta, em pallets — o que ela de fato leva, contra a capacidade contratada da coluna ao lado. A diferença entre as duas é onde mora a conversa de aproveitamento. | Cadastral (não entra na DRE) |
| carencia | Carência do FINAME | Carência do FINAME do implemento: adia o início da amortização e desloca no tempo o custo fixo, sem mudar o total financiado. | (−) Depreciação e financeiro |
| chassi | CHASSI IMPLEMENTO | Chassi do implemento — identificação única do ativo, independente da placa. | Cadastral (não entra na DRE) |
| ciclo | Ciclo do implemento | Numera o ciclo do ativo. Muda **porque** o financiamento terminou — é consequência do fim do FINAME, não causa da mudança de valor. | Cadastral (não entra na DRE) |
| custoAluguel | CUSTO ALUGUEL IMPLEMENTO | Aluguel do implemento, quando ele é alugado em vez de financiado. É a terceira parcela de finameImplemento, e explica exatamente as 18 linhas em que a identidade falharia sem ela — as placas CUL0J25 e FCW7D86 nas 9 vigências. Média R$ 162,83. A periodicidade não está confirmada (mensal ou anual?), e por isso hoje não soma: é a única linha da DRE que uma confirmação de curadoria destrava sozinha. | (−) Custo fixo (não confirmado — não soma) |
| custoFixo | CUSTO FIXO IMPLEMENTO | **Não é o custo fixo do implemento: é o do conjunto cavalo + carreta.** Medido: custoFixo = finame + lucroFixomodeloNovoCiclo em 657 de 657 linhas, e finame já contém o cavalo. Confirmado MENSAL pelo transportador em 10/08/2026. Somá-lo com o finameCavalo da frota de cavalos conta cada cavalo duas vezes — R$ 1,05 milhão/mês na última vigência. | Receita bruta — escopo conjunto (não somar na carreta) |
| data | DATA ENTRADA IMPLEMENTO | Data em que o implemento entrou no Freightech — o começo da série dele. | Cadastral (não entra na DRE) |
| dataFimContrato | DATA FIM DE CONTRATO IMPLEMENTO | Projeção do fim do contrato do implemento. Não é montante, e mexe em dinheiro assim mesmo: muda a janela em que o financiamento é amortizado, e o custo fixo muda junto. | Cadastral (não entra na DRE) |
| doubleDeck | DOUBLE FARA CALCULO CHECK CUSTO VARIAVEL | Marca a carreta double deck — dois andares de carga. Entra no cálculo do custo variável porque muda o que o mesmo trecho leva; em si é especificação do ativo, não valor. | Cadastral (não entra na DRE) |
| eixoEmpurrada | TIPO DE EIXO EMPURRADA - CARRETA | Configuração de eixos do implemento. Especificação técnica — e é ela que determina a quantidade de pneus do conjunto. | Cadastral (não entra na DRE) |
| faixaReflexiva | CALCULO DE FAIXA REFLETIVA CARRETA | Item obrigatório do implemento, remunerado à parte: R$ 15,94 em todas as 657 carretas — o mesmo 15,943 que a tela CUSTO FIXO TOTAL do Freightech mostra. A planilha de classificação do time o põe no valor fixo, e os números confirmam. | (−) Custo fixo |
| finame | FINAME CAVALO + IMPLEMENTO | **O financiamento do conjunto, não o da carreta.** Medido em 14/08/2026: carreta.finame − carreta.finameImplemento = cavalo.finameCavalo em 558 de 558 pares, tolerância de R$ 0,01, zero exceções; nas 99 carretas sem cavalo vinculado a diferença é exatamente zero. O rótulo do time diz o mesmo: cavalo + implemento. | Receita bruta — escopo conjunto (não somar na carreta) |
| finameImplemento | FINAME DO IMPLEMENTO | O que é do implemento de fato: amortização + juros + aluguel, fechando em 651 de 651 linhas. Confirmado MENSAL. É a metade da receita própria da carreta — a outra é o lucro fixo do implemento. | Receita bruta |
| frotaEmprestada | IMPLEMENTO EMPRESTADO? | Marca o implemento que opera nesta unidade sem lhe pertencer. Sem este campo, a frota da unidade parece maior do que é. | Cadastral (não entra na DRE) |
| icms | ICMS ENTRADA IMPLEMENTO | Alíquota de ICMS na entrada do implemento. Confirmada pelo transportador em 10/08/2026 como alíquota, e não valor — faixa observada de 0 a 12. O montante correspondente é valorIcms. | (−) Deduções |
| implemento | MONTADORA | A montadora do implemento. O nome do atributo diz 'implemento' e o conteúdo é a fabricante — é o tipo de nome que faz alguém procurar a montadora na coluna errada. | Cadastral (não entra na DRE) |
| ipvaLicenciamento | IPVA E LICENCIAMENTO DA FROTA | Na carreta isto é **licenciamento, não IPVA**: fica praticamente fixo em R$ 140–152 por implemento, independente do valor do ativo (R$ 140,34 tanto numa carreta de R$ 156 mil quanto numa de R$ 283 mil), e 438 das 657 linhas são exatamente R$ 150,00 — coerente com semirreboque, isento de IPVA na maior parte dos estados. Anual. Atenção: há 15 valores negativos, até −R$ 1.709,86, que numa soma a distorcem. | (−) Custo fixo |
| ipvaLicenciamentoMensal | VALOR MENSAL DE LICENCIAMENTO | **Não é um doze avos da coluna anterior.** A razão mensal ÷ anual entre as 71 carretas varia de −3,01× a 5,23×, com 63% de dispersão — se fossem a mesma grandeza, a razão seria constante. Varia de R$ 435 a R$ 733, sem proporção com o valor da NF. É homonímia: duas grandezas que compartilham o prefixo do nome, e o que esta mede continua sendo pergunta aberta para a Ambev. | (−) Custo fixo (não confirmado — não soma) |
| jurosFinameImplemento | JUROS DE FINAME IMPLEMENTO | Juros do FINAME do implemento, mensais. finameImplemento = amortização + juros fecha em 37 de 38 implementos com ambas as parcelas não nulas. | (−) Depreciação e financeiro |
| lucroFixomodeloNovoCiclo | CALCULO LUCRO FIXO  CONJUNTO | Lucro fixo do novo ciclo no escopo do **conjunto**: é a parcela que, somada a finame, dá custoFixo em 657 de 657 linhas. Confirmado MENSAL. Armadilha medida: não é o lucro fixo do cavalo, embora alguns pares coincidam — entre as 284 linhas não nulas, 233 coincidem com lucroFixomodeloNovoCicloCarreta e apenas 15 com o do cavalo. A coincidência é de valor, não de significado. | Receita bruta — escopo conjunto (não somar na carreta) |
| lucroFixomodeloNovoCicloCarreta | CALCULO LUCRO FIXO  IMPLEMENTO | O lucro fixo que é da carreta. Volta a ser raiz da composição quando o total que o continha sai por escopo de conjunto — junto de finameImplemento, é o que resta de receita própria do implemento. | Receita bruta |
| lucroVariavelPrevisto | LUCRO VARIAVEL PREVISTO CONJUNTO | Lucro variável previsto do conjunto. É previsão, não realizado, e a série é intermitente — 47 de 47 transições têm zero de um dos lados, então a variação entre vigências não é preço. Escopo de conjunto: não soma na carreta, com a ressalva de que 99 linhas não têm cavalo vinculado. | Receita bruta (não confirmada — não soma) |
| lucroVariavelPrevistoCarreta | LUCRO VARIAVEL PREVISTO IMPLEMENTO | Lucro variável previsto do implemento — média R$ 4.150,22. Mesmo caráter: o nome diz 'previsto', e uma previsão não entra numa demonstração de resultado enquanto ninguém confirmar o que ela mede e em que periodicidade. | Receita bruta (não confirmada — não soma) |
| mesDeEntrada | MÊS DE ENTRADA IMPLEMENTO | Mês de entrada do implemento no Freightech. | Cadastral (não entra na DRE) |
| modelo | MODELO DA CARRETA | Modelo do implemento. Junto da montadora, é o que liga a carreta às tabelas de parâmetros do Freightech. | Cadastral (não entra na DRE) |
| percentualEntrada | % DE ENTRADA DA COMPRA DO VEICULO APÓS 2018 | Entrada do financiamento: 20% em 648 das 657 carretas — o par de periodoFiname 60 na tabela de entrada por prazo do Freightech. As 9 restantes têm 0 nas duas colunas, coerentes entre si: sem financiamento, sem entrada. | (−) Depreciação e financeiro |
| percentualIcms | % DE ICMS CONFORME PARAMETRO DA REGIÃO DA OPERAÇÃO | Alíquota de ICMS pelo parâmetro da região de operação. Alíquota não é montante: o dinheiro correspondente está em valorIcms. | (−) Deduções |
| periodoFiname | PERIODO FINAME COMPRA | Prazo do FINAME **em meses** — 60 em 648 das 657 carretas. É o divisor da amortização, e o 'em meses' é medido, não suposto: é o que a razão de 1,108 comprova. | (−) Depreciação e financeiro |
| pisCofins | PIS COFINS | Alíquota de PIS/COFINS. Confirmada pelo transportador em 10/08/2026 como alíquota, não valor — faixa observada de 0 a 9,3. O montante correspondente é valorPisCofins, e ele incide sobre a compra do ativo. | (−) Deduções |
| pneuMedidaEmpurrada | MEDIDA DE PNEUS | Medida dos pneus do implemento. Define qual preço de pneu se aplica ao ativo. | (−) Custo variável — Pneus |
| rastreador | VEICULO TEM RASTREADOR? | Rastreamento do implemento, **em reais** — a planilha de classificação do time o põe no valor fixo. A coluna existe e é zero nas 657 linhas, e a tela CUSTO FIXO TOTAL mostra 0 nas quatro linhas dela: é coluna sem dado, não custo zero. O rótulo pergunta 'tem rastreador?'; o conteúdo é um valor. | (−) Custo fixo |
| revestimento | REVESTIMENTO DA CARRETA - CALCULO | Revestimento do implemento, remunerado à parte: R$ 277,94 em todas as 657 carretas — o mesmo 277,939 da tela CUSTO FIXO TOTAL. É a correspondência mais forte do catálogo: aqui coincidem os números, não só os nomes. | (−) Custo fixo |
| seguro | SEGURO DA CARRETA | Seguro do implemento. Média R$ 503,01 nas 657 linhas, sem periodicidade confirmada — e o cavalo não tem coluna equivalente, o que deixa o seguro do conjunto pela metade. Não soma até que a Ambev confirme o que mede e em que periodicidade. | (−) Custo fixo (não confirmado — não soma) |
| statusFinanciamento | STATUS DE FINANCIMENTO DA PLACA | Situação do financiamento da placa — se o implemento ainda amortiza ou já quitou. | Cadastral (não entra na DRE) |
| statusFinanciamentoT1Shared | STATUS DE FINANCIAMENTO PARA FIM T1 | Situação do financiamento para efeito de T1. Existe ao lado do campo anterior porque as duas leituras podem divergir. | Cadastral (não entra na DRE) |
| tacografo | CHECK DE TACOGRAFO | Tacógrafo do implemento, **em reais**: R$ 21,03 em 558 carretas e 0 em 99 — a mesma divisão que a tela CUSTO FIXO TOTAL mostra (21,031 em três linhas, 0 numa). É valor fixo, apesar de o rótulo dizer 'check'. | (−) Custo fixo |
| tipoCarroceriaEmpurrada | TIPO E MODELO DE CARROCERIA | Tipo e modelo de carroceria do implemento. Especificação técnica — e é o que separa uma sider de uma baú na leitura da frota. | Cadastral (não entra na DRE) |
| valorIcms | VALOR DE ICMS CONFORME COMPRA | Valor de ICMS conforme a compra. A coluna existe e é **zero nas 657 linhas**: coluna sem dado, não imposto zero. As alíquotas existem (icms, percentualIcms), e alíquota sem base não é montante. | (−) Deduções |
| valorNfCompra | VALOR DE COMPRA DA PLACA | Valor da nota fiscal de compra do implemento. Confirmado PONTUAL: nunca varia nas 9 vigências. É a base do valor financiado (× (1 − entrada%)) e do PIS/COFINS de aquisição. | Grandeza de aquisição (não entra na DRE do período) |
| valorPisCofins | VALOR DE PIS E COFINS DA NOTA DE COMPRA | PIS/COFINS sobre a nota de compra do ativo: exatamente 9,250% de valorNfCompra, desvio 0,0000 nos 132 ativos, e nunca varia na série. É tributo de **aquisição**, não dedução sobre a prestação — a dedução do serviço continua faltando. | Grandeza de aquisição (não entra na DRE do período) |
| valorPneus | VALOR DO PNEUS DO IMPLEMENTO | Valor de pneus do implemento. A coluna existe e é **zero nas 657 linhas** — perguntar à Ambev se o custo de pneu está embutido em outra linha ou se a coluna parou de ser preenchida. | (−) Custo variável — Pneus |
