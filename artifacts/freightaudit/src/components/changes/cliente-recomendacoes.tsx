import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Ban,
  ChevronDown,
  CircleAlert,
  CircleDollarSign,
  ClipboardCheck,
  FileText,
  Handshake,
  Info,
  Search,
  TrendingDown,
  Truck,
  Users,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import {
  SeletorDeJanela,
  janelaParaQuery,
  type JanelaDeVigencias,
} from "@/components/changes/janela-vigencias";
import { Card } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import {
  formatBrl,
  formatBrlCompacto,
  formatBrlShort,
  formatNumber,
  formatValue,
  periodicitySuffix,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Cliente — **o que levar para a conversa, e o que não levar.**
 *
 * A aba Impacto mostra o universo do que mudou. Esta mostra o subconjunto em
 * que o movimento nos prejudica *e* existe algo objetivo a pedir — que é uma
 * lista muito menor, e é esse o ponto. Uma tela que listasse tudo que caiu
 * proporia recompor financiamentos quitados e reduzir a idade dos caminhões.
 *
 * A tela é uma **pauta**, e não uma fila de trabalho técnico: quem a abre está
 * montando a reunião com a Freightec, e a pergunta dele é o que entra nela.
 * Daí a forma — quatro números no topo, os itens da pauta em cartões lado a
 * lado, e as duas listas que fecham a preparação: o que não se leva, e o que
 * ainda precisa ser validado antes de virar proposta.
 *
 * Quatro decisões de tela seguem daí, e nenhuma é estética:
 *
 * **Propostas e investigações se intercalam na pauta.** Uma investigação de
 * R$ 731 mil vale mais atenção do que uma proposta de R$ 300, e separá-las em
 * blocos enterraria a maior pergunta do mês embaixo da menor proposta. A ordem
 * é o dinheiro; a etiqueta de prioridade diz o que fazer com cada cartão.
 *
 * **O que não vira proposta continua visível, com o motivo.** Quem confere a
 * planilha vai encontrar o `custoFixo` da carreta e o `lucroVariavelPrevisto`, e
 * precisa achar por que não estão na pauta. O painel “O que não propor” resume
 * por categoria e a lista inteira continua abaixo. Some da pauta, não da tela.
 *
 * **As categorias dos dois painéis particionam a população.** Cada item cai em
 * exatamente uma linha, e a soma das linhas é o total do painel — é o que
 * permite ler “2 pendências” no ladrilho e achar as duas embaixo.
 *
 * **Mensal e anual nunca ocupam o mesmo número.** R$ 731 mil por ano e R$ 52
 * mil por mês não somam, e o ladrilho do topo mostra as duas linhas separadas em
 * vez de escolher uma.
 */

type Situacao =
  | "PROPOR_AJUSTE"
  | "INVESTIGAR"
  | "NAO_PROPOR"
  | "NAO_CALCULAVEL";

type Confianca = "ALTA" | "MEDIA" | "BAIXA";

interface ImpactoEstimado {
  valor: number;
  periodicidade: string | null;
  mensal: number | null;
  anual: number | null;
  projetado: boolean;
  explicacao: string;
}

interface OQueAconteceu {
  antes: number;
  depois: number;
  unidade: string | null;
  effectiveDate: string;
  sourceLabel: string;
  entidades: number;
  entidadesEmSentidoOposto: number;
  padroes: number;
  cobertura: number;
}

export interface Recomendacao {
  code: string;
  title: string;
  entityType: string;
  equipment: string;
  situacao: Situacao;
  confianca: Confianca;
  papel: string | null;
  sentido: string | null;
  acionavel: string | null;
  mecanismo: string;
  efeito: string;
  direcoesMistas: boolean;
  oQueAconteceu: OQueAconteceu | null;
  porque: string;
  impacto: ImpactoEstimado | null;
  impactoMotivo: string;
  valorAtual: number | null;
  valorRecomendado: number | null;
  diferenca: number | null;
  fonte: string | null;
  oQuePerguntar: string | null;
  veiculosAfetados: number;
  veiculosNaSerie: number;
  alteracoes: number;
  alimenta: string[];
  dependeDe: string[];
  evidencia: string;
}

interface TotalPorPeriodicidade {
  periodicity: string | null;
  identificado: number;
  recuperavel: number;
  emInvestigacao: number;
}

interface Resposta {
  context: {
    label: string;
    periodosDisponiveis: string[];
    periodosNaJanela: number;
    janela: { de: string; ate: string } | null;
  };
  periods: { effectiveDate: string; sourceLabel: string; entityTypes: string[] }[];
  entityTypes: string[];
  entityType: string | null;
  equipment: string | null;
  recomendacoes: Recomendacao[];
  totais: {
    porPeriodicidade: TotalPorPeriodicidade[];
    propor: number;
    investigar: number;
    naoPropor: number;
    naoCalculavel: number;
    analisadas: number;
    veiculosAlcancados: number;
    percentualExplicado: number | null;
  };
  foraDaConta: { code: string; title: string; porque: string }[];
}

const POR_PERIODO: Record<string, string> = {
  MENSAL: "por mês",
  ANUAL: "por ano",
  PONTUAL: "valor único",
};

const CONFIANCA: Record<Confianca, string> = {
  ALTA: "confiança alta",
  MEDIA: "confiança média",
  BAIXA: "confiança baixa",
};

/** Nomes de leitura dos enums, para a tela não exibir um `SCREAMING_CASE`. */
const PAPEL: Record<string, string> = {
  MONTANTE: "montante",
  TAXA: "taxa",
  PRAZO: "prazo",
  RELOGIO: "relógio",
  DRIVER_FISICO: "grandeza física",
  ESPECIFICACAO: "especificação",
  IDENTIFICACAO: "identificação",
};

const ACIONAVEL: Record<string, string> = {
  NEGOCIAVEL: "parametrizado pelo cliente",
  INDEXADO_EXTERNO: "índice publicado por terceiro",
  AUTOMATICO: "muda por mecanismo próprio",
  CADASTRAL: "cadastro do ativo",
  DESCONHECIDO: "não levantado",
};

const FONTE: Record<string, string> = {
  CONTRATO: "contrato",
  BOOK_OPERADOR: "Book do Operador",
  PARAMETRO_CONFIRMADO: "curadoria do parâmetro",
  REGRA_ECONOMICA: "regra econômica medida",
  DOCUMENTO_CLIENTE: "documento do cliente",
  BENCHMARK: "benchmark",
  HISTORICO: "histórico da série",
  VIGENCIA_ANTERIOR: "vigência anterior",
};

const SENTIDO: Record<string, string> = {
  DIRETO: "aumenta o parâmetro, aumenta a remuneração",
  INVERSO: "aumenta o parâmetro, reduz a remuneração",
  NULO: "não mexe na remuneração",
  NAO_MONOTONICO: "o efeito muda de sinal conforme a faixa",
  DEPENDE_DE_FORMULA: "o efeito depende da fórmula da fonte",
  DESCONHECIDO: "efeito ainda não levantado",
};

// ---------------------------------------------------------------------------
// A leitura de pauta — funções puras, e é onde a tela decide o que diz
// ---------------------------------------------------------------------------

export type Prioridade = "ALTA" | "MEDIA" | "ATENCAO";

/**
 * A etiqueta do cartão.
 *
 * Prioridade aqui **não** é o tamanho do número: é o que se pode fazer com a
 * linha. Uma proposta com valor apurado e confiança alta é a única coisa que se
 * leva pronta para a mesa; uma proposta de confiança média entra com a ressalva
 * junto; e uma investigação nunca vira “prioridade”, por maior que seja o
 * dinheiro — ela é atenção, porque o que ela pede é uma pergunta, não um
 * pedido. O dinheiro já ordena a lista; misturá-lo à etiqueta faria a tela
 * mandar propor o que ainda não se sabe.
 */
export function prioridadeDaPauta(r: Recomendacao): Prioridade {
  if (r.situacao !== "PROPOR_AJUSTE") return "ATENCAO";
  return r.confianca === "ALTA" ? "ALTA" : "MEDIA";
}

const PRIORIDADE: Record<Prioridade, { rotulo: string; classe: string }> = {
  ALTA: {
    rotulo: "Alta prioridade",
    classe: "bg-destructive/10 text-destructive border-destructive/30",
  },
  /*
    Âmbar literal, e não `text-warning-foreground`: aquele token é o marinho que
    se escreve **sobre** o laranja cheio, e sobre um véu de 15% ele sumia no
    escuro. `dark:text-amber-500` é a mesma convenção do DRE.
  */
  MEDIA: {
    rotulo: "Média prioridade",
    classe:
      "bg-amber-500/15 text-amber-700 dark:text-amber-500 border-amber-500/30",
  },
  ATENCAO: {
    rotulo: "Atenção",
    classe: "bg-brand/10 text-brand border-brand/30",
  },
};

/** Uma linha dos painéis do rodapé: o rótulo, e quantos itens ele cobre. */
export interface Categoria {
  chave: string;
  rotulo: string;
  quantidade: number;
}

/**
 * Classifica por **primeira regra que casa**, e é isso que faz a soma fechar.
 *
 * Categorias que se sobrepõem produziriam um painel cujas linhas somam mais do
 * que a população — e o ladrilho do topo passaria a discordar do painel logo
 * abaixo dele. O resto que não casar com nenhuma regra cai numa linha própria
 * em vez de sumir: uma categoria a mais é um incômodo, um item invisível é um
 * erro.
 */
export function classificar<T>(
  itens: T[],
  regras: { chave: string; rotulo: string; quando: (item: T) => boolean }[],
  restante: { chave: string; rotulo: string },
): Categoria[] {
  const contagem = new Map(regras.map((r) => [r.chave, 0]));
  let sobra = 0;

  for (const item of itens) {
    const regra = regras.find((r) => r.quando(item));
    if (regra) contagem.set(regra.chave, contagem.get(regra.chave)! + 1);
    else sobra += 1;
  }

  const categorias = regras.map((r) => ({
    chave: r.chave,
    rotulo: r.rotulo,
    quantidade: contagem.get(r.chave)!,
  }));
  if (sobra > 0) categorias.push({ ...restante, quantidade: sobra });

  return categorias.filter((c) => c.quantidade > 0);
}

/** O que mudou e não é assunto de cliente, pelo motivo de não ser. */
export function categoriasNaoPropor(recs: Recomendacao[]): Categoria[] {
  return classificar(
    recs,
    [
      {
        chave: "AUMENTA",
        rotulo: "Mudanças que aumentaram a nossa remuneração",
        quando: (r) => r.efeito === "AUMENTA",
      },
      {
        chave: "SEM_EFEITO",
        rotulo: "Variações sem efeito sobre a remuneração",
        quando: (r) => r.efeito === "SEM_EFEITO",
      },
      {
        chave: "MECANISMO",
        rotulo:
          "Quedas por mecanismo próprio — financiamento encerrado, cadastro, calendário",
        quando: (r) => r.efeito === "REDUZ",
      },
    ],
    { chave: "OUTROS", rotulo: "Outros casos sem pedido a fazer" },
  );
}

/**
 * O que precisa acontecer antes de qualquer uma destas linhas virar proposta.
 *
 * A população é a mesma do ladrilho de pendências — investigações e o que ainda
 * não tem leitura econômica —, e as categorias a particionam. O que separa uma
 * frente da outra é o **tipo de trabalho**: confirmar semântica é curadoria,
 * separar direções opostas é leitura ativo a ativo, e fechar o impacto é obter
 * uma régua financeira que hoje não existe.
 */
export function categoriasPendentes(recs: Recomendacao[]): Categoria[] {
  return classificar(
    recs,
    [
      {
        chave: "SEMANTICA",
        rotulo: "Validar a semântica de parâmetros ainda não confirmados",
        quando: (r) => r.situacao === "NAO_CALCULAVEL",
      },
      {
        chave: "DIRECOES",
        rotulo: "Separar os casos com ativos em direções opostas",
        quando: (r) => r.direcoesMistas,
      },
      {
        chave: "IMPACTO",
        rotulo: "Fechar o impacto financeiro dos itens inconclusivos",
        quando: (r) => r.impacto === null,
      },
      {
        chave: "REFERENCIA",
        rotulo: "Obter a referência que sustente o valor a pedir",
        quando: () => true,
      },
    ],
    { chave: "OUTROS", rotulo: "Outras pendências" },
  );
}

/**
 * O racional de apoio do cartão — a abrangência, na língua da reunião.
 *
 * Diz quantos ativos a linha alcança dentro do total da série, porque “64
 * veículos” sem denominador é uma afirmação que não se confere. Quando há
 * ativos em direções opostas, eles vêm junto: é a informação que impede alguém
 * de levar o líquido como se fosse o caso de todo mundo.
 */
export function racionalDeApoio(r: Recomendacao): string {
  const equipamento = r.equipment.toLowerCase();
  const base =
    r.veiculosNaSerie > 0
      ? `${formatNumber(r.veiculosAfetados, 0)} de ${formatNumber(r.veiculosNaSerie, 0)} ${equipamento}s afetados`
      : `${formatNumber(r.veiculosAfetados, 0)} ${equipamento}s afetados`;
  const opostos = r.oQueAconteceu?.entidadesEmSentidoOposto ?? 0;
  return opostos > 0
    ? `${base} · ${formatNumber(opostos, 0)} para o lado contrário`
    : base;
}

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

export function ClienteRecomendacoes({
  onAbrirImpacto,
  janela = {},
  onJanela,
}: {
  onAbrirImpacto?: (escolha: { entityType: string; code: string }) => void;
  /**
   * O mesmo recorte De/Até da aba Impacto, vindo de cima.
   *
   * Não é uma cópia do filtro de lá: é o mesmo estado, e é o que garante que
   * "quanto isso custou" e "o que pedir ao cliente" respondam sobre o mesmo
   * período. Duas telas com recortes independentes dariam dois números certos e
   * uma comparação errada.
   */
  janela?: JanelaDeVigencias;
  onJanela?: (j: JanelaDeVigencias) => void;
}) {
  const [entityType, setEntityType] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["cliente", "recomendacoes", entityType, janela.de, janela.ate],
    queryFn: () =>
      fetchJson<Resposta>(
        `/cliente/recomendacoes?${entityType ? `entityType=${entityType}` : ""}` +
          janelaParaQuery(janela),
      ),
  });

  if (query.error) {
    return (
      <ApiErrorNotice
        error={query.error}
        what="As recomendações ao cliente não puderam ser carregadas."
      />
    );
  }

  const data = query.data;
  if (!data) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted-foreground">Lendo as vigências…</p>
      </Card>
    );
  }

  const { totais } = data;
  const pauta = data.recomendacoes.filter(
    (r) => r.situacao === "PROPOR_AJUSTE" || r.situacao === "INVESTIGAR",
  );
  const naoPropor = data.recomendacoes.filter((r) => r.situacao === "NAO_PROPOR");
  const naoCalculavel = data.recomendacoes.filter(
    (r) => r.situacao === "NAO_CALCULAVEL",
  );
  /*
    A pendência é tudo que ainda não pode virar pedido: a investigação, que tem
    a pergunta mas não a resposta, e o que sequer tem leitura econômica. As duas
    populações viajam juntas porque o trabalho que falta é o mesmo tipo de
    trabalho — descobrir algo antes da reunião, e não decidir na reunião.
  */
  const pendentes = [
    ...data.recomendacoes.filter((r) => r.situacao === "INVESTIGAR"),
    ...naoCalculavel,
  ];
  const recuperavel = totais.porPeriodicidade.filter((p) => p.recuperavel > 0);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          O que levar para a Freightec
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl mt-1">
          Esta aba resume apenas o que vale a pena propor, o que não deve ser
          levado e o que ainda precisa de validação antes da conversa com o
          cliente.
        </p>
      </div>

      {/*
        Os dois recortes vêm da mesma autoridade da aba Impacto: as vigências
        escolhíveis são as que o contexto entregou, e os equipamentos são os que
        `listImpactEntityTypes` conhece. Reconstruir qualquer um dos dois aqui
        faria a aba oferecer um período ou um equipamento que a série nunca teve.
      */}
      {onJanela && (
        <SeletorDeJanela
          disponiveis={data.context.periodosDisponiveis}
          rotulos={Object.fromEntries(
            data.periods.map((p) => [p.effectiveDate, p.sourceLabel]),
          )}
          janela={janela}
          onJanela={onJanela}
          noRecorte={data.context.periodosNaJanela}
        />
      )}

      {data.entityTypes.length > 1 && (
        <div className="flex items-center gap-2">
          <Pilula ativo={entityType === null} onClick={() => setEntityType(null)}>
            Frota inteira
          </Pilula>
          {data.entityTypes.map((tipo) => (
            <Pilula
              key={tipo}
              ativo={entityType === tipo}
              onClick={() => setEntityType(tipo)}
            >
              {tipo === "CAVALO" ? "Cavalos" : tipo === "CARRETA" ? "Carretas" : tipo}
            </Pilula>
          ))}
        </div>
      )}

      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <Ladrilho
          tone="green"
          icon={<ClipboardCheck className="w-6 h-6" />}
          label="Propostas recomendadas"
          linhas={[{ valor: formatNumber(totais.propor, 0), unidade: "" }]}
          hint="Itens com argumento sólido e impacto apurado"
        />
        {/*
          O único ladrilho que pode ter mais de uma linha, e é de propósito:
          R$ 731 mil por ano e R$ 52 mil por mês não somam, e escolher um dos
          dois para caber esconderia metade do que está em jogo.
        */}
        <Ladrilho
          tone="blue"
          icon={<CircleDollarSign className="w-6 h-6" />}
          label="Impacto potencial recuperável"
          linhas={
            recuperavel.length > 0
              ? recuperavel.map((p) => ({
                  valor: formatBrlCompacto(p.recuperavel),
                  unidade: periodicitySuffix(p.periodicity),
                }))
              : [{ valor: "—", unidade: "" }]
          }
          hint={
            recuperavel.length > 0
              ? "Soma do impacto estimado das propostas recomendadas"
              : "Nenhuma proposta com valor apurado neste recorte"
          }
        />
        <Ladrilho
          tone="purple"
          icon={<Truck className="w-6 h-6" />}
          label="Veículos afetados"
          linhas={[{ valor: formatNumber(totais.veiculosAlcancados, 0), unidade: "" }]}
          hint="Maior alcance entre os itens da pauta — as placas se repetem entre linhas, e somá-las contaria o mesmo veículo duas vezes"
        />
        <Ladrilho
          tone="amber"
          icon={<CircleAlert className="w-6 h-6" />}
          label="Pendências para validar"
          linhas={[
            {
              valor: formatNumber(totais.investigar + totais.naoCalculavel, 0),
              unidade: "",
            },
          ]}
          hint="Pontos que exigem validação antes de virar proposta"
        />
      </div>

      {/* ---- a pauta ---------------------------------------------------- */}
      <div>
        <h3 className="text-base font-semibold tracking-tight mb-3">
          Pauta recomendada
        </h3>

        {pauta.length === 0 ? (
          <Card className="p-6">
            {/*
              Recorte de uma vigência só e recorte em que nada mudou parecem a
              mesma coisa de fora, e são respostas opostas: um não comparou nada,
              o outro comparou e não achou. A tela diz qual dos dois é.
            */}
            {data.context.periodosNaJanela < 2 ? (
              <>
                <p className="text-sm">
                  <strong>Este recorte tem uma vigência só.</strong>
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                  Não há par para comparar, e portanto nada a recomendar — o que
                  não é o mesmo que “nada mudou”. Abra o recorte para incluir pelo
                  menos duas vigências.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm">
                  <strong>Nada a propor nem a investigar neste recorte.</strong>
                </p>
                <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
                  As {formatNumber(totais.analisadas, 0)} linhas econômicas que
                  mudaram estão abaixo, cada uma com a razão de não virar assunto:
                  favoráveis a nós, neutras, cadastrais ou consequência de
                  mecanismo próprio. Zero recomendações é um resultado — uma
                  proposta errada custa mais do que nenhuma.
                </p>
              </>
            )}
          </Card>
        ) : (
          /*
            `items-start`, e não a esticada natural da grade: abrir o detalhe
            técnico de um cartão cresce a linha inteira, e com os irmãos
            esticados o crescimento vira um vazio de meia tela dentro deles. Com
            cada cartão na sua altura, quem cresce é só o que foi aberto.
          */
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3 items-start">
            {pauta.map((r, i) => (
              <CartaoDePauta
                key={r.code}
                r={r}
                posicao={i + 1}
                onAbrirImpacto={onAbrirImpacto}
              />
            ))}
          </div>
        )}
      </div>

      {/* ---- o que não se leva, e o que ainda falta --------------------- */}
      <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 items-start">
        <Painel
          tone="red"
          icon={<Ban className="w-5 h-5" />}
          titulo="O que não propor"
          categorias={categoriasNaoPropor(naoPropor)}
          vazio="Tudo que mudou neste recorte virou pauta ou pendência."
          rodape="Cada linha é uma categoria fechada: um item cai em uma só, e a soma é o total que a lista abaixo detalha."
        />
        <Painel
          tone="blue"
          icon={<Info className="w-5 h-5" />}
          titulo="Antes de levar ao cliente"
          categorias={categoriasPendentes(pendentes)}
          vazio="Nenhuma pendência aberta neste recorte."
          rodape="É o trabalho que precede a reunião — o que sai daqui vira proposta na próxima leitura, ou sai da conversa com o motivo escrito."
        />
      </div>

      {/* ---- as listas inteiras, para quem confere ---------------------- */}
      <Dobra
        titulo="Não propor"
        contagem={naoPropor.length}
        detalhe="Mudaram, e não são assunto de cliente: favoráveis a nós, neutras, cadastrais ou consequência de um mecanismo próprio. Ficam aqui porque “não aparece na lista” e “aparece dizendo que está certo” não são a mesma resposta para quem confere."
      >
        {naoPropor.map((r) => (
          <LinhaSimples key={r.code} r={r} onAbrirImpacto={onAbrirImpacto} />
        ))}
      </Dobra>

      <Dobra
        titulo="Não calculável"
        contagem={naoCalculavel.length}
        detalhe="A alteração existe e a semântica ainda não permite lê-la economicamente. Não vira zero: vira uma fila de trabalho — registrar o comportamento econômico do parâmetro, ou confirmar a semântica na curadoria."
      >
        {naoCalculavel.map((r) => (
          <LinhaSimples key={r.code} r={r} onAbrirImpacto={onAbrirImpacto} />
        ))}
      </Dobra>

      <Dobra
        titulo="Fora da conta — colunas de conjunto"
        contagem={data.foraDaConta.length}
        detalhe="Estas colunas já carregam o outro equipamento dentro delas. Levá-las junto com a linha do cavalo seria discutir o mesmo dinheiro duas vezes."
      >
        {data.foraDaConta.map((f) => (
          <div key={f.code} className="px-4 py-3 border-b last:border-0">
            <div className="font-medium text-sm">{f.title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{f.porque}</div>
          </div>
        ))}
      </Dobra>

      <ResumoExecutivo
        contexto={data.context.label}
        vigencias={data.periods.length}
        analisadas={totais.analisadas}
      />
    </div>
  );
}

/**
 * Um item da pauta.
 *
 * A ordem dos blocos é a ordem da conversa: a etiqueta do que fazer, o assunto,
 * por que ele nos prejudica, e o rodapé com as três coisas que a reunião
 * pergunta — quanto vale, o que pedir, e em cima de quantos ativos. O detalhe
 * técnico fica atrás de um clique: quem está montando a pauta não precisa dele,
 * e quem vai defender o número precisa dele inteiro.
 *
 * Enquanto fechado, o cartão limita as duas frases longas a três linhas — é o
 * que mantém os cartões da mesma fileira comparáveis a olho. Abrir o detalhe
 * solta as duas: o texto é cortado na exibição, nunca na fonte.
 */
function CartaoDePauta({
  r,
  posicao,
  onAbrirImpacto,
}: {
  r: Recomendacao;
  posicao: number;
  onAbrirImpacto?: (escolha: { entityType: string; code: string }) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const prioridade = PRIORIDADE[prioridadeDaPauta(r)];

  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="px-5 pt-4 pb-3 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              prioridade.classe,
            )}
          >
            {r.situacao === "PROPOR_AJUSTE" ? (
              <Handshake className="w-3.5 h-3.5" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            {prioridade.rotulo}
          </span>
          <span className="text-xs tabular-nums text-muted-foreground shrink-0">
            #{posicao}
          </span>
        </div>

        <h4 className="text-base font-semibold tracking-tight mt-2.5">
          {r.title}
          <span className="text-xs text-muted-foreground font-normal ml-2">
            {r.equipment.toLowerCase()} · {CONFIANCA[r.confianca]}
          </span>
        </h4>

        <p
          className={cn(
            "text-sm text-muted-foreground mt-1 leading-relaxed",
            !aberto && "line-clamp-3",
          )}
        >
          {r.porque}
        </p>

        {/*
          O par antes → depois é o padrão predominante, e o cartão precisa dizer
          quando ele é só isso. Uma premissa compartilhada move a frota inteira
          do mesmo valor para o mesmo valor; um montante por ativo tem dezenas
          de pares, e mostrar um deles sem a ressalva faria o cartão parecer um
          resumo quando é uma ilustração.
        */}
        {r.oQueAconteceu && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums">
            <span className="text-muted-foreground">
              {formatValue(r.oQueAconteceu.antes, r.oQueAconteceu.unidade)}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-medium">
              {formatValue(r.oQueAconteceu.depois, r.oQueAconteceu.unidade)}
            </span>
            <span className="text-xs text-muted-foreground">
              em {r.oQueAconteceu.sourceLabel}
            </span>
            {r.oQueAconteceu.padroes > 1 && (
              <span className="text-xs rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                padrão predominante de {formatNumber(r.oQueAconteceu.padroes, 0)}
              </span>
            )}
          </div>
        )}
      </div>

      {/*
        Uma grade de duas colunas, e não três linhas independentes: os três
        termos são de larguras parecidas, e sem a coluna comum os valores
        começariam em três `x` diferentes dentro do mesmo cartão.
      */}
      <dl className="border-t px-5 py-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2.5">
        <LinhaDoCartao
          icon={<TrendingDown className="w-4 h-4" />}
          termo="Impacto estimado"
          alinhamento="direita"
        >
          {r.impacto ? (
            <span
              className={cn(
                "font-semibold tabular-nums",
                r.impacto.valor < 0 ? "text-destructive" : "text-emerald-600",
              )}
              title={`${formatBrl(r.impacto.valor)} ${POR_PERIODO[r.impacto.periodicidade ?? ""] ?? ""}`.trim()}
            >
              {formatBrlCompacto(r.impacto.valor)}
              {periodicitySuffix(r.impacto.periodicidade)}
            </span>
          ) : (
            <span className="text-muted-foreground">
              não apurado — {r.impactoMotivo || "sem régua financeira"}
            </span>
          )}
        </LinhaDoCartao>

        <LinhaDoCartao
          icon={<Handshake className="w-4 h-4" />}
          termo={r.situacao === "PROPOR_AJUSTE" ? "Pedido sugerido" : "O que perguntar"}
        >
          <span className={cn("block", !aberto && "line-clamp-3")}>
            {r.oQuePerguntar ?? "—"}
          </span>
        </LinhaDoCartao>

        <LinhaDoCartao icon={<Users className="w-4 h-4" />} termo="Racional de apoio">
          {racionalDeApoio(r)}
        </LinhaDoCartao>
      </dl>

      <div className="border-t bg-muted/20 px-5 py-2 flex items-center gap-4">
        <button
          onClick={() => setAberto((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          <ChevronDown
            className={cn("w-3.5 h-3.5 transition-transform", aberto && "rotate-180")}
          />
          detalhe técnico
        </button>
        {onAbrirImpacto && (
          <button
            onClick={() => onAbrirImpacto({ entityType: r.entityType, code: r.code })}
            className="text-xs text-brand hover:underline inline-flex items-center gap-1"
          >
            ver por placa e vigência
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {aberto && <DetalheTecnico r={r} />}
    </Card>
  );
}

/**
 * Uma das três linhas do rodapé do cartão — o par termo/valor da grade.
 *
 * Devolve `dt` e `dd` soltos, e não um `div` em volta: eles precisam ser filhos
 * diretos da grade do cartão para dividirem a mesma coluna de termos. Um
 * invólucro por linha devolveria cada valor ao seu próprio alinhamento.
 *
 * O dinheiro alinha à direita e o texto à esquerda de propósito: número se
 * compara pela unidade, e frase se lê pelo começo.
 */
function LinhaDoCartao({
  icon,
  termo,
  alinhamento = "esquerda",
  children,
}: {
  icon: React.ReactNode;
  termo: string;
  alinhamento?: "esquerda" | "direita";
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className="text-muted-foreground/70">{icon}</span>
        {termo}
      </dt>
      <dd
        className={cn(
          "text-sm min-w-0",
          alinhamento === "direita" ? "text-right" : "text-left",
        )}
      >
        {children}
      </dd>
    </>
  );
}

/**
 * O detalhe técnico.
 *
 * Existe para uma pessoa só: quem vai defender o número na frente do cliente e
 * precisa saber de onde ele saiu. Por isso a evidência vem inteira, com o
 * código da coluna ao lado — o rótulo de leitura é o que se fala na reunião, e
 * o código é o que se acha na planilha.
 */
function DetalheTecnico({ r }: { r: Recomendacao }) {
  return (
    <div className="border-t px-5 py-4 bg-muted/10 text-sm space-y-3">
      {/*
        Uma coluna só: o detalhe abre dentro de um cartão de um terço de tela, e
        duas colunas ali quebram “aumenta o parâmetro, aumenta a remuneração” em
        quatro linhas de duas palavras.
      */}
      <dl className="grid gap-x-6 gap-y-1.5">
        <Campo termo="Coluna">
          <code className="text-xs">{r.code}</code>
        </Campo>
        <Campo termo="Papel econômico">{PAPEL[r.papel ?? ""] ?? "não declarado"}</Campo>
        <Campo termo="Comportamento">
          {SENTIDO[r.sentido ?? ""] ?? "não declarado"}
        </Campo>
        <Campo termo="Quem muda">{ACIONAVEL[r.acionavel ?? ""] ?? "—"}</Campo>
        <Campo termo="Alterações na série">
          {formatNumber(r.alteracoes, 0)}
        </Campo>
        {r.alimenta.length > 0 && (
          <Campo termo="O dinheiro aparece em">{r.alimenta.join(", ")}</Campo>
        )}
        {r.dependeDe.length > 0 && (
          <Campo termo="Depende de">{r.dependeDe.join(", ")}</Campo>
        )}
      </dl>

      {/*
        As duas periodicidades do impacto vivem aqui, e não no rodapé do cartão:
        lá o número é o da periodicidade declarada, e a projeção — que passa por
        uma premissa — precisa da frase que a sustenta ao lado.
      */}
      {r.impacto && (
        <div className="text-sm tabular-nums">
          <Rotulo>Impacto na periodicidade declarada</Rotulo>
          <p className="mt-0.5">
            {formatBrl(r.impacto.valor)}{" "}
            {POR_PERIODO[r.impacto.periodicidade ?? ""] ?? "sem periodicidade"}
            {r.impacto.periodicidade === "MENSAL" && r.impacto.anual !== null && (
              <span className="text-muted-foreground">
                {" "}
                · {formatBrlShort(r.impacto.anual)} por ano
                {r.impacto.projetado && " — projeção linear"}
              </span>
            )}
            {r.impacto.periodicidade === "ANUAL" && r.impacto.mensal !== null && (
              <span className="text-muted-foreground">
                {" "}
                · {formatBrlShort(r.impacto.mensal)} por mês
                {r.impacto.projetado && " — projeção linear"}
              </span>
            )}
          </p>
        </div>
      )}

      {r.valorRecomendado !== null && (
        <dl className="grid gap-x-6 gap-y-1.5">
          <Campo termo="Valor atual">
            {formatValue(r.valorAtual, r.oQueAconteceu?.unidade ?? null)}
          </Campo>
          <Campo termo="Valor recomendado">
            {formatValue(r.valorRecomendado, r.oQueAconteceu?.unidade ?? null)}
          </Campo>
          <Campo termo="Diferença">
            {formatValue(r.diferenca, r.oQueAconteceu?.unidade ?? null)}
          </Campo>
          <Campo termo="Fonte">{FONTE[r.fonte ?? ""] ?? "—"}</Campo>
        </dl>
      )}

      {r.mecanismo && (
        <div>
          <Rotulo>Mecanismo</Rotulo>
          <p className="text-sm mt-0.5 leading-relaxed">{r.mecanismo}</p>
        </div>
      )}

      {r.evidencia && (
        <div>
          <Rotulo>Evidência</Rotulo>
          <p className="text-sm mt-0.5 leading-relaxed text-muted-foreground">
            {r.evidencia}
          </p>
        </div>
      )}

      {r.impacto?.explicacao && (
        <div>
          <Rotulo>Como o valor foi projetado</Rotulo>
          <p className="text-sm mt-0.5 leading-relaxed text-muted-foreground">
            {r.impacto.explicacao}
          </p>
        </div>
      )}
    </div>
  );
}

const PAINEL = {
  red: {
    caixa: "bg-destructive/10 text-destructive",
    marcador: "bg-destructive",
  },
  blue: {
    caixa: "bg-brand/10 text-brand",
    marcador: "bg-brand",
  },
} as const;

/**
 * Um dos dois painéis que fecham a preparação.
 *
 * Eles resumem por categoria o que a pauta deixou de fora — o que não se leva e
 * o que ainda não pode ser levado. A contagem fica à direita de cada linha
 * porque é ela que dá a escala: “mudanças que nos favoreceram” muda de sentido
 * entre uma e trinta.
 */
function Painel({
  tone,
  icon,
  titulo,
  categorias,
  vazio,
  rodape,
}: {
  tone: keyof typeof PAINEL;
  icon: React.ReactNode;
  titulo: string;
  categorias: Categoria[];
  vazio: string;
  rodape: string;
}) {
  const cores = PAINEL[tone];

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "h-8 w-8 rounded-lg grid place-content-center shrink-0",
            cores.caixa,
          )}
        >
          {icon}
        </span>
        <h3 className="text-base font-semibold tracking-tight">{titulo}</h3>
      </div>

      {categorias.length === 0 ? (
        <p className="text-sm text-muted-foreground mt-3">{vazio}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {categorias.map((c) => (
            <li key={c.chave} className="flex items-start justify-between gap-3">
              <span className="flex items-start gap-2.5 text-sm min-w-0">
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 rounded-full shrink-0",
                    cores.marcador,
                  )}
                  aria-hidden
                />
                {c.rotulo}
              </span>
              <span className="text-sm tabular-nums text-muted-foreground shrink-0">
                {formatNumber(c.quantidade, 0)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground mt-3 pt-3 border-t">{rodape}</p>
    </Card>
  );
}

/**
 * A faixa do rodapé — o que esta aba é, para quem chegou nela por engano.
 *
 * Ela também é o lugar da procedência: o contexto e o número de vigências vêm
 * da mesma autoridade das outras abas, e dizê-lo aqui é o que impede alguém de
 * comparar esta pauta com um Impacto de outro período.
 */
function ResumoExecutivo({
  contexto,
  vigencias,
  analisadas,
}: {
  contexto: string;
  vigencias: number;
  analisadas: number;
}) {
  return (
    <Card className="px-5 py-4 flex items-start gap-3">
      <span className="h-8 w-8 rounded-lg grid place-content-center shrink-0 bg-brand/10 text-brand">
        <FileText className="w-5 h-5" />
      </span>
      <div className="text-sm text-muted-foreground leading-relaxed">
        <strong className="text-foreground">Resumo executivo</strong>
        <span className="mx-2 text-border" aria-hidden>
          |
        </span>
        Esta aba não é uma fila de investigação técnica. Ela sintetiza propostas
        de negociação, exceções que não devem ser levadas e pendências que
        precisam de validação antes da conversa com o cliente. Das{" "}
        {formatNumber(analisadas, 0)} linhas econômicas que mudaram, entra na
        pauta só o que passou por três portas: existe leitura econômica do
        parâmetro, o movimento vai contra nós, e há algo objetivo a pedir ou a
        perguntar. O sinal do número não decide nada — quem decide é o
        comportamento declarado do parâmetro, porque uma taxa que cai reduz o que
        recebemos e uma idade que sobe não é premissa nenhuma.{" "}
        <strong className="text-foreground">
          O contexto é o mesmo das outras abas
        </strong>{" "}
        — {contexto}, {formatNumber(vigencias, 0)} vigências —, resolvido pela
        mesma autoridade, e não reconstruído aqui.
      </div>
    </Card>
  );
}

/** As linhas das dobras: nome, motivo, e nada mais. */
function LinhaSimples({
  r,
  onAbrirImpacto,
}: {
  r: Recomendacao;
  onAbrirImpacto?: (escolha: { entityType: string; code: string }) => void;
}) {
  return (
    <div className="px-4 py-3 border-b last:border-0 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="font-medium text-sm">
          {r.title}
          <span className="text-xs text-muted-foreground font-normal ml-2">
            {r.equipment.toLowerCase()}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          {r.porque}
        </div>
      </div>
      <div className="shrink-0 text-right">
        {r.impacto && (
          <div className="text-sm tabular-nums font-medium">
            {formatBrlShort(r.impacto.valor)}
            <span className="text-xs text-muted-foreground ml-1">
              {POR_PERIODO[r.impacto.periodicidade ?? ""] ?? ""}
            </span>
          </div>
        )}
        {onAbrirImpacto && (
          <button
            onClick={() => onAbrirImpacto({ entityType: r.entityType, code: r.code })}
            className="text-xs text-brand hover:underline mt-0.5"
          >
            ver detalhe
          </button>
        )}
      </div>
    </div>
  );
}

function Dobra({
  titulo,
  contagem,
  detalhe,
  children,
}: {
  titulo: string;
  contagem: number;
  detalhe: string;
  children: React.ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  if (contagem === 0) return null;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setAberto((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/30"
      >
        <ChevronDown
          className={cn(
            "w-4 h-4 mt-0.5 shrink-0 text-muted-foreground transition-transform",
            aberto && "rotate-180",
          )}
        />
        <div className="min-w-0">
          <div className="font-medium text-sm">
            {titulo}
            <span className="ml-2 text-xs tabular-nums rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
              {contagem}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-3xl">{detalhe}</p>
        </div>
      </button>
      {aberto && <div className="border-t">{children}</div>}
    </Card>
  );
}

function Rotulo({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-xs uppercase tracking-wide text-muted-foreground font-medium",
        className,
      )}
    >
      {children}
    </div>
  );
}

function Campo({ termo, children }: { termo: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground shrink-0">{termo}</dt>
      <dd className="text-sm tabular-nums text-right min-w-0 break-words">
        {children}
      </dd>
    </div>
  );
}

function Pilula({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-selected={ativo}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
        ativo
          ? "border-brand bg-brand/10 text-brand"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

const LADRILHO = {
  blue: "bg-brand/10 text-brand",
  green: "bg-emerald-50 text-emerald-600",
  amber: "bg-amber-50 text-amber-600",
  purple: "bg-violet-50 text-violet-600",
  slate: "bg-slate-100 text-slate-600",
} as const;

/**
 * Um ladrilho com **mais de um número**, e é por isso que ele não reusa o
 * `Resumo` da aba Impacto.
 *
 * R$ 731 mil por ano e R$ 52 mil por mês não cabem num campo só, e escolher um
 * deles para caber esconderia metade do que está em jogo. O ladrilho empilha as
 * linhas que existirem — uma, duas ou nenhuma.
 */
function Ladrilho({
  icon,
  tone,
  label,
  linhas,
  hint,
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  linhas: { valor: string; unidade: string }[];
  hint?: string;
}) {
  return (
    <div className="rounded-xl border bg-card shadow-sm px-5 py-5 flex items-start gap-4">
      <div
        className={cn(
          "h-12 w-12 rounded-xl grid place-content-center shrink-0",
          LADRILHO[tone],
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-muted-foreground">{label}</div>
        {linhas.length === 0 ? (
          <div className="text-2xl font-bold tracking-tight tabular-nums mt-0.5">
            —
          </div>
        ) : (
          linhas.map((l) => (
            <div key={`${l.valor}${l.unidade}`} className="mt-0.5">
              <span className="text-2xl font-bold tracking-tight tabular-nums">
                {l.valor}
              </span>
              {l.unidade && (
                <span className="text-xs text-muted-foreground ml-1.5">
                  {l.unidade}
                </span>
              )}
            </div>
          ))
        )}
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </div>
    </div>
  );
}
