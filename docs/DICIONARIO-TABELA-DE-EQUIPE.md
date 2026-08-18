# Dicionário da tabela de equipe

Os 47 atributos da tabela de equipe, com nome gerencial, o que cada um mede e
duas leituras de DRE — a **sintética**, que é a seção da demonstração, e a
**analítica**, que é o grupo dentro dela.

**Esta tabela preenche a lacuna mais cara da DRE de hoje.** O plano declara
`fixo.motorista` — "Motorista e encargos" — como linha **essencial** e sem dado,
com esta evidência escrita em `lib/dre/src/plano.ts`:

> Custo de mão de obra por veículo. Nenhuma coluna de pessoal existe no export —
> a folha do transportador não passa pela Freightec. O grupo `cf_pessoal` da
> taxonomia existe e está vazio: nenhum dos 138 atributos foi classificado nele.

É exatamente isso que este arquivo traz. Enquanto ele não entra, o EBITDA fica
inconclusivo por falta da maior parcela de custo fixo de uma operação de
transporte — e um EBITDA sem motorista não é um EBITDA com motorista em zero.

**A força de prova aqui é a da tabela de frete, não a do cavalo.** Este export
ainda não foi importado, então nada abaixo foi medido contra valor real. A
exceção é `quantidadePorCaminhao`, que a planilha de classificação do time já
classifica como valor fixo (`lib/knowledge/src/classificacao.ts`). O resto é
leitura do modelo de folha, e cada linha é proposta a confirmar.

## As duas colunas de categoria

| Sintético | O que reúne |
| --- | --- |
| `(−) Custo fixo` | O custo do cargo que existe independentemente de rodar: salário, adicionais, encargos, benefícios, EPI. |
| `(−) Custo variável` | O que só existe quando a operação acontece: diária, prêmio de produtividade, salário variável. |
| `Direcionador (não entra na DRE)` | Fator de motoristas por caminhão, efetivo total, duração do abono. Não são dinheiro: são o que multiplica o dinheiro. |
| `Cadastral (não entra na DRE)` | Vigência, unidade, operador, contrato, cargo e turno. |
| `Não classificado (não soma)` | `outro`, a rubrica sem rótulo. |

O analítico abre o sintético em grupos — salário base, adicionais e DSR, abono,
encargos e provisões, alimentação, saúde e segurança ocupacional, transporte,
uniformes e EPI, diária, remuneração variável, subtotais e dimensionamento.

## Três avisos que valem mais que a tabela

1. **Nove destas colunas são subtotais, e somá-las com as parcelas dobra a
   folha.** `salarioFixo`, `remuneracaoContraCheque`, `remuneracaoFixa`,
   `totalBeneficioFixo`, `totalDaRemuneracao`, `totalRemuneracao` e `total`
   estão em cima das mesmas linhas que `pisoSalarial`, `adicionalNoturno`,
   `cestaBasica` e companhia. A cadeia que a tabela sugere — **a confirmar, não
   medida**:

   ```
   piso + adicional noturno + DSR + abono                → salarioFixo
   salarioFixo + parcelas de folha                       → remuneracaoContraCheque
   remuneracaoContraCheque + encargos e provisões        → remuneracaoFixa
   alimentação + saúde + transporte + seguro de vida     → totalBeneficioFixo
   remuneracaoFixa + totalBeneficioFixo + uniforme/EPI   → total
   ```

   Só uma dessas colunas entra na DRE, e é a que estiver no topo da cadeia.

2. **O abono tem duas colunas de total porque a ordem das operações é o
   conteúdo.** `totalEncargoProvisao` incide sobre o salário **menos** o abono —
   abono não é base de encargo — e `totalRemuneracao` soma o abono de volta
   depois. Os rótulos das duas são quase idênticos, e a cláusula final é a única
   coisa que as distingue. Trocar uma pela outra muda o custo do cargo sem
   mudar nada visível.

3. **`outro` é uma coluna sem nome dentro de um total.** É a forma mais
   silenciosa de duplicar ou esconder um custo, e a única resposta honesta hoje
   é não somá-la e perguntar à Ambev o que ela recebe.

**Uma observação sobre `duracaoAbono` e `valorAbonoAplicado`.** Os dois juntos
explicam a queda de remuneração que ninguém negociou: quando a janela do abono
se encerra, `valorAbonoAplicado` deixa de acompanhar `valorAbono` e o total cai
sozinho. É o tipo de movimento que, sem estas duas colunas à vista, vira um
chamado procurando erro onde há regra.

| Atributo | Nome Gerencial | O que é | Categoria DRE - Sintético | Categoria DRE - Analítico |
| --- | --- | --- | --- | --- |
| Vigencia | Quinzena | Quinzena de validade da linha. Cada cargo e turno tem uma linha por vigência, e é a comparação entre elas que mostra o que mudou na folha remunerada. | Cadastral (não entra na DRE) | Cadastro — Vigência |
| Unidade - CNPJ | CNPJ da Unidade | CNPJ da unidade Ambev a que a equipe está alocada. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade - Nome | Nome da Unidade | Nome da unidade (fábrica ou CDD) onde a equipe opera. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade SAP | Codigo da unidade | Código da unidade no SAP — chave de conciliação com o razão contábil. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade TMS | Código TMS da Unidade | Código da mesma unidade no TMS. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade - Promax UNB | UNB Promax da Unidade | Código da unidade de negócio no Promax. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade - Regional | Regional da Unidade | Regional a que a unidade pertence — o nível em que a folha é lida agregada, e onde a convenção coletiva costuma variar. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Operador - CNPJ | CNPJ do Transportador | CNPJ do transportador empregador da equipe. É dele a folha; a Ambev remunera o custo dela dentro da tarifa. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - Nome | Nome do Transportador | Razão social do transportador. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - SAP | Codigo do Transportador | Código do transportador como fornecedor no SAP — chave do pagamento. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - TMS | Código TMS do Transportador | Código do transportador no TMS. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - Promax | Código Promax do Transportador | Código do transportador no Promax. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Organizacao de Compras | Organização de Compras | Organização de compras (SAP) sob a qual o contrato foi firmado. | Cadastral (não entra na DRE) | Cadastro — Contrato |
| Prazo Pagamento | Prazo de Pagamento | Condição de pagamento acordada, em dias. Muda o caixa, não o resultado. | Cadastral (não entra na DRE) | Cadastro — Contrato |
| adicionalNoturno | CALCULO ADICIONAL NOTURNO | Adicional noturno do cargo — o acréscimo legal sobre as horas trabalhadas entre 22h e 5h. Só existe onde o turno alcança a madrugada, e é por isso que ele anda junto de turnoEmpurrada. | (−) Custo fixo | Pessoal — Adicionais e DSR |
| assistenciaMedica | CALCULO ASSISTENCIA MÉDICA | Plano de saúde da equipe, no custo mensal do cargo. Diferente do PCMSO ao lado: aqui é assistência, lá é exame ocupacional obrigatório. | (−) Custo fixo | Pessoal — Saúde e segurança ocupacional |
| cafeDaManha | CALCULO DE CAFÉ DA MANHÃ | Café da manhã fornecido à equipe. Benefício de alimentação, tratado em linha própria porque nem todo turno o recebe. | (−) Custo fixo | Pessoal — Benefícios de alimentação |
| cargoEquipeEmpurrada | CARGO REMUNERADO | O cargo que está sendo remunerado nesta linha — motorista, ajudante, conferente. **Cada linha é um cargo dentro de um turno, não uma pessoa**: quem multiplica cargo por efetivo é quantidadePorCaminhao. | Cadastral (não entra na DRE) | Cadastro — Equipe |
| cestaBasica | VALOR CESTA BASICA | Cesta básica do cargo, quando a convenção coletiva a prevê. | (−) Custo fixo | Pessoal — Benefícios de alimentação |
| diaria | DIARIA DA EQUIPE REMUNERADA | Diária paga à equipe quando a operação exige pernoite fora da base. É a parcela de pessoal que varia com a rota — o mesmo cargo custa diferente conforme o trecho, e o par dela na tabela de frete é trechoComDiaria / custoDaDiaria. | (−) Custo variável | Pessoal — Diária |
| dsrAdicionalNoturno | CALCUO DO DSR REMUNERADO | DSR — descanso semanal remunerado — sobre o adicional noturno: o reflexo legal do adicional nos dias de descanso. É acessório, e mexer no adicional mexe aqui junto. | (−) Custo fixo | Pessoal — Adicionais e DSR |
| duracaoAbono | DURAÇÃO DO ABONO | Por quantos meses o abono se aplica. Não é dinheiro: é a janela que decide quando valorAbono sai da conta — e é ela que explica remuneração que cai sem ninguém ter mexido em salário. | Direcionador (não entra na DRE) | Pessoal — Abono |
| outro | Outros | Rubrica sem rótulo na origem. Enquanto ninguém disser o que ela recebe, não soma: uma coluna sem nome dentro de um total é a forma mais silenciosa de dobrar um custo. É pergunta para a Ambev. | Não classificado (não soma) | Não identificado |
| pcmsoPorMes | CALCULO DE PCMSO POR MÊS | PCMSO — Programa de Controle Médico de Saúde Ocupacional — rateado por mês. São os exames obrigatórios (admissional, periódico, demissional), não plano de saúde. | (−) Custo fixo | Pessoal — Saúde e segurança ocupacional |
| percentualEncargoEProvisao | CHECK DE ENCARGO E PROVISÕES | Percentual de encargos e provisões sobre o salário: INSS, FGTS, férias, 13º e seus reflexos. Alíquota, não montante — quem vira dinheiro é totalEncargoProvisao. | (−) Custo fixo | Pessoal — Encargos e provisões |
| pisoSalarial | VALOR DO SALARIO BASE | Piso salarial do cargo, pela convenção coletiva da categoria. É a raiz de quase toda a tabela: adicionais, DSR, encargos e provisões saem daqui, e um centavo de erro aqui se propaga por todas as linhas abaixo. | (−) Custo fixo | Pessoal — Salário base |
| plr | CALCULO DO PLR REMUNERADO | Participação nos lucros e resultados, rateada no custo mensal do cargo. Vive em linha própria porque não tem natureza salarial — não entra na base de encargos. | (−) Custo fixo | Pessoal — Remuneração variável |
| premiacaoProdutividade | CALCULO DA PRODUTIVIDADE PROJETADA ( REMUNERAÇÃO VARIAVEL EQUIPE) | Prêmio de produtividade projetado da equipe — a parcela que varia com o que ela entrega. É a contraparte, do lado da folha, do salário variável que a tabela de frete remunera por km (freteReaisKMSalarioVariavel). | (−) Custo variável | Pessoal — Remuneração variável |
| quantidadePorCaminhao | FATOR DE MOTORISTAS POR CAMINHÃO | Quantos profissionais deste cargo cada caminhão exige. É o fator que transforma o custo de uma pessoa no custo de um veículo — sem ele, a folha não vira custo por ativo. A planilha de classificação do time o classifica como valor fixo. | Direcionador (não entra na DRE) | Dimensionamento de equipe |
| quantidadeTotalxCaminhaoAtivo | QUANTIDADE DE FROTAS ATIVAS | Caminhões ativos multiplicados pelo fator do cargo: o efetivo total que a unidade precisa manter. É o multiplicador que leva o custo do cargo ao custo da frota. | Direcionador (não entra na DRE) | Dimensionamento de equipe |
| remuneracaoContraCheque | CALCULO DA REMUNERAÇÃO PARA CONTRA CHEQUE | O que sai no contracheque: o que a pessoa recebe, antes dos encargos do empregador. **Subtotal** — não somar junto das parcelas que o compõem. | (−) Custo fixo | Pessoal — Subtotais (não somar com as parcelas) |
| remuneracaoFixa | CALCULO DA REMUNERAÇÃO PARA CONTRA CHEQUE COM ENCARGOS | O contracheque acrescido de encargos e provisões: o custo do cargo para quem paga, e não o que a pessoa recebe. **Subtotal.** | (−) Custo fixo | Pessoal — Subtotais (não somar com as parcelas) |
| remuneracaoVariavel | PROJEÇÃO DE SALARIO VARIAVEL POR MOTORISTA | Projeção do salário variável por motorista. É projeção: muda quando a operação muda, e não quando alguém renegocia o cargo — e uma projeção precisa ser lida como tal antes de virar linha de resultado. | (−) Custo variável | Pessoal — Remuneração variável |
| salarioFixo | SALARIO FIXO DO CARGO COM DSR ADICIONAL E ABONO | Piso + adicional noturno + DSR + abono. É o primeiro subtotal da cadeia, e o degrau em que o salário deixa de ser o da convenção e passa a ser o do turno. **Subtotal.** | (−) Custo fixo | Pessoal — Subtotais (não somar com as parcelas) |
| seguroDeVida | CALCULO DO SEGURO DE VIDA | Seguro de vida em grupo, obrigatório por convenção na maior parte das categorias de transporte. | (−) Custo fixo | Pessoal — Saúde e segurança ocupacional |
| ticketRefeicaoLiquido | CALCULO DO TICKET REFEIÇÃO | Ticket-refeição já descontada a coparticipação do empregado — 'líquido' é o que custa à empresa, e é menor que o valor de face do benefício. | (−) Custo fixo | Pessoal — Benefícios de alimentação |
| total | CALCULO DO SALARIO COM ENCARGOS, BENEFICIOS E EPI | O custo total do cargo: salário, encargos, benefícios e EPI. É o topo da cadeia — somá-lo com qualquer parcela abaixo dobra o custo. **Subtotal.** | (−) Custo fixo | Pessoal — Subtotais (não somar com as parcelas) |
| totalBeneficioFixo | CALCULO DO BENEFICIO FIXO | Soma dos benefícios fixos do cargo: alimentação, saúde, transporte e seguro de vida. **Subtotal.** | (−) Custo fixo | Pessoal — Subtotais (não somar com as parcelas) |
| totalDaRemuneracao | CALCULO TOTAL DA REMUNERAÇÃO SUBTRAINDO ABONO | Remuneração total com o abono **subtraído**. Existe ao lado de totalRemuneracao porque o abono entra e sai da base em momentos diferentes — os dois nomes quase iguais são essa diferença, e não uma duplicidade. | (−) Custo fixo | Pessoal — Subtotais (não somar com as parcelas) |
| totalEncargoProvisao | TOTAL DE ENCARGO E PROVISÃO SOBRE SALARIO MENOS ABONO | Encargos e provisões em reais, aplicados sobre o salário **já descontado o abono** — o abono não é base de encargo, e é essa exclusão que a fórmula registra. | (−) Custo fixo | Pessoal — Encargos e provisões |
| totalRemuneracao | TOTAL DE ENCARGO E PROVISÃO SOBRE SALARIO MENOS ABONO SOMANDO ABONO POSTERIOR | O mesmo cálculo da linha anterior, com o abono somado de volta depois. A ordem é o conteúdo: subtrair antes e somar depois é o que mantém o abono fora da base de encargos e dentro do total pago. Repare que o rótulo repete o da linha acima com uma cláusula a mais — é a cláusula que distingue as duas. **Subtotal.** | (−) Custo fixo | Pessoal — Subtotais (não somar com as parcelas) |
| totalUniformeEPI | CALCULO DO EPI REMUNERADO | Uniforme e EPI rateados no custo mensal do cargo — botina, luva, colete, camisa. É obrigação de segurança do trabalho, não benefício, e no Freightech tem seção inteira só dela. | (−) Custo fixo | Pessoal — Uniformes e EPI |
| turnoEmpurrada | TIPO DE EQUIPE | Turno/tipo de equipe da empurrada. Junto do cargo, é a chave da linha: o mesmo cargo custa diferente em turnos diferentes, e é do turno que nasce o adicional noturno. | Cadastral (não entra na DRE) | Cadastro — Equipe |
| valeTransporteLiquido | CALCULO DO VALE TRANSPORTE | Vale-transporte líquido do desconto legal de até 6% do salário do empregado — o que sobra é o custo da empresa. | (−) Custo fixo | Pessoal — Transporte |
| valorAbono | VALOR DO ABONO | Valor do abono acordado. Parcela sem natureza salarial: por isso fica fora da base de encargos, e por isso tem duas colunas de total só para si. | (−) Custo fixo | Pessoal — Abono |
| valorAbonoAplicado | VALOR DO ABONO APLICADO | O abono efetivamente aplicado nesta vigência. Pode diferir de valorAbono quando a janela de duracaoAbono já se encerrou — e a diferença entre os dois é o que explica remuneração caindo sem mudança de acordo. | (−) Custo fixo | Pessoal — Abono |
| _id | Identificador do registro | Chave técnica do documento no banco. Sem leitura de negócio — serve para rastrear a linha entre cargas. | Cadastral (não entra na DRE) | Cadastro — Chave técnica |
