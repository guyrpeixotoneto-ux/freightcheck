import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ArrowRight, CalendarDays, Lock, LockOpen, Plus, WifiOff } from "lucide-react";
import { Layout } from "@/components/layout/layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ComboboxCriavel } from "@/components/ui/combobox-criavel";
import { FecharQuinzena } from "@/components/fechamento/fechar-quinzena";
import {
  abrirCompetencia,
  lerCompetencia,
  listarCompetencias,
  listarFontes,
  listarPartes,
  NOME_DO_ESTADO,
  type Competencia,
  type Parte,
} from "@/lib/fechamento";
import { MES_LONGO } from "@/lib/fechamento-gerencial";
import { apresentar } from "@/lib/apresentar-erro";
import { useConsultaResiliente } from "@/lib/consulta-resiliente";

/**
 * O erro, na frase que a apresentação escolheu.
 *
 * `apresentar` decide entre a orientação tipada e a mensagem crua — a regra de
 * "uma orientação só" mora lá, e repeti-la aqui abriria uma segunda opinião
 * sobre o mesmo erro.
 */
function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível concluir.";
}

/**
 * O texto digitado, lido como `código — nome`.
 *
 * O separador aceita travessão, hífen ou barra porque quem digita não sabe qual
 * escolhemos, e as três formas são inequívocas: o código de um CDD e o de uma
 * transportadora são numéricos, então o que vem antes do separador é o código e
 * o que vem depois é o nome. Sem separador, o texto inteiro vira código — é o
 * caso de quem digita só `443`, e o nome fica em branco até alguém escrevê-lo.
 */
function cadastrar(texto: string): Parte {
  const partido = /^\s*([^—\-/]+?)\s*[—\-/]\s*(.+?)\s*$/.exec(texto);
  if (partido) return { codigo: partido[1], nome: partido[2], competencias: 0 };
  return { codigo: texto.trim(), nome: null, competencias: 0 };
}

const rotuloDaParte = (p: Parte) => (p.nome ? `${p.codigo} — ${p.nome}` : p.codigo);

const detalheDaParte = (p: Parte) =>
  p.competencias === 0
    ? "nova — vai ser cadastrada ao abrir a competência"
    : `${p.competencias} competência${p.competencias === 1 ? "" : "s"}`;

const previaDaParte = (texto: string) => {
  const parte = cadastrar(texto);
  return parte.nome
    ? `Código ${parte.codigo}, nome “${parte.nome}”.`
    : `Código ${parte.codigo}, sem nome — escreva “${parte.codigo} — Nome” para nomeá-la.`;
};

/** `julho` vira `Julho` — sozinho num campo, o nome do mês começa maiúsculo. */
const mesPorExtenso = (mes: number) =>
  MES_LONGO[mes - 1].replace(/^./, (letra) => letra.toUpperCase());

/**
 * O que a linha da lista oferece, pelo estado da competência.
 *
 * São três, e não dois, porque "não dá para fechar" tem duas causas diferentes
 * e a tela deve dizer qual: quem ainda não apurou precisa apurar — o servidor
 * recusa encerrar um período que não sabe quanto vale —, e quem já encerrou não
 * fecha de novo, reabre com motivo. Um botão desabilitado sem explicação
 * juntaria os dois casos numa frustração só.
 *
 * `EM_APURACAO` cai no mesmo lugar que `ABERTA` porque nenhuma apuração vigente
 * existe enquanto a conta não terminou de rodar, e `APROVADA` no mesmo que
 * `APURADA` porque aprovar não desfaz a apuração — os dois estados ainda não
 * são escritos por ninguém, e o dia em que forem, esta função já os conhece.
 */
export type AcaoDoFechamento = "FECHAR" | "REABRIR" | "APURAR";

export function acaoDoFechamento(estado: Competencia["estado"]): AcaoDoFechamento {
  if (estado === "ENCERRADA") return "REABRIR";
  if (estado === "APURADA" || estado === "APROVADA") return "FECHAR";
  return "APURAR";
}

/**
 * O ano digitado é um ano — a mesma régua que a rota aplica.
 *
 * Repetida aqui de propósito: sem ela o botão manda um `NaN` para o servidor e
 * a pessoa recebe de volta um 400 para descobrir o que já se sabia antes do
 * clique. A regra continua sendo do servidor; o que a tela evita é a viagem.
 */
export function anoAceito(texto: string): boolean {
  const ano = Number(texto.trim());
  return Number.isInteger(ano) && ano >= 2000 && ano <= 2100;
}

/**
 * Importações — a porta por onde entram os períodos que o fechamento fecha, e
 * onde eles se fecham.
 *
 * A tela é uma lista e um formulário, e o formulário é curto de propósito: uma
 * competência é (unidade, transportadora, quinzena), e nada mais. Tudo o que a
 * define depois — quanto vale, o que falta — vem dos arquivos que a Ambev
 * exporta, não de campo digitado.
 *
 * Abrir a mesma competência duas vezes devolve a que já existe, e o botão
 * simplesmente navega para ela. É o gesto de quem volta no dia seguinte, e
 * tratá-lo como erro ("esta competência já existe") ensinaria a pessoa a temer
 * um botão que não faz mal nenhum.
 *
 * **Por que o fechamento acontece aqui também.** Porque quem fecha não fecha
 * uma competência: fecha a quinzena inteira, CDD a CDD. Obrigar a entrar em
 * cada uma para clicar no mesmo botão do fim da página fazia perder a lista a
 * cada fechamento — e a lista é justamente o que diz quantas ainda faltam. O
 * ato é o mesmo painel da tela de dentro (`components/fechamento/fechar-quinzena`),
 * com o mesmo resumo antes do botão: o que muda é o caminho até ele, nunca o
 * que se vê antes de congelar um período.
 *
 * **Um painel aberto por vez.** Ao contrário de Apurações, onde abrir várias
 * contas serve para comparar CDDs, aqui o que se abre é um ato — e dois atos
 * abertos ao mesmo tempo convidam a fechar a quinzena errada.
 */
export default function Competencias() {
  const [, navegar] = useLocation();
  const cliente = useQueryClient();
  const hoje = new Date();

  const [ano, setAno] = useState(String(hoje.getFullYear()));
  const [mes, setMes] = useState(String(hoje.getMonth() + 1));
  const [quinzena, setQuinzena] = useState(hoje.getDate() <= 15 ? "1" : "2");
  const [unidade, setUnidade] = useState<Parte | null>(null);
  const [transportadora, setTransportadora] = useState<Parte | null>(null);
  /** A competência cujo painel de fechamento está aberto — uma, ou nenhuma. */
  const [fechando, setFechando] = useState<string | null>(null);

  /*
    A lista sustenta a tela inteira, e por isso é a que paga o preço de uma
    falha de transporte. Era ela que sumia atrás do aviso vermelho quando uma
    chamada não completava — inclusive quando a chamada seguinte teria
    respondido, e inclusive quando a lista em tela continuava correta.

    Os defaults globais (`App.tsx`) já lhe dão repetição só para falha
    transitória, 400/1200ms, foco desligado e reconexão ligada. O que só o hook
    entrega é o que muda o desenho: preservar a resposta anterior, distinguir
    "não respondeu" de "respondeu vazio", e oferecer a tentativa manual.
  */
  const competencias = useConsultaResiliente<Competencia[]>({
    queryKey: ["fechamento", "competencias"],
    endpoint: "/fechamento/competencias",
    buscar: listarCompetencias,
  });
  const partes = useQuery({ queryKey: ["fechamento", "partes"], queryFn: listarPartes });

  const abrir = useMutation({
    mutationFn: () =>
      abrirCompetencia({
        ano: Number(ano),
        mes: Number(mes),
        quinzena: Number(quinzena) as 1 | 2,
        unidade: { codigo: unidade!.codigo, nome: unidade!.nome ?? undefined },
        transportadora: {
          codigo: transportadora!.codigo,
          nome: transportadora!.nome ?? undefined,
        },
      }),
    onSuccess: (criada) => {
      void cliente.invalidateQueries({ queryKey: ["fechamento", "competencias"] });
      void cliente.invalidateQueries({ queryKey: ["fechamento", "partes"] });
      navegar(`/fechamento/competencias/${criada.id}`);
    },
  });

  const anoValido = anoAceito(ano);
  const podeAbrir = unidade !== null && transportadora !== null && anoValido;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <h1 className="text-2xl font-bold tracking-tight">Importações</h1>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          Cada competência é uma quinzena de um CDD com uma transportadora — o
          período que se apura, se confere e se fecha.
        </p>
      </header>

      <div className="p-8 space-y-6 max-w-4xl">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Abrir competência
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="ano">Ano</Label>
                <Input id="ano" value={ano} onChange={(e) => setAno(e.target.value)} inputMode="numeric" />
                {!anoValido && (
                  <p className="text-xs text-amber-700">O ano vai de 2000 a 2100.</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mes">Mês</Label>
                {/*
                  O mês é escolhido, e não digitado: ele tem doze valores e
                  nomes que todo mundo sabe de cor, e `7` num campo de texto é
                  uma pergunta a mais ("julho?") num formulário que existe para
                  não ter nenhuma. O valor continua sendo o número — é o que a
                  rota espera —, e só o rótulo é a palavra.
                */}
                <Select value={mes} onValueChange={setMes}>
                  <SelectTrigger id="mes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MES_LONGO.map((_, indice) => (
                      <SelectItem key={indice} value={String(indice + 1)}>
                        {mesPorExtenso(indice + 1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="quinzena">Quinzena</Label>
                <Select value={quinzena} onValueChange={setQuinzena}>
                  <SelectTrigger id="quinzena">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1ª — dias 1 a 15</SelectItem>
                    <SelectItem value="2">2ª — dia 16 ao fim do mês</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="unidade">Unidade (CDD)</Label>
                <ComboboxCriavel<Parte>
                  id="unidade"
                  itens={partes.data?.unidades ?? []}
                  valor={unidade}
                  aoEscolher={setUnidade}
                  aoCriar={(texto) => Promise.resolve(cadastrar(texto))}
                  rotuloDe={rotuloDaParte}
                  detalheDe={detalheDaParte}
                  chaveDe={(p) => p.codigo}
                  placeholder="Escolha ou digite o código e o nome"
                  rotuloDeCriacao={(texto) => `Usar “${texto}”`}
                  previaDe={previaDaParte}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="transportadora">Transportadora</Label>
                <ComboboxCriavel<Parte>
                  id="transportadora"
                  itens={partes.data?.transportadoras ?? []}
                  valor={transportadora}
                  aoEscolher={setTransportadora}
                  aoCriar={(texto) => Promise.resolve(cadastrar(texto))}
                  rotuloDe={rotuloDaParte}
                  detalheDe={detalheDaParte}
                  chaveDe={(p) => p.codigo}
                  placeholder="Escolha ou digite o código e o nome"
                  rotuloDeCriacao={(texto) => `Usar “${texto}”`}
                  previaDe={previaDaParte}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              As duas listas são as unidades e transportadoras que já apareceram
              em alguma competência — não há cadastro à parte. Para uma nova,
              digite <code className="font-mono">código — nome</code> (por
              exemplo <code className="font-mono">443 — CDD Belém</code>) e
              escolha “Usar”.
            </p>

            {abrir.isError && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(abrir.error)}</AlertDescription>
              </Alert>
            )}

            <Button onClick={() => abrir.mutate()} disabled={!podeAbrir || abrir.isPending}>
              {abrir.isPending ? "Abrindo…" : "Abrir competência"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            {/*
              "Competências", e não "Competências abertas": a lista sempre
              trouxe também as encerradas — a tarja de cada linha diz qual é
              qual —, e agora que se fecha daqui o título velho prometeria uma
              lista da qual o próprio ato tiraria a competência.
            */}
            <CardTitle className="text-base">Competências</CardTitle>
          </CardHeader>
          <CardContent>
            {competencias.carregando && (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            )}

            {/*
              O aviso vermelho só aparece quando não há lista nenhuma para
              mostrar — nunca houve resposta, e as tentativas automáticas já se
              esgotaram. Antes ele aparecia em qualquer falha, sobre uma lista
              que continuava em tela e continuava certa.
            */}
            {competencias.indisponivel && (
              <Alert variant="destructive">
                <AlertDescription>{textoDoErro(competencias.erro)}</AlertDescription>
              </Alert>
            )}

            {/*
              Com lista em tela, a falha é recado de rodapé: o que se vê é o que
              o servidor mandou, e só a hora mudou. Dizer a hora é o que torna
              isto honesto — "de 14h02" é verificável, "pode estar
              desatualizado" é desculpa.
            */}
            {competencias.avisarSobreDadoGuardado && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-amber-200 bg-amber-50/70 px-4 py-2 text-sm text-amber-900">
                <WifiOff className="w-4 h-4 shrink-0" />
                <span>
                  A atualização da lista não completou. O que está em tela é de{" "}
                  {new Date(competencias.respondidoEm ?? 0).toLocaleTimeString(
                    "pt-BR",
                    { hour: "2-digit", minute: "2-digit" },
                  )}
                  , e continua válido.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={competencias.atualizando}
                  onClick={competencias.tentarDeNovo}
                >
                  {competencias.atualizando ? "Tentando…" : "Tentar de novo"}
                </Button>
              </div>
            )}

            {/*
              "Nenhuma ainda" é uma afirmação sobre a base, e só pode ser feita
              depois de o servidor ter respondido. `houveResposta` é a
              autoridade: `dados?.length === 0` também é verdade quando não
              houve resposta alguma, e era assim que a tela chegava a prometer
              "nenhuma competência" a respeito de uma pergunta que ninguém
              conseguiu fazer.
            */}
            {competencias.houveResposta && competencias.dados?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhuma ainda. Abra a primeira acima e envie os cinco relatórios da quinzena.
              </p>
            )}
            {(competencias.dados?.length ?? 0) > 0 && (
              <p className="text-sm text-muted-foreground mb-3">
                A linha abre a competência — relatórios, dias e a conta. A que já
                apurou fecha aqui mesmo; a que já fechou reabre com motivo.
              </p>
            )}
            <ul className="divide-y">
              {competencias.dados?.map((c) => {
                const acao = acaoDoFechamento(c.estado);
                const painelAberto = fechando === c.id;
                return (
                  <li key={c.id}>
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/fechamento/competencias/${c.id}`}
                        className="flex min-w-0 flex-1 items-center justify-between gap-4 py-3 hover:bg-muted/50 -mx-2 px-2 rounded"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-medium">
                            <CalendarDays className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span>
                              {c.inicio.split("-").reverse().join("/")} a {c.fim.split("-").reverse().join("/")}
                            </span>
                            <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wide text-muted-foreground">
                              {NOME_DO_ESTADO[c.estado]}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {c.unidade.nome ?? c.unidade.codigo} · {c.transportadora.nome ?? c.transportadora.codigo}
                          </p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                      </Link>
                      {/*
                        Largura fixa para a coluna da ação: sem ela, "Fechar a
                        quinzena", "Reabrir" e "apure para fechar" empurram a
                        seta de cada linha para um x diferente, e a lista perde
                        a margem direita que a faz ser lida de cima a baixo.
                      */}
                      <div className="flex w-44 shrink-0 justify-end">
                        <AcaoDaLinha
                          acao={acao}
                          aberto={painelAberto}
                          aoAlternar={() => setFechando(painelAberto ? null : c.id)}
                        />
                      </div>
                    </div>
                    {painelAberto && (
                      <div className="mb-3 rounded-md border bg-muted/20 px-4 py-4">
                        <FechamentoDaLinha competenciaId={c.id} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

/**
 * O que a linha oferece à direita: fechar, reabrir, ou o motivo de nenhum dos dois.
 *
 * O botão alterna o painel em vez de agir no clique. Encerrar é o ato que faz o
 * banco recusar escrita na competência, e um clique de lista não pode
 * desencadeá-lo sem antes mostrar o que está sendo congelado — é a mesma regra
 * da tela de dentro, e ela não afrouxa por estarmos numa lista.
 */
function AcaoDaLinha({
  acao,
  aberto,
  aoAlternar,
}: {
  acao: AcaoDoFechamento;
  aberto: boolean;
  aoAlternar: () => void;
}) {
  if (acao === "APURAR") {
    /*
      Sem apuração vigente o servidor recusa encerrar, e com razão: congelaria
      um período que não sabe quanto vale. A frase diz o que falta em vez de um
      botão cinza que não explica nada — e o caminho para apurar é a própria
      linha, que abre a competência.
    */
    return (
      <span className="shrink-0 text-xs text-muted-foreground whitespace-nowrap">
        apure para fechar
      </span>
    );
  }

  return (
    <Button
      variant={aberto ? "secondary" : "outline"}
      size="sm"
      className="shrink-0"
      aria-expanded={aberto}
      onClick={aoAlternar}
    >
      {acao === "FECHAR" ? (
        <>
          <Lock className="w-3.5 h-3.5 mr-1.5" />
          Fechar a quinzena
        </>
      ) : (
        <>
          <LockOpen className="w-3.5 h-3.5 mr-1.5" />
          Reabrir
        </>
      )}
    </Button>
  );
}

/**
 * O painel de fechamento de uma linha — buscado quando ela abre.
 *
 * A competência inteira é buscada aqui, e não junto da lista, pelo mesmo motivo
 * de `ContaDaLinha` em Apurações: a lista é o índice de dezenas de quinzenas, e
 * o resumo de cada uma traz documentos e apuração. Baixar todas para mostrar uma
 * seria pagar o fechamento inteiro para ler uma linha.
 *
 * A chave é a mesma da tela da competência (`["fechamento", "competencia", id]`)
 * de propósito: quem fecha daqui e entra logo depois não espera de novo, e o
 * painel — que invalida essa chave ao fechar — atualiza as duas telas com uma
 * consulta só.
 */
function FechamentoDaLinha({ competenciaId }: { competenciaId: string }) {
  const dados = useQuery({
    queryKey: ["fechamento", "competencia", competenciaId],
    queryFn: () => lerCompetencia(competenciaId),
  });
  const fontes = useQuery({ queryKey: ["fechamento", "fontes"], queryFn: listarFontes });

  if (dados.isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando a competência…</p>;
  }
  if (dados.isError || !dados.data) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{textoDoErro(dados.error)}</AlertDescription>
      </Alert>
    );
  }

  const { competencia, documentos, apuracao } = dados.data;
  if (!apuracao) {
    /*
      A lista só oferece o botão a quem está apurada ou encerrada, então chegar
      aqui sem apuração é a lista tendo lido um estado que o banco já mudou —
      alguém reabriu e reapurou noutra aba. Dizer isso é melhor do que um painel
      vazio ou um botão que o servidor vai recusar.
    */
    return (
      <p className="text-sm text-muted-foreground">
        Esta competência não tem apuração vigente — apure-a antes de fechar. Abra
        a competência para rodar a conta.
      </p>
    );
  }

  return (
    <FecharQuinzena
      competencia={competencia}
      documentos={documentos}
      apuracao={apuracao}
      fontes={fontes.data ?? []}
    />
  );
}
