import { RecusaDeIntegracao } from "./recusas";

/**
 * A BUSCA ATIVA — nós ligando para o fornecedor, em vez de esperar a ligação.
 *
 * As duas direções que já existiam partem de fora: o sistema de lá empurra o
 * arquivo (`importacoes:enviar`) ou lê o nosso histórico (`importacoes:ler`).
 * Esta é a terceira, e ela inverte quem começa: **numa agenda, este servidor
 * chama um endereço do outro lado, traz o que vier e entrega ao mesmo pipeline
 * de Importações.**
 *
 * ---------------------------------------------------------------------------
 * O que ela busca, e por que só isso
 * ---------------------------------------------------------------------------
 *
 * Um **arquivo .xlsx** — o mesmo export que hoje alguém baixa e sobe à mão. Não
 * é limitação de esforço: é a única coisa que dá para prometer sem inventar. Um
 * "conector genérico" que lesse JSON do fornecedor precisaria de um mapeamento
 * campo a campo do formato **deles** para o nosso, e esse mapeamento não existe
 * porque o formato deles não está escrito em lugar nenhum aqui. O que está
 * escrito, testado e em produção é o leitor de planilha — e é para ele que a
 * busca entrega.
 *
 * Quando existir um endpoint de JSON de verdade para ler, o mapeamento entra
 * como leitor novo em `@workspace/ingest`, ao lado dos que já existem, e esta
 * busca continua a mesma: ela transporta, não interpreta.
 *
 * ---------------------------------------------------------------------------
 * A fronteira é a mesma
 * ---------------------------------------------------------------------------
 *
 * A busca **para no preview**, como a entrada por chave e como o upload pela
 * tela. Uma agenda que promovesse sozinha seria pior do que as outras duas
 * portas: ninguém sequer clicou em "enviar". A aprovação continua sendo de uma
 * pessoa.
 *
 * ---------------------------------------------------------------------------
 * E a defesa que este arquivo existe para escrever
 * ---------------------------------------------------------------------------
 *
 * Um servidor que busca uma URL escolhida por um usuário é um servidor que pode
 * ser usado para alcançar o que **só ele** alcança: o banco na rede interna, o
 * serviço de metadados da nuvem, o `localhost` dele mesmo. É o SSRF, e ele não
 * é hipótese — é a primeira coisa que se tenta contra uma tela como esta.
 *
 * A defesa é em duas camadas, e as duas moram aqui como função pura:
 *
 * 1. **no cadastro**, `conferirDadosDaBusca` recusa o que já se sabe ser
 *    proibido: esquema que não é https, credencial embutida na URL, host que é
 *    endereço privado ou nome reservado;
 * 2. **na hora de buscar**, quem executa resolve o DNS e passa cada endereço
 *    por `ehEnderecoPrivado` antes de abrir a conexão — porque um nome público
 *    pode apontar para `127.0.0.1`, e conferir só no cadastro deixaria essa
 *    porta aberta.
 *
 * A segunda camada é a que importa; a primeira existe para que o erro apareça
 * na tela de quem cadastrou, e não numa execução que falha toda madrugada.
 */

export const METODOS_DA_BUSCA = ["GET", "POST"] as const;
export type MetodoDaBusca = (typeof METODOS_DA_BUSCA)[number];

/** Como a credencial do outro lado viaja na chamada que fazemos. */
export const FORMAS_DE_CREDENCIAL = ["NENHUMA", "BEARER", "CABECALHO"] as const;
export type FormaDeCredencial = (typeof FORMAS_DE_CREDENCIAL)[number];

/**
 * O piso do intervalo, e por que ele existe.
 *
 * Quinze minutos. O export de vigência muda algumas vezes por mês; buscar de
 * minuto em minuto não traria nada mais cedo e transformaria esta agenda num
 * gerador de tráfego contra um sistema de terceiro — que é o tipo de coisa que
 * termina com o nosso endereço bloqueado do outro lado.
 */
export const INTERVALO_MINIMO_MINUTOS = 15;
/** O teto: uma semana. Acima disso o que se quer é uma busca desligada. */
export const INTERVALO_MAXIMO_MINUTOS = 7 * 24 * 60;

export interface DadosDaBusca {
  nome: string;
  url: string;
  metodo: MetodoDaBusca;
  /** Cabeçalhos sem segredo — `Accept`, um `X-Cliente` que o outro lado peça. */
  cabecalhos: Record<string, string>;
  /** O corpo do POST, quando há. Texto como veio; nunca interpretado aqui. */
  corpo: string | null;
  forma: FormaDeCredencial;
  /** O nome do cabeçalho quando `forma` é CABECALHO. */
  cabecalhoDaCredencial: string | null;
  /** O segredo em claro — vai para o cofre e não é guardado assim. */
  credencial: string | null;
  /** O tipo declarado da planilha, como na aba de Importações. */
  tipoDeclarado: string | null;
  intervaloMinutos: number;
}

/**
 * Os nomes de host que nunca são destino legítimo de uma busca.
 *
 * `metadata.google.internal` e o endereço `169.254.169.254` estão aqui porque
 * são o alvo clássico: quem alcança o serviço de metadados da nuvem sai de lá
 * com as credenciais da própria instância.
 */
const HOSTS_PROIBIDOS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

/** Um IPv4 em texto, ou `null` quando não é um. */
function ipv4De(texto: string): number[] | null {
  const partes = texto.split(".");
  if (partes.length !== 4) return null;
  const numeros = partes.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (numeros.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return numeros;
}

/**
 * Este endereço é de uma rede que só nós alcançamos?
 *
 * Vale para IPv4 e IPv6, inclusive na forma que confunde: `::ffff:10.0.0.1` é
 * um endereço IPv6 que **é** um IPv4 privado, e uma conferência que só olhasse
 * o formato o deixaria passar.
 */
export function ehEnderecoPrivado(endereco: string): boolean {
  const limpo = endereco.trim().toLowerCase().replace(/^\[|\]$/g, "");

  const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(limpo);
  if (mapeado) return ehEnderecoPrivado(mapeado[1]!);

  const v4 = ipv4De(limpo);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // laço local
    if (a === 0) return true; // "este host"
    if (a === 169 && b === 254) return true; // link-local, e os metadados da nuvem
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast e reservado
    return false;
  }

  if (limpo === "::" || limpo === "::1") return true; // laço local IPv6
  if (limpo.startsWith("fc") || limpo.startsWith("fd")) return true; // únicos locais
  if (limpo.startsWith("fe80")) return true; // link-local
  return false;
}

/** O host desta URL é proibido pelo que dá para saber sem resolver DNS? */
export function hostProibido(host: string): boolean {
  const limpo = host.trim().toLowerCase().replace(/\.$/, "");
  if (HOSTS_PROIBIDOS.has(limpo)) return true;
  if (limpo.endsWith(".localhost") || limpo.endsWith(".internal")) return true;
  return ehEnderecoPrivado(limpo);
}

/**
 * A URL de uma busca, conferida.
 *
 * Devolve a URL normalizada; lança a recusa do domínio, com a frase que vai
 * para a tela, quando ela não serve.
 */
export function conferirUrlDaBusca(bruta: unknown): string {
  if (typeof bruta !== "string" || bruta.trim() === "") {
    throw new RecusaDeIntegracao("Diga o endereço que devemos chamar.");
  }
  let url: URL;
  try {
    url = new URL(bruta.trim());
  } catch {
    throw new RecusaDeIntegracao(
      `"${bruta}" não é um endereço válido. Ele precisa começar com https://.`,
    );
  }

  if (url.protocol !== "https:") {
    throw new RecusaDeIntegracao(
      "A busca só chama endereços https. Sem TLS, a credencial que mandamos " +
        "junto viaja legível por toda a rede do caminho.",
    );
  }
  if (url.username !== "" || url.password !== "") {
    throw new RecusaDeIntegracao(
      "Tire o usuário e a senha de dentro do endereço. A credencial tem campo " +
        "próprio, e é ele que a guarda cifrada — dentro da URL ela ficaria " +
        "legível na tela, no log e em todo servidor do caminho.",
    );
  }
  if (hostProibido(url.hostname)) {
    throw new RecusaDeIntegracao(
      `"${url.hostname}" é um endereço da rede interna deste servidor, e a ` +
        "busca não alcança a rede interna — é o que impede esta tela de virar " +
        "uma janela para o que só este processo enxerga.",
    );
  }
  return url.toString();
}

/** Cabeçalhos que a busca nunca deixa alguém escrever à mão. */
const CABECALHOS_RESERVADOS = new Set([
  "authorization",
  "host",
  "content-length",
  "connection",
  "cookie",
]);

function conferirCabecalhos(bruto: unknown): Record<string, string> {
  if (bruto === undefined || bruto === null) return {};
  if (typeof bruto !== "object" || Array.isArray(bruto)) {
    throw new RecusaDeIntegracao("Os cabeçalhos precisam vir como um objeto.");
  }
  const entradas = Object.entries(bruto as Record<string, unknown>);
  if (entradas.length > 20) {
    throw new RecusaDeIntegracao("Vinte cabeçalhos é o teto de uma busca.");
  }
  const limpos: Record<string, string> = {};
  for (const [nome, valor] of entradas) {
    const chave = nome.trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(chave)) {
      throw new RecusaDeIntegracao(`"${nome}" não é um nome de cabeçalho válido.`);
    }
    /*
      `authorization` é recusado aqui de propósito, e não por excesso de regra:
      escrito à mão ele iria para o banco **em claro**, ao lado do campo que
      existe para guardá-lo cifrado. Duas portas para a mesma coisa, e a
      insegura seria a mais fácil de usar.
    */
    if (CABECALHOS_RESERVADOS.has(chave)) {
      throw new RecusaDeIntegracao(
        `O cabeçalho "${nome}" não pode ser escrito à mão. Se ele carrega a ` +
          "credencial, use o campo de credencial — é o único que guarda cifrado.",
      );
    }
    if (typeof valor !== "string" || valor.length > 500) {
      throw new RecusaDeIntegracao(
        `O valor de "${nome}" precisa ser texto de até 500 caracteres.`,
      );
    }
    limpos[chave] = valor;
  }
  return limpos;
}

/** Os dados de uma busca, conferidos longe do HTTP e do banco. */
export function conferirDadosDaBusca(corpo: unknown): DadosDaBusca {
  if (typeof corpo !== "object" || corpo === null) {
    throw new RecusaDeIntegracao("Envie um JSON com o endereço e a agenda da busca.");
  }
  const c = corpo as Record<string, unknown>;

  const nome = typeof c["nome"] === "string" ? c["nome"].trim() : "";
  if (nome === "" || nome.length > 120) {
    throw new RecusaDeIntegracao(
      "A busca precisa de um nome — é ele que aparece na agenda e no histórico " +
        "de execuções.",
    );
  }

  const url = conferirUrlDaBusca(c["url"]);

  const metodoBruto = typeof c["metodo"] === "string" ? c["metodo"].toUpperCase() : "GET";
  if (!(METODOS_DA_BUSCA as readonly string[]).includes(metodoBruto)) {
    throw new RecusaDeIntegracao(
      `Método ${metodoBruto} não serve para buscar: a busca lê, e lê com ` +
        `${METODOS_DA_BUSCA.join(" ou ")}.`,
    );
  }
  const metodo = metodoBruto as MetodoDaBusca;

  const corpoDoPedido =
    typeof c["corpo"] === "string" && c["corpo"].trim() !== "" ? c["corpo"] : null;
  if (corpoDoPedido !== null && metodo !== "POST") {
    throw new RecusaDeIntegracao("Só o POST leva corpo; o GET não manda nada.");
  }
  if (corpoDoPedido !== null && corpoDoPedido.length > 10_000) {
    throw new RecusaDeIntegracao("O corpo do pedido é longo demais.");
  }

  const formaBruta = typeof c["forma"] === "string" ? c["forma"].toUpperCase() : "NENHUMA";
  if (!(FORMAS_DE_CREDENCIAL as readonly string[]).includes(formaBruta)) {
    throw new RecusaDeIntegracao(
      `Forma de credencial desconhecida: ${formaBruta}. As que existem são ` +
        `${FORMAS_DE_CREDENCIAL.join(", ")}.`,
    );
  }
  const forma = formaBruta as FormaDeCredencial;

  const credencial =
    typeof c["credencial"] === "string" && c["credencial"].trim() !== ""
      ? c["credencial"].trim()
      : null;
  if (forma !== "NENHUMA" && credencial === null) {
    throw new RecusaDeIntegracao(
      "Esta forma de credencial precisa do segredo do outro lado. Ele é " +
        "guardado cifrado e nunca volta a aparecer nesta tela.",
    );
  }
  if (forma === "NENHUMA" && credencial !== null) {
    throw new RecusaDeIntegracao(
      "Você mandou um segredo e disse que a chamada não leva credencial. " +
        "Escolha como ele viaja — Bearer ou num cabeçalho — ou tire o segredo.",
    );
  }

  let cabecalhoDaCredencial: string | null = null;
  if (forma === "CABECALHO") {
    const bruto = typeof c["cabecalhoDaCredencial"] === "string"
      ? c["cabecalhoDaCredencial"].trim().toLowerCase()
      : "";
    if (!/^[a-z0-9-]+$/.test(bruto)) {
      throw new RecusaDeIntegracao(
        "Diga em que cabeçalho a credencial vai — por exemplo, x-api-key.",
      );
    }
    cabecalhoDaCredencial = bruto;
  }

  const cabecalhos = conferirCabecalhos(c["cabecalhos"]);
  if (cabecalhoDaCredencial !== null && cabecalhoDaCredencial in cabecalhos) {
    throw new RecusaDeIntegracao(
      `"${cabecalhoDaCredencial}" está nos dois lugares: como cabeçalho fixo e ` +
        "como o cabeçalho da credencial. Deixe só o da credencial.",
    );
  }

  const intervalo = Number(c["intervaloMinutos"]);
  if (!Number.isInteger(intervalo)) {
    throw new RecusaDeIntegracao("Diga de quantos em quantos minutos devemos buscar.");
  }
  if (intervalo < INTERVALO_MINIMO_MINUTOS) {
    throw new RecusaDeIntegracao(
      `O intervalo mínimo é de ${INTERVALO_MINIMO_MINUTOS} minutos. O export ` +
        "muda algumas vezes por mês; buscar mais de perto não o traria mais " +
        "cedo, e viraria tráfego contra o sistema do outro lado.",
    );
  }
  if (intervalo > INTERVALO_MAXIMO_MINUTOS) {
    throw new RecusaDeIntegracao(
      "Acima de uma semana o que se quer é uma busca pausada, e isso tem botão.",
    );
  }

  const tipoDeclarado =
    typeof c["tipoDeclarado"] === "string" && c["tipoDeclarado"].trim() !== ""
      ? c["tipoDeclarado"].trim()
      : null;

  return {
    nome,
    url,
    metodo,
    cabecalhos,
    corpo: corpoDoPedido,
    forma,
    cabecalhoDaCredencial,
    credencial,
    tipoDeclarado,
    intervaloMinutos: intervalo,
  };
}

/**
 * Quando a próxima execução acontece.
 *
 * Conta a partir de **agora**, e não do horário em que a anterior deveria ter
 * rodado. A diferença aparece depois de uma indisponibilidade longa: contando
 * do previsto, uma busca parada por seis horas acordaria e dispararia as vinte
 * e quatro execuções que "deveria" ter feito, todas contra o sistema do outro
 * lado, todas trazendo o mesmo arquivo. Contando de agora, ela volta ao ritmo
 * na próxima janela — que é o que se quer de uma agenda que existe para trazer
 * o arquivo do dia.
 */
export function proximaExecucao(agora: Date, intervaloMinutos: number): Date {
  return new Date(agora.getTime() + intervaloMinutos * 60 * 1000);
}

export type ResultadoDaExecucao = "OK" | "SEM_NOVIDADE" | "RECUSADA" | "FALHA";

/** O que cada desfecho quer dizer para quem lê o histórico. */
export const EXPLICACAO_DO_RESULTADO: Record<ResultadoDaExecucao, string> = {
  OK: "O arquivo veio e entrou como importação, aguardando aprovação.",
  SEM_NOVIDADE:
    "O arquivo veio igual ao que já tínhamos. Nada foi importado de novo — é o desfecho normal de uma agenda que busca mais vezes do que a fonte muda.",
  RECUSADA:
    "O outro lado respondeu, e a resposta não serve: erro HTTP, ou conteúdo que não é uma planilha.",
  FALHA: "A chamada não completou — rede, tempo esgotado, ou defeito nosso.",
};
