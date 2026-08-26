import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, GaugeCircle, Info } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { useBaseDoFechamento } from "@/lib/base-do-fechamento";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { apresentar } from "@/lib/apresentar-erro";
import { formatBrl, formatNumber } from "@/lib/format";
import {
  lerDisponibilidadeDaCompetencia,
  type FrotaNaDisponibilidade,
  type LinhaDeDisponibilidade,
} from "@/lib/fechamento";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível carregar a disponibilidade.";
}

const emDiaBR = (iso: string) => iso.split("-").reverse().join("/");

/** As duas casinhas do 03.08.18, com o nome que quem opera usa. */
const NOME_DA_CASINHA: Record<"FF" | "VAN", string> = {
  FF: "Caminhões (FF)",
  VAN: "Vans",
};

/**
 * O percentual como o relatório o declara.
 *
 * `null` vira travessão, e não `0%`: a coluna não ter vindo no arquivo e a
 * disponibilidade ter sido zero são coisas diferentes, e a segunda é uma
 * acusação. O relatório escreve a razão já em porcentagem em algumas
 * exportações e em fração noutras — por isso a leitura só formata o que veio,
 * sem multiplicar por cem por conta própria.
 */
function percentual(valor: number | null): string {
  if (valor === null) return "—";
  return `${formatNumber(valor, 2)}`;
}

function Numero({ children }: { children: ReactNode }) {
  return <td className="py-2 pr-4 text-right font-mono tabular-nums">{children}</td>;
}

function LinhaDoDia({ linha }: { linha: LinhaDeDisponibilidade }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 whitespace-nowrap">{emDiaBR(linha.dia)}</td>
      <td className="py-2 pr-4">{linha.canal}</td>
      <Numero>{formatNumber(linha.frotaTotal, 0)}</Numero>
      <Numero>{formatNumber(linha.contratada, 2)}</Numero>
      <Numero>{formatNumber(linha.realPrimeiraViagem + linha.realSegundaViagem, 2)}</Numero>
      <Numero>{formatNumber(linha.gapTotal, 2)}</Numero>
      <Numero>{formatNumber(linha.gapDaCia, 2)}</Numero>
      <Numero>{formatNumber(linha.gapDaTransportadora.total, 2)}</Numero>
      <Numero>{percentual(linha.percentualDeDisponibilidade)}</Numero>
      <Numero>{formatBrl(linha.descontos.total)}</Numero>
    </tr>
  );
}

/** Um número do resumo da frota, com o nome do que ele é. */
function Medida({
  titulo,
  valor,
  detalhe,
}: {
  titulo: string;
  valor: string;
  detalhe?: string;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2">
      <div className="text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
        {titulo}
      </div>
      <div className="font-mono tabular-nums text-sm">{valor}</div>
      {detalhe && <div className="text-xs text-muted-foreground">{detalhe}</div>}
    </div>
  );
}

function BlocoDaFrota({ frota }: { frota: FrotaNaDisponibilidade }) {
  const { totais } = frota;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">
          {NOME_DA_CASINHA[frota.tipoDeFrota]} — {totais.dias} dia(s), {totais.linhas} linha(s)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Medida titulo="Contratada" valor={formatNumber(totais.contratada, 2)} />
          <Medida
            titulo="Realizada"
            valor={formatNumber(totais.realizada, 2)}
            detalhe="1ª + 2ª viagem"
          />
          <Medida
            titulo="Gap da Cia"
            valor={formatNumber(totais.gapDaCia, 2)}
            detalhe="não desconta"
          />
          <Medida
            titulo="Gap da transportadora"
            valor={formatNumber(totais.gapDaTransportadora, 2)}
            detalhe="a parte que desconta"
          />
          <Medida
            titulo="Desconto do período"
            valor={formatBrl(totais.descontos.total)}
            detalhe="declarado pelo relatório"
          />
        </div>

        {/*
          As quatro parcelas ficam à vista porque o demonstrativo (03.08.20)
          agrupa três delas numa linha só — custo fixo, equipe e indiretos são
          subtraídos da mesma VBZ 02 — e mantém o fator ajudante à parte.
          Contestar um desconto exige a abertura que só o 03.08.18 tem.
        */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Medida titulo="Custo fixo" valor={formatBrl(totais.descontos.custoFixo)} />
          <Medida titulo="Equipe" valor={formatBrl(totais.descontos.equipe)} />
          <Medida titulo="Indiretos" valor={formatBrl(totais.descontos.indiretos)} />
          <Medida titulo="Fator ajudante" valor={formatBrl(totais.descontos.fatorAjudante)} />
        </div>

        {frota.linhas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            O relatório desta frota chegou, mas nenhuma linha dele cai dentro do período desta
            competência.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Dia</th>
                  <th className="py-2 pr-4 font-medium">Canal</th>
                  <th className="py-2 pr-4 font-medium text-right">Frota</th>
                  <th className="py-2 pr-4 font-medium text-right">Contratada</th>
                  <th className="py-2 pr-4 font-medium text-right">Realizada</th>
                  <th className="py-2 pr-4 font-medium text-right">Gap total</th>
                  <th className="py-2 pr-4 font-medium text-right">Gap Cia</th>
                  <th className="py-2 pr-4 font-medium text-right">Gap TP</th>
                  <th className="py-2 pr-4 font-medium text-right">% Disp.</th>
                  <th className="py-2 pr-4 font-medium text-right">Desconto</th>
                </tr>
              </thead>
              <tbody>
                {frota.linhas.map((l, i) => (
                  <LinhaDoDia key={`${l.dia}-${l.canal}-${i}`} linha={l} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A DISPONIBILIDADE — o 03.08.18 dia a dia, por frota e por canal.
 *
 * **É leitura, não apuração.** Nada nesta tela recalcula desconto: os números
 * são os que a importação gravou, reorganizados por
 * `disponibilidade-da-competencia.ts` e somados uma vez só, no servidor. Quem
 * transforma disponibilidade em dinheiro continua sendo a apuração, e pela
 * regra do mês.
 *
 * **A regra do mês fica escrita na tela, e não subentendida.** O desconto que
 * o 03.08.18 mede dia a dia é acumulado no mês inteiro e cobrado uma vez, no
 * demonstrativo da 2ª quinzena — por isso o total de uma 1ª quinzena é
 * informação, e não abatimento. Sem a frase, o número da 1ª quinzena parece um
 * desconto que sumiu do demonstrativo.
 *
 * **Percentual não se soma.** `% Utilização` e `% Disponibilidade` aparecem na
 * linha do dia, onde o relatório os declarou, e não no resumo da frota: média
 * de razão não é a razão da soma, e um percentual "do período" exigiria
 * escolher um denominador que o relatório não escolheu.
 */
export default function DisponibilidadeDaCompetencia({ id }: { id: string }) {
  const base = useBaseDoFechamento();
  const dados = useQuery({
    queryKey: ["fechamento", "competencia", id, "disponibilidade"],
    queryFn: () => lerDisponibilidadeDaCompetencia(id),
  });

  return (
    <Layout>
      <div className="p-8 space-y-6">
        <div>
          <Link
            href={`${base}/competencias/${id}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Voltar à competência
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-xl font-semibold">
            <GaugeCircle className="h-5 w-5" /> Disponibilidade
          </h1>
          <p className="text-sm text-muted-foreground">
            Promax 03.08.18 — frota contratada contra a que rodou, dia a dia, com o gap de cada
            lado e o desconto que ele produz.
          </p>
        </div>

        {dados.isLoading && <div className="text-sm text-muted-foreground">Carregando…</div>}

        {dados.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
          </Alert>
        )}

        {dados.data && (
          <>
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                O desconto de disponibilidade é acumulado no <strong>mês inteiro</strong> e
                cobrado uma vez, no demonstrativo da 2ª quinzena.{" "}
                {dados.data.competencia.quinzena === 1
                  ? "Nesta 1ª quinzena, o que a tela soma é acúmulo parcial — informação, não abatimento."
                  : "Nesta 2ª quinzena, o abatimento que o demonstrativo traz é o do mês, e não só o desta metade."}
              </AlertDescription>
            </Alert>

            {dados.data.fontes.length === 0 ? (
              <Card>
                <CardContent className="p-4 text-sm text-muted-foreground">
                  Nenhum 03.08.18 importado nesta competência ainda. Envie o relatório de
                  caminhões (FF) e/ou o de vans na lista de relatórios da{" "}
                  <Link href={`${base}/competencias/${id}`} className="underline">
                    competência
                  </Link>
                  .
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">
                  {dados.data.fontes.map((f) => (
                    <div key={f.tipo}>
                      {NOME_DA_CASINHA[f.tipoDeFrota]}: {f.nomeDoArquivo} — {f.linhasLidas}{" "}
                      linha(s) lida(s)
                    </div>
                  ))}
                  {dados.data.linhasForaDoPeriodo > 0 && (
                    <div className="mt-1">
                      {dados.data.linhasForaDoPeriodo} linha(s) do arquivo caem fora desta
                      quinzena e não entram em nenhuma soma desta tela — o 03.08.18 é mensal e a
                      competência é meio mês.
                    </div>
                  )}
                </div>

                {dados.data.frotas.length === 0 ? (
                  <Card>
                    <CardContent className="p-4 text-sm text-muted-foreground">
                      O relatório chegou, mas nenhuma linha dele cai dentro do período desta
                      competência.
                    </CardContent>
                  </Card>
                ) : (
                  dados.data.frotas.map((frota) => (
                    <BlocoDaFrota key={frota.tipoDeFrota} frota={frota} />
                  ))
                )}
              </>
            )}
          </>
        )}
      </div>
    </Layout>
  );
}
