/**
 * Os destinos possíveis de uma célula do arquivo — e nada além destes.
 *
 * O Rastreio de Dados é uma conta de conservação: a massa que entra tem de
 * aparecer inteira do outro lado, distribuída entre destinos **declarados**. A
 * lista abaixo é essa declaração. Ela mora em código, e não numa tabela, pelo
 * mesmo motivo de `labels.ts` e `families.ts`: é decisão de produto, precisa
 * existir com o banco vazio, passa por revisão quando muda, e quem discordar de
 * um número consegue conferir linha a linha de onde ele saiu.
 *
 * Um destino novo não nasce de uma consulta que "sobrou": nasce aqui, com nome
 * e explicação, e só então a classificação passa a usá-lo. Enquanto ele não
 * existir, a célula que não se encaixa em nenhum dos outros cai em
 * `SEM_DESTINO` — que é o único jeito honesto de dizer que a conta não fechou.
 */

export type DestinoCode =
  | "FATO_PREPARADO"
  | "CABECALHO"
  | "COLUNA_DE_GRAO"
  | "ABA_DE_APOIO"
  | "LINHA_EM_BRANCO"
  | "LINHA_RECUSADA"
  | "COLUNA_AMBIGUA"
  | "COLUNA_SEM_CABECALHO"
  | "ABA_SEM_GRAO"
  | "SEM_DESTINO";

/**
 * O que aconteceu com a massa, em cinco naturezas que não se confundem.
 *
 * A separação entre `DESCARTE` e `PERDA` é a que dá utilidade à tela. As duas
 * são células que não viraram fato; a diferença é que o descarte não perde
 * informação nenhuma (uma linha em branco não tinha o que perder, uma aba de
 * pivô é conta refeita sobre dados que já entraram) e a perda perde: o arquivo
 * trazia conteúdo e o sistema recusou, com motivo. Somar as duas num "não
 * aproveitado" esconderia exatamente o número que alguém precisa ver.
 */
export type DestinoNatureza =
  /** Virou fato preparado — a massa seguiu para o STAGING. */
  | "FATO"
  /** Foi consumida em outro papel: nomeou uma coluna, virou vigência ou placa. */
  | "OUTRO_PAPEL"
  /** Descartada por regra escrita, sem perder informação. */
  | "DESCARTE"
  /** O arquivo trazia e o sistema não aproveitou. Tem motivo, e tem endereço. */
  | "PERDA"
  /** Sem destino declarado. O balanço não fecha, e a tela diz isso. */
  | "RESIDUO";

export interface Destino {
  code: DestinoCode;
  natureza: DestinoNatureza;
  /** Como a tela chama este destino. */
  nome: string;
  /** Por que a célula parou aqui, em uma frase que se lê sem o código ao lado. */
  explicacao: string;
}

/**
 * A ordem é a da classificação, e não é cosmética.
 *
 * A regra é a mais específica primeiro: uma célula de cabeçalho de uma aba de
 * pivô é da aba de pivô, e uma célula de uma linha recusada é da linha
 * recusada, mesmo que a coluna dela também tivesse algo a dizer. Ler de cima
 * para baixo é ler exatamente o `CASE` que a consulta executa.
 */
export const DESTINOS: Destino[] = [
  {
    code: "FATO_PREPARADO",
    natureza: "FATO",
    nome: "Virou fato",
    explicacao:
      "A célula foi tipada, validada e preparada como fato. É a massa que segue " +
      "para a camada canônica quando a importação é aprovada.",
  },
  {
    code: "ABA_DE_APOIO",
    natureza: "DESCARTE",
    nome: "Aba de apoio",
    explicacao:
      "Aba classificada como pivô ou não reconhecida. É guardada inteira como " +
      "evidência, mas não entra no fluxo de fatos: uma tabela dinâmica é conta " +
      "refeita sobre dados que já entraram por outra aba, e importá-la seria " +
      "contar a mesma massa duas vezes.",
  },
  {
    code: "CABECALHO",
    natureza: "OUTRO_PAPEL",
    nome: "Cabeçalho",
    explicacao:
      "A linha que nomeia as colunas. Não é dado: é o que diz o que o dado " +
      "significa, e vira o nome do atributo no dicionário.",
  },
  {
    code: "LINHA_EM_BRANCO",
    natureza: "DESCARTE",
    nome: "Linha em branco",
    explicacao:
      "Linha sem nenhum valor em nenhuma coluna — preenchimento estrutural da " +
      "planilha. Não há o que perder aqui, e por isso ela não conta como recusa.",
  },
  {
    code: "LINHA_RECUSADA",
    natureza: "PERDA",
    nome: "Linha recusada",
    explicacao:
      "A linha tinha conteúdo mas não tinha grão: faltou a vigência ou a placa, " +
      "ou o rótulo da vigência não permitiu derivar uma data. Foi recusada " +
      "inteira em vez de entrar sem saber a que vigência ou a que equipamento " +
      "pertence.",
  },
  {
    code: "COLUNA_SEM_CABECALHO",
    natureza: "PERDA",
    nome: "Coluna sem cabeçalho",
    explicacao:
      "A coluna tem valores e não tem nome. Sem cabeçalho não há atributo a " +
      "que ligar o valor, e inventar um nome seria criar semântica onde não há " +
      "evidência.",
  },
  {
    code: "COLUNA_AMBIGUA",
    natureza: "PERDA",
    nome: "Coluna ambígua",
    explicacao:
      "Duas colunas da mesma aba normalizam para o mesmo código de atributo. " +
      "Fundir as duas misturaria valores de origens diferentes num único " +
      "atributo, então nenhuma das duas entra até alguém decidir qual é qual.",
  },
  {
    code: "COLUNA_DE_GRAO",
    natureza: "OUTRO_PAPEL",
    nome: "Coluna de grão",
    explicacao:
      "Vigência e placa. Não viram fato porque são o endereço do fato: uma vira " +
      "a vigência, a outra vira a identidade do equipamento.",
  },
  {
    code: "ABA_SEM_GRAO",
    natureza: "PERDA",
    nome: "Aba sem grão",
    explicacao:
      "A aba foi lida como fonte e as colunas dela foram reconhecidas, mas não " +
      "há coluna de vigência ou de placa — então nenhuma célula dela pôde ser " +
      "endereçada, e a aba inteira ficou de fora.",
  },
  {
    code: "SEM_DESTINO",
    natureza: "RESIDUO",
    nome: "Sem destino declarado",
    explicacao:
      "A célula não virou fato e não se encaixa em nenhuma das saídas acima. " +
      "É o resíduo do balanço: massa que entrou no arquivo e sumiu sem que o " +
      "sistema saiba dizer para onde. Qualquer número diferente de zero aqui é " +
      "defeito, não configuração.",
  },
];

const PORCODE = new Map<DestinoCode, Destino>(DESTINOS.map((d) => [d.code, d]));

export function destino(code: DestinoCode): Destino {
  const encontrado = PORCODE.get(code);
  if (!encontrado) {
    // Só acontece se a consulta passar a devolver um rótulo que esta lista não
    // declara — que é precisamente o caso em que o balanço não pode ser exibido
    // como se estivesse completo.
    throw new Error(`Destino "${code}" não está declarado em DESTINOS.`);
  }
  return encontrado;
}

/** A ordem em que a tela empilha os destinos. */
export const ORDEM_DESTINOS: DestinoCode[] = DESTINOS.map((d) => d.code);
