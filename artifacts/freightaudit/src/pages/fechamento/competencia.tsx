import { Fragment, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CalendarDays,
  Check,
  ChevronRight,
  FileUp,
  Lock,
  LockOpen,
  Upload,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GradeDeDias } from "@/components/fechamento/grade-de-dias";
import { apresentar } from "@/lib/apresentar-erro";
import { formatBrl, formatNumber } from "@/lib/format";
import { Textarea } from "@/components/ui/textarea";
import {
  apurar,
  encerrar,
  reabrir,
  enviarDocumento,
  lerCompetencia,
  lerDiario,
  listarFontes,
  EXPLICACAO_DA_DIVERGENCIA,
  NOME_DO_ESTADO,
  type Documento,
  type Fonte,
  type TipoDeFonte,
  type VerbaApurada,
} from "@/lib/fechamento";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

const emDiaBR = (iso: string) => iso.split("-").reverse().join("/");

/**
 * A competência aberta — onde o fechamento acontece.
 *
 * A tela tem cinco partes, e a ordem é a do trabalho: recebe os cinco
 * relatórios que a Ambev exporta, mostra o que a operação rodou dia a dia, roda
 * a conta, mostra o que não fecha e salva a quinzena. É esta tela que substitui
 * a pasta de Excel de 44 abas — a grade de dias no lugar das abas `01`…`31`, a
 * conta no lugar dos PROCVs entre elas.
 *
 * **Por que a apuração é um botão e não acontece sozinha ao subir o quinto
 * arquivo.** Porque rodar grava: a apuração vigente anterior é despromovida e
 * uma nova entra no lugar (ver `fechamento_apuracao`). Um recálculo automático
 * mudaria, sem ninguém pedir, o número que alguém pode ter aprovado — e a
 * aprovação deixaria de significar coisa alguma. O botão é o consentimento.
 *
 * **Por que a conta roda com menos de cinco fontes.** Porque quase sempre é
 * assim que o dia funciona: o relatório de conciliação sai depois dos outros.
 * A apuração roda com o que há, diz nominalmente o que falta, e o que ela não
 * consegue sustentar aparece como não conferido em vez de virar zero.
 */
export default function CompetenciaAberta({ id }: { id: string }) {
  const cliente = useQueryClient();
  const [erroDoEnvio, setErroDoEnvio] = useState<string | null>(null);
  const [verbaAberta, setVerbaAberta] = useState<number | null>(null);
  const [motivo, setMotivo] = useState("");

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
    onSuccess: () => cliente.invalidateQueries({ queryKey: ["fechamento", "competencia", id] }),
  });

  const atualizar = () => {
    void cliente.invalidateQueries({ queryKey: ["fechamento", "competencia", id] });
    void cliente.invalidateQueries({ queryKey: ["fechamento", "competencias"] });
  };
  const fechar = useMutation({ mutationFn: () => encerrar(id), onSuccess: atualizar });
  const destravar = useMutation({
    mutationFn: (motivo: string) => reabrir(id, motivo),
    onSuccess: () => {
      setMotivo("");
      atualizar();
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
  const acionaveis = apuracao?.divergencias.filter((d) => d.sentido !== "INFORMATIVO") ?? [];
  const aReceber = acionaveis
    .filter((d) => d.sentido === "A_RECEBER")
    .reduce((s, d) => s + d.valor, 0);

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
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
            <Lock className="w-3.5 h-3.5" />
            Quinzena salva e congelada em{" "}
            {new Date(competencia.encerradaEm!).toLocaleString("pt-BR")}. Nada mais
            entra nela sem reabertura.
          </p>
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
              Cinco exportações do Promax/SRTrans. A conta roda com o que houver
              — o que faltar aparece nomeado na apuração, nunca como zero.
            </p>
            {erroDoEnvio && (
              <Alert variant="destructive">
                <AlertDescription>{erroDoEnvio}</AlertDescription>
              </Alert>
            )}
            <ul className="divide-y">
              {fontes.data?.map((fonte) => (
                <LinhaDeFonte
                  key={fonte.tipo}
                  fonte={fonte}
                  documento={vigentes.get(fonte.tipo)}
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
            <Button
              onClick={() => rodar.mutate()}
              disabled={rodar.isPending || vigentes.size === 0 || encerrada}
            >
              {rodar.isPending ? "Apurando…" : apuracao ? "Apurar de novo" : "Apurar"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {rodar.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(rodar.error)}</AlertDescription>
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
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Numero titulo="Emitido em CT-e" valor={apuracao.totais.emitido} />
                  <Numero
                    titulo="Conferido pela apuração"
                    valor={apuracao.totais.esperado}
                    nota="Reconstruído das fontes, verba a verba."
                  />
                  <Numero
                    titulo="Sem fonte que confira"
                    valor={apuracao.totais.naoConferido}
                    nota="Emitido que nenhuma das cinco fontes sustenta — a parte fixa do contrato."
                  />
                </div>

                {apuracao.fontesAusentes.length > 0 && (
                  <Alert>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      Esta apuração rodou sem {apuracao.fontesAusentes.length} fonte(s):{" "}
                      {apuracao.fontesAusentes
                        .map((t) => fontes.data?.find((f) => f.tipo === t)?.rotina ?? t)
                        .join(", ")}
                      . As verbas que dependiam delas ficaram sem conferência.
                    </AlertDescription>
                  </Alert>
                )}

                {apuracao.aliquotas.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Conversão medida dos próprios arquivos:{" "}
                    {apuracao.aliquotas
                      .map((a) => `${a.canal} ${a.percentual.toFixed(4)}%`)
                      .join(" · ")}
                    . Nenhuma alíquota é presumida — o fator sai da razão entre a
                    requisição aprovada e o CT-e emitido nas verbas que só podem
                    ter vindo de requisição.
                  </p>
                )}

                <TabelaDeVerbas
                  verbas={apuracao.verbas}
                  aberta={verbaAberta}
                  onAbrir={(vbz) => setVerbaAberta(verbaAberta === vbz ? null : vbz)}
                />
              </>
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
            <CardContent className="space-y-3">
              {encerrada ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Esta competência está fechada: os cinco relatórios, a conta
                    apurada e as divergências ficam como estão, e o banco recusa
                    qualquer escrita nela. É o que faz o número que você cobrou
                    continuar sendo o número que se lê daqui a um ano.
                  </p>
                  <div className="space-y-2 border-t pt-3">
                    <p className="text-sm font-medium">Precisa reabrir?</p>
                    <p className="text-sm text-muted-foreground">
                      Escreva o motivo. Ele fica no registro da competência — é o
                      que distingue uma correção de uma alteração silenciosa
                      depois do fato.
                    </p>
                    <Textarea
                      value={motivo}
                      onChange={(e) => setMotivo(e.target.value)}
                      placeholder="Ex.: a Ambev reenviou o 03.08.15 com a VBZ 29 corrigida."
                      rows={2}
                    />
                    {destravar.isError && (
                      <Alert variant="destructive">
                        <AlertDescription>{textoDoErro(destravar.error)}</AlertDescription>
                      </Alert>
                    )}
                    <Button
                      variant="outline"
                      onClick={() => destravar.mutate(motivo)}
                      disabled={motivo.trim() === "" || destravar.isPending}
                    >
                      <LockOpen className="w-3.5 h-3.5 mr-1.5" />
                      {destravar.isPending ? "Reabrindo…" : "Reabrir competência"}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Tudo o que você enviou e apurou já está gravado — salvar não
                    é o que guarda os dados. O que este botão faz é{" "}
                    <strong>fechar a quinzena</strong>: a partir dele nada mais
                    entra nela, e a conta apurada passa a ser o registro do que
                    foi cobrado. Reabrir depois é possível, com motivo.
                  </p>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>
                      • {vigentes.size} de {fontes.data?.length ?? 5} relatórios enviados
                    </li>
                    <li>• {formatBrl(apuracao.totais.emitido)} emitidos em CT-e</li>
                    <li>
                      • {acionaveis.length} ponto(s) a questionar, somando{" "}
                      {formatBrl(aReceber)}
                    </li>
                  </ul>
                  {apuracao.fontesAusentes.length > 0 && (
                    <Alert>
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>
                        Faltam {apuracao.fontesAusentes.length} relatório(s). Dá para
                        fechar assim, e o que eles sustentariam vai ficar registrado
                        como não conferido.
                      </AlertDescription>
                    </Alert>
                  )}
                  {fechar.isError && (
                    <Alert variant="destructive">
                      <AlertDescription>{textoDoErro(fechar.error)}</AlertDescription>
                    </Alert>
                  )}
                  <Button onClick={() => fechar.mutate()} disabled={fechar.isPending}>
                    <Lock className="w-3.5 h-3.5 mr-1.5" />
                    {fechar.isPending ? "Salvando…" : "Salvar e fechar a quinzena"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}

function Numero({ titulo, valor, nota }: { titulo: string; valor: number; nota?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{formatBrl(valor)}</p>
      {nota && <p className="text-xs text-muted-foreground mt-1">{nota}</p>}
    </div>
  );
}

/** Uma fonte: o que ela é, se já chegou, e o que o leitor recusou dela. */
function LinhaDeFonte({
  fonte,
  documento,
  enviando,
  travada,
  onArquivo,
}: {
  fonte: Fonte;
  documento: Documento | undefined;
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
        </div>
        <p className="text-sm text-muted-foreground mt-0.5 ml-6">{fonte.papel}</p>
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
        <Button
          variant={documento ? "outline" : "default"}
          size="sm"
          disabled={enviando || travada}
          onClick={() => campo.current?.click()}
        >
          <Upload className="w-3.5 h-3.5 mr-1.5" />
          {enviando ? "Enviando…" : documento ? "Substituir" : "Enviar"}
        </Button>
      </div>
    </li>
  );
}

/**
 * As verbas, e a memória de cálculo de cada uma.
 *
 * O que a planilha nunca teve: clicar numa verba abre de onde cada real dela
 * saiu — a rubrica da conciliação, o complementar de perfil, as requisições
 * aprovadas e o fator que as converteu. É o que permite discordar de um número
 * sem precisar refazê-lo.
 */
function TabelaDeVerbas({
  verbas,
  aberta,
  onAbrir,
}: {
  verbas: VerbaApurada[];
  aberta: number | null;
  onAbrir: (vbz: number) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2 pr-3 font-medium">Verba</th>
            <th className="py-2 px-3 font-medium text-right">Emitido</th>
            <th className="py-2 px-3 font-medium text-right">Apurado</th>
            <th className="py-2 pl-3 font-medium text-right">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {verbas.map((v) => (
            <Fragment key={v.vbz}>
              <tr
                className="border-b hover:bg-muted/50 cursor-pointer"
                onClick={() => onAbrir(v.vbz)}
              >
                <td className="py-2 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${
                        aberta === v.vbz ? "rotate-90" : ""
                      }`}
                    />
                    <span className="font-mono text-xs text-muted-foreground">{v.vbz}</span>
                    <span>
                      {v.canal} · {v.nome}
                    </span>
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{formatBrl(v.emitido)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">
                  {v.esperado === null ? "—" : formatBrl(v.esperado)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {v.diferenca === null ? (
                    <span className="text-xs text-muted-foreground">sem fonte</span>
                  ) : (
                    formatBrl(v.diferenca)
                  )}
                </td>
              </tr>
              {aberta === v.vbz && (
                <tr className="border-b bg-muted/30">
                  <td colSpan={4} className="py-3 px-8">
                    {v.memoria.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma das cinco fontes sustenta esta verba — ela entrou
                        na conta pelo que foi emitido, e ninguém a conferiu. É o
                        caso da parcela fixa do contrato.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {v.memoria.map((m, i) => (
                          <li key={i} className="flex items-baseline justify-between gap-4 text-sm">
                            <span className="text-muted-foreground">
                              {m.descricao}
                              {m.fator != null && m.semImposto != null && (
                                <span className="font-mono text-xs">
                                  {" "}
                                  ({formatBrl(m.semImposto)} × {m.fator.toFixed(6)})
                                </span>
                              )}
                            </span>
                            <span className="tabular-nums shrink-0">{formatBrl(m.comImposto)}</span>
                          </li>
                        ))}
                        <li className="flex items-baseline justify-between gap-4 text-sm font-medium border-t pt-1.5">
                          <span>Total apurado</span>
                          <span className="tabular-nums">{formatBrl(v.esperado ?? 0)}</span>
                        </li>
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
