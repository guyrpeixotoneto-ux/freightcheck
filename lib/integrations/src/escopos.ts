/**
 * OS ESCOPOS — o que uma chave alcança, e o que ela nunca alcança.
 *
 * O catálogo é escrito aqui e em nenhum outro lugar. A tela o exibe, a rota o
 * cobra e o teste o percorre; três listas escritas à mão divergiriam no
 * primeiro escopo que alguém acrescentasse a uma e esquecesse nas outras — e a
 * que ficasse para trás seria a que **concede** onde não devia.
 *
 * **A regra do catálogo: só entra escopo que já tem rota.** Um escopo que
 * anuncia o que ainda não existe é pior do que a ausência dele: quem integra
 * escreve o cliente contra o nome, e descobre no dia da virada que o endereço
 * responde 404. O que ainda não existe está escrito em `docs/INTEGRACOES.md`,
 * como plano, e não aqui, como oferta.
 *
 * **Nenhum escopo promove importação.** A entrada por API vai até o preview —
 * o arquivo entra, é lido e conferido, e para lá, exatamente onde para o
 * arquivo que sobe pela tela. A aprovação continua sendo o clique de uma
 * pessoa em Importações, porque é ela quem responde pelo que passou a valer.
 * Um escopo `importacoes:promover` deixaria um sistema externo publicar
 * remuneração sem que ninguém tivesse olhado, e é justamente essa fronteira
 * que o produto inteiro existe para manter.
 */

export const ESCOPOS = [
  "importacoes:enviar",
  "importacoes:ler",
] as const;

export type Escopo = (typeof ESCOPOS)[number];

export interface DescricaoDeEscopo {
  escopo: Escopo;
  /** O rótulo curto da tela. */
  titulo: string;
  /** O que a chave passa a poder, em uma frase, sem jargão. */
  permite: string;
  /** Os endereços que ele abre — o que o cliente do outro lado vai chamar. */
  rotas: readonly string[];
  /** ENTRADA quando escreve no FreightCheck; SAIDA quando só lê. */
  direcao: "ENTRADA" | "SAIDA";
}

export const CATALOGO_DE_ESCOPOS: readonly DescricaoDeEscopo[] = [
  {
    escopo: "importacoes:enviar",
    titulo: "Enviar planilha",
    permite:
      "Enviar um export do Freightec para o mesmo pipeline da tela: o arquivo " +
      "é recebido, lido e conferido, e fica aguardando aprovação humana em " +
      "Importações. Nada é publicado por esta chave.",
    rotas: ["POST /api/v1/importacoes"],
    direcao: "ENTRADA",
  },
  {
    escopo: "importacoes:ler",
    titulo: "Acompanhar importações",
    permite:
      "Consultar o histórico de importações e o estado de uma delas — é como " +
      "o sistema que enviou descobre se o arquivo foi lido, se falhou e por quê.",
    rotas: ["GET /api/v1/importacoes", "GET /api/v1/importacoes/:id"],
    direcao: "SAIDA",
  },
];

export function ehEscopo(valor: unknown): valor is Escopo {
  return typeof valor === "string" && (ESCOPOS as readonly string[]).includes(valor);
}

/**
 * Os escopos de uma lista qualquer, sem os que este servidor não conhece.
 *
 * Um escopo desconhecido não é recusa da chave inteira: é uma linha gravada por
 * um build mais novo do que este processo, e derrubar a chave por causa dela
 * transformaria um deploy fora de ordem em integração parada. Ele simplesmente
 * não concede nada, que é o desfecho seguro.
 */
export function escoposConhecidos(valores: unknown): Escopo[] {
  if (!Array.isArray(valores)) return [];
  const vistos = new Set<Escopo>();
  for (const valor of valores) if (ehEscopo(valor)) vistos.add(valor);
  return [...vistos];
}

/** A chave alcança este escopo? */
export function alcanca(escoposDaChave: readonly string[], exigido: Escopo): boolean {
  return escoposDaChave.includes(exigido);
}

/** A descrição de um escopo, para a tela e para a mensagem de recusa. */
export function descrever(escopo: Escopo): DescricaoDeEscopo {
  const achado = CATALOGO_DE_ESCOPOS.find((d) => d.escopo === escopo);
  /*
    O `!` não cabe aqui: o catálogo e o tipo saem da mesma constante, mas quem
    lê este arquivo daqui a um ano não tem como saber disso sem conferir. Um
    lançamento com o nome do escopo é mais barato do que um `undefined` que
    viaja até a tela.
  */
  if (!achado) throw new Error(`Escopo sem descrição no catálogo: ${escopo}`);
  return achado;
}
