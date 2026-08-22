import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { and, desc, eq, gte, inArray, isNull, lte, ne, notInArray, sql } from "drizzle-orm";
import type { Database } from "@workspace/db";
import type { Executor, Transacao } from "./executor";
import {
  fechamentoApuracaoTable,
  fechamentoApuracaoVerbaTable,
  fechamentoCompetenciaTable,
  fechamentoConciliacaoItemTable,
  fechamentoCteTable,
  fechamentoDisponibilidadeTable,
  fechamentoDivergenciaTable,
  fechamentoDocumentoConteudoTable,
  fechamentoDocumentoTable,
  fechamentoPagamentoDescontoTable,
  fechamentoPagamentoItemTable,
  fechamentoParteTable,
  fechamentoRequisicaoTable,
  unidadeTable,
  fechamentoViagemTable,
} from "@workspace/db";
import {
  DESCRICAO_DA_FONTE,
  TIPOS_DE_FONTE,
  centavos,
  frotaDaFonte,
  type Canal,
  type Frota,
  type Recusa,
  type TipoDeFonte,
  type TipoDeFrotaContratada,
} from "./dominio";
import {
  competencia as montarCompetencia,
  competenciaDaChave,
  dentroDaCompetencia,
  type Competencia,
  type Dia,
} from "./periodo";
import {
  conciliarIdentidadeDasCompetencias,
  identidadeDaCompetencia,
} from "./identidade-da-competencia";
import { apurar, type Apuracao, type Fontes, type Parcela } from "./apuracao";
import { montarResumo, type QuinzenaApurada, type ResumoDoMes } from "./resumo";
import {
  SEM_CADASTRO,
  type DiagnosticoDoCadastro,
  type FonteDeCadastro,
} from "./cadastro-porta";
import {
  montarMapaDaQuinzena,
  somarIndisponibilidade,
  VBZ_DA_EQUIPE_DE_ENTREGA,
  somarVariavel,
  type BaseDeOutrosCustos,
  type ViagemDoMapa,
} from "./mapa-rota";
import {
  CANAIS_COM_PAINEL,
  conferirDePara,
  type ColunaDoPagamento,
  type DeParaConferido,
} from "./de-para";
import { lerOperacao, type DetalheDaViagem, type Viagem } from "./leitores/operacao";
import { abrirDia, diasDaCompetencia, type DiaAberto, type DiaDaOperacao } from "./diario";
import { lerCtes } from "./leitores/cte";
import { lerRequisicoes, STATUS_QUE_PAGA } from "./leitores/requisicoes";
import {
  descontoDeDisponibilidadeDoMes,
  lerDisponibilidade,
  type DescontoDeDisponibilidadeDoMes,
} from "./leitores/disponibilidade";
import { lerConciliacao } from "./leitores/conciliacao";
import {
  lerPagamento,
  vbzsCitadasNoRotulo,
  type BlocoDoPagamento,
  type TipoDeDescontoDoPagamento,
} from "./leitores/pagamento";
import { verbaDe, verbaDesconhecida, type Verba } from "./verbas";

/**
 * A ponte entre o motor e o banco.
 *
 * O núcleo (`apuracao.ts`) é aritmética pura sobre arquivos, e continua sendo:
 * é o que permite conferir um fechamento inteiro num teste sem subir nada.
 * Este arquivo é o que dá memória a ele — recebe o documento, normaliza as
 * linhas, e roda a apuração **sobre o que o banco guardou**, não sobre o que
 * acabou de ser lido do arquivo.
 *
 * Essa distinção é deliberada e é a garantia central do módulo: um número que
 * a tela mostra é sempre um número que o banco sustenta, e a memória de
 * cálculo de cada parcela pode ser aberta até a linha física do arquivo de
 * origem. Se a apuração rodasse sobre o objeto em memória do upload, haveria um
 * caminho pelo qual a tela mostraria algo que o banco não tem.
 */

/** Um erro que a interface precisa distinguir de uma falha nossa. */
export class RecusaDeFechamento extends Error {
  constructor(
    readonly codigo:
      | "COMPETENCIA_NAO_ENCONTRADA"
      | "COMPETENCIA_ENCERRADA"
      | "COMPETENCIA_NAO_APURADA"
      | "COMPETENCIA_NAO_ESTA_ENCERRADA"
      | "TIPO_DE_OPERACAO_EM_USO"
      | "MOTIVO_OBRIGATORIO"
      | "DOCUMENTO_JA_RECEBIDO"
      | "DOCUMENTO_NAO_ENCONTRADO"
      | "DOCUMENTO_FORA_DO_PERIODO"
      | "CONTEUDO_NAO_GUARDADO"
      | "ARQUIVO_ILEGIVEL"
      | "PARTE_SEM_CODIGO"
      /** Pediram para associar a uma unidade canônica que não existe. */
      | "UNIDADE_NAO_ENCONTRADA",
    mensagem: string,
    readonly detalhe?: unknown,
  ) {
    super(mensagem);
    this.name = "RecusaDeFechamento";
  }
}

export interface CompetenciaRegistrada extends Competencia {
  id: string;
  unidade: { codigo: string; nome: string | null };
  /**
   * A unidade canônica desta competência — `null` enquanto ninguém a afirmou.
   *
   * **É o que permite perguntar ao cadastro sem comparar texto.** As duas
   * pontas apontando para o mesmo `unidade.id` é o único casamento que não pode
   * errar; sem ele resta o plano B das competências históricas, que compara
   * códigos escritos à mão. Quem lê a competência e vai resolver o contrato
   * precisa dela — sem isto, duas telas perguntando pelo mesmo contrato podem
   * receber respostas diferentes, uma pela identidade e outra pelo texto.
   *
   * Sai no registro também porque é **estado da competência**, e não detalhe
   * interno: sem ele, a única forma de a tela saber se o fechamento tem
   * identidade era deduzir do diagnóstico do cadastro, que responde outra
   * pergunta (qual porta fechou).
   *
   * `null` nas abertas antes de a identidade existir e nas que ninguém
   * associou — cada vez menos, desde que `identidade-da-competencia.ts` passou
   * a escrevê-la em todo momento em que ela é afirmável.
   */
  unidadeId: string | null;
  transportadora: { codigo: string; nome: string | null };
  /**
   * `EMPURRADA`, `ROTA` — a operação que este fechamento fecha.
   *
   * Não confundir com `Canal` (`ROTA` | `AS`), que é outro eixo deste mesmo
   * módulo. Ver `schema/fechamento.ts`. `NAO_INFORMADO` são as competências
   * abertas antes de o campo existir.
   */
  tipoDeOperacao: string;
  estado: string;
  abertaEm: Date;
  apuradaEm: Date | null;
  encerradaEm: Date | null;
  /**
   * Por que a competência foi reaberta, quando foi.
   *
   * Vive no registro e não num log à parte porque é a pergunta que se faz
   * olhando para a competência — "por que este período, que estava fechado,
   * está aberto de novo?" —, e uma resposta que exige abrir outra tela não é
   * respondida.
   */
  motivoDaReabertura: string | null;
}

/** Erro de recusa: abrir sem dizer o tipo de operação. Rota traduz em 400. */
export class TipoDeOperacaoAusente extends Error {
  constructor() {
    super(
      "O tipo de operação é obrigatório para abrir um fechamento: EMPURRADA e ROTA são " +
        "operações diferentes, com planilhas de remuneração diferentes, e o fechamento é de " +
        "uma delas.",
    );
    this.name = "TipoDeOperacaoAusente";
  }
}

/**
 * O tipo de operação, normalizado como o acervo o escreve.
 *
 * Caixa alta e sem espaço nas pontas, que é a forma do rótulo da vigência
 * (`EMPURRADA_1_8_2026`) e a de `remuneracao_planilha.canal`. Sem isso,
 * `Empurrada` digitado na tela e `EMPURRADA` vindo do acervo seriam dois tipos,
 * e a mesma operação teria dois fechamentos.
 *
 * `NAO_INFORMADO` é recusado na porta: ele é o carimbo do backfill da `0046`,
 * e nada além dele pode escrevê-lo. Deixá-lo passar daria a quem abre uma forma
 * de dizer "não sei" num campo que a operação decidiu que é obrigatório.
 */
export const TIPO_NAO_INFORMADO = "NAO_INFORMADO";

export function normalizarTipoDeOperacao(bruto: unknown): string {
  const texto = typeof bruto === "string" ? bruto.trim().toUpperCase() : "";
  if (texto === "" || texto === TIPO_NAO_INFORMADO) throw new TipoDeOperacaoAusente();
  return texto;
}

/**
 * Abre a competência, ou devolve a que já existe.
 *
 * Idempotente de propósito: a quádrupla (unidade, transportadora, tipo de
 * operação, quinzena) é um fechamento só, e "abrir de novo" é o gesto natural
 * de quem volta à tela no dia seguinte. Criar uma segunda seria criar duas
 * verdades sobre o mesmo dinheiro — o índice único do banco impede, e aqui a
 * intenção é atendida em vez de virar erro.
 *
 * **O tipo de operação entra na chave, e é por isso que ele é obrigatório.** O
 * mesmo CDD roda EMPURRADA e ROTA com a mesma transportadora na mesma quinzena,
 * e são duas operações com planilhas, relatórios e contas diferentes. Sem o
 * tipo, a segunda abertura encontraria a primeira e devolveria o fechamento da
 * outra operação — silenciosamente, porque a idempotência acima é o caminho
 * feliz. Ver a `0046`.
 *
 * **As duas partes ficam cadastradas, inclusive quando a competência já
 * existia.** É o que faz o vocabulário sobreviver ao registro: excluir uma
 * importação aberta por engano não pode levar embora o nome do CDD que alguém
 * escreveu para abri-la. O cadastro é idempotente e nunca apaga um nome (ver
 * `registrarParte`), então repetir a abertura só reafirma o que já estava lá.
 */
export async function abrirCompetencia(
  db: Database,
  entrada: {
    ano: number;
    mes: number;
    quinzena: 1 | 2;
    /**
     * A unidade **selecionada** do cadastro mestre — o caminho de agora.
     *
     * Quando vem, `unidade` é ignorada: nome e código saem da unidade canônica,
     * e nenhuma identidade é digitada. Ver o corpo.
     */
    unidadeId?: string | null;
    /**
     * A unidade digitada — o caminho legado.
     *
     * Continua aceito porque o histórico e a importação o usam, e porque tirá-lo
     * agora quebraria toda competência aberta antes da `0049`. O que ele não faz
     * é criar identidade: sem `unidadeId`, a competência nasce com `unidade_id`
     * nulo e a tela a mostra como não associada.
     */
    unidade: { codigo: string; nome?: string | null };
    transportadora: { codigo: string; nome?: string | null };
    /** `EMPURRADA`, `ROTA` — o eixo de `remuneracao_planilha.canal`. */
    tipoDeOperacao: string;
    por?: string | null;
  },
): Promise<CompetenciaRegistrada> {
  const comp = montarCompetencia(entrada.ano, entrada.mes, entrada.quinzena);
  const tipoDeOperacao = normalizarTipoDeOperacao(entrada.tipoDeOperacao);

  /*
    A unidade **selecionada** — o caminho novo, e o que a regra central pede.

    Quando quem abre escolhe uma unidade canônica, nada mais é digitado: o nome e
    o código saem do cadastro, e o código é o CNPJ. Não porque o CNPJ seja "o
    código" — o legado continua sendo texto livre —, mas porque a competência
    nova precisa de um valor para `unidade_codigo`, que é NOT NULL e está na
    chave única, e o CNPJ é o único texto que **já** é a identidade. Assim as
    competências novas nascem com as duas pontas concordando.

    A unidade digitada continua aceita para não quebrar o histórico e os testes
    que a usam; o que ela não faz é criar identidade — `unidadeId` fica nulo, e
    a tela mostra "unidade não associada".
  */
  let unidade = entrada.unidade;
  let unidadeId: string | null = null;
  if (entrada.unidadeId) {
    const [canonica] = await db
      .select()
      .from(unidadeTable)
      .where(eq(unidadeTable.id, entrada.unidadeId))
      .limit(1);
    if (!canonica) {
      throw new RecusaDeFechamento(
        "UNIDADE_NAO_ENCONTRADA",
        "Não existe unidade canônica com este identificador. Cadastre-a em " +
          "Administração → Unidades antes de abrir a competência.",
      );
    }
    unidade = { codigo: canonica.cnpj, nome: canonica.nome };
    unidadeId = canonica.id;
  }

  /*
    O caminho legado deixa de nascer sem identidade quando ela **é** afirmável.

    Sem isto, toda competência aberta pelo texto — importação, histórico, script
    — nascia com `unidade_id` nulo mesmo quando o texto era o CNPJ de uma
    unidade cadastrada, ou quando a competência irmã do mesmo texto já tinha
    sido associada por alguém. O nulo então nunca mais era revisto, e o conserto
    virava um clique manual por quinzena.

    Nada aqui adivinha: `identidadeDaCompetencia` só responde ao CNPJ no próprio
    texto e à decisão que uma pessoa já tomou sobre o mesmo texto. Ambígua e
    desconhecida continuam nascendo nulas, que é a resposta honesta.
  */
  if (unidadeId === null) {
    const identidade = await identidadeDaCompetencia(db, { unidadeCodigo: unidade.codigo });
    if (identidade.tipo === "INEQUIVOCA") unidadeId = identidade.unidade.id;
  }

  await registrarParte(db, { tipo: "UNIDADE", ...unidade });
  await registrarParte(db, { tipo: "TRANSPORTADORA", ...entrada.transportadora });

  const existente = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .where(
      and(
        eq(fechamentoCompetenciaTable.unidadeCodigo, unidade.codigo),
        eq(fechamentoCompetenciaTable.transportadoraCodigo, entrada.transportadora.codigo),
        eq(fechamentoCompetenciaTable.tipoDeOperacao, tipoDeOperacao),
        eq(fechamentoCompetenciaTable.chave, comp.chave),
      ),
    )
    .limit(1);
  /*
    Reabrir o mesmo endereço é um clique repetido — e é também a segunda chance
    de a competência antiga ganhar identidade. Quem volta à tela de abrir para a
    2ª quinzena depois de ter cadastrado a unidade está afirmando de novo qual
    unidade é aquela; devolver a linha nula sem escrevê-la deixaria o conserto
    dependendo de um terceiro gesto que ninguém sabe que existe.

    Só a competência **aberta** é corrigida: a encerrada muda de número ao ser
    associada, e isso é do encerramento, não daqui.
  */
  if (existente[0]) {
    const jaExiste = existente[0];
    if (unidadeId !== null && jaExiste.unidadeId === null && jaExiste.estado !== "ENCERRADA") {
      const [atualizada] = await db
        .update(fechamentoCompetenciaTable)
        .set({ unidadeId })
        .where(
          and(
            eq(fechamentoCompetenciaTable.id, jaExiste.id),
            isNull(fechamentoCompetenciaTable.unidadeId),
          ),
        )
        .returning();
      if (atualizada) return comoRegistrada(atualizada);
    }
    return comoRegistrada(jaExiste);
  }

  const [criada] = await db
    .insert(fechamentoCompetenciaTable)
    .values({
      chave: comp.chave,
      ano: comp.ano,
      mes: comp.mes,
      quinzena: comp.quinzena,
      inicio: comp.inicio,
      fim: comp.fim,
      unidadeCodigo: unidade.codigo,
      unidadeNome: unidade.nome ?? null,
      unidadeId,
      transportadoraCodigo: entrada.transportadora.codigo,
      transportadoraNome: entrada.transportadora.nome ?? null,
      tipoDeOperacao,
      abertaPor: entrada.por ?? null,
    })
    .returning();
  return comoRegistrada(criada);
}

/**
 * Informa — ou corrige — o tipo de operação de uma competência que já existe.
 *
 * **Por que esta função precisa existir.** O tipo entra na chave desde a
 * `0046`, e até aqui só a abertura o escrevia. Isso deixava dois casos sem
 * saída em tela nenhuma: as competências que o backfill carimbou de
 * `NAO_INFORMADO` — que são todas as anteriores àquela migration — e as que
 * alguém abriu com o tipo errado. A primeira é a mais grave: o `NAO_INFORMADO`
 * não é um tipo, é a confissão de que ninguém disse, e uma competência presa
 * nele não aparece no Resumo de nenhuma operação real. O acervo inteiro ficava
 * legível e sem endereço.
 *
 * **Informar e corrigir não são o mesmo gesto, e a regra os separa pelo
 * estado.** Preencher um `NAO_INFORMADO` não apaga declaração nenhuma: o campo
 * está em branco porque a coluna nasceu depois da competência, e escrever nele
 * é dar endereço a um fechamento que nunca teve — inclusive num encerrado, cujo
 * congelamento é sobre o dinheiro apurado e não sobre em qual operação ele foi
 * apurado. Trocar `EMPURRADA` por `ROTA` é outra coisa: alguém declarou, a
 * quinzena foi fechada sob aquela declaração, e mudá-la move um total já
 * cobrado do mês de uma operação para o da outra. Isso exige o gesto que este
 * produto já tem para mexer no que foi fechado — reabrir, com motivo.
 *
 * **A colisão é recusada com nome e endereço.** O destino pode já estar ocupado:
 * a mesma unidade, a mesma transportadora e a mesma quinzena já tendo um
 * fechamento do tipo para o qual se quer mudar. O índice único recusaria de
 * qualquer forma, com a mensagem do Postgres; a recusa daqui diz **qual**
 * competência está no lugar, que é o que permite a quem opera decidir entre
 * corrigir a outra ou excluir esta.
 *
 * **Repetir o tipo que já está lá não é erro.** Devolve a competência como
 * está, pela mesma razão que abrir duas vezes devolve a mesma: é o gesto de
 * quem clicou duas vezes, ou de dois separadores da mesma tela, e transformá-lo
 * em 409 seria inventar um conflito onde o estado desejado já é o estado atual.
 *
 * A apuração não é refeita, e nem precisa: nada na aritmética da competência lê
 * este campo — ele diz de qual operação é a conta, não como ela é calculada. O
 * que muda é onde ela aparece, que é exatamente o que se quis mudar.
 */
export async function informarTipoDeOperacao(
  db: Database,
  competenciaId: string,
  entrada: { tipoDeOperacao: string },
): Promise<CompetenciaRegistrada> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ENCONTRADA",
      "A competência informada não existe.",
    );
  }

  /*
    A mesma normalização da abertura, e de propósito a mesma: um tipo que só
    pudesse ser escrito por um dos dois caminhos seria um tipo que a chave não
    reconhece. `NAO_INFORMADO` é recusado aqui pelo motivo de sempre — ele é
    carimbo do backfill, e desinformar o que já foi informado não é um pedido
    que a operação faça.
  */
  const tipoDeOperacao = normalizarTipoDeOperacao(entrada.tipoDeOperacao);
  if (tipoDeOperacao === competencia.tipoDeOperacao) return competencia;

  if (competencia.tipoDeOperacao !== TIPO_NAO_INFORMADO && competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada como ${competencia.tipoDeOperacao}. ` +
        "Reabra-a, com motivo, antes de trocar o tipo de operação: o total já fechado passaria " +
        "de uma operação para a outra.",
    );
  }

  const [ocupante] = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .where(
      and(
        eq(fechamentoCompetenciaTable.unidadeCodigo, competencia.unidade.codigo),
        eq(fechamentoCompetenciaTable.transportadoraCodigo, competencia.transportadora.codigo),
        eq(fechamentoCompetenciaTable.tipoDeOperacao, tipoDeOperacao),
        eq(fechamentoCompetenciaTable.chave, competencia.chave),
      ),
    )
    .limit(1);
  if (ocupante) {
    throw new RecusaDeFechamento(
      "TIPO_DE_OPERACAO_EM_USO",
      `${competencia.unidade.nome ?? competencia.unidade.codigo} e ` +
        `${competencia.transportadora.nome ?? competencia.transportadora.codigo} já têm um ` +
        `fechamento de ${competencia.chave} como ${tipoDeOperacao}. São dois fechamentos da ` +
        "mesma operação na mesma quinzena, e o acervo guarda um só: corrija o outro, ou exclua " +
        "esta importação.",
      { competenciaId: ocupante.id },
    );
  }

  const [linha] = await db
    .update(fechamentoCompetenciaTable)
    .set({ tipoDeOperacao })
    .where(eq(fechamentoCompetenciaTable.id, competenciaId))
    .returning();
  return comoRegistrada(linha);
}

/** Todas as competências, da mais recente para a mais antiga. */
export async function listarCompetencias(db: Database): Promise<CompetenciaRegistrada[]> {
  const linhas = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .orderBy(
      desc(fechamentoCompetenciaTable.ano),
      desc(fechamentoCompetenciaTable.mes),
      desc(fechamentoCompetenciaTable.quinzena),
    );
  return linhas.map(comoRegistrada);
}

export async function buscarCompetencia(
  db: Executor,
  id: string,
): Promise<CompetenciaRegistrada | null> {
  const [linha] = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .where(eq(fechamentoCompetenciaTable.id, id))
    .limit(1);
  return linha ? comoRegistrada(linha) : null;
}

function comoRegistrada(linha: typeof fechamentoCompetenciaTable.$inferSelect): CompetenciaRegistrada {
  const base = competenciaDaChave(linha.chave) ?? montarCompetencia(linha.ano, linha.mes, linha.quinzena as 1 | 2);
  return {
    ...base,
    id: linha.id,
    unidade: { codigo: linha.unidadeCodigo, nome: linha.unidadeNome },
    unidadeId: linha.unidadeId ?? null,
    transportadora: { codigo: linha.transportadoraCodigo, nome: linha.transportadoraNome },
    tipoDeOperacao: linha.tipoDeOperacao,
    estado: linha.estado,
    abertaEm: linha.abertaEm,
    apuradaEm: linha.apuradaEm,
    encerradaEm: linha.encerradaEm,
    motivoDaReabertura: linha.motivoDaReabertura,
  };
}

/**
 * O que aconteceu com o arquivo — e as duas coisas são desfechos, não erros.
 *
 * `PROMOVIDO`: o arquivo virou os fatos da competência e despromoveu o anterior
 * do mesmo tipo. `EM_QUARENTENA`: o arquivo foi **guardado inteiro**, com as
 * recusas, e não virou fato nenhum — o anterior continua valendo.
 *
 * **Por que quarentena e não recusa.** Recusar joga fora a evidência: o arquivo
 * volta para quem enviou e o sistema fica sem saber o que havia nele. Guardar
 * sem promover conserva as duas coisas que importam — a conta anterior, que
 * continua de pé, e o arquivo problemático, que agora pode ser examinado sem
 * pedir nada a ninguém.
 */
export type DesfechoDaImportacao = "PROMOVIDO" | "EM_QUARENTENA";

export interface DocumentoRecebido {
  id: string;
  tipo: TipoDeFonte;
  nomeDoArquivo: string;
  linhasLidas: number;
  recusas: Recusa[];
  /** O documento que substituiu, quando houve substituição. */
  substituiu: string | null;
  desfecho: DesfechoDaImportacao;
  /** Por que ficou em quarentena. `null` quando foi promovido. */
  motivoDaQuarentena: string | null;
}

/**
 * Recebe um arquivo de fonte, normaliza suas linhas e as grava.
 *
 * Tudo em uma transação: um documento cujas linhas falharam no meio deixaria a
 * competência com meia fonte, e meia fonte é pior que fonte nenhuma — a
 * apuração rodaria, fecharia menos, e apontaria divergência onde só houve
 * gravação interrompida.
 *
 * **Reenviar substitui.** Uma exportação corrigida do mesmo tipo despromove a
 * anterior (`vigente = false`) e apaga as linhas dela; as duas ficam no
 * histórico de documentos. O mesmo arquivo, byte a byte, é recusado enquanto o
 * documento que já está lá sustentar alguma linha — é reenvio acidental, e
 * deixá-lo entrar dobraria a conta.
 *
 * **E é aceito quando ele não sustenta nenhuma**, porque aí não há conta a
 * dobrar: o reenvio refaz aquele mesmo documento, no lugar, em vez de criar um
 * segundo. A recusa cega barrava o único conserto de um 03.08.20 que ficara no
 * banco sem verba — a tela mandava substituir, o índice `(competência,
 * sha256)` negava o arquivo certo, e sobrava descartar a quinzena inteira.
 */
export async function receberDocumento(
  db: Database,
  entrada: {
    competenciaId: string;
    tipo: TipoDeFonte;
    nomeDoArquivo: string;
    conteudo: Buffer;
    caminho?: string | null;
    por?: string | null;
  },
): Promise<DocumentoRecebido> {
  const competencia = await buscarCompetencia(db, entrada.competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ENCONTRADA",
      "A competência informada não existe.",
    );
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada. Reabra-a, com motivo, antes de enviar documentos.`,
    );
  }

  const sha256 = createHash("sha256").update(entrada.conteudo).digest("hex");
  /*
    **A repetição é dentro da fonte, e não dentro da competência.** O 03.08.18
    exportado com as duas abas juntas é o arquivo da FF *e* o das vans: cada
    casinha lê a frota dela e ignora a outra, e por isso os mesmos bytes
    precisam entrar duas vezes, uma por fonte. Enquanto a pergunta era
    "estes bytes já entraram nesta competência?", o segundo envio era recusado
    como reenvio acidental e a segunda frota ficava de fora sem aviso — ver a
    `0055`, que moveu a chave para `(competência, tipo, sha256)`.

    Dentro da mesma fonte nada mudou: os mesmos bytes de novo dobrariam a conta,
    e continuam recusados enquanto o documento que está lá sustentar linha.
  */
  const jaRecebido = await db
    .select({
      id: fechamentoDocumentoTable.id,
      nome: fechamentoDocumentoTable.nomeDoArquivo,
      tipo: fechamentoDocumentoTable.tipo,
    })
    .from(fechamentoDocumentoTable)
    .where(
      and(
        eq(fechamentoDocumentoTable.competenciaId, entrada.competenciaId),
        eq(fechamentoDocumentoTable.tipo, entrada.tipo),
        eq(fechamentoDocumentoTable.sha256, sha256),
      ),
    )
    .limit(1);
  if (jaRecebido[0]) {
    /*
      **Reenviar o mesmo arquivo é dobrar a conta, ou é consertá-la.** Depende
      de uma coisa só: se o que está guardado sustenta alguma linha. Sustentando,
      recebê-lo de novo somaria as mesmas linhas duas vezes, e a recusa continua
      sendo a resposta certa.

      Não sustentando, não há conta a dobrar — e a recusa passa a barrar
      justamente o conserto. É o beco em que caiu um 03.08.20 real: o documento
      ficou no banco sem verba nenhuma, a tela mandou substituir, e o índice
      único `(competência, sha256)` recusava o único arquivo que resolveria.
      Sobrava descartar a competência inteira e reimportar as seis fontes por
      causa de uma. Aqui o reenvio vira o que ele já era na intenção de quem o
      fez: reimportar aquele documento, no lugar, a partir dos bytes que a
      importação guardou.
    */
    /* A consulta já é da mesma fonte (ver acima); o que resta perguntar é se o
       documento que está lá sustenta alguma linha. */
    const podeConsertar =
      (await oQueODocumentoSustenta(db, jaRecebido[0].id, entrada.tipo)) === 0;
    if (podeConsertar) {
      /*
        Os bytes vieram junto, e são usados **estes** — não os guardados. É a
        diferença que faz o conserto alcançar o documento anterior à `0047`, que
        não tem bytes guardados nenhum: para ele, o reenvio é a única forma de o
        original voltar a existir.
      */
      return refazerDocumento(
        db,
        {
          id: jaRecebido[0].id,
          competenciaId: entrada.competenciaId,
          tipo: entrada.tipo,
          nomeDoArquivo: entrada.nomeDoArquivo,
        },
        competencia,
        entrada.conteudo,
      );
    }

    throw new RecusaDeFechamento(
      "DOCUMENTO_JA_RECEBIDO",
      `Este arquivo já foi recebido nesta competência como "${jaRecebido[0].nome}". ` +
        `Recebê-lo de novo dobraria a conta.`,
      { documentoId: jaRecebido[0].id },
    );
  }

  /*
    Ler primeiro, decidir depois, gravar por último. A ordem é o que torna a
    importação atômica no sentido que importa: nada é despromovido antes de se
    saber se o que chegou merece promover.
  */
  const lido = interpretar(entrada.tipo, entrada.conteudo);
  recusarOperacaoDeOutroPeriodo(competencia, entrada.nomeDoArquivo, lido.dias);
  recusarPagamentoDeOutroPeriodo(competencia, entrada.nomeDoArquivo, lido.periodo);
  const motivoDaQuarentena = motivoParaQuarentena(entrada.tipo, entrada.nomeDoArquivo, lido);

  return db.transaction(async (tx) => {
    const anterior = await tx
      .select({ id: fechamentoDocumentoTable.id })
      .from(fechamentoDocumentoTable)
      .where(
        and(
          eq(fechamentoDocumentoTable.competenciaId, entrada.competenciaId),
          eq(fechamentoDocumentoTable.tipo, entrada.tipo),
          eq(fechamentoDocumentoTable.vigente, true),
        ),
      )
      .limit(1);

    /*
      **Só se promove o que vale.** O bloco abaixo apaga as linhas do documento
      anterior e o despromove; rodá-lo antes de saber se o novo presta foi o que
      deixou uma competência sem a parcela fixa. Em quarentena ele não roda: o
      anterior fica intocado, vigente, com os fatos dele de pé.
    */
    if (anterior[0] && motivoDaQuarentena === null) {
      await apagarLinhasDoDocumento(tx, anterior[0].id);
      await tx
        .update(fechamentoDocumentoTable)
        .set({ vigente: false })
        .where(eq(fechamentoDocumentoTable.id, anterior[0].id));
    }

    const [documento] = await tx
      .insert(fechamentoDocumentoTable)
      .values({
        competenciaId: entrada.competenciaId,
        tipo: entrada.tipo,
        nomeDoArquivo: entrada.nomeDoArquivo,
        sha256,
        tamanhoEmBytes: entrada.conteudo.byteLength,
        caminho: entrada.caminho ?? null,
        linhasLidas: lido.linhasLidas,
        recusas: lido.recusas,
        /* O documento em quarentena existe, é consultável, e não é a fonte da
           conta. É o que permite examiná-lo sem que ele valha nada. */
        vigente: motivoDaQuarentena === null,
        enviadoPor: entrada.por ?? null,
      })
      .returning({ id: fechamentoDocumentoTable.id });

    /*
      O arquivo é guardado **sempre**, promovido ou não — e o caso em quarentena
      é justamente o que mais precisa dele: é o arquivo que ninguém consegue
      explicar sem reabrir. Comprimido, com o tamanho original ao lado para que
      a volta seja verificável.
    */
    await tx.insert(fechamentoDocumentoConteudoTable).values({
      documentoId: documento.id,
      conteudo: gzipSync(entrada.conteudo),
      bytesOriginais: entrada.conteudo.byteLength,
    });

    if (motivoDaQuarentena === null) {
      await gravarLinhas(tx, entrada.competenciaId, documento.id, entrada.tipo, entrada.conteudo);
    }

    return {
      id: documento.id,
      tipo: entrada.tipo,
      nomeDoArquivo: entrada.nomeDoArquivo,
      linhasLidas: lido.linhasLidas,
      recusas: lido.recusas,
      desfecho: motivoDaQuarentena === null ? "PROMOVIDO" : "EM_QUARENTENA",
      motivoDaQuarentena,
      /* Substituir é ato de quem promove; em quarentena não se substitui nada. */
      substituiu: motivoDaQuarentena === null ? (anterior[0]?.id ?? null) : null,
    };
  });
}

/**
 * Apaga as linhas que um documento produziu, em todas as fontes.
 *
 * As sete tabelas estão escritas uma vez, e não uma vez por chamador: a
 * substituição e a reimportação apagam exatamente a mesma coisa, e duas cópias
 * divergiriam na tabela que a próxima fonte trouxer — deixando para trás a
 * linha órfã que reaparece somando numa conta meses depois.
 *
 * O documento em si fica. Quem decide o que ele passa a ser — despromovido,
 * ou reconstruído a partir dos próprios bytes — é quem chamou.
 */
async function apagarLinhasDoDocumento(tx: Transacao, documentoId: string): Promise<void> {
  await tx.delete(fechamentoViagemTable).where(eq(fechamentoViagemTable.documentoId, documentoId));
  await tx.delete(fechamentoCteTable).where(eq(fechamentoCteTable.documentoId, documentoId));
  await tx
    .delete(fechamentoRequisicaoTable)
    .where(eq(fechamentoRequisicaoTable.documentoId, documentoId));
  await tx
    .delete(fechamentoDisponibilidadeTable)
    .where(eq(fechamentoDisponibilidadeTable.documentoId, documentoId));
  await tx
    .delete(fechamentoConciliacaoItemTable)
    .where(eq(fechamentoConciliacaoItemTable.documentoId, documentoId));
  await tx
    .delete(fechamentoPagamentoItemTable)
    .where(eq(fechamentoPagamentoItemTable.documentoId, documentoId));
  await tx
    .delete(fechamentoPagamentoDescontoTable)
    .where(eq(fechamentoPagamentoDescontoTable.documentoId, documentoId));
}

/** A tabela em que cada fonte deixa a linha que a define. */
const LINHA_DA_FONTE = {
  OPERACAO: fechamentoViagemTable,
  CTE: fechamentoCteTable,
  REQUISICOES: fechamentoRequisicaoTable,
  /* As duas casinhas do 03.08.18 gravam na mesma tabela, e cada linha carrega a
     frota dela: o que separa os dois documentos é o `documento_id`. */
  DISPONIBILIDADE_FF: fechamentoDisponibilidadeTable,
  DISPONIBILIDADE_VAN: fechamentoDisponibilidadeTable,
  CONCILIACAO: fechamentoConciliacaoItemTable,
  /*
    O 03.08.20 grava verba **e** desconto, e aqui só a verba conta. É a mesma
    regra de `motivoParaQuarentena`, e pela mesma razão: descontos sem verba não
    são meio demonstrativo, são um demonstrativo cujo corpo não entrou. Contar
    os descontos aqui faria o documento sem verba parecer sustentar alguma
    coisa, e o reenvio que o conserta voltaria a ser recusado.
  */
  PAGAMENTO: fechamentoPagamentoItemTable,
} as const satisfies Record<TipoDeFonte, unknown>;

/**
 * Quantas linhas o documento sustenta hoje — a pergunta que decide se reenviá-lo
 * dobra a conta ou a conserta.
 *
 * Zero é o documento que não sustenta nada: o que ficou em quarentena, o que
 * teve as linhas apagadas por uma substituição, e o 03.08.20 que uma
 * importação antiga gravou sem as verbas dele. Nos três, o que existe no banco
 * é um nome de arquivo — e nenhuma linha que uma segunda importação pudesse
 * somar de novo.
 */
async function oQueODocumentoSustenta(
  db: Database,
  documentoId: string,
  tipo: TipoDeFonte,
): Promise<number> {
  const tabela = LINHA_DA_FONTE[tipo];
  const [linha] = await db
    .select({ quantas: sql<number>`count(*)::int` })
    .from(tabela)
    .where(eq(tabela.documentoId, documentoId));
  return linha?.quantas ?? 0;
}

/**
 * Reimporta um documento a partir dos bytes que a importação guardou.
 *
 * **Por que isto existe.** As linhas de uma fonte são derivadas: o arquivo é o
 * fato, e a linha é o que um leitor tirou dele. Quando as duas discordam — o
 * arquivo com dez verbas dentro e o banco sem nenhuma —, quem está errado é a
 * derivação, e refazê-la a partir do original é o conserto exato. Até aqui não
 * havia forma de pedi-lo: a tela mandava substituir o arquivo, o índice
 * `(competência, sha256)` recusava o reenvio dele, e a única saída era
 * descartar a competência inteira — seis fontes fora por causa de uma.
 *
 * **Nada é reenviado, e é esse o ponto.** Os bytes já estão no banco desde a
 * `0047`, conferidos por tamanho e por sha256 na volta (ver
 * {@link lerConteudoDoDocumento}). Reimportar não pede nada a quem opera, e não
 * pode trocar o arquivo por outro sem que a conferência acuse.
 *
 * **Reimportar é um ato de promoção, e passa pelos mesmos portões do envio.**
 * A competência encerrada recusa; o período declarado é conferido de novo; e o
 * arquivo que não produz fato nenhum vai para quarentena em vez de valer. Um
 * caminho que gravasse sem esses portões seria uma segunda porta de entrada
 * com regras próprias — que é o que faz duas importações da mesma quinzena
 * discordarem meses depois.
 */
export async function reimportarDocumento(
  db: Database,
  documentoId: string,
): Promise<DocumentoRecebido> {
  const [documento] = await db
    .select({
      id: fechamentoDocumentoTable.id,
      competenciaId: fechamentoDocumentoTable.competenciaId,
      tipo: fechamentoDocumentoTable.tipo,
      nomeDoArquivo: fechamentoDocumentoTable.nomeDoArquivo,
    })
    .from(fechamentoDocumentoTable)
    .where(eq(fechamentoDocumentoTable.id, documentoId))
    .limit(1);
  if (!documento) {
    throw new RecusaDeFechamento("DOCUMENTO_NAO_ENCONTRADO", "O documento informado não existe.");
  }

  const competencia = await buscarCompetencia(db, documento.competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ENCONTRADA",
      "A competência do documento não existe.",
    );
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada. Reabra-a, com motivo, antes de reimportar.`,
    );
  }

  /*
    Sem os bytes não há o que reimportar, e isto é diferente de "o documento não
    existe": ele existe, e o que falta é o original. Importações anteriores à
    `0047` não o guardavam — nelas o conserto continua sendo reenviar o arquivo,
    que agora é aceito porque o documento não sustenta nada (ver
    `receberDocumento`).
  */
  const guardado = await lerConteudoDoDocumento(db, documentoId);
  if (!guardado) {
    throw new RecusaDeFechamento(
      "CONTEUDO_NAO_GUARDADO",
      `"${documento.nomeDoArquivo}" foi importado antes de o sistema guardar o arquivo, e não ` +
        `há bytes de onde reimportá-lo. Reenvie o relatório: como este documento não sustenta ` +
        `nenhuma linha, o reenvio do mesmo arquivo é aceito.`,
      { documentoId },
    );
  }

  return refazerDocumento(
    db,
    { ...documento, tipo: documento.tipo as TipoDeFonte },
    competencia,
    guardado.conteudo,
  );
}

/**
 * Refaz um documento que já existe, a partir de um arquivo, no lugar.
 *
 * O corpo comum da reimportação e do reenvio que conserta. Os dois chegam aqui
 * com os mesmos bytes — um os leu do banco, o outro os recebeu de novo com o
 * mesmo sha256 — e os dois precisam da mesma coisa: apagar o que aquele
 * documento sustentava, reler, e decidir de novo se ele vale. Escrevê-lo duas
 * vezes deixaria um dos dois caminhos de fora do portão que o outro atravessa.
 *
 * `alvo.nomeDoArquivo` é o nome que o documento passa a ter: o mesmo, quando a
 * reimportação relê o que está guardado; o do envio, quando alguém reenviou o
 * arquivo com outro nome — os bytes é que precisam ser os mesmos, e o sha256 já
 * garantiu que são.
 */
async function refazerDocumento(
  db: Database,
  alvo: { id: string; competenciaId: string; tipo: TipoDeFonte; nomeDoArquivo: string },
  competencia: CompetenciaRegistrada,
  conteudo: Buffer,
): Promise<DocumentoRecebido> {
  const { id: documentoId, tipo } = alvo;
  const lido = interpretar(tipo, conteudo);
  recusarOperacaoDeOutroPeriodo(competencia, alvo.nomeDoArquivo, lido.dias);
  recusarPagamentoDeOutroPeriodo(competencia, alvo.nomeDoArquivo, lido.periodo);
  const motivoDaQuarentena = motivoParaQuarentena(tipo, alvo.nomeDoArquivo, lido);

  return db.transaction(async (tx) => {
    await apagarLinhasDoDocumento(tx, documentoId);

    /* Quem saiu do lugar para este entrar. Costuma ser ninguém: o documento
       que se refaz quase sempre já era o vigente da fonte. */
    let substituiu: string | null = null;

    /*
      Refazer promove, e promover é exclusivo: se outro documento da mesma
      fonte está valendo, ele sai — pelas mesmas duas linhas do envio. Sem isto,
      a competência ficaria com duas fontes vigentes do mesmo tipo e a conta
      somaria as duas.
    */
    if (motivoDaQuarentena === null) {
      const outro = await tx
        .select({ id: fechamentoDocumentoTable.id })
        .from(fechamentoDocumentoTable)
        .where(
          and(
            eq(fechamentoDocumentoTable.competenciaId, alvo.competenciaId),
            eq(fechamentoDocumentoTable.tipo, tipo),
            eq(fechamentoDocumentoTable.vigente, true),
            ne(fechamentoDocumentoTable.id, documentoId),
          ),
        )
        .limit(1);
      if (outro[0]) {
        substituiu = outro[0].id;
        await apagarLinhasDoDocumento(tx, outro[0].id);
        await tx
          .update(fechamentoDocumentoTable)
          .set({ vigente: false })
          .where(eq(fechamentoDocumentoTable.id, outro[0].id));
      }
    }

    await tx
      .update(fechamentoDocumentoTable)
      .set({
        nomeDoArquivo: alvo.nomeDoArquivo,
        linhasLidas: lido.linhasLidas,
        recusas: lido.recusas,
        vigente: motivoDaQuarentena === null,
      })
      .where(eq(fechamentoDocumentoTable.id, documentoId));

    /*
      O documento anterior à `0047` não tem os bytes guardados, e quem chega
      aqui pelo reenvio os tem na mão: guardá-los agora é o que faz o
      diagnóstico e a próxima reimportação passarem a funcionar sobre ele. Quem
      chega pela reimportação traz exatamente os mesmos bytes que já estão lá,
      e por isso o conflito não faz nada em vez de reescrever.
    */
    await tx
      .insert(fechamentoDocumentoConteudoTable)
      .values({
        documentoId,
        conteudo: gzipSync(conteudo),
        bytesOriginais: conteudo.byteLength,
      })
      .onConflictDoNothing();

    if (motivoDaQuarentena === null) {
      await gravarLinhas(tx, alvo.competenciaId, documentoId, tipo, conteudo);
    }

    return {
      id: documentoId,
      tipo,
      nomeDoArquivo: alvo.nomeDoArquivo,
      linhasLidas: lido.linhasLidas,
      recusas: lido.recusas,
      desfecho: motivoDaQuarentena === null ? "PROMOVIDO" : "EM_QUARENTENA",
      motivoDaQuarentena,
      substituiu,
    };
  });
}

/** `2026-07-16` → `16/07/2026`, que é como quem fecha a quinzena lê uma data. */
function emBR(dia: Dia): string {
  const [ano, mes, d] = dia.split("-");
  return `${d}/${mes}/${ano}`;
}

/**
 * Recusa o 2Art que não tem uma linha sequer dentro da competência.
 *
 * O 2Art é exportado por mês e a quinzena é meio mês, então **metade do arquivo
 * cair fora é o normal** — e essa metade é contada, nunca recusada (ver
 * `viagensForaDoPeriodo`). Nenhuma linha cair dentro é outra coisa: é o arquivo
 * de um período aberto na competência de outro. Aceitá-lo gravava centenas de
 * viagens que nenhuma conta daqui pode usar, com visto verde e "949 linhas" na
 * linha da fonte — e a única pista de que nada entrou era uma nota de rodapé um
 * cartão abaixo, que ainda por cima dizia "da outra quinzena **do mês**" quando
 * o arquivo era de outro mês inteiro. A importação que mente é a que diz ter
 * dado certo.
 *
 * **A checagem é só do 2Art, de propósito.** Nas outras quatro fontes a data da
 * linha é emissão ou aprovação, que legitimamente atravessa a virada da
 * quinzena — confundir rótulo com data de emissão é justamente o erro que faz
 * uma quinzena inteira sumir de um filtro (ver `FONTES-FECHAMENTO-QUINZENAL.md`
 * e o cabeçalho de `periodo.ts`). Só no 2Art o dia da linha é o dia em que a
 * viagem rodou, e só nele "fora do período" é afirmação segura.
 */
function recusarOperacaoDeOutroPeriodo(
  competencia: CompetenciaRegistrada,
  nomeDoArquivo: string,
  dias: Dia[] | undefined,
): void {
  if (!dias || dias.length === 0) return;
  if (dias.some((dia) => dentroDaCompetencia(competencia, dia))) return;

  const ordenados = [...dias].sort();
  const de = ordenados[0];
  const ate = ordenados[ordenados.length - 1];
  throw new RecusaDeFechamento(
    "DOCUMENTO_FORA_DO_PERIODO",
    `"${nomeDoArquivo}" traz ${dias.length} viagens, e nenhuma delas é desta quinzena: ` +
      `o arquivo é a operação de ${emBR(de)} a ${emBR(ate)}, e a competência ${competencia.chave} ` +
      `vai de ${emBR(competencia.inicio)} a ${emBR(competencia.fim)}. ` +
      `Envie o 2Art deste período, ou abra a competência do período do arquivo.`,
    { de, ate, inicio: competencia.inicio, fim: competencia.fim, viagens: dias.length },
  );
}

/**
 * O arquivo produz fatos que valem a pena promover?
 *
 * **Isto é o portão entre ler e valer.** Ler é o que o leitor faz; valer é o
 * que despromove o documento anterior e vira a conta da quinzena. Antes os dois
 * eram o mesmo ato, e a consequência apareceu em produção: um 03.08.20 do qual
 * o leitor tirou catorze descontos e nenhuma verba entrou como bom, apagou o
 * que o envio anterior gravara, e deixou a competência sem a parcela fixa.
 *
 * **Por que o 03.08.20 sem verba é inválido e não apenas magro.** Ele é a única
 * fonte que abre a parcela fixa verba a verba — é para isso que existe.
 * Descontos sem verbas não são um demonstrativo pequeno; são um demonstrativo
 * cujo corpo o leitor não reconheceu. Promovê-lo troca uma conta certa por
 * meia conta, em silêncio.
 *
 * Devolve `null` quando pode promover, ou o motivo quando não pode.
 */
function motivoParaQuarentena(
  tipo: TipoDeFonte,
  nomeDoArquivo: string,
  lido: { linhasLidas: number; recusas: Recusa[]; verbas?: number },
): string | null {
  const rotina = DESCRICAO_DA_FONTE[tipo].rotina;
  const pista =
    lido.recusas.length > 0
      ? ` O leitor recusou ${lido.recusas.length} linha(s); a primeira diz: "${lido.recusas[0]?.motivo ?? ""}".`
      : "";

  if (lido.linhasLidas === 0) {
    return (
      `"${nomeDoArquivo}" foi lido como ${rotina} e não produziu nenhum registro.` +
      `${pista || " O leitor não reconheceu nenhuma linha do formato esperado."} ` +
      `Confira se o arquivo é mesmo o ${rotina} e se o export saiu completo.`
    );
  }

  if (tipo === "PAGAMENTO" && lido.verbas === 0) {
    return (
      `"${nomeDoArquivo}" foi lido como ${rotina} e trouxe ${lido.linhasLidas} registro(s), ` +
      `mas nenhuma verba — e é a verba que o demonstrativo existe para abrir.` +
      `${pista} O arquivo ficou guardado inteiro para exame; a importação anterior ` +
      `continua valendo.`
    );
  }

  return null;
}

/**
 * Recusa o 03.08.20 de outro período — e este é o mais fácil de todos.
 *
 * O demonstrativo **escreve o próprio período no cabeçalho de toda página**
 * (`Periodo: 16/07/2026 a 31/07/2026`), o que nenhuma outra fonte faz: no 2Art
 * o período se infere das viagens, no 03.08.15 e no 03.08.12.09 o que existe é
 * o rótulo da quinzena de pagamento, e rótulo não é data. Aqui a comparação é
 * literal, e por isso a recusa é exata em vez de heurística.
 *
 * **Por que isso importa mais do que parece.** O erro que ela pega é o de
 * lançar a quinzena inteira na competência errada — os arquivos de julho
 * abertos na competência de agosto. Sem esta checagem ele só aparece na hora de
 * comparar a conta com a planilha, uma quinzena depois, quando já não se sabe
 * qual dos seis arquivos foi o trocado.
 */
function recusarPagamentoDeOutroPeriodo(
  competencia: CompetenciaRegistrada,
  nomeDoArquivo: string,
  periodo: { inicio: Dia | null; fim: Dia | null } | undefined,
): void {
  if (!periodo?.inicio || !periodo.fim) return;
  if (periodo.inicio === competencia.inicio && periodo.fim === competencia.fim) return;

  throw new RecusaDeFechamento(
    "DOCUMENTO_FORA_DO_PERIODO",
    `"${nomeDoArquivo}" é o demonstrativo de ${emBR(periodo.inicio)} a ${emBR(periodo.fim)}, ` +
      `e a competência ${competencia.chave} vai de ${emBR(competencia.inicio)} a ` +
      `${emBR(competencia.fim)}. O próprio arquivo declara o período no cabeçalho. ` +
      `Envie o 03.08.20 deste período, ou abra a competência do período do arquivo.`,
    {
      de: periodo.inicio,
      ate: periodo.fim,
      inicio: competencia.inicio,
      fim: competencia.fim,
    },
  );
}

/**
 * Quantas linhas o leitor produziu, e o que recusou — sem gravar nada ainda.
 *
 * `dias` sai só do 2Art e `periodo` só do 03.08.20; os dois existem para que a
 * conferência de "este arquivo é mesmo desta quinzena?" aconteça **antes** de
 * qualquer linha ser gravada — ver as duas recusas acima.
 */
function interpretar(
  tipo: TipoDeFonte,
  conteudo: Buffer,
): {
  linhasLidas: number;
  recusas: Recusa[];
  dias?: Dia[];
  /** O período que o próprio arquivo declara. Só o 03.08.20 declara um. */
  periodo?: { inicio: Dia | null; fim: Dia | null };
  /**
   * Quantas verbas o 03.08.20 trouxe — separado de `linhasLidas`, que soma
   * verbas e descontos. É a diferença entre os dois que revela o arquivo em que
   * só os descontos foram reconhecidos.
   */
  verbas?: number;
} {
  try {
    switch (tipo) {
      case "OPERACAO": {
        const l = lerOperacao(conteudo);
        return {
          linhasLidas: l.linhas.length,
          recusas: l.recusas,
          dias: l.linhas.map((v) => v.dia),
        };
      }
      case "CTE": {
        const l = lerCtes(conteudo);
        return { linhasLidas: l.linhas.length, recusas: l.recusas };
      }
      case "REQUISICOES": {
        const l = lerRequisicoes(conteudo);
        return { linhasLidas: l.linhas.length, recusas: l.recusas };
      }
      case "DISPONIBILIDADE_FF":
      case "DISPONIBILIDADE_VAN": {
        /* A casinha de envio é que diz a frota, e a leitura só admite as
           linhas dela: ver `frotaDaFonte` e `lerDisponibilidade`. */
        const l = lerDisponibilidade(conteudo, frotaDaFonte(tipo)!);
        return { linhasLidas: l.linhas.length, recusas: l.recusas };
      }
      case "PAGAMENTO": {
        const l = lerPagamento(conteudo);
        return {
          verbas: l.itens.length,
          linhasLidas: l.itens.length + l.descontos.length,
          /* As linhas com cara de verba que não entraram, com o texto original:
             sem o arquivo guardado, é esta a evidência de por que não entraram. */
          recusas: l.recusas,
          periodo: l.periodo,
        };
      }
      case "CONCILIACAO": {
        const l = lerConciliacao(conteudo);
        return { linhasLidas: l.itens.length, recusas: [] };
      }
    }
  } catch (erro) {
    throw new RecusaDeFechamento(
      "ARQUIVO_ILEGIVEL",
      erro instanceof Error ? erro.message : "O arquivo não pôde ser lido.",
    );
  }
}

/** Quantas linhas por INSERT. Acima disso o Postgres recusa por número de parâmetros. */
const LOTE = 500;

async function emLotes<T>(itens: T[], gravar: (lote: T[]) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < itens.length; i += LOTE) {
    await gravar(itens.slice(i, i + LOTE));
  }
}


/**
 * O retrato da viagem, do objeto lido para as colunas do banco.
 *
 * Texto vazio vira `NULL`, e número ausente continua ausente. É a mesma regra
 * do leitor, repetida aqui porque é aqui que ela vira dado gravado: `""` e `0`
 * afirmam ("a placa é vazia", "não pagou nada"); `NULL` diz que a exportação
 * não trouxe a coluna, que é a única coisa que sabemos.
 */
function retratoParaOBanco(detalhe: DetalheDaViagem | undefined) {
  const texto = (valor: string | undefined) => (valor?.trim() ? valor.trim() : null);
  const numero = (valor: number | null | undefined) =>
    valor == null ? null : String(valor);

  return {
    transportadora: texto(detalhe?.transportadora),
    cargaAtual: texto(detalhe?.cargaAtual),
    regiao: texto(detalhe?.regiao),
    veiculo: texto(detalhe?.veiculo),
    entregaOuVolume: texto(detalhe?.entregaOuVolume),
    unidadeDeOrigem: texto(detalhe?.unidadeDeOrigem),
    situacaoMultiCdd: texto(detalhe?.situacaoMultiCdd),
    veiculoCadastradoNoCdd: texto(detalhe?.veiculoCadastradoNoCdd),
    matriculaDoMotorista: texto(detalhe?.matriculaDoMotorista),
    matriculaDoAjudante1: texto(detalhe?.matriculaDoAjudante1),
    matriculaDoAjudante2: texto(detalhe?.matriculaDoAjudante2),

    veiculoIndisponivel: texto(detalhe?.veiculoIndisponivel),
    placaIndisponivel: texto(detalhe?.placaIndisponivel),
    frotaIndisponivel: texto(detalhe?.frotaIndisponivel),
    tipoDeIndisponibilidade: texto(detalhe?.tipoDeIndisponibilidade),

    ocupacao: numero(detalhe?.ocupacao),
    caixasDeRota: numero(detalhe?.caixasDeRota),
    caixasDeAs: numero(detalhe?.caixasDeAs),
    veiculoBm: numero(detalhe?.veiculoBm),
    rShow: numero(detalhe?.rShow),

    horaDeSaida: texto(detalhe?.horaDeSaida),
    horaDeEntrada: texto(detalhe?.horaDeEntrada),
    kmDeSaida: numero(detalhe?.kmDeSaida),
    kmDeEntrada: numero(detalhe?.kmDeEntrada),
    tempoInterno: texto(detalhe?.tempoInterno),
    tempoDoLaco: texto(detalhe?.tempoDoLaco),
    tempoDeDeslocamento: texto(detalhe?.tempoDeDeslocamento),
    kmDoLaco: numero(detalhe?.kmDoLaco),
    kmDeDeslocamento: numero(detalhe?.kmDeDeslocamento),

    tempoPrevisto: texto(detalhe?.tempoPrevisto),
    kmPrevisto: numero(detalhe?.kmPrevisto),

    custoSpot: numero(detalhe?.custoSpot),
    custoVariavel: numero(detalhe?.custoVariavel),
    lucro: numero(detalhe?.lucro),
    lucroUnitario: numero(detalhe?.lucroUnitario),
    tipoDeImposto: texto(detalhe?.tipoDeImposto),
    valorUnitarioPorCaixaEntregue: numero(detalhe?.valorUnitarioPorCaixaEntregue),
    valorPagoPorCaixaSemImposto: numero(detalhe?.valorPagoPorCaixaSemImposto),
    valorPagoPorCaixaComImposto: numero(detalhe?.valorPagoPorCaixaComImposto),
    valorDropdown: numero(detalhe?.valorDropdown),

    valorUnitarioDoPontoDoMotorista: numero(detalhe?.valorUnitarioDoPontoDoMotorista),
    valorUnitarioDoPontoDoAjudante: numero(detalhe?.valorUnitarioDoPontoDoAjudante),
    valorDaEquipeDeEntregaMotorista: numero(detalhe?.valorDaEquipeDeEntregaMotorista),
    valorDaEquipeDeEntregaAjudante: numero(detalhe?.valorDaEquipeDeEntregaAjudante),

    custoVariavelCedbz: numero(detalhe?.custoVariavelCedbz),
    lucroUnitarioCedbz: numero(detalhe?.lucroUnitarioCedbz),
    lucroVariavelPorCaixaEntregueFfcedbz: numero(detalhe?.lucroVariavelPorCaixaEntregueFfcedbz),
  };
}

/**
 * A viagem inteira, como o banco a guardou.
 *
 * É a mesma função para a apuração e para a tela do dia — de propósito. Duas
 * conversões da mesma linha são duas oportunidades de a tela mostrar um frete
 * e a conta somar outro; aqui a linha vira viagem uma vez só, e o que a
 * apuração soma é literalmente o que a tela exibe.
 */
function viagemGravada(linha: typeof fechamentoViagemTable.$inferSelect): Viagem {
  const numero = (v: string | null) => (v == null ? 0 : Number(v));
  return {
    linha: linha.linhaNoArquivo,
    dia: linha.dia,
    canal: linha.canal as Canal,
    frota: linha.frota as Frota,
    placa: linha.placa ?? "",
    mapa: linha.mapa ?? "",
    entregas: linha.entregas,
    caixasCarregadas: numero(linha.caixasCarregadas),
    caixasEntregues: numero(linha.caixasEntregues),
    valorFrete: numero(linha.valorFrete),
    percentualDeImposto: linha.percentualDeImposto == null ? null : Number(linha.percentualDeImposto),
    valorDeImposto: numero(linha.valorDeImposto),
    valorFaturado: numero(linha.valorFaturado),
    detalhe: retratoDoBanco(linha),
  };
}

/** O caminho de volta: a linha gravada vira o retrato que a tela do dia mostra. */
function retratoDoBanco(linha: typeof fechamentoViagemTable.$inferSelect): DetalheDaViagem {
  const texto = (valor: string | null) => valor ?? "";
  const numero = (valor: string | null) => (valor == null ? null : Number(valor));

  return {
    transportadora: texto(linha.transportadora),
    cargaAtual: texto(linha.cargaAtual),
    regiao: texto(linha.regiao),
    veiculo: texto(linha.veiculo),
    entregaOuVolume: texto(linha.entregaOuVolume),
    unidadeDeOrigem: texto(linha.unidadeDeOrigem),
    situacaoMultiCdd: texto(linha.situacaoMultiCdd),
    veiculoCadastradoNoCdd: texto(linha.veiculoCadastradoNoCdd),
    matriculaDoMotorista: texto(linha.matriculaDoMotorista),
    matriculaDoAjudante1: texto(linha.matriculaDoAjudante1),
    matriculaDoAjudante2: texto(linha.matriculaDoAjudante2),

    veiculoIndisponivel: texto(linha.veiculoIndisponivel),
    placaIndisponivel: texto(linha.placaIndisponivel),
    frotaIndisponivel: texto(linha.frotaIndisponivel),
    tipoDeIndisponibilidade: texto(linha.tipoDeIndisponibilidade),

    ocupacao: numero(linha.ocupacao),
    caixasDeRota: numero(linha.caixasDeRota),
    caixasDeAs: numero(linha.caixasDeAs),
    veiculoBm: numero(linha.veiculoBm),
    rShow: numero(linha.rShow),

    horaDeSaida: texto(linha.horaDeSaida),
    horaDeEntrada: texto(linha.horaDeEntrada),
    kmDeSaida: numero(linha.kmDeSaida),
    kmDeEntrada: numero(linha.kmDeEntrada),
    tempoInterno: texto(linha.tempoInterno),
    tempoDoLaco: texto(linha.tempoDoLaco),
    tempoDeDeslocamento: texto(linha.tempoDeDeslocamento),
    kmDoLaco: numero(linha.kmDoLaco),
    kmDeDeslocamento: numero(linha.kmDeDeslocamento),

    tempoPrevisto: texto(linha.tempoPrevisto),
    kmPrevisto: numero(linha.kmPrevisto),

    custoSpot: numero(linha.custoSpot),
    custoVariavel: numero(linha.custoVariavel),
    lucro: numero(linha.lucro),
    lucroUnitario: numero(linha.lucroUnitario),
    tipoDeImposto: texto(linha.tipoDeImposto),
    valorUnitarioPorCaixaEntregue: numero(linha.valorUnitarioPorCaixaEntregue),
    valorPagoPorCaixaSemImposto: numero(linha.valorPagoPorCaixaSemImposto),
    valorPagoPorCaixaComImposto: numero(linha.valorPagoPorCaixaComImposto),
    valorDropdown: numero(linha.valorDropdown),

    valorUnitarioDoPontoDoMotorista: numero(linha.valorUnitarioDoPontoDoMotorista),
    valorUnitarioDoPontoDoAjudante: numero(linha.valorUnitarioDoPontoDoAjudante),
    valorDaEquipeDeEntregaMotorista: numero(linha.valorDaEquipeDeEntregaMotorista),
    valorDaEquipeDeEntregaAjudante: numero(linha.valorDaEquipeDeEntregaAjudante),

    custoVariavelCedbz: numero(linha.custoVariavelCedbz),
    lucroUnitarioCedbz: numero(linha.lucroUnitarioCedbz),
    lucroVariavelPorCaixaEntregueFfcedbz: numero(linha.lucroVariavelPorCaixaEntregueFfcedbz),
  };
}

async function gravarLinhas(
  tx: Transacao,
  competenciaId: string,
  documentoId: string,
  tipo: TipoDeFonte,
  conteudo: Buffer,
): Promise<void> {
  const comum = { competenciaId, documentoId };

  switch (tipo) {
    case "OPERACAO": {
      const { linhas } = lerOperacao(conteudo);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoViagemTable).values(
          lote.map((v) => ({
            ...comum,
            linhaNoArquivo: v.linha,
            dia: v.dia,
            canal: v.canal,
            frota: v.frota,
            placa: v.placa || null,
            mapa: v.mapa || null,
            entregas: Math.round(v.entregas),
            caixasCarregadas: String(v.caixasCarregadas),
            caixasEntregues: String(v.caixasEntregues),
            valorFrete: String(v.valorFrete),
            percentualDeImposto: v.percentualDeImposto == null ? null : String(v.percentualDeImposto),
            valorDeImposto: String(v.valorDeImposto),
            valorFaturado: String(v.valorFaturado),
            ...retratoParaOBanco(v.detalhe),
          })),
        ),
      );
      return;
    }
    case "CTE": {
      const { linhas } = lerCtes(conteudo);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoCteTable).values(
          lote.map((c) => ({
            ...comum,
            linhaNoArquivo: c.linha,
            dia: c.dia,
            vbz: c.verba.vbz,
            verbaNome: c.verba.nome,
            verbaNatureza: c.verba.natureza,
            canal: c.canal,
            numero: c.numero || null,
            documento: c.documento || null,
            valorCte: String(c.valorCte),
            valorFrete: String(c.valorFrete),
            icms: String(c.icms),
            pis: String(c.pis),
            cofins: String(c.cofins),
            imposto: String(c.imposto),
            controle: c.controle || null,
          })),
        ),
      );
      return;
    }
    case "REQUISICOES": {
      const { linhas } = lerRequisicoes(conteudo);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoRequisicaoTable).values(
          lote.map((r) => ({
            ...comum,
            linhaNoArquivo: r.linha,
            numero: r.numero,
            quinzenaDePagamento: r.quinzenaDePagamento,
            canal: r.canal,
            vbz: r.verba.vbz,
            verbaNome: r.verba.nome,
            tipoDeDespesaCodigo: r.tipoDeDespesa.codigo || null,
            tipoDeDespesaNome: r.tipoDeDespesa.nome || null,
            descricao: r.descricao || null,
            status: r.status,
            valor: String(r.valor),
            solicitante: r.solicitante || null,
            aprovadorRegional: r.aprovadorRegional || null,
            aprovadorAc: r.aprovadorAC || null,
            enviadaEm: r.enviadaEm,
            decididaEm: r.decididaEm,
          })),
        ),
      );
      return;
    }
    case "DISPONIBILIDADE_FF":
    case "DISPONIBILIDADE_VAN": {
      const { linhas } = lerDisponibilidade(conteudo, frotaDaFonte(tipo)!);
      await emLotes(linhas, (lote) =>
        tx.insert(fechamentoDisponibilidadeTable).values(
          lote.map((d) => ({
            ...comum,
            linhaNoArquivo: d.linha,
            tipoDeFrota: d.tipoDeFrota,
            dia: d.dia,
            canal: d.canal,
            frotaTotal: Math.round(d.frotaTotal),
            contratada: String(d.contratada),
            realPrimeiraViagem: String(d.realPrimeiraViagem),
            realSegundaViagem: String(d.realSegundaViagem),
            gapTotal: String(d.gapTotal),
            gapDaCia: String(d.gapDaCia),
            gapDaTransportadora: d.gapDaTransportadora,
            descontoCustoFixo: String(d.descontos.custoFixo),
            descontoEquipe: String(d.descontos.equipe),
            descontoIndiretos: String(d.descontos.indiretos),
            descontoFatorAjudante: String(d.descontos.fatorAjudante),
            descontoTotal: String(d.descontos.total),
            percentualDeUtilizacao: d.percentualDeUtilizacao == null ? null : String(d.percentualDeUtilizacao),
            percentualDeDisponibilidade:
              d.percentualDeDisponibilidade == null ? null : String(d.percentualDeDisponibilidade),
          })),
        ),
      );
      return;
    }
    case "PAGAMENTO": {
      const pagamento = lerPagamento(conteudo);
      await emLotes(pagamento.itens, (lote) =>
        tx.insert(fechamentoPagamentoItemTable).values(
          lote.map((i) => ({
            ...comum,
            linhaNoArquivo: i.linha,
            canal: i.canal,
            bloco: i.bloco,
            vbz: i.verba.vbz,
            nomeNoArquivo: i.nomeNoArquivo,
            semImposto: String(i.semImposto),
            nfIss: String(i.nfIss),
            ctrcIcms: String(i.ctrcIcms),
            valorFaturado: String(i.valorFaturado),
            vlcNfIss: String(i.vlcNfIss),
            vlcCtrcIcms: String(i.vlcCtrcIcms),
          })),
        ),
      );
      if (pagamento.descontos.length > 0) {
        await tx.insert(fechamentoPagamentoDescontoTable).values(
          pagamento.descontos.map((d) => ({
            ...comum,
            linhaNoArquivo: d.linha,
            canal: d.canal,
            tipo: d.tipo,
            rotulo: d.rotulo,
            valor: String(d.valor),
            base: d.base == null ? null : String(d.base),
            percentual: d.percentual == null ? null : String(d.percentual),
          })),
        );
      }
      return;
    }
    case "CONCILIACAO": {
      const conciliacao = lerConciliacao(conteudo);
      await emLotes(conciliacao.itens, (lote) =>
        tx.insert(fechamentoConciliacaoItemTable).values(
          lote.map((i) => ({
            ...comum,
            linhaNoArquivo: i.linha,
            secao: i.secao,
            bloco: i.bloco || null,
            rubrica: i.rubrica,
            conciliado: i.conciliado,
            emitido: i.emitido == null ? null : String(i.emitido),
            calculado: i.calculado == null ? null : String(i.calculado),
          })),
        ),
      );
      /*
        Os avisos do rodapé viram itens sem valor, e não texto solto: assim a
        pendência "NF-e sem vínculo com CT-e" tem o mesmo endereço que qualquer
        outra linha do relatório e pode ser apontada pela apuração.
      */
      if (conciliacao.avisos.length > 0) {
        await tx.insert(fechamentoConciliacaoItemTable).values(
          conciliacao.avisos.map((aviso) => ({
            ...comum,
            linhaNoArquivo: 0,
            secao: "GERAL",
            bloco: "AVISO",
            rubrica: aviso,
            conciliado: null,
            emitido: null,
            calculado: null,
          })),
        );
      }
      return;
    }
  }
}

/**
 * Roda a apuração da competência **sobre o que o banco guardou**.
 *
 * Não sobre o arquivo recém-enviado: é essa escolha que garante que todo número
 * da tela tem lastro em linha gravada, com a linha física do arquivo de origem
 * ao lado.
 */
export async function apurarCompetencia(
  db: Database,
  competenciaId: string,
  por?: string | null,
): Promise<{ competencia: CompetenciaRegistrada; apuracao: Apuracao; apuracaoId: string }> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento("COMPETENCIA_NAO_ENCONTRADA", "A competência informada não existe.");
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada e não pode ser reapurada sem reabertura.`,
    );
  }

  const fontes = await lerFontesDoBanco(db, competenciaId);
  const apuracao = apurar(competencia, fontes);

  const apuracaoId = await db.transaction(async (tx) => {
    await tx
      .update(fechamentoApuracaoTable)
      .set({ vigente: false })
      .where(
        and(
          eq(fechamentoApuracaoTable.competenciaId, competenciaId),
          eq(fechamentoApuracaoTable.vigente, true),
        ),
      );

    const [gravada] = await tx
      .insert(fechamentoApuracaoTable)
      .values({
        competenciaId,
        rodadaPor: por ?? null,
        fontesPresentes: apuracao.fontesPresentes,
        fontesAusentes: apuracao.fontesAusentes,
        aliquotas: apuracao.aliquotas,
        cargaFiscal: [...apuracao.cargaFiscal].map(([canal, carga]) => ({ canal, ...carga })),
        totalEmitido: String(apuracao.totais.emitido),
        totalEsperado: String(apuracao.totais.esperado),
        totalNaoConferido: String(apuracao.totais.naoConferido),
        totalDiferenca: String(apuracao.totais.diferenca),
      })
      .returning({ id: fechamentoApuracaoTable.id });

    if (apuracao.verbas.length > 0) {
      await tx.insert(fechamentoApuracaoVerbaTable).values(
        apuracao.verbas.map((v) => ({
          apuracaoId: gravada.id,
          vbz: v.verba.vbz,
          canal: v.verba.canal,
          verbaNome: v.verba.nome,
          verbaNatureza: v.verba.natureza,
          emitido: String(v.emitido),
          baseEmitida: String(v.baseEmitida),
          documentos: v.documentos,
          esperado: v.esperado == null ? null : String(v.esperado),
          diferenca: v.diferenca == null ? null : String(v.diferenca),
          memoria: v.memoria,
        })),
      );
    }

    if (apuracao.divergencias.length > 0) {
      await tx.insert(fechamentoDivergenciaTable).values(
        apuracao.divergencias.map((d) => ({
          apuracaoId: gravada.id,
          tipo: d.tipo,
          canal: d.canal,
          titulo: d.titulo,
          valor: String(d.valor),
          onde: d.onde,
          sentido: d.sentido,
        })),
      );
    }

    await tx
      .update(fechamentoCompetenciaTable)
      .set({ apuradaEm: new Date(), estado: "APURADA" })
      .where(eq(fechamentoCompetenciaTable.id, competenciaId));

    return gravada.id;
  });

  return { competencia, apuracao, apuracaoId };
}

/** As seis fontes, reconstruídas das tabelas de linha. */
async function lerFontesDoBanco(db: Database, competenciaId: string): Promise<Fontes> {
  const presentes = await db
    .select({ tipo: fechamentoDocumentoTable.tipo })
    .from(fechamentoDocumentoTable)
    .where(
      and(
        eq(fechamentoDocumentoTable.competenciaId, competenciaId),
        eq(fechamentoDocumentoTable.vigente, true),
      ),
    );
  const tem = new Set(presentes.map((p) => p.tipo));
  const fontes: Fontes = {};
  const numero = (v: string | null) => (v == null ? 0 : Number(v));

  if (tem.has("OPERACAO")) {
    const linhas = await db
      .select()
      .from(fechamentoViagemTable)
      .where(eq(fechamentoViagemTable.competenciaId, competenciaId));
    fontes.operacao = linhas.map(viagemGravada);
  }

  if (tem.has("CTE")) {
    const linhas = await db
      .select()
      .from(fechamentoCteTable)
      .where(eq(fechamentoCteTable.competenciaId, competenciaId));
    fontes.ctes = linhas.map((c) => ({
      linha: c.linhaNoArquivo,
      dia: c.dia,
      verba: verbaGravada(c.vbz, c.canal as Canal, c.verbaNome),
      canal: c.canal as Canal,
      numero: c.numero ?? "",
      documento: c.documento ?? "",
      valorCte: numero(c.valorCte),
      valorFrete: numero(c.valorFrete),
      icms: numero(c.icms),
      pis: numero(c.pis),
      cofins: numero(c.cofins),
      imposto: numero(c.imposto),
      controle: c.controle ?? "",
    }));
  }

  if (tem.has("PAGAMENTO")) {
    const [itens, descontos] = await Promise.all([
      db
        .select()
        .from(fechamentoPagamentoItemTable)
        .where(eq(fechamentoPagamentoItemTable.competenciaId, competenciaId)),
      db
        .select()
        .from(fechamentoPagamentoDescontoTable)
        .where(eq(fechamentoPagamentoDescontoTable.competenciaId, competenciaId)),
    ]);
    /*
      O cabeçalho do arquivo — período, unidade, transportadora — não é
      regravado: ele já foi conferido contra a competência na porta de entrada
      (ver `recusarPagamentoDeOutroPeriodo`), e guardá-lo de novo criaria uma
      segunda verdade sobre de quem é a quinzena.
    */
    fontes.pagamento = {
      periodo: { inicio: null, fim: null },
      unidade: null,
      transportadora: null,
      /* Reconstrução a partir do que o banco guardou: as recusas do arquivo
         ficaram no documento (`fechamento_documento.recusas`) e não se
         reconstroem daqui — declará-las vazias diz a verdade sobre esta
         leitura, e não sobre o arquivo. */
      recusas: [],
      itens: itens.map((i) => ({
        linha: i.linhaNoArquivo,
        canal: i.canal as Canal,
        bloco: i.bloco as BlocoDoPagamento,
        verba: verbaGravada(i.vbz, i.canal as Canal, i.nomeNoArquivo),
        nomeNoArquivo: i.nomeNoArquivo,
        semImposto: numero(i.semImposto),
        nfIss: numero(i.nfIss),
        ctrcIcms: numero(i.ctrcIcms),
        valorFaturado: numero(i.valorFaturado),
        vlcNfIss: numero(i.vlcNfIss),
        vlcCtrcIcms: numero(i.vlcCtrcIcms),
      })),
      descontos: descontos.map((d) => ({
        linha: d.linhaNoArquivo,
        canal: d.canal as Canal,
        tipo: d.tipo as TipoDeDescontoDoPagamento,
        rotulo: d.rotulo,
        valor: numero(d.valor),
        base: d.base == null ? null : numero(d.base),
        percentual: d.percentual == null ? null : numero(d.percentual),
        /*
          Relido do rótulo, e não gravado numa coluna: o rótulo é o dado, e a
          VBZ é leitura dele. Uma coluna a mais seria uma segunda verdade que
          poderia divergir da frase que está do lado — e é a frase que a tela
          mostra a quem confere.
        */
        vbzDeOrigem: vbzsCitadasNoRotulo(d.rotulo, d.canal as Canal),
      })),
      totais: [],
    };
  }

  if (tem.has("REQUISICOES")) {
    const linhas = await db
      .select()
      .from(fechamentoRequisicaoTable)
      .where(eq(fechamentoRequisicaoTable.competenciaId, competenciaId));
    fontes.requisicoes = linhas.map((r) => ({
      linha: r.linhaNoArquivo,
      numero: r.numero,
      quinzenaDePagamento: r.quinzenaDePagamento,
      canal: r.canal as Canal,
      verba: verbaGravada(r.vbz, r.canal as Canal, r.verbaNome),
      tipoDeDespesa: { codigo: r.tipoDeDespesaCodigo ?? "", nome: r.tipoDeDespesaNome ?? "" },
      descricao: r.descricao ?? "",
      status: r.status,
      valor: numero(r.valor),
      solicitante: r.solicitante ?? "",
      aprovadorRegional: r.aprovadorRegional ?? "",
      aprovadorAC: r.aprovadorAc ?? "",
      enviadaEm: r.enviadaEm,
      decididaEm: r.decididaEm,
    }));
  }

  /* Basta uma das duas casinhas ter chegado: a tabela é uma só, e a leitura
     traz as linhas das frotas que existirem. */
  if (tem.has("DISPONIBILIDADE_FF") || tem.has("DISPONIBILIDADE_VAN")) {
    const linhas = await db
      .select()
      .from(fechamentoDisponibilidadeTable)
      .where(eq(fechamentoDisponibilidadeTable.competenciaId, competenciaId));
    fontes.disponibilidade = linhas.map((d) => ({
      linha: d.linhaNoArquivo,
      aba: d.tipoDeFrota,
      tipoDeFrota: d.tipoDeFrota as TipoDeFrotaContratada,
      dia: d.dia,
      canal: d.canal as Canal,
      frotaTotal: d.frotaTotal,
      contratada: numero(d.contratada),
      realPrimeiraViagem: numero(d.realPrimeiraViagem),
      realSegundaViagem: numero(d.realSegundaViagem),
      gapTotal: numero(d.gapTotal),
      gapDaCia: numero(d.gapDaCia),
      gapDaTransportadora: (d.gapDaTransportadora ?? {}) as {
        frotaCancelada: number;
        outrosCancelados: number;
        frotaNaoCancelada: number;
        outrosNaoCancelados: number;
      },
      descontos: {
        custoFixo: numero(d.descontoCustoFixo),
        equipe: numero(d.descontoEquipe),
        indiretos: numero(d.descontoIndiretos),
        fatorAjudante: numero(d.descontoFatorAjudante),
        total: numero(d.descontoTotal),
      },
      percentualDeUtilizacao: d.percentualDeUtilizacao == null ? null : Number(d.percentualDeUtilizacao),
      percentualDeDisponibilidade:
        d.percentualDeDisponibilidade == null ? null : Number(d.percentualDeDisponibilidade),
    }));
  }

  if (tem.has("CONCILIACAO")) {
    const linhas = await db
      .select()
      .from(fechamentoConciliacaoItemTable)
      .where(eq(fechamentoConciliacaoItemTable.competenciaId, competenciaId));
    fontes.conciliacao = {
      transportadora: null,
      unidade: null,
      periodo: { inicio: null, fim: null },
      opcao: null,
      itens: linhas
        .filter((i) => i.bloco !== "AVISO")
        .map((i) => ({
          linha: i.linhaNoArquivo,
          secao: i.secao as Canal | "GERAL",
          bloco: i.bloco ?? "",
          rubrica: i.rubrica,
          conciliado: (i.conciliado as "S" | "N" | null) ?? null,
          emitido: i.emitido == null ? null : Number(i.emitido),
          calculado: i.calculado == null ? null : Number(i.calculado),
        })),
      avisos: linhas.filter((i) => i.bloco === "AVISO").map((i) => i.rubrica),
    };
  }

  return fontes;
}

/**
 * A verba de uma linha gravada.
 *
 * O catálogo é a autoridade; o nome gravado só entra quando o catálogo não
 * conhece a VBZ — que é o caso de uma verba nova que a Ambev criou depois deste
 * deploy. Preferir o catálogo é o que faz uma correção nele valer para as
 * competências já importadas sem reimportar nada.
 */
function verbaGravada(vbz: number, canal: Canal, nomeGravado: string): Verba {
  return verbaDe(vbz) ?? verbaDesconhecida(vbz, canal, nomeGravado);
}

/**
 * Os documentos de uma competência, com o que cada leitor recusou.
 *
 * **`verbas` conta o que o 03.08.20 de fato sustenta**, e existe porque
 * `linhasLidas` não responde a pergunta que a tela faz. Ele soma verbas e
 * descontos: um demonstrativo do qual o leitor tirou catorze descontos e
 * nenhuma verba aparecia como "14 linhas", com visto verde, ao lado de um
 * painel que dizia não ter de onde sair. Os dois liam o mesmo banco e diziam
 * coisas opostas, e quem opera não tinha como saber qual acreditar.
 *
 * `null` nas outras cinco fontes — a pergunta é do demonstrativo, e responder
 * `0` para quem não tem verba nenhuma a ter seria inventar um alarme.
 */
export async function listarDocumentos(
  db: Database,
  competenciaId: string,
): Promise<
  {
    id: string;
    tipo: TipoDeFonte;
    nomeDoArquivo: string;
    linhasLidas: number;
    recusas: Recusa[];
    vigente: boolean;
    enviadoEm: Date;
    /** Quantas verbas este documento gravou. Só o 03.08.20 tem verbas. */
    verbas: number | null;
  }[]
> {
  const linhas = await db
    .select()
    .from(fechamentoDocumentoTable)
    .where(eq(fechamentoDocumentoTable.competenciaId, competenciaId))
    .orderBy(desc(fechamentoDocumentoTable.enviadoEm));

  const pagamentos = linhas.filter((d) => d.tipo === "PAGAMENTO").map((d) => d.id);
  const verbasPorDocumento = new Map<string, number>();
  if (pagamentos.length > 0) {
    const contagens = await db
      .select({
        documentoId: fechamentoPagamentoItemTable.documentoId,
        quantas: sql<number>`count(*)::int`,
      })
      .from(fechamentoPagamentoItemTable)
      .where(inArray(fechamentoPagamentoItemTable.documentoId, pagamentos))
      .groupBy(fechamentoPagamentoItemTable.documentoId);
    for (const c of contagens) verbasPorDocumento.set(c.documentoId, c.quantas);
  }

  return linhas.map((d) => ({
    id: d.id,
    tipo: d.tipo as TipoDeFonte,
    nomeDoArquivo: d.nomeDoArquivo,
    linhasLidas: d.linhasLidas,
    recusas: (d.recusas ?? []) as Recusa[],
    vigente: d.vigente,
    enviadoEm: d.enviadoEm,
    /* Sem linha na contagem é zero, e não ausência: o documento existe e o
       `group by` só não teve o que contar dele. */
    verbas: d.tipo === "PAGAMENTO" ? (verbasPorDocumento.get(d.id) ?? 0) : null,
  }));
}

/** A apuração vigente de uma competência, como o banco a guardou. */
export async function lerApuracaoVigente(
  db: Database,
  competenciaId: string,
): Promise<{
  id: string;
  rodadaEm: Date;
  fontesPresentes: TipoDeFonte[];
  fontesAusentes: TipoDeFonte[];
  aliquotas: unknown;
  cargaFiscal: unknown;
  totais: { emitido: number; esperado: number; naoConferido: number; diferenca: number };
  verbas: {
    vbz: number;
    canal: string;
    nome: string;
    natureza: string;
    emitido: number;
    baseEmitida: number;
    documentos: number;
    esperado: number | null;
    diferenca: number | null;
    memoria: Parcela[];
  }[];
  divergencias: {
    id: string;
    tipo: string;
    canal: string;
    titulo: string;
    valor: number;
    onde: string;
    sentido: string;
    desfecho: string;
  }[];
} | null> {
  const [apuracao] = await db
    .select()
    .from(fechamentoApuracaoTable)
    .where(
      and(
        eq(fechamentoApuracaoTable.competenciaId, competenciaId),
        eq(fechamentoApuracaoTable.vigente, true),
      ),
    )
    .limit(1);
  if (!apuracao) return null;

  const verbas = await db
    .select()
    .from(fechamentoApuracaoVerbaTable)
    .where(eq(fechamentoApuracaoVerbaTable.apuracaoId, apuracao.id))
    .orderBy(fechamentoApuracaoVerbaTable.vbz);

  const divergencias = await db
    .select()
    .from(fechamentoDivergenciaTable)
    .where(eq(fechamentoDivergenciaTable.apuracaoId, apuracao.id))
    .orderBy(desc(sql`abs(${fechamentoDivergenciaTable.valor})`));

  return {
    id: apuracao.id,
    rodadaEm: apuracao.rodadaEm,
    fontesPresentes: apuracao.fontesPresentes as TipoDeFonte[],
    fontesAusentes: apuracao.fontesAusentes as TipoDeFonte[],
    aliquotas: apuracao.aliquotas,
    cargaFiscal: apuracao.cargaFiscal,
    totais: {
      emitido: Number(apuracao.totalEmitido),
      esperado: Number(apuracao.totalEsperado),
      naoConferido: Number(apuracao.totalNaoConferido),
      diferenca: Number(apuracao.totalDiferenca),
    },
    verbas: verbas.map((v) => ({
      vbz: v.vbz,
      canal: v.canal,
      nome: v.verbaNome,
      natureza: v.verbaNatureza,
      emitido: Number(v.emitido),
      baseEmitida: Number(v.baseEmitida),
      documentos: v.documentos,
      esperado: v.esperado == null ? null : Number(v.esperado),
      diferenca: v.diferenca == null ? null : Number(v.diferenca),
      memoria: (v.memoria ?? []) as Parcela[],
    })),
    divergencias: divergencias.map((d) => ({
      id: d.id,
      tipo: d.tipo,
      canal: d.canal,
      titulo: d.titulo,
      valor: Number(d.valor),
      onde: d.onde,
      sentido: d.sentido,
      desfecho: d.desfecho,
    })),
  };
}

/* ===========================================================================
 * O diário: a operação da competência, dia a dia
 * ======================================================================== */

/** O 2Art vigente da competência — de onde o diário saiu. */
export interface FonteDoDiario {
  nomeDoArquivo: string;
  linhasLidas: number;
  enviadoEm: Date;
}

export interface DiarioDaCompetencia {
  competencia: CompetenciaRegistrada;
  /** `null` quando o 2Art ainda não foi enviado — e aí a grade nasce vazia. */
  fonte: FonteDoDiario | null;
  dias: DiaDaOperacao[];
  /**
   * Viagens do 2Art que caíram fora do período, contadas e nunca somadas.
   *
   * O 2Art é exportado por mês e a competência é meio mês: metade do arquivo
   * pertence à outra quinzena. Este número existe para que "o arquivo tem 949
   * linhas e a grade mostra 480 viagens" tenha resposta na própria tela, em vez
   * de virar desconfiança sobre a importação.
   */
  viagensForaDoPeriodo: number;
}

export interface DiaDaCompetencia {
  competencia: CompetenciaRegistrada;
  fonte: FonteDoDiario | null;
  dia: DiaAberto;
}

/** O 2Art vigente, quando há um. */
async function fonteDaOperacao(db: Database, competenciaId: string): Promise<FonteDoDiario | null> {
  const [documento] = await db
    .select({
      nomeDoArquivo: fechamentoDocumentoTable.nomeDoArquivo,
      linhasLidas: fechamentoDocumentoTable.linhasLidas,
      enviadoEm: fechamentoDocumentoTable.enviadoEm,
    })
    .from(fechamentoDocumentoTable)
    .where(
      and(
        eq(fechamentoDocumentoTable.competenciaId, competenciaId),
        eq(fechamentoDocumentoTable.tipo, "OPERACAO"),
        eq(fechamentoDocumentoTable.vigente, true),
      ),
    )
    .limit(1);
  return documento ?? null;
}

/**
 * A grade de dias da competência — o que a tela abre antes de escolher um dia.
 *
 * Lê as viagens gravadas, e não o arquivo: é a mesma garantia da apuração — o
 * número que a tela mostra é um número que o banco sustenta, com a linha física
 * do 2Art do lado. Sem competência, `null`; sem 2Art, a grade vem inteira com
 * zero viagens em cada dia, que é a resposta honesta a "o que rodou no dia 3"
 * quando ninguém importou a operação ainda.
 */
export async function lerDiarioDaCompetencia(
  db: Database,
  competenciaId: string,
): Promise<DiarioDaCompetencia | null> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) return null;

  const [fonte, linhas] = await Promise.all([
    fonteDaOperacao(db, competenciaId),
    db.select().from(fechamentoViagemTable).where(eq(fechamentoViagemTable.competenciaId, competenciaId)),
  ]);

  const viagens = linhas.map(viagemGravada);
  const dias = diasDaCompetencia(competencia, viagens);
  const noPeriodo = dias.reduce((s, d) => s + d.totais.viagens, 0);

  return {
    competencia,
    fonte,
    dias,
    viagensForaDoPeriodo: viagens.length - noPeriodo,
  };
}

/**
 * Um dia aberto: as viagens daquele dia, inteiras.
 *
 * O filtro por dia é do banco (índice `fechamento_viagem_por_competencia`, que
 * já abre por competência e dia) e não da memória: a tela do dia é a que se
 * abre e fecha dezenas de vezes numa conferência, e trazer a quinzena inteira
 * para escolher um dia seria pagar quinze vezes o que se vai ler uma.
 *
 * `null` quando a competência não existe **ou** quando o dia está fora dela —
 * as duas coisas são a mesma para quem pergunta: não há esse dia aqui.
 */
export async function lerDiaDaCompetencia(
  db: Database,
  competenciaId: string,
  dia: string,
): Promise<DiaDaCompetencia | null> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) return null;
  if (!dentroDaCompetencia(competencia, dia)) return null;

  const [fonte, linhas] = await Promise.all([
    fonteDaOperacao(db, competenciaId),
    db
      .select()
      .from(fechamentoViagemTable)
      .where(
        and(
          eq(fechamentoViagemTable.competenciaId, competenciaId),
          eq(fechamentoViagemTable.dia, dia),
        ),
      ),
  ]);

  return { competencia, fonte, dia: abrirDia(dia, linhas.map(viagemGravada)) };
}

/**
 * O resumo de uma competência: o que a tela de Apurações mostra numa linha.
 *
 * É a competência somada, não a competência inteira. Nada aqui abre a memória
 * de cálculo — para isso existe a tela de dentro —, e nada aqui é recalculado:
 * `emitido` e `naoConferido` são os totais que a apuração gravou quando rodou,
 * e não uma soma refeita agora. Um número que muda entre a lista e o detalhe
 * seria pior do que não ter lista.
 */
export interface ResumoDeApuracao {
  competencia: CompetenciaRegistrada;
  /** As fontes com documento vigente. O `4/5` da tela sai daqui. */
  relatorios: TipoDeFonte[];
  /** Nulo enquanto a competência não apurou. Nulo não é zero. */
  apuracao: {
    rodadaEm: Date;
    emitido: number;
    naoConferido: number;
    diferenca: number;
    /**
     * O que há em discussão: a soma, **em módulo**, das divergências
     * acionáveis que ainda não tiveram desfecho.
     *
     * Em módulo porque as duas direções são pergunta — o que falta receber e o
     * que se recebeu a mais. Somá-las com sinal deixaria uma abater a outra e
     * devolveria um número menor do que o que está de fato em aberto, que é o
     * oposto do que a coluna promete.
     *
     * Ficam de fora as informativas, que não pedem resposta, e as que já foram
     * aceitas ou resolvidas, que deixaram de ser pergunta. Uma em contestação
     * continua contando: contestar é justamente estar questionando.
     */
    aQuestionar: number;
    /** Quantas divergências sustentam esse valor. */
    aQuestionarQuantidade: number;
  } | null;
}

/**
 * O resumo de todas as competências, da mais recente para a mais antiga.
 *
 * **Por que existe, em vez de a tela somar.** A alternativa seria a lista
 * chamar `GET /competencias/:id` uma vez por competência e montar o resumo no
 * navegador: N+1 idas ao banco numa tela que existe justamente para olhar
 * todas de uma vez, com o total da quinzena aparecendo só depois da última
 * resposta. Aqui são quatro consultas de tamanho fixo, e o custo não cresce
 * com o número de competências.
 *
 * **Por que quatro consultas e não um `join` só.** Documentos e divergências
 * são muitos-para-um em relação à competência; um `join` das duas multiplicaria
 * as linhas uma pela outra e as somas sairiam infladas. Agregar cada lado no
 * banco e cruzar por `id` na memória é a forma que não tem esse erro.
 */
export async function listarApuracoes(db: Database): Promise<ResumoDeApuracao[]> {
  const competencias = await listarCompetencias(db);
  if (competencias.length === 0) return [];

  const [documentos, apuracoes, questoes] = await Promise.all([
    db
      .select({
        competenciaId: fechamentoDocumentoTable.competenciaId,
        tipo: fechamentoDocumentoTable.tipo,
      })
      .from(fechamentoDocumentoTable)
      .where(eq(fechamentoDocumentoTable.vigente, true)),
    db
      .select({
        id: fechamentoApuracaoTable.id,
        competenciaId: fechamentoApuracaoTable.competenciaId,
        rodadaEm: fechamentoApuracaoTable.rodadaEm,
        totalEmitido: fechamentoApuracaoTable.totalEmitido,
        totalNaoConferido: fechamentoApuracaoTable.totalNaoConferido,
        totalDiferenca: fechamentoApuracaoTable.totalDiferenca,
      })
      .from(fechamentoApuracaoTable)
      .where(eq(fechamentoApuracaoTable.vigente, true)),
    db
      .select({
        apuracaoId: fechamentoDivergenciaTable.apuracaoId,
        soma: sql<string>`coalesce(sum(abs(${fechamentoDivergenciaTable.valor})), 0)`,
        quantidade: sql<number>`count(*)::int`,
      })
      .from(fechamentoDivergenciaTable)
      .where(
        and(
          notInArray(fechamentoDivergenciaTable.sentido, ["INFORMATIVO"]),
          notInArray(fechamentoDivergenciaTable.desfecho, ["ACEITA", "RESOLVIDA"]),
        ),
      )
      .groupBy(fechamentoDivergenciaTable.apuracaoId),
  ]);

  const recebidos = new Map<string, Set<string>>();
  for (const d of documentos) {
    const tipos = recebidos.get(d.competenciaId) ?? new Set<string>();
    tipos.add(d.tipo);
    recebidos.set(d.competenciaId, tipos);
  }
  const apuracaoDa = new Map(apuracoes.map((a) => [a.competenciaId, a]));
  const questaoDa = new Map(questoes.map((q) => [q.apuracaoId, q]));

  return competencias.map((competencia) => {
    const tipos = recebidos.get(competencia.id);
    const apuracao = apuracaoDa.get(competencia.id);
    const questao = apuracao ? questaoDa.get(apuracao.id) : undefined;
    return {
      competencia,
      // Na ordem do catálogo, e não na de chegada: as casinhas da linha
      // ficam sempre no mesmo lugar, e a que falta é reconhecida pela posição.
      relatorios: TIPOS_DE_FONTE.filter((tipo) => tipos?.has(tipo) ?? false),
      apuracao: apuracao
        ? {
            rodadaEm: apuracao.rodadaEm,
            emitido: Number(apuracao.totalEmitido),
            naoConferido: Number(apuracao.totalNaoConferido),
            diferenca: Number(apuracao.totalDiferenca),
            aQuestionar: Number(questao?.soma ?? 0),
            aQuestionarQuantidade: questao?.quantidade ?? 0,
          }
        : null,
    };
  });
}

/**
 * O mês inteiro — as duas quinzenas lado a lado, com o total.
 *
 * É a leitura que responde à pergunta mensal, que é a que a transportadora
 * discute com a Ambev: a apuração tem grão de quinzena, e o documento que se
 * negocia tem grão de mês. Sem ela, comparar com a planilha exigia abrir duas
 * telas e somar à mão.
 *
 * **Nada é recalculado aqui.** As verbas vêm da apuração vigente de cada
 * quinzena, como ela foi gravada; a coluna do demonstrativo vem da soma de
 * `valor_faturado` dos itens do 03.08.20, que é como o próprio relatório fecha
 * o `Total Remuneração`. Rodar a apuração de novo para montar um resumo faria o
 * total do mês divergir do total que cada quinzena mostra — pelo mesmo motivo
 * pelo qual a apuração é gravada e não recalculada a cada leitura.
 *
 * **O mês sem competência nenhuma não é erro.** Devolve o resumo vazio, com as
 * duas quinzenas nomeadas e ausentes: é a resposta certa para "ainda não
 * importei nada", e é diferente de "a unidade não existe".
 */
export async function lerResumoDoMes(
  db: Database,
  alvo: {
    unidade: string;
    transportadora: string;
    /**
     * `EMPURRADA`, `ROTA` — obrigatório desde a `0046`.
     *
     * O resumo tem **uma coluna por quinzena**, e a quádrupla da competência
     * passou a permitir duas por quinzena: EMPURRADA e ROTA. Sem este recorte
     * as duas cairiam na mesma coluna e o mês somaria duas operações num total
     * só — que é exatamente a verdade misturada que a `0046` existe para
     * desfazer, reaparecendo uma camada acima.
     *
     * Obrigatório e não opcional-com-padrão: um padrão aqui escolheria em
     * silêncio de qual operação é o número que a tela mostra.
     *
     * **Não confundir com o `canal` que a porta do cadastro pergunta**, que é o
     * `ROTA` | `AS` de `dominio.ts`. As duas palavras colidem em `ROTA` e são
     * eixos diferentes: este diz qual operação da unidade está sendo fechada;
     * aquele, como as verbas dela se agregam.
     */
    tipoDeOperacao: string;
    ano: number;
    mes: number;
  },
  /**
   * Quem responde pelo contrato do período.
   *
   * O padrão é {@link SEM_CADASTRO}, que responde `null` a tudo — e aí a tela se
   * comporta exatamente como antes desta porta existir. Quando o módulo de
   * cadastro entrar, é ele que passa por aqui, e o painel do devido se enche
   * sozinho. Ver `cadastro-porta.ts`.
   */
  cadastro: FonteDeCadastro = SEM_CADASTRO,
): Promise<ResumoDoMes> {
  const competencias = await db
    .select()
    .from(fechamentoCompetenciaTable)
    .where(
      and(
        eq(fechamentoCompetenciaTable.unidadeCodigo, alvo.unidade),
        eq(fechamentoCompetenciaTable.transportadoraCodigo, alvo.transportadora),
        eq(fechamentoCompetenciaTable.tipoDeOperacao, alvo.tipoDeOperacao),
        eq(fechamentoCompetenciaTable.ano, alvo.ano),
        eq(fechamentoCompetenciaTable.mes, alvo.mes),
      ),
    );

  /*
    A disponibilidade é do **mês**, e por isso é lida uma vez, fora do laço, das
    competências todas. Ver `disponibilidadeDoMes`.
  */
  const dispDoMesPorCanal = new Map<Canal, DescontoDeDisponibilidadeDoMes | null>();
  for (const canal of CANAIS_COM_PAINEL) {
    dispDoMesPorCanal.set(canal, await disponibilidadeDoMes(db, competencias, canal));
  }

  /*
    Que relatórios cada competência recebeu — da tabela de documentos, e não do
    retrato que a apuração guardou.

    A diferença importa e já mordeu: o painel desta tela é montado de leitura
    viva (viagens, de-para, requisições), então um arquivo enviado **depois** da
    última apuração já entra na conta. Lendo `apuracao.fontesPresentes`, a tela
    diria que falta um relatório que ela mesma acabou de usar.

    Só o vigente conta: um documento substituído continua na tabela e não é o
    que a conta leu.
  */
  const recebidasPorCompetencia = new Map<string, TipoDeFonte[]>();
  if (competencias.length > 0) {
    const documentos = await db
      .select({
        competenciaId: fechamentoDocumentoTable.competenciaId,
        tipo: fechamentoDocumentoTable.tipo,
      })
      .from(fechamentoDocumentoTable)
      .where(
        and(
          inArray(
            fechamentoDocumentoTable.competenciaId,
            competencias.map((c) => c.id),
          ),
          eq(fechamentoDocumentoTable.vigente, true),
        ),
      );
    for (const d of documentos) {
      const lista = recebidasPorCompetencia.get(d.competenciaId) ?? [];
      if (!lista.includes(d.tipo as TipoDeFonte)) lista.push(d.tipo as TipoDeFonte);
      recebidasPorCompetencia.set(d.competenciaId, lista);
    }
  }

  const quinzenas: QuinzenaApurada[] = [];
  for (const c of competencias) {
    const [apuracao, demonstrativo, descontos, requisicoes, paineis] = await Promise.all([
      lerApuracaoVigente(db, c.id),
      somarDemonstrativo(db, c.id),
      somarDescontosDoDemonstrativo(db, c.id),
      /* O 03.08.12.09, que fecha o quadro de outros custos do devido. */
      requisicoesDaCompetencia(db, c.id),
      /*
        O painel entra aqui, e não numa segunda chamada da tela, porque a
        pergunta é a mesma: o mês nas três colunas. Duas idas ao servidor para
        montar uma página fariam as duas metades chegarem em momentos
        diferentes — e é justamente entre elas que se fica indo e voltando.
      */
      Promise.all(
        CANAIS_COM_PAINEL.map((canal) => lerDeParaDaCompetencia(db, c.id, { canal })),
      ).then((lidos) => {
        const existentes = lidos.filter((p): p is DeParaConferido => p !== null);
        return existentes.length > 0 ? existentes : null;
      }),
    ]);
    /*
      O devido: o contrato da quinzena mais as viagens dela. Roda por canal,
      porque a frota contratada é por canal — e roda **depois** das quatro
      leituras acima porque depende das bases que elas trazem.
    */
    const calculados: { canal: Canal; mapa: ReturnType<typeof montarMapaDaQuinzena> }[] = [];
    const diagnosticoDoCadastro: { canal: Canal; diagnostico: DiagnosticoDoCadastro }[] = [];
    let cadastroUsado: { cadastroId: string; vigenteDe: string } | null = null;
    for (const canal of CANAIS_COM_PAINEL) {
      const leitura = await cadastro.resolver({
        /* A identidade canônica, quando a competência já a tem. Ver a porta. */
        unidadeId: c.unidadeId ?? null,
        unidadeCodigo: c.unidadeCodigo,
        transportadoraCodigo: c.transportadoraCodigo,
        canal,
        inicio: String(c.inicio),
        fim: String(c.fim),
      });
      /*
        O diagnóstico entra **sempre**, inclusive quando o cadastro respondeu:
        é ele que a tela usa para dizer de qual vigência o devido saiu e quais
        opcionais entraram como zero. Guardá-lo só na falha faria a tela ter
        explicação para o que deu errado e nenhuma para o que deu certo.
      */
      diagnosticoDoCadastro.push({ canal, diagnostico: leitura.diagnostico });
      const contrato = leitura.resposta;
      if (!contrato) continue;
      cadastroUsado = { cadastroId: contrato.cadastroId, vigenteDe: contrato.vigenteDe };
      const viagens = await viagensPorDia(db, c, canal);
      calculados.push({
        canal,
        mapa: montarMapaDaQuinzena({
          quinzena: c.quinzena === 1 ? 1 : 2,
          parametros: contrato.parametros,
          variavel: somarVariavel(
            viagens,
            contrato.parametros,
            contrato.custoVariavelPrevistoPor25Viagens,
          ),
          bases: basesDaQuinzena(descontos, canal, viagens, requisicoes, {
            quinzena: c.quinzena === 1 ? 1 : 2,
            disponibilidadeDoMes: dispDoMesPorCanal.get(canal) ?? null,
          }),
        }),
      });
    }

    quinzenas.push({
      quinzena: c.quinzena === 1 ? 1 : 2,
      competenciaId: c.id,
      chave: c.chave,
      estado: c.estado,
      /* A competência existe: o que ela não recebeu é lista vazia, não ignorância. */
      fontesRecebidas: recebidasPorCompetencia.get(c.id) ?? [],
      calculados: calculados.length > 0 ? calculados : null,
      cadastroUsado,
      diagnosticoDoCadastro,
      verbas:
        apuracao?.verbas.map((v) => ({
          vbz: v.vbz,
          canal: v.canal,
          nome: v.nome,
          natureza: v.natureza,
          emitido: v.emitido,
          esperado: v.esperado,
        })) ?? null,
      demonstrativo,
      descontos,
      paineis,
    });
  }

  const qualquer = competencias[0];
  return montarResumo({
    ano: alvo.ano,
    mes: alvo.mes,
    unidade: { codigo: alvo.unidade, nome: qualquer?.unidadeNome ?? null },
    transportadora: { codigo: alvo.transportadora, nome: qualquer?.transportadoraNome ?? null },
    quinzenas,
  });
}

/**
 * As viagens da competência, agrupadas por dia — a forma que o motor consome.
 *
 * O agrupamento por dia não é cosmético: `somarVariavel` calcula o valor padrão
 * do veículo com a fatia de emissão **do próprio dia**, e uma lista achatada
 * daria outro número. É a mesma disciplina do `Mapa Rota`, que tem uma coluna
 * por dia justamente por isso.
 */
/**
 * As viagens de uma competência, agrupadas por dia — só as **do período dela**.
 *
 * **O corte por data não é redundante com o `competenciaId`, e a falta dele
 * misturava quinzena.** O 2Art é exportado por mês e a competência é meio mês;
 * a importação grava o arquivo inteiro, de propósito (ver
 * `recusarOperacaoDeOutroPeriodo`, que só recusa quando **nenhuma** linha é do
 * período — metade cair fora é o normal). Quem lê é que precisa cortar.
 *
 * A apuração sempre cortou (`resumirOperacao`, em `apuracao.ts`); esta leitura,
 * que é a que alimenta o painel Devido × Demonstrado, não cortava. Um 2Art
 * mensal enviado à 1ª quinzena fazia o `CUSTO VARIÁVEL` e a `INDISPONIBILIDADE`
 * dela somarem os trinta e um dias — com o `DESCONTO` da mesma tela vindo do
 * 03.08.20, que é guardado pelo período (`recusarPagamentoDeOutroPeriodo`) e
 * traz só a quinzena. Metade da linha via o mês e a outra metade via a quinzena.
 *
 * O corte é no SQL, e não depois: linha que não entra na conta não precisa
 * atravessar a rede.
 */
async function viagensPorDia(
  db: Database,
  competencia: { id: string; inicio: string; fim: string },
  canal: Canal,
): Promise<{ viagens: ViagemDoMapa[] }[]> {
  const linhas = await db
    .select({
      dia: fechamentoViagemTable.dia,
      frota: fechamentoViagemTable.frota,
      cargaAtual: fechamentoViagemTable.cargaAtual,
      tipoDeImposto: fechamentoViagemTable.tipoDeImposto,
      valorFaturado: fechamentoViagemTable.valorFaturado,
      /*
        Separam a viagem da Rota da viagem de AS — e só **juntas**: `CxRota = 0`
        sozinho confunde a viagem de AS com a viagem de Rota que rodou vazia.
        Ver `ehDaRota` no motor.
      */
      caixasDeRota: fechamentoViagemTable.caixasDeRota,
      caixasDeAs: fechamentoViagemTable.caixasDeAs,
      /* A marca que faz a viagem entrar na linha `INDISPONIBILIDADE` do fixo. */
      tipoDeIndisponibilidade: fechamentoViagemTable.tipoDeIndisponibilidade,
    })
    .from(fechamentoViagemTable)
    .where(
      and(
        eq(fechamentoViagemTable.competenciaId, competencia.id),
        eq(fechamentoViagemTable.canal, canal),
        /* Ver o bloco acima: o `competenciaId` não basta. */
        gte(fechamentoViagemTable.dia, competencia.inicio),
        lte(fechamentoViagemTable.dia, competencia.fim),
      ),
    );

  const porDia = new Map<string, ViagemDoMapa[]>();
  for (const l of linhas) {
    const dia = String(l.dia);
    const doDia = porDia.get(dia) ?? [];
    doDia.push({
      frota: l.frota ?? "",
      cargaAtual: l.cargaAtual ?? "",
      tipoDeImposto: l.tipoDeImposto ?? "",
      valorFaturado: Number(l.valorFaturado ?? 0),
      /* `null` atravessa: coluna ausente não é "carregou zero caixa de Rota". */
      caixasDeRota: l.caixasDeRota === null ? null : Number(l.caixasDeRota),
      caixasDeAs: l.caixasDeAs === null ? null : Number(l.caixasDeAs),
      tipoDeIndisponibilidade: l.tipoDeIndisponibilidade ?? "",
    });
    porDia.set(dia, doDia);
  }
  /* Na ordem do calendário — o motor soma, mas quem lê um log espera a ordem. */
  return [...porDia.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, viagens]) => ({ viagens }));
}

/**
 * As bases sem imposto que o motor desconta, montadas do que o banco tem.
 *
 * **Nenhuma delas é inventada, e as que não têm origem ficam `null`.** A
 * planilha traz as três digitadas à mão, sem fórmula que as derive (ver
 * `docs/MAPA-ROTA.md`); aqui elas só aparecem quando um documento as sustenta.
 * As que não têm documento saem `null`, o quadro sai `null` e a tela diz o que
 * falta — que é a resposta honesta, e a que impede o produto de repetir um
 * número que ninguém sabe justificar.
 *
 * **As três do quadro fixo saem do 03.08.20**: a devolução, a soma dos quatro
 * descontos de disponibilidade e o frete mínimo. Que a planilha as digite em vez
 * de lê-las é escolha dela; que os valores coincidam ao centavo em julho/2026 é
 * o que autoriza esta leitura.
 *
 * **As duas que ficavam permanentemente `null` agora têm fonte, e nenhuma delas
 * é o 03.08.20.** Eram as únicas duas linhas conhecidas do painel condenadas a
 * não ter devido por decisão nossa, e não por falta de documento:
 *
 * - a **indisponibilidade** sai do **2Art** — o faturado das viagens de Rota com
 *   marca em `TipoIndisp`, que é o que `Mapa Rota!132` soma da coluna `BP` das
 *   abas diárias. Não é, e não pode virar, o `DESCONTO DISPONIBILIDADE` do
 *   03.08.20: aquele é abatimento e já está declarado na linha de desconto;
 * - os **outros custos** saem do **03.08.12.09** — a soma sem imposto das
 *   requisições aprovadas do canal, que é a origem que `Outros Custos!F4`
 *   declara.
 *
 * As duas passam a receber o banco por parâmetro, e é por isso que esta função
 * virou assíncrona: a requisição é uma consulta, e fingir que não é obrigaria
 * quem chama a montá-la fora e passá-la — espalhando a regra de qual status paga
 * por dois arquivos.
 */

/**
 * O desconto de disponibilidade do **mês**, lido competência por competência.
 *
 * **Por que a soma é do mês.** O desconto do 03.08.18 é acumulado no mês
 * inteiro e aplicado uma vez, no fechamento da 2ª quinzena (ver
 * `descontoDeDisponibilidadeDoMes`, em `leitores/disponibilidade.ts`). A tabela
 * é por competência, que é meia; somar uma competência só daria metade do
 * desconto.
 *
 * **Por que cada competência é lida no próprio período.** Esta função já lia as
 * duas competências, mas com **um** intervalo — de min(início) a max(fim), ou
 * seja, o mês inteiro para as duas. Um 03.08.18 mensal anexado à 1ª quinzena
 * entrava com os trinta e um dias, o da 2ª também, e as duas remessas se
 * sobrepunham em cada dia do mês. Quem resolvia a sobreposição era a
 * desduplicação por `(aba, dia)` de `descontoDeDisponibilidadeDoMes`, que
 * escolhe a **primeira** linha que vê: com duas emissões diferentes do mesmo
 * relatório, o total do mês passava a depender da ordem em que o banco
 * devolveu as linhas.
 *
 * Cortando cada competência pelo seu período, a sobreposição some na origem: a
 * 1ª quinzena contribui com os dias 1 a 15 do que recebeu, a 2ª com os dias 16
 * ao fim do que recebeu, e a mesma linha não pode entrar duas vezes. O total do
 * mês fica igual quer o relatório chegue partido, inteiro nas duas, ou inteiro
 * numa só — e deixa de depender de sorteio.
 *
 * A desduplicação continua onde está, como rede: ela ainda protege contra duas
 * remessas do 03.08.18 dentro da **mesma** competência, e agora, quando as duas
 * discordam do valor de um dia, ela recusa em vez de escolher.
 *
 * Exportada porque é o corte que precisa de prova com banco: ele é `WHERE`, e
 * um `WHERE` só se exercita consultando. `persistencia.test.ts` a chama com o
 * mesmo arquivo mensal nas duas competências, que é o caso que dobrava.
 */
export async function disponibilidadeDoMes(
  db: Database,
  competencias: { id: string; inicio: string; fim: string }[],
  canal: Canal,
): Promise<DescontoDeDisponibilidadeDoMes | null> {
  if (competencias.length === 0) return null;

  /*
    Uma consulta por competência, cada uma cortada pelo **seu** período.

    O corte por data é necessário porque o `competenciaId` sozinho não diz de
    que dias a linha é: quem grava não filtra por período, pelo mesmo motivo do
    2Art — o relatório é exportado por mês e recusar o arquivo inteiro por
    metade dele cair fora seria pior. E o corte é por competência, e não um
    intervalo só para as duas, porque é isso que impede a mesma linha de entrar
    duas vezes. Ver o bloco acima.
  */
  const linhas: {
    aba: string;
    dia: string;
    canal: string;
    custoFixo: string | null;
    equipe: string | null;
    indiretos: string | null;
    fatorAjudante: string | null;
    total: string | null;
  }[] = [];
  for (const c of competencias) {
    linhas.push(
      ...(await db
        .select({
          aba: fechamentoDisponibilidadeTable.tipoDeFrota,
          dia: fechamentoDisponibilidadeTable.dia,
          canal: fechamentoDisponibilidadeTable.canal,
          custoFixo: fechamentoDisponibilidadeTable.descontoCustoFixo,
          equipe: fechamentoDisponibilidadeTable.descontoEquipe,
          indiretos: fechamentoDisponibilidadeTable.descontoIndiretos,
          fatorAjudante: fechamentoDisponibilidadeTable.descontoFatorAjudante,
          total: fechamentoDisponibilidadeTable.descontoTotal,
        })
        .from(fechamentoDisponibilidadeTable)
        .where(
          and(
            eq(fechamentoDisponibilidadeTable.competenciaId, c.id),
            gte(fechamentoDisponibilidadeTable.dia, c.inicio),
            lte(fechamentoDisponibilidadeTable.dia, c.fim),
          ),
        )),
    );
  }

  /* Sem linha nenhuma o 03.08.18 do mês não veio — e aí é `null`, não zero. */
  if (linhas.length === 0) return null;

  const numero = (v: string | null) => (v == null ? 0 : Number(v));

  /*
    Só os campos que a regra soma. O tipo pede a viagem inteira e a soma lê
    cinco números; preencher o resto com zeros plausíveis faria a leitura
    afirmar uma frota contratada que ela não consultou.
  */
  return descontoDeDisponibilidadeDoMes(
    linhas.map((d) => ({
      linha: 0,
      aba: d.aba,
      tipoDeFrota: d.aba as TipoDeFrotaContratada,
      dia: d.dia,
      canal: d.canal as Canal,
      frotaTotal: 0,
      contratada: 0,
      realPrimeiraViagem: 0,
      realSegundaViagem: 0,
      gapTotal: 0,
      gapDaCia: 0,
      gapDaTransportadora: {
        frotaCancelada: 0,
        outrosCancelados: 0,
        frotaNaoCancelada: 0,
        outrosNaoCancelados: 0,
      },
      descontos: {
        custoFixo: numero(d.custoFixo),
        equipe: numero(d.equipe),
        indiretos: numero(d.indiretos),
        fatorAjudante: numero(d.fatorAjudante),
        total: numero(d.total),
      },
      percentualDeUtilizacao: null,
      percentualDeDisponibilidade: null,
    })),
    canal,
  );
}

/**
 * Uma requisição do 03.08.12.09, no mínimo que a conta lê.
 *
 * `vbz` entra porque ela decide **em que quadro** o dinheiro cai: a `VBZ 06` é a
 * remuneração variável da equipe de entrega e tem quadro próprio; o resto é
 * outros custos. Ver `quadroDaEquipeDeEntrega`, em `mapa-rota.ts`.
 */
export interface RequisicaoDaConta {
  canal: Canal;
  status: string;
  valor: number;
  vbz: number;
}

export function basesDaQuinzena(
  descontos: { canal: Canal; tipo: string; valor: number }[] | null,
  canal: Canal,
  /** O diário da quinzena, já agrupado por dia. Vazio quando o 2Art não veio. */
  diario: { viagens: ViagemDoMapa[] }[],
  /** As requisições da competência, de todos os canais. `null` sem 03.08.12.09. */
  requisicoes: RequisicaoDaConta[] | null,
  /**
   * A disponibilidade do **mês**, e qual quinzena está sendo montada.
   *
   * Vem de fora porque o dado é do mês e esta função é de uma quinzena: quem
   * chama tem as duas competências na mão e soma o 03.08.18 uma vez só. Ver
   * `disponibilidadeDoMes`, e {@link DisponibilidadeDaCompetencia} para a regra.
   *
   * `null` quando o 03.08.18 do mês não foi importado.
   */
  periodo: {
    quinzena: 1 | 2;
    /** O 03.08.18 do mês, somado. `null` quando ele não foi importado. */
    disponibilidadeDoMes: DescontoDeDisponibilidadeDoMes | null;
  },
): Parameters<typeof montarMapaDaQuinzena>[0]["bases"] {
  const soma = (tipos: string[]) => {
    if (!descontos) return null;
    const alvos = descontos.filter((d) => d.canal === canal && tipos.includes(d.tipo));
    if (alvos.length === 0) return null;
    return centavos(alvos.reduce((s, d) => s + d.valor, 0));
  };

  return {
    devolucao: soma(["DEVOLUCAO"]),
    /*
      A disponibilidade sai do **03.08.18**, acumulada no mês e aplicada na 2ª
      quinzena. Ela saía do 03.08.20 — o que dava o mesmo número na 2ª e nada na
      1ª, porque o demonstrativo daquela metade não traz o bloco. A mudança é de
      procedência, não de valor: o devido passa a ser derivado dos dias que o
      produziram em vez de copiado do documento que ele deveria auditar.

      O bloco do 03.08.20 continua sendo lido — como **conferência**, guardada
      em `noDemonstrativo`. Ver `DECISOES_RESOLVIDAS`, em `matriz.ts`.
    */
    disponibilidade:
      /*
        Duas razões distintas para não haver disponibilidade devida, e as duas
        acabam em `null` porque as duas são a mesma resposta aritmética: não se
        sabe. O 03.08.18 não chegou, ou chegou em duas versões que discordam do
        valor de um dia — e aí `total` vem nulo e `conflitos` diz quais dias
        estão em disputa. Ver `descontoDeDisponibilidadeDoMes`.

        Somar uma das versões seria sortear; somar zero seria afirmar que não
        houve desconto. Nulo é o que a tela sabe pintar como pendência.
      */
      periodo.disponibilidadeDoMes === null || periodo.disponibilidadeDoMes.total === null
        ? null
        : {
            fonte: "MENSAL_03_08_18",
            medida: {
              valor: periodo.quinzena === 1 ? 0 : periodo.disponibilidadeDoMes.total,
              doMes: periodo.disponibilidadeDoMes.total,
              quinzena: periodo.quinzena,
              dias: periodo.disponibilidadeDoMes.dias,
              noDemonstrativo: soma([
                "DISPONIBILIDADE_CUSTO_FIXO",
                "DISPONIBILIDADE_EQUIPE",
                "DISPONIBILIDADE_INDIRETO",
                "DISPONIBILIDADE_FATOR_AJUDANTE",
              ]),
            },
          },
    /*
      O `DESCONTO FRETE MINIMO` do 03.08.20 — o elo que `MAPA-ROTA.md` registrava
      como inexistente.

      Ele não existe *dentro da pasta*, e é isso que aquela investigação provou:
      a base é digitada à mão no `Mapa Rota`, e nenhuma coluna do 03.08.18 a
      reproduz. Existe fora dela, no relatório que a planilha não abre. Em
      julho/2026 a 2ª quinzena fecha ao centavo: `AH140` traz 14.050,54 e o
      `Desconto Frete mínimo` do demonstrativo traz 14.050,54 — sem fator, que é
      exatamente a assimetria que `linhasDeDesconto` já descrevia ("ele já vem no
      valor em que é descontado", e o rótulo do relatório diz `coluna ICMS`).

      Na 1ª quinzena a planilha põe esse mesmo desconto na linha da
      **disponibilidade** (`R139` = 11.649,87 = o frete mínimo da quinzena, com
      fator) e deixa o complementar em zero. É inconsistência dela, não nossa, e
      a regra aqui é uma só nas duas quinzenas: o frete mínimo é o complementar.
      A divergência aparece na coluna `Diferença` da 1ª quinzena, que é onde uma
      discordância entre duas fontes deve aparecer — reproduzi-la trocaria um
      erro visível por um invisível.
    */
    complementarNegativo: soma(["FRETE_MINIMO"]),
    /*
      Os dois recortes do **mesmo** relatório, separados na origem. A `VBZ 06`
      sai daqui e vai para o quadro próprio; somá-la nos dois lugares contaria
      R$ 248.834,75 duas vezes no total geral de julho/2026. A soma dos dois
      reproduz o número único que a planilha imprime — ver
      `quadroDaEquipeDeEntrega`.
    */
    outrosCustos: outrosCustosDaQuinzena(requisicoes, canal, "SEM_A_EQUIPE", periodo.quinzena),
    equipeDeEntrega: outrosCustosDaQuinzena(requisicoes, canal, "SO_A_EQUIPE", periodo.quinzena),
    /*
      Diário vazio é diário ausente, e por isso `null` e não zero: uma
      competência cujo 2Art não chegou tem exatamente a mesma lista vazia de uma
      em que ninguém rodou, e as duas pedem coisas opostas de quem opera. Com
      viagens na mão, zero passa a ser medido — e `somarIndisponibilidade`
      carrega o denominador que o torna conferível.
    */
    indisponibilidade:
      diario.length === 0
        ? null
        : { fonte: "DIARIO", medida: somarIndisponibilidade(diario) },
  };
}

/**
 * Os outros custos da quinzena — as requisições aprovadas do 03.08.12.09.
 *
 * `null` quando o relatório não foi importado. Um zero **medido** quando ele
 * veio e nenhuma requisição do canal está aprovada — ou nenhuma é do canal.
 * Ver {@link OutrosCustosDoRelatorio}, que carrega o denominador de cada caso.
 */
function outrosCustosDaQuinzena(
  requisicoes: RequisicaoDaConta[] | null,
  canal: Canal,
  /**
   * Qual dos dois recortes da mesma lista.
   *
   * `SEM_A_EQUIPE` é o quadro de outros custos; `SO_A_EQUIPE` é o quarto quadro.
   * Os dois saem daqui, e não de duas funções, para que o filtro de status e o
   * denominador sejam necessariamente os mesmos — duas cópias divergiriam no dia
   * em que uma delas mudasse.
   */
  recorte: "SEM_A_EQUIPE" | "SO_A_EQUIPE",
  quinzena: 1 | 2,
): BaseDeOutrosCustos | null {
  /*
    **A 1ª quinzena vale zero por regra, e não por ausência.** O 03.08.12.09 não
    existe nela: `FONTES_DA_QUINZENA[1]` não o espera, e o 03.08.20 daquela
    metade não traz bloco `OUTROS CUSTOS` nenhum — as requisições chegam com o
    fechamento da 2ª, e é lá que elas são pagas. Duas fontes independentes
    dizendo a mesma coisa.

    `null` aqui diria "falta o arquivo" e mandaria alguém procurar o que não
    existe; pior, derrubaria o `TOTAL GERAL UNIDADE` do mês inteiro para `null`
    por causa de uma metade que legitimamente não tem outros custos. É a mesma
    disciplina da disponibilidade, e pelo mesmo motivo.
  */
  if (quinzena === 1 && (requisicoes === null || requisicoes.length === 0)) {
    return { fonte: "REQUISICOES", medida: { valor: 0, aprovadas: 0, recebidas: 0 } };
  }
  if (requisicoes === null || requisicoes.length === 0) return null;

  const daEquipe = (r: RequisicaoDaConta) => r.vbz === VBZ_DA_EQUIPE_DE_ENTREGA;
  const doCanal = requisicoes
    .filter((r) => r.canal === canal)
    .filter((r) => (recorte === "SO_A_EQUIPE" ? daEquipe(r) : !daEquipe(r)));
  /* O mesmo filtro da apuração, e não um segundo critério sobre o mesmo dado. */
  const aprovadas = doCanal.filter((r) => r.status.trim().toLowerCase() === STATUS_QUE_PAGA);
  return {
    fonte: "REQUISICOES",
    medida: {
      valor: centavos(aprovadas.reduce((s, r) => s + r.valor, 0)),
      aprovadas: aprovadas.length,
      recebidas: doCanal.length,
    },
  };
}

/**
 * O `Total Remuneração` do 03.08.20, por canal.
 *
 * É a soma de `valor_faturado` — frete mais outros custos —, que é exatamente
 * como o relatório fecha o próprio total. Devolve `null` quando o 03.08.20 não
 * foi importado, e não uma lista vazia: lista vazia diria "o demonstrativo diz
 * zero", que é outra afirmação.
 */
async function somarDemonstrativo(
  db: Database,
  competenciaId: string,
): Promise<{ canal: Canal; total: number }[] | null> {
  const linhas = await db
    .select({
      canal: fechamentoPagamentoItemTable.canal,
      total: sql<string>`sum(${fechamentoPagamentoItemTable.valorFaturado})`,
    })
    .from(fechamentoPagamentoItemTable)
    .where(eq(fechamentoPagamentoItemTable.competenciaId, competenciaId))
    .groupBy(fechamentoPagamentoItemTable.canal);
  if (linhas.length === 0) return null;
  return linhas.map((l) => ({ canal: l.canal as Canal, total: Number(l.total ?? 0) }));
}

/**
 * As requisições do 03.08.12.09 da competência — canal, status e valor.
 *
 * Devolve `null` quando o relatório não foi importado, e não uma lista vazia:
 * lista vazia diria "o relatório veio e não trouxe requisição", que é outra
 * afirmação — e é a diferença entre mandar importar um arquivo e mandar cobrar
 * uma aprovação. Ver `outrosCustosDaQuinzena`.
 *
 * Traz as três colunas que a conta usa e não a trilha de aprovação inteira: o
 * resumo do mês soma dinheiro, e quem quer saber quem aprovou o quê abre a
 * competência.
 */
async function requisicoesDaCompetencia(
  db: Database,
  competenciaId: string,
): Promise<RequisicaoDaConta[] | null> {
  const linhas = await db
    .select({
      canal: fechamentoRequisicaoTable.canal,
      status: fechamentoRequisicaoTable.status,
      valor: fechamentoRequisicaoTable.valor,
      /* A VBZ separa a equipe de entrega dos outros custos — ver `basesDaQuinzena`. */
      vbz: fechamentoRequisicaoTable.vbz,
    })
    .from(fechamentoRequisicaoTable)
    .where(eq(fechamentoRequisicaoTable.competenciaId, competenciaId));
  if (linhas.length === 0) return null;
  return linhas.map((l) => ({
    canal: l.canal as Canal,
    status: l.status,
    valor: Number(l.valor ?? 0),
    vbz: Number(l.vbz ?? 0),
  }));
}

/** Os descontos do 03.08.20, somados por canal e tipo. */
async function somarDescontosDoDemonstrativo(
  db: Database,
  competenciaId: string,
): Promise<{ canal: Canal; tipo: string; valor: number }[] | null> {
  const linhas = await db
    .select({
      canal: fechamentoPagamentoDescontoTable.canal,
      tipo: fechamentoPagamentoDescontoTable.tipo,
      valor: sql<string>`sum(${fechamentoPagamentoDescontoTable.valor})`,
    })
    .from(fechamentoPagamentoDescontoTable)
    .where(eq(fechamentoPagamentoDescontoTable.competenciaId, competenciaId))
    .groupBy(fechamentoPagamentoDescontoTable.canal, fechamentoPagamentoDescontoTable.tipo);
  if (linhas.length === 0) return null;
  return linhas.map((l) => ({
    canal: l.canal as Canal,
    tipo: l.tipo,
    valor: Number(l.valor ?? 0),
  }));
}

/** O que saiu do banco num descarte — dito por extenso, nunca "pronto". */
export interface DadosDescartados {
  competencia: CompetenciaRegistrada;
  /** Documentos apagados, contando os que já estavam despromovidos. */
  documentos: number;
  /** Apurações apagadas, contando as que não eram mais vigentes. */
  apuracoes: number;
  /** Linhas apagadas, por fonte. É o que a tela repete de volta a quem clicou. */
  linhas: Record<TipoDeFonte, number>;
}

/**
 * Descarta o que foi importado para uma competência: os documentos, as linhas
 * que eles produziram e as apurações que saíram delas.
 *
 * **Por que apagar de verdade, e não despromover.** `receberDocumento` já sabe
 * trocar uma exportação por outra — a anterior fica no histórico, marcada
 * `vigente = false`. Isso resolve "a Ambev reenviou o arquivo corrigido" e não
 * resolve o caso deste ato: o arquivo do período errado, aberto na competência
 * errada. Mantê-lo como histórico guardaria no banco a evidência de uma
 * quinzena que nunca foi esta, e o índice `(competência, sha256)` ainda
 * recusaria o reenvio do mesmo arquivo depois que a data fosse corrigida — o
 * descarte existe para desfazer, e desfazer pela metade é o que faz a próxima
 * importação mentir.
 *
 * **Por que a apuração cai junto.** Ela é a conta *daquelas* linhas. Mantida
 * sobre um banco sem elas, seria um total que nada sustenta — exatamente o que
 * o módulo inteiro existe para não produzir.
 *
 * **Por que a competência sobrevive, vazia.** Quem lançou o mês errado quer
 * reimportar, não recomeçar: unidade, transportadora e datas continuam certas
 * mesmo quando o arquivo estava errado. O estado volta a `ABERTA` porque é o
 * que ela passa a ser — deixá-la `APURADA` sem apuração afirmaria uma conta que
 * não existe mais.
 *
 * **Por que a encerrada é recusada aqui e não só pelo gatilho.** O gatilho
 * `fechamento_*_congelada` já barraria a escrita, com a mensagem do Postgres.
 * A recusa daqui chega antes e em português, com o nome da competência e a
 * saída — reabrir, com motivo —, que é a diferença entre um erro e uma
 * instrução.
 */
export async function descartarDadosDaCompetencia(
  db: Database,
  competenciaId: string,
): Promise<DadosDescartados> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ENCONTRADA",
      "A competência informada não existe.",
    );
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada. Reabra-a, com motivo, antes de descartar o que foi importado.`,
    );
  }

  return db.transaction(async (tx) => {
    const apagado = await apagarOQueFoiImportado(tx, competenciaId);

    await tx
      .update(fechamentoCompetenciaTable)
      .set({ estado: "ABERTA", apuradaEm: null })
      .where(eq(fechamentoCompetenciaTable.id, competenciaId));

    return { competencia: { ...competencia, estado: "ABERTA", apuradaEm: null }, ...apagado };
  });
}

/**
 * Apaga o que foi importado para uma competência, dentro de uma transação que
 * já está aberta, e devolve o tamanho do que saiu.
 *
 * É o corpo comum de dois atos que apagam a mesma coisa e diferem no que fazem
 * depois: o descarte devolve a competência vazia e aberta, e a exclusão apaga a
 * própria competência em seguida. Escrever as onze tabelas duas vezes seria
 * garantir que a segunda cópia esquecesse a tabela que a próxima fonte
 * trouxer — e um resto órfão de uma quinzena apagada é exatamente o tipo de
 * linha que reaparece somando numa conta meses depois.
 */
async function apagarOQueFoiImportado(
  tx: Transacao,
  competenciaId: string,
): Promise<Omit<DadosDescartados, "competencia">> {
  const quantas = (resultado: { rowCount: number | null }) => resultado.rowCount ?? 0;

  /*
    As linhas saem antes dos documentos porque apontam para eles: deixar o
    banco decidir a ordem por cascade funcionaria, mas esconderia da contagem
    quantas linhas de cada fonte foram embora — que é justamente o que quem
    clicou precisa ver para saber que descartou o que queria.
  */
  const linhas: Record<TipoDeFonte, number> = {
    OPERACAO: quantas(
      await tx
        .delete(fechamentoViagemTable)
        .where(eq(fechamentoViagemTable.competenciaId, competenciaId)),
    ),
    CTE: quantas(
      await tx.delete(fechamentoCteTable).where(eq(fechamentoCteTable.competenciaId, competenciaId)),
    ),
    PAGAMENTO:
      quantas(
        await tx
          .delete(fechamentoPagamentoItemTable)
          .where(eq(fechamentoPagamentoItemTable.competenciaId, competenciaId)),
      ) +
      quantas(
        await tx
          .delete(fechamentoPagamentoDescontoTable)
          .where(eq(fechamentoPagamentoDescontoTable.competenciaId, competenciaId)),
      ),
    /* Um descarte por frota, porque são duas fontes e o relatório diz quantas
       linhas cada uma perdeu. A tabela é a mesma; o corte é `tipo_de_frota`. */
    DISPONIBILIDADE_FF: quantas(
      await tx
        .delete(fechamentoDisponibilidadeTable)
        .where(
          and(
            eq(fechamentoDisponibilidadeTable.competenciaId, competenciaId),
            eq(fechamentoDisponibilidadeTable.tipoDeFrota, "FF"),
          ),
        ),
    ),
    DISPONIBILIDADE_VAN: quantas(
      await tx
        .delete(fechamentoDisponibilidadeTable)
        .where(
          and(
            eq(fechamentoDisponibilidadeTable.competenciaId, competenciaId),
            eq(fechamentoDisponibilidadeTable.tipoDeFrota, "VAN"),
          ),
        ),
    ),
    REQUISICOES: quantas(
      await tx
        .delete(fechamentoRequisicaoTable)
        .where(eq(fechamentoRequisicaoTable.competenciaId, competenciaId)),
    ),
    CONCILIACAO: quantas(
      await tx
        .delete(fechamentoConciliacaoItemTable)
        .where(eq(fechamentoConciliacaoItemTable.competenciaId, competenciaId)),
    ),
  };

  /* Verbas e divergências apontam a apuração e saem por cascade com ela. */
  const apuracoes = quantas(
    await tx
      .delete(fechamentoApuracaoTable)
      .where(eq(fechamentoApuracaoTable.competenciaId, competenciaId)),
  );
  const documentos = quantas(
    await tx
      .delete(fechamentoDocumentoTable)
      .where(eq(fechamentoDocumentoTable.competenciaId, competenciaId)),
  );

  return { documentos, apuracoes, linhas };
}

/** O que a exclusão levou junto — o mesmo tamanho que o descarte relata. */
export interface CompetenciaExcluida {
  /** A competência que deixou de existir, como ela era no instante anterior. */
  competencia: CompetenciaRegistrada;
  documentos: number;
  apuracoes: number;
  linhas: Record<TipoDeFonte, number>;
}

/**
 * Exclui a competência inteira — a importação some da lista, com tudo dentro.
 *
 * **A diferença para o descarte.** Descartar esvazia a quinzena e a mantém: quem
 * subiu o arquivo do mês errado quer reimportar, e unidade, transportadora e
 * datas continuam certas. Excluir é o outro caso — a competência em si não
 * devia existir: o CDD errado, a transportadora errada, a quinzena aberta em
 * duplicidade. Esvaziá-la deixaria na lista uma linha vazia que ninguém sabe
 * por que está lá, e que a próxima pessoa abriria por engano.
 *
 * **Encerrada, não.** É a mesma regra do envio e do descarte, e pelo mesmo
 * motivo: uma quinzena encerrada é a prova de uma cobrança, e apagá-la de
 * dentro de um clique de lista apagaria a prova sem que ninguém tenha dito por
 * quê. Reabrir — que exige motivo escrito e fica no registro — é o caminho, e a
 * recusa daqui diz isso em vez de deixar o gatilho responder em SQL.
 *
 * **Por que apaga linha a linha em vez de confiar no cascade.** Todas as chaves
 * apontam a competência com `on delete cascade`, então um `DELETE` só bastaria
 * para o banco. Não basta para quem clicou: o que volta é o tamanho do que foi
 * embora — quantos documentos, quantas apurações, quantas linhas de cada
 * fonte —, e é essa contagem que faz "excluí a importação certa" ser uma
 * verificação e não uma esperança.
 */
export async function excluirCompetencia(
  db: Database,
  competenciaId: string,
): Promise<CompetenciaExcluida> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ENCONTRADA",
      "A competência informada não existe.",
    );
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada. Reabra-a, com motivo, antes de excluir a importação.`,
    );
  }

  return db.transaction(async (tx) => {
    const apagado = await apagarOQueFoiImportado(tx, competenciaId);
    await tx
      .delete(fechamentoCompetenciaTable)
      .where(eq(fechamentoCompetenciaTable.id, competenciaId));
    return { competencia, ...apagado };
  });
}

/**
 * Associa uma competência à unidade canônica — sem tocar em mais nada.
 *
 * **É o caminho que corrige uma competência antiga sem apagá-la.** O caso que a
 * originou: uma competência aberta com `unidade_codigo = "CDD Belém"` — um nome
 * fazendo papel de código, gravado quando o formulário tinha um campo só — e o
 * cadastro de Remuneração da mesma unidade com outro identificador. Os dois
 * nunca se encontravam, o Resumo caía no painel do 03.08.20 relido, e a única
 * saída era excluir a competência e reimportar tudo.
 *
 * **O que esta função escreve: uma coluna.** `unidade_id`. E só.
 *
 * - `unidade_codigo` fica como está — é o texto legado, está na chave única, e
 *   reescrevê-lo mudaria a identidade de linhas que outras tabelas endereçam;
 * - documentos, itens do 03.08.20, descontos, viagens, CT-es, disponibilidade,
 *   requisições e conciliação não são lidos nem tocados;
 * - `bytes_originais` idem — nada é reimportado, e o `sha256` de cada documento
 *   continua o mesmo;
 * - nenhum código de fonte é convertido: `081-0443` continua `081-0443`.
 *
 * **A competência encerrada é recusada, pela regra oficial.** Não porque
 * associar seja perigoso em si — é uma coluna nula ganhando valor —, mas porque
 * o efeito dela não é: com a unidade associada, o Resumo passa a achar o
 * contrato e a recalcular o devido. Uma quinzena congelada que muda de número
 * depois de fechada é exatamente o que o encerramento existe para impedir.
 * Quem precisa reabre com motivo, que é o caminho que o produto já tem.
 */
export async function associarUnidadeDaCompetencia(
  db: Database,
  competenciaId: string,
  unidadeId: string,
  /**
   * A outra metade da mesma afirmação, dentro da mesma transação.
   *
   * **Por que um parâmetro, e não uma chamada da rota depois desta.** A
   * identidade canônica é escrita em dois lugares — aqui e em
   * `remuneracao_unidade`, que mora noutro pacote — e as duas escritas são uma
   * afirmação só. Duas chamadas seguidas na rota deixariam a segunda falhar com
   * a primeira já gravada: a competência apontando para a unidade e o cadastro
   * dela sem apontar para nada, que é **exatamente** o estado que produziu o
   * defeito do `comparado` sumindo — só que agora escrito por nós, e sem
   * ninguém tendo clicado em nada errado.
   *
   * Recebendo o gancho, a transação é de quem já escrevia, e nenhum chamador
   * pode esquecer a metade que não é dele. Falhando o gancho, nada fica.
   */
  tambemNaMesmaTransacao?: (
    tx: Transacao,
    competencia: CompetenciaRegistrada,
  ) => Promise<void>,
): Promise<CompetenciaRegistrada> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ENCONTRADA",
      "A competência informada não existe.",
    );
  }
  if (competencia.estado === "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_ENCERRADA",
      `A competência ${competencia.chave} está encerrada. Associar a unidade faria o ` +
        "Resumo achar o contrato e recalcular o devido — e uma quinzena fechada que muda " +
        "de número é o que o encerramento existe para impedir. Reabra-a, com motivo, antes.",
    );
  }

  const [unidade] = await db
    .select({ id: unidadeTable.id })
    .from(unidadeTable)
    .where(eq(unidadeTable.id, unidadeId))
    .limit(1);
  if (!unidade) {
    throw new RecusaDeFechamento(
      "UNIDADE_NAO_ENCONTRADA",
      "Não existe unidade canônica com este identificador. Cadastre-a em " +
        "Administração → Unidades antes de associar.",
    );
  }

  /*
    As três escritas numa transação só, e o gancho dentro dela.

    Antes eram três comandos soltos: a coluna desta competência, a propagação
    para as irmãs, e — depois, na rota — o cadastro de Remuneração. Cada um
    podia ficar sozinho no banco, e o estado pela metade não é abstrato: é a
    competência com identidade e o cadastro sem, que é a configuração exata em
    que `resolverUnidade` deixa de comparar texto e não encontra nada pela
    identidade. O devido some, e nada na tela diz que a gravação foi parcial.
  */
  await db.transaction(async (tx) => {
    await tx
      .update(fechamentoCompetenciaTable)
      .set({ unidadeId })
      .where(eq(fechamentoCompetenciaTable.id, competenciaId));

    /*
      A decisão vale para o texto, e não para a linha.

      Quem clica "associar" está dizendo qual unidade é o `CDD Belém` desta
      competência — e as duas quinzenas do mês são duas competências com esse
      mesmo texto. Sem esta propagação, a pessoa associava a 1ª, via o devido
      aparecer, e a 2ª continuava em branco esperando um segundo clique que a
      tela (com painel comparado já montado) tinha deixado de oferecer. Era o
      caso real de julho/2026.

      Não é inferência: é a mesma afirmação, aplicada onde ela já valia. As
      encerradas ficam de fora, e a conciliação as devolve listadas.
    */
    await conciliarIdentidadeDasCompetencias(tx, {
      unidadeId,
      codigos: [competencia.unidade.codigo],
    });

    /*
      A metade que mora noutro pacote — ver o parâmetro. A competência vai
      junto porque é dela que sai a grafia afirmada, e lê-la de novo na borda
      seria uma segunda leitura podendo discordar desta.
    */
    await tambemNaMesmaTransacao?.(tx, competencia);
  });

  return (await buscarCompetencia(db, competenciaId))!;
}

/**
 * Encerra a competência — o ato de dizer "esta quinzena está fechada".
 *
 * **O que ele muda, já que tudo estava salvo.** Cada documento enviado e cada
 * apuração rodada já estão no banco desde que aconteceram: nada aqui é o
 * primeiro `INSERT` de coisa alguma. O que o encerramento acrescenta é o
 * *congelamento* — a partir dele o gatilho `fechamento_*_congelada` recusa
 * qualquer escrita nas tabelas da competência, e o número que se cobrou passa a
 * ser o número que se vai ler daqui a um ano. Salvar contínuo e fechar são
 * coisas diferentes, e só a segunda vale como prova.
 *
 * **Por que exige uma apuração vigente.** Encerrar sem ter apurado congelaria
 * uma competência que não sabe quanto vale: os documentos estariam lá e a conta
 * não. Não é um detalhe de validação — é a diferença entre um período fechado e
 * um período abandonado.
 */
export async function encerrarCompetencia(
  db: Database,
  competenciaId: string,
  por?: string | null,
): Promise<CompetenciaRegistrada> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento("COMPETENCIA_NAO_ENCONTRADA", "A competência informada não existe.");
  }
  if (competencia.estado === "ENCERRADA") {
    /*
      Encerrar de novo é um clique repetido, não um erro: devolve o estado que
      já vale, em vez de assustar quem só quis conferir se tinha salvo.
    */
    return competencia;
  }

  const apuracao = await lerApuracaoVigente(db, competenciaId);
  if (!apuracao) {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_APURADA",
      `A competência ${competencia.chave} ainda não foi apurada. ` +
        `Encerrar sem apurar congelaria um período que não sabe quanto vale.`,
    );
  }

  const [linha] = await db
    .update(fechamentoCompetenciaTable)
    .set({
      estado: "ENCERRADA",
      encerradaEm: new Date(),
      encerradaPor: por ?? null,
      /*
        O motivo da reabertura anterior sai quando a competência fecha de novo:
        ele explica um período aberto, e um período fechado não tem o que
        explicar. Mantê-lo faria a tela mostrar, numa competência encerrada, a
        justificativa de uma reabertura que já foi resolvida.
      */
      motivoDaReabertura: null,
    })
    .where(eq(fechamentoCompetenciaTable.id, competenciaId))
    .returning();
  return comoRegistrada(linha);
}

/**
 * Reabre uma competência encerrada — com autor e motivo, sempre.
 *
 * O motivo é obrigatório e não tem valor-padrão. Uma competência encerrada é a
 * prova de uma cobrança; descongelá-la é uma decisão que alguém toma, e o
 * registro de quem tomou e por quê é a única coisa que separa uma correção
 * legítima de uma alteração silenciosa depois do fato.
 *
 * A competência volta para `APURADA` e não para `ABERTA`: a apuração que estava
 * lá continua valendo, e é justamente contra ela que se vai comparar o que
 * mudar daqui em diante.
 */
export async function reabrirCompetencia(
  db: Database,
  competenciaId: string,
  entrada: { motivo: string; por?: string | null },
): Promise<CompetenciaRegistrada> {
  const competencia = await buscarCompetencia(db, competenciaId);
  if (!competencia) {
    throw new RecusaDeFechamento("COMPETENCIA_NAO_ENCONTRADA", "A competência informada não existe.");
  }
  if (competencia.estado !== "ENCERRADA") {
    throw new RecusaDeFechamento(
      "COMPETENCIA_NAO_ESTA_ENCERRADA",
      `A competência ${competencia.chave} não está encerrada — não há o que reabrir.`,
    );
  }
  const motivo = entrada.motivo.trim();
  if (motivo === "") {
    throw new RecusaDeFechamento(
      "MOTIVO_OBRIGATORIO",
      "Reabrir uma competência encerrada exige um motivo escrito: ele é o que " +
        "distingue uma correção de uma alteração silenciosa depois do fato.",
    );
  }

  const [linha] = await db
    .update(fechamentoCompetenciaTable)
    .set({
      estado: "APURADA",
      encerradaEm: null,
      encerradaPor: null,
      motivoDaReabertura: motivo,
    })
    .where(eq(fechamentoCompetenciaTable.id, competenciaId))
    .returning();
  return comoRegistrada(linha);
}


/** Os dois lados de um fechamento: o CDD que recebe e quem entrega. */
export type TipoDeParte = "UNIDADE" | "TRANSPORTADORA";

/** A coluna da competência que guarda cada lado. */
const COLUNAS_DA_PARTE: Record<TipoDeParte, { codigo: string; nome: string }> = {
  UNIDADE: { codigo: "unidade_codigo", nome: "unidade_nome" },
  TRANSPORTADORA: { codigo: "transportadora_codigo", nome: "transportadora_nome" },
};

/** Uma unidade ou transportadora, como o Fechamento a conhece. */
export interface Parte {
  codigo: string;
  nome: string | null;
  /** Em quantas competências ela já apareceu — a lista sai ordenada por isto. */
  competencias: number;
}

/**
 * As unidades e transportadoras que o Fechamento conhece — cadastradas e usadas.
 *
 * **A lista já foi derivada e só, e o que quebrou foi o uso.** A regra antiga
 * era esta, escrita aqui: uma unidade existe quando alguém abre uma competência
 * com ela, e a lista é literalmente o que as competências dizem. O preço
 * apareceu no dia em que alguém digitou `443 — CDD Belém`, abriu a competência
 * e depois **excluiu** a importação — que é justamente o que a exclusão existe
 * para desfazer. O nome foi junto: o cadastro morava dentro do registro que ele
 * serve para criar, e não havia como desfazer um sem desfazer o outro.
 *
 * Hoje são duas fontes somadas, e não duas verdades. Toda escrita de parte
 * atravessa `registrarParte` — o campo que cadastra e a abertura de competência
 * —, de modo que `fechamento_parte` guarda sempre o **último** nome escrito,
 * que é exatamente o que a lista derivada devolvia. O cadastro responde pelo
 * que ninguém usou ainda; as competências respondem pela contagem, e por
 * qualquer código que não tenha chegado ao cadastro. Onde as duas falam, o
 * cadastro ganha, porque ele é o mais recente por construção — e a `0044`
 * começou por trazer para lá tudo o que as competências já diziam.
 *
 * A ordem continua a mesma — mais usada primeiro, empate pelo código —, e a
 * parte só cadastrada entra no fim com `competencias: 0`, que é a informação
 * honesta sobre ela.
 */
export async function listarPartes(
  db: Database,
): Promise<{ unidades: Parte[]; transportadoras: Parte[] }> {
  const consultar = async (tipo: TipoDeParte): Promise<Parte[]> => {
    const { codigo, nome } = COLUNAS_DA_PARTE[tipo];
    const { rows } = await db.execute<{
      codigo: string;
      nome: string | null;
      competencias: string;
    }>(sql`
      with das_competencias as (
        select
          c.${sql.raw(codigo)} as codigo,
          (array_agg(c.${sql.raw(nome)} order by c.aberta_em desc)
             filter (where c.${sql.raw(nome)} is not null))[1] as nome,
          count(*) as competencias
        from fechamento_competencia c
        group by c.${sql.raw(codigo)}
      ),
      do_cadastro as (
        select p.codigo, p.nome
        from fechamento_parte p
        where p.tipo = ${tipo}
      )
      select
        coalesce(k.codigo, d.codigo) as codigo,
        coalesce(k.nome, d.nome) as nome,
        coalesce(d.competencias, 0)::text as competencias
      from do_cadastro k
      full outer join das_competencias d on d.codigo = k.codigo
      order by coalesce(d.competencias, 0) desc, coalesce(k.codigo, d.codigo)
    `);
    return rows.map((r) => ({
      codigo: r.codigo,
      nome: r.nome,
      competencias: Number(r.competencias),
    }));
  };

  const [unidades, transportadoras] = await Promise.all([
    consultar("UNIDADE"),
    consultar("TRANSPORTADORA"),
  ]);
  return { unidades, transportadoras };
}

/**
 * Cadastra uma parte — ou reescreve o nome da que já existe.
 *
 * É a única porta de escrita do cadastro, e por isso ela é o lugar onde as
 * regras cabem uma vez só:
 *
 * - **O código é aparado e obrigatório.** Um código em branco não é uma parte
 *   nova; é um campo que ninguém preencheu, e gravá-lo criaria uma linha que
 *   nenhuma competência jamais casaria.
 * - **Nome vazio é `null`, nunca `""`.** As duas coisas se parecem na tela e
 *   ordenam diferente no banco; a ausência tem uma representação só.
 * - **Renomear é reescrever; apagar o nome, não.** O `coalesce` do `on
 *   conflict` deixa `443 — CDD Belém` corrigir um `443` sem nome, e impede que
 *   uma abertura de competência feita só com o código apague o nome que alguém
 *   já tinha escrito. Perder um nome é sempre pior do que manter o anterior.
 *
 * Devolve a parte como a lista a mostra — com a contagem de competências —,
 * para que a tela possa selecioná-la no campo sem esperar a lista inteira
 * chegar de novo.
 */
export async function registrarParte(
  db: Database,
  entrada: { tipo: TipoDeParte; codigo: string; nome?: string | null },
): Promise<Parte> {
  const codigo = entrada.codigo.trim();
  const nome = entrada.nome?.trim() ? entrada.nome.trim() : null;
  if (codigo === "") {
    throw new RecusaDeFechamento(
      "PARTE_SEM_CODIGO",
      "O código é obrigatório — é por ele que a competência encontra a unidade ou a transportadora.",
    );
  }

  const [linha] = await db
    .insert(fechamentoParteTable)
    .values({ tipo: entrada.tipo, codigo, nome })
    .onConflictDoUpdate({
      target: [fechamentoParteTable.tipo, fechamentoParteTable.codigo],
      set: {
        nome: sql`coalesce(excluded.nome, ${fechamentoParteTable.nome})`,
        atualizadaEm: sql`now()`,
      },
    })
    .returning();

  const { rows } = await db.execute<{ competencias: string }>(sql`
    select count(*)::text as competencias
    from fechamento_competencia c
    where c.${sql.raw(COLUNAS_DA_PARTE[entrada.tipo].codigo)} = ${codigo}
  `);

  return {
    codigo: linha!.codigo,
    nome: linha!.nome,
    competencias: Number(rows[0]?.competencias ?? 0),
  };
}

/**
 * O arquivo de uma importação, de volta como ele entrou.
 *
 * **É o que fecha o ciclo.** A importação guarda os bytes; esta função os
 * devolve. Entre as duas, qualquer diagnóstico sobre "por que este arquivo não
 * produziu o que se esperava" deixa de exigir que alguém reenvie o `.txt` —
 * que era a única saída antes da `0047`, e a que fazia o sistema parecer não
 * guardar o que recebeu.
 *
 * **Confere na volta.** O tamanho descomprimido e o `sha256` gravados no
 * documento são verificados contra o que saiu daqui. Um arquivo que voltasse
 * diferente do que entrou seria pior do que não guardar: quem examinasse estaria
 * examinando outra coisa, sem saber.
 *
 * `null` quando o documento é anterior à `0047` — e aí os bytes não existem
 * mesmo, não é falha de leitura.
 */
export async function lerConteudoDoDocumento(
  db: Database,
  documentoId: string,
): Promise<{ conteudo: Buffer; nomeDoArquivo: string; tipo: TipoDeFonte } | null> {
  const linhas = await db
    .select({
      conteudo: fechamentoDocumentoConteudoTable.conteudo,
      bytesOriginais: fechamentoDocumentoConteudoTable.bytesOriginais,
      nomeDoArquivo: fechamentoDocumentoTable.nomeDoArquivo,
      tipo: fechamentoDocumentoTable.tipo,
      sha256: fechamentoDocumentoTable.sha256,
    })
    .from(fechamentoDocumentoConteudoTable)
    .innerJoin(
      fechamentoDocumentoTable,
      eq(fechamentoDocumentoTable.id, fechamentoDocumentoConteudoTable.documentoId),
    )
    .where(eq(fechamentoDocumentoConteudoTable.documentoId, documentoId))
    .limit(1);

  const linha = linhas[0];
  if (!linha) return null;

  const conteudo = gunzipSync(linha.conteudo);
  if (conteudo.byteLength !== linha.bytesOriginais) {
    throw new Error(
      `O conteúdo guardado de "${linha.nomeDoArquivo}" voltou com ${conteudo.byteLength} bytes ` +
        `e foi guardado com ${linha.bytesOriginais}.`,
    );
  }
  const sha = createHash("sha256").update(conteudo).digest("hex");
  if (sha !== linha.sha256) {
    throw new Error(
      `O conteúdo guardado de "${linha.nomeDoArquivo}" não confere com o sha256 do envio.`,
    );
  }
  return { conteudo, nomeDoArquivo: linha.nomeDoArquivo, tipo: linha.tipo as TipoDeFonte };
}

/**
 * O painel da planilha, preenchido com o 03.08.20 desta competência.
 *
 * É a leitura que faz a classificação do sistema conversar com a da planilha:
 * as verbas que o banco guardou entram, e saem os dezoito rótulos do `RESUMO`
 * com o que cada um vale — ou com o motivo de não valer nada ainda. A conta em
 * si é de `de-para.ts`, pura e sob teste; aqui só se busca o material.
 *
 * **Devolve `null` quando não há verba gravada**, e não um painel zerado. Um
 * painel com dezoito zeros diria que a quinzena não pagou nada, que é uma
 * afirmação; a ausência do demonstrativo é outra, e a tela precisa poder dizer
 * qual das duas aconteceu.
 *
 * **`null` não quer dizer "o arquivo não chegou"** — quem quiser afirmar isso
 * tem de perguntar, e {@link explicarPainelAusente} é onde se pergunta. Não
 * ter verba é o que esta leitura sabe; por que não tem é o que o documento
 * conta.
 *
 * **O `Total Remuneração` é remontado da soma de `valor_faturado`**, e não lido
 * de uma coluna própria — é exatamente como `lerResumoDoMes` o faz, e como o
 * próprio relatório o fecha (frete mais outros custos). Guardá-lo à parte
 * criaria uma segunda verdade sobre o mesmo total.
 */
export async function lerDeParaDaCompetencia(
  db: Database,
  competenciaId: string,
  opcoes: { canal?: Canal; coluna?: ColunaDoPagamento } = {},
): Promise<DeParaConferido | null> {
  const [itens, descontos] = await Promise.all([
    db
      .select()
      .from(fechamentoPagamentoItemTable)
      .where(eq(fechamentoPagamentoItemTable.competenciaId, competenciaId)),
    db
      .select()
      .from(fechamentoPagamentoDescontoTable)
      .where(eq(fechamentoPagamentoDescontoTable.competenciaId, competenciaId)),
  ]);
  if (itens.length === 0) return null;

  const numero = (v: string | null) => (v == null ? 0 : Number(v));

  /* `Total Remuneração` = frete + outros custos, que é como o relatório fecha. */
  const totais = new Map<Canal, number>();
  for (const i of itens) {
    const canal = i.canal as Canal;
    totais.set(canal, centavos((totais.get(canal) ?? 0) + numero(i.valorFaturado)));
  }

  return conferirDePara(
    {
      periodo: { inicio: null, fim: null },
      unidade: null,
      transportadora: null,
      /* Idem: as recusas moram no documento, não nesta reconstrução. */
      recusas: [],
      itens: itens.map((i) => ({
        linha: i.linhaNoArquivo,
        canal: i.canal as Canal,
        bloco: i.bloco as BlocoDoPagamento,
        verba: verbaGravada(i.vbz, i.canal as Canal, i.nomeNoArquivo),
        nomeNoArquivo: i.nomeNoArquivo,
        semImposto: numero(i.semImposto),
        nfIss: numero(i.nfIss),
        ctrcIcms: numero(i.ctrcIcms),
        valorFaturado: numero(i.valorFaturado),
        vlcNfIss: numero(i.vlcNfIss),
        vlcCtrcIcms: numero(i.vlcCtrcIcms),
      })),
      descontos: descontos.map((d) => ({
        linha: d.linhaNoArquivo,
        canal: d.canal as Canal,
        tipo: d.tipo as TipoDeDescontoDoPagamento,
        rotulo: d.rotulo,
        valor: numero(d.valor),
        base: d.base == null ? null : numero(d.base),
        percentual: d.percentual == null ? null : numero(d.percentual),
        vbzDeOrigem: vbzsCitadasNoRotulo(d.rotulo, d.canal as Canal),
      })),
      totais: [...totais].map(([canal, total]) => ({ canal, total })),
    },
    opcoes,
  );
}

/**
 * Por que esta competência não tem painel da planilha.
 *
 * **A pergunta que faltava.** O painel sai do 03.08.20 e de mais nada, e
 * {@link lerDeParaDaCompetencia} devolve `null` quando não há verba gravada. A
 * tela concluía dali que o arquivo não tinha sido importado — e as duas coisas
 * não são a mesma. A diferença apareceu para quem opera: a lista de relatórios
 * da quinzena mostrava o 03.08.20 com o visto verde, o nome do arquivo e as
 * linhas lidas, e o painel, ao lado, dizia que ele não fora importado. Uma das
 * duas frases estava errada, e era a segunda.
 *
 * **Os três estados que a ausência escondia**, todos legíveis do que o banco já
 * guarda:
 *
 * - `SEM_DOCUMENTO` — nenhum 03.08.20 chegou nesta competência. É o único caso
 *   em que "não foi importado" é a verdade.
 * - `EM_QUARENTENA` — chegou e não valeu (ver `motivoParaQuarentena`). Há
 *   documento e não há documento vigente, e **só a quarentena produz esse
 *   par**: a substituição despromove o anterior apenas quando promove o novo,
 *   e o descarte apaga os dois.
 * - `SEM_VERBA` — o documento vigente está lá, com nome e data, e não sustenta
 *   verba nenhuma. É o estado em que ficaram as competências importadas antes
 *   de a quarentena existir, quando um arquivo do qual o leitor só tirou
 *   descontos apagava o anterior e era promovido no lugar dele.
 */
export type PainelAusente =
  | { motivo: "SEM_DOCUMENTO" }
  | {
      motivo: "EM_QUARENTENA";
      nomeDoArquivo: string;
      enviadoEm: Date;
      recusas: Recusa[];
    }
  | {
      motivo: "SEM_VERBA";
      nomeDoArquivo: string;
      enviadoEm: Date;
      /** Quantos descontos o documento vigente gravou — as verbas são zero. */
      descontos: number;
      recusas: Recusa[];
    };

/**
 * Qual dos três estados é o desta competência.
 *
 * Só se pergunta quando já se sabe que não há painel: é o caminho do erro, e
 * pagar duas consultas nele é mais barato do que carregá-las em toda leitura
 * que dá certo.
 */
export async function explicarPainelAusente(
  db: Database,
  competenciaId: string,
): Promise<PainelAusente> {
  const documentos = await db
    .select({
      id: fechamentoDocumentoTable.id,
      nomeDoArquivo: fechamentoDocumentoTable.nomeDoArquivo,
      recusas: fechamentoDocumentoTable.recusas,
      vigente: fechamentoDocumentoTable.vigente,
      enviadoEm: fechamentoDocumentoTable.enviadoEm,
    })
    .from(fechamentoDocumentoTable)
    .where(
      and(
        eq(fechamentoDocumentoTable.competenciaId, competenciaId),
        eq(fechamentoDocumentoTable.tipo, "PAGAMENTO"),
      ),
    )
    .orderBy(desc(fechamentoDocumentoTable.enviadoEm));

  if (documentos.length === 0) return { motivo: "SEM_DOCUMENTO" };

  const vigente = documentos.find((d) => d.vigente);
  if (!vigente) {
    /* O mais recente é o que a pessoa acabou de enviar, e é dele que ela quer
       notícia — os anteriores, se houver, foram outras tentativas do mesmo. */
    const ultimo = documentos[0]!;
    return {
      motivo: "EM_QUARENTENA",
      nomeDoArquivo: ultimo.nomeDoArquivo,
      enviadoEm: ultimo.enviadoEm,
      recusas: (ultimo.recusas ?? []) as Recusa[],
    };
  }

  const [contagem] = await db
    .select({ quantos: sql<number>`count(*)::int` })
    .from(fechamentoPagamentoDescontoTable)
    .where(eq(fechamentoPagamentoDescontoTable.documentoId, vigente.id));

  return {
    motivo: "SEM_VERBA",
    nomeDoArquivo: vigente.nomeDoArquivo,
    enviadoEm: vigente.enviadoEm,
    descontos: contagem?.quantos ?? 0,
    recusas: (vigente.recusas ?? []) as Recusa[],
  };
}

/**
 * A frase que a tela mostra no lugar do painel.
 *
 * Mora aqui, e não na rota, porque é a mesma resposta para quem quer que
 * pergunte — e porque é pura: dá para conferir cada uma das três frases sem
 * banco nenhum. O que ela nunca faz é dizer "não foi importado" sobre um
 * arquivo que está no banco com nome e data.
 */
export function fraseDoPainelAusente(ausencia: PainelAusente): string {
  const rotina = DESCRICAO_DA_FONTE.PAGAMENTO.rotina;
  const semPainel = "sem ela o painel da planilha não tem de onde sair";

  if (ausencia.motivo === "SEM_DOCUMENTO") {
    return (
      `O ${rotina} (demonstrativo de pagamento) não foi importado nesta competência — e é ` +
      `ele que abre a parcela fixa verba a verba. Sem ele o painel da planilha não tem de ` +
      `onde sair.`
    );
  }

  const quando = ausencia.enviadoEm.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const qual = `"${ausencia.nomeDoArquivo}", enviado em ${quando}`;
  /* A primeira recusa é a pista: ela nomeia, em uma frase, o que o leitor não
     reconheceu — e é o que diz se o arquivo é o errado ou se o export saiu
     truncado. As demais estão na tela do documento. */
  const pista =
    ausencia.recusas.length > 0
      ? ` O leitor recusou ${ausencia.recusas.length} linha(s); a primeira diz: ` +
        `"${ausencia.recusas[0]?.motivo ?? ""}".`
      : "";

  if (ausencia.motivo === "EM_QUARENTENA") {
    return (
      `O ${rotina} desta competência — ${qual} — chegou, mas não valeu: ficou em quarentena ` +
      `por não trazer nenhuma verba, e a competência segue sem demonstrativo vigente. É a ` +
      `verba que abre a parcela fixa, e ${semPainel}.${pista} O arquivo está guardado ` +
      `inteiro, para exame; envie o ${rotina} completo por cima.`
    );
  }

  const oQueTem =
    ausencia.descontos > 0
      ? `o banco guardou ${ausencia.descontos} desconto(s) dele e nenhuma verba`
      : `o leitor não reconheceu nenhuma linha dele`;
  /*
    As duas saídas, e nesta ordem, porque a primeira é a que não custa nada a
    quem opera. O documento pode estar sem verba porque o arquivo não as tem —
    e aí o conserto é reexportar — ou porque a importação não as gravou, e aí o
    arquivo guardado já é o certo: reimportar refaz a leitura sobre ele. Mandar
    reenviar nos dois casos foi o que pôs quem operava a procurar um arquivo
    melhor do que o que já estava no banco.
  */
  return (
    `O ${rotina} desta competência foi importado — ${qual} —, e não sustenta verba nenhuma: ` +
    `${oQueTem}. É a verba que abre a parcela fixa, e ${semPainel}.${pista} Se o arquivo ` +
    `estiver certo, reimporte-o na lista de relatórios: a leitura é refeita sobre os bytes ` +
    `guardados, sem reenviar nada. Se não estiver, envie o ${rotina} completo por cima — hoje ` +
    `o arquivo é conferido antes de valer, e um que não traga verba não substitui mais o que ` +
    `estiver de pé.`
  );
}
