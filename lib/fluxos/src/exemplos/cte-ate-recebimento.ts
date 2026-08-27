import type { FluxoDeclarado } from "../modelo";

/**
 * "Emissão de CTe até Recebimento" — o primeiro fluxo cadastrado, e **só isso**.
 *
 * Este arquivo é dado. Não há uma função, um `if`, um tipo ou uma coluna neste
 * módulo que exista por causa dele: ele é montado pelas mesmas funções que a
 * tela usa quando alguém cria um fluxo à mão (`importarFluxo`, que por sua vez
 * chama as mesmas validações do `POST /fluxos`). Trocá-lo por outro processo é
 * trocar este arquivo, e nada mais.
 *
 * A prova disso não é este comentário — é `exemplos/nf-ate-pagamento.ts`, um
 * segundo processo de outro domínio, e o teste que monta os dois pelo mesmo
 * caminho e confere que nenhum deles precisou de tabela, rota ou componente
 * próprio.
 *
 * ---------------------------------------------------------------------------
 * Sobre o conteúdo
 * ---------------------------------------------------------------------------
 *
 * As dezesseis etapas são as que foram pedidas, na ordem pedida. Os
 * responsáveis, sistemas, documentos, falhas e gargalos são **exemplos
 * realistas de transporte rodoviário de carga**, escritos para demonstrar o que
 * cada campo guarda — não são o levantamento de processo de nenhuma empresa
 * específica, e quem cadastrar o processo real vai corrigi-los na tela, que é
 * exatamente o que o módulo existe para permitir.
 *
 * As rotas das ações apontam para telas que existem hoje neste produto. Onde
 * não existe tela para a consulta que a etapa pediria, **não há ação** — um
 * botão que leva a 404 é pior do que botão nenhum, e o módulo recusa fingir
 * navegação que não existe.
 */
export const CTE_ATE_RECEBIMENTO: FluxoDeclarado = {
  nome: "Emissão de CTe até Recebimento",
  slug: "cte-ate-recebimento",
  categoria: "Faturamento",
  status: "ATIVO",
  dono: "Faturamento",
  descricao:
    "O caminho completo de uma prestação de transporte: da negociação com o cliente até o dinheiro conciliado no extrato.",
  objetivo:
    "Deixar visível onde a prestação trava entre a emissão do documento fiscal e o recebimento — e onde consultar cada ponto dentro do FreightCheck.",
  etapas: [
    {
      chave: "negociacao",
      nome: "Negociação / contratação",
      tipo: "INICIO",
      ordem: 0,
      area: "Comercial",
      responsavel: "Gerente comercial",
      objetivo: "Fechar preço, prazo e condições da prestação com o cliente.",
      descricao:
        "O cliente pede o transporte e as condições são acordadas: rota, tipo de veículo, prazo de coleta e entrega, tabela de frete e prazo de pagamento.",
      regras:
        "Toda prestação nasce de uma tabela vigente. Frete fora de tabela precisa de aprovação da diretoria comercial antes de virar contratação.",
      chaveMonitoramento: "comercial.contratacao",
      itens: [
        { especie: "SISTEMA", nome: "CRM", descricao: "Onde a proposta e o aceite ficam registrados." },
        { especie: "SISTEMA", nome: "TMS", descricao: "Onde a tabela de frete vigente é consultada." },
        { especie: "RESPONSAVEL", nome: "Comercial", descricao: "Negocia e registra o aceite." },
        { especie: "DOCUMENTO", nome: "Proposta comercial", obrigatorio: true },
        { especie: "DOCUMENTO", nome: "Contrato de prestação", obrigatorio: false, descricao: "Para clientes recorrentes." },
        { especie: "FALHA", nome: "Frete fechado fora de tabela", descricao: "Vira divergência de valor lá na frente, na conferência da fatura." },
        { especie: "FALHA", nome: "Prazo de pagamento não registrado", descricao: "O vencimento é calculado errado na cobrança." },
        { especie: "GARGALO", nome: "Aprovação de exceção comercial", descricao: "Depende da diretoria e costuma parar aqui por dias." },
      ],
      acoes: [
        { titulo: "Ver tabelas vigentes", rota: "/vigencias", descricao: "As vigências de preço que já entraram no acervo.", icone: "CalendarRange" },
      ],
    },
    {
      chave: "cadastro",
      nome: "Cadastro das informações",
      tipo: "PROCESSO",
      ordem: 1,
      area: "Operações",
      responsavel: "Analista de cadastro",
      objetivo: "Deixar cliente, remetente, destinatário e rota cadastrados antes de a viagem existir.",
      descricao:
        "Os dados que o documento fiscal vai exigir são cadastrados uma vez: CNPJ e inscrição estadual das partes, endereços de coleta e entrega, CFOP e natureza da prestação.",
      regras: "CNPJ sem inscrição estadual ativa não pode receber CTe — a SEFAZ rejeita.",
      chaveMonitoramento: "cadastro.partes",
      itens: [
        { especie: "SISTEMA", nome: "ERP", descricao: "O cadastro mestre de clientes e parceiros." },
        { especie: "RESPONSAVEL", nome: "Operações", descricao: "Cadastra e confere as partes." },
        { especie: "DOCUMENTO", nome: "Cartão CNPJ", obrigatorio: true },
        { especie: "FALHA", nome: "Dados incompletos", descricao: "Falta IE, falta CEP, endereço divergente do cadastro da Receita." },
        { especie: "FALHA", nome: "Duplicidade de cadastro", descricao: "O mesmo cliente cadastrado duas vezes, com dois históricos." },
        { especie: "GARGALO", nome: "Atividade manual", descricao: "Digitação a partir de e-mail e PDF, sem integração com a base da Receita." },
      ],
      acoes: [
        { titulo: "Ver unidades cadastradas", rota: "/unidades", descricao: "O cadastro canônico por CNPJ.", icone: "Building2" },
      ],
    },
    {
      chave: "coleta-dados",
      nome: "Coleta dos dados necessários",
      tipo: "PROCESSO",
      ordem: 2,
      area: "Operações",
      responsavel: "Torre de controle",
      objetivo: "Reunir peso, volume, valor da carga e a NF do remetente antes de emitir.",
      descricao:
        "A nota fiscal da mercadoria, o peso aferido e o valor da carga chegam do cliente ou da coleta. Sem eles o CTe não fecha, porque o valor do seguro e a base do ICMS dependem deles.",
      regras: "O valor da carga vem sempre da NF do remetente, nunca de estimativa.",
      chaveMonitoramento: "operacao.coleta_dados",
      itens: [
        { especie: "SISTEMA", nome: "Portal do cliente", descricao: "De onde as NFs de mercadoria são baixadas.", link: "https://exemplo.portal-do-cliente.com.br" },
        { especie: "DOCUMENTO", nome: "NF-e de mercadoria", obrigatorio: true, descricao: "A nota do remetente que o CTe vai referenciar." },
        { especie: "DOCUMENTO", nome: "Ticket de balança", obrigatorio: false },
        { especie: "RESPONSAVEL", nome: "Operações", descricao: "Reúne e confere." },
        { especie: "FALHA", nome: "Documento ausente", descricao: "NF do remetente não chegou até o horário da emissão." },
        { especie: "FALHA", nome: "Peso divergente", descricao: "A balança e a NF discordam, e a base de cálculo fica em disputa." },
        { especie: "GARGALO", nome: "Dependência de outro setor", descricao: "O dado vem do cliente e não temos como acelerá-lo." },
      ],
    },
    {
      chave: "emissao",
      nome: "Emissão do CTe",
      tipo: "DOCUMENTO",
      ordem: 3,
      area: "Faturamento",
      responsavel: "Analista de faturamento",
      sistemaPrincipal: "ERP",
      objetivo: "Gerar o documento fiscal da prestação a partir do que foi contratado e coletado.",
      descricao:
        "O CTe é montado com tomador, remetente, destinatário, as NFs referenciadas, o valor do frete e os impostos. O XML é assinado digitalmente.",
      regras:
        "O tomador do serviço define quem paga e onde a cobrança será apresentada. Errar o tomador obriga a cancelar e reemitir.",
      chaveMonitoramento: "cte.emissao",
      itens: [
        { especie: "SISTEMA", nome: "ERP", descricao: "Monta e assina o XML." },
        { especie: "DOCUMENTO", nome: "XML do CTe", obrigatorio: true },
        { especie: "DOCUMENTO", nome: "Certificado digital A1", obrigatorio: true },
        { especie: "RESPONSAVEL", nome: "Faturamento", descricao: "Emite." },
        { especie: "FALHA", nome: "Tomador errado", descricao: "Obriga cancelamento e reemissão dentro do prazo legal." },
        { especie: "FALHA", nome: "Valor divergente do contratado" },
        { especie: "GARGALO", nome: "Certificado vencido", descricao: "Para a emissão inteira até alguém renovar." },
      ],
      indicadores: [
        { nome: "CTes emitidos no dia", unidade: "documentos", sentido: "NEUTRO", origem: "Contagem de CTes por data de emissão." },
      ],
    },
    {
      chave: "validacao",
      nome: "Validação das regras",
      tipo: "VALIDACAO",
      ordem: 4,
      area: "Faturamento",
      responsavel: "Analista de faturamento",
      objetivo: "Conferir, antes de mandar para a SEFAZ, o que a SEFAZ vai recusar.",
      descricao:
        "Validação de schema, de CFOP, de tributação por UF, das NFs referenciadas e dos dados cadastrais das partes.",
      regras: "Nada é transmitido com erro conhecido — cada rejeição custa uma janela de tempo na fila da SEFAZ.",
      chaveMonitoramento: "cte.validacao",
      itens: [
        { especie: "SISTEMA", nome: "ERP", descricao: "Roda as validações locais." },
        { especie: "FALHA", nome: "Dados incompletos" },
        { especie: "FALHA", nome: "Tributação incorreta por UF" },
        { especie: "GARGALO", nome: "Retrabalho", descricao: "A correção volta ao cadastro e a validação recomeça." },
      ],
    },
    {
      chave: "decisao-validacao",
      nome: "Passou na validação?",
      tipo: "DECISAO",
      ordem: 5,
      area: "Faturamento",
      objetivo: "Separar o que segue para a SEFAZ do que volta para correção.",
      descricao: "Aprovado segue para transmissão. Reprovado volta ao cadastro, é corrigido e revalidado.",
      chaveMonitoramento: "cte.decisao_validacao",
    },
    {
      chave: "sefaz",
      nome: "Autorização SEFAZ",
      tipo: "SISTEMA",
      ordem: 6,
      area: "Faturamento",
      sistemaPrincipal: "SEFAZ",
      objetivo: "Transmitir o CTe e obter — ou não — a autorização de uso.",
      descricao:
        "O XML assinado é transmitido ao ambiente autorizador da UF. A resposta é autorização, rejeição com código, ou denegação.",
      regras:
        "Rejeição é recusa do documento e permite corrigir e retransmitir. Denegação é irreversível e exige nova prestação.",
      chaveMonitoramento: "cte.autorizacao_sefaz",
      itens: [
        { especie: "SISTEMA", nome: "SEFAZ", descricao: "Ambiente autorizador da UF de início da prestação.", link: "https://www.cte.fazenda.gov.br" },
        { especie: "DOCUMENTO", nome: "Protocolo de autorização", obrigatorio: true },
        { especie: "FALHA", nome: "Rejeição por cadastro", descricao: "IE irregular, CNPJ inapto, endereço divergente." },
        { especie: "FALHA", nome: "Rejeição por tributação" },
        { especie: "FALHA", nome: "Ambiente da SEFAZ fora do ar", descricao: "Nada nosso está errado e nada é transmitido." },
        { especie: "GARGALO", nome: "Ausência de integração", descricao: "Sem consulta automática de status, alguém precisa reconsultar à mão." },
      ],
      indicadores: [
        { nome: "% autorizado sem rejeição", unidade: "%", sentido: "MAIOR_MELHOR", origem: "CTes autorizados na primeira transmissão sobre o total transmitido." },
        { nome: "Tempo médio emissão → autorização", unidade: "min", sentido: "MENOR_MELHOR", origem: "Diferença entre o carimbo de emissão e o do protocolo." },
      ],
    },
    {
      chave: "correcao",
      nome: "Correção e retransmissão",
      tipo: "PENDENCIA",
      ordem: 7,
      area: "Faturamento",
      status: "ATENCAO",
      objetivo: "Tratar o que a validação reprovou ou a SEFAZ rejeitou, e voltar à fila.",
      descricao:
        "A causa é identificada pelo código de rejeição, corrigida no cadastro ou no documento, e o CTe volta para a validação.",
      chaveMonitoramento: "cte.correcao",
      itens: [
        { especie: "RESPONSAVEL", nome: "Faturamento" },
        { especie: "RESPONSAVEL", nome: "Operações", descricao: "Quando a causa é cadastral." },
        { especie: "FALHA", nome: "Mesma rejeição repetida", descricao: "Sinal de que a causa raiz está no cadastro e não no documento." },
        { especie: "GARGALO", nome: "Retrabalho", descricao: "Cada volta consome uma janela de faturamento." },
      ],
      indicadores: [
        { nome: "Retransmissões por CTe", unidade: "vezes", sentido: "MENOR_MELHOR", origem: "Média de transmissões até a autorização." },
      ],
    },
    {
      chave: "autorizado",
      nome: "CTe autorizado",
      tipo: "PROCESSO",
      ordem: 8,
      area: "Faturamento",
      objetivo: "Guardar o documento autorizado e distribuí-lo a quem precisa dele.",
      descricao:
        "Com o protocolo em mãos, o XML e o DACTE são arquivados e enviados ao tomador e ao motorista.",
      regras: "O XML autorizado é guardado por cinco anos — é ele, e não o PDF, que tem valor fiscal.",
      chaveMonitoramento: "cte.autorizado",
      itens: [
        { especie: "DOCUMENTO", nome: "XML autorizado", obrigatorio: true },
        { especie: "DOCUMENTO", nome: "DACTE", obrigatorio: true, descricao: "A representação impressa que acompanha a carga." },
        { especie: "GARGALO", nome: "Envio manual ao tomador", descricao: "E-mail a e-mail, sem integração." },
      ],
    },
    {
      chave: "inicio-prestacao",
      nome: "Início da prestação",
      tipo: "PROCESSO",
      ordem: 9,
      area: "Operações",
      responsavel: "Torre de controle",
      objetivo: "Registrar que o veículo saiu e a prestação começou.",
      descricao: "Veículo, motorista e carreta são vinculados à viagem, e a saída é registrada.",
      chaveMonitoramento: "operacao.inicio_prestacao",
      itens: [
        { especie: "SISTEMA", nome: "TMS" },
        { especie: "SISTEMA", nome: "Aplicativo do motorista" },
        { especie: "RESPONSAVEL", nome: "Motorista" },
        { especie: "FALHA", nome: "Veículo trocado sem registro", descricao: "O CTe fica com a placa errada e a viagem não bate com a frota." },
      ],
      acoes: [
        { titulo: "Ver frota", rota: "/frota-360", descricao: "Cavalos e carretas do acervo.", icone: "Truck" },
      ],
    },
    {
      chave: "transporte",
      nome: "Transporte / acompanhamento",
      tipo: "PROCESSO",
      ordem: 10,
      area: "Operações",
      responsavel: "Torre de controle",
      objetivo: "Acompanhar a viagem até a entrega e tratar o que sair do previsto.",
      descricao: "Posição do veículo, ocorrências de rota, atrasos e desvios são acompanhados até a chegada.",
      chaveMonitoramento: "operacao.transporte",
      itens: [
        { especie: "SISTEMA", nome: "Rastreamento" },
        { especie: "FALHA", nome: "Atraso na entrega" },
        { especie: "FALHA", nome: "Avaria ou sinistro" },
        { especie: "GARGALO", nome: "Ocorrência sem registro", descricao: "A informação existe no WhatsApp e não no sistema." },
      ],
      indicadores: [
        { nome: "% de entregas no prazo", unidade: "%", sentido: "MAIOR_MELHOR", origem: "Entregas dentro da janela acordada sobre o total." },
      ],
    },
    {
      chave: "eventos",
      nome: "Eventos do CTe",
      tipo: "SISTEMA",
      ordem: 11,
      area: "Faturamento",
      sistemaPrincipal: "SEFAZ",
      objetivo: "Registrar na SEFAZ o que acontece com o documento depois de autorizado.",
      descricao:
        "Carta de correção, cancelamento, prestação em desacordo e comprovante de entrega são eventos vinculados ao CTe.",
      regras: "Cancelamento tem prazo legal contado da autorização; passado o prazo, só anulação.",
      chaveMonitoramento: "cte.eventos",
      itens: [
        { especie: "SISTEMA", nome: "SEFAZ", link: "https://www.cte.fazenda.gov.br" },
        { especie: "DOCUMENTO", nome: "Carta de correção eletrônica", obrigatorio: false },
        { especie: "FALHA", nome: "Prazo de cancelamento perdido" },
        { especie: "GARGALO", nome: "Ausência de integração", descricao: "Eventos consultados um a um, no portal." },
      ],
    },
    {
      chave: "encerramento",
      nome: "Encerramento da prestação",
      tipo: "PROCESSO",
      ordem: 12,
      area: "Operações",
      objetivo: "Comprovar a entrega e liberar a prestação para faturamento.",
      descricao: "O canhoto assinado ou o POD digital chega, é conferido e anexado à viagem.",
      regras: "Sem comprovante de entrega a prestação não é faturada — é a prova de que o serviço foi prestado.",
      chaveMonitoramento: "operacao.encerramento",
      itens: [
        { especie: "DOCUMENTO", nome: "POD / canhoto assinado", obrigatorio: true },
        { especie: "RESPONSAVEL", nome: "Motorista", descricao: "Coleta a assinatura." },
        { especie: "FALHA", nome: "Documento ausente", descricao: "Canhoto extraviado — a viagem trava antes do faturamento." },
        { especie: "FALHA", nome: "Canhoto ilegível" },
        { especie: "GARGALO", nome: "Canhoto físico em trânsito", descricao: "O papel volta com o motorista, dias depois da entrega." },
      ],
      indicadores: [
        { nome: "% entregas com POD", unidade: "%", sentido: "MAIOR_MELHOR", origem: "Viagens com comprovante anexado sobre as entregues." },
      ],
    },
    {
      chave: "fatura",
      nome: "Emissão de NFS-e / Fatura",
      tipo: "DOCUMENTO",
      ordem: 13,
      area: "Faturamento",
      objetivo: "Transformar as prestações encerradas na cobrança do período.",
      descricao:
        "Os CTes do período do tomador são agrupados numa fatura, e a nota de serviço correspondente é emitida.",
      regras: "Só entram na fatura CTes autorizados, com prestação encerrada e comprovante anexado.",
      chaveMonitoramento: "faturamento.fatura",
      itens: [
        { especie: "SISTEMA", nome: "ERP" },
        { especie: "SISTEMA", nome: "Prefeitura", descricao: "Emissão da NFS-e no município da sede.", link: "https://exemplo.prefeitura.gov.br/nfse" },
        { especie: "DOCUMENTO", nome: "Fatura", obrigatorio: true },
        { especie: "DOCUMENTO", nome: "NFS-e", obrigatorio: false, descricao: "Quando o município exige nota de serviço além do CTe." },
        { especie: "FALHA", nome: "CTe faturado duas vezes" },
        { especie: "FALHA", nome: "Valor divergente do contratado" },
        { especie: "GARGALO", nome: "Fechamento concentrado", descricao: "Todo o volume do mês fatura nos mesmos dois dias." },
      ],
      indicadores: [
        { nome: "Tempo médio entrega → faturamento", unidade: "dias", sentido: "MENOR_MELHOR", origem: "Diferença entre a data de entrega e a de emissão da fatura." },
      ],
      acoes: [
        { titulo: "Ver fechamento", rota: "/fechamento", descricao: "A competência aberta e o que já foi apurado.", icone: "ClipboardCheck" },
      ],
    },
    {
      chave: "cobranca",
      nome: "Envio da cobrança",
      tipo: "PROCESSO",
      ordem: 14,
      area: "Financeiro",
      objetivo: "Colocar a fatura na mão de quem paga, no canal que ele usa.",
      descricao:
        "Boleto emitido e fatura enviada ao tomador — por e-mail, por portal de fornecedor ou por ambos.",
      regras: "Portal de fornecedor tem prazo de submissão próprio; perdê-lo empurra o pagamento um ciclo inteiro.",
      chaveMonitoramento: "financeiro.cobranca",
      itens: [
        { especie: "SISTEMA", nome: "Banco", descricao: "Registro do boleto." },
        { especie: "SISTEMA", nome: "Portal do tomador", descricao: "Onde a fatura é submetida para aprovação." },
        { especie: "DOCUMENTO", nome: "Boleto", obrigatorio: true },
        { especie: "FALHA", nome: "Fatura rejeitada no portal", descricao: "Falta anexo, ordem de compra divergente." },
        { especie: "GARGALO", nome: "Demora de aprovação", descricao: "O tomador aprova em ciclos semanais." },
      ],
    },
    {
      chave: "vencimento",
      nome: "Vencimento",
      tipo: "DECISAO",
      ordem: 15,
      area: "Financeiro",
      objetivo: "Chegada a data, o título foi pago ou virou inadimplência.",
      descricao: "No vencimento, o título é baixado pelo pagamento ou entra na régua de cobrança.",
      chaveMonitoramento: "financeiro.vencimento",
      itens: [
        { especie: "FALHA", nome: "Atraso do tomador" },
        { especie: "GARGALO", nome: "Régua de cobrança manual" },
      ],
      indicadores: [
        { nome: "% de títulos vencidos", unidade: "%", sentido: "MENOR_MELHOR", origem: "Títulos vencidos e não pagos sobre a carteira." },
      ],
    },
    {
      chave: "recebimento",
      nome: "Recebimento",
      tipo: "PROCESSO",
      ordem: 16,
      area: "Financeiro",
      objetivo: "Registrar a entrada do dinheiro e baixar o título.",
      descricao: "O pagamento entra e o título correspondente é baixado no contas a receber.",
      chaveMonitoramento: "financeiro.recebimento",
      itens: [
        { especie: "SISTEMA", nome: "Banco" },
        { especie: "DOCUMENTO", nome: "Comprovante bancário", obrigatorio: true },
        { especie: "FALHA", nome: "Pagamento parcial", descricao: "Entra menos do que a fatura, sem aviso de glosa." },
        { especie: "FALHA", nome: "Pagamento sem identificação do título" },
      ],
      indicadores: [
        { nome: "Prazo médio de recebimento", unidade: "dias", sentido: "MENOR_MELHOR", origem: "Diferença entre emissão da fatura e crédito em conta." },
      ],
    },
    {
      chave: "conciliacao",
      nome: "Conciliação bancária",
      tipo: "FIM",
      ordem: 17,
      area: "Financeiro",
      objetivo: "Casar o que entrou no extrato com o que o contas a receber esperava.",
      descricao:
        "Cada crédito do extrato é casado com o título correspondente. O que não casa vira divergência para tratamento.",
      regras: "Crédito sem título identificado não é baixado — fica em suspensão até alguém apontar a qual fatura pertence.",
      chaveMonitoramento: "financeiro.conciliacao",
      itens: [
        { especie: "SISTEMA", nome: "Banco", descricao: "Extrato e retorno bancário." },
        { especie: "DOCUMENTO", nome: "Extrato bancário", obrigatorio: true },
        { especie: "FALHA", nome: "Valor divergente", descricao: "Desconto, tarifa ou glosa não previstos." },
        { especie: "FALHA", nome: "Duplicidade de baixa" },
        { especie: "GARGALO", nome: "Conciliação manual", descricao: "Casamento linha a linha, em planilha." },
      ],
      acoes: [
        { titulo: "Abrir conciliação", rota: "/fechamento/conciliacao", descricao: "A conciliação da competência aberta.", icone: "Scale" },
      ],
    },
  ],
  conexoes: [
    { de: "negociacao", para: "cadastro" },
    { de: "cadastro", para: "coleta-dados" },
    { de: "coleta-dados", para: "emissao" },
    { de: "emissao", para: "validacao" },
    { de: "validacao", para: "decisao-validacao" },
    { de: "decisao-validacao", para: "sefaz", tipo: "DECISAO_SIM", rotulo: "Aprovado" },
    { de: "decisao-validacao", para: "correcao", tipo: "DECISAO_NAO", rotulo: "Reprovado" },
    { de: "sefaz", para: "autorizado", tipo: "DECISAO_SIM", rotulo: "Autorizado" },
    { de: "sefaz", para: "correcao", tipo: "EXCECAO", rotulo: "Rejeitado pela SEFAZ" },
    { de: "correcao", para: "validacao", tipo: "RETRABALHO", rotulo: "Corrigido, revalidar" },
    { de: "autorizado", para: "inicio-prestacao" },
    { de: "inicio-prestacao", para: "transporte" },
    { de: "transporte", para: "eventos" },
    { de: "eventos", para: "encerramento" },
    { de: "encerramento", para: "fatura" },
    { de: "fatura", para: "cobranca" },
    { de: "cobranca", para: "vencimento" },
    { de: "vencimento", para: "recebimento", tipo: "DECISAO_SIM", rotulo: "Pago" },
    { de: "vencimento", para: "cobranca", tipo: "RETRABALHO", rotulo: "Em atraso — recobrar" },
    { de: "recebimento", para: "conciliacao" },
  ],
};
