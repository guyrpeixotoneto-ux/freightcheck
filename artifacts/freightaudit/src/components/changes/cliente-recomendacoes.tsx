import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CircleHelp,
  Handshake,
  Search,
  Target,
  TrendingDown,
  Truck,
} from "lucide-react";
import { ApiErrorNotice } from "@/components/api-error";
import { Card } from "@/components/ui/card";
import { fetchJson } from "@/lib/api";
import { formatBrl, formatBrlShort, formatNumber, formatValue } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Cliente — **o que levar para a conversa, e o que não levar.**
 *
 * A aba Impacto mostra o universo do que mudou. Esta mostra o subconjunto em
 * que o movimento nos prejudica *e* existe algo objetivo a pedir — que é uma
 * lista muito menor, e é esse o ponto. Uma tela que listasse tudo que caiu
 * proporia recompor financiamentos quitados e reduzir a idade dos caminhões.
 *
 * Três decisões de tela seguem daí, e nenhuma é estética:
 *
 * **Propostas e investigações se intercalam.** Uma investigação de R$ 731 mil
 * vale mais atenção do que uma proposta de R$ 300, e separá-las em blocos
 * enterraria a maior pergunta do mês embaixo da menor proposta. A ordem é o
 * dinheiro; a etiqueta diz o que fazer com cada linha.
 *
 * **O que não vira proposta continua visível, com o motivo.** Quem confere a
 * planilha vai encontrar o `custoFixo` da carreta e o `lucroVariavelPrevisto`, e
 * precisa achar por que não estão na lista. Some da lista, não da tela.
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

interface Recomendacao {
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
  context: { label: string };
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

const SITUACAO = {
  PROPOR_AJUSTE: {
    rotulo: "Propor ajuste",
    classe: "bg-brand/10 text-brand border-brand/30",
    icone: <Handshake className="w-3.5 h-3.5" />,
  },
  INVESTIGAR: {
    rotulo: "Investigar",
    classe: "bg-warning/15 text-warning-foreground border-warning/30",
    icone: <Search className="w-3.5 h-3.5" />,
  },
  NAO_PROPOR: {
    rotulo: "Não propor",
    classe: "bg-muted text-muted-foreground border-border",
    icone: <CircleCheck className="w-3.5 h-3.5" />,
  },
  NAO_CALCULAVEL: {
    rotulo: "Não calculável",
    classe: "bg-muted text-muted-foreground border-border",
    icone: <CircleHelp className="w-3.5 h-3.5" />,
  },
} as const;

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

export function ClienteRecomendacoes({
  onAbrirImpacto,
}: {
  onAbrirImpacto?: (escolha: { entityType: string; code: string }) => void;
}) {
  const [entityType, setEntityType] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["cliente", "recomendacoes", entityType],
    queryFn: () =>
      fetchJson<Resposta>(
        `/cliente/recomendacoes${entityType ? `?entityType=${entityType}` : ""}`,
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
  const prioritarias = data.recomendacoes.filter(
    (r) => r.situacao === "PROPOR_AJUSTE" || r.situacao === "INVESTIGAR",
  );
  const naoPropor = data.recomendacoes.filter((r) => r.situacao === "NAO_PROPOR");
  const naoCalculavel = data.recomendacoes.filter(
    (r) => r.situacao === "NAO_CALCULAVEL",
  );
  const primeira = data.periods[0];
  const ultima = data.periods[data.periods.length - 1];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          O que recomendamos discutir com o cliente
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          De tudo que mudou entre <strong>{primeira?.sourceLabel}</strong> e{" "}
          <strong>{ultima?.sourceLabel}</strong>, este é o subconjunto em que o
          movimento vai contra nós <em>e</em> existe algo objetivo a pedir ou a
          perguntar. O que ficou de fora continua abaixo, com o motivo — inclusive
          o que nos favorece.
        </p>
      </div>

      {/*
        O recorte por equipamento é o mesmo da aba Impacto e vem da mesma
        autoridade: `listImpactEntityTypes` decide quais existem, e a resposta
        diz qual foi escolhido. Reconstruir a lista aqui faria a aba oferecer um
        equipamento que a série nunca entregou.
      */}
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
          tone="slate"
          icon={<TrendingDown className="w-6 h-6" />}
          label="Impacto identificado"
          linhas={totais.porPeriodicidade.map((p) => ({
            valor: formatBrlShort(p.identificado),
            nota: POR_PERIODO[p.periodicity ?? ""] ?? "sem periodicidade",
          }))}
          hint="em módulo — o que está em jogo, ganhando ou perdendo"
        />
        <Ladrilho
          tone="blue"
          icon={<Target className="w-6 h-6" />}
          label="Potencialmente recuperável"
          linhas={
            totais.porPeriodicidade.some((p) => p.recuperavel > 0)
              ? totais.porPeriodicidade
                  .filter((p) => p.recuperavel > 0)
                  .map((p) => ({
                    valor: formatBrlShort(p.recuperavel),
                    nota: POR_PERIODO[p.periodicity ?? ""] ?? "sem periodicidade",
                  }))
              : [{ valor: "—", nota: "nenhuma proposta com valor apurado" }]
          }
          hint="só o que está em “propor ajuste”"
        />
        <Ladrilho
          tone="amber"
          icon={<Search className="w-6 h-6" />}
          label="Para levar ao cliente"
          linhas={[
            { valor: formatNumber(totais.propor, 0), nota: "a propor" },
            { valor: formatNumber(totais.investigar, 0), nota: "a investigar" },
          ]}
          hint={`de ${formatNumber(totais.analisadas, 0)} linhas econômicas analisadas`}
        />
        <Ladrilho
          tone="green"
          icon={<Truck className="w-6 h-6" />}
          label="Impacto explicado"
          linhas={[
            {
              valor:
                totais.percentualExplicado === null
                  ? "—"
                  : `${formatNumber(totais.percentualExplicado, 1)}%`,
              nota:
                totais.percentualExplicado === null
                  ? "nenhum dinheiro apurado nesta série"
                  : "do dinheiro apurado tem leitura econômica",
            },
          ]}
          hint={
            totais.veiculosAlcancados > 0
              ? `até ${totais.veiculosAlcancados} veículos numa mesma linha`
              : undefined
          }
        />
      </div>

      {/* ---- as prioritárias ------------------------------------------- */}
      {prioritarias.length === 0 ? (
        <Card className="p-6">
          <p className="text-sm">
            <strong>Nada a propor nem a investigar nesta série.</strong>
          </p>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
            As {formatNumber(totais.analisadas, 0)} linhas econômicas que mudaram
            estão abaixo, cada uma com a razão de não virar assunto: favoráveis a
            nós, neutras, cadastrais ou consequência de mecanismo próprio. Zero
            recomendações é um resultado — uma proposta errada custa mais do que
            nenhuma.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {prioritarias.map((r) => (
            <CartaoDeRecomendacao
              key={r.code}
              r={r}
              onAbrirImpacto={onAbrirImpacto}
            />
          ))}
        </div>
      )}

      {/* ---- o que ficou de fora --------------------------------------- */}
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

      <p className="text-xs text-muted-foreground max-w-3xl">
        <strong>Por que esta lista é menor do que a de Impacto.</strong> Lá está
        o universo do que mudou. Aqui, só o que passou por três portas: existe
        leitura econômica do parâmetro, o movimento vai contra nós, e há algo
        objetivo a pedir ou a perguntar. O sinal do número não decide nada — o
        que decide é o comportamento declarado do parâmetro, porque uma taxa que
        cai reduz o que recebemos e uma idade que sobe não é premissa nenhuma.
        {" "}
        <strong>E o contexto é o mesmo das outras abas</strong> —{" "}
        {data.context.label}, {data.periods.length} vigências —, resolvido pela
        mesma autoridade, e não reconstruído aqui.
      </p>
    </div>
  );
}

/**
 * Um cartão de recomendação.
 *
 * A ordem dos blocos é a ordem da conversa: o que aconteceu, por que isso nos
 * prejudica, quanto vale, e o que pedir. O detalhe técnico fica atrás de um
 * clique — quem está montando a pauta não precisa dele, e quem vai defender o
 * número precisa dele inteiro.
 */
function CartaoDeRecomendacao({
  r,
  onAbrirImpacto,
}: {
  r: Recomendacao;
  onAbrirImpacto?: (escolha: { entityType: string; code: string }) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const s = SITUACAO[r.situacao];

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
              s.classe,
            )}
          >
            {s.icone}
            {s.rotulo}
          </span>
          <span className="text-xs text-muted-foreground">
            {CONFIANCA[r.confianca]}
          </span>
          <span className="text-xs text-muted-foreground" aria-hidden>
            ·
          </span>
          <span className="text-xs text-muted-foreground">
            {formatNumber(r.veiculosAfetados, 0)} de{" "}
            {formatNumber(r.veiculosNaSerie, 0)} {r.equipment.toLowerCase()}s
          </span>
          {r.direcoesMistas && (
            <span className="text-xs rounded bg-warning/15 text-warning-foreground px-1.5 py-0.5">
              ativos em direções opostas
            </span>
          )}
        </div>

        <h3 className="text-base font-semibold tracking-tight mt-2.5">{r.title}</h3>

        {/*
          O par antes → depois é o padrão predominante, e a tela precisa dizer
          quando ele é só isso. Uma premissa compartilhada move a frota inteira
          do mesmo valor para o mesmo valor; um montante por ativo tem dezenas
          de pares, e mostrar um deles sem a ressalva faria o cartão parecer um
          resumo quando é uma ilustração.
        */}
        {r.oQueAconteceu && (
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums">
            <span className="text-muted-foreground">
              {formatValue(r.oQueAconteceu.antes, r.oQueAconteceu.unidade)}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="font-medium">
              {formatValue(r.oQueAconteceu.depois, r.oQueAconteceu.unidade)}
            </span>
            <span className="text-xs text-muted-foreground">
              em {r.oQueAconteceu.sourceLabel}, em{" "}
              {formatNumber(r.oQueAconteceu.entidades, 0)}{" "}
              {r.oQueAconteceu.entidades === 1 ? "veículo" : "veículos"}
              {r.oQueAconteceu.entidadesEmSentidoOposto > 0 && (
                <>
                  {" "}
                  · {formatNumber(r.oQueAconteceu.entidadesEmSentidoOposto, 0)}{" "}
                  para o lado contrário
                </>
              )}
            </span>
            {r.oQueAconteceu.padroes > 1 && (
              <span className="text-xs rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                padrão predominante de {formatNumber(r.oQueAconteceu.padroes, 0)}
              </span>
            )}
          </div>
        )}

        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <Rotulo>
              {r.situacao === "NAO_PROPOR"
                ? "Por que não é assunto"
                : "Por que isso nos prejudica"}
            </Rotulo>
            <p className="text-sm mt-1 leading-relaxed">{r.porque}</p>

            {r.oQuePerguntar && (
              <>
                <Rotulo className="mt-3">
                  {r.situacao === "PROPOR_AJUSTE"
                    ? "O que recomendamos"
                    : "O que perguntar"}
                </Rotulo>
                <p className="text-sm mt-1 leading-relaxed">{r.oQuePerguntar}</p>
              </>
            )}
          </div>

          <div className="space-y-3">
            <div>
              <Rotulo>Impacto estimado</Rotulo>
              {r.impacto ? (
                <div className="mt-1 space-y-0.5">
                  <div
                    className={cn(
                      "text-xl font-bold tabular-nums",
                      r.impacto.valor < 0 ? "text-destructive" : "text-emerald-600",
                    )}
                  >
                    {formatBrl(r.impacto.valor)}
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      {POR_PERIODO[r.impacto.periodicidade ?? ""] ?? ""}
                    </span>
                  </div>
                  {r.impacto.periodicidade === "MENSAL" && r.impacto.anual !== null && (
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {formatBrlShort(r.impacto.anual)} por ano
                      {r.impacto.projetado && " — projeção linear"}
                    </div>
                  )}
                  {r.impacto.periodicidade === "ANUAL" && r.impacto.mensal !== null && (
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {formatBrlShort(r.impacto.mensal)} por mês
                      {r.impacto.projetado && " — projeção linear"}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground mt-1">
                  Não calculável — {r.impactoMotivo || "sem régua financeira"}.
                </p>
              )}
            </div>

            {r.valorRecomendado !== null && (
              <dl className="text-sm space-y-1">
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
          </div>
        </div>
      </div>

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
      <dl className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
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
    <div className="flex items-baseline justify-between gap-3 sm:justify-start">
      <dt className="text-xs text-muted-foreground shrink-0">{termo}</dt>
      <dd className="text-sm tabular-nums text-right sm:text-left">{children}</dd>
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
  linhas: { valor: string; nota: string }[];
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
            <div key={l.nota} className="mt-0.5">
              <span className="text-2xl font-bold tracking-tight tabular-nums">
                {l.valor}
              </span>
              <span className="text-xs text-muted-foreground ml-1.5">{l.nota}</span>
            </div>
          ))
        )}
        {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
      </div>
    </div>
  );
}
