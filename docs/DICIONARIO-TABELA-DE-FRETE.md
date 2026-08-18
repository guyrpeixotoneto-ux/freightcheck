# Dicionário da tabela de frete (trecho)

Os 110 atributos da tabela de frete, com nome gerencial, o que cada um mede e
em que linha da DRE ele cai.

**O que este documento é, e o que ele não é.** As colunas `Atributo` e as
entradas de `Nome Gerencial` que já vinham preenchidas são do time — foram
mantidas exatamente como estavam, inclusive a grafia. O que este documento
acrescenta — as descrições e a categoria de DRE — é **leitura do modelo de
remuneração por trecho, não medição sobre o export**. A tabela de frete não é a
mesma fonte que este repositório apura hoje (o export de remuneração por
equipamento, cavalo e carreta), e nenhuma das classificações abaixo foi
confirmada contra valores reais. Trate cada linha como proposta a confirmar com
a Ambev, do mesmo jeito que `CONFIRMED_SEMANTICS` em `@workspace/curation` trata
uma semântica ainda não confirmada: existe, é útil, e não fecha conta sozinha.

**O vocabulário da coluna `Categoria DRE`** é o de `lib/dre/src/plano.ts`, para
que as duas fontes possam um dia somar na mesma demonstração:

| Categoria | O que reúne |
| --- | --- |
| `Receita bruta` | O que é faturado pelo trecho — CT-e, frete com CPRB, base de CPRB. |
| `Receita líquida (subtotal)` | Subtotal, não componente: frete depois dos tributos sobre a prestação. |
| `(−) Deduções` | Tributos sobre a prestação: PIS/COFINS, ICMS ou ISS, e as alíquotas que os produzem. |
| `(−) Custo variável — …` | Custo provocado por rodar, aberto por grupo: combustível, manutenção, pneus, pedágio, lavagem, seguro de carga e pessoal. |
| `Lucro variável (margem)` | A margem que o contrato embute no preço. **Não é custo** — somá-la aos custos dobra o resultado. |
| `Direcionador operacional (não entra na DRE)` | Km, tempos, velocidade, viagens, turnos. Não são dinheiro: são o que multiplica o dinheiro. Entram na DRE pelo denominador, nunca como linha. |
| `Cadastral (não entra na DRE)` | Identificação, escopo organizacional, contrato e chaves técnicas. |

**Três avisos que valem mais que a tabela.**

1. **R$/km e R$/viagem são o mesmo dinheiro contado duas vezes.** Cada grupo de
   custo aparece nas duas formas — `freteReaisKMDiesel` e
   `freteReaisViagemDiesel` — e a segunda é a primeira multiplicada pelo km do
   ciclo. Somar as duas colunas numa apuração dobra o custo.
2. **Os pares `…Lucro` são a base remuneratória, não a operacional.**
   `tempoInternoOrigemLucro`, `cargaHorariaPorTrajetoMinutoLucro` e
   `kmRodadoMesPorEquipeLucro` existem porque o tempo pago e o tempo real podem
   divergir. A diferença entre os dois é exatamente onde a conversa comercial
   acontece — não a apague escolhendo um só.
3. **Alíquota não é montante.** `percentualIcmsIss` classifica em `(−) Deduções`
   porque é o que produz a dedução, mas não soma: quem soma é
   `impostosIcmsIss`.

| Atributo | Nome Gerencial | O que é | Categoria DRE |
| --- | --- | --- | --- |
| Vigencia | Quinzena | Quinzena de validade da linha da tabela. Toda a tabela é versionada por vigência: a mesma origem–destino pode ter preço e parâmetros diferentes em quinzenas diferentes. | Cadastral (não entra na DRE) |
| Unidade - CNPJ | CNPJ da Unidade | CNPJ da unidade Ambev contratante do frete — é o CNPJ que aparece no tomador do CT-e. | Cadastral (não entra na DRE) |
| Unidade - Nome | Nome da Unidade | Nome da unidade contratante (fábrica ou CDD) a que a tabela pertence. | Cadastral (não entra na DRE) |
| Unidade SAP | Codigo da unidade | Código da unidade contratante no SAP — chave de conciliação entre a tabela de frete e o razão contábil. | Cadastral (não entra na DRE) |
| Unidade TMS | Código TMS da Unidade | Código da mesma unidade no TMS. Existe separado do SAP porque os dois sistemas numeram a unidade de formas diferentes. | Cadastral (não entra na DRE) |
| Unidade - Promax UNB | UNB Promax da Unidade | Código da unidade de negócio (UNB) no Promax — usado para amarrar o frete ao pedido/venda. | Cadastral (não entra na DRE) |
| Unidade - Regional | Regional da Unidade | Regional/diretoria a que a unidade pertence. É o nível em que a tabela é lida de forma agregada. | Cadastral (não entra na DRE) |
| Operador - CNPJ | CNPJ do Transportador | CNPJ do operador logístico que executa o trecho — o fornecedor que recebe o frete. | Cadastral (não entra na DRE) |
| Operador - Nome | Nome do Transportador | Razão social ou nome fantasia do transportador contratado no trecho. | Cadastral (não entra na DRE) |
| Operador - SAP | Codigo do Transportador | Código do transportador como fornecedor no SAP — chave do pagamento. | Cadastral (não entra na DRE) |
| Operador - TMS | Código TMS do Transportador | Código do mesmo transportador no TMS, onde a viagem é apontada. | Cadastral (não entra na DRE) |
| Operador - Promax | Código Promax do Transportador | Código do transportador no Promax. | Cadastral (não entra na DRE) |
| Organizacao de Compras | Organização de Compras | Organização de compras (SAP) sob a qual o contrato de frete foi firmado. Define qual área compra e sob que condição comercial. | Cadastral (não entra na DRE) |
| Prazo Pagamento | Prazo de Pagamento | Condição de pagamento acordada com o transportador, em dias. Muda o caixa, não o resultado — por isso não entra em linha nenhuma da DRE. | Cadastral (não entra na DRE) |
| Capacidade | Capacidade de pallet | Quantidade de pallets que o conjunto leva por viagem. É a base para converter frete por viagem em frete por pallet/caixa. | Direcionador operacional (não entra na DRE) |
| Destino | Nome unidade destino | Unidade de destino do trecho (CDD, fábrica ou cliente). | Cadastral (não entra na DRE) |
| destino SAP | Codigo sap destino | Código SAP do destino do trecho. | Cadastral (não entra na DRE) |
| destino TMS | Codigo tms destino | Código TMS do destino do trecho. | Cadastral (não entra na DRE) |
| F-MOV | Sinergia | Marca o trecho de sinergia (frete-movimentação): a perna é aproveitada de outra operação em vez de rodar vazia. Muda o km faturável do ciclo. | Direcionador operacional (não entra na DRE) |
| Origem | Nome unidade origem | Unidade de origem do trecho, onde a carga é carregada. | Cadastral (não entra na DRE) |
| origem SAP | Codigo sap origem | Código SAP da origem do trecho. | Cadastral (não entra na DRE) |
| origem TMS | Codigo tms origem | Código TMS da origem do trecho. | Cadastral (não entra na DRE) |
| cargaHorariaMotoristaPuxadaMensal | Calculo de carga horaria do motorista mensal | Horas mensais que um motorista de puxada tem disponíveis. Dividida pelo tempo de ciclo, dá quantos motoristas o trecho exige — é o que liga a jornada ao custo de pessoal. | (−) Custo variável — Pessoal |
| cargaHorariaPorTrajetoMinuto | Tempo total de ciclo | Duração do ciclo completo em minutos: deslocamento ida e volta + TMA na origem + TMA no destino + refeição. | Direcionador operacional (não entra na DRE) |
| cargaHorariaPorTrajetoMinutoLucro | Tempo total de ciclo - lucro | O mesmo ciclo, calculado com os tempos internos da versão 'lucro' (TMA origem/destino lucro). É a base de tempo usada na remuneração, e não na operação. | Direcionador operacional (não entra na DRE) |
| cargaHorarioTrajetoDia | Tempo de deslocamento total do dia | Minutos de deslocamento acumulados no dia pelo conjunto no trecho — quantos ciclos cabem na jornada. | Direcionador operacional (não entra na DRE) |
| cargaHorarioTrajetoMes | Tempo de deslocamento total do mês | O tempo do dia projetado para o mês pelos dias úteis. É o que dimensiona equipe e frota necessárias. | Direcionador operacional (não entra na DRE) |
| chaveTrecho | Chave do trecho - campo chave | Chave única da linha (origem + destino + unidade + vigência). É por ela que a tabela é comparada entre quinzenas. | Cadastral (não entra na DRE) |
| cnpjIda | CNPJ de faturamento da ida | CNPJ contra o qual o CT-e da perna de ida é emitido. Define o estado de incidência do ICMS na ida. | Cadastral (não entra na DRE) |
| cnpjVolta | CNPJ de faturamento da volta | CNPJ contra o qual o CT-e da perna de volta é emitido, quando a volta é faturada em separado. | Cadastral (não entra na DRE) |
| consumoDieselAjustado | Calculo de consumo de diesel ajustado de acordo com a carga | Consumo do trecho (km/l) depois de aplicadas as perdas — km, região e carga descartável. É o consumo que efetivamente remunera o diesel. | (−) Custo variável — Combustível |
| custoDaDiaria | Check de diaria ( valor) | Valor da diária paga ao motorista quando o trecho exige pernoite fora da base. | (−) Custo variável — Pessoal |
| custoDoTr | Check de vale refeição (ticket refeição) | Valor do ticket-refeição reconhecido no trecho, quando o ciclo cruza a janela de refeição. | (−) Custo variável — Pessoal |
| diasMes | Calculo dias uteis | Dias úteis/operacionais considerados no mês. É o multiplicador que transforma o ciclo diário em volume mensal. | Direcionador operacional (não entra na DRE) |
| dieselConsumoDieselReaisKM | Calculo do diesel r$ km | Custo de diesel por km rodado: preço do litro dividido pelo consumo ajustado. | (−) Custo variável — Combustível |
| dieselConsumoKmL | Média de consumo trecho | Consumo de referência do trecho, em km/l, antes dos ajustes de perda. É a régua com que o diesel é negociado. | (−) Custo variável — Combustível |
| fatorMotoristaAjustado | Fator motorista ajustado | Quantos motoristas por conjunto o trecho exige de fato, dada a jornada e o tempo de ciclo. | (−) Custo variável — Pessoal |
| fatorMotoristaIndicado | Fator motorista benchmark | O fator motorista de referência para o tipo de trecho. Comparado ao ajustado, mostra se a operação está acima ou abaixo do padrão. | (−) Custo variável — Pessoal |
| faturamentoDestinoObrigatorio | Faturamento obrigatório no destino | Indica se o CT-e precisa obrigatoriamente ser emitido contra o destino. Muda quem é o tomador e, com ele, a incidência tributária. | Cadastral (não entra na DRE) |
| freteComCprb | Calculo do frete para calculo do cprb | Base de frete sobre a qual a CPRB (contribuição previdenciária sobre a receita bruta) é apurada. | Receita bruta |
| freteCtrc | Calculo do valor do cte | Valor cheio do conhecimento de transporte — o que é efetivamente faturado pelo trecho. | Receita bruta |
| freteLiquido | Frete liquido sem imposto | Frete depois de retirados os tributos sobre a prestação. É o que sobra para cobrir custos e margem. | Receita líquida (subtotal) |
| fretePTms | Frete com incidencia de cprb | Valor do frete enviado ao TMS, já com a CPRB embutida — é o número que a viagem carrega no sistema de transporte. | Receita bruta |
| fretePisCofins | Calculo de pis e confins | Valor de PIS e COFINS incidente sobre a prestação do serviço de transporte. | (−) Deduções |
| freteReaisKMDiesel | R$/ km diesel | Parcela de diesel embutida no preço, por km rodado. | (−) Custo variável — Combustível |
| freteReaisKMLavagem | R$/ km lavagem | Parcela de lavagem/higienização do conjunto, por km rodado. | (−) Custo variável — Lavagem |
| freteReaisKMLucroVariavel | R$/ km lucro variavel | Margem variável remunerada ao transportador por km rodado. Não é custo: é o lucro que o contrato embute no preço. | Lucro variável (margem) |
| freteReaisKMManutencaoCarreta | R$/ km manutencao implemento | Parcela de manutenção do implemento (carreta), por km rodado. | (−) Custo variável — Manutenção |
| freteReaisKMManutencaoCavalo | R$/ km manutencao | Parcela de manutenção do cavalo mecânico, por km rodado. | (−) Custo variável — Manutenção |
| freteReaisKMPedagio | R$/ km pedagio | Parcela de pedágio embutida no preço, por km rodado. | (−) Custo variável — Pedágio |
| freteReaisKMPneu | R$/ km pneu | Parcela de pneus (novos, recapagem e câmaras, líquida da carcaça), por km rodado. | (−) Custo variável — Pneus |
| freteReaisKMSalarioVariavel | R$/ km premio produtividade | Parcela de prêmio de produtividade do motorista, por km rodado. | (−) Custo variável — Pessoal |
| freteReaisKMSeguro | R$/ km seguro | Parcela de seguro de carga, por km rodado. | (−) Custo variável — Seguro de carga |
| freteReaisViagemDiesel | Calculo de reais diesel | Diesel em reais por viagem: o R$/km de diesel multiplicado pelo km do ciclo. | (−) Custo variável — Combustível |
| freteReaisViagemLavagem | Calculo de reais lavagem | Lavagem em reais por viagem. | (−) Custo variável — Lavagem |
| freteReaisViagemLucroVariavel | Calculo de reais lucro variavel | Lucro variável em reais por viagem — a margem do transportador naquele ciclo. | Lucro variável (margem) |
| freteReaisViagemManutencaoCarreta | Calculo de reais manutenção carreta | Manutenção do implemento em reais por viagem. | (−) Custo variável — Manutenção |
| freteReaisViagemManutencaoCavalo | Calculo de reais manutenção cavalo | Manutenção do cavalo em reais por viagem. | (−) Custo variável — Manutenção |
| freteReaisViagemPedagio | Calculo de pedagio ou antecipação da tabela do frete minimo | Pedágio em reais por viagem — pelo R$/km quando há tabela própria, ou pelo pedágio por eixo da tabela de frete mínimo (ANTT) quando não há. | (−) Custo variável — Pedágio |
| freteReaisViagemPneus | Calculo de reais pneus | Pneus em reais por viagem. | (−) Custo variável — Pneus |
| freteReaisViagemSalarioVariavel | Calculo de reais salario variavel | Prêmio de produtividade em reais por viagem. | (−) Custo variável — Pessoal |
| freteReaisViagemSeguro | Calculo de reais seguro | Seguro de carga em reais por viagem. | (−) Custo variável — Seguro de carga |
| frotaNoMunicipio | Frota no município | Indica se a frota está sediada no município da origem. É o que decide entre ISS e ICMS e afeta diária e pernoite. | Cadastral (não entra na DRE) |
| gradeCarregamento | Calculo de turnos de fabricas | Grade de carregamento disponível na origem — as janelas em que o conjunto consegue carregar. Limita quantos ciclos cabem no dia. | Direcionador operacional (não entra na DRE) |
| icmsIss | Tributo aplicável (ICMS ou ISS) | Qual tributo incide na prestação do trecho: ICMS quando o transporte cruza município/estado, ISS quando é intramunicipal. | (−) Deduções |
| impostosIcmsIss | Calculo de icms e confins | Valor de ICMS ou ISS incidente sobre a prestação, pela alíquota do trecho. | (−) Deduções |
| kmIda | Km de ida | Distância da origem ao destino. | Direcionador operacional (não entra na DRE) |
| kmRodado | Total de km ciclo | Km total do ciclo (ida + volta). É o denominador de todos os R$/km e o multiplicador de todos os R$/viagem. | Direcionador operacional (não entra na DRE) |
| kmRodadoMesPorEquipe | Projeção de km rodado por mês | Km que uma equipe roda no mês no trecho, projetado pelos ciclos por dia e pelos dias úteis. | Direcionador operacional (não entra na DRE) |
| kmRodadoMesPorEquipeLucro | Projeção de km rodado por mês para lucro | A mesma projeção calculada com os tempos da versão 'lucro' — é a base de km usada para remunerar, e não a operacional. | Direcionador operacional (não entra na DRE) |
| kmVolta | Km de volta | Distância do retorno. Pode diferir da ida por rota, por sinergia (F-MOV) ou por retorno vazio. | Direcionador operacional (não entra na DRE) |
| lavagemReaisKm | Calculo de reais lavagem | Parâmetro de lavagem em R$/km que alimenta o cálculo — o insumo, antes de virar preço. | (−) Custo variável — Lavagem |
| lucroVariavelReaisKm | Calculo de reais lucro variavel | Parâmetro de lucro variável em R$/km que alimenta o cálculo. | Lucro variável (margem) |
| manutencaoCavalo | Parametro de manutenção cavalo r$ | Parâmetro de manutenção do cavalo em R$/km, vindo da tabela de manutenção do modelo. | (−) Custo variável — Manutenção |
| manutencaoImplementoReaiskm | Parametro de manutenção implemento r$ | Parâmetro de manutenção do implemento em R$/km. | (−) Custo variável — Manutenção |
| observacao | Observação | Campo livre de anotação da linha — acordos, exceções e o histórico que não cabe em coluna estruturada. | Cadastral (não entra na DRE) |
| pedagio | Calculo de pedagio caso o campo de reais km pedagio seja diferente de 0 | Valor de pedágio do trecho calculado pelo R$/km, quando esse parâmetro está preenchido. | (−) Custo variável — Pedágio |
| pedagioPorEixoIdaVolta | Pedágio por eixo (ida e volta) | Pedágio por eixo do ciclo completo. É a via alternativa de cálculo, usada quando não há R$/km de pedágio — a mesma base da tabela de frete mínimo. | (−) Custo variável — Pedágio |
| pedagioReaisKM | R$ km pedagio | Parâmetro de pedágio em R$/km que alimenta o cálculo. | (−) Custo variável — Pedágio |
| percentualIcmsIss | Percentual de icms ou iss do trecho | Alíquota aplicada no trecho. Alíquota não é montante: é ela que, sobre a base, produz impostosIcmsIss. | (−) Deduções |
| percentualPerdaDescartavel | % De perda descartavel | Perda de consumo atribuída à carga descartável (one-way), que pesa mais do que o retornável. | (−) Custo variável — Combustível |
| percentualPerdaKm | % De perda km | Perda de consumo por faixa de km rodado — trecho curto consome mais por km do que trecho longo. | (−) Custo variável — Combustível |
| percentualPerdaRegiao | % De perda regiao | Perda de consumo por relevo e trânsito da região. | (−) Custo variável — Combustível |
| pneuCustoPneusCamarasReaisKm | R$ km custo de pneus camaras | Custo de pneus e câmaras por km: (pneus novos + recapagens − venda da carcaça) × quantidade ÷ vida útil. | (−) Custo variável — Pneus |
| pneuQuantidadeDePneus | Calculo de quantidade de pneus | Quantidade de pneus do conjunto cavalo + carreta, conforme a configuração de eixos. | (−) Custo variável — Pneus |
| pneuValorDeVendaDaCarcaca | Calculo do valor de venda da carcaça | Valor recuperado na venda da carcaça ao fim da vida do pneu. Entra como redutor do custo de pneus. | (−) Custo variável — Pneus |
| pneuValorMedioDaRecapagem | Valor médio da recapagem | Custo médio de uma recapagem, que estende a vida útil do pneu. | (−) Custo variável — Pneus |
| pneuValorMedioPneus | Valor médio dos pneus nnovos | Preço médio do pneu novo usado como base do custo. | (−) Custo variável — Pneus |
| pneuVidautilPneu | Vida util do pneu | Vida útil do pneu contratada — quantas recapagens/ciclos ele suporta antes da carcaça. | (−) Custo variável — Pneus |
| premioProdutividadeFatorMotorista | Calculo de produtividade fator motorista | Fator de motorista aplicado ao prêmio: distribui o prêmio pelo número de motoristas que o ciclo exige. | (−) Custo variável — Pessoal |
| premioProdutividadeKmRodado | Calculo de produtividade km rodado | Km rodado considerado na conta do prêmio de produtividade. | (−) Custo variável — Pessoal |
| premioProdutividadeSalarioVariavel | Calculo de produtividade salario variavel | Valor do prêmio de produtividade (salário variável) do motorista no trecho. | (−) Custo variável — Pessoal |
| premioProdutividadeSalarioVariavelReaisKm | Calculo de produtividade salario variavel r$ km | O mesmo prêmio expresso em R$/km, para entrar na composição do preço. | (−) Custo variável — Pessoal |
| previsaoViagens | Calculo de previsao de viagens | Viagens previstas no período para o trecho. É o volume que transforma R$/viagem em valor do período. | Direcionador operacional (não entra na DRE) |
| regiaoEmpurrada | Região da operação | Região a que a empurrada pertence. Define parâmetros regionais — perda de consumo, salário, diária. | Cadastral (não entra na DRE) |
| seguro | Seguro de carga | Seguro sobre o valor da carga transportada no trecho. | (−) Custo variável — Seguro de carga |
| seguroReaiskm | R$ km seguro | Parâmetro de seguro em R$/km que alimenta o cálculo. | (−) Custo variável — Seguro de carga |
| tempoInternoDestino | Tma destino | Tempo médio de atendimento no destino — da chegada à liberação, incluindo fila e descarga. | Direcionador operacional (não entra na DRE) |
| tempoInternoDestinoLucro | Tma destino lucro | TMA de destino usado na conta de remuneração. Quando difere do operacional, é a diferença entre o tempo pago e o tempo real. | Direcionador operacional (não entra na DRE) |
| tempoInternoOrigem | Tma origem | Tempo médio de atendimento na origem — da chegada à saída carregado. | Direcionador operacional (não entra na DRE) |
| tempoInternoOrigemLucro | Tma origem lucro | TMA de origem usado na conta de remuneração. | Direcionador operacional (não entra na DRE) |
| tempoRefeicaoMinuto | Tempo de refeição | Minutos de refeição reconhecidos dentro do ciclo — entram na jornada e, por ela, no dimensionamento de motoristas. | Direcionador operacional (não entra na DRE) |
| tempoTrajetoFabricaCDMinuto | Tempo de deslocamento fabrica x cdd | Tempo puro de deslocamento entre fábrica e CDD, sem tempos internos. É o que a velocidade média e o km produzem. | Direcionador operacional (não entra na DRE) |
| trechoComDiaria | Check de trecho com ou sem diaria | Indica se o trecho gera diária. É o que liga (ou não) custoDaDiaria à conta do trecho. | (−) Custo variável — Pessoal |
| trechoComVr | Check de trecho com ou sem vale refeição ( ticket refeição) | Indica se o trecho gera vale-refeição. É o que liga (ou não) custoDoTr à conta do trecho. | (−) Custo variável — Pessoal |
| turnoEmpurrada | Modelo de remuneração de equipe | Modelo de turno/escala da equipe na empurrada. Define como a jornada é remunerada e quantos motoristas o conjunto carrega. | (−) Custo variável — Pessoal |
| turnosFabrica | Turnos de fabrica | Quantos turnos a fábrica de origem opera. Limita a janela de carregamento e, com ela, os ciclos possíveis no dia. | Direcionador operacional (não entra na DRE) |
| velocidadeMediaKmH | Velocidade média do trecho | Velocidade média praticada no trecho. Com o km, produz o tempo de deslocamento. | Direcionador operacional (não entra na DRE) |
| vidautilAjustadaPneu | Vida util em km do pneu | Vida útil do pneu convertida em km, já ajustada ao trecho. É o divisor do custo de pneus por km. | (−) Custo variável — Pneus |
| _id | Identificador do registro | Chave técnica do documento no banco. Não tem leitura de negócio — serve para rastrear a linha entre cargas. | Cadastral (não entra na DRE) |
