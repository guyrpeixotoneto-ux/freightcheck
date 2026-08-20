import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CloudDownload, TriangleAlert } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Layout } from "@/components/layout/layout";
import { ApiErrorNotice } from "@/components/api-error";
import { FaixaDoAno, LegendaDasSituacoes } from "@/components/auditoria/gerencial";
import { Barra, Numero } from "@/components/gerencial/executivo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { fetchJson } from "@/lib/api";
import { emDiaCurto, hojeEm } from "@/lib/calendario";
import {
  anosComVigencia,
  impactoDominante,
  impactosOrdenados,
  resumirUnidades,
  resumoExecutivo,
  type ResumoDaUnidade,
  type VigenciaDaAuditoria,
} from "@/lib/auditoria-gerencial";
import { formatBrlCompacto, formatNumber, periodicitySuffix } from "@/lib/format";
import { linkDosParametros } from "@/lib/recorte";
import { cn } from "@/lib/utils";

/**
 * Visão Gerencial — a auditoria do ano inteiro, unidade a unidade.
 *
 * **A pergunta que ela responde é de quem responde pela auditoria, não de quem
 * a executa.** Quem audita abre uma unidade e trabalha dentro dela — é o que o
 * Resumo executivo serve, e continua servindo. Quem responde pelo conjunto quer
 * saber outra coisa, e quer saber sem clicar: *quanto do que chegou já foi
 * comparado, em quais unidades, e onde está o que ninguém olhou.* Essa pergunta
 * não tinha tela: o produto tinha o retrato de uma unidade numa vigência e
 * nenhum retrato do acervo.
 *
 * É a irmã da Visão Gerencial do Fechamento, no mesmo formato e com outro
 * assunto. A simetria é deliberada — quem lê as duas não deve ter de reaprender
 * a faixa do ano —, e o que muda é o eixo: lá a competência que fecha, aqui a
 * vigência que chega.
 *
 * **O que ela mostra, e de onde vem.** Uma leitura só,
 * `GET /gerencial/vigencias`: toda vigência viva, com a comparação que o motor
 * gravou quando ela rodou. Nada aqui recompara nada, e abrir esta tela não
 * dispara comparação nenhuma — é o que faz a vigência nunca comparada aparecer
 * como buraco em vez de ser tapada em silêncio. A aritmética inteira mora em
 * `lib/auditoria-gerencial.ts`, testada fora do JSX.
 *
 * **Três decisões que a tela materializa:**
 *
 * 1. **O percentual é sobre o que era comparável**, e não sobre as vigências do
 *    ano: a primeira de uma série não tem anterior, e contá-la no denominador
 *    faria uma unidade recém-chegada aparecer eternamente atrasada por uma
 *    comparação que não existe.
 * 2. **A ordem dos cartões é a do trabalho que falta**, e não a alfabética:
 *    primeiro quem tem vigência sem comparação. A tela existe para dizer onde
 *    ir.
 * 3. **O cartão abre a unidade.** Clicar leva ao Resumo executivo daquele
 *    recorte — a tela que já responde pela unidade em profundidade. Uma
 *    terceira tela de unidade seria uma segunda verdade sobre o mesmo lugar.
 */

/**
 * O cartão de uma unidade — a auditoria dela no ano.
 *
 * Três camadas, da mais grossa para a mais fina: o percentual de comparação com
 * a contagem que o sustenta; o que a comparação encontrou — alterações e
 * dinheiro —; e a faixa das 24 quinzenas, que mostra *quando* o ano foi
 * auditado e não só quanto.
 */
function CartaoDaUnidade({ unidade, ano }: { unidade: ResumoDaUnidade; ano: number }) {
  const pendencia = [
    unidade.pendentes > 0 &&
      `${unidade.pendentes} vigência${unidade.pendentes === 1 ? "" : "s"} sem comparação`,
    unidade.iniciais > 0 &&
      `${unidade.iniciais} primeira${unidade.iniciais === 1 ? "" : "s"} da série`,
    unidade.lacunas > 0 &&
      `${unidade.lacunas} quinzena${unidade.lacunas === 1 ? "" : "s"} sem vigência`,
  ].filter((p): p is string => typeof p === "string");

  const impactos = impactosOrdenados(unidade.impacto);
  const dominante = impactos[0] ?? null;
  /*
    O que qualifica o que a comparação encontrou — e o que explica por que a
    contagem de alterações e o dinheiro nunca se leem um pelo outro. "Sem preço"
    é a alteração real que o motor não consegue precificar; "inconclusivas" são
    as que ele não conseguiu nem comparar; e "fora da soma" são as que existem e
    **não** entram no impacto, porque contá-las seria contar o mesmo dinheiro
    duas vezes (ver `deduplicacao.ts`). Nenhuma das três é somável às outras.
  */
  const qualidade = [
    unidade.semPreco > 0 && `${formatNumber(unidade.semPreco, 0)} sem preço`,
    unidade.inconclusivas > 0 && `${formatNumber(unidade.inconclusivas, 0)} inconclusivas`,
    unidade.foraDoTotal > 0 &&
      `${formatNumber(unidade.foraDoTotal, 0)} fora da soma por dupla contagem`,
  ].filter((p): p is string => typeof p === "string");

  return (
    <Link
      /*
        O cartão abre os **Parâmetros** da unidade, e não o Resumo executivo.

        A pergunta que este cartão deixa em aberto é "3.202 alterações no ano, e
        o que mudou?", e quem responde isso é a grade de atributos — coluna a
        coluna, por cavalo, carreta, conjunto, trecho e QLP. O Resumo executivo
        respondia meio degrau antes, e obrigava a um segundo clique para chegar
        onde a pergunta ia dar de qualquer forma.

        **A vigência viaja junto, e é a última daquela unidade.** Sem ela
        Parâmetros abriria a mais recente do banco, que numa base com várias
        unidades pode ser de outra; com ela, a quinzena que abre é a mesma que o
        cartão anuncia duas linhas acima ("última vigência em 01/08"). O cartão
        fala do ano e a tela de destino fala de uma quinzena — a troca de escala
        é real, e é por isso que ela está escrita no cartão e não deduzida lá.
      */
      href={linkDosParametros({
        period: unidade.ultimaVigencia,
        scopeHash: unidade.scopeHash,
        /*
          `canal: ""` não é a ausência de canal: é a partição das vigências cujo
          rótulo não declara um. É a mesma distinção que `parseContext` faz do
          outro lado, e mandar `null` aqui faria o link abrir a unidade com o
          canal que o servidor escolher, que pode ser outro.
        */
        canal: unidade.channel ?? "",
      })}
      className="rounded-lg border bg-card p-5 block transition-colors hover:border-primary/50 hover:bg-muted/30"
      data-testid={`cartao-unidade-${unidade.scopeHash}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="block font-bold truncate">{unidade.nome}</span>
          <span className="block text-xs text-muted-foreground truncate">
            {[unidade.label, unidade.coberturas.join(" + ")].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="text-right shrink-0">
          <span className="block text-2xl font-bold tabular-nums leading-none">
            {unidade.percentualAuditado === null
              ? "—"
              : `${Math.round(unidade.percentualAuditado)}%`}
          </span>
          <span className="block text-[0.6875rem] uppercase tracking-wide text-muted-foreground mt-1">
            auditado
          </span>
        </span>
      </div>

      <div className="mt-4 space-y-1.5">
        <Barra percentual={unidade.percentualAuditado ?? 0} />
        <p className="text-xs text-muted-foreground">
          {unidade.percentualAuditado === null ? (
            <>
              {unidade.vigencias} vigência{unidade.vigencias === 1 ? "" : "s"} em {ano} — nenhuma
              com anterior a comparar
            </>
          ) : (
            <>
              {unidade.auditadas} de {unidade.comparaveis} vigência
              {unidade.comparaveis === 1 ? "" : "s"} comparada
              {unidade.auditadas === 1 ? "" : "s"} em {ano}
            </>
          )}
        </p>
        {/*
          Quando a unidade publicou pela última vez, e com que frota. Não é
          enfeite: numa tela que ordena pelo que falta auditar, a unidade que
          parou de publicar não produz pendência nenhuma — ela simplesmente some
          do noticiário —, e esta linha é o que a denuncia.
        */}
        {unidade.ultimaVigencia !== null && (
          <p className="text-xs text-muted-foreground">
            última vigência em {emDiaCurto(unidade.ultimaVigencia)} ·{" "}
            {formatNumber(unidade.ativos, 0)} ativo{unidade.ativos === 1 ? "" : "s"}
          </p>
        )}
      </div>

      {pendencia.length > 0 && (
        <p
          className={cn(
            "text-xs mt-3 flex items-start gap-1.5",
            unidade.pendentes > 0 ? "text-destructive font-medium" : "text-muted-foreground",
          )}
        >
          {unidade.pendentes > 0 && <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />}
          {pendencia.join(" · ")}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t">
        <div>
          <dt className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Alterações
          </dt>
          <dd className="text-sm font-semibold tabular-nums mt-0.5">
            {unidade.auditadas === 0 ? (
              <span className="text-muted-foreground font-normal">sem comparação</span>
            ) : (
              formatNumber(unidade.alteracoes, 0)
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            Impacto apurado
          </dt>
          <dd className="text-sm font-semibold tabular-nums mt-0.5">
            {unidade.auditadas === 0 ? (
              <span className="text-muted-foreground font-normal">sem comparação</span>
            ) : dominante === null ? (
              <span className="text-muted-foreground font-normal">nada apurável</span>
            ) : (
              <>
                {formatBrlCompacto(dominante.amount)}
                <span className="text-muted-foreground font-normal">
                  {periodicitySuffix(dominante.periodicity)}
                </span>
                {/*
                  A segunda periodicidade nunca some — ela não entra no número
                  porque R$/mês e R$/ano não se somam, e um cartão que mostrasse
                  só o mensal de quem também tem anual estaria escondendo
                  dinheiro. O contador diz que há mais, e a unidade aberta mostra
                  cada uma.
                */}
                {impactos.length > 1 && (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    (+{impactos.length - 1})
                  </span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>

      {qualidade.length > 0 && (
        <p className="text-xs text-muted-foreground mt-2">{qualidade.join(" · ")}</p>
      )}

      <div className="mt-4">
        <FaixaDoAno quinzenas={unidade.quinzenas} />
        <p className="text-[0.6875rem] uppercase tracking-wide text-muted-foreground mt-1.5 flex items-center justify-between">
          <span>jan</span>
          {/*
            O rótulo nomeia o destino em vez de dizer "abrir".

            "Abrir a unidade" não diz onde se cai, e cair numa tela que fala de
            uma quinzena depois de clicar num cartão que fala do ano parece
            defeito quando ninguém avisou. Dizendo "ver os parâmetros", a troca
            de assunto é escolhida e não sofrida.
          */}
          <span className="inline-flex items-center gap-1 normal-case tracking-normal text-xs">
            ver os parâmetros <ArrowRight className="w-3 h-3" />
          </span>
          <span>dez</span>
        </p>
      </div>
    </Link>
  );
}

export default function VisaoGerencialDaAuditoria() {
  const [, navegar] = useLocation();
  const busca = useSearch();
  const vigencias = useQuery({
    queryKey: ["gerencial", "vigencias"],
    queryFn: () => fetchJson<VigenciaDaAuditoria[]>("/gerencial/vigencias"),
  });

  const todas = useMemo(() => vigencias.data ?? [], [vigencias.data]);
  const anos = useMemo(() => anosComVigencia(todas), [todas]);
  /*
    O ano vem da URL, como o recorte das outras telas da Auditoria: um endereço
    colado numa mensagem abre o mesmo ano que quem colou estava vendo. Enquanto
    ninguém escolheu — ou quando o ano pedido não existe nos dados —, vale o
    mais recente que tem vigência, e não o ano do relógio: um acervo cuja última
    vigência é de dezembro passado abriria 24 casas vazias se a tela insistisse
    no calendário de hoje.
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
  const impactoDoAno = impactoDominante(total.impacto);
  const periodicidades = impactosOrdenados(total.impacto).length;

  const titulo =
    total.contextos === total.unidades
      ? `${total.unidades} unidade${total.unidades === 1 ? "" : "s"} em ${ano}`
      : `${total.contextos} seleções (unidade + canal) em ${ano}`;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Visão Gerencial</h1>
            <p className="text-muted-foreground mt-2 max-w-3xl">
              Quanto do ano já foi auditado, em cada unidade — o que chegou, o que
              foi comparado com a vigência anterior, o que mudou e quanto isso
              custa. Abrir uma unidade leva aos parâmetros dela, na última
              vigência que ela publicou.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {anos.length > 0 && (
              <Select
                value={String(ano)}
                onValueChange={(v) => navegar(`/visao-gerencial?ano=${v}`)}
              >
                <SelectTrigger
                  className="h-auto w-auto gap-2 rounded-full px-4 py-2 shadow-none"
                  aria-label="Ano"
                >
                  <span className="font-semibold">Ano</span>
                  <span className="font-normal text-muted-foreground tabular-nums">{ano}</span>
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
            <Link href="/importacoes">
              <Button size="sm" variant="outline">
                <CloudDownload className="w-3.5 h-3.5 mr-1.5" />
                Importar vigência
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="p-8 space-y-6">
        {vigencias.isError && (
          <ApiErrorNotice
            error={vigencias.error}
            what="O quadro das unidades não pôde ser carregado."
          />
        )}

        {vigencias.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {!vigencias.isLoading && !vigencias.isError && todas.length === 0 && (
          <div className="rounded-lg border bg-card p-8 text-sm text-muted-foreground max-w-2xl space-y-3">
            <p>
              Nenhuma vigência importada ainda — e sem vigência não há auditoria a
              medir. Uma vigência é a planilha de remuneração de uma unidade num
              canal, numa data.
            </p>
            <p>
              Envie a primeira em{" "}
              <Link href="/importacoes" className="text-primary hover:underline">
                Importações
              </Link>
              . A partir da segunda, o FreightCheck compara as duas parâmetro a
              parâmetro e diz o que mudou, em quantos ativos e quanto custa —
              nenhum número aparece sem a célula de origem que o sustenta.
            </p>
          </div>
        )}

        {ano !== null && unidades.length > 0 && (
          <>
            <Card>
              <CardContent className="p-0 flex flex-wrap divide-x divide-y sm:divide-y-0">
                <Numero
                  rotulo="Vigências auditadas"
                  valor={
                    total.percentualAuditado === null
                      ? "—"
                      : `${Math.round(total.percentualAuditado)}%`
                  }
                  barra={total.percentualAuditado ?? 0}
                  detalhe={
                    total.percentualAuditado === null
                      ? `${total.vigencias} vigência${total.vigencias === 1 ? "" : "s"} em ${ano} — nenhuma com anterior a comparar`
                      : `${total.auditadas} de ${total.comparaveis} vigência${total.comparaveis === 1 ? "" : "s"} comparada${total.auditadas === 1 ? "" : "s"} em ${ano}`
                  }
                />
                <Numero
                  rotulo="Sem comparação"
                  valor={String(total.pendentes)}
                  detalhe={
                    total.pendentes === 0
                      ? "toda vigência com anterior foi comparada"
                      : `vigência${total.pendentes === 1 ? "" : "s"} que ${total.pendentes === 1 ? "chegou" : "chegaram"} e ninguém comparou`
                  }
                  alerta={total.pendentes > 0}
                />
                <Numero
                  rotulo="Alterações"
                  valor={total.auditadas === 0 ? "—" : formatNumber(total.alteracoes, 0)}
                  detalhe={
                    total.auditadas === 0
                      ? "nenhuma comparação no ano"
                      : `apuradas em ${total.auditadas} comparaç${total.auditadas === 1 ? "ão" : "ões"} · ${total.entrantes} ativo${total.entrantes === 1 ? "" : "s"} entr${total.entrantes === 1 ? "ou" : "aram"}, ${total.saintes} sa${total.saintes === 1 ? "iu" : "íram"}`
                  }
                />
                <Numero
                  rotulo="Impacto apurado"
                  /*
                    Compacto, e não o valor cheio: um `−R$ 735.312` com a
                    periodicidade ao lado não cabe em nenhum corpo que este
                    tijolo comporte. A precisão exata não se perde — ela está na
                    unidade aberta e em Alterações, que é onde o número é
                    discutido —, e a periodicidade vai no `sufixo`, que é o que
                    a impede de sumir junto com os dígitos.
                  */
                  valor={
                    impactoDoAno === null ? "—" : formatBrlCompacto(impactoDoAno.amount)
                  }
                  sufixo={
                    impactoDoAno === null
                      ? undefined
                      : periodicitySuffix(impactoDoAno.periodicity)
                  }
                  detalhe={
                    impactoDoAno === null
                      ? "nenhum impacto apurável no ano"
                      : periodicidades === 1
                        ? "o dinheiro contado uma vez só, já deduplicado"
                        : `e mais ${periodicidades - 1} periodicidade${periodicidades === 2 ? "" : "s"} — nunca somadas entre si`
                  }
                />
                <Numero
                  rotulo="Sem preço"
                  valor={total.auditadas === 0 ? "—" : formatNumber(total.semPreco, 0)}
                  detalhe={
                    total.auditadas === 0
                      ? "nenhuma comparação no ano"
                      : `alterações sem impacto apurável · ${formatNumber(total.inconclusivas, 0)} inconclusivas`
                  }
                />
              </CardContent>
            </Card>

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                <h2 className="text-base font-bold">
                  {titulo}{" "}
                  <span className="font-normal text-muted-foreground text-sm">
                    — em ordem do que falta auditar
                  </span>
                </h2>
                <LegendaDasSituacoes />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {unidades.map((unidade) => (
                  <CartaoDaUnidade
                    key={`${unidade.scopeHash}|${unidade.channel ?? ""}`}
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
            Nenhuma vigência em {ano}. Escolha outro ano no seletor acima.
          </p>
        )}

        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">O que esta tela conta</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <p>
                <strong className="text-foreground">Auditar, aqui, é comparar.</strong> Uma
                vigência está auditada quando foi posta contra a anterior da mesma
                série — mesma unidade, mesmo canal, mesma cobertura — e o motor
                gravou o que mudou. O percentual conta isso e nada mais.
              </p>
              <p>
                <strong className="text-foreground">
                  Vigência sem comparação não é vigência sem alteração.
                </strong>{" "}
                As duas dariam zero numa contagem ingênua, e são opostas: uma é
                “o cliente não mexeu”, a outra é “ninguém olhou”. Abrir esta tela
                não dispara comparação nenhuma, justamente para que a segunda
                continue visível.
              </p>
              <p>
                <strong className="text-foreground">
                  Quinzena sem vigência não é atraso.
                </strong>{" "}
                A fonte publica quando muda alguma coisa. A casa vazia da faixa
                diz que nada foi publicado naquela quinzena — é o ritmo do
                cliente, e por isso ela nunca aparece em vermelho.
              </p>
              <p>
                <strong className="text-foreground">Periodicidade não soma.</strong> O
                impacto sai por periodicidade, e o cartão mostra a de maior
                movimento com o contador das demais ao lado. R$/mês e R$/ano são
                grandezas diferentes numa vigência e continuam diferentes em
                cinquenta.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Como isto conversa com o Fechamento</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <p>
                Os dois ambientes leem a mesma base e se completam: a Auditoria
                confere se o cadastro está correto — o que mudou, qual o impacto,
                o que há para recuperar; o Fechamento apura quanto a competência
                vale. A divergência encontrada aqui volta para lá como pendência
                ou ajuste; o valor apurado lá é o que se audita aqui.
              </p>
              <p>
                A troca de ambiente é sempre dita: o seletor no topo da tela, ao
                lado da marca, mostra onde você está e leva ao outro espaço de
                trabalho — onde a Visão Gerencial do Fechamento responde a mesma
                pergunta sobre o outro eixo.
              </p>
              {/*
                A frase precisa acompanhar o cartão. Ela dizia "o caminho
                continua sendo o de sempre: Resumo executivo…" enquanto o cartão
                passou a abrir os Parâmetros — e uma tela que aponta um caminho e
                anda por outro faz quem lê duvidar dos dois.
              */}
              <p>
                O cartão desce direto para os{" "}
                <Link href="/parametros" className="text-primary hover:underline">
                  Parâmetros
                </Link>{" "}
                da unidade, que é onde o "o que mudou" está atributo a atributo. Os
                outros dois caminhos continuam abertos pela lateral:{" "}
                <Link href="/" className="text-primary hover:underline">
                  Resumo executivo
                </Link>{" "}
                para os números da vigência aberta,{" "}
                <Link href="/alteracoes" className="text-primary hover:underline">
                  Alterações
                </Link>{" "}
                para as linhas que os produziram.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
