/**
 * O vocabulário de quem pergunta não é o vocabulário das colunas.
 *
 * Quem opera diz "quanto o pneu subiu", não `pneuMensal`; diz "chamado", não
 * "curadoria"; escreve "vigencia" sem acento porque estava com pressa. Este
 * módulo é a única camada que sabe disso, e é deliberadamente burra: comparar
 * texto sem acento e sem caixa, contar quantos termos de um assunto aparecem
 * na frase, e nada além. Não há embedding, não há modelo, não há aprendizado.
 *
 * O motivo é o mesmo do resto do produto: o que decide qual resposta sai daqui
 * precisa ser explicável a quem discordar dela. Uma pontuação que se lê em três
 * linhas de código pode ser conferida; uma que sai de um vetor de 1536
 * dimensões, não.
 */

/**
 * Como se escreve depressa — e é a mesma palavra.
 *
 * `qnt mudou o pneu?` perdia as duas coisas de uma vez: nenhum detector casava
 * (`quanto mudou` é a forma que EVOLUÇÃO conhece) e o assunto sumia, porque
 * `qnt` sobrava no candidato e o reconhecimento falhava com ele dentro.
 *
 * **Por que isto não é mais uma lista aberta.** Todas as expansões abaixo são
 * de palavras que já estão em `PALAVRAS_DE_PERGUNTA` — a classe fechada da
 * *forma* de perguntar. Não há nenhum assunto aqui, e não pode haver: o dia em
 * que alguém quiser escrever `pn` para `pneu`, a resposta certa é o índice do
 * Book, não esta tabela. Ela cresce com a ortografia do português apressado,
 * que é finita, e não com o catálogo, que não é.
 */
const ABREVIACOES: ReadonlyMap<string, string> = new Map([
  ["qnt", "quanto"], ["qto", "quanto"], ["qtos", "quantos"],
  ["pq", "porque"], ["pqe", "porque"],
  ["vc", "voce"], ["vcs", "voces"],
  ["tb", "tambem"], ["tbm", "tambem"],
  ["td", "tudo"], ["tds", "todos"],
  ["msm", "mesmo"],
  ["ta", "esta"], ["tao", "estao"],
  ["hj", "hoje"],
  ["blz", "beleza"], ["obg", "obrigado"],
]);

const FORMA_ABREVIADA = new RegExp(
  `\\b(${[...ABREVIACOES.keys()].join("|")})\\b`,
  "g",
);

/**
 * Sem acento, sem caixa — e sem a pressa de quem digitou.
 *
 * A expansão mora aqui, e não numa etapa à parte, porque este é o funil: os
 * detectores, `termos`, `pontuar` e o índice do Book todos passam por ele. Uma
 * camada separada teria de ser chamada em cada um deles, e o dia em que alguém
 * esquecesse um seria o dia em que `qnt` voltaria a ser um assunto.
 *
 * A troca é de palavra inteira (`\b`): `ta` vira `esta`, e `tarifa` continua
 * sendo tarifa.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(FORMA_ABREVIADA, (m) => ABREVIACOES.get(m) ?? m);
}

/**
 * As palavras da frase que valem para busca.
 *
 * Palavras com uma ou duas letras saem porque "de", "o", "em" aparecem em toda
 * pergunta e em todo artigo — mantê-las faria qualquer texto casar com qualquer
 * pergunta, que é o mesmo que não ter busca. `PALAVRAS_VAZIAS` cobre o resto do
 * português funcional, que tem palavras longas o bastante para passar pelo
 * filtro de tamanho ("quanto", "porque", "qual").
 */
export function termos(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((palavra) => palavra.length > 2 && !PALAVRAS_VAZIAS.has(palavra));
}

/**
 * Português funcional — o que aparece em toda pergunta e não distingue nenhuma.
 *
 * Note o que **não** está aqui: "book", "vigência", "parâmetro", "impacto".
 * São palavras comuns nas perguntas deste produto e é justamente por isso que
 * elas discriminam: quem as escreve está pedindo um assunto específico.
 */
const PALAVRAS_VAZIAS = new Set([
  "que", "qual", "quais", "quanto", "quantos", "quantas", "como", "onde", "quando",
  "porque", "por", "para", "pra", "com", "sem", "dos", "das", "nos", "nas", "num",
  "numa", "uma", "uns", "umas", "meu", "minha", "seu", "sua", "isso", "esse", "essa",
  "este", "esta", "aqui", "esta", "sao", "foi", "ser", "tem", "ter", "vai", "faz",
  "fazer", "pode", "posso", "quero", "preciso", "sobre", "mais", "menos", "muito",
  "todo", "toda", "todos", "todas", "outro", "outra", "mesmo", "mesma", "entre",
  "ate", "ate", "nao", "sim", "voce", "eu", "ele", "ela", "sei", "diz", "dizer",
  "explica", "explicar", "mostra", "mostrar", "quer", "temos", "tenho",
  "disso", "disto", "nisso", "aquilo", "algum", "alguma", "cada", "ainda",
  /*
    Os verbos com que se pergunta, e nunca se nomeia.

    "Como funciona IPVA?" era respondida pelo bloco "Transferências", cujo texto
    de origem começa com "Como funciona transferir frotas entre unidades" — o
    casamento inteiro estava em "funciona", e nada nele era sobre IPVA. Nenhuma
    coluna, gaveta ou bloco deste produto se chama assim; mantê-las na busca só
    aproximava perguntas que se parecem na forma e diferem no assunto.
  */
  "funciona", "funcionam", "funcionar", "significa", "significam", "serve",
  "servem", "calcula", "calculam", "acontece", "aconteceu", "existe", "existem",
]);

/**
 * Palavras com que se **pergunta**, e nunca se nomeia uma coisa.
 *
 * **O que esta lista deixou de ser.** Ela era "as palavras que não são
 * parâmetro" — e nessa forma continha `remuneracao`, `impacto`, `veiculo`,
 * `book`: o vocabulário do domínio, tratado como ruído. Uma lista assim é
 * aberta por construção; ela cresce com o que as pessoas escrevem, não com o
 * que o produto tem, e cada palavra que faltava nela virava um parâmetro
 * inexistente que desligava as consultas da pergunta.
 *
 * **O que ela é agora.** As palavras que compõem uma pergunta em português —
 * interrogativos, verbos de existência e de pedido, termos de comparação e de
 * juízo — mais os verbos com que se fala de mudança. É uma classe fechada: ela
 * descreve a *forma* de perguntar, que é finita, e não os *assuntos*, que não
 * são.
 *
 * **Por que ela mora aqui.** Ela tem dois consumidores, e os dois fazem a mesma
 * pergunta com ela: `interpretacao.ts`, para separar a forma do candidato a
 * assunto, e `indice-book.ts`, para não procurar no Book por palavras que não
 * nomeiam nada. Enquanto ela morava só na interpretação, a busca no Book
 * pontuava "teve", "existe" e "alguma" como conteúdo — e a largura de cobertura
 * punia o trecho certo por ele não conter os verbos da pergunta.
 */
export const PALAVRAS_DE_PERGUNTA = new Set([
  // interrogativos e dêiticos
  "quanto", "quantos", "quantas", "qual", "quais", "como", "onde", "quando",
  "esse", "essa", "isso", "esta", "este", "dessas", "desses", "dessa", "desse",
  "aquilo", "aquele", "aquela", "coisa", "coisas", "algo", "nada", "alguma", "algum",
  // existência e posse
  "teve", "tem", "tinha", "tiveram", "tivemos", "havia", "houve", "existe",
  "existem", "temos", "disponivel",
  // mudança, na forma verbal
  "mudou", "mudaram", "mudanca", "mudancas", "alterou", "alteracao", "alteracoes",
  "aconteceu", "acontece", "aconteceram", "ocorreu", "ocorreram", "rolou",
  "entrou", "saiu", "sofreram", "sofreu", "variou", "variacao", "evoluiu",
  "subiu", "caiu", "aumentou", "diminuiu", "reduziu", "cresceu",
  "custou", "custaram", "custa", "custam", "custar", "pesou", "pesaram",
  "impactou", "impactaram", "afetou", "afetaram", "influenciou",
  "reduzir", "aumentar", "subir", "cair", "mudar", "alterar", "variar",
  // perda e ganho nomeiam a medida do ranking; dinheiro e reais, a unidade
  "perdemos", "perda", "perdas", "perdeu", "perderam", "prejudicou",
  "ganhamos", "ganho", "ganhos", "ganhou", "ganharam", "dinheiro", "reais",
  // comparação e juízo
  "compare", "comparar", "comparacao", "versus", "contra", "diferenca",
  "maior", "menor", "melhor", "pior", "melhorou", "piorou", "relevante",
  "importante", "importantes", "principal", "principais", "estranho", "estranha",
  "fora", "padrao", "merece", "atencao", "vale", "pena", "preocupar",
  "tres", "dois", "duas", "ambos", "ambas", "apenas", "somente",
  // cópulas e particípios, que ligam sem nomear
  "foram", "foi", "era", "eram", "sido", "seja", "esta", "estao", "ficou",
  "impactado", "impactados", "impactada", "impactadas", "afetado", "afetados",
  "afetada", "afetadas", "sofrido", "sofridos", "calculado", "calculada",
  "apurado", "apurada", "importado", "importados", "importada", "importadas",
  // o eixo dos ativos: quem foi atingido, não o que mudou
  "veiculo", "veiculos", "placa", "placas", "ativo", "ativos", "caminhoes",
  // o eixo do tempo: delimita o recorte, nunca nomeia um assunto
  "desde", "entre", "periodo", "periodos", "mes", "meses", "ano", "anos",
  "dia", "dias", "semana", "semanas", "trimestre", "semestre",
  "vigencia", "vigencias", "ultimos", "ultimas", "recente", "recentes",
  // pedido e investigação
  "diga", "diz", "fala", "falar", "conta", "contar", "mostre", "mostrem",
  "exiba", "exibir", "liste", "listar", "traga", "trazer", "resuma", "resumo",
  "explique", "explica", "investigar", "investigacao", "verificar", "ver",
  "olhar", "saber", "entender", "deveria", "consegue", "conseguiu", "podem",
  "pode", "poderia", "quero", "queria", "gostaria", "preciso",
  // referência à conversa e às fontes
  "fonte", "fontes", "origem", "procedencia", "previsto", "prevista",
  "previstos", "previstas", "citado", "citada", "acima", "disse", "falou",
  "anterior", "anteriores", "seguinte", "proxima", "proximo", "passada",
  "passado", "ultima", "ultimo", "atual", "corrente", "primeira", "primeiro",
  "relacionada", "relacionado", "sobre",
  /*
    Como se nomeia a **fonte**, e nunca o assunto.

    "Book", "regra", "contrato", "bloco" dizem *onde procurar*; o assunto é o
    que vem depois deles. Tratá-los como assunto fazia "o Book cobre quantos
    blocos?" procurar uma gaveta chamada `book cobre blocos` — e, por o produto
    reconhecer "book" no título dos seus próprios blocos, a pergunta deixava de
    consultar a cobertura que ela pedia.

    É a fatia estreita e segura de uma distinção maior: no ranqueamento do Book
    estas palavras também não deveriam pontuar como conteúdo, e é por isso que
    "o que o Book diz sobre pneu?" ainda traz BOOK VALE PEDÁGIO à frente de
    PNEU. Aquilo se resolve no ranqueamento, não aqui.
  */
  "book", "operador", "bloco", "blocos", "cobre", "cobertura", "cobertos",
  "regra", "regras", "contrato", "manual", "capitulo", "secao", "item",
  // como se pede um documento — nunca como se chama um
  "documento", "documentos", "anexo", "anexos", "anexado", "anexada",
  "arquivo", "arquivos", "conteudo", "ler", "leia", "leu", "abrir", "abre",
  "abra", "transcreve", "transcrever",
  // interlocutores e destinatários
  "diretor", "diretoria", "operacao", "assistente", "voce", "estivesse",
  "falando", "minha", "meu", "eu",
  // os meses, que nomeiam o recorte e nunca o assunto
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
]);

/**
 * Quanto desta pergunta é sobre este assunto.
 *
 * Conta quantos termos do assunto aparecem na pergunta, com dois pesos: o termo
 * escrito inteiro vale mais que o termo encontrado dentro de outra palavra, e um
 * termo de várias palavras ("book do operador") vale pelo tamanho, porque quem
 * digita a expressão inteira está sendo específico e merece ser levado a sério.
 *
 * A pontuação é dividida pelo número de termos do assunto: sem isso, um assunto
 * com quarenta sinônimos venceria todos os outros só por ser mais gordo.
 */
export function pontuar(pergunta: string, termosDoAssunto: string[]): number {
  if (termosDoAssunto.length === 0) return 0;
  const frase = normalizar(pergunta);
  const palavras = new Set(termos(pergunta));

  let pontos = 0;
  for (const bruto of termosDoAssunto) {
    const termo = normalizar(bruto);
    if (!termo) continue;

    if (termo.includes(" ")) {
      // Expressão: só conta inteira, e vale pelo número de palavras dela.
      if (frase.includes(termo)) pontos += termo.split(" ").length * 2;
      continue;
    }

    if (palavras.has(termo)) pontos += 2;
    else if (termo.length > 4 && variante(termo, palavras)) pontos += 1;
  }

  return pontos / termosDoAssunto.length;
}

/**
 * O termo aparece na pergunta como variante de uma palavra inteira?
 *
 * Só conta prefixo, nos dois sentidos — "vigencias" casa com "vigencia" e
 * vice-versa —, e nunca casa no meio de outra palavra. A regra anterior era
 * `frase.includes(termo)`, e ela dava um ponto de "revisão" para quem
 * perguntasse a **previsão** do tempo: "previsao" termina com "revisao". Uma
 * pergunta claramente fora do assunto passava a recuperar um artigo sobre o
 * Book, que é exatamente o erro que o limiar existe para impedir.
 */
function variante(termo: string, palavras: Set<string>): boolean {
  for (const palavra of palavras) {
    if (palavra.startsWith(termo) && flexao(palavra, termo)) return true;
    if (palavra.length > 4 && termo.startsWith(palavra) && flexao(termo, palavra)) return true;
  }
  return false;
}

/**
 * O que sobra do prefixo é flexão da mesma palavra, ou é outra palavra?
 *
 * A regra anterior aceitava qualquer prefixo, e o resultado foi este: quem
 * perguntou "me dá o CPF do **motorista** da placa ABC1D23" recebeu o cartão
 * **Motor** do catálogo a 0,800 — o casamento inteiro estava em `motorista`
 * começar com `motor`. Um sufixo derivacional não flexiona uma palavra, faz
 * outra: `-ista`, `-agem`, `-mento`, `-dade` mudam o que a palavra nomeia.
 *
 * O corte é o comprimento do que sobra. Flexão do português é curta — plural
 * (`vigencia`/`vigencias`), gênero (`apurado`/`apurada`), e no máximo os dois
 * juntos. Duas letras cobrem isso e não cobrem `-ista`.
 */
function flexao(longa: string, curta: string): boolean {
  return longa.length - curta.length <= 2;
}

/**
 * O termo mais provável quando a pergunta nomeia uma coisa do produto.
 *
 * Devolve a sequência de palavras significativas mais longa da pergunta, que é
 * o melhor palpite para "PNEU", "IPVA", "Índice de Reajuste" — e é passado às
 * buscas por nome de bloco e de parâmetro. Não tenta ser esperto: se errar, a
 * busca por nome não acha nada e a resposta diz que não achou, em vez de achar
 * a coisa errada com confiança.
 */
export function alvoProvavel(pergunta: string): string {
  const palavras = termos(pergunta);
  return palavras.join(" ");
}
