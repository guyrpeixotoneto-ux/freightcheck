import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, ScrollText } from "lucide-react";
import { BotaoDeCadastroDaPlanilha } from "@/components/remuneracao/painel-de-cadastro";
import { BotaoDeRegistroDeUnidade } from "@/components/remuneracao/registrar-unidade";
import { Layout } from "@/components/layout/layout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Numero } from "@/components/remuneracao/comuns";
import { apresentar } from "@/lib/apresentar-erro";
import {
  ESTADO_DO_CADASTRO,
  lerSituacaoDasUnidades,
  type EstadoDoCadastro,
  type SituacaoDaUnidade,
} from "@/lib/remuneracao";

/**
 * Remuneração — as unidades, antes do cadastro de uma delas.
 *
 * **Por que esta tela vem antes.** A do cadastro responde "quais são os
 * parâmetros desta unidade", e é a resposta certa para quem já sabe qual
 * unidade quer olhar. Quem abre Remuneração na virada da quinzena não sabe: a
 * pergunta é *onde está o trabalho* — quais CDDs já têm o cadastro de pé e
 * quais ainda não têm. Sem esta lista, descobrir que um deles entregou a frota
 * e não entregou os trechos custa abri-lo, e com trinta unidades custa abrir
 * trinta telas para achar as duas que faltam. É o mesmo papel que Apurações
 * cumpre para as competências, e que a lista de alterações cumpre na Auditoria.
 *
 * **O destaque é sobre as duas metades do cadastro, e não sobre um
 * percentual.** Hoje, sobre um acervo completo, onze das trinta linhas têm
 * lastro — as outras dezenove dependem de decisões de negócio que ninguém
 * registrou, e não de arquivo que alguém deixou de mandar. "37% cadastrado"
 * seria lido como "falta importar alguma coisa" justamente na unidade que
 * entregou tudo o que tinha para entregar. O que de fato separa uma unidade da
 * outra são as duas metades que dependem do que ela mandou: a **frota**, que
 * vem do export de equipamento, e as **alíquotas**, que vêm do de frete. Ver
 * `lib/remuneracao/src/situacao.ts`.
 *
 * **A situação é sempre da vigência mais recente da unidade**, e a tela escreve
 * qual é em cada linha. Uma lista que respondesse por uma quinzena fixa faria a
 * unidade que parou de entregar em junho parecer em dia; uma que respondesse
 * sem dizer por qual quinzena responde seria pior ainda.
 */

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return (
    aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível carregar as unidades."
  );
}

/**
 * Verde para as duas metades, âmbar para uma, vermelho para nenhuma.
 *
 * Vermelho não é repreensão à unidade: é a cor do que trava o fechamento dela.
 * Uma unidade sem nenhuma linha com lastro não tem cadastro para a apuração
 * puxar, e é a única das quatro situações em que não há o que conferir.
 */
const APARENCIA_DO_ESTADO: Record<EstadoDoCadastro, BadgeProps["variant"]> = {
  FROTA_E_ALIQUOTAS: "success",
  SO_FROTA: "warning",
  SO_ALIQUOTAS: "warning",
  SEM_LASTRO: "destructive",
};

/**
 * "62 cavalos", com espaço **inquebrável** entre o número e o nome.
 *
 * A coluna é estreita e a frase ao lado é longa; com espaço comum o navegador
 * quebra em "62" e "cavalos" em linhas diferentes, e a coluna passa a ser lida
 * como duas informações. As frases maiores continuam quebrando nos outros
 * espaços, que é onde a quebra não atrapalha.
 */
const contar = (n: number, singular: string, plural: string) =>
  `${n.toLocaleString("pt-BR")}\u00A0${n === 1 ? singular : plural}`;

/**
 * O que a coluna da frota diz, e por que ela não diz só "sim" ou "não".
 *
 * As três formas de não ter frota contada são trabalhos diferentes: não veio
 * export de equipamento, veio e não trouxe a coluna que separa ativo de parado,
 * ou veio tudo e está contada. Um traço no lugar das três mandaria conferir a
 * importação nos três casos, e no do meio a importação está lá.
 */
function fraseDaFrota(u: SituacaoDaUnidade): string {
  if (u.cadastro.frota) return contar(u.material.cavalos, "cavalo", "cavalos");
  if (u.material.cavalos === 0) return "não entregou cavalos";
  return `${contar(u.material.cavalos, "cavalo", "cavalos")}, sem a coluna que separa ativo de parado`;
}

/** O mesmo, do lado dos trechos — de onde saem alíquotas, proporções e resumo. */
function fraseDosTrechos(u: SituacaoDaUnidade): string {
  if (u.cadastro.aliquotas) return contar(u.material.trechos, "trecho", "trechos");
  if (!u.material.trechosEntregues) return "não entregou a série de trechos";
  if (u.material.trechos === 0) return "entregou a série de trechos vazia";
  return `${contar(u.material.trechos, "trecho", "trechos")}, sem as colunas em reais`;
}

/**
 * O endereço do cadastro daquela unidade.
 *
 * O canal vai sempre, mesmo vazio — a mesma razão de `irParaUnidade` na tela do
 * cadastro: uma unidade pode ter uma série com canal e outra sem, no mesmo
 * `scopeHash`, e omitir o parâmetro pediria "qualquer canal", abrindo uma série
 * que ninguém escolheu aqui.
 */
function enderecoDaUnidade(u: SituacaoDaUnidade): string {
  const query = new URLSearchParams({ scopeHash: u.scopeHash, canal: u.channel ?? "" });
  return `/fechamento/remuneracao/unidade?${query}`;
}

export default function RemuneracaoUnidades() {
  const busca = useSearch();
  const [, navegar] = useLocation();

  /*
    O endereço antigo do cadastro era este, com a unidade na query. Quem tiver
    um link desses guardado — num chamado, numa conversa — cai aqui, e a tela
    o encaminha para onde o cadastro passou a morar em vez de ignorar o que ele
    pedia. Sem `scopeHash` não há para onde encaminhar, e a lista é a resposta.

    `replace` para que voltar no histórico saia do cadastro em vez de bater no
    endereço antigo e ser encaminhado de novo.
  */
  const encaminhando = new URLSearchParams(busca).get("scopeHash") !== null;
  useEffect(() => {
    if (encaminhando) navegar(`/fechamento/remuneracao/unidade?${busca}`, { replace: true });
  }, [encaminhando, busca, navegar]);

  /*
    Enquanto encaminha, a lista não é pedida: montar o cadastro de todas as
    unidades é o trabalho mais caro deste módulo, e pagá-lo por uma tela que
    some no quadro seguinte seria pagá-lo à toa.
  */
  const situacao = useQuery({
    queryKey: ["remuneracao", "situacao"],
    queryFn: lerSituacaoDasUnidades,
    enabled: !encaminhando,
  });

  const unidades = situacao.data?.unidades ?? [];
  const resumo = situacao.data?.resumo;
  /*
    Contada aqui, e não somada no servidor como os quatro estados, porque não é
    um estado do cadastro: é a **procedência da unidade**, e ela já vem marcada
    linha a linha. Um quinto número no resumo do servidor a colocaria ao lado
    de quatro que se somam entre si e este não soma com nenhum.
  */
  const registradas = unidades.filter((u) => u.registradaAMao).length;

  /*
    Os tipos de operação que já existem em alguma unidade — o que o seletor do
    painel oferece antes de deixar digitar um novo.

    Sai da própria lista e não de uma constante, pela mesma razão que
    `parseVigenciaLabel` aceita qualquer canal em vez de `^EMPURRADA_`: o
    vocabulário é da operação do cliente, não nosso. Uma lista fixa com
    EMPURRADA e ROTA acertaria hoje e estaria errada no dia em que um terceiro
    aparecesse — e o campo continua aceitando digitar, que é o que faz o
    terceiro poder aparecer.
  */
  const canaisConhecidos = [
    ...new Set(unidades.map((u) => u.channel).filter((c): c is string => c !== null && c !== "")),
  ];

  /*
    Sem tela nenhuma no quadro do encaminhamento. Com a consulta desligada,
    desenhar a lista aqui mostraria "nenhuma unidade entregou vigência ainda"
    por um instante — a frase certa para o acervo vazio, e falsa para quem só
    clicou num link antigo.
  */
  if (encaminhando) return null;

  return (
    <Layout>
      <header className="border-b bg-card px-8 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-nav-fechamento" />
            <h1 className="text-2xl font-bold tracking-tight">Remuneração</h1>
          </div>
          {/*
            O botão fica no cabeçalho, e não no fim da lista: quem precisa dele
            é justamente quem não achou a unidade na lista, e procurar embaixo
            de trinta linhas o que fazer quando a sua não está entre elas é a
            forma de não achar.
          */}
          <BotaoDeRegistroDeUnidade />
        </div>
        <p className="text-muted-foreground mt-2 max-w-3xl">
          As unidades que o cadastro da planilha de remuneração conhece, e o que ele alcança
          em cada uma hoje. Abrir uma linha é abrir o cadastro dela — alíquotas, frota,
          parcelas por veículo e proporção de documentos. O que o acervo ainda não responde,
          alguém digita da aba de Excel: é o botão <strong>Cadastrar planilha</strong>, e ele
          abre o formulário aqui mesmo. A unidade cuja aba chegou antes do export não precisa
          esperar por ele — <strong>Cadastrar unidade</strong> a põe na lista, sem lastro e
          dizendo que está sem.
        </p>
      </header>

      {/*
        Sem largura máxima, ao contrário da tela do cadastro: lá são três
        colunas de número que se leem melhor juntas, aqui é uma lista de
        unidades com uma frase por metade, e espremê-la em seis colunas quebra
        "62 cavalos" em duas linhas. É a mesma largura de `pages/unidades.tsx`,
        que é a outra lista de unidades do produto.
      */}
      <div className="p-8 space-y-6">
        {situacao.isError && (
          <Alert variant="destructive">
            <AlertDescription>{textoDoErro(situacao.error)}</AlertDescription>
          </Alert>
        )}

        {resumo && resumo.unidades > 0 && (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <Numero titulo="Frota e alíquotas" valor={resumo.frotaEAliquotas} destaque />
                <Numero titulo="Só a frota" valor={resumo.soFrota} />
                <Numero titulo="Só as alíquotas" valor={resumo.soAliquotas} />
                <Numero titulo="Sem lastro" valor={resumo.semLastro} alerta />
              </div>
              <p className="text-xs text-muted-foreground border-t pt-3">
                {contar(resumo.unidades, "unidade", "unidades")} nesta lista
                {registradas > 0 && (
                  <>
                    {" "}—{" "}
                    {contar(
                      registradas,
                      "delas foi cadastrada à mão e ainda não tem export",
                      "delas foram cadastradas à mão e ainda não têm export",
                    )}
                  </>
                )}
                . Cada uma respondida pela <strong>vigência mais recente que ela tem</strong>,
                que está escrita na linha: uma lista presa a uma quinzena fixa faria a unidade
                que parou de entregar parecer em dia.
              </p>
              {/*
                A cadência da planilha é a mesma da vigência, e dizê-lo aqui
                evita a leitura errada que a coluna sozinha convida: quem
                preencheu a 1ª quinzena e voltar no dia 16 vai ver "nada
                informado" — não porque o que digitou sumiu, mas porque a linha
                passou a responder pela quinzena seguinte, que ainda está em
                branco. Sem esta frase, a conclusão natural é que o cadastro se
                perdeu.
              */}
              <p className="text-xs text-muted-foreground">
                A <strong>planilha informada</strong> segue a mesma quinzena: a coluna conta o
                que foi digitado para a vigência escrita na linha, e a quinzena seguinte começa
                em branco sem apagar a anterior. Dentro do formulário há{" "}
                <em>copiar de outra vigência</em>, para partir da quinzena passada e corrigir
                só o que mudou.
              </p>
              {/*
                Sem lastro é o único dos quatro estados em que o acervo não
                responde **nada**, e por isso é o único que ganha frase própria:
                nele a planilha informada não é complemento, é a única forma de o
                cadastro ter número. Sem esta linha a tela responde "sem lastro"
                e cala a saída que existe — que foi o que aconteceu no primeiro
                uso.
              */}
              {resumo.semLastro > 0 && (
                <p className="text-xs text-muted-foreground">
                  {resumo.semLastro === 1
                    ? "A unidade sem lastro não tem número nenhum vindo do acervo"
                    : `As ${resumo.semLastro} unidades sem lastro não têm número nenhum vindo do acervo`}
                  : enquanto o export não chega, o cadastro delas só ganha número pela{" "}
                  <strong>planilha informada</strong> — o botão da direita abre o formulário, e
                  o que entrar por lá fica marcado como informado, com autor e data.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="p-0">
            {situacao.isLoading && (
              <p className="p-6 text-sm text-muted-foreground">Montando os cadastros…</p>
            )}

            {!situacao.isLoading && !situacao.isError && unidades.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">
                Nenhuma unidade ainda. Há dois caminhos, e eles não se substituem: a primeira
                planilha enviada em{" "}
                <Link href="/importacoes" className="text-primary hover:underline">
                  Importações
                </Link>{" "}
                traz a unidade com o que o acervo mede, e <strong>Cadastrar unidade</strong>,
                aqui em cima, põe na lista aquela cuja aba de Excel já chegou e cujo export
                ainda não — sem lastro, e dizendo que está sem.
              </p>
            )}

            {unidades.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                      <th className="text-left px-4 py-2 font-medium">Unidade</th>
                      <th className="text-left px-4 py-2 font-medium">Cadastro</th>
                      <th className="text-left px-4 py-2 font-medium">Frota</th>
                      <th className="text-left px-4 py-2 font-medium">Trechos</th>
                      <th className="text-right px-4 py-2 font-medium">Linhas com lastro</th>
                      <th className="text-right px-4 py-2 font-medium">Planilha informada</th>
                      <th className="text-left px-4 py-2 font-medium">Vigência mais recente</th>
                      <th className="text-right px-4 py-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {unidades.map((u) => (
                      <tr
                        key={`${u.scopeHash}|${u.channel ?? ""}`}
                        className="border-b last:border-0 hover:bg-muted/40 align-top"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={enderecoDaUnidade(u)}
                            className="font-semibold hover:underline"
                          >
                            {u.label}
                          </Link>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {u.registradaAMao
                              ? contar(u.vigencias, "vigência cadastrada", "vigências cadastradas")
                              : contar(u.vigencias, "vigência no acervo", "vigências no acervo")}
                          </p>
                          {/*
                            A marca é da unidade, e não do cadastro: o estado ao
                            lado já diz que não há lastro, e "sem lastro" numa
                            unidade importada quer dizer "o arquivo veio e não
                            trouxe o que o cadastro lê" — coisa muito diferente
                            de "arquivo nenhum veio". Sem esta linha as duas
                            situações ficam com a mesma cara, e a primeira manda
                            procurar um export que ninguém deixou de mandar.
                          */}
                          {u.registradaAMao && (
                            <p className="text-[0.6875rem] text-muted-foreground/80 mt-0.5">
                              cadastrada à mão — sem export importado
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={APARENCIA_DO_ESTADO[u.cadastro.estado]}
                            title={ESTADO_DO_CADASTRO[u.cadastro.estado].frase}
                            className="whitespace-nowrap"
                          >
                            {ESTADO_DO_CADASTRO[u.cadastro.estado].rotulo}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <MetadeDoCadastro tem={u.cadastro.frota} frase={fraseDaFrota(u)} />
                        </td>
                        <td className="px-4 py-3">
                          <MetadeDoCadastro
                            tem={u.cadastro.aliquotas}
                            frase={fraseDosTrechos(u)}
                          />
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                          {u.cadastro.comLastro} de {u.cadastro.linhas}
                        </td>
                        {/*
                          A planilha informada é coluna própria, e nunca somada
                          à de lastro: as duas respondem perguntas opostas — uma
                          diz o que a unidade **entregou**, a outra o que alguém
                          **digitou**. Somadas, a unidade que não mandou arquivo
                          nenhum e teve a aba transcrita apareceria em dia, e
                          quem opera pararia de procurar o arquivo que falta.
                        */}
                        {/*
                          A célula é o **lugar de preencher**, e não só a
                          contagem.

                          Sem o botão, esta coluna dizia "nada informado" e não
                          oferecia nada a quem lesse isso: o formulário existia
                          numa aba dentro do cadastro da unidade, a um clique de
                          distância e sem nada que o anunciasse daqui. Numa
                          unidade sem lastro nenhum — que é o caso em que a
                          planilha informada é a **única** forma de o cadastro
                          ter número — a lista mandava procurar um arquivo e
                          calava a saída que existe.
                        */}
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex flex-col items-end gap-1">
                            {u.cadastro.informadas > 0 && (
                              <>
                                <span className="tabular-nums">
                                  {u.cadastro.informadas} de {u.cadastro.linhas}
                                </span>
                                {u.cadastro.divergentes > 0 ? (
                                  <Badge variant="destructive" className="text-[0.6875rem]">
                                    {u.cadastro.divergentes}{" "}
                                    {u.cadastro.divergentes === 1
                                      ? "diverge do acervo"
                                      : "divergem do acervo"}
                                  </Badge>
                                ) : (
                                  u.cadastro.conferidas > 0 && (
                                    <span className="text-[0.6875rem] text-muted-foreground">
                                      {u.cadastro.conferidas}{" "}
                                      {u.cadastro.conferidas === 1
                                        ? "confere com o acervo"
                                        : "conferem com o acervo"}
                                    </span>
                                  )
                                )}
                              </>
                            )}
                            <BotaoDeCadastroDaPlanilha
                              unidade={u}
                              canaisConhecidos={canaisConhecidos}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">{u.periodLabel}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={enderecoDaUnidade(u)}
                            className="text-xs text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                          >
                            abrir cadastro
                            <ArrowRight className="w-3 h-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {unidades.length > 0 && <Legenda />}
      </div>
    </Layout>
  );
}

/**
 * Uma das duas metades: a marca, e o que o acervo entregou por extenso.
 *
 * A marca repete a cor do estado e a frase diz o que aconteceu — porque "não"
 * tem três formas aqui, e as três pedem trabalhos diferentes de quem for
 * resolver.
 */
function MetadeDoCadastro({ tem, frase }: { tem: boolean; frase: string }) {
  return (
    <span className="flex items-start gap-2">
      <span
        aria-hidden
        className={`w-2 h-2 rounded-sm shrink-0 mt-1.5 ${
          tem ? "bg-emerald-500" : "bg-muted-foreground/30"
        }`}
      />
      <span className={tem ? "" : "text-muted-foreground"}>{frase}</span>
    </span>
  );
}

/**
 * O que cada estado quer dizer, por extenso e uma vez só.
 *
 * A marca da tabela é curta porque a coluna é estreita; a frase que a sustenta
 * mora aqui, do mesmo jeito que a legenda azul/cinza da planilha mora no rodapé
 * do cadastro em vez de repetida em trinta linhas.
 */
function Legenda() {
  const estados: EstadoDoCadastro[] = [
    "FROTA_E_ALIQUOTAS",
    "SO_FROTA",
    "SO_ALIQUOTAS",
    "SEM_LASTRO",
  ];

  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          O que cada situação diz
        </p>
        <dl className="space-y-2">
          {estados.map((estado) => (
            <div key={estado} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-3">
              <dt className="shrink-0 sm:w-40">
                <Badge variant={APARENCIA_DO_ESTADO[estado]} className="whitespace-nowrap">
                  {ESTADO_DO_CADASTRO[estado].rotulo}
                </Badge>
              </dt>
              <dd className="text-xs text-muted-foreground">
                {ESTADO_DO_CADASTRO[estado].frase}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground border-t pt-3">
          <strong>Linhas com lastro</strong> conta as trinta linhas da aba, e não as duas
          metades: dezenove delas dependem de decisões de negócio que ainda não foram
          registradas, e não de arquivo que alguém deixou de mandar — abrir o cadastro de uma
          unidade diz, linha a linha, qual é o caso de cada uma.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>Planilha informada</strong> conta o outro lado: as linhas que alguém digitou
          da aba de Excel, dentro do cadastro da unidade. Ela não entra em "linhas com lastro"
          — número digitado é lastro da planilha, não do acervo — e é justamente por ficarem
          separadas que a coluna consegue dizer quantas linhas os dois respondem e em quantas
          eles discordam. Os quatro estados acima continuam falando só do que a unidade
          entregou.
        </p>
      </CardContent>
    </Card>
  );
}
