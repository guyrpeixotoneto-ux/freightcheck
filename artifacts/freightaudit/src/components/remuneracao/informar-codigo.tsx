import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Hash, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apresentar } from "@/lib/apresentar-erro";
import { informarCodigoDaUnidade } from "@/lib/remuneracao";

/**
 * O CNPJ QUE CHEGA DEPOIS — a unidade cadastrada sem código passa a ter o dele.
 *
 * **Por que este botão existe.** Cadastrar sem código é permitido, e quem tem a
 * aba de Excel na mão nem sempre tem o CNPJ. O preço é conhecido e está escrito
 * no painel do cadastro: sem código o identificador sai do nome, e o export abre
 * a unidade dele ao lado desta. O que faltava era o outro lado — descobrir o
 * CNPJ no dia seguinte não servia de nada, porque não havia onde escrevê-lo, e
 * a planilha já digitada ficava presa ao escopo do nome para sempre.
 *
 * **O ato move a unidade de lugar, e a tela diz isso antes do clique.** Não é
 * "editar um campo": o `scopeHash` é o endereço da unidade, e informar o código
 * a leva para o endereço que a importação vai produzir — com a planilha junto,
 * na mesma transação. Chamar isso de edição faria parecer reversível uma coisa
 * que muda o endereço de tudo o que já foi digitado.
 *
 * **Uma vez só.** O servidor recusa trocar um código que já vale, e a razão é
 * séria: aquele código pode ser o que faz a unidade encontrar um arquivo que já
 * chegou, e reescrevê-lo a levaria para longe dele em silêncio. Por isso este
 * botão só aparece em quem não tem código nenhum.
 */
export function BotaoDeInformarCodigo({
  scopeHash,
  nome,
}: {
  scopeHash: string;
  nome: string;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-[0.6875rem] text-primary hover:underline inline-flex items-center gap-1"
      >
        <Hash className="w-3 h-3" />
        informar código
      </button>

      {aberto && (
        <PainelDoCodigo scopeHash={scopeHash} nome={nome} aoFechar={() => setAberto(false)} />
      )}
    </>
  );
}

function PainelDoCodigo({
  scopeHash,
  nome,
  aoFechar,
}: {
  scopeHash: string;
  nome: string;
  aoFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") aoFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const informar = useMutation({
    mutationFn: () => informarCodigoDaUnidade({ scopeHash, codigo }),
    onSuccess: () => {
      /*
        A invalidação é do módulo inteiro, e não da unidade: ela mudou de
        `scopeHash`, então a chave da consulta antiga descreve um endereço que
        não existe mais. Invalidar por unidade deixaria a lista com a linha
        velha até alguém recarregar a página.
      */
      void queryClient.invalidateQueries({ queryKey: ["remuneracao"] });
      aoFechar();
    },
    onError: (err: unknown) => setErro(textoDoErro(err)),
  });

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={aoFechar} aria-hidden />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Informar o código da unidade"
        className="relative z-50 w-full max-w-xl rounded-xl border bg-background shadow-lg animate-in fade-in zoom-in-95"
      >
        <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-none tracking-tight flex items-center gap-2">
              <Hash className="w-4 h-4" />
              Informar o código de {nome}
            </h2>
            <p className="text-xs text-muted-foreground mt-1.5">
              Esta unidade foi cadastrada sem código, e é por isso que o export ainda abriria
              uma segunda ao lado dela. Com o código, ela passa a ocupar o lugar que o arquivo
              vai procurar — <strong>e a planilha já digitada vai junto</strong>.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={aoFechar} aria-label="Fechar">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {erro && (
            <Alert variant="destructive">
              <AlertDescription>{erro}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="codigo-da-unidade">Código da unidade</Label>
            <Input
              autoFocus
              id="codigo-da-unidade"
              value={codigo}
              placeholder="12.345.678/0001-99"
              onChange={(e) => setCodigo(e.target.value)}
            />
          </div>

          <p className="text-xs text-muted-foreground">
            O mesmo da coluna <strong>Unidade - CNPJ</strong> do export, escrito{" "}
            <strong>exatamente como está lá</strong> — com pontuação, se lá houver. É sobre
            esse texto que o identificador é somado: com a pontuação errada, a unidade muda de
            lugar e continua sem encontrar o arquivo.
          </p>
          {/*
            O aviso de irreversibilidade é curto e vem antes do botão, e não
            depois: o servidor recusa trocar um código que já vale — porque
            aquele código pode ser o que liga a unidade a um arquivo que já
            chegou —, e descobrir a regra pela recusa é descobri-la tarde.
          */}
          <p className="text-xs text-muted-foreground">
            O código é gravado <strong>uma vez</strong>. Trocá-lo depois moveria a unidade de
            novo, para longe do arquivo que ela já tivesse encontrado, e por isso não é o que
            esta tela faz.
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            onClick={() => informar.mutate()}
            disabled={codigo.trim() === "" || informar.isPending}
          >
            {informar.isPending ? "Gravando…" : "Informar código"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return aviso.orientacao?.resumo ?? aviso.mensagemCrua ?? "Não foi possível informar o código.";
}
