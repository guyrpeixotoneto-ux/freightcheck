import { and, desc, eq, sql } from "drizzle-orm";
import {
  fechamentoCompetenciaTable,
  fechamentoCteTable,
  fechamentoDocumentoTable,
  type Database,
} from "@workspace/db";
import type {
  Coletor,
  Leitura,
  PedidoDeColeta,
} from "@workspace/fluxos/monitoramento";

/**
 * O PRIMEIRO COLETOR REAL — `cte.autorizacao_sefaz`, lendo o extrato fiscal que
 * a empresa já importa hoje.
 *
 * ===========================================================================
 * 1. O que a investigação encontrou, e o que ela NÃO encontrou
 * ===========================================================================
 *
 * A fonte canônica de CT-e neste produto é **uma só**: `fechamento_cte` — o
 * relatório 03.08.15 do Promax, "os CT-es emitidos, verba a verba", importado
 * por quinzena junto com os outros quatro relatórios do fechamento (ver
 * `lib/fechamento/src/leitores/cte.ts`). Não há segunda tabela de CT-e nas 71
 * do schema, e este coletor não cria nenhuma: ele lê a que existe.
 *
 * O que essa tabela **não** tem, e nenhuma outra tem:
 *
 * - **status de autorização** — não existe coluna de situação, autorizado,
 *   rejeitado ou denegado em lugar nenhum do banco;
 * - **código de rejeição** — o 03.08.15 lista o que foi emitido; um CT-e
 *   rejeitado pela SEFAZ nunca chega a este arquivo, e portanto nunca chega
 *   aqui. O denominador "transmitidos" não existe no acervo;
 * - **carimbo do protocolo** — não há hora de autorização, e por isso o
 *   indicador "tempo médio emissão → autorização", que a própria etapa declara,
 *   não tem como ser calculado.
 *
 * Isso não é uma lacuna surpresa: a etapa "Autorização SEFAZ" do fluxo
 * CTe→Recebimento já declara, como gargalo levantado pela operação, *"Ausência
 * de integração — sem consulta automática de status, alguém precisa reconsultar
 * à mão"*. O banco reflete exatamente esse levantamento.
 *
 * **Por isso a taxa de autorização não é publicada aqui.** Inventar
 * "verde = 98% autorizado" sobre um arquivo que só contém autorizados daria
 * 100% sempre, em toda instalação, para sempre — um farol que não pode mudar de
 * cor não mede nada e ensina a operação a ignorar a tela.
 *
 * ===========================================================================
 * 2. A regra de negócio deste coletor, por extenso
 * ===========================================================================
 *
 * O que ele afirma, e o nome exato da afirmação: **há evidência fiscal de
 * autorização na quinzena corrente, e ela é rastreável na SEFAZ**. A
 * rastreabilidade é a chave de acesso — os 44 dígitos de `fechamento_cte.controle`
 * —, que é o único endereço pelo qual um documento pode ser consultado no portal
 * da SEFAZ. A própria etapa marca "Protocolo de autorização" como item
 * `obrigatório`; um CT-e emitido sem chave de acesso legível é um documento cujo
 * protocolo ninguém consegue conferir.
 *
 *  VERDE     O extrato CTE vigente da competência mais recente da empresa traz
 *            pelo menos um CT-e, e **todos** com chave de acesso de 44 dígitos.
 *            Afirma: emitiu-se com autorização e todo documento é conferível.
 *
 *  AMARELO   O mesmo extrato traz CT-es e **alguma** linha sem chave de acesso
 *            legível (vazia, curta ou com caractere que não é dígito). Afirma:
 *            emitiu-se, mas há documento cujo protocolo não se consegue
 *            conferir. Não há percentual arbitrário aqui — o limiar é "existe
 *            defeito", porque a chave de acesso ou está lá ou não está.
 *
 *  VERMELHO  O extrato existe, traz CT-es e **nenhum** deles tem chave de
 *            acesso. Afirma: o extrato fiscal da quinzena não evidencia
 *            autorização de documento nenhum — ou a importação perdeu a coluna,
 *            ou a emissão saiu sem chave. Nos dois casos a etapa está cega.
 *
 *  SEM_DADO  Tudo o mais, e é o motor que decide: a empresa não tem competência
 *            com extrato CTE vigente, o extrato está vazio, ou o último extrato
 *            é mais velho que a validade abaixo. O coletor simplesmente não
 *            devolve leitura — silêncio é "não sei", conforme o contrato.
 *
 * **O que este farol não diz, e está escrito no `texto` de toda leitura para a
 * tela não prometer mais do que mediu:** ele não mede taxa de rejeição, não vê
 * CT-e denegado e não sabe quanto tempo a SEFAZ levou para responder. Vermelho
 * aqui **não** significa "a SEFAZ está rejeitando" — esse dado não existe no
 * acervo (ver a seção 4).
 *
 * ===========================================================================
 * 3. A validade, e por que é a quinzena
 * ===========================================================================
 *
 * A fonte é um arquivo enviado uma vez por quinzena, e não um serviço
 * consultável. `medidoEm` é `fechamento_documento.enviadoEm` — o instante em
 * que o extrato entrou, que é quando o fato foi observado — e a validade é de
 * **dezesseis dias**: uma quinzena mais um dia de folga.
 *
 * Os dois erros possíveis foram medidos antes de escolher. Validade curta (uma
 * hora, o padrão do motor) deixaria a etapa cinza em 99% do tempo, porque a
 * fonte não é de tempo real — o farol seria inútil sem ser falso. Validade
 * longa (noventa dias) manteria um verde de julho aceso em outubro, que é o
 * defeito grave: afirmar normalidade sobre uma quinzena que ninguém importou.
 * Dezesseis dias é o intervalo em que a ausência do próximo extrato é, ela
 * mesma, a informação — a etapa apaga sozinha quando o fechamento atrasa.
 *
 * ===========================================================================
 * 4. O que falta para medir autorização de verdade, e o menor caminho
 * ===========================================================================
 *
 * Falta o retorno da transmissão, documento a documento: chave de acesso,
 * situação (autorizado / rejeitado / denegado), código de rejeição, carimbo de
 * emissão e carimbo do protocolo. Esse dado existe — no emissor (Unidox) e no
 * próprio ambiente autorizador —, e não neste banco.
 *
 * O menor caminho, na ordem de custo, e **sem tocar no motor**:
 *
 * 1. exportar do emissor o relatório de transmissões da quinzena, no mesmo
 *    formato dos outros cinco arquivos, e importá-lo como um `tipo` novo de
 *    `fechamento_documento` — a única migration necessária é a linha do CHECK
 *    mais a tabela de linhas, e o pipeline de leitura, versionamento e recusas
 *    já existe pronto;
 * 2. trocar a consulta deste arquivo pela nova tabela e publicar os dois
 *    indicadores que a etapa já declara: `% autorizado sem rejeição` e
 *    `tempo médio emissão → autorização`;
 * 3. só depois, se a operação quiser tempo real, uma consulta ao serviço de
 *    distribuição de DF-e — que é integração, com custo próprio, e que a esta
 *    altura já teria a tela provada com o dado em lote.
 *
 * Nada disso muda uma linha de `@workspace/fluxos/monitoramento`: troca-se a
 * consulta dentro deste arquivo e a régua de cores destes comentários. É essa
 * a prova de que a divisão está no lugar certo.
 */

/** Dezesseis dias — a quinzena da fonte, mais um dia de folga. */
export const VALIDADE_DO_EXTRATO_EM_SEGUNDOS = 16 * 24 * 60 * 60;

/** A chave da etapa "Autorização SEFAZ", e a única que este coletor reivindica. */
export const CHAVE = "cte.autorizacao_sefaz";

/** A chave de acesso do documento fiscal: 44 dígitos, sem exceção. */
const CHAVE_DE_ACESSO = "^[0-9]{44}$";

interface ExtratoDaQuinzena {
  competencia: string;
  enviadoEm: Date;
  ctes: number;
  rastreaveis: number;
}

/**
 * Monta o coletor sobre uma conexão.
 *
 * `db` entra **aqui**, no construtor, e não em `monitorarFluxo`: o motor
 * continua sem saber que existe banco, e cada coletor carrega a fonte dele. É
 * também o que mantém o isolamento simples de provar — a consulta abaixo filtra
 * por `fechamento_competencia.unidade_id`, que é a mesma `unidade` canônica que
 * o módulo de fluxos chama de empresa.
 */
export function coletorDeAutorizacaoSefaz(db: Database): Coletor {
  return {
    nome: "extrato-fiscal-03.08.15",
    prefixos: [CHAVE],
    async ler(pedido: PedidoDeColeta): Promise<readonly Leitura[]> {
      if (!pedido.chaves.includes(CHAVE)) return [];
      const extrato = await extratoMaisRecente(db, pedido.empresaId);
      /*
        Sem competência, sem extrato vigente, ou extrato sem uma linha de CT-e:
        silêncio. Um extrato vazio é a ausência do fato, não um fato ruim — e
        entregá-lo como vermelho seria o coletor decidindo sobre o fechamento,
        que não é o que esta etapa pergunta.
      */
      if (!extrato || extrato.ctes === 0) return [];

      const semChave = extrato.ctes - extrato.rastreaveis;
      const percentual = (extrato.rastreaveis / extrato.ctes) * 100;

      return [
        {
          chave: CHAVE,
          farol:
            semChave === 0
              ? "VERDE"
              : extrato.rastreaveis === 0
                ? "VERMELHO"
                : "AMARELO",
          medidoEm: extrato.enviadoEm.toISOString(),
          validadeEmSegundos: VALIDADE_DO_EXTRATO_EM_SEGUNDOS,
          valor: Number(percentual.toFixed(2)),
          unidade: "%",
          texto: frase(extrato, semChave),
        },
      ];
    },
  };
}

/**
 * O extrato CTE vigente da competência mais recente **desta empresa**.
 *
 * Três filtros, e os três importam: `unidade_id = empresa` é o isolamento —
 * competência sem unidade associada (`unidadeId` nulo, o legado que
 * `fechamento_competencia` descreve) não é de ninguém e não pinta o farol de
 * ninguém; `tipo = 'CTE'` escolhe o 03.08.15 entre os cinco relatórios; e
 * `vigente` escolhe o reenvio que a apuração usa, e não o arquivo substituído.
 */
async function extratoMaisRecente(
  db: Database,
  empresaId: string,
): Promise<ExtratoDaQuinzena | null> {
  const [documento] = await db
    .select({
      documentoId: fechamentoDocumentoTable.id,
      competencia: fechamentoCompetenciaTable.chave,
      enviadoEm: fechamentoDocumentoTable.enviadoEm,
    })
    .from(fechamentoDocumentoTable)
    .innerJoin(
      fechamentoCompetenciaTable,
      eq(fechamentoDocumentoTable.competenciaId, fechamentoCompetenciaTable.id),
    )
    .where(
      and(
        eq(fechamentoCompetenciaTable.unidadeId, empresaId),
        eq(fechamentoDocumentoTable.tipo, "CTE"),
        eq(fechamentoDocumentoTable.vigente, true),
      ),
    )
    .orderBy(
      desc(fechamentoCompetenciaTable.inicio),
      desc(fechamentoDocumentoTable.enviadoEm),
    )
    .limit(1);

  if (!documento) return null;

  /*
    A contagem acontece no banco, e não em memória: são ~23 mil linhas por
    quinzena, e trazer todas para contar quantas têm chave de acesso é o tipo de
    consulta que só dói em produção.
  */
  const [contagem] = await db
    .select({
      ctes: sql<number>`count(*)::int`,
      rastreaveis: sql<number>`count(*) filter (where ${fechamentoCteTable.controle} ~ ${CHAVE_DE_ACESSO})::int`,
    })
    .from(fechamentoCteTable)
    .where(eq(fechamentoCteTable.documentoId, documento.documentoId));

  return {
    competencia: documento.competencia,
    enviadoEm: documento.enviadoEm,
    ctes: contagem?.ctes ?? 0,
    rastreaveis: contagem?.rastreaveis ?? 0,
  };
}

/**
 * A frase que a etapa mostra. Ela diz o que foi medido **e** o que não foi —
 * é a única defesa contra a tela transformar "extrato íntegro" em "SEFAZ
 * saudável" na cabeça de quem olha.
 */
function frase(extrato: ExtratoDaQuinzena, semChave: number): string {
  const quantos = `${extrato.ctes.toLocaleString("pt-BR")} CT-e(s) no extrato ${extrato.competencia}`;
  if (semChave === 0) {
    return `${quantos}, todos com chave de acesso. Não mede rejeição da SEFAZ.`;
  }
  if (extrato.rastreaveis === 0) {
    return `${quantos}, nenhum com chave de acesso — o extrato não evidencia autorização.`;
  }
  return `${quantos}, ${semChave.toLocaleString("pt-BR")} sem chave de acesso. Não mede rejeição da SEFAZ.`;
}
