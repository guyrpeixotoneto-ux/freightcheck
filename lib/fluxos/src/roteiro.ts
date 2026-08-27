import { TIPOS_DE_ETAPA, type TipoDeEtapa } from "./catalogo";
import type { ConexaoDeclarada, EtapaDeclarada } from "./modelo";
import { RecusaDeFluxo } from "./validacao";

/**
 * O ROTEIRO — um processo inteiro escrito como texto, uma etapa por linha.
 *
 * Existe por um motivo medido na tela: cadastrar um processo de treze etapas
 * pelo diálogo custa treze formulários abertos e fechados, mais doze arrastos
 * para ligar um cartão no outro. Ninguém faz isso duas vezes — e um cadastro
 * que ninguém faz é um cadastro vazio, que foi exatamente o estado em que o
 * módulo foi encontrado (um fluxo criado, zero etapas).
 *
 * O que este arquivo faz é traduzir o jeito como um processo é **falado** numa
 * reunião — uma lista de passos, na ordem, com quem faz e onde acontece — para
 * as mesmas `EtapaDeclarada`/`ConexaoDeclarada` que a seed usa. Depois daqui
 * não há caminho especial nenhum: o resultado entra por `importarFluxo` ou por
 * `acrescentarRoteiro`, que chamam as mesmas validações do `POST /fluxos`.
 *
 * ---------------------------------------------------------------------------
 * A gramática inteira, que cabe num parágrafo
 * ---------------------------------------------------------------------------
 *
 *     # linhas começadas por # são comentário
 *     [inicio] Origem da tarifa / trecho | Operação | Freitec/TMS
 *     Validação da tarifa | Ambev / Operação | SAP
 *     [decisao] Documento autorizado?
 *     + Integração com Connect | Sistemas / TI
 *
 * - **uma linha, uma etapa**, e a ordem do texto é a ordem do processo;
 * - `|` separa `nome | área | sistema principal` — o segundo e o terceiro são
 *   opcionais, e são os dois campos que todo levantamento de processo tem à
 *   mão na hora da reunião;
 * - `[tipo]` no começo escolhe o tipo de etapa do catálogo (`[decisao]`,
 *   `[documento]`, `[fim]`…). Sem ele, a etapa é `PROCESSO`;
 * - `+` no começo diz "esta acontece **em paralelo** com a linha anterior":
 *   ela nasce da mesma etapa que a anterior, e a próxima linha recebe as duas.
 *   É o que desenha "depois da emissão, Rodopar e Connect ao mesmo tempo" sem
 *   pedir a ninguém que arraste seta.
 *
 * **Nada é inferido além disso.** A primeira linha não vira `INICIO` sozinha e
 * a última não vira `FIM`: adivinhar produziria um desenho que a pessoa não
 * escreveu, e corrigir o que o computador inventou custa mais do que escrever
 * `[inicio]`. O que o texto não diz, o painel da etapa completa depois — este
 * atalho existe para levantar o **esqueleto**, não para substituir o cadastro.
 */

/** O que a interpretação devolve — pronto para `importarFluxo`. */
export interface RoteiroInterpretado {
  etapas: EtapaDeclarada[];
  conexoes: ConexaoDeclarada[];
}

/**
 * O teto de linhas de um roteiro só.
 *
 * Não é medo de tamanho: é que um processo de mais de cem etapas numa colagem
 * só é quase sempre duas coisas coladas por engano, e descobrir isso depois de
 * gravar custa apagar uma a uma.
 */
export const LIMITE_DE_LINHAS = 120;

const SEM_ACENTO = (texto: string): string =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * O nome de um tipo, escrito por gente, vira o valor do catálogo.
 *
 * Aceita o valor (`DECISAO`) e o rótulo (`Decisão`), com ou sem acento e em
 * qualquer caixa. O catálogo continua sendo a autoridade única: um tipo novo
 * lá passa a ser aceito aqui sem que esta função mude uma linha.
 */
export function tipoDeEtapaEscrito(texto: string): TipoDeEtapa | null {
  const procurado = SEM_ACENTO(texto);
  const achado = TIPOS_DE_ETAPA.find(
    (t) => SEM_ACENTO(t.valor) === procurado || SEM_ACENTO(t.rotulo) === procurado,
  );
  return achado?.valor ?? null;
}

const TIPOS_ACEITOS = TIPOS_DE_ETAPA.map((t) => t.valor.toLowerCase()).join(", ");

interface LinhaLida {
  paralela: boolean;
  tipo: TipoDeEtapa;
  nome: string;
  area: string | null;
  sistemaPrincipal: string | null;
}

/** Uma linha do roteiro, já sem comentário e sem espaço sobrando. */
function lerLinha(bruta: string, numero: number): LinhaLida {
  let resto = bruta.trim();

  const paralela = resto.startsWith("+");
  if (paralela) resto = resto.slice(1).trim();

  let tipo: TipoDeEtapa = "PROCESSO";
  const marcador = /^\[([^\]]*)\]\s*/.exec(resto);
  if (marcador) {
    const escrito = marcador[1].trim();
    const reconhecido = tipoDeEtapaEscrito(escrito);
    if (!reconhecido) {
      throw new RecusaDeFluxo(
        "ROTEIRO_TIPO_DESCONHECIDO",
        `Linha ${numero}: "[${escrito}]" não é um tipo de etapa. Aceitos: ${TIPOS_ACEITOS}.`,
      );
    }
    tipo = reconhecido;
    resto = resto.slice(marcador[0].length);
  }

  const campos = resto.split("|").map((c) => c.trim());
  if (campos.length > 3) {
    throw new RecusaDeFluxo(
      "ROTEIRO_CAMPOS_DEMAIS",
      `Linha ${numero}: uma etapa tem no máximo "nome | área | sistema" — vieram ${campos.length} campos.`,
    );
  }

  const nome = campos[0] ?? "";
  if (nome === "") {
    throw new RecusaDeFluxo(
      "ROTEIRO_ETAPA_SEM_NOME",
      `Linha ${numero}: a etapa está sem nome.`,
    );
  }

  return {
    paralela,
    tipo,
    nome,
    area: campos[1] || null,
    sistemaPrincipal: campos[2] || null,
  };
}

/**
 * O texto vira etapas e ligações — função pura, e a única autoridade sobre a
 * gramática acima.
 *
 * `prefixoDaChave` existe porque o mesmo roteiro pode ser **acrescentado** a um
 * fluxo que já tem etapas: as chaves locais precisam não colidir com nada, e
 * quem chama sabe o que já existe. Elas nunca vão para o banco — são o
 * apelido que liga uma linha na outra dentro desta declaração.
 */
export function interpretarRoteiro(
  texto: unknown,
  opcoes: { prefixoDaChave?: string; ordemInicial?: number } = {},
): RoteiroInterpretado {
  const bruto = typeof texto === "string" ? texto : "";
  const prefixo = opcoes.prefixoDaChave ?? "linha";
  const ordemInicial = opcoes.ordemInicial ?? 0;

  const linhas = bruto
    .split(/\r?\n/)
    .map((linha, indice) => ({ texto: linha.trim(), numero: indice + 1 }))
    .filter((linha) => linha.texto !== "" && !linha.texto.startsWith("#"));

  if (linhas.length === 0) {
    throw new RecusaDeFluxo(
      "ROTEIRO_VAZIO",
      "O roteiro não tem nenhuma etapa: escreva uma etapa por linha.",
    );
  }
  if (linhas.length > LIMITE_DE_LINHAS) {
    throw new RecusaDeFluxo(
      "ROTEIRO_LONGO_DEMAIS",
      `O roteiro tem ${linhas.length} etapas e o limite é ${LIMITE_DE_LINHAS}. Divida o processo em mais de um fluxo.`,
    );
  }
  if (linhas[0].texto.trim().startsWith("+")) {
    throw new RecusaDeFluxo(
      "ROTEIRO_PARALELA_SEM_ANTERIOR",
      `Linha ${linhas[0].numero}: "+" diz "em paralelo com a etapa acima", e não há etapa acima.`,
    );
  }

  const etapas: EtapaDeclarada[] = [];
  const conexoes: ConexaoDeclarada[] = [];

  /*
    Duas frentes, e é o que faz o `+` significar alguma coisa.

    `frente` é de onde a próxima etapa sequencial nasce — uma etapa só no
    caminho normal, e todas as irmãs quando o trecho abriu em paralelo.
    `origemDaFrente` é de onde a **frente atual** nasceu: uma linha `+` se
    liga ali, e não na irmã que veio antes dela, porque irmãs em paralelo não
    dependem uma da outra — é justamente o que "paralelo" quer dizer.
  */
  let frente: string[] = [];
  let origemDaFrente: string[] = [];

  linhas.forEach((linha, indice) => {
    const lida = lerLinha(linha.texto, linha.numero);
    const chave = `${prefixo}-${indice + 1}`;

    etapas.push({
      chave,
      nome: lida.nome,
      tipo: lida.tipo,
      ordem: ordemInicial + indice,
      area: lida.area,
      sistemaPrincipal: lida.sistemaPrincipal,
    });

    const origens = lida.paralela ? origemDaFrente : frente;
    for (const origem of origens) {
      conexoes.push({ de: origem, para: chave, ordem: conexoes.length });
    }

    if (lida.paralela) {
      frente = [...frente, chave];
    } else {
      origemDaFrente = frente;
      frente = [chave];
    }
  });

  return { etapas, conexoes };
}

/**
 * Quantas etapas este texto vai criar — sem montar nada.
 *
 * A tela usa isto para dizer "13 etapas" embaixo da caixa enquanto a pessoa
 * digita. Está aqui, e não no componente, porque a definição de "linha que
 * conta" (vazias e comentários fora) é a mesma da interpretação e não pode
 * divergir dela.
 */
export function etapasDoRoteiro(texto: unknown): number {
  const bruto = typeof texto === "string" ? texto : "";
  return bruto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#")).length;
}
