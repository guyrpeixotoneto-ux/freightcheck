import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import type { LookupAddress, LookupAllOptions, LookupOneOptions } from "node:dns";
import { writeFileSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import { request } from "node:https";
import path from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  integracaoBuscaTable,
  integracaoExecucaoTable,
  integracaoTable,
  type Database,
} from "@workspace/db";
import {
  ensureImportStorageDir,
  exigirTipoDeclarado,
  getImportRunStatus,
  receiveFile,
} from "@workspace/ingest";
import {
  IntegracaoNaoEncontrada,
  RecusaDeIntegracao,
  conferirUrlDaBusca,
  ehEnderecoPrivado,
  proximaExecucao,
  type DadosDaBusca,
  type ResultadoDaExecucao,
} from "@workspace/integrations";
import { CofreIndisponivel, abrirSegredo, guardarSegredo } from "./cofre";
import { readInBackground, type Log } from "../routes/imports";

/**
 * O MOTOR DA BUSCA ATIVA — buscar o arquivo, e o que ele nunca faz.
 *
 * Uma execução tem cinco passos, e cada um pode terminar a história:
 *
 *   1. conferir o endereço outra vez, e resolver o nome com guarda — a defesa
 *      que só pode acontecer aqui;
 *   2. chamar, com teto de tempo e de tamanho;
 *   3. conferir que o que veio é mesmo uma planilha;
 *   4. entregar ao pipeline (`receiveFile`), que decide se é novidade;
 *   5. ler até o preview — e parar ali.
 *
 * ---------------------------------------------------------------------------
 * O passo 1 é o que impede esta tela de virar uma janela para a rede interna
 * ---------------------------------------------------------------------------
 *
 * Conferir a URL no cadastro não basta: `api.fornecedor.com` pode resolver para
 * `127.0.0.1` — de propósito ou não —, e quem busca é um processo que enxerga o
 * banco, o `localhost` e o serviço de metadados da nuvem. Por isso a conferência
 * é **a própria resolução de nome da conexão** (`resolverComGuarda`, passada
 * como `lookup` ao `https.request`): não há uma resolução para conferir e outra
 * para conectar, então não há janela entre as duas.
 *
 * Pela mesma razão os redirecionamentos são seguidos **à mão**: um `302` para
 * `http://169.254.169.254/` desfaria toda a conferência do cadastro se a
 * biblioteca o seguisse sozinha. Cada salto é reconferido do zero, e **a
 * credencial não atravessa salto para outro host** — quem redireciona para um
 * domínio de arquivos assinados não precisa dela, e quem precisaria dela não
 * deveria recebê-la sem que alguém tivesse decidido isso.
 *
 * ---------------------------------------------------------------------------
 * E o passo 5 é a fronteira de sempre
 * ---------------------------------------------------------------------------
 *
 * A busca **não promove**. Ela deixa a importação em PREVIEWED, com o resumo
 * pronto, e a aprovação continua sendo o clique de uma pessoa em Importações.
 * Uma agenda que publicasse sozinha seria a pior das três portas: ninguém
 * sequer clicou em "enviar".
 */

/** O teto de tempo de uma busca. Além disso, é falha. */
const TEMPO_LIMITE_MS = 60_000;
/** O teto de tamanho: o mesmo do upload pela tela. */
const TAMANHO_LIMITE_BYTES = 64 * 1024 * 1024;
/** Quantos redirecionamentos a busca segue, reconferindo cada um. */
const SALTOS_MAXIMOS = 3;

export interface BuscaNaTela {
  id: string;
  nome: string;
  url: string;
  metodo: string;
  tipoDeclarado: string | null;
  intervaloMinutos: number;
  temCredencial: boolean;
  forma: string;
  proximaEm: string;
  pausadaEm: string | null;
  pausadaPor: string | null;
  criadaEm: string;
  criadaPor: string;
  ultima: ExecucaoNaTela | null;
}

export interface ExecucaoNaTela {
  id: string;
  em: string;
  disparo: string;
  resultado: string;
  statusHttp: number | null;
  duracaoMs: number;
  bytes: number;
  motivo: string | null;
  importRunId: string | null;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/** As buscas de uma integração, cada uma com a execução mais recente ao lado. */
export async function listarBuscas(
  db: Database,
  integracaoId: string,
): Promise<BuscaNaTela[]> {
  const buscas = await db
    .select()
    .from(integracaoBuscaTable)
    .where(eq(integracaoBuscaTable.integracaoId, integracaoId))
    .orderBy(desc(integracaoBuscaTable.criadaEm));
  if (buscas.length === 0) return [];

  /*
    As últimas execuções da integração inteira numa consulta só, e a mais recente
    de cada busca é escolhida em memória. Uma consulta por busca seria o N+1 que
    apareceria justamente na integração com mais agendas; as 200 linhas cobrem
    com folga o "qual foi a última de cada uma" de qualquer integração plausível
    — e o histórico completo tem rota própria (`listarExecucoes`).
  */
  const ultimas = await db
    .select()
    .from(integracaoExecucaoTable)
    .where(eq(integracaoExecucaoTable.integracaoId, integracaoId))
    .orderBy(desc(integracaoExecucaoTable.em))
    .limit(200);

  return buscas.map((b) => {
    const ultima = ultimas.find((e) => e.buscaId === b.id) ?? null;
    return {
      id: b.id,
      nome: b.nome,
      url: b.url,
      metodo: b.metodo,
      tipoDeclarado: b.tipoDeclarado,
      intervaloMinutos: b.intervaloMinutos,
      temCredencial: b.credencialCifrada !== null,
      forma: b.forma,
      proximaEm: b.proximaEm.toISOString(),
      pausadaEm: iso(b.pausadaEm),
      pausadaPor: b.pausadaPor,
      criadaEm: b.criadaEm.toISOString(),
      criadaPor: b.criadaPor,
      ultima: ultima ? paraTela(ultima) : null,
    };
  });
}

function paraTela(e: typeof integracaoExecucaoTable.$inferSelect): ExecucaoNaTela {
  return {
    id: e.id,
    em: e.em.toISOString(),
    disparo: e.disparo,
    resultado: e.resultado,
    statusHttp: e.statusHttp,
    duracaoMs: e.duracaoMs,
    bytes: e.bytes,
    motivo: e.motivo,
    importRunId: e.importRunId,
  };
}

/** O histórico de uma busca — as mais recentes primeiro. */
export async function listarExecucoes(
  db: Database,
  buscaId: string,
  limite = 50,
): Promise<ExecucaoNaTela[]> {
  const linhas = await db
    .select()
    .from(integracaoExecucaoTable)
    .where(eq(integracaoExecucaoTable.buscaId, buscaId))
    .orderBy(desc(integracaoExecucaoTable.em))
    .limit(Math.min(Math.max(limite, 1), 500));
  return linhas.map(paraTela);
}

/**
 * Cadastra uma busca.
 *
 * A credencial entra no cofre aqui e **não volta**: nenhuma rota a lê de volta,
 * e quem precisar trocá-la cadastra outra. Ler de volta uma credencial já
 * configurada não ajuda a operar e é o caminho por onde ela vazaria.
 */
export async function criarBusca(
  db: Database,
  integracaoId: string,
  dados: DadosDaBusca,
  por: string,
): Promise<{ id: string }> {
  const [integracao] = await db
    .select({ id: integracaoTable.id })
    .from(integracaoTable)
    .where(eq(integracaoTable.id, integracaoId))
    .limit(1);
  if (!integracao) throw new IntegracaoNaoEncontrada();

  /*
    O tipo declarado é conferido aqui, pela mesma função que o pipeline usa. Sem
    isto, um tipo errado só apareceria na primeira execução — de madrugada, num
    histórico que ninguém está olhando.
  */
  if (dados.tipoDeclarado !== null) exigirTipoDeclarado(dados.tipoDeclarado);

  const [criada] = await db
    .insert(integracaoBuscaTable)
    .values({
      integracaoId,
      nome: dados.nome,
      url: dados.url,
      metodo: dados.metodo,
      cabecalhos: dados.cabecalhos,
      corpo: dados.corpo,
      forma: dados.forma,
      cabecalhoDaCredencial: dados.cabecalhoDaCredencial,
      credencialCifrada:
        dados.credencial === null ? null : guardarSegredo(dados.credencial),
      tipoDeclarado: dados.tipoDeclarado,
      intervaloMinutos: dados.intervaloMinutos,
      /*
        A primeira execução é agora, e não daqui a um intervalo: quem acabou de
        cadastrar quer saber **hoje** se o endereço e a credencial funcionam, e
        não amanhã de manhã.
      */
      proximaEm: new Date(),
      criadaPor: por,
    })
    .returning({ id: integracaoBuscaTable.id });
  return { id: criada!.id };
}

/** Pausa ou retoma. Pausada não acorda; retomada volta na próxima janela. */
export async function pausarBusca(
  db: Database,
  buscaId: string,
  pausada: boolean,
  por: string,
): Promise<void> {
  const [alterada] = await db
    .update(integracaoBuscaTable)
    .set(
      pausada
        ? { pausadaEm: new Date(), pausadaPor: por }
        : {
            pausadaEm: null,
            pausadaPor: null,
            /*
              Retomar marca a próxima para agora. Uma busca pausada por uma
              semana voltaria com a `proxima_em` vencida de qualquer jeito; o
              que este carimbo garante é que ela volte **uma vez**, e não com o
              relógio de um horário que já passou.
            */
            proximaEm: new Date(),
          },
    )
    .where(eq(integracaoBuscaTable.id, buscaId))
    .returning({ id: integracaoBuscaTable.id });
  if (!alterada) throw new IntegracaoNaoEncontrada("Esta busca não existe.");
}

/**
 * Exclui a busca — e leva junto o histórico dela, por cascata.
 *
 * É a única coisa deste módulo que apaga registro, e ela existe porque uma
 * busca cadastrada com o endereço errado não tem história que valha guardar. O
 * que a integração fez de fato — as importações que entraram — não está aqui:
 * está em `import_run`, e continua inteiro.
 */
export async function excluirBusca(db: Database, buscaId: string): Promise<void> {
  const [apagada] = await db
    .delete(integracaoBuscaTable)
    .where(eq(integracaoBuscaTable.id, buscaId))
    .returning({ id: integracaoBuscaTable.id });
  if (!apagada) throw new IntegracaoNaoEncontrada("Esta busca não existe.");
}

// ---------------------------------------------------------------------------
// A execução
// ---------------------------------------------------------------------------

/** O que uma busca trouxe, antes de virar linha no histórico. */
interface Desfecho {
  resultado: ResultadoDaExecucao;
  statusHttp: number | null;
  bytes: number;
  motivo: string | null;
  importRunId: string | null;
}

/**
 * A resolução de nome que a conexão usa — e que recusa o que aponta para dentro.
 *
 * Esta função é passada como `lookup` para o `https.request`, e é isso que fecha
 * a janela do **DNS rebinding**: conferir o DNS por fora e depois pedir a
 * conexão pelo nome deixaria um intervalo em que a segunda resposta poderia ser
 * `127.0.0.1`. Aqui não há duas resoluções — a que a conferência aprova é a
 * mesma que o socket recebe.
 *
 * É também por isso que a busca usa `node:https` em vez do `fetch` global: o
 * `fetch` não deixa escolher o resolvedor, e trocar a conexão pelo endereço à
 * mão quebraria a validação do certificado, que confere o **nome**.
 */
function resolverComGuarda(
  host: string,
  opcoes: LookupOneOptions | LookupAllOptions,
  entregar: (
    err: NodeJS.ErrnoException | null,
    endereco: string | LookupAddress[],
    familia?: number,
  ) => void,
): void {
  lookup(host, { ...opcoes, all: true })
    .then((enderecos) => {
      if (enderecos.length === 0) {
        entregar(
          new RecusaDeIntegracao(`"${host}" não resolveu para endereço nenhum.`),
          "",
        );
        return;
      }
      const privado = enderecos.find((e) => ehEnderecoPrivado(e.address));
      if (privado) {
        entregar(
          new RecusaDeIntegracao(
            `"${host}" aponta para ${privado.address}, que é um endereço da rede ` +
              "interna deste servidor. A busca não alcança a rede interna.",
          ),
          "",
        );
        return;
      }
      if (opcoes.all === true) entregar(null, enderecos);
      else entregar(null, enderecos[0]!.address, enderecos[0]!.family);
    })
    .catch(() => {
      entregar(
        new RecusaDeIntegracao(
          `Não foi possível resolver "${host}". Confira o endereço da busca.`,
        ),
        "",
      );
    });
}

/** O outro lado não respondeu a tempo — falha, e não recusa. */
class TempoEsgotado extends Error {
  constructor() {
    super(`O outro lado não respondeu em ${TEMPO_LIMITE_MS / 1000} segundos.`);
    this.name = "TempoEsgotado";
  }
}

/** Uma resposta HTTP, já reduzida ao que a busca precisa dela. */
interface RespostaDaBusca {
  status: number;
  cabecalhos: IncomingHttpHeaders;
  bytes: Buffer;
}

/**
 * Uma chamada, com teto de tempo e de tamanho, e sem seguir redirecionamento
 * por conta própria.
 *
 * O teto de tamanho é aplicado **enquanto** o corpo chega, e a conexão é
 * destruída ao ser ultrapassado: um teto conferido só no fim não seria teto de
 * tráfego nenhum.
 */
function chamar(
  alvo: string,
  metodo: string,
  cabecalhos: Record<string, string>,
  corpo: string | null,
): Promise<RespostaDaBusca> {
  return new Promise((resolver, recusar) => {
    const pedido = request(
      alvo,
      { method: metodo, headers: cabecalhos, lookup: resolverComGuarda },
      (resposta) => {
        const pedacos: Buffer[] = [];
        let total = 0;
        resposta.on("data", (pedaco: Buffer) => {
          total += pedaco.length;
          if (total > TAMANHO_LIMITE_BYTES) {
            resposta.destroy();
            pedido.destroy();
            recusar(
              new RecusaDeIntegracao(
                "A resposta passou de 64 MB e foi interrompida no meio. Confira " +
                  "se o endereço é o do arquivo, e não o de uma listagem inteira.",
              ),
            );
            return;
          }
          pedacos.push(pedaco);
        });
        resposta.on("end", () =>
          resolver({
            status: resposta.statusCode ?? 0,
            cabecalhos: resposta.headers,
            bytes: Buffer.concat(pedacos),
          }),
        );
        resposta.on("error", recusar);
      },
    );

    /*
      O tempo esgotado é **falha**, e não recusa: ninguém do outro lado disse
      nada, então não há resposta a recusar. A classe própria é o que mantém
      essa distinção viva até `tentar` — que é quem a traduz para a coluna
      `resultado`, e é ela que a tela lê para dizer se o conserto é aqui ou lá.
    */
    pedido.setTimeout(TEMPO_LIMITE_MS, () => {
      pedido.destroy(new TempoEsgotado());
    });
    pedido.on("error", recusar);
    if (corpo !== null) pedido.write(corpo);
    pedido.end();
  });
}

/**
 * Chama o endereço, seguindo redirecionamento à mão e reconferindo cada salto.
 *
 * Seguir à mão é a regra, e não preferência de estilo: um `302` para
 * `http://169.254.169.254/` desfaria toda a conferência do cadastro se a
 * biblioteca o seguisse sozinha. Cada salto passa por `conferirUrlDaBusca` de
 * novo — https, host público — e pela guarda de DNS na conexão.
 *
 * E **a credencial não atravessa salto para outro host**: quem redireciona para
 * um domínio de arquivos assinados não precisa dela, e quem precisaria não
 * deveria recebê-la sem que alguém tivesse decidido isso.
 */
async function buscarArquivo(
  busca: typeof integracaoBuscaTable.$inferSelect,
): Promise<{ status: number; bytes: Buffer }> {
  const hostOriginal = new URL(busca.url).hostname;
  let alvo = conferirUrlDaBusca(busca.url);
  let corpoDoPedido = busca.corpo;
  let metodo = busca.metodo;

  for (let salto = 0; salto <= SALTOS_MAXIMOS; salto++) {
    const url = new URL(alvo);
    const cabecalhos: Record<string, string> = {
      ...(busca.cabecalhos as Record<string, string>),
      "user-agent": "FreightCheck/1.0 (busca ativa)",
    };
    if (corpoDoPedido !== null) {
      cabecalhos["content-length"] = String(Buffer.byteLength(corpoDoPedido));
    }
    if (busca.credencialCifrada !== null && url.hostname === hostOriginal) {
      const segredo = abrirSegredo(busca.credencialCifrada);
      if (busca.forma === "BEARER") cabecalhos["authorization"] = `Bearer ${segredo}`;
      if (busca.forma === "CABECALHO" && busca.cabecalhoDaCredencial) {
        cabecalhos[busca.cabecalhoDaCredencial] = segredo;
      }
    }

    const resposta = await chamar(alvo, metodo, cabecalhos, corpoDoPedido);

    const paraOnde = resposta.cabecalhos["location"];
    if (resposta.status >= 300 && resposta.status < 400 && typeof paraOnde === "string") {
      if (salto === SALTOS_MAXIMOS) {
        throw new RecusaDeIntegracao(
          `O endereço redirecionou mais de ${SALTOS_MAXIMOS} vezes. Cadastre o ` +
            "endereço final do arquivo.",
        );
      }
      alvo = conferirUrlDaBusca(new URL(paraOnde, alvo).toString());
      /*
        Todo redirecionamento vira GET sem corpo — é o que os navegadores fazem
        com 303, e é o que impede um POST de ser reenviado para um endereço que
        não foi o cadastrado.
      */
      metodo = "GET";
      corpoDoPedido = null;
      continue;
    }

    if (resposta.status < 200 || resposta.status >= 300) {
      throw new RecusaDeIntegracao(
        `O outro lado respondeu ${resposta.status}. ` +
          (resposta.status === 401 || resposta.status === 403
            ? "A credencial cadastrada aqui não vale mais para ele — cadastre a nova."
            : "Confira o endereço e o que ele espera receber."),
      );
    }

    return { status: resposta.status, bytes: resposta.bytes };
  }
  /* Inalcançável: o laço só sai por `return` ou por lançamento. */
  throw new RecusaDeIntegracao("A busca não completou.");
}

/**
 * Executa uma busca inteira e grava o histórico dela.
 *
 * **Nunca lança para quem chama.** O desfecho — inclusive a falha — é uma linha
 * do histórico, e é assim que a tela responde "esta agenda está funcionando?".
 * Um lançamento aqui derrubaria a varredura e levaria junto as outras buscas da
 * mesma rodada.
 */
export async function executarBusca(
  db: Database,
  buscaId: string,
  disparo: "AGENDA" | "MAO",
  log: Log,
): Promise<ExecucaoNaTela> {
  const comeco = Date.now();

  const [linha] = await db
    .select({
      busca: integracaoBuscaTable,
      desativadaEm: integracaoTable.desativadaEm,
    })
    .from(integracaoBuscaTable)
    .innerJoin(
      integracaoTable,
      eq(integracaoTable.id, integracaoBuscaTable.integracaoId),
    )
    .where(eq(integracaoBuscaTable.id, buscaId))
    .limit(1);
  if (!linha) throw new IntegracaoNaoEncontrada("Esta busca não existe.");

  const { busca } = linha;
  let desfecho: Desfecho;

  if (linha.desativadaEm !== null) {
    desfecho = {
      resultado: "RECUSADA",
      statusHttp: null,
      bytes: 0,
      motivo:
        "A integração está desativada. Nenhuma busca dela sai enquanto ela " +
        "estiver assim.",
      importRunId: null,
    };
  } else {
    desfecho = await tentar(db, busca, log);
  }

  const [gravada] = await db
    .insert(integracaoExecucaoTable)
    .values({
      buscaId: busca.id,
      integracaoId: busca.integracaoId,
      disparo,
      resultado: desfecho.resultado,
      statusHttp: desfecho.statusHttp,
      duracaoMs: Date.now() - comeco,
      bytes: desfecho.bytes,
      motivo: desfecho.motivo,
      importRunId: desfecho.importRunId,
    })
    .returning();

  /*
    O relógio anda depois de toda execução, inclusive a manual e a que falhou.
    Depois da manual porque senão a agenda repetiria a mesma busca um minuto
    depois; depois da que falhou porque uma falha que reagendasse para já viraria
    um laço apertado contra um sistema que está fora do ar.
  */
  await db
    .update(integracaoBuscaTable)
    .set({ proximaEm: proximaExecucao(new Date(), busca.intervaloMinutos) })
    .where(eq(integracaoBuscaTable.id, busca.id));

  return paraTela(gravada!);
}

/** A tentativa em si — o que pode dar errado, com o motivo escrito. */
async function tentar(
  db: Database,
  busca: typeof integracaoBuscaTable.$inferSelect,
  log: Log,
): Promise<Desfecho> {
  let status: number | null = null;
  let bytes: Buffer;
  try {
    const resposta = await buscarArquivo(busca);
    status = resposta.status;
    bytes = resposta.bytes;
  } catch (err) {
    /*
      A recusa nomeada — endereço interno, 403 do outro lado, arquivo grande
      demais — é RECUSADA, com a frase do domínio. Qualquer outra coisa é FALHA:
      rede, tempo esgotado, defeito nosso. A distinção é a que a tela usa para
      dizer se o conserto é aqui ou lá.
    */
    if (err instanceof RecusaDeIntegracao || err instanceof CofreIndisponivel) {
      /*
        `CofreIndisponivel` entra aqui e não em FALHA porque o conserto é
        conhecido e é nosso: falta a chave mestra deste ambiente, ou ela mudou.
        A frase do cofre já diz qual dos dois, e escondê-la atrás de "a chamada
        não completou" mandaria procurar defeito na rede do fornecedor.
      */
      return {
        resultado: "RECUSADA",
        statusHttp: status,
        bytes: 0,
        motivo: err.message,
        importRunId: null,
      };
    }
    log.warn({ err, buscaId: busca.id }, "Busca ativa não completou");
    return {
      resultado: "FALHA",
      statusHttp: status,
      bytes: 0,
      motivo:
        err instanceof TempoEsgotado
          ? err.message
          : "A chamada não completou. O detalhe está no log do servidor.",
      importRunId: null,
    };
  }

  if (bytes.length === 0) {
    return {
      resultado: "RECUSADA",
      statusHttp: status,
      bytes: 0,
      motivo: "O endereço respondeu, e a resposta veio vazia.",
      importRunId: null,
    };
  }
  /*
    A mesma assinatura que o upload pela tela confere. Sem ela, uma página de
    login em HTML — a resposta clássica de quem perdeu a sessão do outro lado —
    entraria como arquivo e falharia lá dentro do leitor, com uma frase sobre
    estrutura de zip que não ajuda ninguém.
  */
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    return {
      resultado: "RECUSADA",
      statusHttp: status,
      bytes: bytes.length,
      motivo:
        "O que veio não é uma planilha do Excel. Em geral isso é uma página de " +
        "login ou uma mensagem de erro em HTML — confira se a credencial ainda " +
        "vale e se o endereço aponta para o arquivo.",
      importRunId: null,
    };
  }

  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  const filePath = path.join(ensureImportStorageDir(), `${contentSha256}.xlsx`);
  writeFileSync(filePath, bytes);

  const recebido = await receiveFile(db, {
    filePath,
    filename: `${busca.nome}.xlsx`,
    /*
      O autor é a busca, e não uma pessoa. É o que faz o cartão em Importações
      dizer de onde aquele arquivo veio, meses depois, sem atribuí-lo a alguém
      que não clicou em nada.
    */
    receivedBy: `${busca.nome} (busca ativa)`,
    declaredType: busca.tipoDeclarado,
  });

  if (recebido.isDuplicate) {
    /*
      O desfecho **normal** de uma agenda que busca mais vezes do que a fonte
      muda — e é por isso que ele tem nome próprio em vez de virar recusa. Sem
      esta distinção, uma busca saudável apareceria vermelha todo dia, e o
      vermelho deixaria de querer dizer alguma coisa.
    */
    return {
      resultado: "SEM_NOVIDADE",
      statusHttp: status,
      bytes: bytes.length,
      motivo: "O arquivo veio igual ao que já tínhamos. Nada foi importado de novo.",
      importRunId: recebido.importRunId,
    };
  }

  /*
    A leitura é aguardada — ao contrário do upload pela tela, onde ela roda em
    segundo plano porque há alguém esperando resposta. Aqui não há ninguém
    esperando, e o que se quer é o histórico dizer se o arquivo **entrou**, e não
    apenas se ele chegou.
  */
  await readInBackground(recebido.importRunId, log);
  const estado = await getImportRunStatus(db, recebido.importRunId);

  if (estado?.status === "FAILED" || estado?.status === "VALIDATION_ERROR") {
    return {
      resultado: "RECUSADA",
      statusHttp: status,
      bytes: bytes.length,
      motivo:
        estado.failureReason ??
        "O arquivo chegou, e a leitura dele falhou. Veja a importação em Importações.",
      importRunId: recebido.importRunId,
    };
  }

  return {
    resultado: "OK",
    statusHttp: status,
    bytes: bytes.length,
    motivo:
      "O arquivo entrou e está conferido, aguardando aprovação em Importações — " +
      "nenhuma busca promove.",
    importRunId: recebido.importRunId,
  };
}

/**
 * A varredura da agenda: pega o que venceu, sem duas instâncias pegarem o mesmo.
 *
 * O `FOR UPDATE SKIP LOCKED` é o que faz isso funcionar num serviço que escala
 * horizontalmente sem tabela de lock e sem eleição de líder: a primeira
 * instância tranca as linhas vencidas, e a segunda simplesmente não as enxerga.
 * O carimbo de `proxima_em` é empurrado **dentro da mesma transação**, então
 * mesmo que a busca demore, ninguém a dispara de novo.
 *
 * A busca em si acontece **fora** da transação: são até 60 segundos de rede por
 * execução, e segurar uma transação aberta durante isso prenderia uma conexão
 * do pool por busca.
 */
export async function varrerBuscasDevidas(db: Database, log: Log): Promise<number> {
  const devidas = await db.transaction(async (tx) => {
    const linhas = await tx.execute(sql`
      SELECT b.id
        FROM integracao_busca b
        JOIN integracao i ON i.id = b.integracao_id
       WHERE b.pausada_em IS NULL
         AND i.desativada_em IS NULL
         AND b.proxima_em <= now()
       ORDER BY b.proxima_em
       LIMIT 5
         FOR UPDATE OF b SKIP LOCKED
    `);
    const ids = (linhas.rows as Array<{ id: string }>).map((l) => l.id);
    if (ids.length === 0) return [];

    /*
      O adiantamento provisório: cada linha tomada vai para o fim da fila antes
      de a transação fechar. `executarBusca` grava o carimbo definitivo no fim;
      este aqui existe para a janela entre uma coisa e outra, em que a linha já
      não está trancada e ainda não foi executada.
    */
    for (const id of ids) {
      await tx
        .update(integracaoBuscaTable)
        .set({ proximaEm: proximaExecucao(new Date(), 15) })
        .where(eq(integracaoBuscaTable.id, id));
    }
    return ids;
  });

  for (const id of devidas) {
    try {
      await executarBusca(db, id, "AGENDA", log);
    } catch (err) {
      /*
        `executarBusca` já transforma o desfecho em linha do histórico; o que
        chega aqui é o que aconteceu **antes** disso — a busca apagada entre a
        varredura e a execução, ou o banco fora. Nenhum dos dois pode derrubar a
        rodada inteira.
      */
      log.error({ err, buscaId: id }, "A execução agendada não pôde ser registrada");
    }
  }
  return devidas.length;
}

/** Quantas buscas ativas existem — o que a partida loga para quem opera. */
export async function contarBuscasAtivas(db: Database): Promise<number> {
  const [linha] = await db
    .select({ quantas: sql<number>`count(*)::int` })
    .from(integracaoBuscaTable)
    .where(and(isNull(integracaoBuscaTable.pausadaEm)));
  return linha?.quantas ?? 0;
}
