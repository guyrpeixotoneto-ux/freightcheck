import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, ChevronLeft, ChevronRight, Truck } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TabelaDoDia } from "@/components/fechamento/tabela-do-dia";
import { apresentar } from "@/lib/apresentar-erro";
import { formatBrl, formatNumber } from "@/lib/format";
import { chaveDoDia } from "@/lib/fechamento-tela";
import {
  lerDia,
  DIAS_DA_SEMANA,
  NOME_DA_FROTA,
  type TotaisDaOperacao,
} from "@/lib/fechamento";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

const emDiaBR = (iso: string) => iso.split("-").reverse().join("/");

/** O dia anterior/seguinte, ou `null` quando sai da competência. */
function vizinho(dia: string, passo: 1 | -1, inicio: string, fim: string): string | null {
  const alvo = new Date(`${dia}T00:00:00Z`);
  alvo.setUTCDate(alvo.getUTCDate() + passo);
  const iso = alvo.toISOString().slice(0, 10);
  return iso >= inicio && iso <= fim ? iso : null;
}

/**
 * Um dia da quinzena, aberto — a aba `01`…`31` da planilha, sem a planilha.
 *
 * A tela responde uma pergunta que a apuração não responde: **o que aconteceu
 * neste dia?** A conta da quinzena diz quanto o período vale verba a verba; o
 * dia diz qual veículo saiu, a que horas voltou, quantas caixas entregou e
 * quanto aquela viagem rendeu — que é onde uma diferença de fechamento costuma
 * ter nascido.
 *
 * **Ela não calcula nada.** Os totais por frota vêm prontos do servidor, da
 * mesma função que alimenta a apuração. Uma segunda conta na tela seria uma
 * segunda verdade sobre o mesmo dinheiro.
 */
export default function DiaDoFechamento({ id, dia }: { id: string; dia: string }) {
  const dados = useQuery({
    queryKey: chaveDoDia(id, dia),
    queryFn: () => lerDia(id, dia),
  });

  if (dados.isLoading) {
    return (
      <Layout>
        <div className="p-8 text-sm text-muted-foreground">Carregando o dia…</div>
      </Layout>
    );
  }
  if (dados.isError || !dados.data) {
    return (
      <Layout>
        <div className="p-8 space-y-4">
          <Link
            href={`/fechamento/competencias/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Voltar à competência
          </Link>
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
          </Alert>
        </div>
      </Layout>
    );
  }

  const { competencia, fonte, dia: aberto } = dados.data;
  const anterior = vizinho(aberto.dia, -1, competencia.inicio, competencia.fim);
  const seguinte = vizinho(aberto.dia, 1, competencia.inicio, competencia.fim);

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <Link
          href={`/fechamento/competencias/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {emDiaBR(competencia.inicio)} a {emDiaBR(competencia.fim)}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight">
            Dia {String(aberto.numeroDoDia).padStart(2, "0")} · {emDiaBR(aberto.dia)}
          </h1>
          <span className="rounded-full border border-border bg-muted px-2.5 py-1 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
            {DIAS_DA_SEMANA[aberto.diaDaSemana]}
          </span>
          <nav className="flex items-center gap-1 ml-auto">
            <Passo href={anterior && `/fechamento/competencias/${id}/dias/${anterior}`} anterior />
            <Passo href={seguinte && `/fechamento/competencias/${id}/dias/${seguinte}`} />
          </nav>
        </div>
        <p className="text-muted-foreground mt-2">
          {competencia.unidade.nome ?? competencia.unidade.codigo} ·{" "}
          {competencia.transportadora.nome ?? competencia.transportadora.codigo}
          {fonte && <span className="font-mono text-xs"> · {fonte.nomeDoArquivo}</span>}
        </p>
      </header>

      <div className="p-8 space-y-6">
        {!fonte && (
          <Alert>
            <AlertDescription>
              O 2Art desta competência ainda não foi enviado. Sem ele não há
              viagem para mostrar — e um dia vazio aqui não quer dizer que a
              operação não rodou.
            </AlertDescription>
          </Alert>
        )}

        {/* ---------------------------------------------------------------
            1. O fecho do dia, por frota — os TOTAL PADRAO / TOTAL SPOT
            --------------------------------------------------------------- */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Fecho titulo="O dia inteiro" totais={aberto.totais} destaque />
          {aberto.porFrota.map((grupo) => (
            <Fecho
              key={grupo.frota}
              titulo={`Frota ${NOME_DA_FROTA[grupo.frota] ?? grupo.frota}`}
              totais={grupo}
            />
          ))}
        </div>

        {/* ---------------------------------------------------------------
            2. As viagens, inteiras
            --------------------------------------------------------------- */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Truck className="w-4 h-4" />
              As viagens do dia
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Uma linha por viagem, como o 2Art a escreve — do mapa e da placa
              até a abertura de imposto e a remuneração da equipe. A última
              coluna é a linha física do arquivo: é por ela que se confere a
              célula de origem sem refazer a conta.
              {aberto.porCanal.length > 1 && (
                <>
                  {" "}
                  O dia tem{" "}
                  {aberto.porCanal
                    .map(
                      (c) =>
                        `${c.viagens} ${c.viagens === 1 ? "viagem" : "viagens"} no canal ` +
                        `${c.canal === "AS" ? "AS" : "Rota"}`,
                    )
                    .join(" e ")}
                  .
                </>
              )}
            </p>
            <TabelaDoDia dia={aberto} />
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function Passo({ href, anterior }: { href?: string | null; anterior?: boolean }) {
  const conteudo = anterior ? (
    <ChevronLeft className="w-4 h-4" />
  ) : (
    <ChevronRight className="w-4 h-4" />
  );
  const rotulo = anterior ? "Dia anterior" : "Próximo dia";

  if (!href) {
    return (
      <span
        className="rounded-md border p-1.5 text-muted-foreground/40"
        aria-label={`${rotulo} (fora da quinzena)`}
      >
        {conteudo}
      </span>
    );
  }
  return (
    <Link href={href} className="rounded-md border p-1.5 hover:bg-muted" aria-label={rotulo}>
      {conteudo}
    </Link>
  );
}

/** O fecho de um recorte do dia: viagens, caixas e o frete que elas produziram. */
function Fecho({
  titulo,
  totais,
  destaque,
}: {
  titulo: string;
  totais: TotaisDaOperacao;
  destaque?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${destaque ? "bg-card" : "bg-muted/30"}`}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <p className="text-xl font-bold tabular-nums mt-1">{formatBrl(totais.freteComImposto)}</p>
      <p className="text-xs text-muted-foreground mt-1 tabular-nums">
        {totais.viagens} viagem(ns) · {formatNumber(totais.caixasEntregues, 0)} cx entregues de{" "}
        {formatNumber(totais.caixasCarregadas, 0)} carregadas
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {formatBrl(totais.freteSemImposto)} sem imposto
      </p>
    </div>
  );
}
