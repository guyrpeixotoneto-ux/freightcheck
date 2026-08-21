import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import type { RequestedContext } from "@workspace/comparison";
import { ehMimeDeImagem, lerPlanilhaDaImagem } from "@workspace/assistant";
import { hashScopeSet } from "@workspace/ingest";
import {
  BLOCOS_DO_CADASTRO,
  conferirCelula,
  copiarPlanilhaDaUnidade,
  descritorDeEscopo,
  gravarPlanilhaDaUnidade,
  identificadorDaUnidade,
  informarCodigoDaUnidade,
  lerCadastroDaUnidade,
  lerComparacaoDeCadastros,
  lerPlanilhaDaUnidade,
  lerSituacaoDasUnidades,
  listarUnidades,
  normalizarCodigo,
  registrarUnidade,
  unidadesRegistradasDoEscopo,
  LinhaDaPlanilhaInvalida,
  PlanilhaVazia,
  UnidadeInvalida,
  UnidadeNaoRegistrada,
} from "@workspace/remuneracao";

/**
 * Remuneração — o cadastro da planilha, por unidade.
 *
 * Cinco endereços, e cada um é uma pergunta inteira:
 *
 * - `/remuneracao/unidades` — quem tem cadastro a mostrar. É a mesma lista de
 *   `/contexts`, e existe separada porque o módulo pergunta pela **unidade**,
 *   não pelo contexto de comparação: quem abre a tela escolhe "CAMAÇARI ·
 *   EMPURRADA", e a palavra "contexto" é vocabulário do motor, não de quem
 *   opera.
 * - `/remuneracao/situacao` — as mesmas unidades, **uma linha por vigência de
 *   cada uma**, com o que o cadastro daquela quinzena alcança. É a tela que vem
 *   antes do cadastro, e é rota separada de `/unidades` de propósito: aquela é
 *   o seletor e tem de ser barata, esta monta o cadastro de todas as vigências
 *   de todas as unidades e custa o que custa. Juntá-las faria o seletor da tela
 *   de detalhe pagar a conta da lista toda vez que alguém troca de unidade.
 * - `/remuneracao/cadastro` — as trinta linhas da aba para uma unidade numa
 *   vigência, cada uma com o número e a procedência, ou com o motivo de não ter
 *   número.
 * - `/remuneracao/comparacao` — as mesmas trinta linhas em **duas quinzenas
 *   lado a lado**, que é a forma da planilha: a aba traz os dois blocos um ao
 *   lado do outro, e quem confere lê as duas colunas juntas.
 * - `/remuneracao/planilha` — a metade que **não** sai do acervo: o que alguém
 *   digitou da aba de Excel. `GET` lê, `PUT` grava a vigência inteira, e
 *   `/copia` repete numa vigência o que já foi digitado noutra. O que entra por
 *   aqui volta no cadastro marcado como `INFORMADO`, com autor e data — nunca
 *   como apurado, e nunca por cima de um número que o acervo sustente. As duas
 *   escritas aceitam `vigenciaNova: true`, que é como a quinzena que o export
 *   ainda não trouxe passa a existir — a mesma bandeira do `canalNovo`, do lado
 *   da vigência.
 *
 * **Nada aqui calcula.** A aritmética inteira mora em `@workspace/remuneracao`,
 * testada sem banco e sem HTTP, como a do Fechamento. Este arquivo lê a query,
 * chama e devolve.
 *
 * **Por que a rota não vive sob `/fechamento`.** Porque o cadastro não é de uma
 * competência: ele é da unidade, numa vigência, e é lido pelo acervo da
 * Auditoria. A tela que o abre é do Fechamento — é lá que ele serve —, mas
 * pendurá-lo no prefixo do outro ambiente diria que ele nasce de uma quinzena
 * fechada, e ele nasce do que a Ambev contratou.
 */
const router: IRouter = Router();

const SEM_ACERVO =
  "Nenhuma unidade entregou vigência ainda — sem export importado, não há cadastro a montar.";

/** Mesma convenção das demais rotas — ver `routes/qlp.ts`. */
function parseContext(query: Record<string, unknown>): RequestedContext | undefined {
  const scopeHash =
    typeof query.scopeHash === "string" && query.scopeHash !== "" ? query.scopeHash : undefined;
  const hasCanal = typeof query.canal === "string";
  if (scopeHash === undefined && !hasCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(hasCanal
      ? { channel: (query.canal as string) === "" ? null : (query.canal as string) }
      : {}),
  };
}

/**
 * O mesmo contexto, lido de um **corpo JSON** em vez da query.
 *
 * A diferença é uma só e ela decide em qual série a escrita cai: JSON sabe
 * dizer `null`, e uma query não. Na query, a série sem canal se pede com
 * `canal=` — a string vazia —, porque omitir o parâmetro significa "qualquer
 * canal" e o servidor escolhe o primeiro. No corpo, `"canal": null` é a mesma
 * coisa dita direto, e é o que a tela manda: ela carrega o canal do contexto
 * que leu, que é `null` nas séries sem canal.
 *
 * Reaproveitar `parseContext` aqui trataria esse `null` como "não disse", e uma
 * unidade que tenha uma série com canal e outra sem no mesmo `scopeHash`
 * receberia a planilha na série errada — sem erro nenhum, e sem nada na tela
 * que dissesse onde ela foi parar.
 */
function parseContextoDoCorpo(corpo: Record<string, unknown>): RequestedContext | undefined {
  const scopeHash =
    typeof corpo.scopeHash === "string" && corpo.scopeHash !== "" ? corpo.scopeHash : undefined;
  const temCanal =
    "canal" in corpo && (typeof corpo.canal === "string" || corpo.canal === null);
  if (scopeHash === undefined && !temCanal) return undefined;
  return {
    ...(scopeHash !== undefined ? { scopeHash } : {}),
    ...(temCanal ? { channel: corpo.canal === "" ? null : (corpo.canal as string | null) } : {}),
  };
}

/**
 * As unidades que têm cadastro.
 *
 * Devolve o contexto inteiro — `scopeHash`, canal, rótulo e vigências — porque
 * é com ele que a tela monta os dois seletores sem uma segunda ida ao servidor,
 * e porque as vigências oferecidas têm de ser exatamente as que aquela unidade
 * entregou. Um seletor com opções que a unidade não tem é um convite a um 404.
 */
router.get("/remuneracao/unidades", async (_req, res): Promise<void> => {
  const unidades = await listarUnidades(db);
  res.json(
    unidades.map((u) => ({
      scopeHash: u.scopeHash,
      canal: u.channel,
      label: u.label,
      scopes: u.scopes,
      vigenciaMaisRecente: u.latestPeriod,
      vigencias: u.periodosDisponiveis,
    })),
  );
});

/**
 * A situação do cadastro em cada unidade, vigência por vigência.
 *
 * A pergunta que vem antes de "qual é o cadastro desta unidade": **quais
 * unidades já têm cadastro de pé, e quais ainda não têm.** Devolve uma linha
 * por (unidade, vigência) — a quinzena, o que ela entregou e quantas das trinta
 * linhas têm lastro — mais o estado em uma palavra, que é o que a tela destaca.
 * Por vigência, e não só pela mais recente, porque a planilha preenchida numa
 * quinzena antiga é trabalho que existe e precisa de uma linha onde aparecer.
 *
 * Sem parâmetros: a pergunta é sobre o conjunto, e recortá-lo por unidade seria
 * pedir a lista de uma unidade só. Acervo vazio devolve lista vazia com resumo
 * zerado, e não 404 — não há nada pedido que possa não existir, e a tela sabe
 * escrever "nenhuma unidade entregou vigência ainda" a partir do zero.
 */
router.get("/remuneracao/situacao", async (_req, res): Promise<void> => {
  res.json(await lerSituacaoDasUnidades(db));
});

/**
 * O cadastro de uma unidade numa vigência.
 *
 * Sem `scopeHash`, a unidade mais recente do acervo; sem `period`, a vigência
 * mais recente dela — e a resposta **diz qual escolheu**, para que escolher por
 * padrão nunca seja escolher em silêncio.
 *
 * As recusas nomeadas do domínio (`ContextNotFoundError`,
 * `VigenciaDoCadastroNaoEncontrada`) sobem sem `try/catch`: quem as traduz em
 * 404 é `lib/recusa-de-dominio.ts`, e capturá-las aqui só faria o que não fosse
 * recusa perder o `code` e o `requestId` no caminho.
 */
router.get("/remuneracao/cadastro", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const contexto = parseContext(query);
  const period = typeof query.period === "string" && query.period !== "" ? query.period : undefined;
  /*
    `canalNovo=1` é a tela de cadastro dizendo que está abrindo o formulário de
    um canal que pode ainda não existir — ver `lerCadastroDaUnidade`. É opt-in
    de propósito: sem ele, um canal digitado errado num link continua sendo 404,
    e não um cadastro vazio que se parece com uma unidade que perdeu o lastro.
  */
  const canalNovo = query.canalNovo === "1" || query.canalNovo === "true";
  /*
    `vigenciaNova=1` é a mesma bandeira, do lado da quinzena: a tela que
    cadastra a planilha precisa mostrar as trinta linhas em branco da quinzena
    que ainda não chegou. Opt-in pela mesma razão — sem ela, uma data errada num
    link continua sendo 404, e não um cadastro vazio com cara de vigência
    perdida. O que a bandeira **não** afrouxa é a régua da quinzena: o dia 1 ou
    o dia 16, ou a recusa nomeada.
  */
  const vigenciaNova = query.vigenciaNova === "1" || query.vigenciaNova === "true";

  const cadastro = await lerCadastroDaUnidade(db, {
    ...(contexto ?? {}),
    ...(period !== undefined ? { period } : {}),
    ...(canalNovo ? { aceitarCanalNovo: true } : {}),
    ...(vigenciaNova ? { aceitarVigenciaNova: true } : {}),
  });

  if (!cadastro) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(cadastro);
});

/**
 * Duas quinzenas da mesma unidade, lado a lado.
 *
 * Sem `de` e `ate`, as duas vigências mais recentes — o par que a planilha do
 * mês corrente mostra. As duas pontas saem ordenadas em ordem cronológica pelo
 * domínio, e não na ordem em que chegaram: ver `lerComparacaoDeCadastros`.
 *
 * `ComparacaoSemDuasVigencias` sobe daqui como recusa nomeada e vira 422 em
 * `lib/recusa-de-dominio.ts` — a unidade existe, o cadastro dela existe, o que
 * não existe é o par.
 */
router.get("/remuneracao/comparacao", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const contexto = parseContext(query);
  const de = typeof query.de === "string" && query.de !== "" ? query.de : undefined;
  const ate = typeof query.ate === "string" && query.ate !== "" ? query.ate : undefined;

  const comparacao = await lerComparacaoDeCadastros(db, {
    ...(contexto ?? {}),
    ...(de !== undefined ? { de } : {}),
    ...(ate !== undefined ? { ate } : {}),
  });

  if (!comparacao) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(comparacao);
});

/**
 * O que alguém digitou da aba de Excel, para uma unidade numa vigência.
 *
 * A tela de cadastro monta o formulário a partir de `/remuneracao/cadastro`,
 * que já devolve o declarado dentro de cada linha — este `GET` existe para
 * quem precisa só da planilha: a conferência de quem preencheu o quê, e o
 * "copiar da anterior", que pergunta o que a outra vigência tem antes de
 * oferecer o botão.
 *
 * Planilha nunca preenchida devolve `linhas: []`, e não 404. Quem cadastra pela
 * primeira vez está exatamente nesse estado, e um 404 ali diria que a unidade
 * não existe.
 */
router.get("/remuneracao/planilha", async (req, res): Promise<void> => {
  const query = req.query as Record<string, unknown>;
  const contexto = parseContext(query);
  const period = typeof query.period === "string" && query.period !== "" ? query.period : undefined;

  const planilha = await lerPlanilhaDaUnidade(db, {
    ...(contexto ?? {}),
    ...(period !== undefined ? { period } : {}),
  });

  if (!planilha) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(planilha);
});

/**
 * Grava a planilha informada de uma vigência — o "Salvar" da tela de cadastro.
 *
 * **`PUT` e não `POST`** porque o alvo é um recurso nomeado pelo pedido — a
 * planilha daquela unidade naquela vigência —, e mandar o mesmo corpo duas
 * vezes deixa o mesmo estado. `POST` prometeria criar uma segunda planilha da
 * mesma quinzena, que é justamente o que o índice único impede.
 *
 * **O corpo é um `merge`, e não a planilha inteira.** As chaves ausentes ficam
 * como estavam; `valor: null` apaga a linha. É o que permite salvar o bloco que
 * se está editando sem apagar os outros oito — ver `gravarPlanilha`.
 *
 * O autor sai da sessão, e nunca do corpo: um campo "informado por" que a tela
 * preenchesse sustentaria apenas "alguém digitou esse nome". É a mesma razão
 * pela qual `app_user` existe (ver `schema/auth.ts`).
 */
router.put("/remuneracao/planilha", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const contexto = parseContextoDoCorpo(corpo);
  const period = typeof corpo?.period === "string" && corpo.period !== "" ? corpo.period : undefined;

  if (!Array.isArray(corpo?.celulas)) {
    res.status(400).json({
      error:
        "celulas é obrigatório e precisa ser uma lista — cada item com a chave da linha e o " +
        "valor. Para apagar uma linha, mande-a com valor nulo.",
    });
    return;
  }

  const planilha = await gravarPlanilhaDaUnidade(db, {
    ...(contexto ?? {}),
    ...(period !== undefined ? { period } : {}),
    ...(corpo.vigenciaNova === true ? { aceitarVigenciaNova: true } : {}),
    celulas: corpo.celulas as { chave: unknown; valor: unknown; observacao?: unknown }[],
    autor: { id: req.user?.id ?? null, nome: req.user?.name ?? null },
  });

  if (!planilha) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(planilha);
});

/**
 * Copia a planilha de uma vigência para outra, na mesma unidade.
 *
 * Existe porque a alternativa é redigitar trinta linhas por quinzena, e a maior
 * parte delas não muda — na própria aba de Excel os dois blocos repetem as
 * alíquotas e a frota. O que ela **não** é: herança automática. É um ato, com
 * autor e data de quem o pediu, e não sobrescreve o que a vigência de destino
 * já tem — ver `copiarPlanilha`.
 *
 * `POST` e não `PUT`: o mesmo pedido repetido não deixa o mesmo estado. A
 * segunda cópia não faz nada, porque a primeira já preencheu — e é o
 * comportamento certo, mas não é idempotência de recurso.
 */
router.post("/remuneracao/planilha/copia", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const contexto = parseContextoDoCorpo(corpo);
  const de = typeof corpo?.de === "string" ? corpo.de : "";
  const para = typeof corpo?.para === "string" ? corpo.para : "";

  if (de === "" || para === "") {
    res.status(400).json({
      error:
        "de e para são obrigatórios — copiar é dizer de qual vigência para qual, e as duas " +
        "precisam ser vigências desta unidade.",
    });
    return;
  }
  if (de === para) {
    res.status(400).json({
      error: "de e para são a mesma vigência. Copiar uma planilha para ela mesma não faz nada.",
    });
    return;
  }

  const planilha = await copiarPlanilhaDaUnidade(db, {
    ...(contexto ?? {}),
    de,
    para,
    /* Só o destino: copiar **de** uma quinzena que não existe é copiar de nada,
       e o domínio continua recusando essa ponta. */
    ...(corpo.vigenciaNova === true ? { aceitarVigenciaNova: true } : {}),
    autor: { id: req.user?.id ?? null, nome: req.user?.name ?? null },
  });

  if (!planilha) {
    res.status(404).json({ error: SEM_ACERVO });
    return;
  }
  res.json(planilha);
});

/**
 * Lê uma imagem da aba e devolve o que ela diz — sem gravar nada.
 *
 * **`POST` e não `PUT`, e nada aqui toca o banco.** É uma leitura que produz
 * resposta nova a cada chamada, e o seu efeito colateral é zero: o que ela
 * devolve vai para os campos do formulário como rascunho, e continua sendo o
 * "Salvar" da própria pessoa que escreve a planilha. Um endereço que gravasse
 * direto o que um modelo leu numa foto trocaria a declaração de quem assina
 * pela transcrição de quem não assina nada.
 *
 * **A resposta separa três coisas, e a separação é o produto.** `valores` é o
 * que a imagem respondeu; `naoEncontradas`, o que ela não mostrou, nomeado;
 * `recusadas`, o que ela mostrou e a regra da linha recusa — um percentual
 * acima de cem, uma contagem quebrada. A recusa é conferida aqui pela mesma
 * `conferirCelula` que guarda o `PUT`, e por isso a leitura não consegue
 * empurrar para a tela um número que o gravar rejeitaria depois.
 *
 * O catálogo vai inteiro para a leitura porque a aba é a mesma para toda
 * unidade: são as trinta linhas do contrato, e não um recorte do que aquele
 * `scopeHash` já tem.
 */
router.post("/remuneracao/planilha/leitura-de-imagem", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const mimeType = corpo.mimeType;
  /*
    A tela manda o base64 puro, mas um `data:` URL inteiro é o engano de uma
    linha — `reader.result` vem com o prefixo, e quem esquecer de cortá-lo
    receberia "não consegui ler" numa imagem perfeita. Cortar aqui custa uma
    expressão regular e evita esse desencontro.
  */
  const dados =
    typeof corpo.imagem === "string" ? corpo.imagem.replace(/^data:[^,]*,/, "").trim() : "";

  if (!ehMimeDeImagem(mimeType)) {
    res.status(400).json({
      error:
        "mimeType precisa ser image/png, image/jpeg, image/webp ou image/gif — são os " +
        "formatos que a leitura enxerga. Um PDF da aba não passa por aqui.",
    });
    return;
  }
  if (dados === "") {
    res.status(400).json({
      error: "imagem é obrigatória e vem em base64 — é o conteúdo do print da aba.",
    });
    return;
  }

  const linhas = BLOCOS_DO_CADASTRO.flatMap((bloco) =>
    bloco.linhas.map((linha) => ({
      chave: linha.chave,
      rotulo: linha.rotulo,
      medida: linha.medida,
      bloco: bloco.titulo,
    })),
  );

  const leitura = await lerPlanilhaDaImagem({ imagem: { mimeType, dados }, linhas });

  /*
    A mesma trava do `PUT`, aplicada antes de a tela ver o número. `5,90` lido
    como `590` num campo de alíquota é o erro que a foto produz, e ele para
    aqui com o motivo escrito — em vez de chegar ao campo, passar despercebido
    e voltar como 400 no clique de salvar.
  */
  const valores: { chave: string; valor: number; comoEstaNaImagem: string }[] = [];
  const recusadas: { chave: string; comoEstaNaImagem: string; motivo: string }[] = [];

  for (const lido of leitura.valores) {
    try {
      const celula = conferirCelula({ chave: lido.chave, valor: lido.valor });
      if (celula.valor === null) {
        recusadas.push({
          chave: lido.chave,
          comoEstaNaImagem: lido.comoEstaNaImagem,
          motivo: "A leitura não resultou em número.",
        });
        continue;
      }
      valores.push({
        chave: celula.chave,
        valor: celula.valor,
        comoEstaNaImagem: lido.comoEstaNaImagem,
      });
    } catch (erro) {
      if (!(erro instanceof LinhaDaPlanilhaInvalida)) throw erro;
      recusadas.push({
        chave: lido.chave,
        comoEstaNaImagem: lido.comoEstaNaImagem,
        motivo: erro.message,
      });
    }
  }

  res.json({
    valores,
    naoEncontradas: leitura.naoEncontradas,
    recusadas,
    motivo: leitura.motivo,
    erro: leitura.erro,
    modelo: leitura.modelo,
  });
});

/**
 * Registra uma unidade que ainda não importou vigência nenhuma.
 *
 * **Por que a rota existe.** Até aqui, unidade era o que `listContexts` achava
 * no acervo: quem nunca mandou export não tinha linha para clicar, e a planilha
 * dele — que costuma chegar antes do arquivo — não tinha onde ser digitada. Na
 * Auditoria a regra estava certa e continua; no Fechamento ela era uma parede,
 * porque lá a quinzena é de várias unidades e nenhuma delas espera a outra.
 *
 * **O que ela grava é identidade, e nada mais.** Nome, código, tipo de operação
 * e a quinzena inicial. Nenhum número: os números continuam entrando pelo `PUT`
 * da planilha, marcados como informados, com autor e data.
 *
 * **O `scope_hash` é somado aqui, com o `hashScopeSet` da importação.** É de
 * propósito que ele não é somado no domínio: a regra é da importação, e uma
 * segunda implementação dela seria uma segunda chave de negócio — no dia em que
 * as duas discordassem, a planilha digitada sumiria da unidade sem erro nenhum
 * em tela. Somando aqui, com a mesma função, registrar CAMAÇARI com o código
 * que o export carrega produz **o mesmo** identificador que o import produzirá,
 * e o arquivo, quando chegar, cai na unidade que já estava lá.
 *
 * **Sobre qual texto ele é somado — código ou nome — é `identificadorDaUnidade`
 * quem decide**, e o cabeçalho daquela função é onde o preço de cada caminho
 * está escrito. O que importa aqui é que a rota não escolhe: ela pergunta. O
 * código deixou de ser obrigatório porque exigi-lo mandava quem tem a aba na
 * mão procurar o CNPJ num export que ainda não chegou — a mesma parede que
 * esta rota existe para derrubar, um passo adiante.
 *
 * O autor sai da sessão, como no `PUT` da planilha, e pela mesma razão.
 */
router.post("/remuneracao/unidades", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const nome = typeof corpo.nome === "string" ? corpo.nome : "";
  const codigoBruto = typeof corpo.codigo === "string" ? corpo.codigo : "";
  const canal = typeof corpo.canal === "string" && corpo.canal.trim() !== "" ? corpo.canal : null;
  const vigencia = typeof corpo.vigencia === "string" ? corpo.vigencia.trim() : "";
  const scopeType =
    typeof corpo.scopeType === "string" && corpo.scopeType.trim() !== ""
      ? corpo.scopeType.trim().toUpperCase()
      : "UNIDADE";

  const codigo = normalizarCodigo(codigoBruto);
  /*
    O nome é conferido **aqui**, e não só no domínio, porque sem código é dele
    que o identificador sai: sem esta guarda, uma unidade sem nome e sem código
    produziria o descritor `UNIDADE:` — o mesmo para todas elas —, e a recusa
    que viria depois seria a do domínio, com a frase certa e pelo motivo errado.
  */
  if (nome.trim() === "") {
    throw new UnidadeInvalida(
      "A unidade precisa de um nome — é o que a lista mostra, e o que quem opera procura.",
    );
  }
  /*
    A vigência é conferida como forma, e não contra uma lista: não há lista. A
    unidade não tem acervo, e é justamente a quinzena declarada aqui que vai
    povoar o seletor do formulário — recusá-la por não constar de lugar nenhum
    seria recusar a única data que existe.
  */
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigencia)) {
    throw new UnidadeInvalida(
      "A quinzena inicial é obrigatória e vem como data (AAAA-MM-DD). Ela é a única vigência " +
        "que esta unidade tem até a primeira planilha ser salva — sem ela o formulário abre " +
        "sem nada para escolher.",
    );
  }

  const unidade = await registrarUnidade(db, {
    scopeHash: hashScopeSet([
      descritorDeEscopo(scopeType, identificadorDaUnidade({ codigo, nome })),
    ]),
    scopeType,
    codigo,
    nome,
    canal,
    vigenciaInicial: vigencia,
    autor: { id: req.user?.id ?? null, nome: req.user?.name ?? null },
  });

  res.status(201).json(unidade);
});

/**
 * Informa o código de uma unidade que foi cadastrada sem ele.
 *
 * **Por que a rota existe.** Cadastrar sem código é permitido — quem tem a aba
 * de Excel na mão nem sempre tem o CNPJ —, e o preço disso é que o identificador
 * sai do nome e o export abre a unidade dele ao lado desta. Sem esta rota o
 * preço era **definitivo**: descobrir o CNPJ no dia seguinte não servia de nada,
 * e a planilha já digitada ficava presa ao escopo do nome para sempre.
 *
 * **O `scope_hash` novo é somado aqui, com o `hashScopeSet` da importação** —
 * a mesma razão do `POST`, e agora com um detalhe que só existe neste caminho:
 * o `scopeType` sai da **linha gravada**, e não do corpo do pedido. Aceitá-lo
 * de fora deixaria o cliente somar o hash de um descritor que a unidade não
 * tem, e o movimento a levaria para um escopo que nenhum arquivo vai produzir —
 * o defeito de sempre, agora com a unidade em trânsito.
 *
 * O que é mover, e o que é recusado, mora em `informarCodigoDaUnidade`.
 */
router.put("/remuneracao/unidades/codigo", async (req, res): Promise<void> => {
  const corpo = (req.body ?? {}) as Record<string, unknown>;
  const escopoAtual = typeof corpo.scopeHash === "string" ? corpo.scopeHash.trim() : "";
  const codigo = normalizarCodigo(typeof corpo.codigo === "string" ? corpo.codigo : "");

  if (escopoAtual === "") {
    throw new UnidadeInvalida(
      "Falta dizer de qual unidade é o código — o pedido vem com o escopo dela, que é o que " +
        "a lista já tem na mão.",
    );
  }
  if (codigo === "") {
    throw new UnidadeInvalida(
      "O código é o que este ato informa: sem ele não há o que gravar. É o mesmo da coluna " +
        "Unidade - CNPJ do export, escrito exatamente como está lá — com pontuação, se lá " +
        "houver.",
    );
  }

  /*
    A leitura antes do hash não é desperdício: é de onde sai o `scopeType` — e
    é também o que permite recusar com 404 antes de somar coisa nenhuma. A
    corrida com um export que chegue neste intervalo é fechada dentro da
    transação, que relê o escopo.
  */
  const registradas = await unidadesRegistradasDoEscopo(db, escopoAtual);
  const primeira = registradas[0];
  if (!primeira) throw new UnidadeNaoRegistrada();

  const escopoNovo = hashScopeSet([descritorDeEscopo(primeira.scopeType, codigo)]);
  const unidades = await informarCodigoDaUnidade(db, { escopoAtual, escopoNovo, codigo });

  /*
    O escopo novo volta junto porque é o endereço da unidade daqui para a
    frente: a tela que chamou tem o antigo na URL, e sem esta linha ela
    recarregaria uma unidade que mudou de lugar.
  */
  res.json({ scopeHash: escopoNovo, unidades });
});

export default router;
