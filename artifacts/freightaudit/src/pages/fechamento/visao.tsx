import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, TriangleAlert } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import {
  useBaseDoFechamento,
  useOperacaoDoFechamento,
} from "@/lib/base-do-fechamento";
import {
  Barra,
  FaixaDoAno,
  LegendaDasSituacoes,
  Numero,
} from "@/components/fechamento/gerencial";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { listarApuracoes } from "@/lib/fechamento";
import {
  anosComCompetencia,
  hojeEm,
  nomeDaParte,
  resumirUnidades,
  resumoExecutivo,
  type ResumoDaUnidade,
} from "@/lib/fechamento-gerencial";
import { formatBrlCompacto, formatBrlShort } from "@/lib/format";
import { apresentar } from "@/lib/apresentar-erro";
import { cn } from "@/lib/utils";
import { etapasDoFechamento } from "./etapas";

/**
 * Visão Gerencial — o fechamento do ano inteiro, unidade a unidade.
 *
 * **A pergunta que ela responde é de quem responde pelo número, não de quem o
 * produz.** Quem opera abre a competência e trabalha dentro dela; quem responde
 * pelo fechamento quer saber outra coisa, e quer saber sem clicar: *quanto do
 * ano já fechou, em quais unidades, e onde está o atraso.* A tela anterior —
 * "Visão do fechamento" — listava as seis competências mais recentes, o que
 * respondia "o que aconteceu por último" e nunca "como estamos". Seis linhas de
 * uma lista sem total não formam uma visão.
 *
 * **O que ela mostra, e de onde vem.** Uma leitura só, a mesma de Apurações
 * (`GET /fechamento/apuracoes`): quatro consultas de tamanho fixo no servidor,
 * com os totais que a apuração gravou quando rodou. Nada aqui recompõe
 * remuneração — o agrupamento por unidade e a divisão que vira percentual são o
 * que a tela faz, e a aritmética inteira mora em `lib/fechamento-gerencial.ts`,
 * testada fora do JSX.
 *
 * **Três decisões que a tela materializa:**
 *
 * 1. **O percentual de fechamento é sobre a competência, não sobre o
 *    calendário.** Uma unidade com 12 competências e 7 encerradas está em 58%,
 *    ainda que o ano tenha 24 quinzenas. O que o calendário tem a dizer aparece
 *    à parte, como lacuna, e nunca somado ao percentual — ver `resumirUnidades`.
 * 2. **A ordem dos cartões é a do atraso**, e não a alfabética: primeiro quem
 *    tem quinzena vencida em aberto. A tela existe para dizer onde ir.
 * 3. **O cartão abre o ano.** Clicar leva a `<base>/unidades/:codigo`, que
 *    mostra as 24 quinzenas do ano daquela unidade — inclusive as que passaram
 *    sem competência aberta, que é o buraco que nenhuma lista de competências
 *    existentes consegue mostrar.
 */

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return (
    aviso.principal ??
    aviso.mensagemCrua ??
    "Não foi possível carregar o fechamento."
  );
}

/**
 * O cartão de uma unidade — o resumo executivo dela no ano.
 *
 * Três camadas, da mais grossa para a mais fina: o percentual de fechamento com
 * a contagem que o sustenta; o dinheiro que a apuração gravou; e a faixa das 24
 * quinzenas, que mostra *quando* o ano fechou e não só quanto.
 */
function CartaoDaUnidade({
  unidade,
  ano,
}: {
  unidade: ResumoDaUnidade;
  ano: number;
}) {
  const base = useBaseDoFechamento();
  const nome = nomeDaParte(unidade);
  const pendencia = [
    unidade.vencidas > 0 &&
      `${unidade.vencidas} vencida${unidade.vencidas === 1 ? "" : "s"} em aberto`,
    unidade.emCurso > 0 && `${unidade.emCurso} em curso`,
    unidade.lacunas > 0 &&
      `${unidade.lacunas} quinzena${unidade.lacunas === 1 ? "" : "s"} sem competência`,
  ].filter((p): p is string => typeof p === "string");

  return (
    <Link
      href={`${base}/unidades/${encodeURIComponent(unidade.codigo)}?ano=${ano}`}
      className="rounded-lg border bg-card p-5 block transition-colors hover:border-primary/50 hover:bg-muted/30"
      data-testid={`cartao-unidade-${unidade.codigo}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-bold truncate">{nome}</span>
          <span className="block text-xs text-muted-foreground truncate">
            {unidade.codigo} · {unidade.transportadoras.join(", ")}
          </span>
        </span>
        <span className="text-right shrink-0">
          <span className="block text-2xl font-bold tabular-nums leading-none">
            {Math.round(unidade.percentualEncerrado)}%
          </span>
          <span className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground mt-1">
            fechado
          </span>
        </span>
      </div>

      <div className="mt-4 space-y-1.5">
        <Barra percentual={unidade.percentualEncerrado} />
        <p className="text-xs text-muted-foreground">
          {unidade.encerradas} de {unidade.competencias} competência
          {unidade.competencias === 1 ? "" : "s"} encerrada
          {unidade.encerradas === 1 ? "" : "s"} em {ano}
        </p>
      </div>

      {pendencia.length > 0 && (
        <p
          className={cn(
            "text-xs mt-3 flex items-start gap-1.5",
            unidade.vencidas > 0
              ? "text-destructive font-medium"
              : "text-muted-foreground",
          )}
        >
          {unidade.vencidas > 0 && (
            <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          )}
          {pendencia.join(" · ")}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t">
        <div>
          <dt className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Emitido em CT-e
          </dt>
          <dd className="text-sm font-semibold tabular-nums mt-0.5">
            {unidade.apuradas === 0 ? (
              <span className="text-muted-foreground font-normal">
                sem apuração
              </span>
            ) : (
              formatBrlCompacto(unidade.emitido)
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            A questionar
          </dt>
          <dd className="text-sm font-semibold tabular-nums mt-0.5">
            {unidade.apuradas === 0 ? (
              <span className="text-muted-foreground font-normal">
                sem apuração
              </span>
            ) : unidade.aQuestionar > 0 ? (
              <>
                {formatBrlCompacto(unidade.aQuestionar)}{" "}
                <span className="text-muted-foreground font-normal">
                  ({unidade.aQuestionarQuantidade})
                </span>
              </>
            ) : (
              <span className="text-muted-foreground font-normal">nada</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-4">
        <FaixaDoAno quinzenas={unidade.quinzenas} />
        <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground mt-1.5 flex items-center justify-between">
          <span>jan</span>
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-xs">
            ver as 24 quinzenas <ArrowRight className="w-3 h-3" />
          </span>
          <span>dez</span>
        </p>
      </div>
    </Link>
  );
}

export default function VisaoGerencial() {
  const base = useBaseDoFechamento();
  const operacao = useOperacaoDoFechamento();
  const [, navegar] = useLocation();
  const busca = useSearch();
  /*
    A lista é a da **operação deste ambiente**, e não a do Fechamento inteiro:
    Rota e Empurrada são dois acervos, e uma lista sem recorte mostra as
    competências dos dois em qualquer um deles. A operação entra também na
    `queryKey` — sem isso a resposta de um ambiente ficaria em cache servindo o
    outro, que é o mesmo vazamento por outro caminho.
  */
  const apuracoes = useQuery({
    queryKey: ["fechamento", "apuracoes", operacao],
    queryFn: () => listarApuracoes(operacao),
  });
  const todas = useMemo(() => apuracoes.data ?? [], [apuracoes.data]);
  const anos = useMemo(() => anosComCompetencia(todas), [todas]);
  /*
    O ano vem da URL, como na tela da unidade: um endereço colado numa mensagem
    abre o mesmo ano que quem colou estava vendo. Enquanto ninguém escolheu — ou
    quando o ano pedido não existe nos dados —, vale o mais recente que tem
    competência, e não o ano do relógio: um banco cuja última quinzena é de
    dezembro passado abriria 24 casas vazias se a tela insistisse no calendário
    de hoje.
  */
  const pedido = Number(new URLSearchParams(busca).get("ano"));
  const ano = anos.includes(pedido) ? pedido : (anos[0] ?? null);

  /*
    O dia é lido uma vez por render e entra nas dependências do memo: as funções
    puras não leem o relógio por conta própria, para que o mesmo dado dê sempre a
    mesma tela no teste.
  */
  const diaDeHoje = hojeEm();
  const unidades = useMemo(
    () => (ano === null ? [] : resumirUnidades(todas, ano, diaDeHoje)),
    [todas, ano, diaDeHoje],
  );
  const total = useMemo(() => resumoExecutivo(unidades), [unidades]);

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Visão Gerencial
            </h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">
              Quanto do ano já foi fechado, em cada unidade — o que está
              encerrado, o que venceu sem fechar e quanto continua a questionar.
              Abra uma unidade para ver as quinzenas do ano, uma a uma.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {anos.length > 0 && (
              <Select
                value={String(ano)}
                onValueChange={(v) => navegar(`${base}?ano=${v}`)}
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
            <Link href={`${base}/competencias`}>
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

        {!apuracoes.isLoading && !apuracoes.isError && todas.length === 0 && (
          <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground max-w-2xl space-y-3">
            <p>
              Nenhuma competência ainda — e sem competência não há fechamento a
              medir. Uma competência é uma quinzena de um CDD com uma
              transportadora.
            </p>
            <p>
              Abra a primeira em{" "}
              <Link
                href={`${base}/competencias`}
                className="text-primary hover:underline"
              >
                Importações
              </Link>{" "}
              e envie os relatórios que a Ambev exporta no período. A partir
              deles o FreightCheck reconstrói a conta verba a verba, com a
              memória de cálculo de cada parcela, e aponta o que não fecha.
              Nenhum número aparece sem a linha de arquivo que o sustenta.
            </p>
          </div>
        )}

        {ano !== null && unidades.length > 0 && (
          <>
            <Card>
              <CardContent className="p-0 flex flex-wrap divide-x divide-y sm:divide-y-0">
                <Numero
                  rotulo="Fechamentos realizados"
                  valor={
                    total.percentualEncerrado === null
                      ? "—"
                      : `${Math.round(total.percentualEncerrado)}%`
                  }
                  barra={total.percentualEncerrado ?? 0}
                  detalhe={`${total.encerradas} de ${total.competencias} competências encerradas em ${ano}`}
                />
                <Numero
                  rotulo="Vencidas em aberto"
                  valor={String(total.vencidas)}
                  detalhe={
                    total.vencidas === 0
                      ? "nenhuma quinzena vencida sem encerrar"
                      : "quinzenas que terminaram e não fecharam"
                  }
                  alerta={total.vencidas > 0}
                />
                <Numero
                  rotulo="Sem competência"
                  valor={String(total.lacunas)}
                  detalhe={
                    total.lacunas === 0
                      ? "toda quinzena vencida tem competência"
                      : "quinzenas vencidas sem nada aberto"
                  }
                  alerta={total.lacunas > 0}
                />
                <Numero
                  rotulo="Emitido em CT-e"
                  valor={
                    total.apuradas === 0 ? "—" : formatBrlShort(total.emitido)
                  }
                  detalhe={
                    total.apuradas === 0
                      ? "nenhuma competência apurada ainda"
                      : total.percentualConferido === null
                        ? `${total.apuradas} competências apuradas · sem emissão a conferir`
                        : `${total.apuradas} competências apuradas · ${Math.round(total.percentualConferido)}% conferido`
                  }
                />
                <Numero
                  rotulo="A questionar"
                  valor={
                    total.apuradas === 0
                      ? "—"
                      : formatBrlShort(total.aQuestionar)
                  }
                  detalhe={
                    total.apuradas === 0
                      ? "nenhuma competência apurada ainda"
                      : total.aQuestionarQuantidade === 0
                        ? "nenhuma divergência sem desfecho"
                        : `${total.aQuestionarQuantidade} divergências sem desfecho`
                  }
                />
              </CardContent>
            </Card>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                <h2 className="text-base font-bold">
                  {total.unidades} unidade{total.unidades === 1 ? "" : "s"} em{" "}
                  {ano}{" "}
                  <span className="font-normal text-muted-foreground text-sm">
                    — em ordem do que está atrasado
                  </span>
                </h2>
                <LegendaDasSituacoes />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {unidades.map((unidade) => (
                  <CartaoDaUnidade
                    key={unidade.codigo}
                    unidade={unidade}
                    ano={ano}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {ano !== null && todas.length > 0 && unidades.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma competência em {ano}. Escolha outro ano no seletor acima.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                O processo, na ordem em que acontece
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {etapasDoFechamento(base).map((etapa, indice) => (
                <Link
                  key={etapa.href}
                  href={etapa.href}
                  className="flex items-start gap-4 px-6 py-4 border-t hover:bg-muted/40 transition-colors"
                >
                  <span
                    aria-hidden
                    className="w-7 h-7 rounded-full border border-border bg-muted flex items-center justify-center shrink-0 text-[0.75rem] font-bold tabular-nums text-muted-foreground"
                  >
                    {indice + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <etapa.icon className="w-4 h-4 text-nav-fechamento" />
                      {etapa.label}
                    </span>
                    <span className="block text-xs text-muted-foreground mt-0.5">
                      {etapa.pergunta}
                    </span>
                  </span>
                  <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground mt-1" />
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                Como isto conversa com a Auditoria
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <p>
                Os dois ambientes leem a mesma base e se completam: o Fechamento
                apura quanto a competência vale; a Auditoria confere se aquilo
                está correto — o que mudou, qual o impacto, o que há para
                recuperar. O valor apurado aqui é o que a Auditoria audita lá; a
                divergência encontrada lá volta para cá como pendência ou
                ajuste.
              </p>
              <p>
                A troca de ambiente é sempre dita: o seletor no topo da tela, ao
                lado da marca, mostra onde você está e leva ao outro espaço de
                trabalho.
              </p>
              <p>
                O percentual desta tela conta o fechamento que existe como
                registro: encerradas sobre competências abertas no ano. Quinzena
                que passou sem competência nenhuma não entra nessa conta — ela
                aparece à parte, como lacuna, dentro de cada unidade.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
