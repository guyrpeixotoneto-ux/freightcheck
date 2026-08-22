/**
 * O que esta pergunta precisa que seja descoberto — e não "de que tipo ela é".
 *
 * **O desenho que este módulo substitui.** A classificação era uma lista
 * ordenada de vinte padrões, e o primeiro que casasse vencia. Isso embutia três
 * afirmações que o domínio não sustenta. Primeira: toda pergunta pede **uma**
 * coisa — mas "teve alteração na remuneração de pneu e existe alguma regra do
 * Book relacionada?" pede duas, e a lista devolvia uma. Segunda: a ordem entre
 * os padrões é uma verdade sobre as perguntas — mas ela era só a ordem em que
 * os padrões foram escritos, e mexer nela mudava em que fonte o produto ia
 * procurar. Terceira, e a mais cara: **não casar nenhum padrão significa não
 * consultar nada** — e era assim que "resuma agosto para a diretoria" terminava
 * sem uma linha de dado, porque nenhum padrão prevê a palavra "resuma".
 *
 * **O que existe agora.** Cada necessidade tem o seu detector, todos rodam, e
 * nenhum exclui os outros. O resultado é um **conjunto**: uma pergunta pode
 * precisar do movimento da vigência *e* da regra do Book, e as duas são
 * executadas. Não há ordem de desempate porque não há desempate.
 *
 * **Duas regras fecham o buraco do "nada casou".**
 *
 * A primeira é o *plano padrão*: quando nenhum detector reconhece o que se
 * quer, mas a pergunta está **ancorada** neste produto — nomeia um assunto, um
 * período, um equipamento, ou continua uma conversa aberta —, a leitura que
 * erra menos é investigar o recorte: o que mudou e o que mais pesou. É o que um
 * analista faz quando lhe pedem "me diga o que importa" sem dizer sobre o quê.
 *
 * A segunda é que **o plano reage à evidência**. A busca no Book roda para toda
 * pergunta e o limiar decide o que entra; quando ela devolve regra e nenhum
 * detector de dado disparou, a necessidade *é* a regra do Book — independente
 * de a frase conter a palavra "Book". Foi assim que "com que frequência a
 * auditoria QLP ADM acontece?" deixou de ser uma pergunta sem classificação:
 * ela sempre recuperou a seção certa, e o que faltava era o plano olhar para o
 * que a recuperação trouxe em vez de só para o que a frase disse.
 *
 * **O que isto não é.** Não é o fim da detecção lexical: os detectores abaixo
 * continuam olhando para palavras. O que acabou foi o *vencedor único* e a
 * *ordem como regra de desempate* — e é daí que vinha a fragilidade, não do
 * léxico. Um detector novo acrescenta uma necessidade; ele não rouba as outras.
 */

import { normalizar } from "./normalizar";
import type { Intencao, Leitura } from "./interpretacao";

/**
 * O que precisa ser descoberto.
 *
 * Os nomes coincidem com os da `Intencao` de propósito: a necessidade
 * principal continua saindo na resposta, no estado da conversa e no painel
 * técnico com o mesmo rótulo de sempre, e nada fora deste módulo precisou
 * aprender um vocabulário novo para acompanhar a mudança.
 */
export type Necessidade = Intencao;

export interface Plano {
  /** Tudo o que esta pergunta precisa. Nunca vazio, exceto em saudação. */
  necessidades: Necessidade[];
  /** A que dá nome à resposta — a primeira da lista. */
  principal: Necessidade;
  /** Por que este plano — uma frase por necessidade, para o painel técnico. */
  porque: string[];
  /** A pergunta está ancorada neste produto? Decide o plano padrão. */
  ancorada: boolean;
  /**
   * A necessidade do Book veio da **evidência recuperada**, não da frase.
   *
   * Quem consome precisa distinguir as duas: perguntar *sobre o Book* ("quantos
   * blocos já têm regra?") pede a estatística de cobertura; ter uma regra
   * recuperada que responde a pergunta pede a regra, e a estatística ao lado
   * dela seria trocar a resposta pela ficha.
   */
  bookPorEvidencia: boolean;
}

interface Detector {
  necessidade: Necessidade;
  quando: RegExp;
  /**
   * A forma que casa `quando` e mesmo assim não é esta necessidade.
   *
   * Existe porque alargar um vocabulário cria vizinhança: quando VALOR passou
   * a conhecer `preço`, ele passou a casar duas perguntas que não são de
   * valor — "o que é preço de combustível?" (definição) e "temos preço de
   * combustível?" (disponibilidade). Trocar um erro por outro não é corrigir.
   *
   * Como campo, e não como `(?!...)` embutido, porque a exceção é uma
   * afirmação sobre o domínio — "perguntar se temos o preço não é perguntar o
   * preço" — e merece ser lida como tal, em vez de ficar escondida no começo
   * de uma expressão de duzentos caracteres.
   */
  exceto?: RegExp;
  porque: string;
}

/** O detector casa a frase, e a exceção dele não. */
const casa = (d: Detector, frase: string): boolean =>
  d.quando.test(frase) && !(d.exceto?.test(frase) ?? false);

/**
 * Um detector por necessidade — e a ordem aqui não decide nada.
 *
 * Ela é só a ordem de leitura. Como todos rodam e nenhum exclui os outros,
 * mover uma linha daqui não muda em que fonte o produto procura, que era
 * exatamente o que acontecia na lista anterior.
 */
const DETECTORES: Detector[] = [
  {
    necessidade: "PROCEDENCIA",
    quando: /\b(de onde ve(io|m)|de onde (saiu|sai)|qual a (fonte|origem|procedencia)|onde (esta|ta) escrito|me mostre? a fonte|por que(m)? (isso|isto|esse|essa))\b/,
    porque: "pede a origem de uma afirmação",
  },
  /*
    A meta-pergunta. Ela é sobre a **resposta anterior**, e o vocabulário aqui é
    o de quem duvida de uma conclusão — não o de quem pede um número.

    `de onde tirou` e `como voce sabe` moram aqui e não em PROCEDENCIA de
    propósito: os dois perguntam pelo **fundamento da afirmação**, e quem
    pergunta pela origem de um valor escreve "de onde saiu esse número". A
    resposta da sustentação termina oferecendo a descida até a planilha, então
    quem quis a origem chega lá pelo passo seguinte — e quem quis saber se pode
    confiar recebe o que perguntou.
  */
  {
    necessidade: "SUSTENTACAO",
    quando:
      /\b(tem certeza|voce tem certeza|certeza disso|confirma|voce confirma|tem confianca|qual (a|e a) confianca|quao (confiavel|seguro)|como voce sabe|como sabe disso|de onde (voce )?tirou|isso (e|esta) (certo|correto)|posso confiar|da para confiar|isso procede|voce garante)\b/,
    /*
      **Dúvida com uma afirmação rival não é a meta-pergunta.**

      "Tem certeza?" pede a qualidade da conclusão anterior. "Confirma que o
      impacto de agosto foi de R$ 50 mil?" traz um número que não saiu de
      consulta nenhuma e pede que ele seja confirmado — e a única resposta
      honesta a isso é **consultar** e dizer qual é o número apurado. Tratá-la
      como meta-pergunta devolveria uma auditoria da resposta anterior a quem
      pediu a verificação de um valor, e o valor falso ficaria sem contestação.

      A fronteira é a presença da proposição: `certeza que…`, `confirma que…`,
      ou uma quantia escrita na própria pergunta. As duas formas declaram que há
      algo **externo** a conferir; a dúvida nua não declara nada além da dúvida.
    */
    exceto:
      /\b(certeza (de )?que|confirma (me )?que|garante que|procede que)\b|r\$\s*\d|\b\d[\d.,]*\s*(mil|milh(ao|oes))?\s*reais\b/,
    porque: "pergunta sobre a qualidade da resposta anterior, não sobre o assunto",
  },
  /*
    O cálculo derivado.

    O vocabulário é o da composição — por ano, percentual, média, diferença,
    projeção — e a exceção existe porque duas dessas palavras também aparecem
    em perguntas de consulta. "Qual a média de consumo negociado?" pede um
    parâmetro, não uma composição; "quanto foi a diferença entre julho e
    agosto?" é comparação de vigências, e o motor já a apura.
  */
  {
    necessidade: "CALCULO",
    quando:
      /\b(por ano|anualiz\w*|ao ano|em (12|doze) meses|se continuar assim|se (isso|isso se) (mantiver|manter|repetir)|projet\w*|extrapol\w*)\b|\bqu(al|e) (o |a )?(percentual|porcentagem|proporcao|fracao)\b|\bquantos? por cento\b|\brepresenta (quanto|que percentual|quantos? por cento)\b|\bqual (a )?media\b|\bem media\b|\bdiferenca percentual\b|\bvariacao percentual\b/,
    exceto: /\bmedia (de|do|da) \w+ (negociad|contratad|praticad)/,
    porque: "pede uma grandeza derivada de números já apurados",
  },
  {
    necessidade: "SEM_PRECO",
    quando: /\b(nao (tem|temos|foi|conseguimos|da para) (preco|precificar|calcular|valorar))\b|\bsem (preco|valoracao|semantica)\b|\bsemantica (nao|ainda nao) confirmada\b|\bnao (apuravel|calculavel|precificad\w*)/,
    porque: "pede o que não pôde ser precificado",
  },
  {
    necessidade: "BALANCO",
    quando: /\bbalanco( de massa)?\b|\bcelulas (lidas|importadas|viraram)\b|\bnao promoveu\b|\bpor que .{0,20}(nao )?promov\w*/,
    porque: "pergunta o que entrou e o que virou fato",
  },
  {
    necessidade: "IMPORTACOES",
    quando: /\bimportac(ao|oes)\b|\bqual (foi )?(o|a) (ultimo|ultima) (import|arquivo|planilha)\w*\b|\bquando (o |a )?(arquivo|planilha|export)\b|\barquivos? (importad|enviad)\w*\b/,
    porque: "pergunta o histórico de importação",
  },
  {
    necessidade: "CELULAS",
    quando: /\b(procur\w+|busc\w+|onde (esta|aparece)|em que|qual)\b.{0,40}\b(celula|celulas|planilha|planilhas|aba|abas|arquivo importado)\b/,
    porque: "pede uma busca nas células importadas",
  },
  {
    necessidade: "PANORAMA",
    quando: /\b(o que (temos|ja foi) importad\w*|quantas vigencias|quantos (ativos|veiculos|caminhoes|placas|atributos|parametros)|panorama|situacao (do|da) (banco|base)|o que (tem|existe) (no|na) (banco|base))/,
    porque: "pede o estado geral do que foi importado",
  },
  {
    necessidade: "CATALOGO_DE_CONTEXTO",
    quando: /\bquais (vigencias|unidades|canais|contextos|operacoes)\b|\bque vigencias\b|\blista de vigencias\b/,
    porque: "pede que recortes existem",
  },
  {
    necessidade: "CURADORIA",
    quando: /\bcuradoria\b|\bfalta(m)? confirmar\b|\b(quantos|quais) atributos?\b.*\bsem(antica)?\b|\bnao (foram )?classificad\w*\b/,
    porque: "pergunta o estado da curadoria",
  },
  {
    necessidade: "COMPOSICAO",
    /*
      A forma em lista é a mesma pergunta.

      "Quais parâmetros impactam a remuneração do cavalo?" não casava nada — e
      uma pergunta que não casa nada recebe o plano padrão, que é o movimento
      do recorte. Quem pergunta **de que** a remuneração é feita não está
      perguntando o que mudou nela: `quais parâmetros/itens/componentes` +
      `compõem/impactam/entram/fazem parte` é composição escrita como lista.
    */
    quando: /\bcomposicao\b|\bcomo se comp(oe|õe)\b|\bficha (do|da) (cavalo|carreta|equipamento|veiculo)\b|\bvisao (de|da) frota\b|\b(quais|que|quantos) (parametros?|itens?|componentes?|verbas?|rubricas?)\b[^?]{0,30}\b(comp(oe|oem|õe|õem)|impactam?|entram?|formam?|fazem parte|constituem|integram)\b/,
    porque: "pede a composição da remuneração",
  },
  {
    necessidade: "DISPONIBILIDADE",
    quando: /\b(temos|existe|existem|ha|tem)\b[^?]{0,30}\b(parametro|coluna|dado|informacao|preco|valor)\b/,
    porque: "pergunta se o dado existe no produto",
  },
  {
    necessidade: "BOOK",
    quando: /\bbook\b|\bregra (do|de|da)\b|\bcontrato\b|\bmanual\b|\b(documento|documentos|anexo|anexos|anexad\w*)\b|\bprevist\w+\b|\bexigid\w+\b|\bo que (acontece|ocorre) se\b|\bqual o prazo\b|\bcom que frequencia\b/,
    porque: "pede o que está escrito na regra",
  },
  {
    necessidade: "CONCEITUAL",
    quando: /\b(o que (e|sao|significa)|que e|como funciona|como e (calculad\w*|compost\w*|apurad\w*|feito)|como [\w\s]{0,20}?(calcula|apura|acumula|monta|deriva)\w*|do que (e|se) comp\w*|explique|explica|defini(cao|r)|para que serve|qual a (formula|regra|logica))\b/,
    porque: "pede definição ou funcionamento",
  },
  {
    necessidade: "COMPARACAO",
    quando: /\bcompar(e|ar|ando|acao)\b|\bversus\b|\bvs\b|\b\w+\s+(x|contra)\s+\w+\b|\bdiferenca entre\b/,
    porque: "pede confronto entre dois recortes",
  },
  {
    necessidade: "EVOLUCAO",
    quando: /\bdesde\b|\bao longo\b|\bevolu(cao|iu|ir)\b|\bhistorico\b|\bserie\b|\bde \w+ (a|ate|para) \w+\b|\bnos ultimos\b|\bquanto (mudou|variou|subiu|caiu|aumentou|diminuiu)\b/,
    porque: "delimita um intervalo de vigências",
  },
  /*
    A DRE vem **antes** de COMPOSIÇÃO, e a ordem é a que separa duas perguntas
    quase idênticas na forma. "Como se compõe a remuneração do ABC1D23?" é
    composição — a memória de cálculo do que ele recebe. "Quanto sobra do
    ABC1D23?" é DRE: o que resta depois dos custos.

    Aqui, onde os detectores não se excluem, "antes" quer dizer só a ordem de
    leitura em ORDEM — as duas necessidades podem coexistir, e quando coexistem
    é a DRE que dá nome à resposta. O `(?!...)` na frente continua devolvendo a
    CONCEITUAL as perguntas de definição: "o que é DRE?" não é uma consulta de
    resultado.
  */
  {
    necessidade: "DRE",
    quando:
      /^(?!.*\b(o que (e|sao|significa)|que e|como funciona|explique|explica|defini(cao|r)|para que serve)\b).*?(?:\bdre\b|\bebitda\b|\bmargem( de contribuicao)?\b|\bresultado (economico|apurado|operacional)\b|\bda (dinheiro|lucro|prejuizo)\b|\b(prejuizo|lucrativ\w*|deficitari\w*|rentabilidade|rentav\w*)\b|\bquanto (sobra|sobrou|resta|restou)\b|\b(caminh(ao|oes)|cavalo?s?|veiculos?|conjuntos?)\b.{0,25}\b(da|dao|deu|deram) (mais )?(dinheiro|lucro|prejuizo)\b|\bcusto por km\b|\bcusto\/km\b|\b[a-z]{3}\d[a-z0-9]\d{2}\b.{0,40}\b(piorou|melhorou|caiu|despencou|desandou)\b)/,
    porque: "pede o resultado econômico apurado",
  },
  /*
    O vocabulário do ranking, e as duas formas que faltavam.

    `impact\w* negativ\w*` e `negativamente` são o jeito executivo de pedir a
    mesma coisa que "onde perdemos mais?" — e a bateria de desfecho registra a
    ausência delas como defeito conhecido desde que foi escrita: "o detector
    casa `perdemos|perda|piorou|caiu`, e 'impactou negativamente' não está na
    lista; a pergunta cai no plano padrão e recebe o agregado".

    Isto **não** é um `if pergunta = X`: são duas formas de dizer perda, na
    língua de quem apresenta resultado a diretoria. O que seria um caso especial
    é uma entrada por frase; o que se acrescenta aqui é vocabulário.
  */
  {
    necessidade: "RANKING_PERDA",
    quando: /\b(perdemos|perda|perdas|prejudic\w*|piorou|pior|caiu mais|reduziu|queda|negativamente)\b|\bimpact\w*\s+negativ\w*/,
    porque: "pede o que reduziu a remuneração",
  },
  {
    necessidade: "RANKING_GANHO",
    quando: /\b(ganhamos|ganho|ganhos|melhorou|melhor|subiu mais|aumentou mais|maior alta|positivamente)\b|\bimpact\w*\s+positiv\w*/,
    porque: "pede o que aumentou a remuneração",
  },
  {
    necessidade: "VEICULOS",
    quando: /\b(veiculo|veiculos|placa|placas|caminhoes|ativos)\b.*\b(afetad\w*|impactad\w*|sofrer\w*|mudar\w*|contribu\w*|mais)\b|\bquais (veiculos|placas)\b/,
    porque: "pede a lista de ativos afetados",
  },
  {
    necessidade: "MOVIMENTO",
    /*
      Mudança se pergunta de três formas, e o detector conhecia uma.

      A **interrogativa** — "o que mudou?", "teve alteração?" — era a única.
      Faltavam as outras duas, e cada uma custava uma pergunta inteira:

      A **declarativa**: "O IPVA mudou e isso está previsto no Book?" traz o
      dado na primeira oração e a regra na segunda. Sem reconhecer a primeira,
      o plano ficava só com BOOK e a resposta não tinha número nenhum.

      A **de igualdade**, que é a mesma pergunta pela negativa: "tá tudo
      igual?" quer exatamente o que "o que mudou?" quer. Ela recebia
      DESCONHECIDA — nenhuma consulta, e uma resposta construída sobre o vazio.
    */
    quando:
      /\b(o que (mudou|alterou|aconteceu|houve|ocorreu|entrou|saiu|rolou)|mudancas?|alterac(ao|oes)|resumo)\b|\b(teve|houve|tivemos|ocorreu|aconteceu|rolou)\b.{0,30}\b(alterac\w*|mudanc\w*|movimento|diferenc\w*)\b|\bmudou (alguma coisa|algo)\b|\b(qual (foi |e |era )?o impacto|quanto (isso |isto )?(custou|impactou|pesou)|que impacto)\b|\b\w+ (mudou|mudaram|alterou|alteraram|subiu|subiram|caiu|cairam|variou|variaram|aumentou|aumentaram|reduziu|reduziram)\b|\b(esta|ficou|continua|permanece|segue) tudo (igual|na mesma|do mesmo jeito|como estava)\b|\b(tudo|nada) (igual|mudou)\b|\bna mesma\b|\bsem (alterac\w*|mudanc\w*|novidade)\b|\bcontinua igual\b/,
    /*
      "Por quê" pede a razão, e razão não é listagem.

      Foi o preço de reconhecer a oração declarativa: "por que o pneu subiu
      15%?" passou a casar `pneu subiu` e virou movimento — a lista do que
      mudou na vigência, para quem perguntou a **causa** de uma alteração
      específica. Quem responde isso é PROCEDÊNCIA (de onde veio este número)
      ou CONCEITUAL (como esta conta funciona), e as duas já sabiam.
    */
    exceto: /\b(por ?que|porque|pq|qual (o )?motivo|qual (a )?razao)\b/,
    porque: "pede o movimento de uma vigência",
  },
  {
    necessidade: "VALOR",
    /*
      Valor tem mais de um nome, e o vocabulário conhecia um só.

      "Qual o preço do combustível em reais?" não casava detector nenhum e caía
      no BOOK por evidência — a pergunta mais direta que este produto recebe,
      respondida pela regra em vez de pelo número. `preço`, `custo` e `tarifa`
      pedem a mesma coisa que `valor`, e um vocabulário fechado com um buraco
      erra em toda pergunta de preço, não só na que a bateria escreveu.
    */
    quando: /\b(quanto (esta|e|foi|ficou)|qual (o|a) (valor|preco|custo|tarifa)|(valor|preco|custo|tarifa) (do|da|de)|quanto (custa|vale))\b/,
    /*
      Duas perguntas que citam o preço e não pedem o preço.

      A **definição**: "o que é preço de combustível?" pede o conceito, e é de
      CONCEITUAL. A **disponibilidade**: "temos preço de combustível?" pergunta
      se o dado existe — e a forma é a mesma que DISPONIBILIDADE já reconhece,
      escrita aqui de novo de propósito, porque é dela que a exceção fala.

      Sem a segunda, "temos preço de combustível?" passava a disparar também a
      consulta do valor, e uma resposta que era conceitual voltava carregando a
      vigência de agosto — um número verdadeiro para uma pergunta que só queria
      saber se ele existe.
    */
    exceto:
      /\b(o que (e|sao|significa)|que e|como funciona|como e (calculad\w*|compost\w*|apurad\w*)|explique|explica|defini(cao|r)|para que serve)\b|\b(temos|existe|existem|ha|tem)\b[^?]{0,30}\b(parametro|coluna|dado|informacao|preco|valor|custo|tarifa)\b/,
    porque: "pede o valor corrente de um parâmetro",
  },
];

/**
 * A frase nomeia a fonte, em vez de descrever o que quer saber.
 *
 * `no Book`, `o Book diz`, `previsto no contrato`, `está no manual`. É o
 * complemento de lugar da pergunta — e quando ele existe, é ele que manda:
 * ver o comentário em `planejar`.
 *
 * Note o que **não** está aqui: `regra`. "Qual a regra do IPVA?" nomeia o que
 * se quer, não onde está — e continua sendo ordenada pelo verbo, que é o que
 * mantém "qual a regra do bloco PNEU?" respondendo com a regra e não com o
 * bloco.
 */
const FONTE_NOMEADA =
  /\b(n[oa]s?|d[oa]s?|pel[oa]s?) (book|contrato|manual)\b|\bo (book|contrato|manual) (diz|fala|traz|prev[eê]|cobre|menciona)\b|\bsegundo o (book|contrato|manual)\b/;

/**
 * A pergunta que quer saber **o que importa**, sem dizer sobre o quê.
 *
 * É a família executiva inteira, e ela não se resolve com um padrão por
 * frase: "me diga o que merece minha atenção", "tem algo fora do padrão?",
 * "o que eu deveria investigar primeiro?", "resuma agosto para a diretoria" e
 * "vale a pena eu me preocupar?" pedem a mesma coisa — o que se destaca no
 * recorte. Um detector, uma necessidade dupla: o movimento, para dizer o que
 * houve, e o ranking, para dizer o que pesou.
 */
const DESTAQUE =
  /\b(merece|atencao|relevante|importante|importantes|principa(l|is)|destaque|fora do padrao|estranho|estranha|anomal\w*|investigar|preocupar|preocupacao|vale a pena|resuma|resumo|panorama|diretoria|executivo|briefing|prioridade|primeiro)\b/;

/**
 * A pergunta está ancorada neste produto?
 *
 * O plano padrão só vale para quem está falando do FreightCheck. Sem esta
 * checagem, "qual a previsão do tempo em Salvador?" ganharia uma consulta de
 * vigência — o produto responderia com números verdadeiros a uma pergunta que
 * não é dele, que é a forma mais constrangedora de errar.
 *
 * Ancorar é ter de que falar: um assunto reconhecido, um período, um
 * equipamento, vocabulário de mudança, ou uma conversa em pé.
 */
function estaAncorada(
  pergunta: string,
  leitura: Leitura,
  assunto: string | null,
  temConversa: boolean,
): boolean {
  const frase = normalizar(pergunta);
  if (assunto) return true;
  if (leitura.entidades.periodo || leitura.entidades.intervalo) return true;
  if (leitura.entidades.equipamento) return true;
  if (temConversa) return true;
  /*
    Pedir o que merece atenção já é falar deste produto.

    Ninguém pergunta a um assistente de auditoria de frete "o que eu deveria
    investigar primeiro?" sobre outra coisa. Sem isto, a família executiva
    ficava de fora do plano padrão justamente por não nomear assunto nenhum —
    que é a característica que a define.
  */
  if (DESTAQUE.test(frase)) return true;
  return /\b(mudou|mudanc\w*|alterac\w*|impacto|vigencia|remuneracao|custo|perda|ganho)\b/.test(
    frase,
  );
}

export interface EntradaDoPlano {
  pergunta: string;
  leitura: Leitura;
  /** O assunto reconhecido, quando houve. */
  assunto: string | null;
  /** Há conversa anterior com intenção — a pergunta pode estar continuando. */
  temConversa: boolean;
  /** A intenção herdada do fio, quando houver. */
  herdada: Necessidade | null;
  /**
   * O Book devolveu regra **com confiança suficiente para definir a pergunta**.
   *
   * É um limiar mais alto que o de exibição, e a diferença é deliberada.
   * Mostrar um trecho como contexto pede só que ele seja relevante; deixar que
   * ele decida *o que a pergunta quer* pede que ele seja a resposta. Com o
   * limiar de exibição, "qual a margem de lucro da transportadora?" — assunto
   * que este produto não tem — casava fracamente o bloco PNEU e virava uma
   * pergunta de Book.
   */
  temRegraDoBook: boolean;
}

/**
 * A ordem em que as necessidades se apresentam na resposta.
 *
 * Não é ordem de desempate — todas são executadas. É a ordem de **leitura**:
 * quem perguntou a origem quer a origem primeiro; quem perguntou o que mudou
 * quer o número antes da regra que o explica. A primeira da lista dá nome à
 * resposta e é a que o estado da conversa guarda.
 */
const ORDEM: Necessidade[] = [
  "SAUDACAO",
  /*
    A meta-pergunta vem antes de tudo, e não por importância: por **objeto**.
    "Tem certeza?" não fala do assunto da conversa, fala da resposta anterior.
    Deixá-la disputar posição com as necessidades de dado faria uma frase que
    também menciona um parâmetro ser respondida sobre o parâmetro — que é a
    pergunta que ela não fez.
  */
  "SUSTENTACAO",
  "PROCEDENCIA",
  /*
    O cálculo derivado também é sobre o que já se disse, e por isso vem cedo.
    "Quanto isso dá por ano?" cita um período e casaria detectores de dado; o
    que ela pede é a composição, e o dado dela já está na conversa.
  */
  "CALCULO",
  "BALANCO", "IMPORTACOES", "CELULAS",
  "PANORAMA", "CATALOGO_DE_CONTEXTO",
  /*
    "Não tem preço" é uma pergunta sobre o que ficou sem apurar, não sobre o
    que existe. As duas formas casam — a negação carrega o verbo de existência
    —, e confundi-las trocava a lista de pendências por um "sim, existe".
  */
  "SEM_PRECO",
  "DISPONIBILIDADE",
  /*
    A fila de investigação vem antes de tudo o que ela resume.

    Quem pergunta "o que eu deveria investigar primeiro?" recebe a fila; o
    movimento da vigência entra junto, para dar o tamanho do que se está
    ordenando, mas não é ele que dá nome à resposta.
  */
  "ATENCAO",
  "COMPARACAO", "EVOLUCAO",
  /*
    Quem pergunta por placas quer placas.

    "Quais placas sofreram mais alterações?" dispara os ativos pelo
    substantivo e o movimento pelo verbo; a resposta traz os dois, e o nome é
    o que foi perguntado.
  */
  "DRE",
  "VEICULOS",
  /*
    O movimento vem antes do ranking quando a frase pede os dois.

    "Quais foram as principais alterações de agosto?" dispara o movimento pelo
    substantivo e o ranking pela palavra "principais" — e o que foi perguntado
    foram as alterações. O ranking continua junto na resposta; ele só não lhe
    dá nome. Quando a frase só pede o ranking ("onde perdemos mais?"), não há
    movimento na lista e a ordem não decide nada.
  */
  "MOVIMENTO",
  "RANKING_PERDA", "RANKING_GANHO",
  "VALOR",
  /*
    Regra antes de conceito, e conceito antes das telas que têm nome próprio.

    "Qual a regra do bloco PNEU?" casa os dois — `qual a regra` é forma
    conceitual e `regra do` é forma de Book —, e quem pergunta a regra quer a
    regra. Pelo mesmo motivo "para que serve a curadoria?" é conceito e não o
    estado da curadoria, e "o que é composição?" é conceito e não a tela de
    frota: o verbo conceitual ganha das telas, e perde só para o Book.
  */
  "BOOK",
  "CONCEITUAL",
  "CURADORIA",
  "COMPOSICAO",
  "DESCONHECIDA",
];

/**
 * A ordem final: o que a frase pediu vem antes do que o plano acrescentou.
 *
 * As duas classes existem desde que o plano passou a completar a pergunta.
 * "Quais foram as principais alterações de agosto?" pede alterações — o
 * movimento é explícito — e ganha a fila de investigação junto, porque
 * "principais" pede uma ordem; a resposta se chama movimento. "O que eu
 * deveria investigar primeiro?" não pede nada explicitamente: tudo ali foi o
 * plano que acrescentou, e aí quem nomeia é a fila.
 *
 * Sem esta distinção, uma ordem fixa tinha de escolher entre errar num caso ou
 * no outro — e errar aqui não muda o que é consultado, muda o nome da resposta
 * e o que a conversa guarda como assunto.
 */
function ordenar(
  necessidades: Set<Necessidade>,
  explicitas: Set<Necessidade>,
): Necessidade[] {
  const posicao = (n: Necessidade) => {
    const i = ORDEM.indexOf(n);
    return i === -1 ? ORDEM.length : i;
  };
  return [...necessidades].sort((a, b) => {
    const pesoA = explicitas.has(a) ? 0 : 1;
    const pesoB = explicitas.has(b) ? 0 : 1;
    return pesoA - pesoB || posicao(a) - posicao(b);
  });
}

/**
 * O plano de investigação desta pergunta.
 *
 * Nunca devolve um plano vazio para uma pergunta ancorada: a pior saída
 * possível é a que o desenho anterior produzia — nenhuma consulta, nenhuma
 * evidência, e uma resposta construída sobre nada.
 */
export function planejar(entrada: EntradaDoPlano): Plano {
  const { pergunta, leitura, assunto, temConversa, herdada, temRegraDoBook } = entrada;
  const frase = normalizar(pergunta);

  if (leitura.intencao === "SAUDACAO") {
    return {
      necessidades: ["SAUDACAO"],
      principal: "SAUDACAO",
      porque: ["é conversa, não consulta"],
      ancorada: false,
      bookPorEvidencia: false,
    };
  }

  const necessidades = new Set<Necessidade>();
  /** O que a própria frase pediu — o resto foi o plano que completou. */
  const explicitas = new Set<Necessidade>();
  const porque: string[] = [];

  for (const detector of DETECTORES) {
    if (!casa(detector, frase)) continue;
    necessidades.add(detector.necessidade);
    explicitas.add(detector.necessidade);
    porque.push(detector.porque);
  }

  /*
    Dois meses citados são uma comparação, ainda que o verbo não apareça.

    "Julho e agosto no pneu" não traz `compare`, e a leitura já extraiu o
    intervalo. A necessidade vem do que foi entendido, não de mais um padrão.
  */
  if (leitura.entidades.intervalo?.ate && !necessidades.has("COMPARACAO")) {
    necessidades.add("COMPARACAO");
    explicitas.add("COMPARACAO");
    porque.push("cita dois períodos");
  }

  const ancorada = estaAncorada(pergunta, leitura, assunto, temConversa);

  /*
    ---- a família executiva --------------------------------------------------

    Um detector, duas necessidades. Quem pergunta o que merece atenção quer o
    que houve **e** o que pesou; entregar só um dos dois é responder metade.
  */
  if (DESTAQUE.test(frase) && ancorada) {
    /*
      Três necessidades, e cada uma responde uma metade da pergunta.

      A fila diz **o que** merece atenção e por quê; o movimento diz o tamanho
      do que ela está ordenando; o ranking diz onde está o dinheiro. Antes eram
      só as duas últimas, e a resposta a "tem algo fora do padrão?" era o
      agregado da vigência — verdadeiro, e sem nenhuma opinião sobre o que
      estava fora do padrão.
    */
    necessidades.add("ATENCAO");
    if (!necessidades.has("MOVIMENTO")) {
      necessidades.add("MOVIMENTO");
      porque.push("pede o que se destaca no recorte");
    }
    necessidades.add("RANKING_PERDA");
  }

  /*
    ---- o que a leitura já sabia ---------------------------------------------

    `interpretar` resolve duas coisas que nenhum detector vê: a diferença entre
    "por quê?" (a origem do que se acabou de dizer) e "por que o impacto é
    acumulado por periodicidade?" (a razão de uma regra do produto), e a
    intenção herdada de uma conversa em pé. Quando nenhum detector casou, é ela
    que vale — descartá-la seria jogar fora o que já tinha sido entendido.
  */
  if (necessidades.size === 0 && leitura.intencao !== "DESCONHECIDA") {
    necessidades.add(leitura.intencao);
    explicitas.add(leitura.intencao);
    porque.push(leitura.porque);
  }

  /*
    ---- o plano reage ao que foi recuperado ----------------------------------

    A busca no Book roda para toda pergunta e o limiar decide o que entra.
    Quando nada foi reconhecido e ela devolveu regra, a necessidade **é** a
    regra — mesmo que a frase nunca diga "Book". É o que responde "posso somar
    parcelas mensais e por km?" e "o vale pedágio entra na remuneração?": duas
    perguntas que sempre recuperaram a seção certa e que o classificador nunca
    soube nomear.

    Ela vem depois da leitura e antes do plano padrão de propósito: uma regra
    recuperada é evidência mais forte do que "investigue o recorte", e mais
    fraca do que uma necessidade que a própria frase declarou.
  */
  let bookPorEvidencia = false;
  if (necessidades.size === 0 && temRegraDoBook) {
    necessidades.add("BOOK");
    porque.push("a regra recuperada responde a pergunta");
    bookPorEvidencia = true;
  }

  /*
    ---- o plano padrão -------------------------------------------------------

    Nada foi reconhecido, e a pergunta é deste produto. Investigar o recorte é
    a leitura que erra menos — e é infinitamente melhor que a anterior, que era
    não consultar nada e responder sobre o vazio.
  */
  if (necessidades.size === 0 && ancorada) {
    if (herdada && herdada !== "DESCONHECIDA") {
      necessidades.add(herdada);
      porque.push("continua o assunto da conversa");
    } else {
      necessidades.add("MOVIMENTO");
      porque.push("pergunta ancorada sem pedido explícito — investiga o recorte");
    }
  }

  if (necessidades.size === 0) {
    return {
      necessidades: ["DESCONHECIDA"],
      principal: "DESCONHECIDA",
      porque: ["nada nesta pergunta se refere ao que este produto tem"],
      ancorada,
      bookPorEvidencia: false,
    };
  }

  /*
    ---- a fonte nomeada nomeia a resposta ------------------------------------

    "Existe alguma regra no Book relacionada a essa alteração?" detecta as duas
    necessidades, e as duas explicitamente: MOVIMENTO pela palavra `alteração`,
    BOOK pela palavra `Book`. Empatadas em explicitude, quem decidia era a
    ORDEM fixa — e MOVIMENTO vem antes. A resposta se chamava pelo que não
    tinha sido pedido, e ia buscar o movimento do recorte para uma pergunta que
    dizia, com todas as letras, onde queria que se procurasse.

    A regra é estreita de propósito: só vale quando a frase **nomeia** a fonte
    (`no Book`, `o Book diz`, `no contrato`, `no manual`). Escrever o nome da
    fonte é o ato mais explícito que existe nesta interface — mais explícito
    que o verbo, que descreve o que se quer saber e não onde. Uma pergunta que
    não nomeia fonte nenhuma não passa por aqui, e continua sendo ordenada pelo
    que o verbo pediu.
  */
  if (necessidades.has("BOOK") && FONTE_NOMEADA.test(frase)) {
    explicitas.clear();
    explicitas.add("BOOK");
  }

  const ordenadas = ordenar(necessidades, explicitas);
  return {
    necessidades: ordenadas,
    principal: ordenadas[0]!,
    porque,
    ancorada,
    bookPorEvidencia,
  };
}

/** As necessidades que a frase revela, na ordem de leitura. */
export function detectar(pergunta: string): Necessidade[] {
  const frase = normalizar(pergunta);
  const achadas = new Set(
    DETECTORES.filter((d) => casa(d, frase)).map((d) => d.necessidade),
  );
  return ordenar(achadas, achadas);
}

/**
 * A leitura provisória de `interpretar`, com a razão dela.
 *
 * Existe para que os detectores morem **num lugar só**. `interpretar` precisa
 * de uma intenção antes de o plano existir — ela decide o que a frase herda da
 * conversa e se o resíduo pode ser um assunto —, e mantê-los duplicados lá
 * garantiria que um dia as duas listas discordassem sobre onde procurar.
 *
 * O que sai daqui é provisório de verdade: o plano roda depois, com o assunto
 * reconhecido e com o que o Book devolveu, e é ele que decide o que executar.
 */
export function leituraProvisoria(pergunta: string): { intencao: Necessidade; porque: string } {
  const frase = normalizar(pergunta);
  const casados = DETECTORES.filter((d) => casa(d, frase));
  if (casados.length === 0) return { intencao: "DESCONHECIDA", porque: "nenhum detector casou" };
  const achadas = new Set(casados.map((d) => d.necessidade));
  const principal = ordenar(achadas, achadas)[0]!;
  const dele = casados.find((d) => d.necessidade === principal);
  return { intencao: principal, porque: dele?.porque ?? "detectada pelo plano" };
}
