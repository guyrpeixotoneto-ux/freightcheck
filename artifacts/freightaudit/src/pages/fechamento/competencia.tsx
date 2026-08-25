import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CalendarDays,
  Check,
  FileUp,
  ImageUp,
  Info,
  Lock,
  LockOpen,
  RefreshCw,
  ScanLine,
  Trash2,
  Upload,
} from "lucide-react";
import { Layout } from "@/components/layout/layout";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useBaseDoFechamento,
  useOperacaoDoFechamento,
} from "@/lib/base-do-fechamento";
import { baseDaOperacao, nomeDoFechamentoDa } from "@/lib/ambiente";
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
  TIPO_NAO_INFORMADO,
  diagnosticarDocumento,
  enviarDocumento,
  fontesDaCompetencia,
  fontesParaEnviar,
  lerGradeDaImagem,
  type CelulaDaGrade,
  type LeituraDaGrade,
  type ContratoDaCompetencia,
  type ParametrosDoContrato,
  lerCompetencia,
  lerDiario,
  listarFontes,
  reimportarDocumento,
  lerTotaisDaCompetencia,
  lerItensDoPagamento,
  lerItensDaConciliacao,
  EXPLICACAO_DA_DIVERGENCIA,
  NOME_DO_ESTADO,
  type Competencia,
  type DadosDescartados,
  type Documento,
  type Fonte,
  type ItemDaConciliacao,
  type ItemDePagamento,
  type TipoDeFonte,
  type TotaisDoPagamento,
} from "@/lib/fechamento";
import { ROTEIRO, fontesForaDoRoteiro, type EtapaDoRoteiro } from "./roteiro";
import {
  apenasCanalRota,
  consolidarDuplicatasExatas,
  verbasRepetidas,
} from "./pagamento-por-canal";
import {
  normalizarCategoria,
  resolverValorDoContrato,
  type SituacaoDaFrota,
  type ValorDoContratoParaComparar,
} from "./grade-comparacao-frota";
import {
  resumoDaEtapa,
  situacaoDaEtapa,
  type SituacaoDaEtapa,
} from "./status-da-etapa";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  SeloDaEtapa,
  TrilhaDoRoteiro,
} from "@/components/fechamento/trilha-do-roteiro";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

const emDiaBR = (iso: string) => iso.split("-").reverse().join("/");

/**
 * Onde o rascunho da leitura de imagem mora entre uma visita e a próxima —
 * `localStorage`, e não o backend.
 *
 * O comentário de `LeituraDaImagemDaFrota` já explica por que o rascunho não
 * vira documento: ele não passa por `receberDocumento` porque a leitura por
 * imagem lê só totais por categoria, sem placa nenhuma, e o que sustenta a
 * conta é o relatório, placa a placa. Guardá-lo no navegador não muda essa
 * regra — ele continua sem valer nada para a apuração — só resolve o
 * incômodo de a página inteira ser trocada (um link, um F5, voltar depois)
 * e o rascunho ir embora como se ninguém tivesse conferido nada. Ele agora
 * só some quando alguém manda: enviando outra foto ou apertando "Remover".
 */
const PREFIXO_DO_RASCUNHO_DE_IMAGEM = "fechamento:rascunho-de-imagem";

function chaveDoRascunhoDeImagem(competenciaId: string, tipo: TipoDeFonte): string {
  return `${PREFIXO_DO_RASCUNHO_DE_IMAGEM}:${competenciaId}:${tipo}`;
}

function lerRascunhoDeImagem(
  competenciaId: string,
  tipo: TipoDeFonte,
): LeituraDaGrade | undefined {
  try {
    const bruto = localStorage.getItem(chaveDoRascunhoDeImagem(competenciaId, tipo));
    return bruto ? (JSON.parse(bruto) as LeituraDaGrade) : undefined;
  } catch {
    /* Aba anônima, cota cheia — o rascunho some ao trocar de página, e como
       ele nunca foi a fonte da conta, sumir aqui não quebra nada. */
    return undefined;
  }
}

function gravarRascunhoDeImagem(
  competenciaId: string,
  tipo: TipoDeFonte,
  leitura: LeituraDaGrade | null,
): void {
  try {
    const chave = chaveDoRascunhoDeImagem(competenciaId, tipo);
    if (leitura) localStorage.setItem(chave, JSON.stringify(leitura));
    else localStorage.removeItem(chave);
  } catch {
    // Mesmo caso acima — guardar é o extra, não o requisito.
  }
}

/** As únicas duas fontes que aceitam a leitura por imagem — ver `aceitaImagem`. */
const TIPOS_COM_LEITURA_DE_IMAGEM: TipoDeFonte[] = [
  "FROTA_PROMAX_ATIVA",
  "FROTA_PROMAX_INATIVA",
];

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
  const operacao = useOperacaoDoFechamento();
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
  /* A etapa aberta do roteiro. `null` = ainda não houve clique; ver `aberta`. */
  const [etapaAberta, setEtapaAberta] = useState<string | null>(null);
  const [descartado, setDescartado] = useState<DadosDescartados | null>(null);
  /*
    O rascunho da leitura de imagem, por fonte. Mora aqui, e não dentro de
    `LeituraDaImagemDaFrota`, porque o `Accordion` desmonta o conteúdo de uma
    etapa fechada — `AccordionContent` não usa `forceMount` — e o que estava
    em `useState`/`useMutation` ali dentro ia junto. O estado inicial já lê o
    que `localStorage` tiver desta competência, para sobreviver não só a
    trocar de etapa, mas a sair da página inteira e voltar — ver
    `lerRascunhoDeImagem`/`gravarRascunhoDeImagem`.
  */
  const [leiturasDeFrota, setLeiturasDeFrota] = useState<
    Partial<Record<TipoDeFonte, LeituraDaGrade>>
  >(() => {
    const inicial: Partial<Record<TipoDeFonte, LeituraDaGrade>> = {};
    for (const tipo of TIPOS_COM_LEITURA_DE_IMAGEM) {
      const rascunho = lerRascunhoDeImagem(id, tipo);
      if (rascunho) inicial[tipo] = rascunho;
    }
    return inicial;
  });

  const dados = useQuery({
    queryKey: chaveDaCompetencia(id),
    queryFn: () => lerCompetencia(id),
  });
  const fontes = useQuery({
    queryKey: ["fechamento", "fontes"],
    queryFn: listarFontes,
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
  /*
    Os dois totais do 03.08.20 — o que o relatório declara e o que as verbas
    somam. Pendura-se na chave da competência pela mesma regra do diário: tudo
    que se pergunta sobre uma competência é invalidado junto quando um documento
    entra, e é o envio do 03.08.20 que muda esta resposta.
  */
  const totais = useQuery({
    queryKey: [...chaveDaCompetencia(id), "totais"],
    queryFn: () => lerTotaisDaCompetencia(id),
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
  /*
    A competência de outra operação não abre aqui — ela abre lá.

    A rota é por `id`, e um `id` não diz de qual ambiente ele é: um link colado
    numa mensagem, um favorito de antes da separação ou uma volta no histórico
    trazem para o Fechamento Rota uma quinzena da Empurrada, e a tela a mostrava
    inteira, com todos os botões — apurar, importar, encerrar, excluir. É o
    mesmo vazamento das listas por outra porta, e nesta o estrago é maior,
    porque aqui se apaga.

    O caminho não é um erro: é a mesma tela, no ambiente certo, a um clique. O
    endereço muda só de base — o `id` é o mesmo dos dois lados.

    A sem tipo declarado (`NAO_INFORMADO`) passa, e passa nos dois ambientes:
    ela não é de nenhum até alguém dizer, e é em Importações, deste lado, que se
    diz. Ver `OPERACAO_DO_AMBIENTE`, em `lib/ambiente.ts`.
  */
  if (
    competencia.tipoDeOperacao !== TIPO_NAO_INFORMADO &&
    competencia.tipoDeOperacao !== operacao
  ) {
    return (
      <Layout>
        <div className="p-8 max-w-2xl">
          <Alert>
            <AlertDescription className="space-y-3">
              <p>
                Esta competência é do{" "}
                <strong>
                  {nomeDoFechamentoDa(competencia.tipoDeOperacao)}
                </strong>
                , e o ambiente aberto é o{" "}
                <strong>{nomeDoFechamentoDa(operacao)}</strong>. São dois
                fechamentos separados: cada um tem a sua planilha de remuneração,
                os seus relatórios e a sua conta.
              </p>
              <p>
                <Link
                  href={`${baseDaOperacao(competencia.tipoDeOperacao)}/competencias/${competencia.id}`}
                  className="text-primary hover:underline"
                >
                  Abrir no {nomeDoFechamentoDa(competencia.tipoDeOperacao)}
                </Link>
              </p>
            </AlertDescription>
          </Alert>
        </div>
      </Layout>
    );
  }
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

  /*
    Rede de segurança para uma fonte nova no catálogo que ainda não ganhou
    etapa (ver `fontesForaDoRoteiro`): sem isso ela sumiria da tela em vez de
    aparecer nomeada aqui, ao lado dos dias da quinzena.
  */
  const foraDoRoteiro = fontesForaDoRoteiro(catalogo.map((f) => f.tipo))
    .map((t) => catalogo.find((f) => f.tipo === t))
    .filter((f): f is Fonte => !!f);

  /*
    O estado de cada etapa do roteiro, derivado do que a competência tem agora:
    arquivos, recusas e divergências. Não há estado guardado de "etapa
    conferida" — ver `status-da-etapa.ts` para por que derivar é a única leitura
    honesta enquanto a conferência não for um ato registrado.
  */
  const situacoes = new Map(
    ROTEIRO.map((etapa) => [
      etapa.numero,
      situacaoDaEtapa(etapa, {
        catalogo,
        documentos: vigentes,
        divergencias: apuracao?.divergencias ?? [],
        quinzena: competencia.quinzena,
      }),
    ]),
  );

  /*
    Qual etapa está aberta. Uma por vez: as oito abertas eram uma página inteira
    de rolagem para achar a que interessa, e o estado de cada uma já está no
    cabeçalho dela (ver `resumoDaEtapa`), então fechar não esconde nada.

    O padrão é tudo fechado — inclusive a etapa com pendência —, porque quem
    entra na competência quer ver o roteiro inteiro de relance antes de
    escolher onde trabalhar, não ser levado direto a uma etapa que a tela
    escolheu por ela. Quem manda é sempre o clique, na trilha ou no cabeçalho.
  */
  const aberta = etapaAberta ?? "";

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
          {/*
            O atalho da frota saiu daqui e foi para a etapa 2, que é onde a
            pergunta dele existe. No cabeçalho ele era o único atalho de uma
            etapa a ter destaque de tela inteira — e depois do roteiro, seria o
            mesmo link duas vezes na mesma página.
          */}
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileUp className="w-4 h-4" />
              O fechamento, etapa a etapa
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/*
              Um parágrafo só, e curto. O que cada etapa confere agora está
              escrita nela — repetir aqui a lista dos relatórios faria o topo da
              tela competir com o roteiro pela mesma explicação.
            */}
            <p className="text-sm text-muted-foreground">
              O fechamento na ordem em que ele é feito.{" "}
              {competencia.quinzena === 1
                ? "Esta é a 1ª quinzena: a conciliação (03.02.59.02) não existe aqui — ela chega com o fechamento da 2ª."
                : "Esta é a 2ª quinzena, que recebe todos os relatórios."}{" "}
              A conta roda com o que houver — o que faltar aparece nomeado na
              apuração, nunca como zero —, e uma etapa com divergência não
              impede as seguintes.
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
              Os relatórios saem na **ordem em que o fechamento é feito**, e não
              agrupados pelo papel que cada um tem no cálculo.

              Este agrupamento era por `LADOS_DA_CONFERENCIA` — devido,
              demonstrado, faturamento —, que é afirmação sobre a conta e
              continua sendo a verdade que o motor consome. O que ele não era é
              a ordem de quem confere: a pessoa que fecha a quinzena começa pela
              base contratual, passa pela frota e pela disponibilidade, e só
              então olha o que foi emitido. Os dois eixos são reais e não
              coincidem, e por isso o roteiro é uma leitura *sobre* o catálogo
              (ver `roteiro.ts`) em vez de uma reclassificação dele.

              A peça que não é arquivo — o contrato — continua na primeira
              etapa, que é onde se pergunta quanto deveria ser pago. Era ela que
              faltava numa competência real com os três relatórios do devido
              importados, três vistos verdes, e nenhum devido saindo do outro
              lado do produto.
            */}
            <TrilhaDoRoteiro
              etapas={ROTEIRO.map((etapa) => ({
                etapa,
                estado: situacoes.get(etapa.numero)!.estado,
              }))}
              aberta={Number(aberta.replace("etapa-", ""))}
              aoEscolher={(numero) => {
                setEtapaAberta(`etapa-${numero}`);
                /*
                  Rolar depois de abrir, e no quadro seguinte: o bloco só ganha
                  altura quando o accordion o expande, e rolar antes disso mira
                  a posição que o cabeçalho tinha fechado.
                */
                requestAnimationFrame(() =>
                  document
                    .getElementById(`etapa-${numero}`)
                    ?.scrollIntoView({ block: "start", behavior: "smooth" }),
                );
              }}
            />

            <Accordion
              type="single"
              collapsible
              value={aberta}
              onValueChange={(v) => setEtapaAberta(v)}
              className="border-t"
            >
            {ROTEIRO.map((etapa) => {
              const situacao = situacoes.get(etapa.numero)!;
              const resumo = resumoDaEtapa(situacao);
              const doRoteiro = etapa.fontes
                .map((t) => catalogo.find((f) => f.tipo === t))
                .filter((f): f is Fonte => !!f);

              return (
                <AccordionItem
                  key={etapa.numero}
                  value={`etapa-${etapa.numero}`}
                  id={`etapa-${etapa.numero}`}
                  className="scroll-mt-4"
                >
                  {/*
                    O cabeçalho carrega o estado sozinho — selo e resumo —,
                    porque com uma etapa aberta por vez ele é tudo o que sete
                    delas mostram. `hover:no-underline` desfaz o padrão do
                    componente: sublinhar a linha inteira, com selo e número,
                    faria o cabeçalho parecer um link só.
                  */}
                  <AccordionTrigger className="hover:no-underline py-3 gap-3">
                    <span className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="text-sm font-semibold text-left">
                        <span className="text-muted-foreground tabular-nums mr-1.5">
                          {etapa.numero}.
                        </span>
                        {etapa.titulo}
                      </span>
                      {resumo && (
                        <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                          {resumo}
                        </span>
                      )}
                    </span>
                    <SeloDaEtapa estado={situacao.estado} />
                  </AccordionTrigger>

                  <AccordionContent>
                  {/*
                    O que se confere, o que já foi verificado e o que ainda
                    falta ficam atrás do ícone — a etapa em si mostra os
                    arquivos, e só eles. O aviso operacional (`nota`) é a
                    exceção: ele muda como alguém envia o arquivo, então
                    continua à vista, ao lado do ícone.
                  */}
                  <div className="flex items-start justify-between gap-3">
                    {etapa.nota && etapa.numero !== 3 ? (
                      <p className="text-xs text-muted-foreground max-w-2xl border-l-2 border-border pl-2">
                        {etapa.nota}
                      </p>
                    ) : (
                      <span />
                    )}
                    <SobreAEtapa etapa={etapa} />
                  </div>

                  {/*
                    A etapa 1 não tem fonte nenhuma (`fontes: []`) e por isso
                    `doRoteiro` é sempre vazio ali — mas é a etapa que mostra
                    `LinhaDoContrato`, que não é arquivo. Sem o `||`, a lista
                    inteira nunca aparecia para a etapa 1, e a peça do
                    contrato ficava morta atrás de uma condição que nunca via.
                  */}
                  {/*
                    A etapa 3 não recebe mais arquivo por aqui: a
                    disponibilidade vai ganhar um módulo próprio, e até lá
                    esta etapa só avisa disso — ver `PlaceholderDaDisponibilidade`.
                  */}
                  {etapa.numero === 3 ? (
                    <PlaceholderDaDisponibilidade />
                  ) : (
                    (doRoteiro.length > 0 || etapa.numero === 1) && (
                      <ul className="divide-y mt-1">
                        {doRoteiro.map((fonte) => (
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
                            contrato={dados.data?.contrato ?? null}
                            leituraDeImagem={leiturasDeFrota[fonte.tipo]}
                            onLeituraDeImagem={(leitura) => {
                              gravarRascunhoDeImagem(id, fonte.tipo, leitura);
                              setLeiturasDeFrota((m) => ({
                                ...m,
                                [fonte.tipo]: leitura,
                              }));
                            }}
                            onLimparLeituraDeImagem={() => {
                              gravarRascunhoDeImagem(id, fonte.tipo, null);
                              setLeiturasDeFrota((m) => {
                                const { [fonte.tipo]: _descartado, ...resto } = m;
                                return resto;
                              });
                            }}
                          />
                        ))}
                        {/*
                          A peça que não é arquivo. Mora na etapa 1 porque é ali
                          que se pergunta "quanto deveria ser pago" — a mesma
                          razão de ela viver no grupo do devido antes do roteiro.
                        */}
                        {etapa.numero === 1 && (
                          <LinhaDoContrato
                            contrato={dados.data?.contrato ?? null}
                            quinzena={competencia.quinzena}
                          />
                        )}
                      </ul>
                    )
                  )}

                  <DentroDaEtapa
                    etapa={etapa}
                    situacao={situacao}
                    base={base}
                    competencia={competencia}
                    competenciaId={id}
                    totais={totais.data}
                  />
                  </AccordionContent>
                </AccordionItem>
              );
            })}
            </Accordion>
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
            {foraDoRoteiro.length > 0 && (
              <ul className="divide-y border-t mt-1">
                {foraDoRoteiro.map((fonte) => (
                  <LinhaDeFonte
                    key={fonte.tipo}
                    fonte={fonte}
                    documento={vigentes.get(fonte.tipo)}
                    competenciaId={id}
                    semVerba={
                      estadoDaFonte(vigentes.get(fonte.tipo)) === "SEM_VERBA"
                    }
                    foraDaQuinzena={
                      !fonte.quinzenas.includes(competencia.quinzena) &&
                      !fonte.quinzenasOpcionais.includes(competencia.quinzena)
                    }
                    opcionalNaQuinzena={fonte.quinzenasOpcionais.includes(
                      competencia.quinzena,
                    )}
                    quinzena={competencia.quinzena}
                    enviando={
                      enviar.isPending && enviar.variables?.tipo === fonte.tipo
                    }
                    travada={encerrada}
                    onArquivo={(arquivo) =>
                      enviar.mutate({ tipo: fonte.tipo, arquivo })
                    }
                    contrato={dados.data?.contrato ?? null}
                    leituraDeImagem={leiturasDeFrota[fonte.tipo]}
                    onLeituraDeImagem={(leitura) => {
                      gravarRascunhoDeImagem(id, fonte.tipo, leitura);
                      setLeiturasDeFrota((m) => ({
                        ...m,
                        [fonte.tipo]: leitura,
                      }));
                    }}
                    onLimparLeituraDeImagem={() => {
                      gravarRascunhoDeImagem(id, fonte.tipo, null);
                      setLeiturasDeFrota((m) => {
                        const { [fonte.tipo]: _descartado, ...resto } = m;
                        return resto;
                      });
                    }}
                  />
                ))}
              </ul>
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
 * A ETAPA DE DISPONIBILIDADE, sem envio — até o módulo próprio existir.
 *
 * O envio do 03.08.18 (FF e Vans) saiu desta etapa: a disponibilidade vai
 * ganhar uma tela própria, fora do fechamento, e até lá não há para onde
 * enviar o arquivo aqui. O botão fica desabilitado de propósito — não há
 * rota ainda para prometer, e um link morto seria pior que nenhum link.
 */
function PlaceholderDaDisponibilidade() {
  return (
    <div className="py-4 flex items-start gap-3">
      <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0 space-y-2">
        <p className="text-sm text-muted-foreground">
          Em breve dará para acompanhar a disponibilidade de veículos — frota
          fixa e vans — num módulo próprio, fora do fechamento.
        </p>
        <span title="Ainda não existe — o módulo está a caminho.">
          <Button variant="outline" size="sm" disabled>
            Ir para Disponibilidade de veículos
          </Button>
        </span>
      </div>
    </div>
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
        {respondeu && contrato.parametros && (
          <div className="ml-6 mt-2">
            <GradeDoContrato
              parametros={contrato.parametros}
              custoVariavelPrevistoPor25Viagens={
                contrato.custoVariavelPrevistoPor25Viagens
              }
            />
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
 * A régua do cadastro — os parâmetros do contrato, categoria por categoria.
 *
 * O cadastro de Remuneração parte a frota em seis categorias (frota ativa e
 * inativa, van ativa e inativa, noturna, marketing), e cada uma tem só as
 * linhas que a aba pede para ela — uma van não tem "equipe de entrega" da
 * mesma forma que a frota fixa, e Marketing não tem veículo nenhum. Uma
 * célula sem linha correspondente mostra `—`, e não zero: zero afirmaria um
 * valor contratado, e aqui não há o que afirmar.
 *
 * **Custo Variável só existe na Frota Ativa.** No catálogo do cadastro
 * (`lib/remuneracao/src/catalogo.ts`), `ativo_custo_variavel` e
 * `ativo_lucro_operacional` — que a aba soma numa parcela só,
 * `custoVariavelPrevistoPor25Viagens` — moram no bloco `VEÍCULOS ATIVOS`, e
 * nenhuma outra categoria tem linha equivalente. Por isso a linha da grade
 * só preenche a coluna de Frota Ativa, e as demais ficam com `—`.
 */
interface ColunaDoContrato {
  titulo: string;
  totalVeiculos: number | null;
  custoFixo: number | null;
  custoEquipe: number | null;
  custosIndiretos: number | null;
  custoVariavel: number | null;
}

function colunasDoContrato(
  p: ParametrosDoContrato,
  custoVariavelPrevistoPor25Viagens: number | null,
): ColunaDoContrato[] {
  return [
    {
      titulo: "Frota Ativa",
      totalVeiculos: p.frotaFixaAtiva,
      custoFixo: p.remuneracaoFixaDaFrotaAtiva,
      custoEquipe: p.remuneracaoDaEquipeDeEntrega,
      custosIndiretos: p.remuneracaoDoQlpAdministrativo + p.remuneracaoDeOutrasDespesas,
      custoVariavel: custoVariavelPrevistoPor25Viagens,
    },
    {
      titulo: "Frota Inativa",
      totalVeiculos: p.frotaFixaInativa,
      custoFixo: p.remuneracaoDaFrotaInativa,
      custoEquipe: null,
      custosIndiretos: null,
      custoVariavel: null,
    },
    {
      titulo: "Van Ativa",
      totalVeiculos: p.vansAtivas,
      custoFixo: p.custoFixoDaVan,
      custoEquipe: p.custoDaEquipeDeEntregaDaVan,
      custosIndiretos: null,
      custoVariavel: null,
    },
    {
      titulo: "Van Inativa",
      totalVeiculos: p.vansInativas,
      custoFixo: p.remuneracaoDasVansInativas,
      custoEquipe: null,
      custosIndiretos: null,
      custoVariavel: null,
    },
    {
      titulo: "Noturna",
      totalVeiculos: p.rotasNoturnas,
      custoFixo: p.custoDaNoturnaSemImposto,
      custoEquipe: null,
      custosIndiretos: null,
      custoVariavel: null,
    },
    {
      titulo: "Marketing",
      totalVeiculos: null,
      custoFixo: p.custoDeMarketingSemImposto,
      custoEquipe: null,
      custosIndiretos: null,
      custoVariavel: null,
    },
  ];
}

const LINHAS_DO_CONTRATO: {
  rotulo: string;
  valor: (c: ColunaDoContrato) => number | null;
  dinheiro: boolean;
}[] = [
  { rotulo: "Total Veículos", valor: (c) => c.totalVeiculos, dinheiro: false },
  { rotulo: "Custo Fixo", valor: (c) => c.custoFixo, dinheiro: true },
  { rotulo: "Custo Equipe Entrega", valor: (c) => c.custoEquipe, dinheiro: true },
  { rotulo: "Custos Indiretos", valor: (c) => c.custosIndiretos, dinheiro: true },
  {
    rotulo: "Custo Variável (25 viagens)",
    valor: (c) => c.custoVariavel,
    dinheiro: true,
  },
];

/**
 * O de-para entre a grade do contrato e a leitura por imagem — ver
 * `grade-comparacao-frota.ts` para a regra completa: nome literal primeiro
 * (ex.: "Noturna" bate com "Noturna"), e a via por categoria confirmada por
 * amostra real depois (ex.: "Padrão" -> "Frota Ativa" — ver
 * `resolverValorDoContrato`). A chave aqui e `linha|coluna` do contrato,
 * normalizada por `normalizarCategoria`.
 */
function mapaDeComparacaoDoContrato(
  parametros: ParametrosDoContrato,
  custoVariavelPrevistoPor25Viagens: number | null,
): Map<string, ValorDoContratoParaComparar> {
  const colunas = colunasDoContrato(parametros, custoVariavelPrevistoPor25Viagens);
  const mapa = new Map<string, ValorDoContratoParaComparar>();
  for (const linha of LINHAS_DO_CONTRATO) {
    for (const coluna of colunas) {
      const valor = linha.valor(coluna);
      if (valor === null) continue;
      mapa.set(
        `${normalizarCategoria(linha.rotulo)}|${normalizarCategoria(coluna.titulo)}`,
        { valor, dinheiro: linha.dinheiro },
      );
    }
  }
  return mapa;
}

function GradeDoContrato({
  parametros,
  custoVariavelPrevistoPor25Viagens,
}: {
  parametros: ParametrosDoContrato;
  custoVariavelPrevistoPor25Viagens: number | null;
}) {
  const p = parametros;
  const colunas = colunasDoContrato(parametros, custoVariavelPrevistoPor25Viagens);
  const linhas = LINHAS_DO_CONTRATO;

  return (
    <div className="max-w-2xl">
      <div className="overflow-x-auto rounded-md border">
        <table className="text-xs w-full min-w-max">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left font-medium px-2 py-1.5" />
              {colunas.map((c) => (
                <th
                  key={c.titulo}
                  className="text-right font-medium px-2 py-1.5 whitespace-nowrap"
                >
                  {c.titulo}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.rotulo} className="border-t">
                <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                  {l.rotulo}
                  {l.rotulo === "Custo Variável (25 viagens)" && (
                    <BotaoDeDetalhe>
                      Com o lucro operacional previsto já somado, como o
                      cadastro digita — a aba não guarda as duas parcelas
                      separadas.
                    </BotaoDeDetalhe>
                  )}
                </td>
                {colunas.map((c) => {
                  const v = l.valor(c);
                  return (
                    <td
                      key={c.titulo}
                      className="px-2 py-1.5 text-right tabular-nums"
                    >
                      {v === null ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : l.dinheiro ? (
                        formatBrl(v)
                      ) : (
                        formatNumber(v, 0)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground mt-1.5">
        Alíquotas — PIS {formatNumber(p.aliquotas.pis * 100)}%, COFINS{" "}
        {formatNumber(p.aliquotas.cofins * 100)}%, ICMS{" "}
        {formatNumber(p.aliquotas.icms * 100)}%, ISS{" "}
        {formatNumber(p.aliquotas.iss * 100)}% — e{" "}
        {formatNumber(p.parcelaDentroDoMunicipio * 100)}% dos documentos
        previstos dentro do município.
      </p>
    </div>
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
  contrato,
  leituraDeImagem,
  onLeituraDeImagem,
  onLimparLeituraDeImagem,
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
  /** Para comparar a leitura da imagem com o contrato — ver `mapaDeComparacaoDoContrato`. */
  contrato: ContratoDaCompetencia | null;
  /** O rascunho já lido, se houver — sobrevive a trocar de etapa e a sair da página. */
  leituraDeImagem: LeituraDaGrade | undefined;
  onLeituraDeImagem: (leitura: LeituraDaGrade) => void;
  /** Apaga o rascunho salvo — o outro jeito de ele sumir, além de mandar outra foto. */
  onLimparLeituraDeImagem: () => void;
}) {
  const campo = useRef<HTMLInputElement>(null);
  const aceitaImagem =
    fonte.tipo === "FROTA_PROMAX_ATIVA" || fonte.tipo === "FROTA_PROMAX_INATIVA";
  const valoresDoContrato = contrato?.parametros
    ? mapaDeComparacaoDoContrato(
        contrato.parametros,
        contrato.custoVariavelPrevistoPor25Viagens,
      )
    : undefined;

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
        {/*
          A tela do Promax fotografada, para quem confere sem esperar o
          relatório — mora no corpo da linha, não na coluna de botões, porque
          o que ela produz é rascunho de leitura, e o rascunho fica perto do
          texto que ele explica.
        */}
        {aceitaImagem && (
          <LeituraDaImagemDaFrota
            tipo={fonte.tipo}
            travada={travada}
            leituraSalva={leituraDeImagem}
            onLeitura={onLeituraDeImagem}
            onLimpar={onLimparLeituraDeImagem}
            valoresDoContrato={valoresDoContrato}
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

/**
 * A TELA DO PROMAX FOTOGRAFADA — rascunho para bater o olho, não fonte da conta.
 *
 * Existe porque quem fecha a quinzena às vezes tem a tela do Promax aberta e
 * não o relatório exportado — e esperar pelo `.xlsx` para conferir os totais
 * é um passo a mais que a foto resolve na hora. O que sai daqui **não vira
 * documento**: a leitura por imagem não passa por `receberDocumento`, não
 * grava nada, e o relatório continua sendo o que a apuração de fato consome
 * (ver `compararFrotaDaCompetencia`, que lê placa a placa — a tela mostra só
 * totais por categoria, sem placa nenhuma).
 *
 * **A correspondência com o contrato é só a que já foi confirmada.** A grade
 * mostra a imagem como ela é — "Padrão", "Fixo", "MKT"… — e marca uma célula
 * como comparável quando a linha *e* a coluna que a imagem leu têm
 * exatamente o mesmo texto do lado do contrato (ex.: "Noturna" bate com
 * "Noturna"), ou quando a coluna é uma categoria que
 * `classificarCategoriaDeFrotaPromax` já reconhece por amostra real — hoje,
 * "Padrão" como Frota Ativa e "Fixo" como Van Ativa (ver o comentário desse
 * módulo para a print que confirmou os dois). Categorias sem amostra
 * confirmada ("MKT", "Refrigeração", "Especial", "Recarga", e o lado
 * inativo inteiro) continuam sem marcação — um de-para inventado aqui
 * mostraria "bate"/"não bate" sobre uma categoria que pode nem ser a mesma
 * coisa. Ver `resolverValorDoContrato` em `grade-comparacao-frota.ts`.
 */
function LeituraDaImagemDaFrota({
  tipo,
  travada,
  leituraSalva,
  onLeitura,
  onLimpar,
  valoresDoContrato,
}: {
  tipo: TipoDeFonte;
  travada: boolean;
  /** O rascunho já lido antes de a etapa fechar, se houver. */
  leituraSalva: LeituraDaGrade | undefined;
  onLeitura: (leitura: LeituraDaGrade) => void;
  /** Apaga o rascunho salvo — o único outro jeito de ele sumir, além de mandar outra foto. */
  onLimpar: () => void;
  /** As células do contrato cujo nome de linha e coluna batem, literalmente, com os da imagem. */
  valoresDoContrato: Map<string, ValorDoContratoParaComparar> | undefined;
}) {
  const campo = useRef<HTMLInputElement>(null);
  /*
    Começa aberta se já existe um rascunho salvo — senão, voltar para a etapa
    mostraria só o botão, como se a leitura anterior tivesse sumido.
  */
  const [aberta, setAberta] = useState(!!leituraSalva);

  const ler = useMutation({
    mutationFn: (arquivo: File) => lerGradeDaImagem(tipo, arquivo),
    onSuccess: (leitura) => {
      onLeitura(leitura);
      setAberta(true);
    },
  });

  const leitura = ler.data ?? leituraSalva;
  const situacao: SituacaoDaFrota | null =
    tipo === "FROTA_PROMAX_ATIVA"
      ? "ATIVA"
      : tipo === "FROTA_PROMAX_INATIVA"
        ? "INATIVA"
        : null;

  return (
    <div className="mt-2 ml-6">
      <input
        ref={campo}
        type="file"
        className="hidden"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={(e) => {
          const arquivo = e.target.files?.[0];
          e.target.value = "";
          if (arquivo) ler.mutate(arquivo);
        }}
      />
      <span
        title={
          travada ? "A quinzena está fechada — reabra para conferir." : undefined
        }
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          disabled={ler.isPending || travada}
          onClick={() => campo.current?.click()}
        >
          {ler.isPending ? (
            <>
              <ScanLine className="w-3.5 h-3.5 mr-1.5 animate-pulse" />
              Lendo a imagem…
            </>
          ) : (
            <>
              <ImageUp className="w-3.5 h-3.5 mr-1.5" />
              Conferir com uma foto da tela do Promax
            </>
          )}
        </Button>
      </span>

      {leitura && leitura.motivo === "IA" && leitura.celulas.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          disabled={travada}
          onClick={() => {
            ler.reset();
            setAberta(false);
            onLimpar();
          }}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Remover rascunho
        </Button>
      )}

      {ler.isError && (
        <p className="text-xs text-destructive mt-1">{textoDoErro(ler.error)}</p>
      )}

      {leitura && leitura.motivo === "SEM_CHAVE" && (
        <p className="text-xs text-muted-foreground mt-1">
          A leitura de imagem não está configurada neste ambiente.
        </p>
      )}
      {leitura && (leitura.motivo === "RECUSA" || leitura.motivo === "ERRO") && (
        <p className="text-xs text-muted-foreground mt-1">
          {leitura.erro ??
            "Não consegui ler esta imagem. Um print da tela inteira, sem corte, costuma resolver."}
        </p>
      )}
      {leitura && leitura.motivo === "IA" && aberta && (
        <div className="mt-2">
          {leitura.celulas.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Não achei nenhuma célula nesta imagem — confira se é a tela de
              frota do Promax.
            </p>
          ) : (
            <>
              <GradeLivre
                celulas={leitura.celulas}
                valoresDoContrato={valoresDoContrato}
                situacao={situacao}
              />
              <p className="text-xs text-muted-foreground/80 mt-1.5">
                Rascunho da imagem — não vira documento, mas fica salvo neste
                navegador até você mandar outra foto ou apertar "Remover
                rascunho". As células em destaque já foram comparadas com o
                contrato acima, porque a linha tem o mesmo nome dos dois
                lados e a coluna também — ou é uma categoria já confirmada
                contra o contrato ("Padrão" = Frota Ativa, "Fixo" = Van
                Ativa); as demais colunas ainda não têm essa correspondência
                confirmada — compare-as você mesmo.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Uma grade sem catálogo — linha e coluna são o texto que a imagem mostrou. */
function GradeLivre({
  celulas,
  valoresDoContrato,
  situacao,
}: {
  celulas: CelulaDaGrade[];
  /** As células do contrato contra as quais a leitura por imagem pode comparar — ver `resolverValorDoContrato`. */
  valoresDoContrato: Map<string, ValorDoContratoParaComparar> | undefined;
  /** Ativa ou inativa — decide, na correspondência por categoria, se "Padrão" é Frota Ativa ou Frota Inativa. `null` quando o tipo da fonte não é um dos dois (não deveria acontecer, `GradeLivre` só é usada para frota). */
  situacao: SituacaoDaFrota | null;
}) {
  const linhas = [...new Set(celulas.map((c) => c.linha))];
  const colunas = [...new Set(celulas.map((c) => c.coluna))];
  const porCelula = new Map(celulas.map((c) => [`${c.linha} ${c.coluna}`, c]));

  return (
    <div className="max-w-2xl overflow-x-auto rounded-md border">
      <table className="text-xs w-full min-w-max">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left font-medium px-2 py-1.5" />
            {colunas.map((coluna) => (
              <th
                key={coluna}
                className="text-right font-medium px-2 py-1.5 whitespace-nowrap"
              >
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr key={linha} className="border-t">
              <td className="px-2 py-1.5 text-muted-foreground whitespace-nowrap">
                {linha}
              </td>
              {colunas.map((coluna) => {
                const celula = porCelula.get(`${linha} ${coluna}`);
                const doContrato = resolverValorDoContrato(
                  valoresDoContrato,
                  linha,
                  coluna,
                  situacao,
                );
                const bate =
                  doContrato && celula
                    ? Math.abs(celula.valor - doContrato.valor) < 0.01
                    : undefined;
                const tituloDoContrato = doContrato
                  ? `Contrato${doContrato.porCategoria ? " (por categoria)" : ""}: ${
                      doContrato.dinheiro
                        ? formatBrl(doContrato.valor)
                        : formatNumber(doContrato.valor, 0)
                    }`
                  : undefined;
                return (
                  <td
                    key={coluna}
                    title={tituloDoContrato}
                    className={
                      "px-2 py-1.5 text-right tabular-nums" +
                      (bate === true
                        ? " bg-emerald-50 dark:bg-emerald-950/40"
                        : bate === false
                          ? " bg-amber-50 dark:bg-amber-950/40"
                          : "")
                    }
                  >
                    <span className="inline-flex items-center gap-1">
                      {celula ? (
                        celula.comoEstaNaImagem
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                      {bate === true && (
                        <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                      )}
                      {bate === false && (
                        <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O ícone de detalhe — a frase da etapa fica curta na tela, e quem quer o
 * porquê completo clica aqui em vez de ler tudo de cara.
 */
function BotaoDeDetalhe({ children }: { children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Mais detalhes"
          className="inline-flex align-middle text-muted-foreground/60 hover:text-foreground ml-1"
        >
          <Info className="w-3 h-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="text-xs text-muted-foreground w-80">
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * SOBRE ESTA ETAPA — o que se confere, o que o sistema verifica hoje e o que
 * ainda falta, tudo atrás de um clique.
 *
 * **Por que sair da tela.** As oito etapas, com a explicação inteira sempre
 * visível, competiam com os arquivos pela atenção — a pessoa que só quer
 * enviar um relatório tinha que rolar por parágrafos de contexto para achar o
 * botão de enviar. O texto continua existindo e continua completo; só deixou
 * de ser a primeira coisa que a etapa mostra.
 */
function SobreAEtapa({ etapa }: { etapa: EtapaDoRoteiro }) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
      >
        <Info className="w-3.5 h-3.5" />
        Sobre esta etapa
      </button>
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogHeader>
          <DialogTitle>{etapa.titulo}</DialogTitle>
          <DialogDescription>{etapa.confere}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 max-h-[60vh] overflow-y-auto">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              O que o sistema confere nesta etapa
            </p>
            <ul className="mt-1.5 space-y-1.5">
              {etapa.verifica.map((v) => {
                const texto = typeof v === "string" ? v : v.texto;
                const detalhe = typeof v === "string" ? null : v.detalhe;
                return (
                  <li key={texto} className="text-sm flex gap-1.5">
                    <span aria-hidden className="text-muted-foreground/50">
                      ·
                    </span>
                    <span>
                      {texto}
                      {detalhe && (
                        <span className="block text-xs text-muted-foreground/80 mt-0.5">
                          {detalhe}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          {etapa.aindaNao.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                Ainda não conferido pelo sistema
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {etapa.aindaNao.map((p) => (
                  <li key={p.o_que} className="text-sm">
                    <span>{p.o_que}</span>
                    <span className="block text-xs text-muted-foreground/80 mt-0.5">
                      {p.porque}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAberto(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

/**
 * O MIOLO DE UMA ETAPA — o que o sistema verifica, o que achou, e o que falta.
 *
 * Vem **depois** das casinhas de envio de propósito. A ordem da leitura é a da
 * pergunta: primeiro o que se está conferindo (no topo da etapa), depois os
 * arquivos, e só então o que saiu deles. Pôr o resultado antes do arquivo faria
 * a etapa parecer um relatório, e ela é um posto de trabalho.
 */
function DentroDaEtapa({
  etapa,
  situacao,
  base,
  competencia,
  competenciaId,
  totais,
}: {
  etapa: EtapaDoRoteiro;
  situacao: SituacaoDaEtapa;
  base: string;
  competencia: Competencia;
  competenciaId: string;
  totais: TotaisDoPagamento | undefined;
}) {
  return (
    <div className="mt-3 space-y-3">
      {/* O que o motor achou nesta etapa. */}
      {situacao.divergencias.length > 0 && (
        <div className="rounded-md bg-amber-500/5 border border-amber-500/20 p-3">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            {situacao.divergencias.length === 1
              ? "O que o sistema encontrou"
              : `O que o sistema encontrou (${situacao.divergencias.length})`}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {situacao.divergencias.map((d) => (
              <li key={d.id} className="text-xs">
                <span className="font-medium">{d.titulo}</span>
                {d.valor !== 0 && (
                  <span className="tabular-nums"> · {formatBrl(d.valor)}</span>
                )}
                <p className="text-muted-foreground mt-0.5 max-w-2xl">
                  {EXPLICACAO_DA_DIVERGENCIA[d.tipo] ?? d.tipo}
                </p>
                <p className="text-muted-foreground/70 mt-0.5">{d.onde}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        A etapa 4 é a única que ganha um quadro próprio de números, e é por causa
        da conferência que a `0057` tornou possível: o total que o relatório
        assina contra o que as verbas somam. Sem os dois lados guardados
        separados, esta comparação era o mesmo número duas vezes.
      */}
      {etapa.numero === 4 && totais?.temPagamento && (
        <>
          <TotaisDoPagamentoNaEtapa totais={totais} />
          <VerbaAVerbaDoPagamento competenciaId={competenciaId} />
        </>
      )}

      {/*
        A etapa 5 mostra o 03.02.59.02 seção por seção, pelo mesmo motivo da
        etapa 4: é o relatório que quem fecha a quinzena tem na tela ao lado,
        e mostrá-lo aqui evita reabri-lo depois de importado.
      */}
      {etapa.numero === 5 && (
        <ConciliacaoDoArquivoNaEtapa competenciaId={competenciaId} />
      )}

      {/* A próxima ação, e os atalhos que a etapa oferece. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {situacao.proximaAcao && (
          <p className="text-xs font-medium">{situacao.proximaAcao}</p>
        )}
        <AtalhosDaEtapa
          etapa={etapa}
          base={base}
          competencia={competencia}
          competenciaId={competenciaId}
        />
      </div>
    </div>
  );
}

/**
 * O total declarado contra o calculado, por canal — a conferência da `0057`.
 *
 * **Só o canal Rota aparece aqui.** Este é o painel do Fechamento Rota, e o
 * AS — que é dinheiro real, da área de serviço, e continua gravado e apurado
 * por inteiro — só confunde a conferência de quem está fechando a Rota. Filtrar
 * é só da tela: `totais.canais` continua trazendo os dois, e o AS não some do
 * banco nem da apuração, só deixa de competir por espaço numa etapa que não é
 * a dele.
 */
function TotaisDoPagamentoNaEtapa({ totais }: { totais: TotaisDoPagamento }) {
  const canais = apenasCanalRota(totais.canais);
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium">
        Total Remuneração — declarado contra calculado
      </p>
      <table className="mt-1.5 text-xs w-full max-w-lg">
        <thead className="text-muted-foreground">
          <tr className="text-left">
            <th className="font-normal pr-4">Canal</th>
            <th className="font-normal pr-4 text-right">Declarado</th>
            <th className="font-normal pr-4 text-right">Calculado</th>
            <th className="font-normal text-right">Diferença</th>
          </tr>
        </thead>
        <tbody>
          {canais.map((c) => (
            <tr key={c.canal} className="border-t">
              <td className="py-1 pr-4">{c.canal}</td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {c.declarado === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  formatBrl(c.declarado)
                )}
              </td>
              <td className="py-1 pr-4 text-right tabular-nums">
                {formatBrl(c.calculado)}
              </td>
              <td
                className={
                  "py-1 text-right tabular-nums " +
                  (c.diferenca === null
                    ? "text-muted-foreground"
                    : c.diferenca === 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-amber-700 dark:text-amber-400")
                }
              >
                {c.diferenca === null
                  ? "—"
                  : c.diferenca === 0
                    ? "bate"
                    : formatBrl(c.diferenca)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {/*
        A frase que impede a leitura errada. Um traço na coluna do declarado não
        é zero e não é "bate": é o 03.08.20 importado antes de o total passar a
        ser guardado, e o número não existe em lugar nenhum. Dizer isso por
        extenso é o que separa "não dá para conferir" de "conferido".
      */}
      {canais.some((c) => c.declarado === null) && (
        <p className="text-xs text-muted-foreground mt-2 max-w-2xl">
          Total declarado não disponível neste documento — ele foi importado
          antes de o sistema passar a guardar o número que o relatório assina.
          Reimporte o 03.08.20 para realizar esta conferência.
        </p>
      )}
    </div>
  );
}

/**
 * O 03.08.20 verba a verba — o mesmo relatório que quem fecha a quinzena tem
 * na tela ao lado, sem precisar abri-lo de novo depois de importado.
 *
 * Busca à parte da `totais` (que o pai já carrega): esta tabela é maior e só
 * interessa a quem abriu a etapa 4, e ninguém paga o custo dela ao abrir a
 * lista das oito etapas.
 */
function VerbaAVerbaDoPagamento({ competenciaId }: { competenciaId: string }) {
  const { data } = useQuery({
    queryKey: ["fechamento", "pagamento", competenciaId],
    queryFn: () => lerItensDoPagamento(competenciaId),
  });
  const itens = data?.itens ?? [];
  if (itens.length === 0) return null;

  /*
    Só o canal Rota entra nesta etapa. O AS é dinheiro real — continua gravado,
    continua na apuração — mas esta é a etapa 4 do Fechamento Rota, e misturar
    os dois canais aqui só torna a conferência de quem está fechando a Rota
    mais difícil de ler.
  */
  const itensDaRota = apenasCanalRota(itens);
  if (itensDaRota.length === 0) return null;

  return (
    <div className="space-y-3">
      <GradeDoPagamentoPorCanal canal="ROTA" itens={itensDaRota} />
    </div>
  );
}

const CAMPOS_DO_PAGAMENTO = [
  "semImposto",
  "nfIss",
  "ctrcIcms",
  "valorFaturado",
  "vlcNfIss",
  "vlcCtrcIcms",
] as const;

const BLOCOS_DO_PAGAMENTO: { titulo: string; chave: "FRETE" | "OUTROS_CUSTOS" }[] = [
  { titulo: "Frete", chave: "FRETE" },
  { titulo: "Outros Custos", chave: "OUTROS_CUSTOS" },
];

/** As verbas de um canal, por bloco (Frete e Outros Custos), com o total de cada. */
function GradeDoPagamentoPorCanal({
  canal,
  itens,
}: {
  canal: string;
  itens: ItemDePagamento[];
}) {
  /*
    As DIVERGENTE são relatadas sobre a lista inteira, antes de consolidar —
    nenhuma linha delas some, então não importa se `consolidarDuplicatasExatas`
    ainda não rodou. As IDENTICA, em vez de só relatadas, são reduzidas a uma
    linha: é o pedido de quem opera — "se é a mesma informação duas vezes,
    mostra só uma vez".
  */
  const divergentes = verbasRepetidas(itens).filter((r) => r.classificacao === "DIVERGENTE");
  const { itens: itensExibidos, consolidadas } = consolidarDuplicatasExatas(itens);
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium">
        Verbas do 03.08.20 — {canal}
      </p>
      {divergentes.length > 0 && (
        <div className="mt-1.5 rounded-md bg-red-500/5 border border-red-500/20 p-2">
          <p className="text-xs font-medium text-red-700 dark:text-red-400">
            {divergentes.length === 1
              ? "Uma VBZ aparece repetida com valores divergentes"
              : `${divergentes.length} VBZs aparecem repetidas com valores divergentes`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {divergentes.map((d) => (
              <li key={`${d.bloco}-${d.vbz}`} className="text-xs text-muted-foreground">
                {String(d.vbz).padStart(2, "0")} - {d.nome} ({d.bloco}):{" "}
                {d.ocorrencias
                  .map((o) => `linha ${o.linha} = ${formatBrl(o.valorFaturado)}`)
                  .join("; ")}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-2xl">
            A mesma verba, no mesmo bloco, com valores diferentes não tem
            explicação óbvia — confira com a Ambev antes de fechar. Nenhuma
            linha foi somada ou removida; as duas continuam na tabela abaixo.
          </p>
        </div>
      )}
      {consolidadas.length > 0 && (
        <div className="mt-1.5 rounded-md bg-blue-500/5 border border-blue-500/20 p-2">
          <p className="text-xs font-medium text-blue-700 dark:text-blue-400">
            {consolidadas.length === 1
              ? "Uma verba estava duplicada no arquivo — mostrando uma só ocorrência"
              : `${consolidadas.length} verbas estavam duplicadas no arquivo — mostrando uma só ocorrência de cada`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {consolidadas.map((d) => (
              <li key={`${d.bloco}-${d.vbz}`} className="text-xs text-muted-foreground">
                {String(d.vbz).padStart(2, "0")} - {d.nome} ({d.bloco}): mantida a linha{" "}
                {d.linhaMantida}, idêntica à{" "}
                {d.linhasRemovidas.length === 1 ? "linha" : "linhas"}{" "}
                {d.linhasRemovidas.join(", ")}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground/80 mt-1 max-w-2xl">
            As linhas tinham os seis valores idênticos — a mesma informação
            duas vezes no arquivo. A tabela e os totais abaixo contam cada
            verba uma única vez.
          </p>
        </div>
      )}
      {BLOCOS_DO_PAGAMENTO.map(({ titulo, chave }) => {
        const doBloco = itensExibidos
          .filter((i) => i.bloco === chave)
          .sort((a, b) => a.verba.vbz - b.verba.vbz);
        if (doBloco.length === 0) return null;

        const total = (campo: (typeof CAMPOS_DO_PAGAMENTO)[number]) =>
          doBloco.reduce((soma, i) => soma + i[campo], 0);

        return (
          <div key={chave} className="mt-2 overflow-x-auto">
            <p className="text-xs text-muted-foreground">{titulo}</p>
            <table className="mt-1 text-xs w-full min-w-max">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="font-normal pr-4 py-1">VBZ</th>
                  <th className="font-normal pr-4 py-1 text-right">
                    S/Imposto
                  </th>
                  <th className="font-normal pr-4 py-1 text-right">NF-ISS</th>
                  <th className="font-normal pr-4 py-1 text-right">
                    CTRC-ICMS
                  </th>
                  <th className="font-normal pr-4 py-1 text-right">
                    Valor Faturado
                  </th>
                  <th className="font-normal pr-4 py-1 text-right">
                    Valor VLC NF-ISS
                  </th>
                  <th className="font-normal py-1 text-right">
                    Valor VLC CTRC-ICMS
                  </th>
                </tr>
              </thead>
              <tbody>
                {doBloco.map((i) => (
                  <tr key={`${i.bloco}-${i.linha}`} className="border-t">
                    <td className="py-1 pr-4">
                      {String(i.verba.vbz).padStart(2, "0")} -{" "}
                      {i.nomeNoArquivo}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {formatBrl(i.semImposto)}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {formatBrl(i.nfIss)}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {formatBrl(i.ctrcIcms)}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {formatBrl(i.valorFaturado)}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {formatBrl(i.vlcNfIss)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatBrl(i.vlcCtrcIcms)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t font-medium">
                  <td className="py-1 pr-4">Total {titulo}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">
                    {formatBrl(total("semImposto"))}
                  </td>
                  <td className="py-1 pr-4 text-right tabular-nums">
                    {formatBrl(total("nfIss"))}
                  </td>
                  <td className="py-1 pr-4 text-right tabular-nums">
                    {formatBrl(total("ctrcIcms"))}
                  </td>
                  <td className="py-1 pr-4 text-right tabular-nums">
                    {formatBrl(total("valorFaturado"))}
                  </td>
                  <td className="py-1 pr-4 text-right tabular-nums">
                    {formatBrl(total("vlcNfIss"))}
                  </td>
                  <td className="py-1 text-right tabular-nums">
                    {formatBrl(total("vlcCtrcIcms"))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/**
 * O 03.02.59.02 seção por seção — o mesmo relatório que quem fecha a quinzena
 * tem na tela ao lado, sem precisar abri-lo de novo depois de importado.
 */
function ConciliacaoDoArquivoNaEtapa({
  competenciaId,
}: {
  competenciaId: string;
}) {
  const { data } = useQuery({
    queryKey: ["fechamento", "conciliacao-do-arquivo", competenciaId],
    queryFn: () => lerItensDaConciliacao(competenciaId),
  });
  const itens = data?.itens ?? [];
  if (itens.length === 0) return null;

  const secoes = [...new Set(itens.map((i) => i.secao))];

  return (
    <div className="space-y-3">
      {secoes.map((secao) => (
        <GradeDaConciliacaoPorSecao
          key={secao}
          secao={secao}
          itens={itens.filter((i) => i.secao === secao)}
        />
      ))}
    </div>
  );
}

/** As linhas de uma seção (ROTA, AS ou GERAL), por bloco, na ordem em que o arquivo os traz. */
function GradeDaConciliacaoPorSecao({
  secao,
  itens,
}: {
  secao: string;
  itens: ItemDaConciliacao[];
}) {
  const blocos = [...new Set(itens.map((i) => i.bloco))];

  return (
    <div className="rounded-md border p-3">
      <p className="text-xs font-medium">
        Conciliação CT-e × SRTrans — {secao}
      </p>
      {blocos.map((bloco) => {
        const doBloco = itens.filter((i) => i.bloco === bloco);
        return (
          <div key={bloco} className="mt-2 overflow-x-auto">
            <p className="text-xs text-muted-foreground">{bloco}</p>
            <table className="mt-1 text-xs w-full min-w-max">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="font-normal pr-4 py-1">Rubrica</th>
                  <th className="font-normal pr-4 py-1 text-center">
                    Conciliado
                  </th>
                  <th className="font-normal pr-4 py-1 text-right">
                    R$ CT-e (Emitido)
                  </th>
                  <th className="font-normal py-1 text-right">
                    R$ SRTrans (Calculado)
                  </th>
                </tr>
              </thead>
              <tbody>
                {doBloco.map((i) => (
                  <tr key={i.linha} className="border-t">
                    <td className="py-1 pr-4">{i.rubrica}</td>
                    <td className="py-1 pr-4 text-center">
                      {i.conciliado ?? (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                    <td className="py-1 pr-4 text-right tabular-nums">
                      {i.emitido === null ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        formatBrl(i.emitido)
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {i.calculado === null ? (
                        <span className="text-muted-foreground/40">—</span>
                      ) : (
                        formatBrl(i.calculado)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Os atalhos de uma etapa — as telas que continuam o trabalho dela.
 *
 * A conciliação recebe a competência inteira na URL. É o ganho mais direto do
 * roteiro: aquelas telas são endereçadas por mês (unidade, transportadora,
 * operação, ano, mês) e obrigavam quem vinha de uma competência a escolher de
 * novo tudo o que a competência já sabe.
 */
function AtalhosDaEtapa({
  etapa,
  base,
  competencia,
  competenciaId,
}: {
  etapa: EtapaDoRoteiro;
  base: string;
  competencia: Competencia;
  competenciaId: string;
}) {
  const classe =
    "text-xs text-muted-foreground hover:text-foreground underline underline-offset-4";

  if (etapa.numero === 2) {
    return (
      <Link href={`${base}/competencias/${competenciaId}/frota`} className={classe}>
        Abrir a conferência de frota
      </Link>
    );
  }

  if (etapa.numero === 8) {
    const busca = new URLSearchParams({
      unidade: competencia.unidade.codigo,
      transportadora: competencia.transportadora.codigo,
      tipoDeOperacao: competencia.tipoDeOperacao,
      ano: String(competencia.ano),
      mes: String(competencia.mes),
    }).toString();
    return (
      <span className="flex flex-wrap gap-x-4 gap-y-1">
        <Link href={`${base}/resumo?${busca}`} className={classe}>
          Abrir o resumo geral do mês
        </Link>
        <Link href={`${base}/conciliacao?${busca}`} className={classe}>
          Abrir a conciliação contra a planilha
        </Link>
      </span>
    );
  }

  return null;
}
