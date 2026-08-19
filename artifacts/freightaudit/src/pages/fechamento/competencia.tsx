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
  Trash2,
  Upload,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
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
import { formatBrl, formatNumber } from "@/lib/format";
import {
  apurar,
  descartarDados,
  enviarDocumento,
  fontesDaCompetencia,
  lerCompetencia,
  lerDiario,
  listarFontes,
  EXPLICACAO_DA_DIVERGENCIA,
  NOME_DO_ESTADO,
  type DadosDescartados,
  type Documento,
  type Fonte,
  type TipoDeFonte,
} from "@/lib/fechamento";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
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
  const cliente = useQueryClient();
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  /*
    O descarte pergunta antes, e a pergunta mora na tela em vez de num
    `window.confirm`: o diálogo do navegador não sabe dizer *quantos* arquivos
    vão embora, e ver o tamanho do que se vai apagar é a única defesa real
    contra apagar a competência errada.
  */
  const [confirmandoDescarte, setConfirmandoDescarte] = useState(false);
  const [descartado, setDescartado] = useState<DadosDescartados | null>(null);

  const dados = useQuery({
    queryKey: ["fechamento", "competencia", id],
    queryFn: () => lerCompetencia(id),
  });
  const fontes = useQuery({ queryKey: ["fechamento", "fontes"], queryFn: listarFontes });
  /*
    O diário é consulta própria, e não parte de `lerCompetencia`: ele muda por
    outro motivo (o 2Art entrou) e é lido por outra tela (a do dia). Juntá-los
    faria toda apuração reinvalidar a grade de dias, que não mudou.
  */
  const diario = useQuery({
    queryKey: ["fechamento", "diario", id],
    queryFn: () => lerDiario(id),
  });

  const enviar = useMutation({
    mutationFn: ({ tipo, arquivo }: { tipo: TipoDeFonte; arquivo: File }) =>
      enviarDocumento(id, tipo, arquivo),
    onMutate: () => setErroDoEnvio(null),
    onError: (erro) => setErroDoEnvio(textoDoErro(erro)),
    onSuccess: () => {
      void cliente.invalidateQueries({ queryKey: ["fechamento", "competencia", id] });
      /* O 2Art recém-enviado é o que a grade de dias mostra — ela reabre. */
      void cliente.invalidateQueries({ queryKey: ["fechamento", "diario", id] });
    },
  });

  const rodar = useMutation({
    mutationFn: () => apurar(id),
    onSuccess: () => {
      setDescartado(null);
      void cliente.invalidateQueries({ queryKey: ["fechamento", "competencia", id] });
    },
  });

  const descartar = useMutation({
    mutationFn: () => descartarDados(id),
    onSuccess: (resultado) => {
      setConfirmandoDescarte(false);
      setDescartado(resultado);
      setErroDoEnvio(null);
      void cliente.invalidateQueries({ queryKey: ["fechamento", "competencia", id] });
      /* A grade de dias e as duas listas do ambiente liam o que acabou de sair. */
      void cliente.invalidateQueries({ queryKey: ["fechamento", "diario", id] });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "competencias"] });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "apuracoes"] });
    },
  });

  if (dados.isLoading) {
    return (
      <Layout>
        <div className="p-8 text-sm text-muted-foreground">Carregando a competência…</div>
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
  const vigentes = new Map(documentos.filter((d) => d.vigente).map((d) => [d.tipo, d]));
  /*
    O que ainda não chegou, nomeado. Com a quinzena fechada é esta lista que
    explica por que alguém quer reabri-la: "falta o 03.08.20" é uma frase
    acionável, "falta 1 relatório" não é.
  */
  const faltando = (fontes.data ?? []).filter((f) => !vigentes.has(f.tipo));
  /*
    A fila do que questionar sai de `oQueQuestionar`, e não de um filtro escrito
    aqui: é o mesmo número que o resumo do fechamento mostra ao lado do botão de
    congelar, e duas contas iguais em dois lugares divergiriam um dia.
  */
  const { acionaveis, aReceber } = apuracao
    ? oQueQuestionar(apuracao)
    : { acionaveis: [], aReceber: 0 };
  /*
    Os relatórios desta quinzena, e não os seis do catálogo: a primeira quinzena
    não tem requisições nem conciliação. O que já foi enviado entra na lista de
    qualquer forma — ver `fontesDaCompetencia`.
  */
  const catalogo = fontesDaCompetencia(fontes.data ?? [], competencia.quinzena, [
    ...vigentes.keys(),
  ]);

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <Link
          href="/fechamento/competencias"
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
              {new Date(competencia.encerradaEm!).toLocaleString("pt-BR")}. Nada mais
              entra nela sem reabertura.
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
                ? "Quatro exportações do Promax/SRTrans: a 1ª quinzena não tem as requisições (03.08.12.09) nem a conciliação (03.02.59.02), que chegam com o fechamento da 2ª."
                : "Seis exportações do Promax/SRTrans."}{" "}
              Cada relatório diz abaixo em que formatos ele é lido. A conta roda
              com o que houver — o que faltar aparece nomeado na apuração, nunca
              como zero.
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
                    Enviar e substituir estão travados enquanto a quinzena estiver
                    fechada.
                    {faltando.length > 0 && (
                      <>
                        {" "}
                        Falta{faltando.length > 1 ? "m" : ""}{" "}
                        {faltando.map((f) => f.rotina).join(", ")}.
                      </>
                    )}
                  </p>
                  <p>
                    Reabrir destrava o envio: escreva o motivo, mande o arquivo e
                    apure de novo — a apuração de hoje continua valendo até a
                    próxima rodar, e fechar de novo é o mesmo botão do fim da tela.
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
            <ul className="divide-y">
              {catalogo.map((fonte) => (
                <LinhaDeFonte
                  key={fonte.tipo}
                  fonte={fonte}
                  documento={vigentes.get(fonte.tipo)}
                  foraDaQuinzena={!fonte.quinzenas.includes(competencia.quinzena)}
                  quinzena={competencia.quinzena}
                  enviando={enviar.isPending && enviar.variables?.tipo === fonte.tipo}
                  travada={encerrada}
                  onArquivo={(arquivo) => enviar.mutate({ tipo: fonte.tipo, arquivo })}
                />
              ))}
            </ul>
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
              O que a operação rodou, dia a dia, do 2Art. Clique num dia para ver
              as viagens daquele dia inteiras — placa, mapa, caixas, horários e a
              cadeia de imposto —, com os totais por frota que se comparam ao
              SRTrans.
            </p>
            {diario.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(diario.error)}</AlertDescription>
              </Alert>
            )}
            {diario.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando os dias…</p>
            )}
            {diario.data && (
              <>
                {!diario.data.fonte && (
                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      O 2Art ainda não foi enviado. A grade abaixo é o calendário
                      da quinzena, e não a operação dela: dia vazio aqui quer
                      dizer que ninguém importou o relatório, não que ninguém
                      rodou.
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
                      · {formatNumber(diario.data.viagensForaDoPeriodo, 0)} do 2Art
                      ficaram de fora, por serem de fora de{" "}
                      {emDiaBR(competencia.inicio)} a {emDiaBR(competencia.fim)} —
                      elas não entram em conta nenhuma daqui
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
              <Calculator className="w-4 h-4" />
              A conta da quinzena
            </CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {confirmandoDescarte ? (
                <>
                  <span className="text-sm text-muted-foreground">
                    Apagar {documentos.length} arquivo(s) e a apuração desta competência?
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
                {rodar.isPending ? "Apurando…" : apuracao ? "Apurar de novo" : "Apurar"}
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
                <AlertDescription>{textoDoErro(descartar.error)}</AlertDescription>
              </Alert>
            )}
            {descartado && (
              <Alert>
                <Trash2 className="w-4 h-4" />
                <AlertDescription className="space-y-2">
                  <p>
                    {descartado.documentos} relatório(s) e {descartado.apuracoes}{" "}
                    apuração(ões) descartados. A competência continua aberta, de{" "}
                    {emDiaBR(competencia.inicio)} a {emDiaBR(competencia.fim)} — os
                    arquivos certos podem entrar agora, inclusive os mesmos que
                    acabaram de sair.
                  </p>
                  {(fontes.data ?? []).some((f) => (descartado.linhas[f.tipo] ?? 0) > 0) && (
                    <ul className="text-xs text-muted-foreground">
                      {(fontes.data ?? [])
                        .filter((f) => (descartado.linhas[f.tipo] ?? 0) > 0)
                        .map((f) => (
                          <li key={f.tipo}>
                            {f.rotina} · {formatNumber(descartado.linhas[f.tipo], 0)} linha(s)
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
                <AlertTriangle className="w-4 h-4" />
                O que perguntar à Ambev
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
                    <span className="font-semibold">{formatBrl(aReceber)}</span> em
                    valores que reduzem o que a transportadora recebe, cada um com
                    a fonte e a linha de onde saiu.
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
                        <p className="text-xs text-muted-foreground font-mono">{d.onde}</p>
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
                {encerrada ? <Lock className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                {encerrada ? "Quinzena salva" : "Salvar a quinzena"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/*
                O painel é o mesmo que a lista de Importações mostra na linha da
                competência — ver `components/fechamento/fechar-quinzena`. Aqui
                ele é o fim do trabalho; lá, o gesto de quem fecha várias
                seguidas. O ato, o resumo e o aviso do que falta são um só.
              */}
              <FecharQuinzena
                competencia={competencia}
                documentos={documentos}
                apuracao={apuracao}
                fontes={catalogo}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

/** Uma fonte: o que ela é, se já chegou, e o que o leitor recusou dela. */
function LinhaDeFonte({
  fonte,
  documento,
  foraDaQuinzena,
  quinzena,
  enviando,
  travada,
  onArquivo,
}: {
  fonte: Fonte;
  documento: Documento | undefined;
  /**
   * O relatório não é dos que esta quinzena pede, e está aqui porque alguém o
   * enviou. A linha diz isso em vez de sumir: arquivo importado que desaparece
   * da tela é a forma mais rápida de alguém importá-lo de novo.
   */
  foraDaQuinzena: boolean;
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
          {documento ? (
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
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 ml-6">{fonte.papel}</p>
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
            {documento.nomeDoArquivo} · {documento.linhasLidas.toLocaleString("pt-BR")} linhas
            {documento.recusas.length > 0 && (
              <span className="text-amber-600">
                {" "}
                · {documento.recusas.length} linha(s) recusada(s): {documento.recusas[0].motivo}
              </span>
            )}
          </p>
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
        <span title={travada ? "A quinzena está fechada — reabra para enviar." : undefined}>
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
