import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowRightLeft,
  ArrowUp,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  CircleX,
  ClipboardCheck,
  FileText,
  Info,
  TrendingUp,
  TriangleAlert,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import {
  RecusaDoRecorte,
  SeletorDeJanela,
  janelaParaQuery,
  type JanelaDeVigencias,
} from "@/components/changes/janela-vigencias";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import type { EscopoDeFrota } from "@/lib/frota";
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

/**
 * O que a etiqueta **diz**, e o tom com que ela diz.
 *
 * O rótulo é uma instrução, e não um adjetivo: "Alta prioridade" descrevia o
 * cartão, e quem monta a pauta não precisa saber que ele é importante — precisa
 * saber se leva ou não leva. `selo` é a instrução curta que vai para o topo, e
 * `veredito` é a mesma frase inteira, na faixa logo abaixo do título, onde o
 * texto do `porque` a sustenta.
 *
 * As três cores seguem a regra da paleta em vez de graduar urgência. Verde e
 * vermelho são leitura de dado, então o verde só aparece onde a leitura é
 * "isto está pronto"; o marinho é a cor de ação, e fica com o caso que se leva
 * com ressalva; e o âmbar é a única cor de atenção, reservada ao que **não**
 * pode ser levado ainda. O vermelho de prioridade alta saiu junto com o rótulo
 * que ele pintava: um item pronto para virar dinheiro não é um alarme.
 *
 * Âmbar entra literal, e não por `text-warning-foreground`: aquele token é o
 * marinho que se escreve **sobre** o laranja cheio, e sobre um véu de 15% ele
 * sumia no tema escuro. `dark:text-amber-500` é a mesma convenção do DRE.
 *
 * O que este tom **não** pinta é o dinheiro. O valor continua vermelho quando é
 * perda e verde quando é ganho, em qualquer prioridade: cor de número é sinal,
 * e um valor âmbar ao lado de um vermelho faria parecer que um deles custa
 * menos por ser menos urgente.
 */
const PRIORIDADE: Record<
  Prioridade,
  {
    selo: string;
    veredito: string;
    Icone: LucideIcon;
    etiqueta: string;
    caixa: string;
    icone: string;
  }
> = {
  ALTA: {
    selo: "Pronto para propor",
    veredito: "Este item pode ser levado ao cliente como proposta.",
    Icone: CircleCheck,
    etiqueta: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-500",
    caixa: "border-emerald-500/30 bg-emerald-500/10",
    icone: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-500",
  },
  MEDIA: {
    selo: "Propor com ressalva",
    veredito: "Pode ser levado ao cliente, com a ressalva junto.",
    Icone: CircleAlert,
    etiqueta: "bg-brand/10 text-brand",
    caixa: "border-brand/25 bg-brand/5",
    icone: "bg-brand/10 text-brand",
  },
  ATENCAO: {
    selo: "Validar antes de propor",
    veredito: "Não recomendamos levar este item ao cliente ainda.",
    Icone: TriangleAlert,
    etiqueta: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
    caixa: "border-amber-500/30 bg-amber-500/10",
    icone: "bg-amber-500/15 text-amber-700 dark:text-amber-500",
  },
};

/**
 * O passo seguinte, para quem sai do cartão sem poder fazer nada com ele.
 *
 * Só a investigação ganha essa linha, e é por falta que ela existe: o cartão de
 * proposta termina no pedido, que já é o que se faz com ele, enquanto o de
 * investigação termina numa pendência — e sem dizer o que vem **depois** da
 * pendência ele parece uma tarefa sem destino. A frase não promete que haverá
 * proposta; ela diz sob qual condição haveria.
 */
const PROXIMO_PASSO: Partial<Record<Prioridade, string>> = {
  ATENCAO:
    "Depois disso: se houver perda comprovada, transformar em proposta para o cliente.",
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

export type TomDoGrupo = "PERDA" | "GANHO" | "NEUTRO";

/** Um dos dois lados da mesma virada — quantos ativos, e o que aconteceu com eles. */
export interface GrupoDeAtivos {
  quantidade: number;
  rotulo: string;
  tom: TomDoGrupo;
}

export interface DivisaoDeAtivos {
  /** Os ativos do par (antes → depois) que o cartão mostra. */
  predominante: GrupoDeAtivos;
  /** Os que se moveram para o outro lado na mesma vigência. */
  oposto: GrupoDeAtivos;
  /**
   * Afetados que não estão em nenhum dos dois grupos.
   *
   * Existem sempre que a coluna tem mais de dois pares de valor na vigência, e
   * o cartão precisa dizê-lo: sem isso, "64 afetados" ao lado de "29" e "7"
   * parece uma conta que não fecha — e o leitor conclui que um dos três números
   * está errado, quando os três estão certos e medem coisas diferentes.
   */
  restantes: number;
}

/**
 * Quem perdeu e quem ganhou dentro da mesma alteração.
 *
 * O cartão antigo dizia "7 para o lado contrário" e deixava a pergunta cara sem
 * resposta: o lado contrário de quem, e para melhor ou para pior? A resposta
 * não está no sinal do delta — `TJLP` caindo derruba o que recebemos e uma
 * idade subindo não é premissa nenhuma —, então ela sai do cruzamento do
 * movimento do par com o **sentido declarado** do parâmetro, que é a mesma
 * regra que o motor usa para decidir a situação da linha.
 *
 * Quando o sentido não é declarado — ou é `NAO_MONOTONICO`, ou depende da
 * fórmula da fonte —, os dois grupos saem sem juízo econômico: "no padrão
 * principal" e "em sentido oposto" continuam sendo fatos medidos, e chamar de
 * prejudicado quem talvez tenha ganhado seria exatamente o palpite com
 * aparência de conta que esta aba existe para não dar.
 *
 * Um delta zero cai no mesmo lugar: um par que não se moveu não pinta de
 * vermelho ninguém.
 *
 * **E não há divisão quando não houve divisão.** Se todos os afetados fizeram a
 * mesma transição, os três ladrilhos diriam "62 afetados · 62 prejudicados · 0
 * favorecidos" — o mesmo número duas vezes e um zero que não informa nada. A
 * função devolve `null` nesse caso, e o cartão fica com o total sozinho: quem
 * perdeu já está dito na faixa do veredito, e repeti-lo em corpo de número faz
 * o leitor procurar a diferença entre dois números iguais.
 */
export function divisaoDeAtivos(r: Recomendacao): DivisaoDeAtivos | null {
  const caso = r.oQueAconteceu;
  if (!caso) return null;

  const restantes = Math.max(
    0,
    r.veiculosAfetados - caso.entidades - caso.entidadesEmSentidoOposto,
  );
  if (caso.entidadesEmSentidoOposto === 0 && restantes === 0) return null;

  const delta = caso.depois - caso.antes;
  const predominantePerde =
    delta === 0
      ? null
      : r.sentido === "DIRETO"
        ? delta < 0
        : r.sentido === "INVERSO"
          ? delta > 0
          : null;

  if (predominantePerde === null) {
    return {
      predominante: {
        quantidade: caso.entidades,
        rotulo: "no padrão principal",
        tom: "NEUTRO",
      },
      oposto: {
        quantidade: caso.entidadesEmSentidoOposto,
        rotulo: "em sentido oposto",
        tom: "NEUTRO",
      },
      restantes,
    };
  }

  const lado = (quantidade: number, perde: boolean): GrupoDeAtivos =>
    perde
      ? { quantidade, rotulo: "prejudicados", tom: "PERDA" }
      : { quantidade, rotulo: "favorecidos", tom: "GANHO" };

  return {
    predominante: lado(caso.entidades, predominantePerde),
    oposto: lado(caso.entidadesEmSentidoOposto, !predominantePerde),
    restantes,
  };
}

// ---------------------------------------------------------------------------
// A tela
// ---------------------------------------------------------------------------

export function ClienteRecomendacoes({
  onAbrirImpacto,
  janela = {},
  onJanela,
  escopo,
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
  /**
   * O escopo de frota das telas 360°, quando esta aba é lida de lá.
   *
   * Ele trava o equipamento — que esta aba já sabia recortar, e pela mesma
   * autoridade. A **placa não estreita nada aqui**, e essa é a única aba das
   * quatro em que isso acontece; a razão está escrita na tela, no lugar em que
   * a pessoa faria a pergunta.
   *
   * Em uma frase: a recomendação é sobre o *parâmetro*, não sobre o ativo. "O
   * FINAME do cavalo caiu em 41 veículos e vale pedir revisão" é uma pauta de
   * reunião; a mesma frase recortada num ativo viraria "caiu em 1 veículo", que
   * é a mesma alteração com o argumento desmontado. E recalcular o panorama por
   * placa traria de volta as parcelas cujo total está no outro equipamento —
   * ver `motor.ts` em `@workspace/advisory`, que recusa a segunda leitura pelo
   * mesmo motivo ao recortar por equipamento.
   */
  escopo?: EscopoDeFrota;
}) {
  /*
    Sob escopo o equipamento vem de fora e não se troca aqui: a tela já o
    decidiu, e um seletor faria de novo a pergunta que o menu respondeu.
  */
  const [escolhido, setEntityType] = useState<string | null>(null);
  const entityType = escopo?.entityType ?? escolhido;
  /**
   * Qual cartão da pauta está com o detalhe técnico aberto — um só de cada vez.
   *
   * Mora aqui, e não dentro do cartão, porque quem precisa saber é a **grade**:
   * é ela que decide entre esticar os cartões para a mesma altura e deixar cada
   * um na sua. Um `useState` por cartão daria a informação a quem não a usa.
   */
  const [aberto, setAberto] = useState<string | null>(null);

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
      <RecusaDoRecorte janela={janela} onJanela={onJanela}>
        <ApiErrorNotice
          error={query.error}
          what="As recomendações ao cliente não puderam ser carregadas."
        />
      </RecusaDoRecorte>
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

      {/*
        A placa não estreita esta aba, e calar isso seria pior do que a limitação.
        Quem escolheu uma placa no cabeçalho vê as outras três abas responderem
        por ela; sem esta linha, concluiria que estas recomendações também são —
        e levaria à reunião um argumento de frota como se fosse de um ativo.
      */}
      {escopo?.placa && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          A pauta abaixo é dos{" "}
          <strong>{escopo.entityType === "CAVALO" ? "cavalos" : "carretas"}</strong>,
          e não da placa <strong className="font-mono">{escopo.placa}</strong>. A
          recomendação é sobre o parâmetro: "caiu em 41 veículos" é o que
          sustenta o pedido, e a mesma linha recortada num ativo diria "caiu em
          1" — a mesma alteração com o argumento desmontado. O que a placa mostra
          está na aba Impacto, ao lado.
        </p>
      )}

      {escopo === undefined && data.entityTypes.length > 1 && (
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
          hint="Maior alcance entre os itens da pauta"
          /*
            A ressalva vira título, e não quarta linha do ladrilho: ela é longa,
            e escrita por extenso empurrava os quatro ladrilhos para o dobro da
            altura por causa de um só. O que ela não pode é sumir — sem ela o
            número parece uma soma, e somar as placas de várias linhas contaria
            o mesmo veículo duas vezes.
          */
          detalhe="As placas se repetem entre as linhas da pauta, então este número é o maior alcance de uma delas, e não a soma."
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
            Dois cartões por fileira, e não três.

            A terceira coluna cabia quando o cartão era uma ficha de três linhas
            de texto. Ela não cabe mais: os três ladrilhos de abrangência e as
            duas linhas de leitura têm um número **e** a frase que o qualifica
            lado a lado, e a um terço de tela cada uma dessas duas colunas fica
            com pouco mais de cem pixels — que é onde "Ainda não calculável"
            quebra em três linhas de uma palavra. Um cartão a menos por fileira
            custa rolagem; um cartão ilegível custa a leitura inteira.

            O alinhamento da grade muda com o detalhe técnico, e é a única
            forma de ter as duas coisas.

            Fechados, os cartões esticam para a mesma altura: é o que deixa os
            rodapés na mesma linha e a fileira comparável a olho. Aberto um
            deles, a linha inteira cresce — e com os irmãos ainda esticados o
            crescimento vira meia tela de vazio dentro de cartões que não têm o
            que mostrar ali. Enquanto houver um aberto, cada cartão volta para a
            sua própria altura e só cresce quem foi aberto.
          */
          <div
            className={cn(
              "grid gap-4 grid-cols-1 xl:grid-cols-2",
              aberto !== null && "items-start",
            )}
          >
            {pauta.map((r, i) => (
              <CartaoDePauta
                key={r.code}
                r={r}
                posicao={i + 1}
                aberto={aberto === r.code}
                onAbrir={() =>
                  setAberto((atual) => (atual === r.code ? null : r.code))
                }
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
          icon={<CircleX className="w-5 h-5" />}
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
 * A ordem dos blocos é a ordem da decisão, e ela mudou de eixo: o cartão antigo
 * abria por um adjetivo — "Alta prioridade" — e fechava com três linhas de
 * termo e valor alinhadas à direita, que é a forma de uma ficha técnica. Quem
 * abre esta tela não está conferindo uma ficha; está decidindo o que entra na
 * reunião. Então o cartão agora **responde primeiro**: o selo diz o que fazer,
 * a faixa logo abaixo do título diz por que essa é a resposta, e só depois vêm
 * a evidência, a abrangência e o dinheiro que a sustentam.
 *
 * Três coisas que a forma nova resolve e a antiga não resolvia:
 *
 * **O veredito não se deduz mais da etiqueta.** "Atenção" obrigava o leitor a
 * saber que atenção significa não levar. A faixa escreve a frase inteira.
 *
 * **Quem perdeu aparece separado de quem ganhou.** "7 para o lado contrário",
 * escondido no fim de uma linha de racional, era a informação mais importante
 * do cartão de direções mistas — é ela que impede alguém de levar o líquido
 * como se fosse o caso de todo mundo. Agora são dois números do mesmo tamanho,
 * lado a lado, com {@link divisaoDeAtivos} decidindo qual dos dois é a perda.
 *
 * **A travessia para as placas virou o botão do cartão.** Num caso que só se
 * resolve ativo a ativo, "ver por placa e vigência" não é um link auxiliar: é a
 * única coisa que se pode fazer com o cartão agora.
 *
 * O detalhe técnico continua atrás de um clique — quem está montando a pauta
 * não precisa dele, e quem vai defender o número precisa dele inteiro. E,
 * enquanto fechado, o cartão limita as frases longas a três linhas: é o que
 * mantém os cartões da mesma fileira comparáveis a olho. Abrir o detalhe solta
 * todas; o texto é cortado na exibição, nunca na fonte.
 */
function CartaoDePauta({
  r,
  posicao,
  aberto,
  onAbrir,
  onAbrirImpacto,
}: {
  r: Recomendacao;
  posicao: number;
  aberto: boolean;
  onAbrir: () => void;
  onAbrirImpacto?: (escolha: { entityType: string; code: string }) => void;
}) {
  const prioridade = prioridadeDaPauta(r);
  const tom = PRIORIDADE[prioridade];
  const divisao = divisaoDeAtivos(r);
  const proximoPasso = PROXIMO_PASSO[prioridade];

  /*
    Sem `h-full` no cartão: ele **é** o item da grade, e o `stretch` padrão já o
    estica até a altura da fileira. Com `h-full` ele continuaria esticando mesmo
    sob `items-start`, porque `height: 100%` resolve contra a área da grade — e
    o alinhamento condicional da grade não teria efeito nenhum.
  */
  return (
    <Card className="overflow-hidden flex flex-col">
      <div className="px-5 pt-5 pb-4 flex-1 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold",
              tom.etiqueta,
            )}
          >
            <tom.Icone className="w-4 h-4 shrink-0" aria-hidden />
            {tom.selo}
          </span>
          <span className="rounded-md border px-2 py-1 text-xs tabular-nums text-muted-foreground shrink-0">
            #{posicao}
          </span>
        </div>

        <h4 className="text-lg font-semibold tracking-tight">
          {r.title}
          <span className="text-sm text-muted-foreground font-normal ml-2">
            {r.equipment.toLowerCase()} · {CONFIANCA[r.confianca]}
          </span>
        </h4>

        {/*
          A faixa do veredito. A frase de cima vem da prioridade — ela é a
          decisão da tela, e é curta de propósito; a de baixo é o `porque` que o
          motor escreveu, e é ela que sustenta a primeira. Trocar a ordem faria
          o cartão argumentar antes de concluir.
        */}
        <div
          className={cn(
            "rounded-xl border px-4 py-3 flex items-start gap-3",
            tom.caixa,
          )}
        >
          <span
            className={cn(
              "h-9 w-9 rounded-full grid place-content-center shrink-0",
              tom.icone,
            )}
          >
            <tom.Icone className="w-5 h-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-snug">{tom.veredito}</p>
            <p
              className={cn(
                "text-sm text-muted-foreground mt-1 leading-relaxed",
                !aberto && "line-clamp-3",
              )}
            >
              {r.porque}
            </p>
          </div>
        </div>

        {r.oQueAconteceu && <Evidencia caso={r.oQueAconteceu} />}

        {/*
          A abrangência em números, e não mais em frase.

          `racionalDeApoio` continua sendo o rótulo do grupo porque ela é a
          leitura corrida dos mesmos números — é o que um leitor de tela ouve
          antes dos ladrilhos, e é a frase que os testes fixam.
        */}
        <div>
          {/*
            Os três ladrilhos empilham no telefone. Lado a lado numa largura de
            336px eles ficam com 100px cada, e "veículos afetados de 64 na
            série" quebra em uma palavra por linha — um ladrilho de sete linhas
            de altura para dizer um número de dois dígitos.
          */}
          <div
            role="group"
            aria-label={racionalDeApoio(r)}
            className={cn(
              "grid gap-2",
              divisao ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1",
            )}
          >
            <Estatistica
              Icone={Truck}
              circulo="bg-brand/10 text-brand"
              numero="text-foreground"
              quantidade={r.veiculosAfetados}
              rotulo="veículos afetados"
              nota={
                r.veiculosNaSerie > 0
                  ? `de ${formatNumber(r.veiculosNaSerie, 0)} na série`
                  : undefined
              }
            />
            {divisao && (
              <>
                <Estatistica grupo={divisao.predominante} />
                <Estatistica grupo={divisao.oposto} />
              </>
            )}
          </div>
          {divisao && divisao.restantes > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Os outros {formatNumber(divisao.restantes, 0)} ativos afetados
              seguem outros pares de valor na mesma vigência.
            </p>
          )}
        </div>

        <dl className="space-y-2">
          <LinhaDoCartao
            Icone={CircleDollarSign}
            tomDoIcone={tom.icone}
            termo="Impacto financeiro"
            valor={
              r.impacto ? (
                <span
                  className={cn(
                    "tabular-nums",
                    r.impacto.valor < 0
                      ? "text-destructive"
                      : "text-emerald-600 dark:text-emerald-500",
                  )}
                  title={`${formatBrl(r.impacto.valor)} ${POR_PERIODO[r.impacto.periodicidade ?? ""] ?? ""}`.trim()}
                >
                  {formatBrlCompacto(r.impacto.valor)}
                  {periodicitySuffix(r.impacto.periodicidade)}
                </span>
              ) : (
                /*
                  "Ainda não calculável", e não "não apurado": o primeiro diz
                  que falta trabalho, o segundo soa como se alguém tivesse
                  esquecido de somar. O motivo vai para a coluna da direita, que
                  é onde cabe uma frase de três orações sem ocupar o lugar de um
                  número em corpo de número.
                */
                <span className="text-brand">Ainda não calculável</span>
              )
            }
          >
            {r.impacto
              ? (outraPeriodicidade(r.impacto) ??
                "Sem outra periodicidade declarada — o valor não é projetado para mês nem para ano.")
              : (r.impactoMotivo || "").trim() ||
                "A leitura econômica deste parâmetro ainda não permite transformar a variação em reais."}
          </LinhaDoCartao>

          <LinhaDoCartao
            Icone={ClipboardCheck}
            tomDoIcone={tom.icone}
            termo={
              r.situacao === "PROPOR_AJUSTE"
                ? "Pedido sugerido"
                : "O que falta para propor"
            }
          >
            <span className={cn("block", !aberto && "line-clamp-3")}>
              {r.oQuePerguntar ?? "—"}
            </span>
          </LinhaDoCartao>
        </dl>

        {proximoPasso && (
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3.5 py-2.5 flex items-start gap-2.5">
            <Info
              className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <p className="text-xs text-muted-foreground leading-relaxed">
              {proximoPasso}
            </p>
          </div>
        )}
      </div>

      <div className="border-t bg-muted/20 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={onAbrir}
          aria-expanded={aberto}
          className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5"
        >
          Detalhe técnico
          <ChevronDown
            className={cn("w-4 h-4 transition-transform", aberto && "rotate-180")}
          />
        </button>
        {onAbrirImpacto && (
          <Button
            onClick={() => onAbrirImpacto({ entityType: r.entityType, code: r.code })}
            className="gap-2"
          >
            Ver placas afetadas
            <ArrowRight className="w-4 h-4" aria-hidden />
          </Button>
        )}
      </div>

      {aberto && <DetalheTecnico r={r} />}
    </Card>
  );
}

/**
 * O que aconteceu, no bloco que a reunião lê primeiro.
 *
 * O par antes → depois é o padrão predominante, e o bloco precisa dizer quando
 * ele é só isso. Uma premissa compartilhada move a frota inteira do mesmo valor
 * para o mesmo valor; um montante por ativo tem dezenas de pares, e mostrar um
 * deles sem a ressalva faria o cartão parecer um resumo quando é uma
 * ilustração — daí a etiqueta "padrão predominante de N".
 *
 * A vigência vem escrita por extenso, e não como "em EMPURRADA_2_3_2026" colado
 * ao número: o nome da fonte é o que se procura na planilha depois da reunião,
 * e ele merece o próprio rótulo.
 */
function Evidencia({ caso }: { caso: OQueAconteceu }) {
  return (
    <div className="rounded-xl border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="h-8 w-8 rounded-lg grid place-content-center shrink-0 bg-brand text-brand-foreground">
          <TrendingUp className="w-4 h-4" aria-hidden />
        </span>
        <span className="text-sm font-semibold">Evidência</span>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2.5 tabular-nums min-w-0">
          <span className="text-2xl text-muted-foreground">
            {formatValue(caso.antes, caso.unidade)}
          </span>
          <ArrowRight className="w-5 h-5 text-muted-foreground shrink-0" aria-hidden />
          <span className="text-2xl font-semibold text-brand">
            {formatValue(caso.depois, caso.unidade)}
          </span>
        </div>
        <div className="min-w-0 sm:text-right">
          <div className="text-xs text-muted-foreground">
            Vigência:{" "}
            <span className="font-medium text-foreground">{caso.sourceLabel}</span>
          </div>
          {caso.padroes > 1 && (
            <span className="inline-block mt-1 rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
              padrão predominante de {formatNumber(caso.padroes, 0)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/*
  O tom de cada grupo — e o vermelho e o verde aqui são leitura de dado, não
  urgência. É a mesma regra do resto da tela: quem perdeu é vermelho em qualquer
  prioridade, e um grupo sem juízo econômico não ganha cor nenhuma.
*/
const TOM_DO_GRUPO: Record<
  TomDoGrupo,
  { circulo: string; numero: string; Icone: LucideIcon }
> = {
  PERDA: {
    circulo: "bg-destructive/10 text-destructive",
    numero: "text-destructive",
    Icone: ArrowDown,
  },
  GANHO: {
    circulo: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-500",
    numero: "text-emerald-600 dark:text-emerald-500",
    Icone: ArrowUp,
  },
  NEUTRO: {
    circulo: "bg-muted text-muted-foreground",
    numero: "text-foreground",
    Icone: ArrowRightLeft,
  },
};

/**
 * Um dos ladrilhos de abrangência do cartão.
 *
 * Aceita as duas formas porque os três ladrilhos não são a mesma coisa: o de
 * veículos afetados é um total, e leva a série no rodapé como denominador; os
 * dois de direção saem prontos de {@link divisaoDeAtivos}, com o tom já
 * decidido lá — decidir cor de perda dentro de um componente de apresentação
 * seria repetir aqui a regra econômica que mora na função pura.
 */
function Estatistica(
  props:
    | { grupo: GrupoDeAtivos }
    | {
        Icone: LucideIcon;
        circulo: string;
        numero: string;
        quantidade: number;
        rotulo: string;
        nota?: string;
      },
) {
  const { Icone, circulo, numero, quantidade, rotulo, nota } =
    "grupo" in props
      ? {
          ...TOM_DO_GRUPO[props.grupo.tom],
          quantidade: props.grupo.quantidade,
          rotulo: props.grupo.rotulo,
          nota: undefined,
        }
      : props;

  return (
    <div className="rounded-xl border bg-muted/20 px-3 py-3 flex items-center gap-2.5 min-w-0">
      <span
        className={cn(
          "h-9 w-9 rounded-full grid place-content-center shrink-0",
          circulo,
        )}
      >
        <Icone className="w-4 h-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className={cn("text-2xl font-bold tabular-nums leading-none", numero)}>
          {formatNumber(quantidade, 0)}
        </div>
        <div className="text-xs text-muted-foreground mt-1 leading-snug">{rotulo}</div>
        {nota && (
          <div className="text-xs text-muted-foreground/80 leading-snug">{nota}</div>
        )}
      </div>
    </div>
  );
}

/**
 * A outra periodicidade do impacto, quando a conversão é permitida.
 *
 * Ela sobe do detalhe técnico para o cartão porque é a pergunta imediata de
 * quem ouve "R$ 52 mil por mês" numa reunião. O que **não** sobe é a premissa
 * por extenso: aqui basta marcar que houve projeção, e a frase que a sustenta
 * continua embaixo, junto do valor em precisão cheia.
 *
 * A escala é a compacta, e não `formatBrlShort`, por causa do sinal. O cifrão
 * do `toLocaleString` vem com hífen — "-R$ 628.800" — e o valor ao lado dele na
 * mesma linha usa o menos tipográfico. Duas formas do mesmo sinal encostadas
 * fazem uma delas parecer um traço decorativo, e é a perda que se lê como
 * ganho.
 */
function outraPeriodicidade(i: ImpactoEstimado): string | null {
  const projecao = i.projetado ? " — projeção linear" : "";
  if (i.periodicidade === "MENSAL" && i.anual !== null)
    return `${formatBrlCompacto(i.anual)} por ano${projecao}`;
  if (i.periodicidade === "ANUAL" && i.mensal !== null)
    return `${formatBrlCompacto(i.mensal)} por mês${projecao}`;
  return null;
}

/**
 * Uma das duas linhas de leitura do cartão — o termo com o valor de um lado, e
 * a qualificação do outro.
 *
 * As duas colunas existem para separar o que se lê do que se confere: à
 * esquerda o número ou o veredito curto, à direita a frase que diz sob qual
 * condição ele vale. Empilhadas — que é o que acontece abaixo de `sm`, onde o
 * cartão ocupa a largura do telefone —, o traço divisor sai junto: uma borda
 * lateral entre dois blocos que já não estão lado a lado é ruído.
 *
 * O invólucro é um `div` dentro do `dl`, e não `dt`/`dd` soltos: cada linha
 * agora tem moldura própria, e sem o `div` a borda teria que ser desenhada duas
 * vezes, uma em cada metade.
 */
function LinhaDoCartao({
  Icone,
  tomDoIcone,
  termo,
  valor,
  children,
}: {
  Icone: LucideIcon;
  tomDoIcone: string;
  termo: string;
  valor?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-muted/20 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-x-4 gap-y-2">
      <dt className="flex items-start gap-2.5 min-w-0 sm:basis-1/2 sm:shrink-0">
        <span
          className={cn(
            "h-8 w-8 rounded-lg grid place-content-center shrink-0",
            tomDoIcone,
          )}
        >
          <Icone className="w-4 h-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-snug">{termo}</span>
          {valor !== undefined && (
            <span className="block text-base font-semibold leading-snug mt-0.5">
              {valor}
            </span>
          )}
        </span>
      </dt>
      <dd className="text-sm text-muted-foreground min-w-0 leading-relaxed sm:flex-1 sm:border-l sm:pl-4">
        {children}
      </dd>
    </div>
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

      {/*
        "Medição de apoio", e não "Evidência": o bloco de cima do cartão passou
        a se chamar Evidência, e ele mostra outra coisa — o par antes → depois
        deste recorte. Este aqui é a medição da série que sustenta o
        comportamento econômico declarado. Dois blocos com o mesmo nome dentro
        do mesmo cartão fariam quem defende o número citar o errado.
      */}
      {r.evidencia && (
        <div>
          <Rotulo>Medição de apoio</Rotulo>
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

/*
  Os tons vêm dos tokens, e não de `bg-red-50`/`bg-blue-50`.

  Um `red-50` literal é um retângulo claro fixo: no tema escuro ele vira um
  bloco aceso no meio da página, e é justamente nos dois painéis — que ocupam
  uma faixa inteira — que isso apareceria primeiro. Com `destructive/5` o véu
  acompanha o fundo dos dois temas.
*/
const PAINEL = {
  red: {
    fundo: "bg-destructive/5 border-destructive/20",
    caixa: "bg-destructive text-destructive-foreground",
    marcador: "bg-destructive",
  },
  blue: {
    fundo: "bg-brand/5 border-brand/20",
    caixa: "bg-brand text-brand-foreground",
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
    <Card className={cn("p-5", cores.fundo)}>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            "h-8 w-8 rounded-full grid place-content-center shrink-0",
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

      <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/60">
        {rodape}
      </p>
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
    <Card className="px-5 py-4 flex items-start gap-3 bg-brand/5 border-brand/20">
      <span className="h-8 w-8 rounded-lg grid place-content-center shrink-0 bg-brand/10 text-brand">
        <FileText className="w-5 h-5" />
      </span>
      <div className="text-sm text-muted-foreground leading-relaxed">
        <strong className="text-brand">Resumo executivo</strong>
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
  detalhe,
}: {
  icon: React.ReactNode;
  tone: keyof typeof LADRILHO;
  label: string;
  linhas: { valor: string; unidade: string }[];
  hint?: string;
  /** A ressalva que o número exige e que não cabe na dica. Vira `title`. */
  detalhe?: string;
}) {
  return (
    <div
      className="rounded-xl border bg-card shadow-sm px-5 py-5 flex items-start gap-4"
      title={detalhe}
    >
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
