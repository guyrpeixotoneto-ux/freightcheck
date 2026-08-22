import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { PencilLine, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apresentar } from "@/lib/apresentar-erro";
import { anoAceito } from "@/lib/fechamento-tela";
import { MES_LONGO, mesPorExtenso, periodoDaQuinzena } from "@/lib/fechamento-gerencial";
import { cn } from "@/lib/utils";
import {
  chaveDoCadastro,
  lerCadastro,
  nomeDaUnidade,
  type SituacaoDaUnidade,
} from "@/lib/remuneracao";
import { CadastrarAPlanilha } from "./cadastrar-planilha";

/**
 * O CADASTRO DA PLANILHA SEM SAIR DA LISTA — o botão e o painel que ele abre.
 *
 * A tela de Remuneração é uma lista de unidades, e o formulário morava a um
 * clique dela, numa aba dentro do cadastro de cada unidade. No primeiro uso a
 * consequência apareceu inteira: a coluna dizia "nada informado", quem lia isso
 * não tinha o que clicar, e a unidade em questão estava **sem lastro nenhum** —
 * o caso em que a planilha informada não é complemento, é a única forma de o
 * cadastro ter número. A lista mandava procurar um arquivo e calava a saída que
 * existia.
 *
 * Aqui o botão está na linha e o formulário abre por cima da lista. A aba
 * dentro do cadastro continua existindo, e continua sendo o lugar de quem vai
 * passar meia hora conferindo: ela tem endereço próprio, o histórico do
 * navegador funciona, e as outras duas vistas ficam ao lado. O painel é para o
 * outro gesto — abrir, digitar o que a aba de Excel diz, fechar.
 *
 * **As duas escolhas que o painel faz antes do formulário.**
 *
 * *O canal* — `EMPURRADA`, `ROTA` — porque a planilha é de um deles, e não da
 * unidade inteira. A lista oferece os canais que já existem (no acervo ou em
 * alguma planilha) e deixa digitar um novo, que é o mesmo gesto do campo de
 * unidade em Realizar Fechamento: o vocabulário é da operação, e um select
 * fechado obrigaria o cadastro a estar completo antes de alguém precisar dele.
 * O canal digitado passa a existir assim que a primeira célula é salva.
 *
 * *A vigência*, porque a planilha é de uma quinzena. As oferecidas são as que a
 * unidade tem — o que o acervo entregou mais o que alguém já digitou —,
 * inclusive para um canal que ela ainda não entregou, e é a resposta certa: a
 * quinzena é do calendário do cliente, não da série. **E dá para começar uma
 * que ainda não existe**, pelos mesmos três campos de "Cadastrar uma unidade":
 * ano, mês e quinzena.
 *
 * Sem isso a unidade cadastrada à mão ficava presa: as vigências dela são a
 * declarada no registro mais as que ganharam planilha, o seletor só oferecia
 * essas, e salvar numa quinzena nova era recusado — a promessa escrita no
 * "Cadastrar unidade" ("as outras aparecem à medida que você salvar planilha
 * nelas") não tinha por onde ser cumprida. A quinzena nova segue a mesma regra
 * do canal novo: ela é um rascunho até a primeira célula ser salva, e passa a
 * existir com ela.
 */
export function BotaoDeCadastroDaPlanilha({
  unidade,
  canaisConhecidos,
  vigenciaInicial,
  vigenciaNova = false,
}: {
  unidade: SituacaoDaUnidade;
  /** Os canais que existem em qualquer unidade — o que o seletor oferece. */
  canaisConhecidos: string[];
  /**
   * A quinzena em que o painel abre, quando não é a da linha que o chamou.
   *
   * Quem passa é a lista de Remuneração, na **quinzena vazia**: a metade do mês
   * que nenhuma vigência ocupa não tem `SituacaoDaUnidade` própria — ela é uma
   * casa do calendário, e não um cadastro —, e o botão dela chega com a unidade
   * da metade irmã. Sem esta data o painel abriria na quinzena da irmã, que é a
   * que já está preenchida: quem clicou em "cadastrar" na segunda quinzena
   * digitaria por cima da primeira.
   */
  vigenciaInicial?: string;
  /**
   * Essa quinzena ainda não existe — o painel a cria quando a primeira célula
   * for salva, pela mesma porta de "outra quinzena…".
   *
   * Vem de quem sabe: a lista desenha a quinzena vazia justamente porque não há
   * vigência nela. Deduzir aqui, comparando com as vigências que a consulta
   * devolve, daria falso logo depois do primeiro salvamento — o servidor passa
   * a incluí-la na lista — e a bandeira precisa continuar valendo pela sessão
   * inteira do painel.
   */
  vigenciaNova?: boolean;
}) {
  const [aberto, setAberto] = useState(false);

  /* A quinzena que ainda não existe não tem linha informada nenhuma: o rótulo é
     sempre o de começar, e não o de editar. */
  const nadaInformado = vigenciaNova || unidade.cadastro.informadas === 0;

  return (
    <>
      <Button
        size="sm"
        variant={nadaInformado ? "outline" : "ghost"}
        onClick={() => setAberto(true)}
        className="whitespace-nowrap"
      >
        <PencilLine className="w-3.5 h-3.5 mr-1.5" />
        {nadaInformado ? "Cadastrar planilha" : "Editar planilha"}
      </Button>

      {aberto && (
        <PainelDeCadastro
          unidade={unidade}
          canaisConhecidos={canaisConhecidos}
          vigenciaInicial={vigenciaInicial}
          vigenciaNova={vigenciaNova}
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}

const SEM_CANAL = "__sem_canal__";
const OUTRO = "__outro__";
const OUTRA_QUINZENA = "__outra_quinzena__";

/**
 * A quinzena seguinte à última que a unidade tem — o padrão dos três campos.
 *
 * Quem abre "outra quinzena…" está quase sempre começando **a próxima**: a aba
 * de setembro chegou, agosto já está preenchido. Abrir no mês corrente daria
 * certo em metade das vezes e obrigaria a corrigir dois seletores na outra
 * metade; abrir na seguinte à última acerta o gesto que trouxe a pessoa aqui, e
 * quem quiser outra troca os campos do mesmo jeito.
 *
 * Sem vigência nenhuma — o que não acontece hoje, porque toda unidade tem ao
 * menos a declarada no registro —, o padrão é a quinzena de hoje.
 */
function quinzenaSeguinte(vigencias: readonly { effectiveDate: string }[]) {
  const ultima = vigencias[vigencias.length - 1]?.effectiveDate;
  if (!ultima || !/^\d{4}-\d{2}-\d{2}$/.test(ultima)) {
    const hoje = new Date();
    return {
      ano: String(hoje.getFullYear()),
      mes: String(hoje.getMonth() + 1),
      quinzena: hoje.getDate() <= 15 ? "1" : "2",
    };
  }

  const ano = Number(ultima.slice(0, 4));
  const mes = Number(ultima.slice(5, 7));
  /* A régua da quinzena é a do produto: do dia 1 ao 15 é a primeira. */
  if (Number(ultima.slice(8, 10)) <= 15) {
    return { ano: String(ano), mes: String(mes), quinzena: "2" };
  }
  return mes === 12
    ? { ano: String(ano + 1), mes: "1", quinzena: "1" }
    : { ano: String(ano), mes: String(mes + 1), quinzena: "1" };
}

function PainelDeCadastro({
  unidade,
  canaisConhecidos,
  vigenciaInicial,
  vigenciaNova: nasceNova = false,
  aoFechar,
}: {
  unidade: SituacaoDaUnidade;
  canaisConhecidos: string[];
  vigenciaInicial?: string;
  vigenciaNova?: boolean;
  aoFechar: () => void;
}) {
  const abreEm = vigenciaInicial ?? unidade.effectiveDate;
  const [canal, setCanal] = useState<string | null>(unidade.channel);
  const [digitando, setDigitando] = useState(false);
  const [rascunhoDoCanal, setRascunhoDoCanal] = useState("");
  const [vigencia, setVigencia] = useState(abreEm);
  /*
    A quinzena que **esta sessão do painel criou**, e não uma conta sobre a
    resposta do servidor. A diferença decide o salvar: pedido o cadastro com
    `vigenciaNova`, o servidor devolve a quinzena dentro da lista de vigências
    — é o que faz o seletor mostrá-la e o rótulo dela nomear a irmã do mesmo mês
    —, e uma bandeira deduzida dessa lista viraria falsa na volta da consulta,
    justamente antes do clique em salvar, que é quando ela precisa ser
    verdadeira.

    Ela nasce preenchida quando o painel foi aberto **por** uma quinzena que
    não existe — a casa vazia do calendário, na lista de Remuneração. É a mesma
    afirmação de quem clicou em "outra quinzena…", feita um passo antes: a
    diferença é só quem escolheu a data, e não o que ela quer dizer.
  */
  const [criada, setCriada] = useState<string | null>(nasceNova ? abreEm : null);
  const [escolhendoQuinzena, setEscolhendoQuinzena] = useState(false);
  const [ano, setAno] = useState("");
  const [mes, setMes] = useState("");
  const [quinzenaDoMes, setQuinzenaDoMes] = useState("");

  /*
    Esc fecha. O painel cobre a tela inteira e o formulário dentro dele é longo;
    sem tecla, a única saída é rolar até achar o X. O `Dialog` compartilhado não
    tem isso e não vou mudá-lo aqui — as outras cinco telas que o usam são
    caixas curtas, onde a falta não pesa do mesmo jeito.
  */
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const vigenciaNova = criada !== null && criada === vigencia;

  const cadastro = useQuery({
    queryKey: chaveDoCadastro(unidade.scopeHash, canal, vigencia),
    queryFn: () =>
      lerCadastro({
        scopeHash: unidade.scopeHash,
        canal,
        period: vigencia,
        /*
          O canal pode ser um que ninguém entregou ainda — é justamente para ele
          que este painel existe. Sem esta bandeira o servidor responderia 404 e
          o formulário nunca apareceria para ser preenchido.
        */
        canalNovo: true,
        /* E a quinzena também pode ser nova, pela mesma razão e com a mesma
           régua: o servidor só aceita começo de quinzena. */
        ...(vigenciaNova ? { vigenciaNova: true } : {}),
      }),
  });

  const opcoes = [...new Set([...canaisConhecidos, ...(unidade.channel ? [unidade.channel] : [])])]
    .filter((c) => c !== "")
    .sort();

  function escolher(valor: string) {
    if (valor === OUTRO) {
      setDigitando(true);
      setRascunhoDoCanal("");
      return;
    }
    setDigitando(false);
    setCanal(valor === SEM_CANAL ? null : valor);
  }

  /** O canal digitado, normalizado como o acervo o escreve: em caixa alta. */
  function usarODigitado() {
    const texto = rascunhoDoCanal.trim().toUpperCase();
    if (texto === "") return;
    setCanal(texto);
    setDigitando(false);
  }

  /** Abrir os três campos, já na quinzena seguinte à última da unidade. */
  function comecarOutraQuinzena() {
    const padrao = quinzenaSeguinte(cadastro.data?.vigencias ?? []);
    setAno(padrao.ano);
    setMes(padrao.mes);
    setQuinzenaDoMes(padrao.quinzena);
    setEscolhendoQuinzena(true);
  }

  /**
   * A quinzena escolhida vira a vigência aberta.
   *
   * Quem soma a data é o calendário do produto — `periodoDaQuinzena`, o mesmo
   * de "Cadastrar uma unidade" e de Realizar Fechamento. Montá-la à mão aqui
   * seria uma segunda aritmética de quinzena, e no dia em que as duas
   * discordassem a planilha apareceria numa vigência que nenhuma outra tela
   * escreve.
   *
   * A quinzena que a unidade **já tem** é só selecionada: marcá-la como criada
   * mandaria a bandeira de vigência nova ao servidor para uma vigência que
   * existe — inofensivo, e uma mentira a mais na consulta.
   */
  function usarAQuinzena() {
    if (!anoAceito(ano)) return;
    const { inicio } = periodoDaQuinzena(
      Number(ano),
      Number(mes),
      Number(quinzenaDoMes) as 1 | 2,
    );
    const jaTem = (cadastro.data?.vigencias ?? []).some((v) => v.effectiveDate === inicio);
    setCriada(jaTem ? null : inicio);
    setVigencia(inicio);
    setEscolhendoQuinzena(false);
  }

  /*
    O painel é levado para o `body`, e não desenhado onde o botão está.

    O botão vive numa célula da lista de unidades, e aquela célula é
    `text-right whitespace-nowrap` — ela alinha e não deixa quebrar a contagem
    que mora nela. `white-space` e `text-align` são herdadas, e `position:
    fixed` muda o posicionamento, não a herança: desenhado ali dentro, o painel
    inteiro herdava as duas. O efeito era o texto de ajuda de cada campo virar
    uma linha só, transbordar a coluna e se sobrepor ao do campo vizinho — e
    `max-w-2xl` não segurava nada, porque sob `nowrap` o limite continua sendo
    a largura da caixa enquanto o texto passa por fora dela.

    Um `whitespace-normal text-left` aqui consertaria estas duas propriedades e
    deixaria a próxima passar. O portal corta a classe inteira do problema:
    fora da tabela, o painel não herda nada da célula que abriu. É o que o
    `Dialog` do Radix faz pelo mesmo motivo — e o `Dialog` compartilhado deste
    repositório, que também desenha no lugar, tem a mesma exposição; não o
    mexo aqui porque as telas que o usam são caixas curtas fora de tabela.
  */
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={aoFechar}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Cadastrar a planilha de ${nomeDaUnidade(unidade)}`}
        className="relative z-50 w-full max-w-5xl rounded-xl border bg-background shadow-lg animate-in fade-in zoom-in-95"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b bg-background/95 px-6 py-4 backdrop-blur rounded-t-xl">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
              <PencilLine className="w-4 h-4" />
              Cadastrar a planilha — {nomeDaUnidade(unidade)}
            </h2>
            <p className="text-xs text-muted-foreground mt-1.5 max-w-2xl">
              O que você digitar aqui é o que a <strong>aba de Excel</strong> diz, e não medida do
              acervo: cada linha volta ao cadastro marcada como informada, com o seu nome e a
              data. Onde o acervo também responde, o número dele continua sendo o do cadastro e
              o seu aparece ao lado.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={aoFechar} aria-label="Fechar">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="border-b px-6 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="canal-da-planilha"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Tipo da operação
              </label>

              {digitando ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    id="canal-da-planilha"
                    value={rascunhoDoCanal}
                    placeholder="ROTA"
                    onChange={(e) => setRascunhoDoCanal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") usarODigitado();
                      if (e.key === "Escape") {
                        e.stopPropagation();
                        setDigitando(false);
                      }
                    }}
                    className="uppercase"
                  />
                  <Button
                    variant="outline"
                    onClick={usarODigitado}
                    disabled={rascunhoDoCanal.trim() === ""}
                  >
                    Usar
                  </Button>
                </div>
              ) : (
                <Select value={canal ?? SEM_CANAL} onValueChange={escolher}>
                  <SelectTrigger id="canal-da-planilha">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {opcoes.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                    {unidade.channel === null && (
                      <SelectItem value={SEM_CANAL}>sem canal</SelectItem>
                    )}
                    <SelectItem value={OUTRO}>
                      <span className="inline-flex items-center gap-1.5">
                        <Plus className="w-3 h-3" />
                        outro tipo…
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}

              <p className="text-xs text-muted-foreground">
                A planilha é de um tipo de operação, e não da unidade inteira: a mesma
                {" "}{nomeDaUnidade(unidade)} tem uma aba para EMPURRADA e outra para ROTA. A
                lista traz os tipos que já existem; um tipo novo passa a existir quando a
                primeira linha dele for salva.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="vigencia-da-planilha"
                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Vigência que você preenche
              </label>
              {escolhendoQuinzena ? (
                /*
                  Os mesmos três campos de "Cadastrar uma unidade", na mesma
                  ordem: ano digitado, mês e quinzena escolhidos. Aqui eles
                  cabem numa coluna só, e por isso vão sem rótulo — o `aria-label`
                  de cada um faz o trabalho que o rótulo faria em tela larga.
                */
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <Input
                      autoFocus
                      id="vigencia-da-planilha"
                      value={ano}
                      aria-label="Ano da quinzena"
                      inputMode="numeric"
                      onChange={(e) => setAno(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") usarAQuinzena();
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setEscolhendoQuinzena(false);
                        }
                      }}
                    />
                    <Select value={mes} onValueChange={setMes}>
                      <SelectTrigger aria-label="Mês da quinzena">
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
                    <Select value={quinzenaDoMes} onValueChange={setQuinzenaDoMes}>
                      <SelectTrigger aria-label="Quinzena do mês">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1ª — dias 1 a 15</SelectItem>
                        <SelectItem value="2">2ª — dia 16 ao fim</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={usarAQuinzena} disabled={!anoAceito(ano)}>
                      Usar
                    </Button>
                    <Button variant="ghost" onClick={() => setEscolhendoQuinzena(false)}>
                      Cancelar
                    </Button>
                    {!anoAceito(ano) && (
                      <span className="text-xs text-amber-700">O ano vai de 2000 a 2100.</span>
                    )}
                  </div>
                </div>
              ) : (
                <Select
                  value={vigencia}
                  onValueChange={(v) =>
                    v === OUTRA_QUINZENA ? comecarOutraQuinzena() : setVigencia(v)
                  }
                >
                  <SelectTrigger id="vigencia-da-planilha">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(cadastro.data?.vigencias ?? []).map((v) => (
                      <SelectItem key={v.effectiveDate} value={v.effectiveDate}>
                        {v.periodLabel}
                      </SelectItem>
                    ))}
                    <SelectItem value={OUTRA_QUINZENA}>
                      <span className="inline-flex items-center gap-1.5">
                        <Plus className="w-3 h-3" />
                        outra quinzena…
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}

              <p className="text-xs text-muted-foreground">
                As vigências são as que esta unidade tem — o que o acervo entregou mais o que
                já foi digitado —, inclusive para um tipo que ela ainda não entregou, porque a
                quinzena é do calendário, não da série.{" "}
                {vigenciaNova ? (
                  <strong>
                    Esta quinzena ainda não existe: ela passa a existir quando a primeira
                    linha for salva.
                  </strong>
                ) : (
                  <>
                    Quando a aba de uma quinzena nova chegar antes do export dela, comece por{" "}
                    <em>outra quinzena…</em>.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        <div className={cn("px-6 py-5", cadastro.isLoading && "opacity-60")}>
          {cadastro.isLoading && (
            <p className="text-sm text-muted-foreground">Montando o cadastro…</p>
          )}

          {cadastro.isError && (
            <Alert variant="destructive">
              <AlertDescription>{textoDoErro(cadastro.error)}</AlertDescription>
            </Alert>
          )}

          {cadastro.data && (
            /*
              A `key` carrega unidade, canal e vigência: o formulário guarda o
              que foi digitado em estado local, e trocar o tipo de operação sem
              remontá-lo deixaria o rascunho de EMPURRADA dentro de ROTA — que o
              botão de salvar gravaria no lugar errado.
            */
            <CadastrarAPlanilha
              key={`${unidade.scopeHash}|${canal ?? ""}|${cadastro.data.effectiveDate}`}
              dados={cadastro.data}
              vigenciaNova={vigenciaNova}
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível abrir o cadastro.";
}
