import path from "node:path";
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  abrirCompetencia,
  apurarCompetencia,
  buscarCompetencia,
  descartarDadosDaCompetencia,
  excluirCompetencia,
  explicarPainelAusente,
  fraseDoPainelAusente,
  informarTipoDeOperacao,
  lerApuracaoVigente,
  lerConteudoDoDocumento,
  lerDeParaDaCompetencia,
  lerDiaDaCompetencia,
  lerDiarioDaCompetencia,
  associarUnidadeDaCompetencia,
  lerResumoDoMes,
  listarApuracoes,
  listarCompetencias,
  listarDocumentos,
  listarPartes,
  receberDocumento,
  registrarParte,
  reimportarDocumento,
  reabrirCompetencia,
  encerrarCompetencia,
  RecusaDeFechamento,
} from "@workspace/fechamento/persistencia";
import {
  DESCRICAO_DA_FONTE,
  diagnosticarPagamento,
  FORMATOS_DA_FONTE,
  GRUPOS_DA_PLANILHA,
  LINHAS_DA_PLANILHA,
  painelDeUmaQuinzena,
  QUINZENAS_DA_FONTE,
  TIPOS_DE_FONTE,
  type Canal,
  type ColunaDoPagamento,
  type TipoDeFonte,
} from "@workspace/fechamento";

import { cadastroDaRemuneracao } from "../lib/cadastro-da-remuneracao";

/**
 * Fechamento de Remuneração — a superfície HTTP do outro ambiente do produto.
 *
 * A ordem das rotas é a do trabalho: abre-se a competência, enviam-se
 * os documentos que a Ambev exportou, roda-se a apuração, lê-se a conta com as
 * divergências — e, quando o número não convence, desce-se ao dia e à viagem
 * que o produziram. Nada aqui calcula: a aritmética inteira mora em
 * `@workspace/fechamento`, testada sem banco e sem HTTP, e este arquivo só a
 * liga à tela.
 *
 * **Por que o upload é JSON com base64, e não multipart.** É a mesma escolha da
 * importação da Auditoria (`routes/imports.ts`), pela mesma razão: o corpo
 * inteiro é conferido antes de qualquer byte virar arquivo, e a recusa volta
 * com o motivo em português em vez de um erro de parser de formulário.
 *
 * **A diferença em relação à importação da Auditoria** é que lá o tipo do
 * arquivo é deduzível do conteúdo, e aqui não: os relatórios do Promax
 * não se identificam. Um 03.08.15 e um 03.08.18 chegam os dois com cabeçalho na
 * primeira linha — e chegam nos mesmos formatos —, e trocá-los daria uma conta
 * plausível e errada. Por isso `tipo` é obrigatório, sempre — a aba da tela é a
 * declaração.
 *
 * **O que a extensão decide, e o que ela não decide.** Ela é conferida contra a
 * fonte declarada porque é o primeiro sinal de que alguém trocou a aba de
 * envio, e a recusa aqui é muito mais útil do que a mesma recusa três camadas
 * abaixo, falando de cabeçalho. O que ela não faz é escolher o leitor: quem
 * decide se o arquivo é planilha, texto delimitado ou largura fixa é o conteúdo
 * dele (ver `leitores/formato`), porque `.csv` e `.txt` são o mesmo arquivo com
 * dois nomes na mão de quem opera.
 */
const router: IRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/*
 * As extensões que cada fonte admite moram em `@workspace/fechamento`
 * (`FORMATOS_DA_FONTE`), junto do resto do vocabulário das fontes, e não aqui:
 * a lista é uma afirmação sobre o que os leitores conseguem ler, e quem a
 * mantém é quem mexe neles. Esta rota apenas a publica e a aplica.
 */

/**
 * O catálogo das fontes, para a tela saber o que pedir e por quê.
 *
 * Devolve as seis sempre, com `quinzenas` dizendo em qual delas cada uma é
 * esperada — a primeira quinzena tem quatro relatórios, a segunda tem os seis
 * (ver `FONTES_DA_QUINZENA`). O recorte é da tela e não da rota de propósito:
 * a lista de Apurações mostra quinzenas das duas metades na mesma tabela, e
 * filtrar aqui a obrigaria a buscar o catálogo duas vezes para desenhar uma
 * página.
 */
router.get("/fechamento/fontes", (_req, res): void => {
  res.json(
    TIPOS_DE_FONTE.map((tipo) => ({
      tipo,
      ...DESCRICAO_DA_FONTE[tipo],
      extensoes: FORMATOS_DA_FONTE[tipo],
      quinzenas: QUINZENAS_DA_FONTE[tipo],
    })),
  );
});

router.get("/fechamento/competencias", async (_req, res): Promise<void> => {
  res.json(await listarCompetencias(db));
});

/**
 * Todas as competências já somadas — a tela de Apurações.
 *
 * Devolve, por competência, quais relatórios estão vigentes, os
 * totais que a apuração gravou e o quanto continua em discussão. É a mesma
 * informação que `/competencias/:id` traz, sem a memória de cálculo: o que
 * cabe numa linha de lista. Ver `listarApuracoes` para por que a soma acontece
 * aqui e não no navegador.
 */
router.get("/fechamento/apuracoes", async (_req, res): Promise<void> => {
  res.json(await listarApuracoes(db));
});

/**
 * As unidades e transportadoras que o Fechamento conhece, para o campo que se
 * pesquisa.
 *
 * São as cadastradas somadas às que aparecem em alguma competência — ver
 * `listarPartes` para por que as duas fontes e por que elas não brigam. A tela
 * oferece o que existe e deixa digitar o que não existe; o que não existe passa
 * a existir no `POST` abaixo.
 */
router.get("/fechamento/partes", async (_req, res): Promise<void> => {
  res.json(await listarPartes(db));
});

/**
 * Cadastra uma unidade ou transportadora — o que o "Usar" do campo faz.
 *
 * **Por que existe uma rota para isto.** Antes o cadastro era um efeito da
 * abertura: digitava-se `443 — CDD Belém`, abria-se a competência, e o nome
 * passava a existir porque a competência existia. Excluir aquela importação —
 * o desfazer de quem abriu a errada — apagava o nome junto, e o campo voltava a
 * dizer "Nada encontrado" para quem tinha acabado de escrevê-lo. Cadastrar
 * virou um ato próprio, com endereço próprio, e a exclusão da competência
 * voltou a apagar só a competência.
 *
 * `201` sempre, inclusive quando o código já existia: o corpo devolvido é a
 * parte como a lista a mostra, e é isso que a tela seleciona no campo. Recadastrar
 * um código com nome novo é renomear (ver `registrarParte`) — o gesto de quem
 * escreveu `443` e volta para escrever `443 — CDD Belém`.
 */
router.post("/fechamento/partes", async (req, res): Promise<void> => {
  const corpo = req.body as Record<string, unknown>;
  const tipo = corpo?.tipo;
  const codigo = corpo?.codigo;

  if (tipo !== "UNIDADE" && tipo !== "TRANSPORTADORA") {
    res.status(400).json({
      error: "tipo precisa ser UNIDADE ou TRANSPORTADORA — são os dois lados de um fechamento.",
    });
    return;
  }
  if (typeof codigo !== "string" || codigo.trim() === "") {
    res.status(400).json({
      error: "codigo é obrigatório — é por ele que a competência encontra a parte.",
    });
    return;
  }

  const parte = await registrarParte(db, {
    tipo,
    codigo,
    nome: typeof corpo?.nome === "string" ? corpo.nome : null,
  });
  res.status(201).json(parte);
});

/**
 * O mês inteiro — as duas quinzenas lado a lado, com o total.
 *
 * É a leitura que a tela de Resumo faz, e a que responde no formato em que a
 * transportadora discute o número com a Ambev. Os quatro parâmetros são
 * obrigatórios porque a trinca que identifica um fechamento é (unidade,
 * transportadora, período): dois CDDs no mesmo mês são dois resumos, e somá-los
 * por omissão de um filtro seria inventar um terceiro.
 */
router.get("/fechamento/resumo", async (req, res): Promise<void> => {
  const unidade = String(req.query.unidade ?? "").trim();
  const transportadora = String(req.query.transportadora ?? "").trim();
  const tipoDeOperacao = String(req.query.tipoDeOperacao ?? "").trim().toUpperCase();
  const ano = Number(req.query.ano);
  const mes = Number(req.query.mes);

  if (unidade === "" || transportadora === "") {
    res.status(400).json({
      error: "unidade e transportadora são obrigatórias — o resumo é de um fechamento, não de um mês do calendário.",
    });
    return;
  }
  /*
    Desde a `0046` a mesma unidade pode ter EMPURRADA e ROTA na mesma quinzena.
    Sem este recorte as duas cairiam nas mesmas duas colunas do resumo e o mês
    somaria duas operações num total só.
  */
  if (tipoDeOperacao === "") {
    res.status(400).json({
      error:
        "tipoDeOperacao é obrigatório — EMPURRADA e ROTA são fechamentos diferentes na mesma " +
        "quinzena, e somá-los num resumo só misturaria duas operações.",
    });
    return;
  }
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    res.status(400).json({ error: "ano precisa ser um ano entre 2000 e 2100." });
    return;
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    res.status(400).json({ error: "mes precisa ser um número de 1 a 12." });
    return;
  }

  /*
    A porta do cadastro, ligada. Sem ela o resumo cai em `SEM_CADASTRO` e o
    painel da planilha volta a ser uma releitura do 03.08.20 — ver
    `lib/cadastro-da-remuneracao.ts`.
  */
  res.json(
    await lerResumoDoMes(
      db,
      { unidade, transportadora, tipoDeOperacao, ano, mes },
      cadastroDaRemuneracao(db, { tipoDeOperacao }),
    ),
  );
});

/**
 * Abre uma competência — ou devolve a que já existe.
 *
 * Idempotente de propósito: (unidade, transportadora, quinzena) é um
 * fechamento só. Ver `abrirCompetencia`.
 */
router.post("/fechamento/competencias", async (req, res): Promise<void> => {
  const corpo = req.body as Record<string, unknown>;
  const ano = Number(corpo?.ano);
  const mes = Number(corpo?.mes);
  const quinzena = Number(corpo?.quinzena);
  const unidade = corpo?.unidade as
    | { id?: unknown; codigo?: unknown; nome?: unknown }
    | undefined;
  const transportadora = corpo?.transportadora as { codigo?: unknown; nome?: unknown } | undefined;

  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100) {
    res.status(400).json({ error: "ano precisa ser um ano entre 2000 e 2100." });
    return;
  }
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) {
    res.status(400).json({ error: "mes precisa ser um número de 1 a 12." });
    return;
  }
  if (quinzena !== 1 && quinzena !== 2) {
    res.status(400).json({ error: "quinzena precisa ser 1 (dias 1 a 15) ou 2 (dia 16 ao fim do mês)." });
    return;
  }
  /*
    A unidade vem **selecionada** do cadastro mestre, pelo `id`. O `codigo`
    continua aceito para o caminho legado — importação e competências antigas —,
    e é por isso que a exigência é "um dos dois", e não "o id": tirar o texto
    agora quebraria todo chamador que ainda o usa. O que mudou é que o caminho
    do `id` existe e é o que a tela oferece.
  */
  const unidadeId = typeof unidade?.id === "string" ? unidade.id.trim() : "";
  if (unidadeId === "" && (typeof unidade?.codigo !== "string" || unidade.codigo.trim() === "")) {
    res.status(400).json({
      error:
        "Escolha a unidade em Administração → Unidades (unidade.id). O campo de código " +
        "só existe para o caminho legado.",
    });
    return;
  }
  if (typeof transportadora?.codigo !== "string" || transportadora.codigo.trim() === "") {
    res.status(400).json({ error: "transportadora.codigo é obrigatório." });
    return;
  }

  /*
    O tipo de operação é obrigatório desde a `0046`, e a recusa vem do domínio
    (`normalizarTipoDeOperacao` → `TipoDeOperacaoAusente` → 400): a frase que
    explica por que ele importa é do negócio, e escrevê-la de novo aqui daria
    duas versões dela. O que a rota faz é só não engolir o campo ausente.
  */
  const competencia = await abrirCompetencia(db, {
    ano,
    mes,
    quinzena,
    unidadeId: unidadeId === "" ? null : unidadeId,
    unidade: {
      codigo: typeof unidade?.codigo === "string" ? unidade.codigo.trim() : "",
      nome: typeof unidade?.nome === "string" ? unidade.nome.trim() : null,
    },
    transportadora: {
      codigo: transportadora.codigo.trim(),
      nome: typeof transportadora.nome === "string" ? transportadora.nome.trim() : null,
    },
    tipoDeOperacao: typeof corpo?.tipoDeOperacao === "string" ? corpo.tipoDeOperacao : "",
  });
  res.status(201).json(competencia);
});

/** A competência, seus documentos e a apuração vigente — o que a tela precisa. */
router.get("/fechamento/competencias/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const competencia = await buscarCompetencia(db, id);
  if (!competencia) {
    res.status(404).json({ error: "Competência não encontrada." });
    return;
  }
  const [documentos, apuracao] = await Promise.all([
    listarDocumentos(db, id),
    lerApuracaoVigente(db, id),
  ]);
  res.json({ competencia, documentos, apuracao });
});

/**
 * O de-para: o painel da planilha preenchido com o 03.08.20 desta competência.
 *
 * Responde à pergunta que o produto ainda não respondia — "a classificação do
 * sistema conversa com a da planilha?" —, e responde nos rótulos da planilha,
 * não nos nossos: `CUSTO FIXO PADRONIZADO`, `DESCONTO DE DEVOLUÇÃO`, `TOTAL
 * OUTROS CUSTOS`. Cada linha vem com o valor ou com o motivo de não ter, e cada
 * quadro vem com o resíduo, que é o que as linhas sem origem somam.
 *
 * **404 quando não há verba que o sustente**, e não um painel de zeros. É a
 * mesma regra do diário: a fonte ausente é uma resposta, e ela não pode ter a
 * cara de "a quinzena valeu zero". O 404 **diz qual das três ausências é** —
 * o arquivo que nunca chegou, o que chegou e ficou em quarentena, e o que está
 * vigente sem sustentar verba nenhuma (ver `explicarPainelAusente`). Confundi-las
 * numa frase só foi o que fez a tela negar um arquivo que ela mesma listava.
 *
 * `coluna` escolhe contra o que conferir — `semImposto` (o padrão, e a moeda em
 * que os descontos do relatório vêm), `ctrcIcms` (o que vira CT-e) ou
 * `valorFaturado`. `canal` existe pelo mesmo motivo que existe no módulo: o
 * painel transcrito é o da Rota, e o do AS entra quando os rótulos dele forem
 * capturados.
 */
router.get("/fechamento/competencias/:id/de-para", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }

  const colunas: ColunaDoPagamento[] = ["semImposto", "ctrcIcms", "valorFaturado"];
  const pedida = String(req.query.coluna ?? "semImposto");
  if (!colunas.includes(pedida as ColunaDoPagamento)) {
    res.status(400).json({ error: `coluna precisa ser uma de: ${colunas.join(", ")}.` });
    return;
  }
  const canais: Canal[] = ["ROTA", "AS"];
  const canal = String(req.query.canal ?? "ROTA");
  if (!canais.includes(canal as Canal)) {
    res.status(400).json({ error: `canal precisa ser um de: ${canais.join(", ")}.` });
    return;
  }

  const competencia = await buscarCompetencia(db, id);
  if (!competencia) {
    res.status(404).json({ error: "Competência não encontrada." });
    return;
  }

  const painel = await lerDeParaDaCompetencia(db, id, {
    canal: canal as Canal,
    coluna: pedida as ColunaDoPagamento,
  });
  if (!painel) {
    /*
      Sem painel são três situações, e dizer "não foi importado" nas três era
      mentira em duas delas — inclusive na que aparecia na tela: o 03.08.20 com
      o visto verde na lista de relatórios e, um cartão abaixo, a frase de que
      ele não tinha sido importado. Quem responde qual das três é
      `explicarPainelAusente`, que lê o documento em vez de deduzir do vazio.
    */
    res.status(404).json({ error: fraseDoPainelAusente(await explicarPainelAusente(db, id)) });
    return;
  }

  /*
    A tela recebe o painel na mesma forma do resumo mensal — três colunas, com
    só a desta quinzena preenchida. É o que permite às duas telas usarem o mesmo
    componente e, portanto, mostrarem a mesma coisa: uma segunda formatação no
    navegador seria a chance de elas divergirem sem ninguém notar.
  */
  res.json({
    competencia,
    painel: painelDeUmaQuinzena(competencia.quinzena === 1 ? 1 : 2, painel),
  });
});

/**
 * O catálogo do de-para, sem competência nenhuma.
 *
 * A tela precisa saber quais são os dezoito rótulos e o que cada um significa
 * antes de ter números — para desenhar o painel vazio, e para explicar uma
 * ausência sem precisar de um 03.08.20 importado.
 */
router.get("/fechamento/de-para", (_req, res): void => {
  res.json({ linhas: LINHAS_DA_PLANILHA, grupos: GRUPOS_DA_PLANILHA });
});

/**
 * O diário da competência: um item por dia do período, com ou sem operação.
 *
 * É a grade que a tela abre antes de escolher um dia — a mesma que as abas
 * `01`…`31` da planilha `Fechamento_Remuneracao.xlsb` formam, só que sem
 * planilha. O dia sem viagem nenhuma vem na lista com zero, e não some: "não
 * rodou" e "não importamos o 2Art" são coisas diferentes, e a resposta traz
 * `fonte: null` quando é o segundo caso.
 */
router.get("/fechamento/competencias/:id/dias", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const diario = await lerDiarioDaCompetencia(db, id);
  if (!diario) {
    res.status(404).json({ error: "Competência não encontrada." });
    return;
  }
  res.json(diario);
});

/**
 * Um dia aberto: as viagens daquele dia, inteiras, com os totais por frota.
 *
 * O dia vem no caminho em `AAAA-MM-DD` porque é assim que o módulo inteiro
 * escreve data — a tela é que traduz para `dd/mm`. Dia fora da competência
 * responde 404, e não uma lista vazia: lista vazia diria "não rodou nada em
 * 20/08" para uma pergunta sobre uma quinzena que termina em 15/08.
 */
router.get("/fechamento/competencias/:id/dias/:dia", async (req, res): Promise<void> => {
  const { id, dia } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
    res.status(400).json({ error: "O dia precisa vir em AAAA-MM-DD." });
    return;
  }
  const aberto = await lerDiaDaCompetencia(db, id, dia);
  if (!aberto) {
    res.status(404).json({
      error: "Não há esse dia nesta competência — confira se a data está dentro da quinzena.",
    });
    return;
  }
  res.json(aberto);
});

/**
 * Recebe um dos cinco relatórios.
 *
 * O corpo é `{ tipo, filename, contentBase64 }`. As três recusas de formato
 * acontecem antes de o arquivo virar bytes, e cada uma existe porque a
 * alternativa é pior: sem o filtro de base64, `Buffer.from` descarta em
 * silêncio o que não reconhece e entrega um arquivo truncado; sem a conferência
 * de extensão contra o tipo, um 03.08.18 enviado na aba do 03.08.15 só falharia
 * lá dentro do leitor, com uma mensagem sobre cabeçalho que não ajuda ninguém a
 * entender que trocou os arquivos.
 */
router.post("/fechamento/competencias/:id/documentos", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }

  const corpo = req.body as Record<string, unknown>;
  const tipo = typeof corpo?.tipo === "string" ? (corpo.tipo.trim().toUpperCase() as TipoDeFonte) : null;
  if (!tipo || !TIPOS_DE_FONTE.includes(tipo)) {
    res.status(400).json({
      error: `tipo é obrigatório e precisa ser um de: ${TIPOS_DE_FONTE.join(", ")}.`,
    });
    return;
  }

  const filename = typeof corpo?.filename === "string" ? path.basename(corpo.filename.trim()) : "";
  if (filename === "") {
    res.status(400).json({ error: "filename é obrigatório." });
    return;
  }
  const extensao = path.extname(filename).toLowerCase();
  if (!FORMATOS_DA_FONTE[tipo].includes(extensao)) {
    const fonte = DESCRICAO_DA_FONTE[tipo];
    res.status(400).json({
      error:
        `O relatório ${fonte.rotina} (${fonte.nome}) é lido em ${FORMATOS_DA_FONTE[tipo].join(", ")}, ` +
        `e "${filename}" é ${extensao || "sem extensão"}. Confira se não trocou a aba de envio.`,
    });
    return;
  }

  const encoded = typeof corpo?.contentBase64 === "string" ? corpo.contentBase64.trim() : "";
  if (encoded === "") {
    res.status(400).json({ error: "contentBase64 é obrigatório." });
    return;
  }
  if (!/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(encoded)) {
    res.status(400).json({ error: "contentBase64 não está em base64 válido." });
    return;
  }

  try {
    const recebido = await receberDocumento(db, {
      competenciaId: id,
      tipo,
      nomeDoArquivo: filename,
      conteudo: Buffer.from(encoded, "base64"),
    });
    /*
      Quarentena não é 201 nem erro: o arquivo **foi** recebido e guardado, e
      não virou a conta. `202 Accepted` é exatamente isso — aceitamos o envio e
      não o processamos como pedido. Devolver 201 faria a tela dizer "importado"
      sobre o que não conta; devolver 4xx faria parecer que nada ficou guardado,
      quando o arquivo está lá justamente para ser examinado.
    */
    res.status(recebido.desfecho === "PROMOVIDO" ? 201 : 202).json(recebido);
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
        detalhe: erro.detalhe,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Por que este 03.08.20 não virou verba.
 *
 * A pergunta que a lista de relatórios deixava sem resposta: o arquivo está
 * lá, com nome e linhas lidas, e o painel da planilha não tem de onde sair. O
 * diagnóstico lê **os bytes guardados na importação** (`0047`) e diz onde a
 * leitura parou — cabeçalho não reconhecido, seção ausente, linha de verba com
 * o número errado de colunas — apontando a linha física.
 *
 * **Serve só ao 03.08.20.** As outras cinco fontes não têm a mesma pergunta:
 * elas não abrem parcela fixa nenhuma, e o que elas recusam já está em
 * `fechamento_documento.recusas`, nominalmente, desde a importação.
 *
 * `409` quando o documento é anterior à `0047` e os bytes não existem — e é
 * diferente de `404`: o documento existe, o que falta é a evidência.
 */
router.get("/fechamento/documentos/:id/diagnostico", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de documento inválido." });
    return;
  }

  const guardado = await lerConteudoDoDocumento(db, id);
  if (!guardado) {
    res.status(409).json({
      error:
        "Este documento não tem o arquivo guardado — importações anteriores à migration " +
        "0047 não o guardavam. Reenvie o relatório para que ele possa ser examinado.",
    });
    return;
  }
  if (guardado.tipo !== "PAGAMENTO") {
    const fonte = DESCRICAO_DA_FONTE[guardado.tipo];
    res.status(400).json({
      error:
        `O diagnóstico de verba é do ${DESCRICAO_DA_FONTE.PAGAMENTO.rotina}, e este ` +
        `documento é o ${fonte.rotina} (${fonte.nome}). O que o leitor dele recusou está ` +
        `na própria importação, linha a linha.`,
    });
    return;
  }

  res.json({
    documento: { id, nomeDoArquivo: guardado.nomeDoArquivo },
    diagnostico: diagnosticarPagamento(guardado.conteudo),
  });
});

/**
 * Reimporta um documento a partir do arquivo que a importação guardou.
 *
 * **A porta que faltava.** As linhas de uma fonte são derivadas do arquivo, e
 * quando as duas discordam — o 03.08.20 com dez verbas dentro e o banco sem
 * nenhuma — quem está errado é a derivação. Até aqui não havia como pedir que
 * ela fosse refeita: a tela mandava substituir o arquivo, o índice
 * `(competência, sha256)` recusava o reenvio do mesmo, e sobrava descartar a
 * competência inteira — seis fontes fora por causa de uma.
 *
 * **`POST` e não `PUT`** porque não se está pondo um recurso no lugar de outro
 * — nada entra e nada sai: é o mesmo documento, com o mesmo id, relido. O corpo
 * é vazio de propósito: o arquivo já está no banco, e aceitar um aqui seria uma
 * segunda porta de importação, com as regras da primeira por perto.
 *
 * `200` quando voltou a valer e `202` quando a releitura o mandou para a
 * quarentena — a mesma distinção do envio, e pela mesma razão: reimportar não
 * perdoa o arquivo, refaz a leitura dele.
 */
router.post("/fechamento/documentos/:id/reimportar", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de documento inválido." });
    return;
  }

  try {
    const refeito = await reimportarDocumento(db, id);
    res.status(refeito.desfecho === "PROMOVIDO" ? 200 : 202).json(refeito);
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      const ausente =
        erro.codigo === "DOCUMENTO_NAO_ENCONTRADO" || erro.codigo === "COMPETENCIA_NAO_ENCONTRADA";
      res.status(ausente ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
        detalhe: erro.detalhe,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Descarta o que foi importado para a competência.
 *
 * `DELETE` e não um `POST /descarte` porque é exatamente o que o verbo diz, e
 * porque o que sobra depois dele — a competência vazia — não é um recurso novo
 * que mereça um endereço próprio.
 *
 * **O caminho é `/dados` e não `/documentos`** porque o que sai é mais do que
 * os arquivos: saem as linhas que eles produziram e as apurações que saíram
 * delas. Prometer "documentos" e apagar a conta junto seria a rota mentir sobre
 * o próprio alcance.
 *
 * A resposta devolve o que foi apagado, contado por fonte. Um `204` seria mais
 * curto e diria menos: quem acabou de descartar uma quinzena inteira precisa
 * ver o tamanho do que descartou, ainda mais quando descartou por engano.
 */
router.delete("/fechamento/competencias/:id/dados", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    res.json(await descartarDadosDaCompetencia(db, id));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Roda a apuração.
 *
 * É um POST e não um GET porque grava: a apuração vigente anterior é
 * despromovida e uma nova entra no lugar. Ver `fechamento_apuracao` — o
 * histórico é o que responde "o que mudou desde que eu aprovei".
 */
router.post("/fechamento/competencias/:id/apuracao", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    await apurarCompetencia(db, id);
    res.json(await lerApuracaoVigente(db, id));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Encerra a competência: o ato de dizer "esta quinzena está fechada".
 *
 * É `POST` e não `PUT` porque não é a edição de um campo — é um ato com
 * consequência: a partir dele o gatilho do banco recusa qualquer escrita nas
 * tabelas da competência.
 */
router.post("/fechamento/competencias/:id/encerramento", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    res.json(await encerrarCompetencia(db, id, req.user?.id ?? null));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Reabre uma competência encerrada — com motivo, sempre.
 *
 * O motivo é recusado vazio aqui e de novo no repositório. A dupla conferência
 * é deliberada: a rota é a porta que a tela usa, e o repositório é a regra —
 * um script que chame a função direto não deve conseguir reabrir sem dizer por
 * quê.
 */
router.post("/fechamento/competencias/:id/reabertura", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const motivo = typeof (req.body as Record<string, unknown>)?.motivo === "string"
    ? ((req.body as Record<string, unknown>).motivo as string).trim()
    : "";
  if (motivo === "") {
    res.status(400).json({
      error:
        "Escreva o motivo da reabertura: ele é o que distingue uma correção de " +
        "uma alteração silenciosa depois do fato.",
      codigo: "MOTIVO_OBRIGATORIO",
    });
    return;
  }
  try {
    res.json(await reabrirCompetencia(db, id, { motivo, por: req.user?.id ?? null }));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Informa — ou corrige — o tipo de operação de uma competência.
 *
 * É `PUT` e não `POST`, ao contrário do encerramento e da reabertura, e a
 * diferença é exatamente a que o comentário daqueles declara: eles são atos com
 * consequência no banco, este **é** a edição de um campo. Idempotente pelo
 * mesmo motivo — mandar de novo o tipo que já está lá devolve a competência
 * como está.
 *
 * A regra de quem pode trocar o quê mora no domínio (`informarTipoDeOperacao`),
 * junto da frase que a explica. Aqui ficam só as três traduções: o identificador
 * malformado, a competência que não existe (404) e as duas recusas que são
 * conflito de estado (409) — a encerrada com tipo declarado e o tipo já ocupado
 * por outro fechamento da mesma quinzena. O tipo ausente vira 400 pelo caminho
 * de sempre, `TipoDeOperacaoAusente` em `recusa-de-dominio.ts`.
 */
router.put("/fechamento/competencias/:id/tipo-de-operacao", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const corpo = req.body as Record<string, unknown>;
  try {
    res.json(
      await informarTipoDeOperacao(db, id, {
        tipoDeOperacao: typeof corpo?.tipoDeOperacao === "string" ? corpo.tipoDeOperacao : "",
      }),
    );
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
        detalhe: erro.detalhe,
      });
      return;
    }
    throw erro;
  }
});

/**
 * Exclui a competência inteira — a importação deixa de existir.
 *
 * É `DELETE` no recurso, e não `DELETE .../dados`: aquele esvazia a quinzena e
 * a mantém na lista; este apaga a linha. A distinção mora na URL porque os dois
 * atos se parecem no clique e não se parecem no resultado, e quem chama a API
 * de fora precisa poder dizer qual dos dois quis.
 *
 * A encerrada é recusada com 409 — a mesma regra do envio e do descarte, e a
 * mesma saída: reabrir, com motivo.
 */
/**
 * Associa uma competência à unidade canônica — o conserto sem exclusão.
 *
 * **A rota que faltava.** Havia como corrigir o tipo de operação de uma
 * competência (`PUT …/tipo-de-operacao`) e como excluí-la; não havia como
 * corrigir a identidade da unidade. Quem abriu a competência com um nome no
 * lugar do código — o que o formulário de campo único permitia — só tinha a
 * exclusão, e com ela perdia os documentos, os itens, as viagens e os bytes
 * guardados de cada arquivo.
 *
 * Grava uma coluna: `unidade_id`. `unidade_codigo` fica onde está, nenhum dado
 * importado é lido, nenhum byte é tocado. Ver `associarUnidadeDaCompetencia`.
 */
router.put("/fechamento/competencias/:id/unidade", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const unidadeId = typeof corpo.unidadeId === "string" ? corpo.unidadeId.trim() : "";
  if (!UUID.test(unidadeId)) {
    res.status(400).json({
      error:
        "unidadeId é obrigatório e é o identificador de uma unidade cadastrada em " +
        "Administração → Unidades — não o código, não o nome, não o CNPJ.",
    });
    return;
  }

  try {
    res.json(await associarUnidadeDaCompetencia(db, id, unidadeId));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

router.delete("/fechamento/competencias/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!UUID.test(id)) {
    res.status(400).json({ error: "Identificador de competência inválido." });
    return;
  }
  try {
    res.json(await excluirCompetencia(db, id));
  } catch (erro) {
    if (erro instanceof RecusaDeFechamento) {
      res.status(erro.codigo === "COMPETENCIA_NAO_ENCONTRADA" ? 404 : 409).json({
        error: erro.message,
        codigo: erro.codigo,
      });
      return;
    }
    throw erro;
  }
});

export default router;
