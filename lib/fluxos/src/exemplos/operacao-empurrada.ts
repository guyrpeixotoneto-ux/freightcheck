import type { FluxoDeclarado } from "../modelo";

/**
 * "Operação Empurrada — do faturamento ao recebimento", o macrofluxo levantado
 * na reunião, cadastrado como dado.
 *
 * Este arquivo é o **mesmo tipo de coisa** que `cte-ate-recebimento.ts`: um
 * objeto literal. Nenhuma função, coluna ou componente deste módulo existe por
 * causa dele — ele entra por `importarFluxo`, as mesmas validações do
 * `POST /fluxos`, e sai na tela pelo mesmo canvas. É a resposta em código para
 * "dá para montar esse fluxograma inteiro aqui dentro?": dá, e sem tocar no
 * motor.
 *
 * ---------------------------------------------------------------------------
 * O que veio do desenho, e o que não veio
 * ---------------------------------------------------------------------------
 *
 * As treze etapas numeradas, os sistemas/bases, as áreas, o fluxo detalhado e
 * as saídas são transcrição do quadro levantado — inclusive os pontos marcados
 * como **A VALIDAR**, que ficam escritos em `informacoes` com esse nome em vez
 * de virarem afirmação. Um mapa que apaga a própria incerteza é pior do que
 * mapa nenhum, porque ninguém volta para conferir o que parece resolvido.
 *
 * A etapa 5 do quadro ("integrações pós-emissão, em paralelo") vira **três**
 * etapas aqui: o passo em si e os dois ramos, Rodopar e Connect, que nascem
 * dele ao mesmo tempo e voltam a se juntar na auditoria fiscal. O desenho
 * original mostra a bifurcação dentro de um cartão; no canvas, dois cartões
 * paralelos são o que torna o paralelismo consultável — cada ramo passa a ter
 * responsável, falha e gargalo próprios, que é a pergunta que o quadro deixou
 * em aberto.
 *
 * As falhas e os gargalos anotados são os que o próprio quadro nomeia
 * ("conferência manual em situações relevantes", "predominantemente automática,
 * com exceções manuais", "escopo a validar"). Nada além disso foi inventado: os
 * princípios do processo dizem para mapear antes de resolver, e um mapa com
 * falha imaginada é o começo do resolver antes de mapear.
 */
export const OPERACAO_EMPURRADA: FluxoDeclarado = {
  nome: "Operação Empurrada — do faturamento ao recebimento",
  slug: "operacao-empurrada-faturamento-recebimento",
  categoria: "Faturamento",
  status: "RASCUNHO",
  dono: "Operação",
  descricao:
    "O macrofluxo de ponta a ponta da operação empurrada: da origem da tarifa no Freitec/TMS até a conciliação bancária.",
  objetivo:
    "Criar a visão de balanço de massa do processo — acompanhar o que deveria ser faturado, o que foi emitido, lançado, pago, recebido e conciliado — e deixar visível o que é manual e o que é sistêmico em cada etapa.",
  etapas: [
    {
      chave: "origem-tarifa",
      nome: "Origem da tarifa e das informações do trecho",
      tipo: "INICIO",
      ordem: 0,
      area: "Operação / Faturamento",
      sistemaPrincipal: "Freitec / TMS (Promax)",
      objetivo: "Definir trecho, tarifa/valor e parâmetros que deveriam originar o faturamento.",
      descricao:
        "O trecho e a tarifa nascem aqui, com os parâmetros que o faturamento vai usar depois. É a base do balanço de massa: o que deveria ser faturado começa a existir nesta etapa.",
      informacoes:
        "Saída: informação do trecho e parâmetros validados no Freitec/TMS.\nA VALIDAR: quais tabelas e regras exatamente originam a tarifa, e quem é o responsável nomeado.",
      chaveMonitoramento: "empurrada.origem_tarifa",
      itens: [
        { especie: "SISTEMA", nome: "Freitec / TMS (Promax)", descricao: "Onde o trecho e a tarifa são definidos." },
        { especie: "RESPONSAVEL", nome: "Operação", descricao: "Define trecho e parâmetros." },
        { especie: "RESPONSAVEL", nome: "Faturamento", descricao: "Confere o que vai originar a cobrança." },
      ],
    },
    {
      chave: "validacao-tarifa",
      nome: "Validação da tarifa e processamento no SAP",
      tipo: "VALIDACAO",
      ordem: 1,
      area: "Ambev / Operação",
      sistemaPrincipal: "SAP",
      objetivo: "Confirmar tarifa, parâmetros e a regra de frete mínimo antes de qualquer emissão.",
      descricao:
        "O SAP processa trecho a trecho contra a tabela de frete mínimo. Em situações relevantes há conferência manual.",
      regras: "A tarifa segue para emissão só depois de confrontada com a tabela de frete mínimo.",
      informacoes:
        "Saída: tarifa validada e apta a seguir para emissão.\nA VALIDAR: em quais situações a conferência manual é obrigatória, e quem a executa.",
      chaveMonitoramento: "empurrada.validacao_tarifa",
      itens: [
        { especie: "SISTEMA", nome: "SAP", descricao: "Processamento trecho a trecho e tabela de frete mínimo." },
        { especie: "RESPONSAVEL", nome: "Ambev", descricao: "Processa e valida a tarifa." },
        { especie: "RESPONSAVEL", nome: "Operação", descricao: "Confere as situações relevantes." },
        { especie: "GARGALO", nome: "Conferência manual em situações relevantes", descricao: "Anotado no levantamento; o critério do que é \"relevante\" ainda não está escrito." },
      ],
    },
    {
      chave: "solicitacao-emissao",
      nome: "Solicitação de emissão — SAP → Unidox",
      tipo: "SISTEMA",
      ordem: 2,
      area: "Ambev / Operação",
      sistemaPrincipal: "SAP → Unidox",
      objetivo: "Registrar no Unidox o pedido de emissão do documento.",
      descricao:
        "O envio é predominantemente automático, com exceções tratadas manualmente.",
      informacoes:
        "Saída: solicitação registrada no Unidox.\nA VALIDAR: quais são as exceções manuais e com que frequência acontecem.",
      chaveMonitoramento: "empurrada.solicitacao_emissao",
      itens: [
        { especie: "SISTEMA", nome: "SAP", descricao: "Origem da solicitação." },
        { especie: "SISTEMA", nome: "Unidox", descricao: "Destino da solicitação." },
        { especie: "RESPONSAVEL", nome: "Ambev / Operação" },
        { especie: "GARGALO", nome: "Exceções manuais de solicitação", descricao: "O caminho automático tem desvios que dependem de alguém lembrar." },
      ],
    },
    {
      chave: "emissao-documento",
      nome: "Emissão do documento (no Unidox)",
      tipo: "DOCUMENTO",
      ordem: 3,
      area: "Ambev / Sistema",
      sistemaPrincipal: "Unidox",
      objetivo: "Gerar o CT-e/documento fiscal e associar XML e eventos.",
      descricao:
        "O documento é emitido no Unidox; exceções manuais são tratadas aqui, e o XML e os eventos ficam associados ao documento.",
      informacoes:
        "Saída: CT-e/documento emitido e XML/eventos associados.\nA partir daqui as integrações com Rodopar e Connect acontecem em paralelo.",
      chaveMonitoramento: "empurrada.emissao_documento",
      itens: [
        { especie: "SISTEMA", nome: "Unidox", descricao: "Onde o documento é gerado." },
        { especie: "DOCUMENTO", nome: "CT-e / documento fiscal", obrigatorio: true },
        { especie: "DOCUMENTO", nome: "XML e eventos", obrigatorio: true },
        { especie: "RESPONSAVEL", nome: "Ambev / Sistema" },
        { especie: "GARGALO", nome: "Tratamento de exceções manuais", descricao: "Anotado no levantamento." },
      ],
    },
    {
      chave: "integracoes",
      nome: "Integrações pós-emissão",
      tipo: "SISTEMA",
      ordem: 4,
      area: "Sistemas / TI",
      sistemaPrincipal: "Unidox → Rodopar e Connect",
      objetivo: "Levar o documento emitido para os sistemas internos e os de pagamento.",
      descricao:
        "Depois da emissão, duas integrações partem ao mesmo tempo: Rodopar e Connect. Elas são independentes entre si e ambas precisam ter acontecido para a auditoria fiscal fechar.",
      informacoes:
        "Saída: documento disponibilizado nos sistemas internos e de pagamento.\nA VALIDAR: prazos de cada integração e o que acontece quando uma delas falha.",
      chaveMonitoramento: "empurrada.integracoes",
      itens: [
        { especie: "SISTEMA", nome: "Unidox" },
        { especie: "RESPONSAVEL", nome: "Sistemas / TI" },
      ],
    },
    {
      chave: "integracao-rodopar",
      nome: "Integração com Rodopar",
      tipo: "SISTEMA",
      ordem: 5,
      area: "Sistemas / TI",
      sistemaPrincipal: "Rodopar",
      objetivo: "Disponibilizar o documento no sistema interno.",
      descricao: "Ramo paralelo da etapa de integrações — o que alimenta auditoria, pendências e baixa.",
      informacoes: "Saída: documento disponível no Rodopar.",
      chaveMonitoramento: "empurrada.integracao_rodopar",
      itens: [
        { especie: "SISTEMA", nome: "Rodopar" },
        { especie: "RESPONSAVEL", nome: "Sistemas / TI" },
        { especie: "FALHA", nome: "Documento não integrado", descricao: "O documento existe no Unidox e não aparece no Rodopar — vira pendência lá na frente." },
      ],
    },
    {
      chave: "integracao-connect",
      nome: "Integração com Connect",
      tipo: "SISTEMA",
      ordem: 6,
      area: "Sistemas / TI",
      sistemaPrincipal: "Connect",
      objetivo: "Disponibilizar o documento no sistema de pagamento.",
      descricao: "Ramo paralelo da etapa de integrações — é por ele que o status de pagamento passa a existir.",
      informacoes: "Saída: documento disponível no Connect.",
      chaveMonitoramento: "empurrada.integracao_connect",
      itens: [
        { especie: "SISTEMA", nome: "Connect" },
        { especie: "RESPONSAVEL", nome: "Sistemas / TI" },
        { especie: "FALHA", nome: "Documento não integrado", descricao: "Sem o documento no Connect não há status de pagamento para acompanhar." },
      ],
    },
    {
      chave: "auditoria-fiscal",
      nome: "Auditoria fiscal",
      tipo: "VALIDACAO",
      ordem: 7,
      area: "Fiscal",
      sistemaPrincipal: "Rodopar × Unidox × SEFAZ / Prefeitura",
      objetivo: "Validar existência, status, eventos, sequência e impostos do documento.",
      descricao:
        "O documento é confrontado entre Rodopar, Unidox e o órgão fiscal: ele existe, está autorizado, os eventos estão associados, a sequência não tem buraco e os impostos batem.",
      informacoes:
        "Saída: documento fiscal validado para cobrança/pagamento.\nPrincípio do processo: distinguir processo, falha e gargalo — nem toda incidência de imposto ou regra é uma etapa do fluxo.",
      chaveMonitoramento: "empurrada.auditoria_fiscal",
      itens: [
        { especie: "SISTEMA", nome: "Rodopar" },
        { especie: "SISTEMA", nome: "Unidox" },
        { especie: "SISTEMA", nome: "SEFAZ / Prefeitura", descricao: "A autoridade externa consultada." },
        { especie: "RESPONSAVEL", nome: "Fiscal" },
        { especie: "FALHA", nome: "Quebra de sequência", descricao: "Numeração com buraco entre documentos emitidos." },
      ],
    },
    {
      chave: "status-pagamento",
      nome: "Status de pagamento",
      tipo: "PROCESSO",
      ordem: 8,
      area: "Contas a receber / Operação",
      sistemaPrincipal: "Connect + relatórios Ambev",
      objetivo: "Acompanhar lançado, análise, bloqueio, pagamento e compensação.",
      descricao:
        "O documento passa a ter estado do lado do pagador, e é esse estado que diz se ele caminha ou está parado.",
      informacoes: "Saída: status atualizado de pagamento.",
      chaveMonitoramento: "empurrada.status_pagamento",
      itens: [
        { especie: "SISTEMA", nome: "Connect" },
        { especie: "SISTEMA", nome: "Relatórios Ambev" },
        { especie: "RESPONSAVEL", nome: "Contas a receber" },
        { especie: "RESPONSAVEL", nome: "Operação" },
        { especie: "FALHA", nome: "Documento bloqueado sem tratativa", descricao: "O status existe e ninguém o trabalha." },
      ],
    },
    {
      chave: "encontro-de-contas",
      nome: "Encontro de contas / pendências",
      tipo: "PROCESSO",
      ordem: 9,
      area: "Operação / Contas a receber",
      sistemaPrincipal: "Connect + relatório + e-mail + chamados",
      objetivo: "Identificar descontos e documentos utilizados no encontro de contas.",
      descricao:
        "O que foi descontado e contra quais documentos — a etapa que explica a diferença entre o valor devido e o valor creditado.",
      informacoes:
        "Saída: relação de descontos e documentos utilizados.\nA VALIDAR: por qual canal cada desconto chega (relatório, e-mail ou chamado) e onde essa relação fica guardada.",
      chaveMonitoramento: "empurrada.encontro_de_contas",
      itens: [
        { especie: "SISTEMA", nome: "Connect" },
        { especie: "DOCUMENTO", nome: "Relatório de descontos", obrigatorio: false },
        { especie: "RESPONSAVEL", nome: "Operação" },
        { especie: "RESPONSAVEL", nome: "Contas a receber" },
        { especie: "GARGALO", nome: "Informação chega por e-mail e chamado", descricao: "Fora de sistema, o desconto depende de alguém achar a mensagem." },
      ],
    },
    {
      chave: "pendencias",
      nome: "Pendências",
      tipo: "PENDENCIA",
      ordem: 10,
      area: "Operação / Contas a receber",
      sistemaPrincipal: "Rodopar + automação/relatório Ambev",
      status: "ATENCAO",
      objetivo: "Localizar documentos lançados, não lançados e não pagos.",
      descricao:
        "A lista do que não caminhou: o que foi emitido e não foi lançado, o que foi lançado e não foi pago. É o outro lado do balanço de massa.",
      informacoes:
        "Saída: lista de pendências pendentes de solução.\nPrincípio do processo: separar problemas sob controle da empresa daqueles que dependem de Ambev, sistemas externos ou órgãos fiscais.",
      chaveMonitoramento: "empurrada.pendencias",
      itens: [
        { especie: "SISTEMA", nome: "Rodopar" },
        { especie: "SISTEMA", nome: "Automação / relatório Ambev" },
        { especie: "RESPONSAVEL", nome: "Operação" },
        { especie: "RESPONSAVEL", nome: "Contas a receber" },
        { especie: "FALHA", nome: "Documento emitido e não lançado" },
        { especie: "FALHA", nome: "Documento lançado e não pago" },
      ],
    },
    {
      chave: "fechamento",
      nome: "Fechamento / classificação",
      tipo: "PROCESSO",
      ordem: 11,
      area: "Operação",
      sistemaPrincipal: "Planilha + bases de faturamento",
      status: "ATENCAO",
      objetivo: "Consolidar o que foi emitido e ajustar as classificações.",
      descricao:
        "A consolidação do período junta as bases de faturamento e corrige a classificação do que foi emitido.",
      informacoes:
        "Saída: base consolidada e classificações ajustadas.\nA VALIDAR: o escopo desta etapa — o quadro registra \"escopo a validar\" e a planilha é hoje o meio.",
      chaveMonitoramento: "empurrada.fechamento",
      itens: [
        { especie: "SISTEMA", nome: "Planilha", descricao: "O meio atual da consolidação." },
        { especie: "SISTEMA", nome: "Bases de faturamento" },
        { especie: "RESPONSAVEL", nome: "Operação" },
        { especie: "GARGALO", nome: "Consolidação em planilha", descricao: "Fora de sistema: sem histórico, sem trilha e dependente de quem monta." },
      ],
    },
    {
      chave: "provisao",
      nome: "Provisão de recebimento",
      tipo: "PROCESSO",
      ordem: 12,
      area: "Contas a receber / Financeiro",
      sistemaPrincipal: "Automação / relatório Ambev",
      objetivo: "Informar o valor esperado antes do crédito.",
      descricao: "O valor que se espera receber é registrado antes de o dinheiro entrar — é o que permite comparar esperado e recebido.",
      informacoes: "Saída: provisão de recebimento registrada.",
      chaveMonitoramento: "empurrada.provisao",
      itens: [
        { especie: "SISTEMA", nome: "Automação / relatório Ambev" },
        { especie: "RESPONSAVEL", nome: "Contas a receber" },
        { especie: "RESPONSAVEL", nome: "Financeiro" },
      ],
    },
    {
      chave: "credito-baixa",
      nome: "Crédito e baixa",
      tipo: "PROCESSO",
      ordem: 13,
      area: "Financeiro / Contas a receber",
      sistemaPrincipal: "Banco + Rodopar",
      objetivo: "Confirmar o crédito bancário e baixar os documentos no Rodopar.",
      descricao: "O crédito é identificado no banco e os documentos correspondentes são baixados.",
      informacoes: "Saída: documentos baixados após o crédito.",
      chaveMonitoramento: "empurrada.credito_baixa",
      itens: [
        { especie: "SISTEMA", nome: "Banco" },
        { especie: "SISTEMA", nome: "Rodopar" },
        { especie: "DOCUMENTO", nome: "Extrato bancário", obrigatorio: true },
        { especie: "RESPONSAVEL", nome: "Financeiro" },
        { especie: "RESPONSAVEL", nome: "Contas a receber" },
        { especie: "FALHA", nome: "Crédito recebido e documento não baixado", descricao: "A pendência continua aberta mesmo com o dinheiro na conta." },
      ],
    },
    {
      chave: "conciliacao",
      nome: "Conciliação bancária",
      tipo: "FIM",
      ordem: 14,
      area: "Contas a receber / Financeiro",
      sistemaPrincipal: "Ambev × Rodopar × extrato bancário",
      objetivo: "Garantir que valor, documentos e banco estejam reconciliados.",
      descricao:
        "O fecho do processo: o que a Ambev pagou, o que o Rodopar mostra baixado e o que o extrato registra precisam contar a mesma história.",
      regras:
        "Princípio do processo: antes de acelerar a baixa ou a conciliação, garantir que o valor devido esteja correto.",
      informacoes: "Saída: conciliação concluída e reconciliada.",
      chaveMonitoramento: "empurrada.conciliacao",
      itens: [
        { especie: "SISTEMA", nome: "Rodopar" },
        { especie: "SISTEMA", nome: "Extrato bancário" },
        { especie: "RESPONSAVEL", nome: "Contas a receber" },
        { especie: "RESPONSAVEL", nome: "Financeiro" },
      ],
    },
  ],
  conexoes: [
    { de: "origem-tarifa", para: "validacao-tarifa" },
    { de: "validacao-tarifa", para: "solicitacao-emissao" },
    { de: "solicitacao-emissao", para: "emissao-documento" },
    { de: "emissao-documento", para: "integracoes" },
    { de: "integracoes", para: "integracao-rodopar", rotulo: "em paralelo" },
    { de: "integracoes", para: "integracao-connect", rotulo: "em paralelo" },
    { de: "integracao-rodopar", para: "auditoria-fiscal" },
    { de: "integracao-connect", para: "auditoria-fiscal" },
    { de: "auditoria-fiscal", para: "status-pagamento" },
    { de: "status-pagamento", para: "encontro-de-contas" },
    { de: "encontro-de-contas", para: "pendencias" },
    { de: "pendencias", para: "fechamento" },
    { de: "fechamento", para: "provisao" },
    { de: "provisao", para: "credito-baixa" },
    { de: "credito-baixa", para: "conciliacao" },
    /*
      A volta do quadro: as pendências identificadas no acompanhamento de
      pagamento e no encontro de contas voltam para a validação da tarifa
      quando a divergência é de valor. É a única seta de retrabalho do
      levantamento, e ela é o que faz este mapa não ser uma lista.
    */
    {
      de: "pendencias",
      para: "validacao-tarifa",
      tipo: "RETRABALHO",
      rotulo: "divergência de valor",
    },
  ],
};
