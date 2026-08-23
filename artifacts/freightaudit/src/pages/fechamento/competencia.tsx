import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CalendarDays,
  Check,
  FileUp,
  Lock,
  LockOpen,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { useBaseDoFechamento } from "@/lib/base-do-fechamento";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GradeDeDias } from "@/components/fechamento/grade-de-dias";
import { ContaApurada } from "@/components/fechamento/conta-apurada";
import {
  FecharQuinzena,
  ReabrirQuinzena,
  oQueQuestionar,
} from "@/components/fechamento/fechar-quinzena";
import { apresentar } from "@/lib/apresentar-erro";
import {
  avisoDoEnvio,
  chaveDaCompetencia,
  chaveDoDiagnostico,
  chaveDoDiario,
  estadoDaFonte,
  oQueDizerDoSemVerba,
  type AvisoDoEnvio,
} from "@/lib/fechamento-tela";
import { formatBrl, formatNumber } from "@/lib/format";
import {
  apurar,
  descartarDados,
  diagnosticarDocumento,
  enviarDocumento,
  fontesDaCompetencia,
  fontesParaEnviar,
  type ContratoDaCompetencia,
  lerCompetencia,
  lerDiario,
  listarFontes,
  listarLadosDaConferencia,
  reimportarDocumento,
  EXPLICACAO_DA_DIVERGENCIA,
  NOME_DO_ESTADO,
  type DadosDescartados,
  type Documento,
  type Fonte,
  type TipoDeFonte,
} from "@/lib/fechamento";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

const emDiaBR = (iso: string) => iso.split("-").reverse().join("/");

/**
 * A competência aberta — onde o fechamento acontece.
 *
 * A tela tem cinco partes, e a ordem é a do trabalho: recebe os relatórios
 * que a Ambev exporta, mostra o que a operação rodou dia a dia, roda
 * a conta, mostra o que não fecha e salva a quinzena. É esta tela que substitui
 * a pasta de Excel de 44 abas — a grade de dias no lugar das abas `01`…`31`, a
 * conta no lugar dos PROCVs entre elas.
 *
 * **Por que a apuração é um botão e não acontece sozinha ao subir o último
 * arquivo.** Porque rodar grava: a apuração vigente anterior é despromovida e
 * uma nova entra no lugar (ver `fechamento_apuracao`). Um recálculo automático
 * mudaria, sem ninguém pedir, o número que alguém pode ter aprovado — e a
 * aprovação deixaria de significar coisa alguma. O botão é o consentimento.
 *
 * **Por que a conta roda com menos fontes do que o catálogo pede.** Porque quase sempre é
 * assim que o dia funciona: o relatório de conciliação sai depois dos outros.
 * A apuração roda com o que há, diz nominalmente o que falta, e o que ela não
 * consegue sustentar aparece como não conferido em vez de virar zero.
 */
export default function CompetenciaAberta({ id }: { id: string }) {
  const base = useBaseDoFechamento();
  const cliente = useQueryClient();
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  /*
    O envio que chegou e não valeu. É estado à parte do erro porque não é erro:
    o arquivo está guardado, a importação anterior continua de pé, e nada
    quebrou — só não aconteceu o que quem clicou achava que ia acontecer. Tratar
    o 202 como sucesso mudo era o que fazia alguém subir o 03.08.20, não ver
    aviso nenhum e concluir que estava importado.
  */
  const [quarentena, setQuarentena] = useState<AvisoDoEnvio | null>(null);
  /*
    O descarte pergunta antes, e a pergunta mora na tela em vez de num
    `window.confirm`: o diálogo do navegador não sabe dizer *quantos* arquivos
    vão embora, e ver o tamanho do que se vai apagar é a única defesa real
    contra apagar a competência errada.
  */
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [descartado, setDescartado] = useState<DadosDescartados | null>(null);

  const dados = useQuery({
    queryKey: chaveDaCompetencia(id),
    queryFn: () => lerCompetencia(id),
  });
  const fontes = useQuery({
    queryKey: ["fechamento", "fontes"],
    queryFn: listarFontes,
  });
  /*
    O agrupamento é catálogo, como as fontes: muda quando o domínio muda, não
    quando a competência muda. Fica na mesma chave estável do react-query e é
    buscado uma vez por sessão.
  */
  const lados = useQuery({
    queryKey: ["fechamento", "lados"],
    queryFn: listarLadosDaConferencia,
  });
  /*
    O diário continua sendo consulta própria, e não parte de `lerCompetencia`:
    ele muda por outro motivo (o 2Art entrou) e é lido por outra tela (a do dia).

    **O que mudou é a chave, e é uma reversão consciente.** Ela era irmã da
    competência, para que apurar não reinvalidasse uma grade de dias que não
    mudou; hoje é filha, e apurar a reinvalida. O que se comprou com esse
    pedido a mais foi a regra sem exceção — *tudo que se pergunta sobre uma
    competência pendura-se na chave dela* —, e o que se pagava sem ela foi o
    painel da planilha: irmão também, esquecido em todas as invalidações,
    dizendo que o 03.08.20 não fora importado enquanto a lista o mostrava. Uma
    regra com uma exceção não teria como avisar quem escrevesse a próxima
    consulta de qual das duas metades ele estava.
  */
  const diario = useQuery({
    queryKey: chaveDoDiario(id),
    queryFn: () => lerDiario(id),
  });

  const enviar = useMutation({
    mutationFn: ({ tipo, arquivo }: { tipo: TipoDeFonte; arquivo: File }) =>
      enviarDocumento(id, tipo, arquivo),
    onMutate: () => {
      setErroDoEnvio(null);
      setQuarentena(null);
    },
    onError: (erro) => setErroDoEnvio(textoDoErro(erro)),
    onSuccess: (recebido) => {
      setQuarentena(avisoDoEnvio(recebido));
      /* Uma chamada, e ela alcança a competência, a grade de dias e o painel da
         planilha — os três pendurados na mesma chave (ver `chaveDaCompetencia`).
         Antes o painel ficava de fora, e continuava dizendo que o arquivo não
         tinha sido importado enquanto a lista, um cartão acima, o mostrava. */
      void cliente.invalidateQueries({ queryKey: chaveDaCompetencia(id) });
      /* O resumo do mês lê as mesmas linhas por outra chave, de outra tela: é
         ele que diz "sem verba do 03.08.20" nas duas quinzenas. */
      void cliente.invalidateQueries({ queryKey: ["fechamento", "resumo"] });
    },
  });

  const rodar = useMutation({
    mutationFn: () => apurar(id),
    onSuccess: () => {
      setDescartado(null);
      void cliente.invalidateQueries({ queryKey: chaveDaCompetencia(id) });
      /* O resumo do mês lê as mesmas linhas por outra chave, de outra tela: é
         ele que diz "sem verba do 03.08.20" nas duas quinzenas. */
      void cliente.invalidateQueries({ queryKey: ["fechamento", "resumo"] });
    },
  });

  const descartar = useMutation({
    mutationFn: () => descartarDados(id),
    onSuccess: (resultado) => {
      setConfirmandoDescarte(false);
      setDescartado(resultado);
      setErroDoEnvio(null);
      void cliente.invalidateQueries({ queryKey: chaveDaCompetencia(id) });
      /* O resumo do mês lê as mesmas linhas por outra chave, de outra tela: é
         ele que diz "sem verba do 03.08.20" nas duas quinzenas. */
      void cliente.invalidateQueries({ queryKey: ["fechamento", "resumo"] });
      /* As duas listas do ambiente liam o que acabou de sair. A grade de dias e
         o painel saem junto com a competência, por serem filhos dela. */
      void cliente.invalidateQueries({
        queryKey: ["fechamento", "competencias"],
      });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "apuracoes"] });
    },
  });

  if (dados.isLoading) {
    return (
      <Layout>
        <div className="p-8 text-sm text-muted-foreground">
          Carregando a competência…
        </div>
      </Layout>
    );
  }
  if (dados.isError || !dados.data) {
    return (
      <Layout>
        <div className="p-8">
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
          </Alert>
        </div>
      </Layout>
    );
  }

  const { competencia, documentos, apuracao } = dados.data;
  const encerrada = competencia.estado === "ENCERRADA";
  const vigentes = new Map(
    documentos.filter((d) => d.vigente).map((d) => [d.tipo, d]),
  );
  /*
    O que ainda não chegou, nomeado. Com a quinzena fechada é esta lista que
    explica por que alguém quer reabri-la: "falta o 03.08.20" é uma frase
    acionável, "falta 1 relatório" não é.

    Sai dos relatórios que **esta** quinzena espera, e não das seis do catálogo:
    era o catálogo inteiro, e por isso toda primeira quinzena fechada oferecia
    reabertura para enviar a conciliação — um arquivo que não existe ali. Pelo
    mesmo motivo o 03.08.12.09 opcional não entra aqui: ele pode ser enviado, e
    não é cobrado.
  */
  const esperados = fontesDaCompetencia(
    fontes.data ?? [],
    competencia.quinzena,
    [...vigentes.keys()],
  );
  const faltando = esperados.filter((f) => !vigentes.has(f.tipo));
  /*
    A fila do que questionar sai de `oQueQuestionar`, e não de um filtro escrito
    aqui: é o mesmo número que o resumo do fechamento mostra ao lado do botão de
    congelar, e duas contas iguais em dois lugares divergiriam um dia.
  */
  const { acionaveis, aReceber } = apuracao
    ? oQueQuestionar(apuracao)
    : { acionaveis: [], aReceber: 0 };
  /*
    As casinhas de envio desta quinzena, e não as seis do catálogo: a primeira
    não tem a conciliação. O 03.08.12.09 aparece nas duas — esperado na segunda,
    opcional na primeira —, e o que já foi enviado entra na lista de qualquer
    forma. Ver `fontesParaEnviar`, e `fontesDaCompetencia` para o denominador,
    que é a outra lista de propósito.
  */
  const catalogo = fontesParaEnviar(fontes.data ?? [], competencia.quinzena, [
    ...vigentes.keys(),
  ]);

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <Link
          href={`${base}/competencias`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Importações
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            {emDiaBR(competencia.inicio)} a {emDiaBR(competencia.fim)}
          </h1>
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            {NOME_DO_ESTADO[competencia.estado]}
          </span>
        </div>
        <p className="text-muted-foreground mt-2">
          {competencia.unidade.nome ?? competencia.unidade.codigo} ·{" "}
          {competencia.transportadora.nome ?? competencia.transportadora.codigo}
        </p>
        {encerrada && (
          /*
            O aviso de congelada traz o caminho de volta junto, e não só a
            constatação. Dizer "nada mais entra nela sem reabertura" sem
            oferecer a reabertura ali mesmo obriga quem precisa enviar o
            relatório que faltou a descer a tela inteira — passando pela conta e
            pelas divergências — até o painel do fim, e quem não sabia que ele
            existe conclui que não dá.
          */
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
              <Lock className="w-3.5 h-3.5" />
              Quinzena salva e congelada em{" "}
              {new Date(competencia.encerradaEm!).toLocaleString("pt-BR")}. Nada
              mais entra nela sem reabertura.
            </p>
            <ReabrirQuinzena competencia={competencia} rotulo="Reabrir" />
          </div>
        )}
        {competencia.motivoDaReabertura && !encerrada && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-amber-700">
            <LockOpen className="w-3.5 h-3.5" />
            Reaberta: {competencia.motivoDaReabertura}
          </p>
        )}
      </header>

      <div className="p-8 space-y-6 max-w-5xl">
        {/* ---------------------------------------------------------------
            1. Os relatórios
            --------------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              Os relatórios da quinzena
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {competencia.quinzena === 1
                ? "Cinco exportações do Promax/SRTrans, e as requisições (03.08.12.09) quando a quinzena teve alguma aprovada: elas podem existir aqui, então a casinha fica de pé sem que a falta seja cobrada. A conciliação (03.02.59.02) é a única que não existe na 1ª — ela chega com o fechamento da 2ª."
                : "Sete exportações do Promax/SRTrans."}{" "}
              Cada relatório diz abaixo em que formatos ele é lido. A conta roda
              com o que houver — o que faltar aparece nomeado na apuração, nunca
              como zero.
            </p>
            {/*
              O 03.08.18 tem duas casinhas, e quem opera precisa saber disso
              antes de clicar: as duas exportações do Promax chegam separadas —
              uma da frota fixa, outra das vans — e cada uma tem a sua vigência.
              O arquivo único de duas abas é o mesmo nas duas: cada casinha lê a
              frota dela e ignora a outra, e por isso mandá-lo duas vezes não
              dobra a conta.
            */}
            <p className="text-sm text-muted-foreground">
              O 03.08.18 vem em dois — <strong>FF</strong> e{" "}
              <strong>Vans</strong> —, e cada um tem a sua casinha nas duas
              quinzenas: são frotas diferentes e descontos diferentes. Se a sua
              exportação vier com as duas abas num arquivo só, mande o mesmo
              arquivo nas duas: cada casinha lê a frota dela.
            </p>
            {/*
              A reabertura aparece aqui, e não só no painel do fim da tela,
              porque é aqui que ela é procurada: a Ambev manda o relatório que
              faltava depois de a quinzena ter fechado, e quem recebeu está
              olhando para o botão de enviar que não clica. O bloco é o mesmo
              componente das outras duas telas — o formulário de reabrir mora
              num lugar só (ver `components/fechamento/fechar-quinzena`).
            */}
            {encerrada && (
              <Alert>
                <Lock className="w-4 h-4" />
                <AlertDescription className="space-y-2">
                  <p>
                    Enviar e substituir estão travados enquanto a quinzena
                    estiver fechada.
                    {faltando.length > 0 && (
                      <>
                        {" "}
                        Falta{faltando.length > 1 ? "m" : ""}{" "}
                        {faltando.map((f) => f.rotina).join(", ")}.
                      </>
                    )}
                  </p>
                  <p>
                    Reabrir destrava o envio: escreva o motivo, mande o arquivo
                    e apure de novo — a apuração de hoje continua valendo até a
                    próxima rodar, e fechar de novo é o mesmo botão do fim da
                    tela.
                  </p>
                  <ReabrirQuinzena
                    competencia={competencia}
                    rotulo={
                      faltando.length > 0
                        ? "Reabrir para enviar o que falta"
                        : "Reabrir a quinzena"
                    }
                  />
                </AlertDescription>
              </Alert>
            )}
            {erroDoEnvio && (
              <Alert variant="destructive">
                <AlertDescription>{erroDoEnvio}</AlertDescription>
              </Alert>
            )}
            {quarentena && (
              /*
                Nem destrutivo nem silencioso: o arquivo chegou inteiro e está
                guardado — o que não aconteceu foi ele virar a conta. O motivo
                vem do servidor, que é quem leu o arquivo, e diz o que fazer.
              */
              <Alert>
                <AlertTriangle className="w-4 h-4" />
                <AlertDescription>
                  <strong>
                    {quarentena.nomeDoArquivo} chegou e não valeu.
                  </strong>{" "}
                  {quarentena.motivo}
                </AlertDescription>
              </Alert>
            )}
            {/*
              Os relatórios saem agrupados **pelo lado da conferência que eles
              alimentam**, e não numa lista só.

              O fechamento confere dois lados que saem de arquivos diferentes —
              o devido, derivado do contrato e da operação, contra o demonstrado
              do 03.08.20 —, e uma lista plana escondia isso: seis linhas iguais
              não dizem que faltar o 2Art e faltar o 03.08.20 quebram coisas
              opostas. O agrupamento vem do domínio (`LADOS_DA_CONFERENCIA`),
              porque é afirmação sobre a conta, não sobre o layout.

              E é no primeiro grupo que entra a peça que não é arquivo: o
              contrato. Era ela que faltava numa competência real com os três
              relatórios do devido importados, três vistos verdes, e nenhum
              devido saindo do outro lado do produto.
            */}
            {(lados.data ?? []).map(
              ({ lado, titulo, explica, precisaDeContrato }) => {
                const doLado = catalogo.filter((f) => f.lado === lado);
                if (doLado.length === 0) return null;
                return (
                  <section key={lado} className="space-y-1">
                    <div className="pt-2">
                      <h3 className="text-sm font-semibold">{titulo}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
                        {explica}
                      </p>
                    </div>
                    <ul className="divide-y">
                      {doLado.map((fonte) => (
                        <LinhaDeFonte
                          key={fonte.tipo}
                          fonte={fonte}
                          documento={vigentes.get(fonte.tipo)}
                          competenciaId={id}
                          semVerba={
                            estadoDaFonte(vigentes.get(fonte.tipo)) ===
                            "SEM_VERBA"
                          }
                          foraDaQuinzena={
                            !fonte.quinzenas.includes(competencia.quinzena) &&
                            !fonte.quinzenasOpcionais.includes(
                              competencia.quinzena,
                            )
                          }
                          opcionalNaQuinzena={fonte.quinzenasOpcionais.includes(
                            competencia.quinzena,
                          )}
                          quinzena={competencia.quinzena}
                          enviando={
                            enviar.isPending &&
                            enviar.variables?.tipo === fonte.tipo
                          }
                          travada={encerrada}
                          onArquivo={(arquivo) =>
                            enviar.mutate({ tipo: fonte.tipo, arquivo })
                          }
                        />
                      ))}
                      {precisaDeContrato && (
                        <LinhaDoContrato
                          contrato={dados.data?.contrato ?? null}
                          quinzena={competencia.quinzena}
                        />
                      )}
                    </ul>
                  </section>
                );
              },
            )}
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------------
            2. Os dias
            --------------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="w-4 h-4" />
              Os dias da quinzena
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              O que a operação rodou, dia a dia, do 2Art. Clique num dia para
              ver as viagens daquele dia inteiras — placa, mapa, caixas,
              horários e a cadeia de imposto —, com os totais por frota que se
              comparam ao SRTrans.
            </p>
            {diario.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(diario.error)}</AlertDescription>
              </Alert>
            )}
            {diario.isLoading && (
              <p className="text-sm text-muted-foreground">
                Carregando os dias…
              </p>
            )}
            {diario.data && (
              <>
                {!diario.data.fonte && (
                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      O 2Art ainda não foi enviado. A grade abaixo é o
                      calendário da quinzena, e não a operação dela: dia vazio
                      aqui quer dizer que ninguém importou o relatório, não que
                      ninguém rodou.
                    </AlertDescription>
                  </Alert>
                )}
                <GradeDeDias competenciaId={id} dias={diario.data.dias} />
                <p className="text-xs text-muted-foreground">
                  {formatNumber(
                    diario.data.dias.reduce((s, d) => s + d.totais.viagens, 0),
                    0,
                  )}{" "}
                  viagem(ns) no período
                  {diario.data.viagensForaDoPeriodo > 0 && (
                    <>
                      {" "}
                      · {formatNumber(diario.data.viagensForaDoPeriodo, 0)} do
                      2Art ficaram de fora, por serem de fora de{" "}
                      {emDiaBR(competencia.inicio)} a {emDiaBR(competencia.fim)}{" "}
                      — elas não entram em conta nenhuma daqui
                    </>
                  )}
                  .
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------------
            3. A conta
            --------------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3 flex-row items-center justify-between gap-4 space-y-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Calculator className="w-4 h-4" />A conta da quinzena
            </CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {confirmandoDescarte ? (
                <>
                  <span className="text-sm text-muted-foreground">
                    Apagar {documentos.length} arquivo(s) e a apuração desta
                    competência?
                  </span>
                  <Button
                    variant="destructive"
                    onClick={() => descartar.mutate()}
                    disabled={descartar.isPending}
                  >
                    {descartar.isPending ? "Descartando…" : "Sim, descartar"}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setConfirmandoDescarte(false)}
                    disabled={descartar.isPending}
                  >
                    Cancelar
                  </Button>
                </>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setDescartado(null);
                    setConfirmandoDescarte(true);
                  }}
                  disabled={encerrada || documentos.length === 0}
                  title="Apaga os relatórios importados, as linhas deles e as apurações — a competência continua aberta"
                >
                  <Trash2 className="w-4 h-4" />
                  Descartar dados
                </Button>
              )}
              <Button
                onClick={() => rodar.mutate()}
                disabled={rodar.isPending || vigentes.size === 0 || encerrada}
              >
                {rodar.isPending
                  ? "Apurando…"
                  : apuracao
                    ? "Apurar de novo"
                    : "Apurar"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {rodar.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(rodar.error)}</AlertDescription>
              </Alert>
            )}
            {descartar.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {textoDoErro(descartar.error)}
                </AlertDescription>
              </Alert>
            )}
            {descartado && (
              <Alert>
                <Trash2 className="w-4 h-4" />
                <AlertDescription className="space-y-2">
                  <p>
                    {descartado.documentos} relatório(s) e{" "}
                    {descartado.apuracoes} apuração(ões) descartados. A
                    competência continua aberta, de{" "}
                    {emDiaBR(competencia.inicio)} a {emDiaBR(competencia.fim)} —
                    os arquivos certos podem entrar agora, inclusive os mesmos
                    que acabaram de sair.
                  </p>
                  {(fontes.data ?? []).some(
                    (f) => (descartado.linhas[f.tipo] ?? 0) > 0,
                  ) && (
                    <ul className="text-xs text-muted-foreground">
                      {(fontes.data ?? [])
                        .filter((f) => (descartado.linhas[f.tipo] ?? 0) > 0)
                        .map((f) => (
                          <li key={f.tipo}>
                            {f.rotina} ·{" "}
                            {formatNumber(descartado.linhas[f.tipo], 0)}{" "}
                            linha(s)
                          </li>
                        ))}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {!apuracao && (
              <p className="text-sm text-muted-foreground">
                {vigentes.size === 0
                  ? "Envie ao menos um relatório para apurar."
                  : "Nenhuma apuração ainda. Apurar grava a conta — é por isso que é um botão, e não algo que acontece sozinho: o número apurado é o que pode ser aprovado depois."}
              </p>
            )}

            {apuracao && (
              <ContaApurada
                apuracao={apuracao}
                competenciaId={competencia.id}
                fontes={catalogo}
              />
            )}
          </CardContent>
        </Card>

        {/* ---------------------------------------------------------------
            4. O que não fecha
            --------------------------------------------------------------- */}
        {apuracao && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />O que perguntar à Ambev
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {acionaveis.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nada a questionar nesta apuração.
                </p>
              ) : (
                <>
                  <p className="text-sm">
                    <span className="font-semibold">{formatBrl(aReceber)}</span>{" "}
                    em valores que reduzem o que a transportadora recebe, cada
                    um com a fonte e a linha de onde saiu.
                  </p>
                  <ul className="divide-y">
                    {acionaveis.map((d) => (
                      <li key={d.id} className="py-3 space-y-1">
                        <div className="flex items-start justify-between gap-4">
                          <span className="font-medium">{d.titulo}</span>
                          <span className="font-mono text-sm shrink-0 tabular-nums">
                            {formatBrl(d.valor)}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {EXPLICACAO_DA_DIVERGENCIA[d.tipo] ?? d.tipo}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono">
                          {d.onde}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        )}
        {/* ---------------------------------------------------------------
            5. Salvar a quinzena
            --------------------------------------------------------------- */}
        {apuracao && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {encerrada ? (
                  <Lock className="w-4 h-4" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                {encerrada ? "Quinzena salva" : "Salvar a quinzena"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/*
                O painel é o mesmo que a lista de Importações mostra na linha da
                competência — ver `components/fechamento/fechar-quinzena`. Aqui
                ele é o fim do trabalho; lá, o gesto de quem fecha várias
                seguidas. O ato, o resumo e o aviso do que falta são um só.

                O denominador que ele mostra é o das esperadas (`esperados`), e
                não o das casinhas: o 03.08.12.09 opcional que ainda não chegou
                faria a primeira quinzena completa dizer "4 de 5" para sempre.
              */}
              <FecharQuinzena
                competencia={competencia}
                documentos={documentos}
                apuracao={apuracao}
                fontes={esperados}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

/**
 * O CONTRATO DA QUINZENA — a linha do grupo do devido que não é arquivo.
 *
 * **Por que ela existe.** O devido é o contrato multiplicado pela operação: o
 * cadastro diz quanto vale cada coisa, os relatórios dizem quantas
 * aconteceram. Faltando o cadastro, os três relatórios do grupo podem estar
 * todos importados e nenhuma linha do painel sai com número — foi o que
 * aconteceu numa competência real, com três vistos verdes aqui e uma coluna
 * inteira em branco no Resumo, sem nada ligando as duas telas.
 *
 * **Ela não tem casinha de envio, e isso é o ponto.** O contrato é digitado em
 * Remuneração, não importado aqui. O que esta linha faz é dizer que ele falta,
 * por quê, e para onde ir — o mesmo diagnóstico que o Resumo e a Conciliação
 * mostram, lido do mesmo campo.
 *
 * **Sem tipo de operação não há o que afirmar.** A competência aberta antes do
 * campo existir não tem a quem perguntar pelo contrato, e a linha some: um
 * alerta que não sabe do que fala é pior que nenhum.
 */
function LinhaDoContrato({
  contrato,
  quinzena,
}: {
  contrato: ContratoDaCompetencia | null;
  quinzena: 1 | 2;
}) {
  const base = useBaseDoFechamento();

  if (!contrato) return null;
  const respondeu = contrato.estado === "RESPONDEU";

  return (
    <li className="py-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {respondeu ? (
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          )}
          <span className="font-medium text-sm">Contrato</span>
          <span className="text-sm text-muted-foreground">
            Cadastro da {quinzena}ª quinzena
          </span>
          <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
            não é importado
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 ml-6">
          {respondeu
            ? "O contrato desta quinzena respondeu: o devido sai dele multiplicado pela operação."
            : "Sem contrato não sai devido: as linhas desta quinzena ficam em branco no Resumo — e branco ali é ainda não dá para saber, não é zero."}
        </p>
        {/*
          O problema e o conserto vêm escritos do domínio (`comoDestravar`), e
          não montados aqui: qual é o remédio de "faltam três linhas
          obrigatórias" é conhecimento de negócio, e uma segunda versão dele
          neste arquivo seria a que ninguém testa.
        */}
        {contrato.destrava && (
          <div className="text-xs text-muted-foreground mt-1 ml-6 space-y-0.5">
            <p>{contrato.destrava.problema}</p>
            <p>
              <span className="font-medium text-foreground">
                O que destrava:{" "}
              </span>
              {contrato.destrava.conserto}
            </p>
          </div>
        )}
      </div>
      <div className="shrink-0">
        {!respondeu && (
          <Button asChild variant="outline" size="sm">
            <Link href={`${base}/remuneracao`}>Abrir Remuneração</Link>
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Por que nenhuma verba deste 03.08.20 sustenta a conta — e o que resolve.
 *
 * A resposta vem do servidor, que tem os bytes: a tela não relê arquivo nenhum,
 * e por isso não pode discordar do leitor que importou.
 *
 * **Sai de trás do clique.** Era um link — "sob demanda, para não custar a quem
 * só quer ver o que já chegou" —, e a frase que ele abria contradizia a que
 * estava acima dele: a lista acusava o arquivo de só ter descontos, e o
 * diagnóstico dos bytes guardados respondia "as 10 verbas deste arquivo foram
 * reconhecidas". Quem não clicasse ficava com a acusação; quem clicasse ficava
 * com as duas. A resposta que decide **o que a tela pode afirmar** não pode
 * estar atrás de um gesto — ver {@link oQueDizerDoSemVerba}.
 *
 * O custo que o clique economizava continua economizado, e por um critério
 * melhor: o componente só existe quando há alarme. A competência inteira sem
 * documento sem verba não descomprime arquivo nenhum.
 */
function PorQueSemVerba({
  documento,
  competenciaId,
  travada,
}: {
  documento: Documento;
  competenciaId: string;
  /** A competência está encerrada: nem reimportar entra nela sem reabertura. */
  travada: boolean;
}) {
  const cliente = useQueryClient();
  const diagnostico = useQuery({
    queryKey: chaveDoDiagnostico(documento.id),
    queryFn: () => diagnosticarDocumento(documento.id),
    retry: false,
  });

  const refazer = useMutation({
    mutationFn: () => reimportarDocumento(documento.id),
    onSuccess: () => {
      /* A mesma chave de tudo que se pergunta sobre a competência: a lista, a
         grade de dias e o painel da planilha saem juntos (`chaveDaCompetencia`). */
      void cliente.invalidateQueries({
        queryKey: chaveDaCompetencia(competenciaId),
      });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "resumo"] });
    },
  });

  const d = diagnostico.data?.diagnostico;
  const { frase, reimportar } = oQueDizerDoSemVerba(documento, d);

  return (
    <div className="text-xs text-amber-600 mt-1 ml-6 space-y-1">
      <p>{frase}</p>
      {diagnostico.isLoading && <p>Relendo o arquivo guardado…</p>}
      {/*
        O diagnóstico que não veio é dito, e não escondido: sem ele a frase
        acima é tudo o que a tela sabe, e quem estiver olhando precisa saber
        que a pergunta sobre o conteúdo do arquivo ficou sem resposta.
      */}
      {diagnostico.isError && (
        <p>
          Não foi possível reler o arquivo guardado:{" "}
          {textoDoErro(diagnostico.error)}
        </p>
      )}
      {d && !reimportar && <p className="font-medium">{d.resumo}</p>}
      {/*
        A linha física e o texto original: é o que permite abrir o arquivo no
        editor, ir até ela, e ver com os próprios olhos o que o leitor viu.
      */}
      {d && d.suspeitas.length > 0 && (
        <ul className="space-y-0.5 font-mono text-[0.6875rem]">
          {d.suspeitas.slice(0, 3).map((s) => (
            <li key={s.linha}>
              linha {s.linha}: {s.original.slice(0, 120)}
            </li>
          ))}
          {d.suspeitas.length > 3 && (
            <li>… e mais {d.suspeitas.length - 3}.</li>
          )}
        </ul>
      )}
      {reimportar && (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {/*
            O conserto ao lado do diagnóstico que o justifica. Reimportar refaz
            a leitura sobre os bytes que a importação guardou — nada é
            reenviado, e é por isso que o botão pode existir aqui: não há
            arquivo a escolher.
          */}
          <span
            title={
              travada
                ? "A quinzena está fechada — reabra para reimportar."
                : undefined
            }
          >
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={refazer.isPending || travada}
              onClick={() => refazer.mutate()}
            >
              <RefreshCw className="w-3 h-3 mr-1.5" />
              {refazer.isPending
                ? "Reimportando…"
                : "Reimportar do arquivo guardado"}
            </Button>
          </span>
          {refazer.isError && <span>{textoDoErro(refazer.error)}</span>}
        </div>
      )}
    </div>
  );
}

/** Uma fonte: o que ela é, se já chegou, e o que o leitor recusou dela. */
function LinhaDeFonte({
  fonte,
  documento,
  competenciaId,
  semVerba,
  foraDaQuinzena,
  opcionalNaQuinzena,
  quinzena,
  enviando,
  travada,
  onArquivo,
}: {
  fonte: Fonte;
  documento: Documento | undefined;
  competenciaId: string;
  /**
   * O documento é o 03.08.20 e não gravou verba nenhuma.
   *
   * Decidido por quem lista, e não aqui, porque a pergunta é do banco: `verbas`
   * conta as linhas que o documento sustenta, e `null` nas outras cinco fontes
   * é o que impede esta linha de acusar quem não tem verba a ter.
   */
  semVerba: boolean;
  /**
   * O relatório não é dos que esta quinzena pede, e está aqui porque alguém o
   * enviou. A linha diz isso em vez de sumir: arquivo importado que desaparece
   * da tela é a forma mais rápida de alguém importá-lo de novo.
   */
  foraDaQuinzena: boolean;
  /**
   * O relatório é dos que esta quinzena **admite sem esperar** — o 03.08.12.09
   * na 1ª. A linha diz isso porque as duas frases são diferentes: "ainda não
   * chegou" cobra alguém, "pode não existir" não cobra ninguém, e sem o
   * distintivo a casinha vazia seria lida como a primeira.
   */
  opcionalNaQuinzena: boolean;
  quinzena: 1 | 2;
  enviando: boolean;
  /** A competência está encerrada: nada entra nela sem reabertura. */
  travada: boolean;
  onArquivo: (arquivo: File) => void;
}) {
  const campo = useRef<HTMLInputElement>(null);

  return (
    <li className="py-3 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {documento && semVerba ? (
            /*
              O visto verde diz "esta fonte está no lugar", e um 03.08.20 que
              não sustenta verba nenhuma não está: ele é a única fonte que abre
              a parcela fixa, e sem verba não abre nada. Dar-lhe o mesmo visto
              das outras foi o que pôs, na mesma tela, a lista dizendo que o
              arquivo chegou e o painel dizendo que não.
            */
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : documento ? (
            <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          ) : (
            <span className="w-4 h-4 rounded-full border border-dashed border-muted-foreground/50 shrink-0" />
          )}
          <span className="font-medium font-mono text-sm">{fonte.rotina}</span>
          <span className="text-sm text-muted-foreground">{fonte.nome}</span>
          {foraDaQuinzena && (
            <span className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground">
              fora da {quinzena}ª quinzena
            </span>
          )}
          {opcionalNaQuinzena && (
            <span
              title="Pode existir nesta quinzena e nem sempre existe: envie quando houver, e a apuração não cobra a falta."
              className="rounded-full border border-border px-2 py-0.5 text-[0.6875rem] uppercase tracking-wide text-muted-foreground"
            >
              opcional na {quinzena}ª quinzena
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 ml-6">
          {fonte.papel}
        </p>
        {/*
          Os formatos ficam à vista, e não só dentro do seletor de arquivo.
          O mesmo relatório sai do Promax em mais de um formato, e quem opera
          precisa saber qual dos arquivos da pasta serve **antes** de abrir a
          janela — ver `FORMATOS_DA_FONTE`, que é de onde esta lista vem.
        */}
        {!documento && (
          <p className="text-xs text-muted-foreground/80 mt-1 ml-6">
            Aceita {fonte.extensoes.join(", ")}
          </p>
        )}
        {documento && (
          <p className="text-xs text-muted-foreground mt-1 ml-6">
            {documento.nomeDoArquivo} ·{" "}
            {documento.linhasLidas.toLocaleString("pt-BR")} linhas
            {documento.recusas.length > 0 && (
              <span className="text-amber-600">
                {" "}
                · {documento.recusas.length} linha(s) recusada(s):{" "}
                {documento.recusas[0].motivo}
              </span>
            )}
          </p>
        )}
        {documento && semVerba && (
          /*
            O que `linhasLidas` não diz. Ele soma verbas e descontos, então um
            demonstrativo do qual o banco não guardou verba nenhuma aparece com
            um número respeitável de linhas — e é o painel da planilha, noutro
            cartão, que descobre que não há verba.

            **A frase não mora mais aqui**, e é a correção que importa: ela
            afirmava, a partir desse número, que as linhas lidas "são
            descontos" — uma afirmação sobre o conteúdo do arquivo, que esta
            tela nunca leu. No 03.08.20 real da 1ª quinzena as 14 linhas são 10
            verbas e 4 descontos, e a frase estava errada ao lado de um
            diagnóstico que dizia o contrário. Quem sabe do arquivo é quem o
            releu — ver `PorQueSemVerba`.
          */
          <PorQueSemVerba
            documento={documento}
            competenciaId={competenciaId}
            travada={travada}
          />
        )}
      </div>
      <div className="shrink-0">
        <input
          ref={campo}
          type="file"
          className="hidden"
          accept={fonte.extensoes.join(",")}
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) onArquivo(arquivo);
            e.target.value = "";
          }}
        />
        {/*
          O `title` mora no `span`, e não no botão: um botão desabilitado tem
          `pointer-events: none` e nunca mostraria a explicação de por que está
          desabilitado — que é justamente a única coisa que ele tem a dizer.
        */}
        <span
          title={
            travada
              ? "A quinzena está fechada — reabra para enviar."
              : undefined
          }
        >
          <Button
            variant={documento ? "outline" : "default"}
            size="sm"
            disabled={enviando || travada}
            onClick={() => campo.current?.click()}
          >
            <Upload className="w-3.5 h-3.5 mr-1.5" />
            {enviando ? "Enviando…" : documento ? "Substituir" : "Enviar"}
          </Button>
        </span>
      </div>
    </li>
  );
}
