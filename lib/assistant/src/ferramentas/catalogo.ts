/**
 * As oito capacidades restantes — invólucros, e não lógica nova.
 *
 * **Quase nada aqui calcula.** As consultas já existiam em `ferramentas.ts`,
 * `governanca.ts`, `indice-book.ts` e `corpus.ts`, e já devolviam `Evidencia` —
 * que é exatamente o que uma ferramenta precisa devolver. O que este arquivo
 * acrescenta é o que faltava para o modelo poder pedi-las: um nome estável, uma
 * descrição que diz **quando** usar, argumentos que compõem, e o recorte
 * injetado pelo executor.
 *
 * **O critério que separou oito de vinte.** Cada ferramenta é um eixo de
 * consulta, e duas funções que respondem a mesma pergunta com filtros
 * diferentes viram uma ferramenta com um argumento a mais. `rankingDeImpacto`
 * de perda e de ganho não são duas capacidades — são `ordenacao` com
 * `sentido`. `estadoDaCuradoria`, `importacoesRecentes` e
 * `balancoDasImportacoes` não são três — são `estado_do_dado` com `aspecto`.
 * Vinte ferramentas seriam o `switch` do orquestrador com outro nome.
 *
 * **O que ficou de fora, e por quê.** `simular` — a capacidade de responder "e
 * se eu tirar FINAME?" — não entra aqui. `lib/simulation` expõe uma função pura
 * sobre um valor já escolhido, e escolher esse valor é uma decisão de desenho
 * de verdade: o que é a entrada de uma simulação neste produto (um atributo? um
 * grupo? a frota?), sobre que horizonte, e com que regra para o que não tem
 * periodicidade confirmada. Improvisá-la produziria uma ferramenta desenhada
 * para uma pergunta, que é justamente o que este desenho evita.
 */

import { buscarTrechos } from "../corpus";
import {
  compararIntervalo,
  composicaoDaFrota,
  filaDeInvestigacao,
  listarVigencias,
  panoramaDoContexto,
  placaCitada,
  porQueOResultadoMudou,
  rankingDeImpacto,
  regraDoBook,
  resolverContexto,
  resultadoDaFrota,
  semParaPrecificar,
  serieDoParametro,
  veiculosAfetados,
  type ContextoResolvido,
  type Evidencia,
} from "../ferramentas";
import {
  balancoDasImportacoes,
  buscarNasCelulas,
  estadoDaCuradoria,
  historicoDaSemantica,
  importacoesRecentes,
} from "../governanca";
import { buscarNoBookDetalhado, documentoDoBloco } from "../indice-book";
import { carregarDicionario } from "../parametros";
import { normalizar, termos } from "../normalizar";
import { listContexts, listPeriods } from "@workspace/comparison";
import type { ContextoDaFerramenta, Ferramenta, SaidaDaFerramenta } from "./registro";

/**
 * O recorte da conversa, resolvido — e a falha declarada quando não resolve.
 *
 * Toda ferramenta que fala de dado passa por aqui, e nenhuma delas recebe
 * unidade ou canal como argumento. É o ponto único em que a fronteira de
 * isolamento é aplicada.
 */
async function contexto(ctx: ContextoDaFerramenta): Promise<ContextoResolvido> {
  const resolvido = await resolverContexto(ctx.db, {
    ...(ctx.recorte.scopeHash ? { scopeHash: ctx.recorte.scopeHash } : {}),
    ...(ctx.recorte.channel !== undefined ? { channel: ctx.recorte.channel } : {}),
  });
  /*
    Sem recorte não há consulta, e o jeito de dizer isso é lançar.

    O executor transforma a exceção numa falha declarada, com a instrução de não
    concluir a partir dela. A alternativa — devolver o contexto padrão — seria
    responder sobre outra unidade com cara de resposta certa, que é a pior coisa
    que este produto pode fazer.
  */
  if (!resolvido) {
    throw new Error(
      "não há recorte resolvido para esta conversa — nenhuma unidade e canal com vigência importada",
    );
  }
  return resolvido;
}

/** Uma evidência (ou nenhuma) virando saída de ferramenta. */
function de(evidencia: Evidencia | null, vazio: string): SaidaDaFerramenta {
  if (!evidencia) return { conteudo: { vazio }, evidencias: [] };
  return {
    conteudo: {
      titulo: evidencia.titulo,
      recorte: evidencia.recorte ?? null,
      fatos: evidencia.fatos.filter((f) => !f.interno),
      ...(evidencia.nota ? { ressalva: evidencia.nota } : {}),
    },
    evidencias: [evidencia],
  };
}

/** Várias evidências, colhidas juntas. */
function deVarias(evidencias: (Evidencia | null)[], vazio: string): SaidaDaFerramenta {
  const uteis = evidencias.filter((e): e is Evidencia => e !== null);
  if (uteis.length === 0) return { conteudo: { vazio }, evidencias: [] };
  return {
    conteudo: uteis.map((e) => ({
      titulo: e.titulo,
      recorte: e.recorte ?? null,
      fatos: e.fatos.filter((f) => !f.interno),
      ...(e.nota ? { ressalva: e.nota } : {}),
    })),
    evidencias: uteis,
  };
}

// ── 1. recortes ─────────────────────────────────────────────────────────────

export const recortes: Ferramenta = {
  nome: "recortes",
  descricao:
    "As unidades, canais e vigências que existem no banco, com as datas em AAAA-MM-DD. " +
    "Chame antes de qualquer consulta que precise de uma vigência específica: as datas " +
    "não se adivinham, e o resto das ferramentas as espera nesse formato. Também diz em " +
    "que recorte a conversa está.",
  argumentos: {},
  async executar(ctx): Promise<SaidaDaFerramenta> {
    const [contextos, resolvido] = await Promise.all([listContexts(ctx.db), contexto(ctx)]);
    const periodos = await listPeriods(ctx.db, resolvido.contexto);
    const catalogo = await listarVigencias(ctx.db, resolvido).catch(() => null);

    return {
      conteudo: {
        recorteDaConversa: resolvido.info.label,
        vigencias: periodos.map((p) => p.effective_date),
        outrosRecortes: contextos
          .filter((c) => c.label !== resolvido.info.label)
          .map((c) => c.label),
        /*
          Os outros recortes saem como **nome**, e não como identificador. Saber
          que existe uma unidade vizinha é contexto legítimo; poder consultá-la
          não é — o recorte da conversa vem da tela.
        */
        observacao:
          "As ferramentas consultam sempre o recorte da conversa. Para ver outro, " +
          "quem pergunta troca a unidade na tela.",
      },
      evidencias: catalogo ? [catalogo] : [],
    };
  },
};

// ── 2. parametros ───────────────────────────────────────────────────────────

export const parametros: Ferramenta = {
  nome: "parametros",
  descricao:
    "O dicionário dos parâmetros do modelo de remuneração, com a semântica de cada um: " +
    "nome gerencial, unidade, periodicidade, se é monetário, como é agregado, e se a " +
    "semântica está confirmada. Use para descobrir o código de um atributo antes de " +
    "consultá-lo, para saber se um valor pode virar dinheiro, e para entender o que uma " +
    "coluna significa. Semântica não confirmada é o motivo mais comum de um impacto vir " +
    "nulo — se um número faltar, confira aqui antes de concluir.",
  argumentos: {
    busca: {
      tipo: "texto",
      descricao: "Termo livre: nome gerencial, código, nome da coluna de origem ou família.",
    },
    equipamento: {
      tipo: "texto",
      descricao: "Restringe a um tipo de ativo.",
      opcoes: ["CAVALO", "CARRETA"] as const,
    },
    semantica: {
      tipo: "texto",
      descricao: "Só os que estão neste estado de curadoria.",
      opcoes: ["CONFIRMED", "PRESUMED", "UNKNOWN"] as const,
    },
    limite: { tipo: "inteiro", descricao: "Padrão 25, teto 100.", minimo: 1, maximo: 100 },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const dicionario = await carregarDicionario(ctx.db);
    const busca = args.busca as string | undefined;
    const palavras = busca ? termos(busca) : [];

    let achados = dicionario;
    if (args.equipamento) achados = achados.filter((p) => p.equipamento === args.equipamento);
    if (args.semantica) achados = achados.filter((p) => p.semantica === args.semantica);
    if (palavras.length > 0) {
      const alvo = normalizar(busca!);
      achados = achados
        .map((p) => ({
          p,
          /*
            Casamento exato do código vence casamento de palavra. É a mesma
            escada de `parametros.ts`, e ela existe para "IPVA" não virar "IPVA
            licenciamento mensal" só porque o segundo tem mais palavras em
            comum com a frase.
          */
          pontos:
            (normalizar(p.codigo) === alvo ? 100 : 0) +
            (normalizar(p.rotulo) === alvo ? 50 : 0) +
            p.termos.filter((t) => palavras.some((q) => t.includes(q))).length,
        }))
        .filter((x) => x.pontos > 0)
        .sort((a, b) => b.pontos - a.pontos)
        .map((x) => x.p);
    }

    const limite = (args.limite as number | undefined) ?? 25;
    const pagina = achados.slice(0, limite);

    return {
      conteudo: {
        encontrados: achados.length,
        mostrando: pagina.length,
        parametros: pagina.map((p) => ({
          codigo: p.codigo,
          nomeGerencial: p.rotulo,
          nomeNaPlanilha: p.nomeDeOrigem,
          equipamento: p.equipamento,
          familia: p.familia,
          gaveta: p.parametro,
          unidade: p.unidade,
          periodicidade: p.periodicidade,
          agregacao: p.agregacao,
          monetario: p.monetario,
          semantica: p.semantica,
        })),
        /*
          A ressalva vai no material, e não no prompt. Ela é uma propriedade
          destes dados — nada abaixo de CONFIRMED entra em agregação financeira
          —, e escrevê-la na instrução do sistema seria repetir regra de negócio
          fora de onde ela é verdadeira.
        */
        observacao:
          "Só parâmetros com semântica CONFIRMED entram em soma de dinheiro. PRESUMED e " +
          "UNKNOWN continuam sendo listados nas alterações, com impacto nulo.",
      },
      evidencias: [],
    };
  },
};

// ── 3. serie ────────────────────────────────────────────────────────────────

export const serie: Ferramenta = {
  nome: "serie",
  descricao:
    "Como um parâmetro andou ao longo das vigências — o histórico de um valor, e não o " +
    "que mudou numa vigência só. Use quando a pergunta falar de evolução, tendência, " +
    "'desde', 'ao longo de' ou comparar mais de duas vigências. Precisa do código do " +
    "atributo, que vem da ferramenta de parâmetros.",
  argumentos: {
    atributo: {
      tipo: "texto",
      descricao: "O código do atributo, como devolvido por `parametros`.",
      obrigatorio: true,
    },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const resolvido = await contexto(ctx);
    return de(
      await serieDoParametro(ctx.db, resolvido, args.atributo as string),
      `Nenhuma série para "${args.atributo}" neste recorte. Confira o código em \`parametros\`.`,
    );
  },
};

// ── 4. comparar ─────────────────────────────────────────────────────────────

export const comparar: Ferramenta = {
  nome: "comparar",
  descricao:
    "O confronto entre duas vigências: o que mudou de uma ponta à outra, e quanto disso " +
    "permanece. Devolve duas leituras que respondem perguntas diferentes e divergem de " +
    "propósito — o movimento acumulado no caminho e o saldo entre as pontas. Um valor que " +
    "subiu e voltou aparece no primeiro e some no segundo. As vigências vêm de `recortes`.",
  argumentos: {
    de: { tipo: "texto", descricao: "A vigência inicial, em AAAA-MM-DD. Omita para a anterior." },
    ate: { tipo: "texto", descricao: "A vigência final, em AAAA-MM-DD. Omita para a mais recente." },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const resolvido = await contexto(ctx);
    return de(
      await compararIntervalo(
        ctx.db,
        resolvido,
        (args.de as string | undefined) ?? undefined,
        (args.ate as string | undefined) ?? undefined,
      ),
      "Não há duas vigências comparáveis neste recorte.",
    );
  },
};

// ── 5. ordenacao ────────────────────────────────────────────────────────────

export const ordenacao: Ferramenta = {
  nome: "ordenacao",
  descricao:
    "O que se destaca numa vigência, em duas ordens que não são a mesma. `dinheiro` ordena " +
    "por impacto apurado e responde onde se ganhou ou perdeu mais. `criticidade` ordena " +
    "pela fila de investigação — abrangência na frota, magnitude, se há valor apurado, se " +
    "houve troca de formato — e vem com os motivos que puseram cada item na posição. Use " +
    "`criticidade` quando a pergunta for sobre o que merece atenção ou parece estranho, e " +
    "`dinheiro` quando for sobre quanto pesou.",
  argumentos: {
    por: {
      tipo: "texto",
      descricao: "O critério da ordem.",
      opcoes: ["dinheiro", "criticidade"] as const,
      obrigatorio: true,
    },
    sentido: {
      tipo: "texto",
      descricao: "Só para `dinheiro`: o que reduziu ou o que aumentou a remuneração.",
      opcoes: ["perda", "ganho"] as const,
    },
    vigencia: { tipo: "texto", descricao: "AAAA-MM-DD. Omita para a mais recente." },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const resolvido = await contexto(ctx);
    const vigencia = (args.vigencia as string | undefined) ?? ctx.periodo;

    if (args.por === "criticidade") {
      return de(
        await filaDeInvestigacao(ctx.db, resolvido, vigencia),
        "Nada na fila de investigação desta vigência.",
      );
    }
    return de(
      await rankingDeImpacto(
        ctx.db,
        resolvido,
        args.sentido === "ganho" ? "GANHO" : "PERDA",
        vigencia,
      ),
      "Nenhum impacto apurado para ordenar nesta vigência.",
    );
  },
};

// ── 6. veiculos ─────────────────────────────────────────────────────────────

export const veiculos: Ferramenta = {
  nome: "veiculos",
  descricao:
    "Os ativos afetados numa vigência, por placa, e quantas alterações caíram em cada um. " +
    "Use quando a pergunta for sobre quais caminhões, quais placas, ou quem foi mais " +
    "atingido. Para ver o antes→depois de um ativo num parâmetro específico, use " +
    "`alteracoes` com nivel='linhas'.",
  argumentos: {
    vigencia: { tipo: "texto", descricao: "AAAA-MM-DD. Omita para a mais recente." },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const resolvido = await contexto(ctx);
    return de(
      await veiculosAfetados(
        ctx.db,
        resolvido,
        (args.vigencia as string | undefined) ?? ctx.periodo,
      ),
      "Nenhum veículo afetado nesta vigência.",
    );
  },
};

// ── 7. resultado ────────────────────────────────────────────────────────────

export const resultado: Ferramenta = {
  nome: "resultado",
  descricao:
    "O resultado econômico apurado da frota: receita, custo e o que sobra, por escopo. " +
    "Use para perguntas sobre dar dinheiro, prejuízo, margem, EBITDA, custo por km ou " +
    "quanto sobra. Com `placa`, traz também a ponte que explica o que mudou naquele " +
    "ativo. Com `composicao`, traz de que a remuneração é feita — a memória de cálculo, " +
    "que é outra pergunta. O escopo padrão é o conjunto: um cavalo sozinho não carrega o " +
    "implemento que roda com ele.",
  argumentos: {
    escopo: {
      tipo: "texto",
      descricao: "Padrão CONJUNTO, que é o único em que 'este caminhão dá dinheiro?' fecha.",
      opcoes: ["CAVALO", "CARRETA", "CONJUNTO"] as const,
    },
    placa: { tipo: "texto", descricao: "Para descer a um ativo e explicar o que mudou nele." },
    composicao: {
      tipo: "booleano",
      descricao: "Traz também de que a remuneração é composta, em vez de só o resultado.",
    },
    vigencia: { tipo: "texto", descricao: "AAAA-MM-DD. Omita para a mais recente." },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const resolvido = await contexto(ctx);
    const vigencia = (args.vigencia as string | undefined) ?? ctx.periodo;
    const escopo = (args.escopo as "CAVALO" | "CARRETA" | "CONJUNTO" | undefined) ?? "CONJUNTO";

    const partes: (Evidencia | null)[] = [
      await resultadoDaFrota(ctx.db, resolvido, escopo, vigencia).catch(() => null),
    ];

    if (args.composicao) {
      partes.push(
        await composicaoDaFrota(
          ctx.db,
          resolvido,
          escopo === "CARRETA" ? "CARRETA" : "CAVALO",
          vigencia,
        ).catch(() => null),
      );
    }

    if (args.placa) {
      const veiculo = await placaCitada(ctx.db, args.placa as string).catch(() => null);
      if (!veiculo) {
        return {
          conteudo: { erro: `A placa "${args.placa}" não existe neste recorte.` },
          evidencias: [],
        };
      }
      partes.push(
        await porQueOResultadoMudou(ctx.db, resolvido, veiculo.entityId, escopo, vigencia).catch(
          () => null,
        ),
      );
    }

    return deVarias(partes, "Não há resultado apurado para este escopo e vigência.");
  },
};

// ── 8. documentos ───────────────────────────────────────────────────────────

export const documentos: Ferramenta = {
  nome: "documentos",
  descricao:
    "O que está escrito nos documentos da operação — o Book do Operador — e no catálogo " +
    "do Freightech. É a fonte das **regras**: o que é, como funciona, com que frequência, " +
    "de quem é a responsabilidade, o que a operação precisa entregar. Os dados dizem o que " +
    "mudou; isto diz o que estava combinado. Quando a pergunta for sobre o porquê de uma " +
    "alteração, consulte os dois. Com `bloco`, devolve o documento inteiro daquele bloco " +
    "em vez de trechos soltos — melhor para explicar, pior para achar.",
  argumentos: {
    busca: {
      tipo: "texto",
      descricao: "O que procurar. Use os termos da pergunta, não uma palavra só.",
      obrigatorio: true,
    },
    bloco: {
      tipo: "texto",
      descricao: "O nome do bloco, para trazer o documento inteiro em vez de trechos.",
    },
    limite: { tipo: "inteiro", descricao: "Quantos trechos. Padrão 6, teto 12.", minimo: 1, maximo: 12 },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const busca = args.busca as string;

    if (args.bloco) {
      const achado = await buscarNoBookDetalhado(ctx.db, args.bloco as string, { limite: 1 }).catch(
        () => null,
      );
      const chave = achado?.selecionados[0]?.trecho.blockKey;
      if (chave) {
        const inteiro = await documentoDoBloco(ctx.db, chave).catch(() => null);
        if (inteiro && inteiro.length > 0) {
          const registro = await regraDoBook(ctx.db, args.bloco as string, {
            documentoLido: true,
          }).catch(() => null);
          return {
            conteudo: {
              bloco: inteiro[0]!.bloco,
              secoes: inteiro.map((t) => ({ secao: t.secao, texto: t.texto })),
            },
            evidencias: registro ? [registro] : [],
          };
        }
      }
    }

    const doBook = await buscarNoBookDetalhado(ctx.db, busca, {
      limite: (args.limite as number | undefined) ?? 6,
    }).catch(() => ({ selecionados: [], candidatos: 0, melhorPontuacao: 0 }));

    /*
      O catálogo entra junto, e separado.

      Ele descreve o que o Freightech publica; o Book registra o que a operação
      contratou. São perguntas diferentes, e uma resposta que as misture afirma
      como regra o que é só descrição de tela — foi o defeito que motivou os dois
      corpora terem nomes distintos no dossiê.
    */
    const doCatalogo = buscarTrechos(busca, { limite: 3 });

    if (doBook.selecionados.length === 0 && doCatalogo.length === 0) {
      return {
        conteudo: {
          vazio:
            `Nada no Book nem no catálogo sobre "${busca}". Pode ser que o documento exista ` +
            "no Freightech e ainda não tenha sido anexado ao Book.",
          candidatosAvaliados: doBook.candidatos,
        },
        evidencias: [],
      };
    }

    return {
      conteudo: {
        book: doBook.selecionados.map((s) => ({
          bloco: s.trecho.bloco,
          secao: s.trecho.secao,
          arquivo: s.trecho.arquivo,
          texto: s.trecho.texto,
        })),
        catalogoDoFreightech: doCatalogo.map((t) => ({
          titulo: t.trecho.titulo,
          fonte: t.trecho.fonte,
          texto: t.trecho.texto,
        })),
        observacao:
          "O Book é o que a operação contratou; o catálogo descreve o que o produto publica. " +
          "Não afirme como regra contratual o que só o catálogo diz.",
      },
      evidencias: [],
    };
  },
};

// ── 9. estado_do_dado ───────────────────────────────────────────────────────

export const estadoDoDado: Ferramenta = {
  nome: "estado_do_dado",
  descricao:
    "O estado do pipeline: o que foi importado, o que a curadoria já confirmou, o que " +
    "entrou e virou fato, o que ficou sem preço, e onde uma placa aparece na planilha. É " +
    "a resposta para 'posso confiar nesses números?', 'o que ainda falta?' e 'por que este " +
    "valor não foi calculado?'. Consulte antes de concluir que algo não existe — o mais " +
    "comum é existir e estar sem semântica confirmada.",
  argumentos: {
    aspecto: {
      tipo: "texto",
      descricao:
        "`curadoria` (o que falta confirmar), `importacoes` (que arquivos entraram e quando), " +
        "`balanco` (quantas células viraram fato e o que não promoveu), `panorama` (o que " +
        "existe no recorte), `sem_preco` (o que não pôde ser precificado), `celula` (onde um " +
        "valor literal aparece na planilha importada).",
      opcoes: [
        "curadoria", "importacoes", "balanco", "panorama", "sem_preco", "celula",
      ] as const,
      obrigatorio: true,
    },
    termo: {
      tipo: "texto",
      descricao:
        "Para `celula`, o que procurar literalmente (uma placa, um chassi). Para " +
        "`curadoria`, o código do atributo cujo histórico de semântica se quer.",
    },
  },
  async executar(ctx, args): Promise<SaidaDaFerramenta> {
    const aspecto = args.aspecto as string;
    const termo = args.termo as string | undefined;

    if (aspecto === "curadoria") {
      const partes = [await estadoDaCuradoria(ctx.db).catch(() => null)];
      if (termo) partes.push(await historicoDaSemantica(ctx.db, termo).catch(() => null));
      return deVarias(partes, "Nada sobre curadoria.");
    }
    if (aspecto === "importacoes") {
      return de(await importacoesRecentes(ctx.db), "Nenhuma importação registrada.");
    }
    if (aspecto === "balanco") {
      return de(await balancoDasImportacoes(ctx.db), "Nenhum balanço de massa disponível.");
    }
    if (aspecto === "celula") {
      if (!termo) {
        return {
          conteudo: { erro: "O aspecto `celula` precisa do argumento `termo`." },
          evidencias: [],
        };
      }
      return de(
        await buscarNasCelulas(ctx.db, termo),
        `"${termo}" não aparece em nenhuma célula importada.`,
      );
    }

    const resolvido = await contexto(ctx);
    if (aspecto === "sem_preco") {
      return de(
        await semParaPrecificar(ctx.db, resolvido, ctx.periodo),
        "Tudo o que mudou nesta vigência tem preço apurado.",
      );
    }
    return de(await panoramaDoContexto(ctx.db, resolvido), "Nada importado neste recorte.");
  },
};

/** As nove capacidades, na ordem em que fazem sentido para quem lê. */
export const CATALOGO: Ferramenta[] = [
  recortes,
  parametros,
  serie,
  comparar,
  ordenacao,
  veiculos,
  resultado,
  documentos,
  estadoDoDado,
];
