/**
 * O que o assistente sabe sobre o produto — em código, e por escrito.
 *
 * **Por que isto mora aqui e não num banco vetorial.** É a mesma razão de
 * `labels.ts` e de `families.ts`: este texto é uma decisão de produto, não um
 * dado. Ele precisa existir com o banco vazio — que é justamente quando alguém
 * está tentando entender o que o FreightCheck faz —, precisa passar por revisão
 * de código quando muda, e precisa ser conferível linha a linha por quem
 * discordar de uma resposta. Um índice que se atualiza sozinho a partir de
 * documentos entregaria respostas que ninguém aprovou.
 *
 * **O que é um artigo.** Uma pergunta que alguém faz de verdade, a resposta que
 * este produto sustenta, e a origem dessa resposta — o arquivo, a tela ou o
 * documento onde ela pode ser conferida. Um artigo sem `fonte` não entra: uma
 * afirmação sem onde conferir é exatamente o que este produto existe para não
 * exibir.
 *
 * **O que os artigos não são.** Eles não contêm números. Nenhum artigo diz
 * "o IPVA caiu 77%" ou "há 62 veículos": números vêm de `dados.ts`, do banco,
 * com o recorte de quem perguntou. Um número escrito aqui envelheceria na
 * primeira importação e continuaria sendo dito com a mesma segurança.
 */

/** Onde o assistente concentra conhecimento. As duas primeiras foram o pedido. */
export type Area =
  | "PARAMETROS"
  | "BOOK"
  | "CONCEITO"
  | "LEITURA"
  | "NAVEGACAO"
  | "RECUSA";

export interface Artigo {
  id: string;
  area: Area;
  /** O título como apareceria num índice. */
  titulo: string;
  /** Perguntas reais que este artigo responde. Alimentam a busca e as sugestões. */
  perguntas: string[];
  /** Sinônimos e vocabulário do Freightech que levam até aqui. */
  termos: string[];
  /** A resposta, em prosa. Sem números — números vêm do banco. */
  corpo: string;
  /** Onde conferir: arquivo do repositório, tela do produto, documento. */
  fonte: string;
  /** A tela do produto onde isto se vê acontecendo, quando existe uma. */
  tela?: { label: string; href: string };
}

export const ARTIGOS: Artigo[] = [
  // ══════════════════════════════════════════════════════════════════════════
  // PARÂMETROS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "parametros-o-que-e",
    area: "PARAMETROS",
    titulo: "O que a tela de Parâmetros mostra",
    perguntas: [
      "o que é a tela de parâmetros",
      "para que serve escolha de segmento",
      "o que tem em parâmetros",
    ],
    termos: [
      "parametros", "parametro", "escolha de segmento", "segmento", "cartao",
      "cartoes", "grade", "gaveta", "familia", "familias",
    ],
    corpo:
      "Parâmetros é a tela Escolha de Segmento do Freightech, com o dado que lá não " +
      "aparece. Os quatro campos estão na mesma ordem — Canal/Segmento, Vigência, " +
      "Unidade, Parâmetro — e a grade traz o catálogo inteiro de cartões do " +
      "Freightech, não só os que este export alimenta.\n\n" +
      "O que muda é o miolo do cartão. No Freightech ele traz o nome e nada mais: para " +
      "saber se algo mudou é preciso abrir, exportar e comparar à mão. Aqui o cartão já " +
      "diz quantas alterações houve, em quantos veículos, e quanto isso vale — e quando " +
      "não dá para valorar, diz o motivo em vez de deixar em branco.\n\n" +
      "Um cartão que existe no Freightech e não tem dado neste export aparece mesmo " +
      "assim, em cinza, dizendo que não tem dado. Ele existe porque quem procura uma " +
      "gaveta pelo nome e não a encontra conclui que o produto não cobre o assunto.",
    fonte: "artifacts/freightaudit/src/pages/parametros.tsx",
    tela: { label: "Parâmetros", href: "/parametros" },
  },
  {
    id: "parametros-familias",
    area: "PARAMETROS",
    titulo: "Famílias: de que assunto o parâmetro trata",
    perguntas: [
      "o que são as famílias de parâmetros",
      "como os parâmetros são agrupados",
      "qual a diferença entre família e taxonomia",
    ],
    termos: [
      "familia", "familias", "frota", "dimensoes", "parametros gerais", "taxonomia",
      "classe de custo", "custo fixo", "custo variavel", "agrupamento", "assunto",
    ],
    corpo:
      "Família operacional e classe de custo são eixos diferentes, e os dois valem.\n\n" +
      "A **família** responde \"de que assunto isto trata?\" — Frota, Dimensões, " +
      "Parâmetros Gerais, Aquisição e financiamento, Tributos e seguros, Modelos de " +
      "remuneração, Geral, Contrato e ciclo, Contexto. É o vocabulário do Freightech e " +
      "serve para reconhecer onde procurar. Uma coluna nova da fonte cai em Sem " +
      "família, que aparece na tela com esse nome — nunca some.\n\n" +
      "A **taxonomia** responde \"custo fixo ou variável?\" e é o que alimenta o cálculo " +
      "de impacto. As duas não se misturam de propósito: reclassificar por família " +
      "mudaria a classe de custo das comparações futuras e as faria divergir do caminho " +
      "de taxonomia já gravado nas antigas.\n\n" +
      "A soma das famílias fecha com o total da vigência dentro de cada periodicidade. " +
      "Há teste para isso: um agrupamento cujas partes não fecham com o todo passa " +
      "confiança falsa.",
    fonte: "lib/comparison/src/families.ts",
    tela: { label: "Parâmetros", href: "/parametros" },
  },
  {
    id: "parametros-cobertura",
    area: "PARAMETROS",
    titulo: "Cobertura da apuração: por que 0% não quer dizer 0 de impacto",
    perguntas: [
      "o que é cobertura da apuração",
      "por que a cobertura está em 0%",
      "mexeram no parâmetro mas o impacto está zerado",
      "0 com impacto financeiro calculado",
    ],
    termos: [
      "cobertura", "apuracao", "impacto calculado", "sem valoracao", "nao apuravel",
      "zero por cento", "0%", "precificadas", "impacto financeiro",
    ],
    corpo:
      "Cobertura da apuração é a fatia das alterações do recorte cujo valor em dinheiro " +
      "este produto consegue sustentar. Cobertura em 0% quer dizer **\"o valor disso " +
      "ainda não é apurável com este export\"** — que é uma afirmação diferente de " +
      "\"não houve impacto\".\n\n" +
      "O motivo mais comum é semântica desconhecida: o atributo ainda não foi confirmado " +
      "na Curadoria, então somar a variação dele seria adivinhação. O tamanho do que " +
      "mexeu continua visível — quantas alterações, quantos parâmetros, quantos veículos " +
      "— e cada alteração aparece com veículo, valor anterior e valor novo. O que falta " +
      "é o preço, e o cartão diz que falta.\n\n" +
      "A regra que está por trás disso: nunca escrever \"impacto a verificar\". Sem " +
      "preço é sem preço, com o motivo junto.",
    fonte: "lib/comparison/src/impact.ts",
    tela: { label: "Curadoria", href: "/curadoria" },
  },
  {
    id: "parametros-periodicidade",
    area: "PARAMETROS",
    titulo: "Por que nunca existe um total único de impacto",
    perguntas: [
      "por que o impacto vem separado por periodicidade",
      "por que não tem um total só",
      "posso somar o impacto mensal com o anual",
    ],
    termos: [
      "periodicidade", "mensal", "anual", "pontual", "total", "somar", "impacto total",
      "r$/mes", "r$/ano", "r$/km",
    ],
    corpo:
      "Impacto é acumulado **por periodicidade**, e nunca existe um total único somando " +
      "R$/mês com R$/ano. Somar as duas grandezas produziria um número que nenhuma das " +
      "duas justifica, e que ninguém conseguiria reconciliar com a planilha.\n\n" +
      "O mesmo vale para ordenar: os rankings de parâmetro e de veículo usam o maior " +
      "valor absoluto **dentro de uma periodicidade**, não a soma entre elas.\n\n" +
      "Há ainda a armadilha do Custo Variável Simulado, em R$/km: é uma terceira " +
      "grandeza, e não entra em total nenhum.",
    fonte: "docs/ARQUITETURA.md",
    tela: { label: "Parâmetros", href: "/parametros" },
  },
  {
    id: "parametros-movimento-vs-posicao",
    area: "PARAMETROS",
    titulo: "Movimentos do período × Ponta a ponta",
    perguntas: [
      "qual a diferença entre movimentos do período e ponta a ponta",
      "por que os dois números não batem",
      "o que é a leitura ponta a ponta",
    ],
    termos: [
      "movimentos do periodo", "ponta a ponta", "intervalo", "leitura", "duas leituras",
      "subiu e voltou", "de ate", "acumulado",
    ],
    corpo:
      "São duas perguntas diferentes sobre o mesmo intervalo, e as respostas divergem " +
      "de propósito.\n\n" +
      "**Movimentos do período** responde \"o que a Ambev foi mexendo no caminho\". " +
      "Cada vigência já é uma comparação com a anterior, e o intervalo soma essas " +
      "comparações. Um valor que subiu e voltou conta duas vezes aqui.\n\n" +
      "**Ponta a ponta** responde \"o que continua diferente no fim\". Compara o começo " +
      "com o fim do intervalo e ignora o caminho. O mesmo valor que subiu e voltou " +
      "some nesta leitura.\n\n" +
      "Quando os dois números divergem, isso não é erro: é a diferença entre agitação e " +
      "saldo. A tela mostra as duas porque decidir qual delas é \"a certa\" seria " +
      "decidir a pergunta pelo usuário.",
    fonte: "lib/comparison/src/end-to-end.ts",
    tela: { label: "Parâmetros", href: "/parametros" },
  },
  {
    id: "parametros-contexto",
    area: "PARAMETROS",
    titulo: "Toda leitura acontece dentro de (unidade, canal)",
    perguntas: [
      "por que preciso escolher unidade e canal",
      "o que é contexto",
      "posso comparar vigências de canais diferentes",
    ],
    termos: [
      "contexto", "unidade", "canal", "empurrada", "rota", "camacari", "scope",
      "recorte", "segmento", "operalog",
    ],
    corpo:
      "Uma vigência não é uma data — é uma data **de alguém**. Toda leitura deste " +
      "produto acontece dentro de um contexto `(unidade, canal)`, e a resposta sempre " +
      "diz qual contexto está descrevendo e quais outros existem.\n\n" +
      "Chavear só por data somaria duas unidades que entregam no mesmo dia num total que " +
      "nenhuma das duas reconhece. Escolher um contexto por padrão é aceitável; escolher " +
      "em silêncio, não.\n\n" +
      "O canal é o prefixo do rótulo da vigência (`EMPURRADA_1_8_2026`, " +
      "`ROTA_1_8_2026`), derivado do rótulo e não guardado numa coluna. Vigências de " +
      "canais diferentes não se comparam, e a recusa é escrita na tela.",
    fonte: "lib/comparison/src/series.ts",
    tela: { label: "Parâmetros", href: "/parametros" },
  },
  {
    id: "parametros-veiculos-afetados",
    area: "PARAMETROS",
    titulo: "Veículos afetados, e por que a frota não é o preço",
    perguntas: [
      "o que quer dizer veículos afetados",
      "o total do parâmetro subiu, encareceu?",
      "por que a soma da frota não serve para comparar",
    ],
    termos: [
      "veiculos afetados", "frota", "ativos distintos", "placa", "media por veiculo",
      "soma da frota", "entrou ativo", "cavalo", "carreta",
    ],
    corpo:
      "Veículos afetados conta **ativos distintos**: o mesmo caminhão não conta duas " +
      "vezes, ainda que dois parâmetros dele tenham mudado.\n\n" +
      "O cuidado que vem junto: **a soma da frota não é o preço.** O IPVA dos cavalos " +
      "pode subir entre duas vigências sem que nada tenha encarecido — bastam dois " +
      "cavalos novos terem entrado. Por isso a série de um atributo sempre devolve o " +
      "numerador, o denominador e a média, e a tela é obrigada a mostrar os três. Ler " +
      "entrada de ativo como aumento de preço é o erro que essa regra existe para " +
      "impedir.\n\n" +
      "Carreta e Cavalo são séries independentes. O consolidado é projeção da interface, " +
      "não uma entidade do snapshot.",
    fonte: "lib/comparison/src/grouped.ts",
    tela: { label: "Análise de frota", href: "/analise-equipamentos" },
  },
  {
    id: "parametros-identidade",
    area: "PARAMETROS",
    titulo: "A placa não é a chave",
    perguntas: [
      "como o produto sabe que é o mesmo caminhão",
      "e se a placa mudar",
      "a comparação é por linha da planilha",
    ],
    termos: [
      "placa", "identidade", "uuid", "chave", "linha", "posicao", "mesmo veiculo",
      "troca de placa",
    ],
    corpo:
      "A identidade de cada ativo é um UUID interno. A placa é um identificador com " +
      "histórico, não a chave — ela pode mudar sem que o ativo mude.\n\n" +
      "Comparação nunca é por posição de linha na planilha. Duas exportações com as " +
      "linhas em ordens diferentes produzem exatamente a mesma comparação; se fosse por " +
      "posição, uma reordenação do Freightec viraria centenas de alterações " +
      "inexistentes.",
    fonte: "lib/ingest/src/identity.ts",
    tela: { label: "Cobertura de dados", href: "/dados" },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // BOOK DO OPERADOR
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "book-o-que-e",
    area: "BOOK",
    titulo: "O que é o Book do Operador",
    perguntas: [
      "o que é o book do operador",
      "para que serve o book",
      "onde ficam as regras de remuneração",
    ],
    termos: [
      "book", "book do operador", "book operador", "regra", "regras", "bloco", "blocos",
      "manual", "contrato", "modelo de precificacao", "composicao", "remuneracao",
    ],
    corpo:
      "O Book do Operador é o contraponto do export. O Freightec entrega o cadastro " +
      "remunerado da frota — colunas por placa — e **nenhuma regra**: nenhuma linha " +
      "dizendo o que qualquer uma daquelas colunas significa. O Book é o outro lado: a " +
      "base de blocos em que o Freightech publica *como* cada pagamento é composto.\n\n" +
      "Sem ele, \"o IPVA caiu\" é um fato sem regra ao lado. Com ele, dá para dizer " +
      "contra o que conferir.\n\n" +
      "O índice dos blocos — categoria, título e descrição — é transcrição da tela do " +
      "Freightech e vive na interface. O **conteúdo** de cada bloco, a regra em si, é " +
      "registrado aqui dentro: escrito como texto ou anexado como documento. Um bloco " +
      "sem regra registrada continua aparecendo, dizendo que está vazio.",
    fonte: "artifacts/freightaudit/src/lib/book-operador.ts",
    tela: { label: "Book do Operador", href: "/book-operador" },
  },
  {
    id: "book-texto-documento",
    area: "BOOK",
    titulo: "TEXTO ou DOCUMENTO: os dois tipos de entrada",
    perguntas: [
      "qual a diferença entre texto e documento no book",
      "posso escrever a regra em vez de anexar",
      "que tipo de arquivo o book aceita",
    ],
    termos: [
      "texto", "documento", "anexo", "arquivo", "pdf", "markdown", "escrever regra",
      "anexar", "tipo de entrada", "upload",
    ],
    corpo:
      "Cada entrada do Book é de um de dois tipos, e os dois compartilham a mesma " +
      "numeração de revisão por bloco.\n\n" +
      "**DOCUMENTO** é o arquivo: o contrato assinado, o manual em PDF, a planilha de " +
      "apoio. **TEXTO** é a regra escrita direto no sistema, que serve quando ela cabe " +
      "em três parágrafos e não existe arquivo nenhum para anexar.\n\n" +
      "A linha do tempo é única de propósito. A história real de um bloco costuma " +
      "alternar entre os dois — alguém escreve a regra enquanto o contrato não chega, e " +
      "depois anexa o contrato —, e duas linhas do tempo separadas obrigariam quem lê a " +
      "reconstruir a ordem de cabeça.",
    fonte: "lib/db/src/schema/book.ts",
    tela: { label: "Book do Operador", href: "/book-operador" },
  },
  {
    id: "book-revisoes",
    area: "BOOK",
    titulo: "Revisões: nada é apagado, nada é sobrescrito",
    perguntas: [
      "como apago uma entrada do book",
      "posso substituir um documento do book",
      "o que acontece quando envio de novo",
      "como vejo a versão anterior de uma regra",
    ],
    termos: [
      "revisao", "revisoes", "versao", "historico", "apagar", "excluir", "delete",
      "substituir", "sobrescrever", "vigente", "atual",
    ],
    corpo:
      "Enviar de novo cria a **revisão seguinte**. A anterior continua guardada, " +
      "legível e baixável. **Não existe DELETE** no Book.\n\n" +
      "A entrada vigente é a de maior número de revisão. Não existe uma coluna \"é a " +
      "atual\": seriam duas verdades sobre o mesmo fato, e a segunda é a que sai de " +
      "sincronia.\n\n" +
      "O motivo é auditoria: quem for conferir uma remuneração de seis meses atrás " +
      "precisa da regra que valia naquele dia, não da que vale hoje. É a mesma regra que " +
      "vale para a camada RAW e para a curadoria — \"nunca descarte silenciosamente\" " +
      "vale também para o que nós mesmos substituímos.\n\n" +
      "Um reenvio idêntico é reconhecido pelo SHA-256 do conteúdo: sem ele, salvar duas " +
      "vezes sem editar nada criaria uma revisão nova e o histórico passaria a sugerir " +
      "que a regra mudou num dia em que ela não mudou.",
    fonte: "lib/db/src/schema/book.ts",
    tela: { label: "Book do Operador", href: "/book-operador" },
  },
  {
    id: "book-onde-mora",
    area: "BOOK",
    titulo: "Por que os arquivos do Book ficam no banco",
    perguntas: [
      "onde ficam guardados os arquivos do book",
      "o documento do book some num deploy",
      "por que o book não usa disco",
    ],
    termos: [
      "bytea", "postgres", "banco", "disco", "storage", "backup", "efemero", "deploy",
      "onde fica guardado",
    ],
    corpo:
      "Os bytes das entradas do Book moram no Postgres, e não em disco — ao contrário " +
      "das planilhas importadas, cujo arquivo pode sumir sem levar nada junto, porque " +
      "depois da captura a evidência real está em `raw_cell`, célula por célula.\n\n" +
      "No Book é o contrário: a entrada **é** o conteúdo. Não há cópia derivada dela em " +
      "lugar nenhum, e o disco desta plataforma é efêmero — um deploy novo apagaria o " +
      "único exemplar. No banco, ela entra no mesmo backup de todo o resto.",
    fonte: "lib/db/src/schema/book.ts",
    tela: { label: "Book do Operador", href: "/book-operador" },
  },
  {
    id: "book-blocos-repetidos",
    area: "BOOK",
    titulo: "Blocos repetidos no índice não são erro",
    perguntas: [
      "por que tem dois blocos com o mesmo nome",
      "o book tem blocos duplicados",
      "por que a contagem de blocos não fecha",
    ],
    termos: [
      "duplicado", "duplicidade", "repetido", "dois blocos", "mesmo nome", "contagem",
      "paginacao", "pgr", "plano de saude", "stress test",
    ],
    corpo:
      "Alguns blocos aparecem duas vezes na base do Freightech, e a repetição foi " +
      "mantida de propósito.\n\n" +
      "Deduplicar deixaria a lista mais limpa e passaria a descrever uma base que não " +
      "existe. São dois registros lá, cada um capaz de receber o seu próprio documento, " +
      "e fundi-los faria o segundo herdar o conteúdo do primeiro sem ninguém perceber. " +
      "Quem quiser conferir contra a tela de origem precisa encontrar aqui o mesmo " +
      "número de cartões que conta lá.\n\n" +
      "Cada aparição tem endereço próprio no banco justamente para que anexar um " +
      "documento a uma delas não o faça aparecer na outra.",
    fonte: "artifacts/freightaudit/src/lib/book-operador.ts",
    tela: { label: "Book do Operador", href: "/book-operador" },
  },
  {
    id: "book-vs-parametros",
    area: "BOOK",
    titulo: "Book e Parâmetros respondem perguntas diferentes",
    perguntas: [
      "qual a diferença entre book e parâmetros",
      "onde vejo quanto mudou e onde vejo a regra",
      "o book mostra valores",
    ],
    termos: [
      "diferenca", "book ou parametros", "regra ou valor", "onde procurar",
      "qual tela", "cadastro remunerado",
    ],
    corpo:
      "**Parâmetros** responde \"o que mudou, em quantos veículos, e quanto vale\". " +
      "Vem do export do Freightec, que é o cadastro remunerado da frota congelado por " +
      "vigência.\n\n" +
      "**Book do Operador** responde \"qual é a regra\". Vem de fora do export, " +
      "registrado por quem opera.\n\n" +
      "Os dois se completam e nenhum substitui o outro. O Book não traz valores por " +
      "placa; Parâmetros não traz regra. Quando uma alteração aparece em Parâmetros e " +
      "ninguém entende por que ela aconteceu, o Book é onde a explicação deveria " +
      "estar — e se não estiver, o bloco vazio diz isso.",
    fonte: "docs/ARQUITETURA.md",
    tela: { label: "Book do Operador", href: "/book-operador" },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // CONCEITOS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "conceito-vigencia",
    area: "CONCEITO",
    titulo: "O que é uma vigência",
    perguntas: ["o que é vigência", "o que é um snapshot", "o que significa promover"],
    termos: [
      "vigencia", "vigencias", "snapshot", "promover", "promocao", "congelado",
      "efetiva", "data de vigencia",
    ],
    corpo:
      "Uma vigência é uma foto do cadastro remunerado numa data, dentro de um contexto " +
      "`(unidade, canal)`. Ela nasce de uma planilha importada e só passa a valer depois " +
      "de **promovida** — e entre a importação e a promoção existe uma decisão humana, " +
      "de propósito.\n\n" +
      "Depois de fechada, a vigência é congelada por trigger no banco: não se edita uma " +
      "vigência já promovida. Corrigir a fonte é reimportar; corrigir a nossa " +
      "interpretação é outra ação, e vive na Curadoria.",
    fonte: "lib/ingest/src/pipeline.ts",
    tela: { label: "Vigências", href: "/vigencias" },
  },
  {
    id: "conceito-camadas",
    area: "CONCEITO",
    titulo: "RAW, staging, canônico e comparação",
    perguntas: [
      "como o dado entra no produto",
      "o que é raw",
      "de onde vem cada número",
      "posso recalcular as comparações",
    ],
    termos: [
      "raw", "staging", "canonico", "canonical", "comparison", "camada", "camadas",
      "pipeline", "celula", "rastro", "lastro", "procedencia", "recalcular",
    ],
    corpo:
      "São quatro camadas, e a separação é o que sustenta cada número até a célula de " +
      "origem:\n\n" +
      "**RAW** é imutável, garantido por trigger — cada célula da planilha como veio.\n" +
      "**STAGING** é descartável; é onde a leitura é conferida antes de valer.\n" +
      "**CANONICAL** é o grão do produto: `(snapshot, entidade, atributo) → valor`.\n" +
      "**COMPARISON** é derivado, e pode ser recalculado a qualquer momento.\n\n" +
      "É por isso que toda alteração exibida consegue apontar para a célula que a " +
      "originou, e por que recalcular comparações nunca perde dado: o que é derivado " +
      "pode ser refeito, o que é evidência não é tocado.",
    fonte: "docs/ARQUITETURA.md",
    tela: { label: "Cobertura de dados", href: "/dados" },
  },
  {
    id: "conceito-curadoria",
    area: "CONCEITO",
    titulo: "Curadoria: o que o produto sabe sobre cada coluna",
    perguntas: [
      "o que é curadoria",
      "o que é semântica de um atributo",
      "por que um atributo está como desconhecido",
      "como confirmo um atributo",
    ],
    termos: [
      "curadoria", "semantica", "atributo", "confirmar", "confirmacao", "unknown",
      "desconhecida", "proposta", "unidade de medida", "agregacao", "monetario",
    ],
    corpo:
      "O export não diz o que suas colunas significam. A Curadoria é onde isso é " +
      "decidido: se o atributo é monetário, em que unidade, com que periodicidade, e se " +
      "pode ser somado.\n\n" +
      "O produto propõe a partir de evidência, mas **não presume semântica sem evidência " +
      "suficiente**: `UNKNOWN` é uma resposta aceitável; certeza fabricada não é. " +
      "Enquanto um atributo monetário não é confirmado, a variação dele aparece na tela " +
      "mas não entra em nenhum total — é exatamente isso que a cobertura da apuração " +
      "mede.\n\n" +
      "Confirmação é ato humano e fica registrada com quem fez, lida da sessão. O " +
      "servidor ignora qualquer nome que venha no corpo do pedido.",
    fonte: "lib/curation/src/engine.ts",
    tela: { label: "Curadoria", href: "/curadoria" },
  },
  {
    id: "conceito-versoes",
    area: "CONCEITO",
    titulo: "Mudança na fonte × correção da nossa leitura",
    perguntas: [
      "qual a diferença entre mudança na fonte e correção",
      "como corrijo a semântica de um atributo",
      "por que existem duas ações diferentes em versões",
    ],
    termos: [
      "versao", "versoes", "correcao", "mudanca na fonte", "source change",
      "semantica versionada", "vigencia da semantica", "reescrever",
    ],
    corpo:
      "São ações distintas e nunca compartilham botão.\n\n" +
      "**Mudança na fonte** cria uma versão nova da semântica, com vigência a partir de " +
      "uma data. O que já foi comparado sob a semântica anterior continua correto — " +
      "porque naquele dia era aquilo.\n\n" +
      "**Correção da nossa interpretação** reescreve a versão existente. É admitir que " +
      "lemos errado desde o começo, e o efeito retroage.\n\n" +
      "Misturar as duas produziria um histórico em que ninguém distingue \"a Ambev " +
      "mudou a regra\" de \"nós entendemos errado\", que são conclusões opostas sobre a " +
      "mesma diferença.",
    fonte: "lib/curation/src/versioning.ts",
    tela: { label: "Versões", href: "/versoes" },
  },
  {
    id: "conceito-importacao",
    area: "CONCEITO",
    titulo: "Como importar uma planilha",
    perguntas: [
      "como importo uma planilha",
      "como subo o export do freightec",
      "por que minha importação foi recusada",
      "importei o mesmo arquivo duas vezes",
    ],
    termos: [
      "importar", "importacao", "importacoes", "upload", "planilha", "xlsx", "export",
      "duplicado", "sha", "recusado", "promover",
    ],
    corpo:
      "Importar é feito **pela interface**, em Importações — nenhum passo do produto " +
      "depende de terminal.\n\n" +
      "O arquivo é recebido, capturado em RAW célula a célula, preparado e conferido " +
      "numa prévia. Só depois disso alguém decide promover, e é a promoção que faz a " +
      "vigência valer.\n\n" +
      "Reenviar o mesmo conteúdo é recusado: o SHA-256 é o mesmo de um envio anterior, e " +
      "o mesmo conteúdo não gera vigência nova. Arquivo que não seja `.xlsx` também é " +
      "recusado, porque o Freightec entrega planilhas Excel.",
    fonte: "artifacts/api-server/src/routes/imports.ts",
    tela: { label: "Importações", href: "/importacoes" },
  },
  {
    id: "conceito-acesso",
    area: "CONCEITO",
    titulo: "Contas, sessão e quem fez o quê",
    perguntas: [
      "como crio um usuário",
      "como recupero minha senha",
      "quem pode fazer o quê no produto",
      "posso apagar uma conta",
    ],
    termos: [
      "usuario", "conta", "senha", "login", "sessao", "acesso", "permissao", "papel",
      "desativar", "configuracoes", "esqueci a senha",
    ],
    corpo:
      "Contas nascem em Configurações, criadas por quem já tem acesso. A tela de login " +
      "só entra — não cadastra. Não há recuperação de senha por e-mail, porque este " +
      "produto não manda e-mail e fingir que manda seria pior: quem esqueceu a senha " +
      "pede a redefinição a alguém que já está dentro.\n\n" +
      "**Não há papéis.** Quem entra pode tudo, inclusive dar e tirar acesso, e a tela " +
      "diz isso em vez de sugerir uma hierarquia que o servidor não tem. O que fica " +
      "registrado é *quem fez*.\n\n" +
      "**Ninguém é apagado, só desativado.** As confirmações já feitas apontam para essas " +
      "contas; apagar uma transformaria um histórico auditável num e-mail órfão. " +
      "Desativar tira o acesso, derruba as sessões abertas na hora e preserva o " +
      "histórico. Não dá para desativar a própria conta nem a última que ainda está " +
      "ativa.",
    fonte: "artifacts/api-server/src/lib/session.ts",
    tela: { label: "Usuário", href: "/configuracoes" },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LEITURA E ARMADILHAS
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "leitura-ipva",
    area: "LEITURA",
    titulo: "A armadilha do IPVA mensal × anual",
    perguntas: [
      "por que o ipva mensal é maior que o anual",
      "o ipva está errado",
      "posso somar ipva mensal e anual",
    ],
    termos: [
      "ipva", "licenciamento", "mensal", "anual", "armadilha", "coluna", "maior que",
      "nome da coluna",
    ],
    corpo:
      "O nome da coluna não é a semântica dela. Há colunas no export cujo rótulo diz " +
      "\"mensal\" e cujo valor é várias vezes maior que o da coluna \"anual\" " +
      "correspondente — o que torna impossível que as duas sejam a mesma grandeza em " +
      "escalas diferentes.\n\n" +
      "O produto não resolve isso adivinhando. Ele detecta o conflito de periodicidade, " +
      "marca o par e manda para a Curadoria, onde alguém decide com evidência. Até lá, " +
      "as duas colunas não entram no mesmo total.\n\n" +
      "Esta é a armadilha que mais justifica o Book do Operador existir: nenhuma " +
      "quantidade de planilha responde \"o que esta coluna significa\".",
    fonte: "docs/ACHADO-IPVA.md",
    tela: { label: "Curadoria", href: "/curadoria" },
  },
  {
    id: "leitura-anomalias",
    area: "LEITURA",
    titulo: "Data virou número, número virou data",
    perguntas: [
      "por que aparece um número enorme onde era uma data",
      "o valor mudou de 45000 para uma data",
      "o que é anomalia de formato",
    ],
    termos: [
      "anomalia", "formato", "serial", "excel", "data", "numero", "45000",
      "data como numero", "conversao",
    ],
    corpo:
      "O Excel guarda datas como número de série. Quando uma célula que era data " +
      "aparece numa vigência como número — ou o contrário —, isso não é uma alteração de " +
      "valor: é a mesma informação escrita de outro jeito.\n\n" +
      "O produto detecta esse par e marca a alteração como anomalia de formato, em vez " +
      "de reportar que um contrato passou a valer até o ano 45000. A detecção é " +
      "conservadora e só atua na faixa de números que corresponde a datas plausíveis.\n\n" +
      "Quando **todas** as linhas do ponto são disso — o número, lido como serial, é o " +
      "mesmo instante da data anterior —, o ponto deixa de ser tratado como alteração " +
      "contratual: ganha o selo \"Formato da fonte\", criticidade baixa e o fim da fila. " +
      "Nada some: as linhas continuam contadas no total da vigência, ditas à parte como " +
      "troca de formato, e abríveis até a célula de origem. Se sobrar uma linha em que a " +
      "data por trás do número é outra, o ponto volta a ser alteração — aí há formato e " +
      "mudança de valor na mesma célula, e é essa parte que alguém precisa conferir.",
    fonte: "lib/comparison/src/anomalies.ts",
    tela: { label: "Alterações", href: "/alteracoes" },
  },
  {
    id: "leitura-inconclusiva",
    area: "LEITURA",
    titulo: "Quando a comparação não é confiável",
    perguntas: [
      "o que quer dizer inconclusiva",
      "por que essa alteração não tem valor",
      "a comparação é confiável",
    ],
    termos: [
      "inconclusiva", "inconclusivo", "comparabilidade", "confiavel", "nao comparavel",
      "deriva", "drift", "semantica mudou",
    ],
    corpo:
      "Uma alteração é marcada como inconclusiva quando a comparação entre as duas " +
      "vigências não sustenta uma conclusão — tipicamente porque a semântica do atributo " +
      "mudou entre elas, ou porque uma das pontas não tem valor comparável.\n\n" +
      "A alternativa seria exibir uma diferença numérica entre duas coisas que não são a " +
      "mesma grandeza. O produto prefere dizer que não sabe, e dizer por quê.",
    fonte: "lib/comparison/src/engine.ts",
    tela: { label: "Alterações", href: "/alteracoes" },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // NAVEGAÇÃO
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "navegacao-onde",
    area: "NAVEGACAO",
    titulo: "Qual tela responde qual pergunta",
    perguntas: [
      "onde vejo o que mudou",
      "qual tela usar",
      "onde encontro cada coisa",
      "como navego no freightcheck",
    ],
    termos: [
      "tela", "telas", "menu", "onde vejo", "onde acho", "navegacao", "funcionalidade",
      "modulo", "modulos",
    ],
    corpo:
      "O menu tem cinco seções, e no topo dele fica a unidade aberta — unidade, canal e " +
      "vigência mais recente da seleção que os números da tela estão usando.\n\n" +
      "**Visão executiva**\n" +
      "*Resumo executivo* — o panorama do que existe.\n" +
      "*Acompanhamento* — o resumo de uma vigência.\n\n" +
      "**Auditoria**\n" +
      "*Alterações* — linha a linha, com veículo, valor anterior e valor novo.\n" +
      "*Comparar vigências* — duas vigências escolhidas à mão.\n" +
      "*Parâmetros* — o catálogo de cartões, com quanto mudou em cada gaveta.\n" +
      "*Vigências* — o histórico de datas.\n\n" +
      "**Frota**\n" +
      "*Análise de frota* — cavalos e carretas.\n\n" +
      "**Inteligência**\n" +
      "*Assistente IA* — esta conversa.\n" +
      "*Book do Operador* — as regras, por bloco.\n\n" +
      "**Dados & governança**\n" +
      "*Importações* — subir a planilha e promover.\n" +
      "*Rastreio de Dados* — se toda célula do arquivo chegou a algum lugar.\n" +
      "*Curadoria* — a semântica dos atributos e as confirmações.\n" +
      "*Cobertura de dados* — o que foi importado e o que falta.\n" +
      "*Versões* — mudança na fonte e correção da interpretação.\n\n" +
      "**Administração**\n" +
      "*Unidades* — as unidades e canais que já entregaram vigência.\n" +
      "*Usuários* — contas e acesso.\n\n" +
      "Alterações, Importações e Curadoria trazem no menu quanto há para fazer; onde não " +
      "há nada, não há número. Um item que não funciona não entra no menu: parecer o " +
      "Freightech não autoriza prometer uma tela que não existe.",
    fonte: "artifacts/freightaudit/src/components/layout/sidebar.tsx",
  },

  {
    id: "balanco-de-massa",
    area: "CONCEITO",
    titulo: "O que o Rastreio de Dados confere",
    perguntas: [
      "o que é o rastreio de dados",
      "o que é o balanço de massa",
      "como sei que nenhum dado se perdeu na importação",
      "a planilha inteira entrou no sistema",
      "o que o sistema descartou do arquivo",
    ],
    termos: [
      "rastreio", "rastreio de dados", "balanco", "balanco de massa",
      "conservacao", "sumiu", "perdeu", "perda", "descarte", "residuo",
      "celula", "celulas", "conferencia", "fechamento", "conciliacao",
      "o que nao entrou",
    ],
    corpo:
      "Todas as outras telas respondem *de onde veio este número*. O Rastreio de Dados " +
      "responde à pergunta inversa: **toda célula que o arquivo trouxe chegou a algum " +
      "lugar?** As duas importam, e só a segunda pega o defeito que não se vê — dado " +
      "que some não aparece em tela nenhuma, porque o que falta não é exibido.\n\n" +
      "A conta tem três etapas. Da planilha ao preparo, célula a célula: cada uma sai " +
      "por um destino declarado — virou fato, virou cabeçalho, virou vigência ou placa, " +
      "foi descartada por regra escrita, ou foi recusada com motivo. Do preparo à " +
      "vigência, fato a fato. E o portão da semântica, que separa o fato que já pode " +
      "entrar numa soma do que ainda espera confirmação da Curadoria.\n\n" +
      "Três palavras que a tela não deixa se confundirem. **Descarte** é saída sem " +
      "perda de informação: uma linha em branco, uma aba de pivô que só refaz conta " +
      "sobre dados que já entraram. **Perda declarada** é o arquivo trazer e o sistema " +
      "recusar, com motivo e com o endereço da célula — uma linha sem placa, uma coluna " +
      "sem cabeçalho, duas colunas que colidem no mesmo código. **Resíduo** é célula " +
      "que sumiu sem destino, e é a única das três que significa defeito: o balanço " +
      "fecha quando ele é zero, e uma importação pode fechar tendo perdas.",
    fonte: "lib/balance/src/destinos.ts",
    tela: { label: "Rastreio de Dados", href: "/rastreio-de-dados" },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // O QUE O ASSISTENTE RECUSA
  // ══════════════════════════════════════════════════════════════════════════
  {
    id: "recusa-assistente",
    area: "RECUSA",
    titulo: "O que este assistente não faz",
    perguntas: [
      "o assistente pode inventar números",
      "posso confiar no que o assistente responde",
      "o assistente usa ia",
      "de onde vêm as respostas",
    ],
    termos: [
      "assistente", "ia", "inteligencia artificial", "confiar", "inventar", "alucinar",
      "fonte", "de onde vem", "chatbot",
    ],
    corpo:
      "Este assistente responde a partir de duas coisas, e de nada além delas: o " +
      "conhecimento do produto escrito em código — que passa por revisão como qualquer " +
      "outro código — e consultas ao próprio banco, feitas na hora, dentro do recorte " +
      "que você escolheu.\n\n" +
      "Todo número que ele diz vem de uma consulta, aparece com a tela onde pode ser " +
      "conferido, e nunca é estimado. Quando a pergunta pede um número que o produto não " +
      "sustenta, a resposta é dizer isso — pela mesma razão que a cobertura da apuração " +
      "aparece em 0% em vez de aparecer como zero de impacto.\n\n" +
      "Quando há um modelo de linguagem configurado, ele é usado para **redigir** a " +
      "resposta sobre os fatos já recuperados, e é instruído a não acrescentar nenhum. " +
      "Sem modelo configurado, o assistente responde do mesmo material, com a redação " +
      "montada em código. A resposta diz qual dos dois caminhos produziu o texto.",
    fonte: "lib/assistant/src/resposta.ts",
    tela: { label: "Assistente de IA", href: "/assistente" },
  },
];

/** As perguntas oferecidas na tela quando ninguém digitou nada ainda. */
export const SUGESTOES: { pergunta: string; area: Area }[] = [
  { pergunta: "O que a tela de Parâmetros mostra que o Freightech não mostra?", area: "PARAMETROS" },
  { pergunta: "Por que a cobertura da apuração está em 0%?", area: "PARAMETROS" },
  { pergunta: "Qual a diferença entre Movimentos do período e Ponta a ponta?", area: "PARAMETROS" },
  { pergunta: "Quanto mudou na última vigência?", area: "PARAMETROS" },
  { pergunta: "O que é o Book do Operador?", area: "BOOK" },
  { pergunta: "Quais blocos do Book já têm regra registrada?", area: "BOOK" },
  { pergunta: "Como substituo um documento do Book?", area: "BOOK" },
  { pergunta: "Por que o IPVA mensal é maior que o anual?", area: "LEITURA" },
  { pergunta: "Por que preciso escolher unidade e canal?", area: "CONCEITO" },
  { pergunta: "O que é curadoria e por que um atributo fica sem semântica?", area: "CONCEITO" },
];
