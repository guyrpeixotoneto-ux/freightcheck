# Dicionário da tabela de QLP ADM

Os 37 atributos da tabela do QLP ADM, com nome gerencial, o que cada um mede e
duas leituras de DRE — a **sintética**, que é a seção da demonstração, e a
**analítica**, que é a rubrica dentro dela.

**O que esta tabela é.** O Book do operador define QLP ADM como o *"detalhamento
da composição do modelo de remuneração da estrutura administrativa das
transportadoras"*, e há um bloco irmão — DESCONTO QLP ADM — com a *"auditoria do
QLP ADM realizada bimestralmente em todas as operações Ambev"*
(`lib/knowledge/src/book.ts`). Ou seja: esta não é a folha de quem dirige, é a de
quem administra a operação — e ela é auditada contra um benchmark, com desconto
quando o quadro não confere.

**A tabela inteira tem uma forma só, e entendê-la resolve 21 das 37 linhas:**

```
Quantidade <rubrica>  ×  Valor <rubrica>  =  Despesa <rubrica>
```

para seis rubricas — Benefício, Encargos, Frota Leve, Ordenados, Telefonia e
Uniformes. **Só a Despesa é dinheiro.** A quantidade é efetivo, o valor é preço
unitário, e somar qualquer um dos três com outro conta a mesma estrutura duas
vezes. Nos Ordenados o par muda de nome mas não de natureza: o "valor" se chama
`Salário Ordenados`, e há ainda `Salário Encargos`, que é o mesmo salário com
encargos embutidos.

| Sintético | O que reúne |
| --- | --- |
| `(−) Custo fixo — estrutura administrativa` | As seis Despesas, mais o vale-transporte. É o único grupo que soma. |
| `(−) Custo fixo — parâmetro unitário (não soma)` | Os Valores e os Salários: preço de uma unidade, não montante. |
| `Direcionador (não entra na DRE)` | As seis Quantidades: efetivo e itens remunerados. |
| `Benchmark (não entra na DRE)` | Quantidade e salário de referência — a régua da auditoria, não um custo. |
| `Cadastral (não entra na DRE)` | Vigência, unidade, operador, contrato, cargo e chave técnica. |

**A coluna analítica agrupa por rubrica, e não por natureza.** É de propósito: as
três colunas de uma mesma rubrica — quantidade, valor unitário e despesa — caem
no mesmo grupo analítico, de modo que filtrar por `Estrutura ADM — Benefícios`
devolve o trio inteiro e a conta `quantidade × valor = despesa` fica conferível
numa tela só. É a conferência que a coluna sintética não permite fazer sozinha,
porque lá as três estão separadas justamente por natureza.

| Analítico | O que reúne |
| --- | --- |
| `Estrutura ADM — Ordenados` | Salário unitário, efetivo reconhecido e despesa de ordenados. |
| `Estrutura ADM — Encargos e provisões` | Salário com encargos, quantidade e despesa de encargos. |
| `Estrutura ADM — Benefícios` | Valor, quantidade e despesa de benefícios. |
| `Estrutura ADM — Transporte` | Vale-transporte do quadro ordenado. |
| `Estrutura ADM — Frota leve` | Valor, quantidade e despesa dos veículos de apoio. |
| `Estrutura ADM — Telefonia` | Valor, quantidade e despesa de linhas e aparelhos. |
| `Estrutura ADM — Uniformes` | Valor, quantidade e despesa de uniformes administrativos. |
| `Benchmark QLP — Quadro de referência` | A quantidade que a auditoria confronta. |
| `Benchmark QLP — Salário de referência` | O salário que a auditoria confronta. |
| `Cadastro — …` | Vigência, unidade, operador, contrato, cargo e chave técnica. |

## Três coisas a resolver antes de somar

1. **Esta tabela não tem linha na DRE de hoje.** O plano de `lib/dre/src/plano.ts`
   tem cinco seções e nenhuma delas é despesa administrativa: a única linha de
   pessoal é `fixo.motorista`, que é motorista e encargos, não estrutura. Somar
   o QLP ADM ali misturaria a folha de quem dirige com a de quem administra —
   duas conversas diferentes com a transportadora. O que falta é um componente
   novo, algo como `fixo.estrutura_administrativa`, declarado com a mesma
   disciplina dos outros: fonte, escopo e evidência.

2. **`Vale Transporte` pode já estar dentro de `Despesa Benefício`.** Os rótulos
   admitem as duas leituras — o VT é um benefício, e ele tem coluna própria —, e
   a diferença entre elas é o valor inteiro do vale-transporte do quadro. É a
   primeira pergunta a fazer à Ambev sobre esta tabela.

3. **O rótulo de `Quantidade Encargos` fala em benefício.** Veio como
   "QUANTIDADE DE BENEFICIO ENCARGO REMUNERADO", aparentemente herdando a palavra
   da linha de cima. Ficou como está — a descrição diz o que o campo mede —, mas
   vale confirmar se a base dos encargos é a mesma dos benefícios ou a dos
   ordenados. Se for a dos ordenados, o rótulo está errado; se for mesmo a dos
   benefícios, é uma regra que ninguém adivinharia.

**Sobre a força de prova.** Como a tabela de equipe, este export ainda não foi
importado: nada abaixo foi medido contra valor real. As duas afirmações
sustentadas por fonte deste repositório são o significado do QLP ADM e a
auditoria bimestral, ambas do Book. O resto é leitura da estrutura da tabela, e
cada linha é proposta a confirmar.

| Atributo | Nome Gerencial | O que é | Categoria DRE - Sintético | Categoria DRE - Analítico |
| --- | --- | --- | --- | --- |
| Vigencia | Quinzena | Quinzena de validade da linha. Cada cargo administrativo tem uma linha por vigência, e é a comparação entre elas que mostra o que mudou na estrutura remunerada. | Cadastral (não entra na DRE) | Cadastro — Vigência |
| Unidade - CNPJ | CNPJ da Unidade | CNPJ da unidade Ambev a que a estrutura administrativa está vinculada. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade - Nome | Nome da Unidade | Nome da unidade (fábrica ou CDD) cuja estrutura administrativa é remunerada aqui. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade SAP | Codigo da unidade | Código da unidade no SAP — chave de conciliação com o razão contábil. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade TMS | Código TMS da Unidade | Código da mesma unidade no TMS. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade - Promax UNB | UNB Promax da Unidade | Código da unidade de negócio no Promax. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Unidade - Regional | Regional da Unidade | Regional a que a unidade pertence — o nível em que a estrutura é comparada entre operações. | Cadastral (não entra na DRE) | Cadastro — Unidade |
| Operador - CNPJ | CNPJ do Transportador | CNPJ da transportadora cuja estrutura administrativa é remunerada. É dela a folha; a Ambev remunera a estrutura dentro do modelo. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - Nome | Nome do Transportador | Razão social da transportadora. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - SAP | Codigo do Transportador | Código da transportadora como fornecedora no SAP — chave do pagamento. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - TMS | Código TMS do Transportador | Código da transportadora no TMS. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Operador - Promax | Código Promax do Transportador | Código da transportadora no Promax. | Cadastral (não entra na DRE) | Cadastro — Operador |
| Organizacao de Compras | Organização de Compras | Organização de compras (SAP) sob a qual o contrato foi firmado. | Cadastral (não entra na DRE) | Cadastro — Contrato |
| Prazo Pagamento | Prazo de Pagamento | Condição de pagamento acordada, em dias. Muda o caixa, não o resultado. | Cadastral (não entra na DRE) | Cadastro — Contrato |
| Cargo | CARGO REMUNERADO | O cargo administrativo remunerado nesta linha — supervisor, analista, auxiliar. **É a chave da tabela**: cada linha é um cargo do quadro, e não uma pessoa. Quem diz quantas pessoas há é a coluna Quantidade correspondente. | Cadastral (não entra na DRE) | Cadastro — Cargo |
| Despesa Benefício | CALCULO DO BENEFICIO REMUNERADO MULTIPLICADO PELA QUANTIDADE DE BENEFICIOS REMUNERADOS | Benefícios do cargo em reais: Valor Benefício × Quantidade Benefício. É montante — e é uma das seis despesas que efetivamente somam nesta tabela. | (−) Custo fixo — estrutura administrativa | Estrutura ADM — Benefícios |
| Despesa Encargos | CALCULO DO ENCARGO REMUNERADO | Encargos e provisões do cargo em reais — INSS, FGTS, férias, 13º e reflexos sobre os ordenados. Montante. | (−) Custo fixo — estrutura administrativa | Estrutura ADM — Encargos e provisões |
| Despesa Frota Leve | CALCULO DE FROTA LEVE REMUNERADO | Frota leve em reais: os veículos de apoio da estrutura administrativa (carro do supervisor, utilitário da operação), não o cavalo nem a carreta. Montante. | (−) Custo fixo — estrutura administrativa | Estrutura ADM — Frota leve |
| Despesa Ordenados | CALCULO DE SALARIO ORDENADO POR QUANTIDADES ORDENADAS DO QLP | Ordenados do cargo em reais: Salário Ordenados × Quantidade Ordenados. É a maior das seis despesas, e a que o benchmark do QLP audita. | (−) Custo fixo — estrutura administrativa | Estrutura ADM — Ordenados |
| Despesa Telefonia | CALCULO DE TELEFONIA REMUNERADA | Telefonia em reais — linhas e aparelhos da estrutura administrativa. Montante. | (−) Custo fixo — estrutura administrativa | Estrutura ADM — Telefonia |
| Despesa Uniformes | CALCULO DE UNIFORMES REMUNERADA | Uniformes da estrutura administrativa em reais. Montante. Não confundir com o EPI da equipe operacional, que vive na tabela de equipe (totalUniformeEPI). | (−) Custo fixo — estrutura administrativa | Estrutura ADM — Uniformes |
| QLP Benchmark Quantidade | QUANTIDADE BENCHMARK | Quantidade de referência do cargo — quantas pessoas o padrão da operação prevê, contra as que o quadro tem. **É a régua da auditoria bimestral do QLP ADM**: a diferença entre benchmark e realizado é o que vira não conformidade, e a consequência financeira dela está no bloco DESCONTO QLP ADM do Book. | Benchmark (não entra na DRE) | Benchmark QLP — Quadro de referência |
| QLP Benchmark Salário | SALARIO BENCHMARK | Salário de referência do cargo. No Freightech vem de uma matriz por faixas (0, 15, 30, 50, 60, 70, 80 — a sequência é irregular de propósito, não faltam faixas); o export traz o valor já resolvido para o cargo. | Benchmark (não entra na DRE) | Benchmark QLP — Salário de referência |
| Quantidade Benefício | QUANTIDADE DE BENEFICIO REMUNERADO | Quantos benefícios são remunerados no cargo. É o multiplicador de Valor Benefício — não é dinheiro. | Direcionador (não entra na DRE) | Estrutura ADM — Benefícios |
| Quantidade Encargos | QUANTIDADE DE BENEFICIO ENCARGO REMUNERADO | Quantidade sobre a qual os encargos são remunerados. O rótulo veio com a palavra 'benefício' no meio, aparentemente herdada da linha de cima — vale confirmar se a base é a mesma. | Direcionador (não entra na DRE) | Estrutura ADM — Encargos e provisões |
| Quantidade Frota Leve | QUANTIDADE DE FROTA LEVE REMUNERADO | Quantos veículos de frota leve o cargo tem direito a ter remunerados. | Direcionador (não entra na DRE) | Estrutura ADM — Frota leve |
| Quantidade Ordenados | QUANTIDADE DE QLP REMUNERADO | Quantas posições do cargo o QLP remunera — o efetivo reconhecido. É esta quantidade que o benchmark confronta. | Direcionador (não entra na DRE) | Estrutura ADM — Ordenados |
| Quantidade Telefonia | QUANTIDADE DE TELEFONIA REMUNERADO | Quantas linhas/aparelhos são remunerados no cargo. | Direcionador (não entra na DRE) | Estrutura ADM — Telefonia |
| Quantidade Uniformes | QUANTIDADE DE UNIFORMES REMUNERADOS | Quantos uniformes são remunerados no cargo. | Direcionador (não entra na DRE) | Estrutura ADM — Uniformes |
| Salário Encargos | CALCULO DE SALARIOS MAIS ENCARGOS | Salário do cargo já com encargos — o custo unitário para quem paga, e não o que a pessoa recebe. É parâmetro unitário: multiplicado pela quantidade é que vira despesa. | (−) Custo fixo — parâmetro unitário (não soma) | Estrutura ADM — Encargos e provisões |
| Salário Ordenados | CALCULO DE SALARIOS ORDENADOS | Salário unitário do cargo, sem encargos. Multiplicado por Quantidade Ordenados produz Despesa Ordenados — somar os dois é contar o mesmo salário duas vezes. | (−) Custo fixo — parâmetro unitário (não soma) | Estrutura ADM — Ordenados |
| Vale Transporte | CALCULO DO VALE TRANSPORTE ORDENADO | Vale-transporte do quadro ordenado. Atenção: confirmar se ele já está dentro de Despesa Benefício ou se soma à parte — as duas leituras são plausíveis pelos rótulos, e elas diferem pelo valor inteiro do VT. | (−) Custo fixo — estrutura administrativa | Estrutura ADM — Transporte |
| Valor Benefício | VALOR DO BENEFICIO REMUNERADO | Valor unitário do benefício. Parâmetro: só vira dinheiro multiplicado por Quantidade Benefício. | (−) Custo fixo — parâmetro unitário (não soma) | Estrutura ADM — Benefícios |
| Valor Frota Leve | VALOR DE FROTA LEVE REMUNERADO | Valor unitário de um veículo de frota leve — aluguel ou custo mensal reconhecido. Parâmetro. | (−) Custo fixo — parâmetro unitário (não soma) | Estrutura ADM — Frota leve |
| Valor Telefonia | VALOR DE TELEFONIA REMUNERADA | Valor unitário da linha de telefonia. Parâmetro. | (−) Custo fixo — parâmetro unitário (não soma) | Estrutura ADM — Telefonia |
| Valor Uniformes | VALOR DE UNIFORMES REMUNERADO | Valor unitário do uniforme. Parâmetro. | (−) Custo fixo — parâmetro unitário (não soma) | Estrutura ADM — Uniformes |
| _id | Identificador do registro | Chave técnica do documento no banco. Sem leitura de negócio — serve para rastrear a linha entre cargas. | Cadastral (não entra na DRE) | Cadastro — Chave técnica |
