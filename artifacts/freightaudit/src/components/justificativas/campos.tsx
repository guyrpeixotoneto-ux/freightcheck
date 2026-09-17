import { useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import {
  ROTULO_DA_CONFORMIDADE,
  type Conformidade,
  type RascunhoDaJustificativa,
} from "@workspace/comparison/justificativa-estruturada";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * OS CAMPOS DA JUSTIFICATIVA — as quatro perguntas, uma vez só no produto.
 *
 * Elas nasceram dentro de `justificar-dialog.tsx`, que é onde se justifica uma
 * alteração de cada vez. Saíram para cá quando a justificativa em lote passou a
 * perguntar exatamente o mesmo: como o valor se calcula, sob que condição ele
 * pode mudar, se esta alteração seguiu a condição e — só quando não seguiu —
 * por que e com o aval de quem.
 *
 * **Copiá-las seria o pior desfecho possível desta funcionalidade.** As duas
 * cópias concordariam no dia em que fossem escritas; na primeira correção que
 * uma recebesse, o produto passaria a cobrar coisas diferentes conforme de onde
 * a caixa foi aberta — e a justificativa gravada em lote seria uma
 * justificativa de segunda classe, com a tela sem ter como dizer qual é qual.
 * O que é obrigatório continua sendo decidido por `faltamNaJustificativa`, a
 * mesma função que a rota usa para recusar o POST, e nada disso mora aqui.
 *
 * O que este componente **não** sabe é gravar, nem de quantas alterações se
 * trata: ele recebe um rascunho e devolve mudanças. Quem chama decide o resto.
 */

/** As três respostas, na ordem em que a tela as oferece. */
const CONFORMIDADES: Conformidade[] = ["CONFORME", "EXCECAO", "DESCUMPRIMENTO"];

export function CamposDaJustificativa({
  resposta,
  onAlterar,
  nota,
}: {
  resposta: RascunhoDaJustificativa;
  onAlterar: (mudanca: Partial<RascunhoDaJustificativa>) => void;
  /**
   * A quem esta resposta pertence, quando há mais de uma coisa em jogo.
   *
   * Na fila é o nome da variável — a caixa parece a mesma em todas as etapas, e
   * sem a frase é fácil escrever a fórmula dos Juros achando que vale para as
   * quatro. No lote é o contrário, e a frase é a que impede o outro engano: a
   * resposta vale para **todas** as alterações selecionadas.
   */
  nota?: string | null;
  }) {
  /*
    A fórmula é o campo que às vezes tem uma linha e às vezes tem dez — cadeias
    de cálculo do FINAME não cabem em duas. Expandir é da fórmula só, e não do
    diálogo: crescer a caixa inteira empurraria os botões para fora da tela
    justamente quando se está escrevendo o campo mais longo.
  */
  const [formulaExpandida, setFormulaExpandida] = useState(false);

  const foraDaRegra = !!resposta.conformidade && resposta.conformidade !== "CONFORME";
  const excecao = resposta.conformidade === "EXCECAO";

  return (
    <div className="space-y-4">
      <Campo
        rotulo="Fórmula de cálculo"
        obrigatorio
        nota={nota}
        acao={
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            onClick={() => setFormulaExpandida((v) => !v)}
          >
            {formulaExpandida ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            {formulaExpandida ? "Recolher" : "Expandir"}
          </button>
        }
      >
        <Textarea
          value={resposta.formula ?? ""}
          onChange={(e) => onAlterar({ formula: e.target.value })}
          placeholder="Descreva como o valor deve ser calculado."
          rows={formulaExpandida ? 10 : 3}
          autoFocus
        />
      </Campo>

      <Campo rotulo="Regra para alteração do valor" obrigatorio nota={nota}>
        <Textarea
          value={resposta.regra ?? ""}
          onChange={(e) => onAlterar({ regra: e.target.value })}
          placeholder="Explique quando esta variável pode ser alterada."
          rows={3}
        />
      </Campo>

      {/*
          Este campo é um grupo de opções, e não uma caixa de texto: por isso não
          é um `<label>`. Envolver dois botões de opção num rótulo faz o nome
          acessível de cada um virar o texto inteiro do grupo — os dois passam a
          se chamar a mesma coisa, e nem um leitor de tela nem um teste
          conseguem distinguir "sim" de "não".
      */}
      <Campo rotulo="Esta alteração seguiu a regra?" obrigatorio grupo nota={nota}>
        {/*
            Empilhadas, e não lado a lado: com três respostas, a terceira ("Não,
            regra de remuneração descumprida") é a mais longa das três, e numa
            fileira de três colunas ela quebra em duas linhas enquanto as outras
            ficam com meia caixa vazia.
        */}
        <div className="grid gap-2" role="radiogroup">
          {CONFORMIDADES.map((opcao) => (
            <OpcaoDeConformidade
              key={opcao}
              marcada={resposta.conformidade === opcao}
              onSelecionar={() => onAlterar({ conformidade: opcao })}
            >
              {ROTULO_DA_CONFORMIDADE[opcao]}
            </OpcaoDeConformidade>
          ))}
        </div>
      </Campo>

      {/*
          O motivo aparece nos dois desvios — é ele que diz o que houve —, e o
          aprovador só na exceção. Pedi-los de quem marcou "conforme" seria pedir
          a explicação de um desvio que não houve; pedir um aprovador de um
          descumprimento seria registrar um aval que ninguém deu.
      */}
      {foraDaRegra && (
        <Campo rotulo={excecao ? "Motivo da exceção" : "O que foi descumprido"} obrigatorio>
          <Textarea
            value={resposta.motivoExcecao ?? ""}
            onChange={(e) => onAlterar({ motivoExcecao: e.target.value })}
            placeholder={
              excecao
                ? "Explique por que o valor foi alterado mesmo não atendendo à regra definida."
                : "Descreva a regra de remuneração que não foi cumprida nesta alteração."
            }
            rows={2}
          />
        </Campo>
      )}

      {excecao && (
        <Campo rotulo="Responsável pela aprovação" obrigatorio>
          <Input
            value={resposta.responsavelAprovacao ?? ""}
            onChange={(e) => onAlterar({ responsavelAprovacao: e.target.value })}
            placeholder="Nome de quem autorizou a exceção"
          />
        </Campo>
      )}
    </div>
  );
}

/** Rótulo com o asterisco do obrigatório — o desenho de todos os campos daqui. */
export function Campo({
  rotulo,
  obrigatorio,
  grupo,
  nota,
  acao,
  children,
}: {
  rotulo: string;
  obrigatorio?: boolean;
  /** Um grupo de opções em vez de um controle só — ver a chamada. */
  grupo?: boolean;
  /** A quem esta resposta pertence — ver {@link CamposDaJustificativa}. */
  nota?: string | null;
  /** Um comando do campo — hoje só o "Expandir" da fórmula. */
  acao?: ReactNode;
  children: ReactNode;
}) {
  const Envolucro = grupo ? "div" : "label";
  return (
    <Envolucro className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">
        {rotulo}
        {obrigatorio && <span className="ml-1 text-destructive">*</span>}
      </span>
      {children}
      {(nota || acao) && (
        <span className="flex items-start justify-between gap-3">
          <span className="text-xs text-muted-foreground">{nota}</span>
          {acao}
        </span>
      )}
    </Envolucro>
  );
}

export function OpcaoDeConformidade({
  marcada,
  onSelecionar,
  children,
}: {
  marcada: boolean;
  onSelecionar: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={marcada}
      onClick={onSelecionar}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
        marcada ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border",
          marcada ? "border-primary" : "border-muted-foreground/40",
        )}
      >
        {marcada && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      {children}
    </button>
  );
}
