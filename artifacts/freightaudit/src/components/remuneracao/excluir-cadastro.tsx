import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apresentar } from "@/lib/apresentar-erro";
import {
  apagarPlanilha,
  excluirUnidadeCadastrada,
  nomeDaUnidade,
  type SituacaoDaUnidade,
} from "@/lib/remuneracao";

/**
 * A LIXEIRA DA LINHA — desfazer o que foi cadastrado à mão.
 *
 * **Por que ela existe.** Tudo neste módulo tinha entrada e não tinha saída:
 * digitar a aba na quinzena errada, cadastrar a unidade com o nome errado ou
 * criar uma quinzena que não existia deixava uma linha na lista para sempre. A
 * saída que havia era apagar as trinta células uma a uma pela tela do cadastro,
 * e mesmo isso não removia a linha — ela ficava, vazia, sem ninguém saber por
 * que estava ali. A lista de Remuneração é a fila do fechamento; uma linha que
 * não deveria existir nela é trabalho que alguém vai procurar.
 *
 * **Ela apaga o que a linha é, e nada além.** São duas coisas diferentes, e o
 * botão faz uma de cada vez:
 *
 * - **A planilha daquela quinzena**, quando há linhas informadas. Some o que
 *   alguém digitou naquela vigência — e só naquela: a quinzena vizinha da mesma
 *   unidade não é tocada, porque nunca houve herança entre elas.
 * - **O cadastro da unidade**, quando não há mais nada informado e a unidade foi
 *   cadastrada à mão. É o desfazer do "Cadastrar unidade": sai o nome, o código
 *   e a quinzena inicial que alguém declarou.
 *
 * Nessa ordem, e nunca as duas de uma vez. Um clique que apagasse a unidade com
 * as células dentro falaria de uma coisa na confirmação e faria duas — e o
 * servidor recusa fazê-lo, para que o estado não fique pela metade nem por
 * caminho nenhum.
 *
 * **Onde ela não aparece.** Na linha que vem de um export. Aquela unidade não é
 * uma linha cadastrada: ela existe porque um arquivo foi importado, e apagar
 * coisa nenhuma daqui a tiraria da tela. Quem remove uma unidade importada é a
 * exclusão da importação, em Importações, onde a confirmação lista tudo o que
 * sai junto. Um botão aqui prometeria um poder que esta tela não tem.
 */
export function BotaoDeExclusaoDoCadastro({
  unidade,
  podeExcluirAUnidade,
}: {
  unidade: SituacaoDaUnidade;
  /**
   * Esta é a **última** linha de uma unidade cadastrada à mão, e não há planilha
   * em nenhuma das quinzenas dela.
   *
   * Quem sabe isso é a lista, que tem as outras linhas da mesma unidade na mão;
   * a linha sozinha não saberia, e perguntar ao servidor a cada linha custaria
   * uma consulta por linha para desenhar um ícone. O servidor confere de novo
   * na hora de apagar — é lá que a regra vale —, e esta bandeira só decide se o
   * botão convida a um ato que seria recusado.
   */
  podeExcluirAUnidade: boolean;
}) {
  const [aberto, setAberto] = useState(false);

  /*
    A planilha primeiro, e a unidade só quando não sobrou nada informado: é a
    ordem que o servidor exige, e escrevê-la aqui é o que faz o botão oferecer
    um ato de cada vez em vez de um que seria recusado. `null` é a linha que veio
    de export e não tem planilha — não há o que apagar aqui, e o botão não
    aparece.
  */
  const oQueSai: "planilha" | "unidade" | null =
    unidade.cadastro.informadas > 0
      ? "planilha"
      : podeExcluirAUnidade
        ? "unidade"
        : null;
  if (oQueSai === null) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          /*
            A linha inteira abre o cadastro embaixo dela — ver `alternarUma` na
            lista. Sem conter o clique, pedir para excluir também abriria o
            cadastro, e a caixa nasceria por cima de uma linha que acabou de
            mudar de tamanho.
          */
          e.stopPropagation();
          setAberto(true);
        }}
        aria-label={
          oQueSai === "planilha"
            ? "Apagar a planilha desta quinzena"
            : "Excluir o cadastro desta unidade"
        }
        title={
          oQueSai === "planilha"
            ? "Apagar a planilha desta quinzena"
            : "Excluir o cadastro desta unidade"
        }
        className="text-muted-foreground/60 hover:text-red-600 transition-colors p-1.5 -m-1.5"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {aberto && (
        <PainelDeExclusao
          unidade={unidade}
          oQueSai={oQueSai}
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.principal ?? aviso.mensagemCrua ?? "Não foi possível excluir.";
}

/** `1` → "1 linha informada"; `27` → "27 linhas informadas". */
function contarLinhas(n: number): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? "linha informada" : "linhas informadas"}`;
}

/**
 * A caixa que transforma o clique numa decisão.
 *
 * O que ela escreve antes do botão vermelho é o que vai sair, **em número**:
 * "27 linhas informadas", e não "os dados desta quinzena". A diferença é a que
 * separa confirmar de adivinhar — e é a mesma escolha da caixa de excluir
 * importação, que lista fato por fato o que some junto.
 *
 * **Não há desfazer, e isso é dito.** A planilha não tem versões: ela tem autor
 * e data da última escrita. Apagar é apagar, e uma caixa que não dissesse isso
 * deixaria a descoberta para depois do clique.
 *
 * Vai para o `body` pelo portal, e não é desenhada onde o botão está: o botão
 * mora numa célula `text-right whitespace-nowrap` da tabela, e as duas
 * propriedades são herdadas — o texto da caixa viraria uma linha só,
 * transbordando a coluna. É a mesma razão do painel de cadastro, e o `Dialog`
 * compartilhado tem a mesma exposição.
 */
function PainelDeExclusao({
  unidade,
  oQueSai,
  aoFechar,
}: {
  unidade: SituacaoDaUnidade;
  oQueSai: "planilha" | "unidade";
  aoFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const excluir = useMutation({
    /*
      Devolve `void` de propósito: as duas portas respondem coisas diferentes —
      quantas células saíram, ou a unidade que saiu — e nenhuma das duas é usada
      aqui. Quem redesenha a tela é a invalidação abaixo, que relê a lista do
      servidor; guardar a resposta seria manter, na tela, uma segunda versão do
      que acabou de mudar.
    */
    mutationFn: async (): Promise<void> => {
      if (oQueSai === "planilha") {
        await apagarPlanilha({
          scopeHash: unidade.scopeHash,
          canal: unidade.channel,
          period: unidade.effectiveDate,
        });
        return;
      }
      await excluirUnidadeCadastrada({
        scopeHash: unidade.scopeHash,
        canal: unidade.channel,
      });
    },
    onSuccess: () => {
      /*
        O módulo inteiro, e não a linha: apagar a planilha pode fazer a
        **vigência** deixar de existir — ela só existia porque alguém digitou
        nela —, e apagar a unidade tira todas as linhas dela de uma vez. Uma
        invalidação por chave de cadastro deixaria a lista mostrando linhas que
        o servidor já não responde.
      */
      void queryClient.invalidateQueries({ queryKey: ["remuneracao"] });
      aoFechar();
    },
    onError: (err: unknown) => setErro(textoDoErro(err)),
  });

  const nome = nomeDaUnidade(unidade);
  const quinzena = unidade.periodLabel;

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
        aria-label={
          oQueSai === "planilha"
            ? `Apagar a planilha de ${nome} em ${quinzena}`
            : `Excluir o cadastro de ${nome}`
        }
        className="relative z-50 w-full max-w-lg rounded-xl border bg-background shadow-lg animate-in fade-in zoom-in-95"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
              <Trash2 className="w-4 h-4" />
              {oQueSai === "planilha"
                ? "Apagar a planilha desta quinzena?"
                : `Excluir o cadastro de ${nome}?`}
            </h2>
            <p className="text-xs text-muted-foreground mt-1.5">
              {oQueSai === "planilha" ? (
                <>
                  <strong>{nome}</strong> · {quinzena}
                </>
              ) : (
                <>
                  Esta unidade foi cadastrada à mão e não tem nada informado em
                  quinzena nenhuma.
                </>
              )}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={aoFechar}
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {erro && (
            <Alert variant="destructive">
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}

          {oQueSai === "planilha" ? (
            <>
              <p className="text-sm">
                Saem{" "}
                <strong>{contarLinhas(unidade.cadastro.informadas)}</strong>{" "}
                desta quinzena. As outras quinzenas desta unidade não são
                tocadas — nunca houve herança entre elas.
              </p>
              {/*
                A linha some quando a quinzena só existia por causa da planilha —
                a que foi criada em "outra quinzena…", e a de uma unidade que o
                acervo não tem. Dito como possibilidade porque quem sabe é o
                servidor: prometer o desaparecimento numa linha do acervo seria
                prometer o que não vai acontecer.
              */}
              <p className="text-xs text-muted-foreground">
                Se esta quinzena existia só por causa da planilha, a linha some
                da lista junto com ela. Se a unidade entregou export nesta
                vigência, a linha continua — sem nada informado, que é o que ela
                era antes de alguém digitar.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm">
                Sai o cadastro que alguém digitou:{" "}
                <strong>
                  nome, código, tipo de operação e a quinzena inicial
                </strong>
                . Nenhum número sai, porque nenhum número mora nele — e é por
                isso que o servidor recusa este ato enquanto houver planilha
                informada em alguma quinzena.
              </p>
              <p className="text-xs text-muted-foreground">
                Se o export desta unidade chegar depois, ela volta à lista pelo
                arquivo — com o nome que o arquivo trouxer.
              </p>
            </>
          )}

          <p className="text-xs text-amber-700">
            Não há desfazer. A planilha não guarda versões: ela guarda o último
            número, com autor e data.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 gap-2 sm:gap-0 border-t px-6 py-4">
          <Button variant="outline" size="sm" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            size="sm"
            disabled={excluir.isPending}
            onClick={() => {
              setErro(null);
              excluir.mutate();
            }}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            {excluir.isPending
              ? "Excluindo…"
              : oQueSai === "planilha"
                ? "Apagar a planilha"
                : "Excluir o cadastro"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
