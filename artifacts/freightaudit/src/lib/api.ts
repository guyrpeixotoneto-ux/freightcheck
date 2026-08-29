import { ambienteDe, ehAuditoria, OPERACAO_DA_AUDITORIA } from "@/lib/ambiente";
import { ehDiagnostico, type Diagnostico } from "@/lib/diagnostico";
import { ErroDeTransporte, diagnosticarTransporte } from "@/lib/transporte";

/**
 * Returns the full URL for an API endpoint path.
 * In the Replit monorepo, the api-server is mounted at /api.
 *
 * @param path  e.g. "/fleet-analysis/summary" → "/api/fleet-analysis/summary"
 */
export function getApiUrl(path: string): string {
  const base = "/api";
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const endereco = enderecoAberto();
  return `${base}${comAmbiente(comOperacao(normalized, endereco), endereco)}`;
}

/**
 * A operação da auditoria aberta, em **toda** chamada — e por que aqui.
 *
 * As quatro auditorias leem o mesmo produto sobre acervos diferentes
 * (`lib/ambiente.ts`), e o servidor separa os acervos por `?operacao=`
 * (`snapshot.canal`, a coluna canônica). A pergunta é onde o cliente carimba
 * isso, e a resposta não podia ser "em cada tela": são mais de cem consultas, e
 * a que alguém esquecesse seria uma tela de Rota mostrando números da Empurrada
 * — sem erro nenhum na tela, que é a forma mais cara de essa regressão
 * aparecer. É a mesma razão pela qual a família do dataset vive dentro de
 * `contextFilter`, do lado do servidor, e não em sessenta consultas.
 *
 * Então o carimbo é aqui, no único lugar por onde todas passam: `getApiUrl`
 * monta o endereço de toda chamada deste produto — as consultas, as mutações,
 * os downloads de planilha, o `EventSource` do assistente.
 *
 * **A operação vem do endereço do navegador, e não de um estado.** É a mesma
 * regra que `lib/ambiente.ts` já declara: a URL é a única fonte da verdade sobre
 * o ambiente aberto. Um estado guardado seria uma segunda verdade, e a errada —
 * bastaria uma navegação sem re-render para a tela pedir o acervo do ambiente
 * anterior.
 *
 * Fora das auditorias — nos fechamentos — nada é carimbado: lá o recorte é
 * `tipoDeOperacao` na competência, que é outro eixo, e um `operacao` a mais na
 * consulta seria ruído. Quem já manda o parâmetro por conta própria também
 * passa intacto: o carimbo nunca sobrescreve o que a chamada pediu.
 */
function enderecoAberto(): string {
  if (typeof window === "undefined") return "/";
  /*
    Sem a base da aplicação: `ambienteDe` fala a língua das rotas, e não a do
    servidor que as hospeda. Quando o produto é servido sob um subcaminho, o
    `pathname` do navegador o traz na frente — a mesma correção que
    `lib/ambiente-aberto.ts` faz do lado dos componentes.
  */
  const daAplicacao = import.meta.env.BASE_URL.replace(/\/$/, "");
  const caminho = window.location.pathname;
  return daAplicacao !== "" && caminho.startsWith(daAplicacao)
    ? caminho.slice(daAplicacao.length) || "/"
    : caminho;
}

/**
 * O ambiente de trabalho aberto, em **toda** chamada — o segundo carimbo.
 *
 * `?operacao=` diz de qual acervo é a pergunta; `?ambiente=` diz de qual dos
 * oito espaços de trabalho ela saiu. São coisas diferentes, e por isso são dois
 * parâmetros: a Auditoria Rota e o Fechamento Rota carimbam `ROTA` na operação
 * e são ambientes distintos, com acessos que se decidem separadamente
 * (`components/configuracoes/permissoes.tsx`).
 *
 * Serve a uma coisa só, e é honesto dizer qual: o portão do servidor
 * (`middlewares/portao-de-permissao.ts`) recusa **escrita** de quem não tem
 * edição no ambiente de onde a chamada saiu. Não é recorte de dado — o recorte
 * é `?operacao=`, e ele não depende de permissão nenhuma.
 *
 * É carimbado nos oito, e não só nos prefixados: fora de um prefixo o ambiente
 * é a Auditoria Empurrada, que mora na raiz (`lib/ambiente.ts`), e ela é um
 * ambiente como os outros — restringível como os outros. Quem cuida de não
 * bloquear a Administração por causa disso é o servidor, que conhece as
 * escritas que valem para o produto inteiro; aqui não há como saber, porque
 * este carimbo lê o endereço e não o menu.
 */
export function comAmbiente(caminho: string, enderecoDoNavegador: string): string {
  const [semQuery, query = ""] = caminho.split("?");
  const params = new URLSearchParams(query);
  if (params.has("ambiente")) return caminho;
  params.set("ambiente", ambienteDe(enderecoDoNavegador));
  return `${semQuery}?${params}`;
}

export function comOperacao(caminho: string, enderecoDoNavegador: string): string {
  const ambiente = ambienteDe(enderecoDoNavegador);
  if (!ehAuditoria(ambiente)) return caminho;

  const [semQuery, query = ""] = caminho.split("?");
  const params = new URLSearchParams(query);
  if (params.has("operacao")) return caminho;
  params.set("operacao", OPERACAO_DA_AUDITORIA[ambiente]);
  return `${semQuery}?${params}`;
}

/**
 * O teto de uma tentativa, para uma chamada nunca esperar para sempre.
 *
 * `fetch` sem `signal` não tem prazo nenhum: se a conexão abre e ninguém do
 * outro lado nunca escreve um byte — um processo preso, um `await` sem fim
 * numa rota, um proxy que segura a conexão em vez de fechá-la —, a promessa
 * fica pendurada indefinidamente, e com ela toda a política de
 * `resiliencia.ts`: as cinco tentativas e o `TETO_DA_ESPERA` de 8s entre elas
 * pressupõem que **cada tentativa** eventualmente resolve, uma hora ou outra.
 * Sem um teto aqui, a primeira tentativa nunca chega a falhar, e a tela fica
 * em "Carregando…" para sempre — pior do que o painel de indisponibilidade
 * que existe exatamente para esse caso.
 *
 * 45s é generoso de propósito: a maior espera legítima medida neste produto é
 * a promoção de uma vigência grande (dezenas de segundos, ver
 * `opcoesDoPool` em `lib/db`), e nenhuma rota de leitura chega perto disso.
 * O objetivo não é apertar o normal — é garantir que o anormal termine.
 */
const TEMPO_LIMITE_MS = 45_000;

/** Os status que significam "vá procurar noutro endereço". */
function ehRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

/**
 * Fazer a requisição, com a falha de transporte já classificada.
 *
 * `fetch` rejeita com `TypeError` quando a requisição não completa — conexão
 * recusada, DNS, TLS, um redirect de outra origem barrado por CORS, a conexão
 * cortada no meio. Todas chegam com a mesma frase ("Failed to fetch" no Chrome,
 * "Load failed" no Safari, "NetworkError…" no Firefox), e todas subiam daqui
 * **cruas**.
 *
 * Deixar o `TypeError` subir cru custava duas coisas, e as duas apareceram na
 * tela. A primeira: quem classificava era `apresentar-erro.ts`, por
 * `instanceof TypeError` — o que significa que **qualquer** `TypeError` do nosso
 * próprio código (um contrato que mudou, um `.map` num objeto) era apresentado
 * como "o servidor não respondeu", mandando procurar rede quando o defeito
 * estava numa linha. A segunda: a frase do navegador, que é a única pista real
 * de qual das causas foi, se perdia no caminho.
 *
 * Aqui a falha vira `ErroDeTransporte` — o tipo que o resto da interface já sabe
 * ler — e a frase do navegador vai junto, como evidência. O que sobra de
 * `TypeError` depois desta função é, por eliminação, defeito nosso.
 *
 * O cancelamento é separado do resto e não é falha de rede: quem cancelou fomos
 * nós (um `AbortController`, uma navegação que desmontou a tela), e repetir uma
 * chamada cancelada de propósito é o oposto do que se quer. O teto de tempo
 * desta função **não** é esse caso: ele é a rede não terminando, e por isso
 * conta como `SEM_RESPOSTA` — transitório, e a política de cima repete.
 */
async function requisitar(path: string, init?: RequestInit): Promise<Response> {
  const url = getApiUrl(path);
  const inicio =
    typeof performance !== "undefined" ? performance.now() : Date.now();
  const decorrido = () =>
    Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - inicio);

  const controlador = new AbortController();
  let esgotouTempo = false;
  const cronometro = setTimeout(() => {
    esgotouTempo = true;
    controlador.abort();
  }, TEMPO_LIMITE_MS);

  // Um cancelamento de quem chamou (desmontagem, navegação) continua sendo
  // cancelamento — o teto de tempo só entra quando ninguém pediu nada.
  const sinalDeQuemChamou = init?.signal ?? null;
  const propagar = () => controlador.abort();
  if (sinalDeQuemChamou) {
    if (sinalDeQuemChamou.aborted) controlador.abort();
    else sinalDeQuemChamou.addEventListener("abort", propagar);
  }

  try {
    /*
      `redirect: "manual"` — e é isto que transforma o desvio da plataforma de
      sintoma opaco em diagnóstico.

      Esta API não redireciona em rota nenhuma: toda resposta dela é JSON, com
      status próprio. Um 3xx em `/api/*` é sempre uma camada intermediária
      falando no lugar dela, e em produção já se observou o caso concreto —
      `freightcheck.com.br/api/…` respondendo 302 para
      `replit.com/__replshield`.

      Com o padrão (`"follow"`), o navegador segue o redirect para outra origem,
      a leitura é barrada por CORS e `fetch` rejeita com `TypeError: Failed to
      fetch`. Nesse ponto o desvio é **indistinguível** de um cabo solto: o erro
      não diz para onde foi, nem que houve resposta. E como `TypeError` é a
      falha mais transitória que existe, a política de repetição gastava as
      cinco tentativas e treze segundos numa chamada que ia ser desviada
      exatamente igual em todas elas.

      Com `"manual"` o navegador não segue nada: devolve uma resposta opaca
      (`type: "opaqueredirect"`, `status: 0`) e o desvio vira fato observável,
      classificado como `DESVIADA` — que a política não repete. Não se perde
      nada ao não seguir: não há uma única rota desta API atrás de um redirect.
    */
    const resposta = await fetch(url, {
      redirect: "manual",
      ...init,
      signal: controlador.signal,
    });

    if (resposta.type === "opaqueredirect" || ehRedirect(resposta.status)) {
      /*
        Num redirect opaco o navegador não deixa ler nem o destino nem o
        `Location` — e essa ausência é o próprio fato, então `null` entra como
        destino. Quando o redirect é da mesma origem, o `Location` está lá.
      */
      const destino =
        resposta.type === "opaqueredirect"
          ? null
          : resposta.headers.get("location");
      console.warn(
        `[transporte] ${url} — DESVIADA${destino ? ` para ${destino}` : ""}, ` +
          `${decorrido()}ms. A chamada não chegou à API.`,
      );
      throw new ErroDeTransporte(
        diagnosticarTransporte({ desviadaPara: destino }),
      );
    }

    return resposta;
  } catch (err) {
    // Um desvio já foi classificado acima; não é falha de rede.
    if (err instanceof ErroDeTransporte) throw err;

    const nome =
      typeof err === "object" && err !== null
        ? (err as { name?: unknown }).name
        : undefined;

    if (nome === "AbortError" && !esgotouTempo) {
      // Cancelamento de quem chamou — não é falha de transporte, não entra
      // no registro de falhas (`registrarFalha`, uma camada acima, também
      // não registra `REQUISICAO_CANCELADA`: ver `chamada-resiliente.ts`).
      throw new ErroDeTransporte(diagnosticarTransporte({ cancelada: true }));
    }

    /*
      Uma linha aqui, e não só no registro de `chamada-resiliente.ts`: esta
      função também é chamada por fora de `useQuery` — a mutação de
      Justificativas, `fetchArquivo` — caminhos que não passam por
      `registrarFalha`. URL, duração e o estado que se está prestes a lançar
      são exatamente os três fatos que o item 4 pede para toda chamada que
      não completa, e aqui é o único lugar por onde todas passam.
    */
    console.warn(
      `[transporte] ${url} — ${esgotouTempo ? "TEMPO_ESGOTADO" : "SEM_RESPOSTA"}, ` +
        `${decorrido()}ms.`,
    );

    throw new ErroDeTransporte(
      diagnosticarTransporte(
        esgotouTempo
          ? { naoCompletou: true, esgotouTempo: true, tempoLimiteMs: TEMPO_LIMITE_MS }
          : {
              naoCompletou: true,
              ...(err instanceof Error && err.message !== ""
                ? { motivo: err.message }
                : {}),
            },
      ),
    );
  } finally {
    clearTimeout(cronometro);
    sinalDeQuemChamou?.removeEventListener("abort", propagar);
  }
}

/**
 * Ler o corpo de uma resposta sem confiar que ela é o que se pediu.
 *
 * Esta função nasceu dentro da tela de Importações e vive aqui porque o defeito
 * que ela evita não era daquela tela: era de toda chamada escrita como
 * `(await fetch(...)).json()`. Um 500 desta API também é JSON — `{"error":
 * "Internal server error"}` — então `.json()` devolve um objeto, a chamada
 * parece ter dado certo, e o objeto de erro segue viagem no lugar dos dados.
 * Duas linhas adiante alguém lê `data.impactByPeriodicity.length`, encontra
 * `undefined`, e o React derruba a árvore inteira: tela branca, com o motivo
 * verdadeiro (o banco) invisível.
 */
export async function readJson(response: Response): Promise<Record<string, unknown>> {
  /*
    Ler o corpo também pode falhar, e a falha tem status.

    `response.text()` rejeita com `TypeError` quando a conexão morre **depois**
    da linha de resposta — o corpo é um stream, e um stream cortado no meio não
    é "não houve resposta". Escapando cru daqui, essa falha caía no `instanceof
    TypeError` de `apresentar-erro.ts` e era anunciada como `SEM_RESPOSTA`: a
    tela dizia que não recebeu status nenhum sobre uma chamada cujo status ela
    tinha lido. É a mesma classe de erro de diagnóstico que este eixo existe para
    evitar, uma camada abaixo.

    Com status, o caso é `RESPOSTA_INCOMPLETA`, que é o que de fato aconteceu.
  */
  let text: string;
  try {
    text = await response.text();
  } catch (err) {
    throw new ErroDeTransporte(
      diagnosticarTransporte({
        status: response.status,
        corpoVazio: true,
        ...(err instanceof Error && err.message !== ""
          ? { motivo: err.message }
          : {}),
      }),
    );
  }

  /*
    As frases desta função eram escritas aqui, em `throw new Error(...)`. Era a
    mesma classe de defeito que produziu, no eixo do banco, dois avisos
    contraditórios na mesma tela: diagnóstico redigido onde o erro acontece, sem
    tipo e sem dono. Agora quem classifica é `diagnosticarTransporte`, e o que
    sobe carrega o diagnóstico em vez de uma linha de texto.
  */
  if (!text.trim()) {
    throw new ErroDeTransporte(
      diagnosticarTransporte({ status: response.status, corpoVazio: true }),
    );
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new ErroDeTransporte(
      diagnosticarTransporte({ status: response.status, corpoNaoJson: text }),
    );
  }
}

/**
 * A falha de uma chamada, com o que o servidor disse junto.
 *
 * A mensagem sozinha não distinguia "o arquivo que você mandou não serve" de "o
 * banco deste ambiente não tem a tabela" — as duas chegavam como texto vermelho
 * de uma linha. O status separa as duas, e é o que permite a uma tela mostrar a
 * explicação inteira (com o que `/api/healthz` enxerga) só quando a causa está
 * do lado de lá.
 */
export class ApiError extends Error {
  readonly status: number;
  /** O `code` que a API manda em alguns erros — `SCHEMA_AUSENTE`, … */
  readonly code?: string;
  /**
   * O contexto da rota: qual schema falta, e o que houve com o envio.
   *
   * É só o que a rota sabe e mais ninguém. Recomendação nenhuma vem por aqui.
   */
  readonly contexto?: string;
  /**
   * O estado do banco classificado pelo servidor.
   *
   * Quando vem preenchido, é a **única** recomendação que a interface
   * apresenta. Era daqui que nascia o defeito que este campo elimina: a tela
   * imprimia o texto da rota e o do `/healthz` um embaixo do outro, e os dois
   * mandavam fazer coisas diferentes sobre o mesmo erro.
   */
  readonly diagnostico?: Diagnostico;
  /**
   * O identificador que o servidor deu a esta requisição.
   *
   * É o único campo desta classe que serve para uma falha que **ninguém** sabe
   * explicar — e é justamente essa que a interface mais recebia. Um 500 do
   * contrato JSON traz `requestId`; a linha de log que o descreve, com a
   * exceção inteira, traz o mesmo valor. Sem ele, "deu erro nesta tela" e "o
   * log tem quatrocentas linhas" são dois fatos que não se encontram, e a
   * pessoa na tela não tem o que dizer a quem consegue ler o log.
   */
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    extra?: {
      contexto?: string;
      diagnostico?: Diagnostico;
      requestId?: string;
    },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    if (code !== undefined) this.code = code;
    if (extra?.contexto !== undefined) this.contexto = extra.contexto;
    if (extra?.diagnostico !== undefined) this.diagnostico = extra.diagnostico;
    if (extra?.requestId !== undefined) this.requestId = extra.requestId;
  }
}

/**
 * GET numa rota da API, com a falha como falha.
 *
 * É o que todo `useQuery` desta interface deve chamar. Um status fora do 2xx
 * vira exceção, que é o que o React Query sabe tratar — `isError` em vez de
 * `data` com o formato errado.
 */
/**
 * O erro de uma resposta que não deu certo, com tudo o que ela trouxe.
 *
 * **Este é o único lugar que constrói um `ApiError` a partir de uma resposta.**
 * Não é organização: enquanto cada tela montava o seu, elas montavam pela
 * metade. A de Alterações criava um `ApiError` com status e `code` e deixava
 * `contexto` e `diagnostico` para trás; as de Importações e do Assistente
 * jogavam fora até o status, subindo um `Error` de uma linha. O efeito é que a
 * tela perdia o diagnóstico estruturado justamente no caminho em que ele mais
 * importa — o do upload — e caía no texto cru ao lado do aviso do `/healthz`,
 * que é o defeito das duas recomendações voltando pela porta dos fundos.
 *
 * @param prefixo  o nome do arquivo, quando a chamada é um envio. Entra na
 *                 mensagem **e** no contexto: "qual arquivo" é a primeira coisa
 *                 que se quer saber quando se mandaram vários.
 */
export function erroDaResposta(
  response: Response,
  body: Record<string, unknown>,
  prefixo?: string,
): ApiError {
  const comPrefixo = (texto: string) =>
    prefixo ? `${prefixo}: ${texto}` : texto;
  const mensagem =
    typeof body.error === "string"
      ? body.error
      : `o servidor respondeu ${response.status}.`;

  return new ApiError(
    comPrefixo(mensagem),
    response.status,
    typeof body.code === "string" ? body.code : undefined,
    {
      ...(typeof body.contexto === "string"
        ? { contexto: comPrefixo(body.contexto) }
        : {}),
      ...(ehDiagnostico(body.diagnostico)
        ? { diagnostico: body.diagnostico }
        : {}),
      ...(typeof body.requestId === "string" && body.requestId !== ""
        ? { requestId: body.requestId }
        : {}),
    },
  );
}

/**
 * O sucesso que **não tem corpo** — e por isso não passa por `readJson`.
 *
 * Um 204 é a resposta certa de quem apagou: não há o que devolver sobre uma
 * coisa que deixou de existir. Mas `readJson` trata corpo vazio como defeito de
 * transporte, porque é isso que ele é em toda rota que promete JSON — e essa
 * regra, aplicada também ao 204, transformava a exclusão bem-sucedida de uma
 * conexão de fluxo em "A resposta do servidor chegou pela metade — a conexão
 * foi interrompida no caminho": o registro tinha sido apagado no banco, e a
 * tela dizia que nada tinha sido enviado e mandava tentar de novo.
 *
 * O corte é pelo status, e não por corpo vazio: 204 e 205 são os dois códigos
 * em que a ausência de corpo é o contrato do HTTP, e não a metade de uma
 * resposta que se perdeu. Qualquer outro status vazio continua sendo defeito.
 */
function semConteudo(response: Response): boolean {
  return response.status === 204 || response.status === 205;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await requisitar(path, init);
  if (response.ok && semConteudo(response)) return undefined as T;
  const body = await readJson(response);
  if (!response.ok) throw erroDaResposta(response, body);
  // `readJson` descreve o corpo como objeto porque é assim que os erros desta
  // API vêm; várias rotas devolvem lista, e a conversão passa por `unknown`.
  return body as unknown as T;
}

/**
 * O nome que o servidor deu ao anexo, lido do `Content-Disposition`.
 *
 * O `filename*` da RFC 5987 vem primeiro porque é o que carrega acento: o
 * `filename` simples é a reserva ASCII que o servidor manda junto, com os
 * caracteres altos já trocados por `_` (ver `contentDisposition` em
 * `routes/book.ts`). Preferir a reserva daria a quem baixa
 * "Impacto - CAMA_ARI.xlsx" quando o nome inteiro estava ali ao lado.
 *
 * Devolve `null` quando não há cabeçalho ou ele não traz nome — e aí quem chama
 * usa o padrão dele, em vez de salvar um arquivo chamado "download".
 */
export function nomeDoAnexo(cabecalho: string | null): string | null {
  if (!cabecalho) return null;

  const estendido = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(cabecalho);
  if (estendido) {
    try {
      return decodeURIComponent(estendido[1].trim());
    } catch {
      // Percent-encoding quebrado é do servidor; cair na reserva ASCII abaixo é
      // melhor do que subir um erro por causa do nome de um arquivo que veio.
    }
  }

  /*
    As aspas saem depois de casar, e não dentro do padrão: com dois ramos — um
    para o nome entre aspas e outro sem — um `filename=""` não casa o primeiro,
    cai no segundo e volta como o nome de dois caracteres `""`, que é um arquivo
    chamado "aspas aspas" no computador de quem baixou.
  */
  const simples = /filename\s*=\s*([^;]+)/i.exec(cabecalho);
  const nome = simples?.[1]
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .trim();
  return nome ? nome : null;
}

/**
 * GET numa rota que responde **arquivo** no sucesso e JSON no erro.
 *
 * É o par de `fetchJson` para o único caminho desta API em que o corpo de
 * sucesso não é JSON: a exportação em Excel. A assimetria é deliberada e é o que
 * mantém a promessa de `lib/transporte.ts` de pé — um 404 "nada mudou neste
 * recorte" precisa chegar como frase legível, e não como um `.xlsx` de 40 bytes
 * com uma mensagem de erro dentro, que é o que acontece quando se baixa por
 * `window.location` e se deixa o navegador cuidar do resultado.
 */
export async function fetchArquivo(
  path: string,
  init?: RequestInit,
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await requisitar(path, init);
  if (!response.ok) {
    const body = await readJson(response);
    throw erroDaResposta(response, body);
  }
  return {
    blob: await response.blob(),
    filename: nomeDoAnexo(response.headers.get("Content-Disposition")),
  };
}

/**
 * Entregar ao navegador um arquivo que já está na memória.
 *
 * O `revokeObjectURL` não é higiene opcional: sem ele o blob fica preso até a
 * aba ser fechada, e uma planilha de trinta e cinco abas exportada cinco vezes
 * numa tarde são cinco cópias vivas de alguns megabytes cada.
 */
export function salvarArquivo(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * GET numa rota que responde 404 quando ainda não existe o que mostrar.
 *
 * Várias telas leem rotas em que "nenhuma vigência importada ainda" chega como
 * 404 com `{"error": …}` — vazio de conteúdo, não falha. Elas escreviam a mesma
 * sequência à mão (`fetch`, `status === 404`, `.json()`), e a mão trazia junto
 * o defeito que `readJson` existe para evitar: quando a resposta não é nossa —
 * 502 sem corpo do roteador com ninguém atrás de `/api` — `.json()` estoura com
 * "Unexpected end of JSON input", e a tela acusa um formato inválido de um
 * servidor que não chegou a responder.
 *
 * O vazio continua vazio (`null`), e só ele: um 404 sem o nosso corpo JSON não
 * é "ainda não importaram", é o roteador não achando a rota — esse sobe como
 * falha, com `readJson` dizendo de que lado o defeito está.
 */
export async function fetchJsonOrNull<T>(
  path: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    return await fetchJson<T>(path, init);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}
