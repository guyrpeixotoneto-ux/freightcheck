/**
 * O que a pergunta nomeou é o que a busca trouxe? — o portão de correspondência.
 *
 * **O defeito que este módulo fecha.** A recuperação deste assistente é por
 * semelhança: o índice do Book ranqueia por pontuação, o catálogo casa por
 * vocabulário, o resolvedor de gaveta aceita o mais próximo. Semelhança é a
 * ferramenta certa para *achar* e a errada para *concluir* — e não havia, entre
 * as duas, ninguém perguntando se o que voltou era mesmo o que foi pedido.
 * Medido na bateria de aceitação:
 *
 *   - `Me explique o QLP ADMINISTRATIVO DE FROTA` — bloco que não existe —
 *     respondia com o conteúdo de `DESCONTO QLP ADM`, sem dizer que trocou;
 *   - `Qual o IPVA do cavalo XYZ9Z99` — placa que não existe — respondia com a
 *     regra genérica de IPVA do Book, que se lê como se fosse daquela placa;
 *   - `Como está a operação de Uberlândia` — unidade que não existe — respondia
 *     com o cartão "Parâmetros operação" do catálogo.
 *
 * Nos três, `lacunas` vinha vazia e `desambiguacao` vinha `null`. Não era o
 * modelo errando: o dossiê entregue a ele continha o material substituído sem
 * nenhuma marca de substituição, e nenhum modelo pode recusar uma troca que
 * ninguém lhe contou que houve. Por isso o portão vive aqui, na orquestração, e
 * não no prompt.
 *
 * **A regra, em uma frase: semelhança não é correspondência.** Um vizinho
 * semântico pode ser *oferecido* — "você quis dizer X?" — e nunca *usado* como
 * evidência. É a diferença entre uma pergunta e uma resposta errada.
 *
 * **O que este módulo não faz.** Ele não julga qualidade, estilo, jargão nem
 * repetição, e não decide o que responder quando **há** correspondência. Ele
 * responde uma pergunta só, e devolve o que achou.
 */

import { normalizar, termos } from "./normalizar";

// ── O que, na pergunta, nomeia alguma coisa ─────────────────────────────────

/**
 * Palavras com que se **pergunta** ou se **pede**, e nunca se nomeia.
 *
 * `PALAVRAS_VAZIAS`, em `normalizar.ts`, já cobre o português funcional e os
 * verbos de pergunta que a **busca** precisa descartar. Esta lista é o
 * complemento para as duas contas que dependem de "quais palavras desta frase
 * nomeiam alguma coisa": a correspondência aqui e a lacuna do qualificador em
 * `orquestrador.ts`. Ela fica separada de propósito — mexer em
 * `PALAVRAS_VAZIAS` mudaria o ranqueamento de toda busca do produto, que é
 * outro assunto e outro risco.
 *
 * O imperativo é o que faltava. "Me fale sobre manutenção" chega à resolução
 * como `fale manutencao`, e sem tirar `fale` a conferência de cobertura acusaria
 * o bloco MANUTENÇÃO de não corresponder — reprovando a resposta certa.
 */
const PALAVRAS_DE_PEDIR: ReadonlySet<string> = new Set([
  "fale", "fala", "falar", "conte", "conta", "contar", "explique", "explicame",
  "descreva", "detalhe", "detalhar", "apresente", "resuma", "resumir", "liste",
  "listar", "traga", "trazer", "informe", "informar", "esclareca", "comente",
  "ajude", "ajudar", "gostaria", "queria", "poderia", "favor", "dizer",
  "entender", "saber", "conhecer", "ver", "olhar", "checar", "conferir",
]);

/** Os meses, que são data e não coluna. */
const MESES: ReadonlySet<string> = new Set([
  "janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro",
]);

/**
 * Só dígitos — ano, dia, quantidade.
 *
 * `2026` numa pergunta é quando, não o quê. Sem esta linha, `Qual o valor de
 * Manutenção cavalo em agosto/2026?` produzia a lacuna "o arquivo não traz
 * valor, 2026" — o assistente afirmando que falta uma coluna chamada 2026.
 */
const SO_DIGITOS = /^\d+$/;

/**
 * As palavras da pergunta que de fato **nomeiam** alguma coisa.
 *
 * É a autoridade única dessa conta. Quem precisar responder "o que esta frase
 * está pedindo?" chama aqui, e não refaz o filtro — foi refazendo-o pela metade
 * que a lacuna do qualificador passou a inventar colunas.
 */
export function tokensDeConteudo(texto: string): string[] {
  return termos(texto).filter(
    (p) => !PALAVRAS_DE_PEDIR.has(p) && !MESES.has(p) && !SO_DIGITOS.test(p),
  );
}

/**
 * As palavras que pedem uma **medida**, e não nomeiam a coisa medida.
 *
 * Elas ficam de fora daqui e dentro de `tokensDeConteudo` de propósito, porque
 * as duas contas que usam esse filtro precisam de respostas opostas sobre elas.
 * A lacuna do qualificador **precisa** vê-las: "qual o preço do combustível?"
 * numa gaveta sem coluna monetária é exatamente a lacuna que ela existe para
 * declarar. A correspondência **não pode** vê-las: `Qual o valor de Manutenção
 * cavalo?` nomeia Manutenção, não "valor", e contá-la como nome fazia o portão
 * recusar a resposta certa por falta de um bloco chamado "valor".
 */
const PALAVRAS_DE_MEDIDA: ReadonlySet<string> = new Set([
  "valor", "valores", "preco", "precos", "custo", "custos", "custa", "custam",
  "tarifa", "tarifas", "total", "totais", "media", "medias", "soma", "somas",
  "montante", "percentual", "percentuais", "numero", "numeros",
]);

/** As palavras da pergunta que **nomeiam uma entidade** — o que o portão confere. */
export function tokensQueNomeiam(texto: string): string[] {
  return tokensDeConteudo(texto).filter((p) => !PALAVRAS_DE_MEDIDA.has(p));
}

// ── As entidades que uma pergunta pode nomear ───────────────────────────────

export type TipoDeEntidade = "PLACA" | "UNIDADE" | "BLOCO";

export interface EntidadeNomeada {
  tipo: TipoDeEntidade;
  /** Como a pergunta a escreveu — é assim que ela volta na resposta. */
  citada: string;
}

/**
 * Uma entidade nomeada que o material recuperado **não** sustenta.
 *
 * `vizinhos` é o que existe e se parece. Ele serve para perguntar, nunca para
 * responder: quem o usar como evidência reintroduz exatamente o defeito que
 * este módulo fecha.
 */
export interface SemCorrespondencia {
  entidade: EntidadeNomeada;
  vizinhos: string[];
}

/** A forma de uma placa — a mesma de `ferramentas.ts`, e pelo mesmo motivo. */
const FORMA_DE_PLACA = /\b([A-Z]{3}\d[A-Z0-9]\d{2})\b/gi;

/** As placas que a pergunta escreveu, na forma em que as escreveu. */
export function placasNomeadas(pergunta: string): string[] {
  return [...new Set([...pergunta.matchAll(FORMA_DE_PLACA)].map((m) => m[1].toUpperCase()))];
}

/**
 * A unidade que a pergunta nomeia, quando ela nomeia uma.
 *
 * O reconhecimento é por **construção**, não por gazetteer: "a operação de X",
 * "a unidade X", "a filial de X". É estreito de propósito. Um `em X` solto
 * casaria meia língua portuguesa, e o custo de um falso positivo aqui é alto —
 * ele recusaria uma pergunta que tem resposta.
 */
const CONSTRUCAO_DE_UNIDADE =
  /\b(?:unidade|opera[cç][ãa]o|filial|planta|base|cd|centro de distribui[cç][ãa]o)\s+(?:d[aeo]s?\s+|em\s+|n[ao]s?\s+)?([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,}(?:\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'-]{2,})?)/gi;

export function unidadesNomeadas(pergunta: string, vocabulario: ReadonlySet<string>): string[] {
  const achadas: string[] = [];
  for (const m of pergunta.matchAll(CONSTRUCAO_DE_UNIDADE)) {
    const nome = m[1]?.trim();
    if (!nome) continue;
    const palavras = tokensDeConteudo(nome);
    if (palavras.length === 0) continue;
    /*
      O que o produto já sabe nomear não é uma unidade desconhecida.

      "operação de transferência" e "operação de carga" casam a construção e
      não nomeiam lugar nenhum; as duas palavras estão no vocabulário do
      produto, e é isso que as separa de "Uberlândia".
    */
    if (palavras.every((p) => vocabulario.has(p))) continue;
    achadas.push(nome);
  }
  return [...new Set(achadas)];
}

// ── A conferência ───────────────────────────────────────────────────────────

/**
 * O material recuperado cobre as palavras com que a pergunta nomeou a coisa?
 *
 * A conta é de **cobertura**, e não de semelhança: cada palavra usada para
 * nomear precisa aparecer na identidade do que voltou. Nada de prefixo, nada de
 * abreviação — é justamente a expansão `adm ≈ administrativo` que transformava
 * `QLP ADMINISTRATIVO DE FROTA` em `DESCONTO QLP ADM`.
 *
 * A identidade é o **nome** do que voltou — bloco, seção, gaveta, título de
 * cartão —, nunca o corpo do texto. Um bloco que *menciona* IPVA no meio de uma
 * cláusula não passa a se chamar IPVA, e responder com ele é a mesma troca
 * silenciosa por outro caminho.
 */
export function cobre(nomeado: readonly string[], identidade: readonly string[]): boolean {
  if (nomeado.length === 0) return true;
  const alvo = new Set(identidade);
  return nomeado.every((p) => alvo.has(p));
}

/**
 * Uma das duas é a abreviação da outra — a assinatura da troca silenciosa.
 *
 * **Por que este teste existe, e por que ele é estreito.** Cobertura sozinha não
 * serve de gatilho: numa pergunta como "qual foi a evolução do pneu?" a palavra
 * `evolucao` também fica sem cobertura, e o bloco PNEU é a resposta certa. O que
 * distingue a troca de verdade é a **forma** da palavra que sobrou. Ninguém
 * escreve `QLP ADMINISTRATIVO` querendo dizer outra coisa que não a expansão de
 * `QLP ADM` — e é justamente por isso que a recuperação a devolve e que ela não
 * pode ser aceita: `adm` e `administrativo` se parecem, e parecer não é ser.
 *
 * Medido contra a suíte inteira: `evolucao`, `auditoria`, `prazo`, `contestar`,
 * `frequencia`, `nenhuma` — todas as palavras que sobram em perguntas legítimas
 * — não têm relação de prefixo com nenhum termo do nome recuperado. Nenhuma
 * delas dispara aqui, e é essa a propriedade que torna o portão **seguro por
 * construção**: ele não recusa por não entender uma palavra, só por reconhecer
 * uma abreviação sendo passada por inteira.
 *
 * A diferença mínima de três letras tira a flexão do caminho: `consumo` e
 * `consumos` se prefixam e são a mesma coisa; `adm` e `administrativo`, não.
 */
export function ehAbreviacaoOuExpansao(a: string, b: string): boolean {
  if (a === b) return false;
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  if (curto.length < 3 || longo.length - curto.length < 3) return false;
  return longo.startsWith(curto);
}

export interface MaterialRecuperado {
  /** Os nomes do que voltou: bloco, seção, gaveta, título de cartão. */
  identidades: string[];
  /** Os candidatos a oferecer, do mais forte para o mais fraco. */
  vizinhos: string[];
}

export interface PedidoDeConferencia {
  /** O termo com que a pergunta nomeou o assunto, já limpo de equipamento. */
  termoNomeado: string | null;
  material: MaterialRecuperado;
  /** As placas escritas na pergunta que o banco **não** conhece. */
  placasDesconhecidas: readonly string[];
  /** As unidades nomeadas que não existem, com as que existem para oferecer. */
  unidadesDesconhecidas: readonly { citada: string; existentes: readonly string[] }[];
}

/**
 * Tudo o que a pergunta nomeou e o material não sustenta.
 *
 * Vazio quer dizer "corresponde" — e é o caso da esmagadora maioria das
 * perguntas, que é como tem de ser: este portão existe para recusar a troca
 * silenciosa, não para recusar respostas.
 */
export function conferirCorrespondencia(pedido: PedidoDeConferencia): SemCorrespondencia[] {
  const falhas: SemCorrespondencia[] = [];

  for (const placa of pedido.placasDesconhecidas) {
    /*
      Placa não ganha vizinho. Oferecer "você quis dizer ABC1D24?" a quem digitou
      ABC1D23 é palpite sobre a identidade de um ativo — e um ativo errado numa
      apuração financeira é pior do que nenhuma resposta.
    */
    falhas.push({ entidade: { tipo: "PLACA", citada: placa }, vizinhos: [] });
  }

  for (const unidade of pedido.unidadesDesconhecidas) {
    falhas.push({
      entidade: { tipo: "UNIDADE", citada: unidade.citada },
      vizinhos: [...unidade.existentes],
    });
  }

  /*
    O bloco/gaveta é conferido por último e só quando não há falha de placa.

    Uma pergunta com placa inexistente sempre tem palavras sobrando — a própria
    placa —, e acusá-la também aqui produziria duas recusas para um defeito só,
    com a segunda nomeando a placa como se fosse um bloco.
  */
  if (pedido.placasDesconhecidas.length === 0 && pedido.termoNomeado) {
    const nomeado = tokensQueNomeiam(pedido.termoNomeado);
    const identidade = pedido.material.identidades.flatMap((i) => tokensQueNomeiam(i));

    /*
      Só é **troca** quando alguma coisa casou e outra não.

      Cobertura zero é uma busca que não achou nada, e disso a orquestração já
      cuida com a lacuna NAO_ENCONTREI de sempre. O que não tinha dono era o
      meio do caminho: casou `qlp`, não casou `administrativo`, e o que voltou
      foi apresentado como se tivesse casado inteiro.
    */
    const casou = nomeado.filter((p) => identidade.includes(p));
    const sobrou = nomeado.filter((p) => !identidade.includes(p));

    /*
      Duas condições, e a segunda é a que torna este portão seguro.

      A primeira é a cobertura parcial: casou alguma coisa e sobrou alguma —
      sem isso não houve troca, houve busca vazia, e disso a lacuna de sempre
      já cuida.

      A segunda exige que o que sobrou seja uma **abreviação ou expansão** de
      algo no nome recuperado. É ela que separa `QLP ADMINISTRATIVO` sobre
      `QLP ADM` — troca — de `evolução do pneu` sobre `PNEU` — resposta certa
      com uma palavra a mais na pergunta. Sem esta condição o portão recusava
      toda pergunta que dissesse mais do que o nome do bloco, o que é
      praticamente toda pergunta de operação: a suíte caiu sete categorias de
      uma vez quando ela não estava aqui.
    */
    const trocou = sobrou.some((s) => identidade.some((i) => ehAbreviacaoOuExpansao(s, i)));

    if (casou.length > 0 && trocou) {
      falhas.push({
        entidade: { tipo: "BLOCO", citada: pedido.termoNomeado },
        vizinhos: pedido.material.vizinhos.slice(0, 4),
      });
    }
  }

  return falhas;
}

// ── A frase ─────────────────────────────────────────────────────────────────

const COMO_CHAMAR: Record<TipoDeEntidade, string> = {
  PLACA: "a placa",
  UNIDADE: "a unidade",
  BLOCO: "",
};

/**
 * O que a resposta diz quando não houve correspondência.
 *
 * A forma é sempre a mesma e é obrigatória: **não encontrei X; encontrei Y,
 * você quis dizer Y?** Dizer só "não encontrei" esconde que existe algo
 * parecido; dizer só "encontrei Y" é a troca silenciosa. As duas metades juntas
 * são a única redação honesta — e, note, ela termina em pergunta, porque quem
 * decide se Y serve é quem perguntou.
 */
export function explicarFalta(falhas: readonly SemCorrespondencia[]): string {
  return falhas
    .map(({ entidade, vizinhos }) => {
      const nome = COMO_CHAMAR[entidade.tipo];
      const alvo = nome ? `${nome} ${entidade.citada}` : `"${entidade.citada}"`;

      if (entidade.tipo === "PLACA") {
        return (
          `Não encontrei ${alvo} nos dados importados deste recorte. O que sai daqui ` +
          `sobre um veículo vem do cadastro promovido; sem a placa lá, não há número ` +
          `dela para mostrar — e a regra geral do Book não é dado deste veículo.`
        );
      }

      const encontrei =
        vizinhos.length > 0
          ? ` Encontrei ${vizinhos.map((v) => `"${v}"`).join(", ")} — você quis dizer ` +
            `${vizinhos.length > 1 ? "algum deles" : `"${vizinhos[0]}"`}?`
          : "";

      if (entidade.tipo === "UNIDADE") {
        /*
          A unidade lista o que existe em vez de propor a mais parecida: entre
          duas unidades não há vizinhança semântica nenhuma — são lugares —, e
          "você quis dizer CAMAÇARI?" a quem escreveu Uberlândia seria um
          palpite. A lista é a informação de verdade.
        */
        const existentes =
          vizinhos.length > 0
            ? ` As que têm dado importado são: ${vizinhos.join(", ")}.`
            : "";
        return `Não encontrei ${alvo} entre as unidades com dado importado.${existentes}`;
      }

      return (
        `Não encontrei ${alvo} no que este produto tem registrado.${encontrei}` +
        (encontrei
          ? ` Não respondi com ${vizinhos.length > 1 ? "eles" : "ele"} porque não é o que ` +
            `você pediu.`
          : "")
      );
    })
    .join(" ");
}

/** O termo e as opções para `desambiguacao`, quando há o que oferecer. */
export function desambiguacaoDe(
  falhas: readonly SemCorrespondencia[],
): { termo: string; opcoes: string[] } | null {
  const comVizinho = falhas.find((f) => f.vizinhos.length > 0);
  if (!comVizinho) return null;
  return { termo: comVizinho.entidade.citada, opcoes: [...comVizinho.vizinhos] };
}

/** Só para quem monta identidade a partir de bloco e seção. */
export function identidadeDoTrecho(bloco: string, secao?: string | null): string {
  return secao ? `${bloco} ${secao}` : bloco;
}

/** Normalização exposta para quem compara nomes fora daqui. */
export { normalizar };
