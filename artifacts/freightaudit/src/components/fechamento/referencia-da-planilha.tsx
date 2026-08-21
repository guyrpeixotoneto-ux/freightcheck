import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, History } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { apresentar } from "@/lib/apresentar-erro";
import {
  anexarReferencia,
  ativarReferencia,
  listarReferenciasDoMes,
  type MesDaReferencia,
  type VersaoDaReferencia,
} from "@/lib/fechamento";
import { cn } from "@/lib/utils";

/**
 * A mensagem que quem opera precisa ler.
 *
 * A recusa da porta de leitura vem crua e nomeia a célula — "a célula AI7 está
 * vazia" é acionável; um "não foi possível anexar" não é. Por isso a mensagem
 * do servidor tem precedência sobre a orientação genérica: aqui ela **é** a
 * orientação.
 */
function textoDoErro(erro: unknown): string {
  const aviso = apresentar(erro);
  return (
    aviso.mensagemCrua ??
    aviso.orientacao?.resumo ??
    "Não foi possível anexar a planilha."
  );
}

/**
 * ANEXAR A RÉGUA — a planilha da operação, para conferir o mês contra ela.
 *
 * **O que este componente deliberadamente não faz.** Ele não pergunta a que mês
 * o arquivo pertence e não tenta descobrir: o mês é o que está na tela, e
 * anexar é declarar que aquele arquivo é daquele fechamento. O `.xlsb` não
 * carrega unidade, CNPJ nem competência em nada que se leia dele, e uma
 * pergunta de confirmação daria a impressão de que o sistema conferiu algo que
 * não tem como conferir. O que ele oferece no lugar é procedência — arquivo,
 * versão, quem, quando, `sha256` — visível ao lado de toda diferença.
 *
 * **Onde este componente aparece.** Na Conciliação, que é a tela desta régua.
 * O Resumo geral não o mostra: lá o mês é conferido contra as duas fontes que
 * sempre existem — o contrato e o 03.08.20 —, e um botão de anexo no meio
 * daquela tabela sugeria que faltava um arquivo para ela responder.
 *
 * **A recusa é o caminho normal, não a exceção.** O servidor lê o arquivo antes
 * de gravar e devolve 400 com o endereço da célula quando ele não é uma
 * planilha deste formato. A mensagem aparece aqui inteira porque é ela que diz
 * o que consertar — "a célula AI7 está vazia" é acionável, "não foi possível
 * anexar" não é.
 */
export function ReferenciaDaPlanilha({ alvo }: { alvo: MesDaReferencia }) {
  const cliente = useQueryClient();
  const campo = useRef<HTMLInputElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mostrarHistorico, setMostrarHistorico] = useState(false);

  const chave = [
    "fechamento",
    "referencias",
    alvo.unidade,
    alvo.transportadora,
    alvo.tipoDeOperacao,
    alvo.ano,
    alvo.mes,
  ];

  const versoes = useQuery({
    queryKey: chave,
    queryFn: () => listarReferenciasDoMes(alvo),
  });

  /*
    Invalida a conciliação junto: a coluna da planilha vem de lá, e não daqui.
    Recarregar só esta lista deixaria a tabela mostrando a régua antiga com o
    cabeçalho novo — duas verdades na mesma tela.

    O Resumo geral **não** entra: ele não lê a referência, e invalidá-lo faria
    a tela ao lado buscar de novo, com a mesma resposta, a cada anexo.
  */
  const recarregar = async () => {
    await Promise.all([
      cliente.invalidateQueries({ queryKey: chave }),
      cliente.invalidateQueries({ queryKey: ["fechamento", "conciliacao"] }),
    ]);
  };

  const anexar = useMutation({
    mutationFn: (arquivo: File) => anexarReferencia(alvo, arquivo),
    onSuccess: async () => {
      setErro(null);
      await recarregar();
    },
    onError: (e) => setErro(textoDoErro(e)),
  });

  const trocar = useMutation({
    mutationFn: (id: string) => ativarReferencia(id),
    onSuccess: async () => {
      setErro(null);
      await recarregar();
    },
    onError: (e) => setErro(textoDoErro(e)),
  });

  const lista = versoes.data?.versoes ?? [];
  const ativa = lista.find((v) => v.ativa) ?? null;
  const ocupado = anexar.isPending || trocar.isPending;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={campo}
          type="file"
          accept=".xlsb,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            if (arquivo) anexar.mutate(arquivo);
            /* Limpa para que escolher o mesmo arquivo de novo dispare o evento. */
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={ocupado}
          onClick={() => campo.current?.click()}
        >
          <FileUp className="h-4 w-4 mr-2" />
          {ativa ? "Anexar nova versão da planilha" : "Anexar planilha para conferir"}
        </Button>
        {lista.length > 1 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMostrarHistorico((v) => !v)}
          >
            <History className="h-4 w-4 mr-2" />
            {lista.length} versões
          </Button>
        )}
        {anexar.isPending && (
          <span className="text-xs text-muted-foreground">lendo a planilha…</span>
        )}
      </div>

      {!ativa && !versoes.isLoading && (
        <p className="text-xs text-muted-foreground max-w-2xl">
          Sem planilha anexada não há o que conciliar: o mês continua conferido
          contra o 03.08.20 no Resumo geral. Anexar a{" "}
          <code>Fechamento_Remuneracao.xlsb</code> deste fechamento põe a coluna{" "}
          <strong>Planilha</strong> ao lado do devido — e nada do que ela traz
          entra no cálculo.
        </p>
      )}

      {erro && (
        <Alert variant="destructive">
          <AlertDescription className="text-xs">
            {erro}
          </AlertDescription>
        </Alert>
      )}

      {mostrarHistorico && lista.length > 0 && (
        <div className="rounded-md border divide-y">
          {lista.map((v) => (
            <LinhaDaVersao
              key={v.id}
              versao={v}
              ocupado={ocupado}
              aoAtivar={() => trocar.mutate(v.id)}
            />
          ))}
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Nenhuma versão é apagada. A diferença que alguém leu foi medida contra
            um arquivo específico, e essa leitura precisa continuar reconstruível.
          </p>
        </div>
      )}
    </div>
  );
}

function LinhaDaVersao({
  versao,
  ocupado,
  aoAtivar,
}: {
  versao: VersaoDaReferencia;
  ocupado: boolean;
  aoAtivar: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs",
        versao.ativa && "bg-muted/40",
      )}
    >
      <div className="min-w-0">
        <span className="font-medium">v{versao.versao}</span>{" "}
        <span className="text-muted-foreground">{versao.nomeDoArquivo}</span>
        <span className="block text-muted-foreground">
          {new Date(versao.anexadaEm).toLocaleString("pt-BR")} ·{" "}
          <span className="font-mono" title={`sha256 ${versao.sha256}`}>
            {versao.sha256.slice(0, 12)}…
          </span>
        </span>
      </div>
      {versao.ativa ? (
        <span className="text-muted-foreground">conferindo contra esta</span>
      ) : (
        <Button variant="ghost" size="sm" disabled={ocupado} onClick={aoAtivar}>
          usar esta
        </Button>
      )}
    </div>
  );
}
