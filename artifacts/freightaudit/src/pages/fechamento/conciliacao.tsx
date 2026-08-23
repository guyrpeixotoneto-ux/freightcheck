import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight } from "lucide-react";

import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apresentar } from "@/lib/apresentar-erro";
import { formatBrl } from "@/lib/format";
import { MES_LONGO } from "@/lib/fechamento-gerencial";
import {
  lerConciliacaoDoMes,
  rotuloDoTipo,
  type CanalDoResumo,
  type LinhaComparada,
  type PainelComparado,
  type ProcedenciaDaReferencia,
  type ResumoDoMes,
  type TresColunas,
} from "@/lib/fechamento";
import {
  ANOS_DO_FECHAMENTO,
  EscolherFechamento,
  fechamentoEscolhido,
} from "@/components/fechamento/escolher-fechamento";
import { PorQueNaoTemDevido } from "@/components/fechamento/por-que-nao-tem-devido";
import { ReferenciaDaPlanilha } from "@/components/fechamento/referencia-da-planilha";
import { SelosDeAfericao } from "@/components/fechamento/selos-de-afericao";
import { Seletor } from "@/components/fechamento/seletor";
import { cn } from "@/lib/utils";

/**
 * A CONCILIAÇÃO — o fechamento do sistema contra a planilha da operação.
 *
 * A pergunta desta tela é a que se faz com o `.xlsb` aberto ao lado: *o meu
 * fechamento — do meu cadastro e das minhas importações — bate com a minha
 * planilha?* Anexa-se a `Fechamento_Remuneracao.xlsb` daquele mês e cada linha
 * ganha, ao lado do devido, o número que o `RESUMO GERAL` dela publica e a
 * distância entre os dois.
 *
 * **Por que é um módulo, e não mais duas colunas no Resumo geral.** Aquela tela
 * responde todo dia, sem depender de anexo nenhum: devido, demonstrado, e a
 * diferença entre duas fontes que sempre existem. A conferência contra a
 * planilha só existe depois de alguém anexar um arquivo — tem gesto próprio
 * (anexar, versionar, trocar de régua), procedência própria (qual arquivo,
 * quem, quando, `sha256`) e um estado normal que é "ainda não há planilha".
 * Espremer isso em duas colunas condicionais fazia a mesma tabela ter duas
 * larguras e duas leituras, e escondia o anexo dentro de um painel.
 *
 * **A planilha é régua, e régua não entra na conta.** Nada aqui é recalculado:
 * `devido` e `demonstrado` chegam prontos de `@workspace/fechamento`, e a coluna
 * da planilha é enxertada no servidor **depois** de a conta estar fechada, por
 * uma transformação pura (`painel-referencia.ts`). Uma régua que mudasse o que
 * ela mede não seria régua — e é por isso que o cálculo não tem um único import
 * da referência.
 *
 * **A diferença com causa conhecida continua inteira.** O nome da investigação
 * já feita entra como legenda embaixo do número; o número não é absorvido nem
 * arredondado para zero. Um painel que zerasse a divergência cuja causa já se
 * sabe concordaria consigo mesmo por construção.
 *
 * **Tudo vive na URL** — unidade, transportadora, tipo, ano, mês e o recorte —,
 * pelo mesmo motivo do Resumo: o endereço colado numa mensagem abre exatamente
 * o que quem colou estava vendo.
 */

type Recorte = "1" | "2" | "consolidado";

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return (
    aviso.principal ??
    aviso.mensagemCrua ??
    "Não foi possível carregar a conciliação."
  );
}

/** `null` é ausência e aparece como traço — nunca como `R$ 0,00`. */
function dinheiro(valor: number | null): string {
  return valor === null ? "—" : formatBrl(valor);
}

/**
 * A coluna da planilha aparece? — e por que a pergunta não é `!== null`.
 *
 * Exportada para ser testada: é uma regra de tela cujo erro não aparece em tela
 * nenhuma até alguém abrir a Conciliação no meio de um deploy.
 *
 * **O caso que `!== null` erra.** Um servidor antigo devolve o painel **sem** o
 * campo `referencia`, e `undefined !== null` é `true`: a tela abriria colunas de
 * traços, afirmando que a planilha não publica nada quando a verdade é que
 * ninguém a anexou — ou que o servidor ainda não sabe respondê-la. As duas
 * ausências viram a mesma coluna vazia, que é o erro que este produto passa o
 * tempo todo evitando.
 */
export function temColunaDaPlanilha(painel: { referencia?: unknown }): boolean {
  return Boolean(painel.referencia);
}

/**
 * De qual arquivo a régua saiu — a primeira referência que a resposta traz.
 *
 * Exportada para teste porque a resposta tem um painel por canal e todos são
 * conferidos contra o **mesmo** arquivo: é um anexo por mês, não por canal.
 * Devolver o primeiro é dizer isso; procurar "a do canal" sugeriria que pode
 * haver duas.
 */
export function referenciaDoMes(
  canais: CanalDoResumo[],
): ProcedenciaDaReferencia | null {
  for (const canal of canais) {
    if (canal.comparado && temColunaDaPlanilha(canal.comparado)) {
      return canal.comparado.referencia;
    }
  }
  return null;
}

export default function Conciliacao() {
  const busca = useSearch();
  const [, navegar] = useLocation();
  const parametros = useMemo(() => new URLSearchParams(busca), [busca]);

  const unidade = parametros.get("unidade") ?? "";
  const transportadora = parametros.get("transportadora") ?? "";
  const tipoDeOperacao = parametros.get("tipoDeOperacao") ?? "";
  const ano = Number(parametros.get("ano") ?? ANOS_DO_FECHAMENTO[0]);
  const mes = Number(parametros.get("mes") ?? new Date().getMonth() + 1);
  const recorte = (parametros.get("ver") ?? "consolidado") as Recorte;

  const trocar = (campo: string, valor: string) => {
    const proximos = new URLSearchParams(parametros);
    proximos.set(campo, valor);
    navegar(`/fechamento/conciliacao?${proximos.toString()}`);
  };

  const alvo = { unidade, transportadora, tipoDeOperacao, ano, mes };
  const escolhido = fechamentoEscolhido(alvo);

  /*
    A consulta é a da Conciliação, e a chave dela diz isso. Compartilhar a chave
    com o Resumo faria as duas telas se invalidarem uma à outra e — pior — uma
    delas mostrar o que a outra buscou: a resposta daqui traz a coluna da
    planilha, e a de lá não.
  */
  const conciliacao = useQuery({
    queryKey: [
      "fechamento",
      "conciliacao",
      unidade,
      transportadora,
      tipoDeOperacao,
      ano,
      mes,
    ],
    queryFn: () => lerConciliacaoDoMes(alvo),
    enabled: escolhido,
  });

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Conciliação</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          O fechamento do sistema contra a planilha da operação. Anexe a{" "}
          <code>Fechamento_Remuneracao.xlsb</code> deste mês e cada linha
          aparece com o que o contrato deve, o que o <code>RESUMO GERAL</code>{" "}
          dela publica e a distância entre os dois — com o arquivo de onde a
          régua saiu ao lado.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-6xl">
        <EscolherFechamento
          valores={alvo}
          onTrocar={(campo, valor) => trocar(campo, valor)}
        />

        {!escolhido ? (
          <p className="text-sm text-muted-foreground">
            Escolha a unidade, o tipo e a transportadora acima. A planilha é
            anexada a um <strong>fechamento</strong> — a trinca unidade,
            transportadora e operação num mês —, e não a um mês do calendário:
            dois CDDs no mesmo mês são duas planilhas.
          </p>
        ) : (
          <>
            {/*
              O anexo vem antes de qualquer número, e aparece mesmo quando a
              leitura falha: anexar não depende de haver devido, nem de o mês ter
              sido apurado. É o gesto que dá começo à tela.
            */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  A planilha deste mês
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ReferenciaDaPlanilha alvo={alvo} />
              </CardContent>
            </Card>

            {conciliacao.isError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {textoDoErro(conciliacao.error)}
                </AlertDescription>
              </Alert>
            )}
            {conciliacao.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando o mês…</p>
            )}

            {conciliacao.data && (
              <Corpo
                mes={conciliacao.data}
                tipoDeOperacao={tipoDeOperacao}
                recorte={recorte}
                trocar={trocar}
              />
            )}
          </>
        )}
      </div>
    </Layout>
  );
}

function Corpo({
  mes,
  tipoDeOperacao,
  recorte,
  trocar,
}: {
  mes: ResumoDoMes;
  tipoDeOperacao: string;
  recorte: Recorte;
  trocar: (campo: string, valor: string) => void;
}) {
  const referencia = referenciaDoMes(mes.canais);
  const temComparacao = mes.canais.some((c) => c.comparado !== null);

  if (mes.canais.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Nenhum fechamento aberto em {MES_LONGO[mes.mes - 1]} de {mes.ano} para{" "}
          {mes.unidade.nome ?? mes.unidade.codigo} ·{" "}
          {mes.transportadora.nome ?? mes.transportadora.codigo} ·{" "}
          {rotuloDoTipo(tipoDeOperacao)}. A planilha anexada continua guardada —
          ela é do mês, e não da competência —, e a comparação aparece assim que
          houver o que comparar. Abra a quinzena em{" "}
          <Link
            href="/fechamento/competencias"
            className="text-primary hover:underline"
          >
            Importações
          </Link>
          .
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Seletor
        valor={recorte}
        opcoes={[
          ["1", "1ª quinzena"],
          ["2", "2ª quinzena"],
          ["consolidado", "Consolidado"],
        ]}
        onTrocar={(v) => trocar("ver", v)}
      />

      {referencia && <ProcedenciaDaPlanilha referencia={referencia} />}

      {/*
        "Ainda não há planilha" é o estado normal desta tela, e não um erro. Ele
        só pode ser afirmado quando existe comparação do outro lado: sem cadastro
        não há painel comparado, e a resposta não teria onde carregar a régua
        mesmo que o arquivo estivesse anexado — dizer "ninguém anexou" ali seria
        afirmar o que não se sabe.
      */}
      {!referencia && temComparacao && (
        <Alert>
          <AlertDescription>
            Nenhuma planilha anexada a este fechamento ainda. Anexe a{" "}
            <code>Fechamento_Remuneracao.xlsb</code> deste mês acima e as linhas
            abaixo ganham a coluna da planilha e a diferença contra o devido.
            Enquanto isso, o mês continua conferido contra o 03.08.20 no{" "}
            <Link
              href="/fechamento/resumo"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Resumo geral <ArrowRight className="w-3 h-3" />
            </Link>
            .
          </AlertDescription>
        </Alert>
      )}

      {mes.canais.map((canal) => (
        <CanalConciliado
          key={canal.canal}
          canal={canal}
          recorte={recorte}
          quinzenas={mes.quinzenas}
        />
      ))}
    </div>
  );
}

/**
 * De qual arquivo saiu a coluna da planilha.
 *
 * **Aparece sempre que a coluna aparece, e não atrás de um clique.** O `.xlsb`
 * não declara a que mês pertence — quem anexa é que declara —, e a única coisa
 * que torna a diferença auditável é dizer, ao lado dela, contra qual arquivo
 * ela foi medida. Sem isto a coluna seria uma afirmação sem fonte.
 */
function ProcedenciaDaPlanilha({
  referencia,
}: {
  referencia: ProcedenciaDaReferencia;
}) {
  return (
    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      Conferindo contra{" "}
      <strong className="text-foreground">{referencia.nomeDoArquivo}</strong>{" "}
      (versão {referencia.versao}), anexada em{" "}
      {new Date(referencia.anexadaEm).toLocaleString("pt-BR")}.{" "}
      <span className="font-mono" title={`sha256 ${referencia.sha256}`}>
        {referencia.sha256.slice(0, 12)}…
      </span>
      <span className="block mt-1">
        A associação a este mês foi declarada por quem anexou — a planilha não
        carrega essa informação, e o sistema não a adivinha.
      </span>
    </div>
  );
}

function CanalConciliado({
  canal,
  recorte,
  quinzenas,
}: {
  canal: CanalDoResumo;
  recorte: Recorte;
  /** As duas quinzenas do mês — a competência que a associação alcança. */
  quinzenas: ResumoDoMes["quinzenas"];
}) {
  return (
    <Card>
      <CardHeader className="pb-3 space-y-3">
        <CardTitle className="text-base">{canal.canal}</CardTitle>
        {/*
          Os mesmos dois selos do Resumo, do mesmo componente e com o mesmo
          número. Recalculá-los aqui daria duas telas com a mesma medida e dois
          lugares para ela divergir — que é o defeito que o resto deste módulo
          existe para não cometer.
        */}
        {canal.afericao && (
          <SelosDeAfericao
            afericao={canal.afericao}
            coluna={
              recorte === "consolidado"
                ? "total"
                : recorte === "1"
                  ? "primeira"
                  : "segunda"
            }
            rotuloDaColuna={
              recorte === "consolidado" ? "mês inteiro" : `${recorte}ª quinzena`
            }
          />
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto space-y-4">
        {canal.comparado ? (
          <TabelaConciliada painel={canal.comparado} recorte={recorte} />
        ) : (
          <>
            {/*
              Sem devido não há o que conciliar: a coluna que a planilha
              contradiz é a do contrato, e ela é a que não saiu. O diagnóstico é
              o mesmo do Resumo — as três portas, com a que fechou marcada — e
              vem do mesmo componente, para que as duas telas não digam duas
              coisas sobre o mesmo cadastro.
            */}
            <PorQueNaoTemDevido
              cadastro={canal.cadastro}
              quinzenas={quinzenas}
            />
            <p className="text-sm text-muted-foreground">
              Enquanto o devido não sair, não há coluna contra a qual medir a
              planilha: comparar o arquivo com a releitura do próprio 03.08.20
              seria uma conferência que concorda consigo mesma. A planilha
              anexada continua guardada, e a comparação aparece na próxima
              leitura desta tela, sem reanexar nada.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A TABELA DA CONCILIAÇÃO — três fontes e uma subtração.
 *
 * `Devido` sai do contrato e do diário; `Demonstrado`, do 03.08.20;
 * `Planilha`, do arquivo anexado. A única diferença escrita é a que a régua
 * mede — `devido − planilha` —, e ela vem calculada do servidor: a diferença
 * contra o demonstrado é a conversa do Resumo geral, e repeti-la aqui daria
 * duas telas com o mesmo número e dois lugares para ele divergir.
 *
 * **A linha que só tem um dos lados continua na tabela.** Falta de cadastro,
 * falta de 03.08.20 e falta de linha na planilha são estados diferentes, os
 * três normais no meio do mês, e esconder a linha faria a tabela parecer
 * completa quando não está.
 */
function TabelaConciliada({
  painel,
  recorte,
}: {
  painel: PainelComparado;
  recorte: Recorte;
}) {
  /* No consolidado a coluna é o total do mês; numa quinzena, a dela. */
  const coluna = (v: TresColunas) =>
    recorte === "consolidado"
      ? v.total
      : recorte === "1"
        ? v.primeira
        : v.segunda;

  const doCadastro =
    recorte === "2" ? painel.cadastro.segunda : painel.cadastro.primeira;

  /*
    Uma aba só respondendo pelas duas quinzenas é o caso comum — o contrato é
    mensal, e a régua da quinzena é de calendário, não de negócio. Quem lê
    precisa saber: "vigente desde 01/07" numa coluna que começa no dia 16 é
    verdade e parece erro.
  */
  const mesmaAbaNasDuas =
    painel.cadastro.primeira !== null &&
    painel.cadastro.segunda !== null &&
    painel.cadastro.primeira.cadastroId === painel.cadastro.segunda.cadastroId;

  const temPlanilha = temColunaDaPlanilha(painel);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          <strong className="text-foreground">Devido</strong> — do contrato e do
          diário
        </span>
        <span>
          <strong className="text-foreground">Demonstrado</strong> — do 03.08.20
        </span>
        {temPlanilha && (
          <span>
            <strong className="text-foreground">Planilha</strong> — do arquivo
            anexado
          </span>
        )}
        {doCadastro && (
          <span>
            cadastro vigente desde {doCadastro.vigenteDe}
            {mesmaAbaNasDuas && " — a mesma aba responde pelas duas quinzenas"}
          </span>
        )}
      </div>

      {painel.quadros.map((quadro) => (
        <div key={quadro.quadro}>
          <p className="text-xs font-semibold text-muted-foreground mb-1">
            {quadro.titulo}
          </p>
          {/*
            O quadro reservado da planilha não tem linha nenhuma — `AI34` e
            `AJ34` não existem como célula, e mesmo assim o total geral dela os
            soma. Uma tabela com cabeçalho e nada embaixo se lê como erro de
            carregamento; a frase que explica vem escrita do domínio.
          */}
          {quadro.linhas.length === 0 && quadro.reservado ? (
            <p className="py-2 text-xs text-muted-foreground">
              {quadro.reservado}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="py-2 text-left font-medium">Linha</th>
                  <th className="py-2 text-right font-medium min-w-32">
                    Devido
                  </th>
                  <th className="py-2 text-right font-medium min-w-32">
                    Demonstrado
                  </th>
                  <th className="py-2 text-right font-medium min-w-32">
                    Planilha
                  </th>
                  <th className="py-2 text-right font-medium min-w-32">
                    Dif. planilha
                  </th>
                </tr>
              </thead>
              <tbody>
                {quadro.linhas.map((linha) => {
                  /*
                  O demonstrado é `null` por duas razões opostas, e a tela tem de
                  separá-las. Sem 03.08.20, falta arquivo. Com 03.08.20 e a linha
                  dentro de um conjunto, **não falta nada**: o relatório traz a
                  frota fixa somada e não a parte por tipo, e o número desta linha
                  só existe junto com as outras cinco.
                */
                  const emConjunto =
                    coluna(linha.demonstrado) === null &&
                    linha.conjunto !== null;
                  return (
                    <tr
                      key={linha.chave}
                      className="border-b last:border-0 align-top"
                    >
                      <td className="py-2">
                        <span
                          title={
                            linha.memoria.primeira ??
                            linha.memoria.segunda ??
                            undefined
                          }
                        >
                          {linha.rotulo}
                        </span>
                        {linha.falta && (
                          <span className="block text-xs text-muted-foreground">
                            falta {linha.falta}
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {dinheiro(coluna(linha.devido))}
                      </td>
                      <td className="py-2 text-right font-mono tabular-nums">
                        {emConjunto ? (
                          <span
                            className="text-xs font-sans text-muted-foreground"
                            title={`${linha.conjunto!.nome}: ${dinheiro(
                              coluna(linha.conjunto!.valores),
                            )} — dividido com ${linha.conjunto!.linhas.join(", ")}`}
                          >
                            em conjunto
                          </span>
                        ) : (
                          dinheiro(coluna(linha.demonstrado))
                        )}
                      </td>
                      <CelulasDaPlanilha linha={linha} coluna={coluna} />
                    </tr>
                  );
                })}
                {/*
                O conjunto entra depois das linhas e antes do total, que é onde a
                subtração dele faz sentido: as seis linhas acima têm devido e não
                têm demonstrado, e é aqui que se vê se elas fecham contra o número
                que o relatório traz para todas juntas.
              */}
                {quadro.conjuntos.map((c) => (
                  <tr key={c.chave} className="border-b bg-muted/20 align-top">
                    <td
                      className="py-2 text-xs text-muted-foreground italic"
                      title={c.porque}
                    >
                      {c.nome} — o número que {c.linhas.length} linhas acima
                      dividem
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-xs">
                      {dinheiro(coluna(c.devido))}
                    </td>
                    <td className="py-2 text-right font-mono tabular-nums text-xs">
                      {dinheiro(coluna(c.demonstrado))}
                    </td>
                    {/*
                    O conjunto não tem linha própria no `RESUMO GERAL` — ele é uma
                    soma que só o nosso lado sabe fazer. Duas células vazias, e não
                    zeros: zero ali afirmaria que a planilha publica zero para o
                    conjunto, e ela não publica nada.
                  */}
                    <td className="py-2 text-right text-xs text-muted-foreground">
                      —
                    </td>
                    <td className="py-2 text-right text-xs text-muted-foreground">
                      —
                    </td>
                  </tr>
                ))}
                <tr className="border-b font-semibold">
                  <td className="py-2 text-right pr-4 text-xs text-muted-foreground">
                    Total
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {dinheiro(coluna(quadro.devido))}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {dinheiro(coluna(quadro.demonstrado))}
                  </td>
                  {/*
                  O total da planilha é o que ela **publica** na linha de total, e
                  não a soma das linhas dela. É deliberado: a reconciliação
                  encontrou um total (`AJ133`) cuja fórmula discorda das próprias
                  parcelas, e somar aqui esconderia exatamente esse defeito.
                */}
                  <td className="py-2 text-right font-mono tabular-nums">
                    {dinheiro(quadro.planilha ? coluna(quadro.planilha) : null)}
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">
                    {dinheiro(
                      quadro.diferencaDaPlanilha
                        ? coluna(quadro.diferencaDaPlanilha)
                        : null,
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      ))}

      {painel.pendencias.length > 0 && (
        <Alert>
          <AlertDescription className="text-xs">
            O devido está incompleto: falta {painel.pendencias.join(", ")}. As
            linhas que dependem disso ficam vazias em vez de somar zero — e a
            diferença contra a planilha não é escrita onde um dos lados não
            existe.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/**
 * As duas células da planilha numa linha — e o que cada estado delas significa.
 *
 * `—` quando a planilha não publica esta linha; o número quando publica. A
 * causa conhecida entra como legenda embaixo da diferença, e **não** apaga o
 * número: a diferença continua inteira, com o nome da investigação que já foi
 * feita ao lado. Uma diferença que some porque já se sabe de onde vem é uma
 * conferência que concorda consigo mesma.
 */
function CelulasDaPlanilha({
  linha,
  coluna,
}: {
  linha: LinhaComparada;
  coluna: (v: TresColunas) => number | null;
}) {
  const daPlanilha = linha.planilha ? coluna(linha.planilha) : null;
  const diferenca = linha.diferencaDaPlanilha
    ? coluna(linha.diferencaDaPlanilha)
    : null;
  const celula =
    linha.celulaDaPlanilha?.primeira ?? linha.celulaDaPlanilha?.segunda ?? null;

  return (
    <>
      <td
        className="py-2 text-right font-mono tabular-nums"
        title={celula ? `RESUMO GERAL, célula ${celula}` : undefined}
      >
        {dinheiro(daPlanilha)}
      </td>
      <td
        className={cn(
          "py-2 text-right font-mono tabular-nums",
          diferenca !== null && Math.abs(diferenca) >= 0.005 && "font-semibold",
        )}
      >
        {dinheiro(diferenca)}
        {linha.causaConhecida &&
          diferenca !== null &&
          Math.abs(diferenca) >= 0.005 && (
            <span
              className="block text-xs font-sans font-normal text-muted-foreground"
              title={linha.causaConhecida}
            >
              causa conhecida
            </span>
          )}
      </td>
    </>
  );
}
