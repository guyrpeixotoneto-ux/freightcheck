import { useState, type ReactNode } from "react";
import { ArrowLeftRight, CheckCircle2, ChevronDown, Info, SlidersHorizontal } from "lucide-react";
import { ROTULO_DA_COBERTURA } from "@workspace/comparison/alteracoes-por-modulo";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ColunaDeNumeros } from "@/components/comparacao/coluna-de-numeros";
import type { CandidatosDoPar } from "@/lib/candidatos";
import type { ParMestre, SituacaoDaCobertura } from "@/lib/seletor-mestre";

/**
 * O SELETOR MESTRE — um par, e as quatro coberturas atrás dele.
 *
 * ---------------------------------------------------------------------------
 * Por que ele existe, tendo a tela quatro seletores
 * ---------------------------------------------------------------------------
 * Porque a pergunta que abre esta tela é uma só — *o que mudou de agosto para
 * setembro?* — e ela estava sendo feita quatro vezes. O motor recusa um par
 * entre coberturas diferentes, então os quatro seletores continuam existindo e
 * continuam sendo a única coisa que escreve no endereço; o que muda é que eles
 * deixam de ser o gesto **normal** e passam a ser o ajuste.
 *
 * Medido no celular do print: os quatro seletores empilhados ocupavam a tela
 * inteira, e o primeiro cartão do catálogo — que é o conteúdo — começava fora
 * dela.
 *
 * ---------------------------------------------------------------------------
 * A frase embaixo do par não é decoração
 * ---------------------------------------------------------------------------
 * Um gesto que alcança quatro coberturas tem de dizer a quantas chegou. Sem
 * ela, o mestre seria uma caixa afirmando um par que três cartões do catálogo
 * não usam — a mesma dedução por comparação de caixas que a tela dos quatro
 * seletores pedia, agora escondida.
 *
 * São três frases, e a diferença entre elas é o que aconteceu:
 *
 * - **verde** — todas as coberturas com par seguiram. Nada a decidir.
 * - **âmbar com nomes** — alguma ficou no par dela, e ela é nomeada **com o par
 *   dela junto**, mais um atalho que abre a gaveta já nela.
 * - **âmbar sem nomes** — nenhuma cobertura tem esse par. Acontece com a data
 *   que só existe num quadro, e é dito em vez de deixar a tela muda.
 *
 * A gaveta guarda os quatro `SeletorDoPar` inteiros — o componente não os
 * substitui, só deixa de mostrá-los todos de uma vez.
 */
export function SeletorMestre({
  datas,
  rotuloDaData,
  mestre,
  situacoes,
  rotulos,
  onDe,
  onPara,
  onInverter,
  carregando = false,
  candidatos,
  carregandoCandidatos = false,
  erroDosCandidatos = null,
  children,
}: {
  /** As datas que o acervo inteiro oferece — a união das quatro listas. */
  datas: readonly string[];
  /** O texto de uma data, escrito pela mesma função do resto da casa. */
  rotuloDaData: (data: string) => string;
  mestre: ParMestre;
  situacoes: readonly SituacaoDaCobertura[];
  /** O texto de cada vigência por id — para escrever o par de quem divergiu. */
  rotulos: ReadonlyMap<string, string>;
  onDe: (data: string) => void;
  onPara: (data: string) => void;
  onInverter: () => void;
  carregando?: boolean;
  /**
   * O que cada data candidata a "De" produz no catálogo — **por data**, e não
   * por id de vigência.
   *
   * É a diferença desta resposta para a das dezesseis auditorias, e ela é o
   * assunto inteiro deste menu: uma quinzena aqui é até quatro vigências, uma
   * por cobertura, e o número ao lado dela é o que as quatro produzem juntas.
   * Quem soma é o servidor (`/alteracoes-por-modulo/candidatos`), pelos mesmos
   * pares que o clique nesta linha escreve no endereço.
   *
   * `undefined` enquanto a pergunta está no ar; uma entrada com `numeros: null`
   * é a data que o servidor ainda não calculou. Os dois casos escrevem a mesma
   * coisa na linha: **nada**.
   */
  candidatos?: CandidatosDoPar;
  /** Há pergunta em voo: as linhas sem número mostram esqueleto, não vazio. */
  carregandoCandidatos?: boolean;
  /** A falha da pergunta pelos números, quando houve uma. */
  erroDosCandidatos?: string | null;
  /** Os quatro seletores por cobertura, que moram dentro da gaveta. */
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(false);

  /*
    Ainda vem número — a mesma régua do seletor de par, e pela mesma razão: entre
    duas rodadas o carregamento é falso com metade das linhas sem número, e um
    esqueleto amarrado só a ele faria a lista piscar enquanto se preenche.
  */
  const faltamNumeros = carregandoCandidatos || (candidatos?.pendentes ?? 0) > 0;

  /**
   * A linha do menu: a data à esquerda, o que o catálogo produz à direita.
   *
   * Só o campo **De** a escreve, e é a mesma assimetria das dezesseis
   * auditorias: a coluna responde *o que esta candidata produz contra o "Para"
   * aberto*, e no campo do "Para" essa pergunta não tem sujeito — cada linha
   * ali mudaria a própria base da conta.
   *
   * O `ItemText` do Radix encolhe (ver `SeletorDoPar`), e é por isso que o
   * item precisa de `ITEM_LARGO` para a coluna direita ter uma régua comum.
   */
  const ITEM_LARGO = "[&>span:last-child]:w-full";

  const linha = (data: string, comNumeros: boolean) => (
    <span className="flex w-full items-center justify-between gap-6">
      <span>{rotuloDaData(data)}</span>
      {comNumeros ? (
        <ColunaDeNumeros
          numeros={candidatos?.candidatos.find((c) => c.id === data)?.numeros ?? null}
          faltam={faltamNumeros}
        />
      ) : null}
    </span>
  );

  const seguem = situacoes.filter((s) => s.estado === "SEGUE");
  const proprias = situacoes.filter((s) => s.estado === "PROPRIO");
  const comPar = seguem.length + proprias.length;

  const parEscrito = (situacao: SituacaoDaCobertura) => {
    const de = rotulos.get(situacao.par.base);
    const para = rotulos.get(situacao.par.comparada);
    return de && para ? `${de} → ${para}` : "sem par escolhido";
  };

  return (
    <div className="flex flex-col gap-3">
      {/*
        O par, em cima e sozinho.

        A superfície tingida não é ênfase gratuita: ela é o que separa "o gesto
        que vale para tudo" de "o ajuste de uma cobertura", que na gaveta abaixo
        tem exatamente a mesma forma — dois campos e um Inverter. Sem a
        distinção, os dois se leriam como o mesmo controle repetido, que é de
        onde esta tela veio.
      */}
      <div className="flex flex-col gap-2 rounded-lg border border-primary/20 bg-primary/[0.04] p-3 sm:flex-row sm:items-end sm:gap-3 dark:bg-primary/10">
        <div className="flex items-center gap-1.5 pb-0.5 sm:pb-3">
          <SlidersHorizontal className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
          <span className="text-[0.65rem] font-extrabold uppercase tracking-[0.1em] text-primary">
            Comparar
          </span>
        </div>

        <div className="flex flex-col gap-1.5 sm:flex-1">
          <label
            htmlFor="mestre-de"
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            De
          </label>
          <Select value={mestre.de} onValueChange={onDe} disabled={carregando}>
            <SelectTrigger
              id="mestre-de"
              className="bg-background"
              aria-label="De (vigência de origem, para todas as coberturas)"
            >
              <SelectValue placeholder="Escolha a vigência de origem">
                {mestre.de ? rotuloDaData(mestre.de) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {datas.map((data) => (
                <SelectItem key={data} value={data} className={ITEM_LARGO}>
                  {linha(data, true)}
                </SelectItem>
              ))}
              {/*
                A falha não tira o menu do ar: escolher a vigência continua
                possível, e o que se perde é só a coluna da direita. A frase é a
                do servidor — desde `apresentar-erro.ts`, ela é uma frase.
              */}
              {erroDosCandidatos && (
                <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
                  {erroDosCandidatos}
                </p>
              )}
            </SelectContent>
          </Select>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={onInverter}
          disabled={carregando || !mestre.de || !mestre.para}
          aria-label="Inverter: trocar a vigência de origem com a de destino em todas as coberturas"
          className="w-full gap-2 bg-background sm:w-auto"
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Inverter
        </Button>

        <div className="flex flex-col gap-1.5 sm:flex-1">
          <label
            htmlFor="mestre-para"
            className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-muted-foreground"
          >
            Para
          </label>
          <Select value={mestre.para} onValueChange={onPara} disabled={carregando}>
            <SelectTrigger
              id="mestre-para"
              className="bg-background"
              aria-label="Para (vigência de destino, para todas as coberturas)"
            >
              <SelectValue placeholder="Escolha a vigência de destino">
                {mestre.para ? rotuloDaData(mestre.para) : null}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {datas.map((data) => (
                <SelectItem key={data} value={data} className={ITEM_LARGO}>
                  {linha(data, false)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/*
        A quantas coberturas o gesto chegou. `role="status"` porque ela troca
        sem a página navegar — é o leitor de tela sabendo que a escolha mudou o
        alcance, que é a única coisa que o mestre faz.
      */}
      {comPar > 0 && (
        <div role="status" className="flex flex-col gap-2">
          {seguem.length === comPar ? (
            <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <CheckCircle2
                className="mt-0.5 h-3.5 w-3.5 flex-none text-success"
                aria-hidden="true"
              />
              {/*
                No singular a frase precisa do nome **dentro** dela. "A única
                cobertura com par seguiu este par. Equipamento" é a lista de
                nomes sobrando depois de um ponto final — e o acervo com uma
                cobertura só não é raro: é como toda unidade começa, com o
                primeiro arquivo importado.
              */}
              {seguem.length === 1 ? (
                <span>
                  <strong className="font-semibold text-success">
                    {ROTULO_DA_COBERTURA[seguem[0].cobertura]}
                  </strong>{" "}
                  é a única cobertura com par no acervo, e seguiu este par.
                </span>
              ) : (
                <span>
                  <strong className="font-semibold text-success">
                    {`As ${seguem.length} coberturas seguiram este par.`}
                  </strong>{" "}
                  {seguem.map((s) => ROTULO_DA_COBERTURA[s.cobertura]).join(" · ")}
                </span>
              )}
            </p>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 dark:border-amber-900/50 dark:bg-amber-950/40">
              <p className="flex items-start gap-2 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
                <span>
                  <strong className="font-semibold">
                    {seguem.length === 0
                      ? "Nenhuma cobertura tem este par."
                      : `${seguem.length} de ${comPar} coberturas seguiram este par.`}
                  </strong>{" "}
                  {seguem.length === 0
                    ? "As vigências abaixo continuam no par delas."
                    : "As demais não têm estas vigências no acervo, e ficaram no par delas:"}
                </span>
              </p>
              <ul className="flex flex-col gap-1.5">
                {proprias.map((situacao) => (
                  <li
                    key={situacao.cobertura}
                    className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-sm bg-background/70 px-2 py-1.5 text-xs dark:bg-background/40"
                  >
                    <span className="font-semibold">
                      {ROTULO_DA_COBERTURA[situacao.cobertura]}
                    </span>
                    <span className="flex-1 text-muted-foreground">
                      {parEscrito(situacao)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAberta(true)}
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      Ajustar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/*
        A assimetria do percentual, dita **aqui** também.

        O `SeletorDoPar` a escreve embaixo de cada par, e é a única coisa
        realmente difícil daquela peça: ir de 100 para 110 é +10,0%, e voltar é
        −9,09%. O Inverter do mestre faz exatamente o mesmo pedido ao motor, em
        até quatro coberturas de uma vez — deixar o aviso só dentro da gaveta o
        esconderia justamente de quem inverte sem nunca abri-la, que passa a ser
        o caminho normal.
      */}
      <p className="flex items-start gap-2 border-l-2 border-border pl-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
        <span>
          Inverter troca o par pedido ao motor: a diferença muda de sinal, e a variação
          muda de sinal <strong className="font-semibold">mas não de magnitude</strong> —
          a base do percentual passa a ser a outra vigência.
        </span>
      </p>

      {/*
        A gaveta. Fechada por padrão porque o par por cobertura é o ajuste, e
        não a leitura — mas o gatilho diz quantas coberturas há atrás dele, de
        modo que quem precisa delas não tem de adivinhar que elas existem.
      */}
      <Collapsible open={aberta} onOpenChange={setAberta}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 border-t pt-2.5 text-xs font-bold text-primary">
          <ChevronDown
            className={cn("h-4 w-4 transition-transform", aberta && "rotate-180")}
            aria-hidden="true"
          />
          Ajustar por cobertura
          <span className="flex-1" />
          <span className="text-xs font-medium text-muted-foreground">
            {situacoes.length} {situacoes.length === 1 ? "cobertura" : "coberturas"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-3 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              O motor não compara vigências de coberturas diferentes — por isso cada
              uma tem o seu par, e o de cima só alcança as que o aceitam.
            </p>
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
