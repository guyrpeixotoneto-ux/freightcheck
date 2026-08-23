import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import {
  EtiquetaDaSituacao,
  LegendaDasSituacoes,
  Numero,
} from "@/components/fechamento/gerencial";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  listarApuracoes,
  NOME_DO_ESTADO,
  type ResumoDeApuracao,
} from "@/lib/fechamento";
import {
  anosComCompetencia,
  emDiaCurto,
  hojeEm,
  MES_LONGO,
  nomeDaParte,
  percentualConferido,
  resumirUnidades,
  type QuinzenaDoAno,
  type ResumoDaUnidade,
} from "@/lib/fechamento-gerencial";
import { formatBrlCompacto, formatBrlShort } from "@/lib/format";
import { apresentar } from "@/lib/apresentar-erro";
import { cn } from "@/lib/utils";

/**
 * O ano de uma unidade, quinzena a quinzena — o que abre atrás do cartão da
 * Visão Gerencial.
 *
 * **Por que as 24 casas existem sempre.** A grade nasce do calendário e depois
 * recebe as competências, e não o contrário. Uma lista montada a partir do que
 * existe responde "o que foi aberto"; esta responde "o que foi fechado", e as
 * duas só divergem exatamente onde importa — na quinzena que passou sem que
 * ninguém abrisse nada. Esse buraco é invisível em qualquer tela que liste
 * registros, porque não há registro nenhum para listar. É a mesma decisão da
 * grade de dias da competência, onde o dia sem operação aparece apagado em vez
 * de sumir.
 *
 * **Por que a quinzena não é um link só.** Uma unidade pode fechar a mesma
 * quinzena com mais de uma transportadora — a competência é a trinca (unidade,
 * transportadora, quinzena). O ladrilho é, por isso, um contêiner com uma linha
 * por competência, e não um `<a>` inteiro: transformar a casa num link único
 * obrigaria a escolher uma das transportadoras para receber o clique, e a
 * escolhida seria arbitrária.
 *
 * **O ano vive na URL** (`?ano=2026`), e não em estado local, para que o
 * endereço que se cola numa mensagem abra o mesmo ano que quem colou estava
 * vendo. É a mesma razão pela qual o ambiente mora no caminho e não em
 * `localStorage` — ver `lib/ambiente.ts`.
 */

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return (
    aviso.principal ??
    aviso.mensagemCrua ??
    "Não foi possível carregar a unidade."
  );
}

/**
 * Uma competência dentro da casa da quinzena — a linha que leva à tela de dentro.
 *
 * A linha carrega o que a apuração gravou: quanto foi emitido, quanto disso as
 * fontes sustentam e quanto continua a questionar. É aqui, e não no rodapé da
 * casa, porque a maioria das quinzenas tem uma competência só — repetir o mesmo
 * número duas vezes na mesma caixa faria parecer que são dois.
 */
function LinhaDaCompetencia({ linha }: { linha: ResumoDeApuracao }) {
  const { competencia, apuracao } = linha;
  const conferido = apuracao ? percentualConferido(apuracao) : null;
  const detalhe = [
    NOME_DO_ESTADO[competencia.estado],
    apuracao === null
      ? "sem apuração"
      : `${formatBrlCompacto(apuracao.emitido)} emitidos`,
    conferido !== null && `${Math.round(conferido)}% conferido`,
    apuracao !== null &&
      apuracao.aQuestionar > 0 &&
      `${formatBrlCompacto(apuracao.aQuestionar)} a questionar`,
  ].filter((p): p is string => typeof p === "string");

  return (
    <Link
      href={`/fechamento/competencias/${competencia.id}`}
      className="flex items-center justify-between gap-3 rounded px-2 py-1.5 -mx-2 hover:bg-muted/60 transition-colors"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium truncate">
          {nomeDaParte(competencia.transportadora)}
        </span>
        <span className="block text-xs text-muted-foreground">
          {detalhe.join(" · ")}
        </span>
      </span>
      <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

/**
 * Uma quinzena do ano.
 *
 * A casa vazia continua ocupando o mesmo espaço da cheia — é o que permite ler
 * o ano de relance e ver onde ele falha. O convite a abrir a competência só
 * aparece na quinzena que já venceu sem nenhuma: numa que ainda não terminou,
 * "abrir competência" seria cobrança de trabalho que ainda não é devido.
 */
function CasaDaQuinzena({ quinzena }: { quinzena: QuinzenaDoAno }) {
  const vazia = quinzena.competencias.length === 0;
  const conferido = percentualConferido(quinzena);

  return (
    <div
      className={cn(
        "rounded-lg border p-4 flex flex-col gap-3",
        vazia ? "bg-muted/20 border-dashed" : "bg-card",
      )}
      data-testid={`quinzena-${quinzena.chave}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-bold">
            {quinzena.quinzena}ª de {MES_LONGO[quinzena.mes - 1]}
          </span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {emDiaCurto(quinzena.inicio)} a {emDiaCurto(quinzena.fim)}
          </span>
        </span>
        <EtiquetaDaSituacao situacao={quinzena.situacao} />
      </div>

      {vazia ? (
        <p className="text-xs text-muted-foreground">
          {quinzena.situacao === "SEM_COMPETENCIA" ? (
            <>
              A quinzena terminou e nenhuma competência foi aberta para ela.{" "}
              <Link
                href="/fechamento/competencias"
                className="text-primary hover:underline"
              >
                Abrir agora
              </Link>
            </>
          ) : (
            "A quinzena ainda não terminou."
          )}
        </p>
      ) : (
        <>
          <div className="space-y-0.5">
            {quinzena.competencias.map((linha) => (
              <LinhaDaCompetencia key={linha.competencia.id} linha={linha} />
            ))}
          </div>
          {/*
            A soma da quinzena só aparece quando há mais de uma competência para
            somar: com uma só, ela repetiria a linha logo acima com outras
            palavras.
          */}
          {quinzena.competencias.length > 1 && quinzena.apuradas > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums border-t pt-2 mt-auto">
              <span className="font-medium">Na quinzena:</span>{" "}
              {formatBrlCompacto(quinzena.emitido)} emitidos
              {conferido !== null && ` · ${Math.round(conferido)}% conferido`}
              {quinzena.aQuestionar > 0 &&
                ` · ${formatBrlCompacto(quinzena.aQuestionar)} a questionar (${quinzena.aQuestionarQuantidade})`}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** A faixa executiva da unidade — os mesmos números da Visão Gerencial, num recorte só. */
function ResumoDaUnidadeNoAno({
  unidade,
  ano,
}: {
  unidade: ResumoDaUnidade;
  ano: number;
}) {
  const conferido = percentualConferido(unidade);
  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap divide-x divide-y sm:divide-y-0">
          <Numero
            rotulo="Fechamentos realizados"
            valor={`${Math.round(unidade.percentualEncerrado)}%`}
            barra={unidade.percentualEncerrado}
            detalhe={`${unidade.encerradas} de ${unidade.competencias} competências encerradas em ${ano}`}
          />
          <Numero
            rotulo="Vencidas em aberto"
            valor={String(unidade.vencidas)}
            detalhe={
              unidade.vencidas === 0
                ? "nenhuma quinzena vencida sem encerrar"
                : "quinzenas que terminaram e não fecharam"
            }
            alerta={unidade.vencidas > 0}
          />
          <Numero
            rotulo="Sem competência"
            valor={String(unidade.lacunas)}
            detalhe={
              unidade.lacunas === 0
                ? "toda quinzena vencida tem competência"
                : "quinzenas vencidas sem nada aberto"
            }
            alerta={unidade.lacunas > 0}
          />
          <Numero
            rotulo="Emitido em CT-e"
            valor={
              unidade.apuradas === 0 ? "—" : formatBrlShort(unidade.emitido)
            }
            detalhe={
              unidade.apuradas === 0
                ? "nenhuma competência apurada ainda"
                : conferido === null
                  ? `${unidade.apuradas} competências apuradas · sem emissão a conferir`
                  : `${unidade.apuradas} competências apuradas · ${Math.round(conferido)}% conferido`
            }
          />
          <Numero
            rotulo="A questionar"
            valor={
              unidade.apuradas === 0 ? "—" : formatBrlShort(unidade.aQuestionar)
            }
            detalhe={
              unidade.apuradas === 0
                ? "nenhuma competência apurada ainda"
                : unidade.aQuestionarQuantidade === 0
                  ? "nenhuma divergência sem desfecho"
                  : `${unidade.aQuestionarQuantidade} divergências sem desfecho`
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}

export default function UnidadeDoFechamento({ codigo }: { codigo: string }) {
  const [, navegar] = useLocation();
  const busca = useSearch();

  const apuracoes = useQuery({
    queryKey: ["fechamento", "apuracoes"],
    queryFn: listarApuracoes,
  });

  const todas = useMemo(() => apuracoes.data ?? [], [apuracoes.data]);
  const daUnidade = useMemo(
    () => todas.filter((l) => l.competencia.unidade.codigo === codigo),
    [todas, codigo],
  );
  const anos = useMemo(() => anosComCompetencia(daUnidade), [daUnidade]);

  /*
    O ano pedido pela URL, quando ele existe nos dados. Um `?ano=1999` colado à
    mão não abre 24 casas vazias: cai no ano mais recente que a unidade tem, que
    é o mesmo que o cartão da Visão Gerencial mostrava.
  */
  const pedido = Number(new URLSearchParams(busca).get("ano"));
  const ano = anos.includes(pedido) ? pedido : (anos[0] ?? null);

  const diaDeHoje = hojeEm();
  const unidade = useMemo(
    () =>
      ano === null
        ? null
        : (resumirUnidades(daUnidade, ano, diaDeHoje)[0] ?? null),
    [daUnidade, ano, diaDeHoje],
  );

  const nome = unidade ? nomeDaParte(unidade) : codigo;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <Link
          href="/fechamento"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Visão Gerencial
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4 mt-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{nome}</h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">
              {unidade === null ? (
                <>A unidade {codigo} não tem competência registrada.</>
              ) : (
                <>
                  As quinzenas de {ano}, uma a uma: o que foi encerrado, o que
                  venceu sem fechar e o que passou sem competência aberta.{" "}
                  {unidade.transportadoras.length === 1
                    ? `Transportadora: ${unidade.transportadoras[0]}.`
                    : `Transportadoras: ${unidade.transportadoras.join(", ")}.`}
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {anos.length > 0 && (
              <Select
                value={String(ano)}
                onValueChange={(v) =>
                  navegar(
                    `/fechamento/unidades/${encodeURIComponent(codigo)}?ano=${v}`,
                  )
                }
              >
                <SelectTrigger
                  className="h-auto w-auto gap-2 rounded-full px-4 py-2 shadow-none"
                  aria-label="Ano"
                >
                  <span className="font-semibold">Ano</span>
                  <span className="font-normal text-muted-foreground tabular-nums">
                    {ano}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {anos.map((a) => (
                    <SelectItem key={a} value={String(a)}>
                      {a}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Link href="/fechamento/competencias">
              <Button size="sm" variant="outline">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Realizar Fechamento
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-8 space-y-6">
        {apuracoes.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(apuracoes.error)}</AlertDescription>
          </Alert>
        )}

        {apuracoes.isLoading && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}

        {!apuracoes.isLoading && !apuracoes.isError && unidade === null && (
          <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground max-w-2xl space-y-3">
            <p>
              Nenhuma competência foi aberta para a unidade{" "}
              <strong>{codigo}</strong>. Uma unidade só existe no Fechamento a
              partir da primeira competência — não há cadastro de unidade
              separado dela.
            </p>
            <p>
              Abra a primeira em{" "}
              <Link
                href="/fechamento/competencias"
                className="text-primary hover:underline"
              >
                Importações
              </Link>
              , ou volte à{" "}
              <Link href="/fechamento" className="text-primary hover:underline">
                Visão Gerencial
              </Link>{" "}
              para ver as unidades que já têm.
            </p>
          </div>
        )}

        {unidade !== null && ano !== null && (
          <>
            <ResumoDaUnidadeNoAno unidade={unidade} ano={ano} />

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                <h2 className="text-base font-bold">
                  As 24 quinzenas de {ano}{" "}
                  <span className="font-normal text-muted-foreground text-sm">
                    — na ordem do calendário
                  </span>
                </h2>
                <LegendaDasSituacoes />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {unidade.quinzenas.map((quinzena) => (
                  <CasaDaQuinzena key={quinzena.chave} quinzena={quinzena} />
                ))}
              </div>
            </div>

            <p className="text-xs text-muted-foreground max-w-3xl">
              O percentual de fechamento conta as competências encerradas sobre
              as competências abertas no ano. A quinzena que passou sem
              competência nenhuma não entra nessa conta — ela aparece acima,
              como “sem competência”, porque o sistema sabe que ela passou
              vazia, mas não sabe se esta unidade deveria ter operado nela.
            </p>
          </>
        )}
      </div>
    </Layout>
  );
}
