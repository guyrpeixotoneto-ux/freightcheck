import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Loader2, Upload } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { escritas, fraseDoErro, type Catalogo, type FluxoCompleto } from "@/lib/fluxos";
import { lerPasta } from "@/lib/xlsx-leitura";
import {
  planoDeImportacao,
  tamanhoDoPlano,
  type MudancaDaEtapa,
  type PlanoDeImportacao,
} from "@/lib/fluxos-modelo-leitura";

/**
 * IMPORTAR O MODELO — a planilha preenchida voltando para as etapas.
 *
 * O modelo em Excel sai do produto para ser preenchido longe dele: numa reunião
 * com quem executa o processo, num avião, num caderno transcrito depois. Esta é
 * a volta — e sem ela o modelo custaria a quem o usa exatamente o trabalho que
 * ele economizou, só que na hora de digitar.
 *
 * ---------------------------------------------------------------------------
 * Mostrar antes de gravar, sempre
 * ---------------------------------------------------------------------------
 *
 * Escolher o arquivo **não** grava nada: a leitura acontece no navegador, vira
 * um plano (`lib/fluxos-modelo-leitura.ts`) e o plano aparece na tela campo a
 * campo, de quê para quê, antes de qualquer escrita. Uma importação que grava
 * direto é usada uma vez — na segunda, quando alguém percebe que o arquivo era
 * a versão antiga, ela vira uma coisa em que não se confia.
 *
 * O que o plano não reconheceu aparece junto, e não sumido: aba que não casou
 * com etapa nenhuma, valor de Tipo que o catálogo não tem, aba repetida. Cada
 * uma dessas linhas é uma pergunta que a pessoa consegue responder olhando a
 * planilha — e que ninguém responderia se a tela dissesse só "12 etapas
 * atualizadas".
 *
 * ---------------------------------------------------------------------------
 * A gravação é a mesma do editor, na mesma ordem
 * ---------------------------------------------------------------------------
 *
 * Não há rota nova: cada etapa do plano vira o mesmo `PUT` que o diálogo de
 * edição faz, seguido de uma chamada por lista tocada. Em série, e não em
 * paralelo, pela razão que o editor já registra — em paralelo, uma recusa no
 * meio deixaria metade da etapa gravada sem que a mensagem dissesse qual
 * metade. Em série, o que entrou é sempre um prefixo do que a planilha trazia, e
 * a tela mostra em que etapa parou.
 *
 * ---------------------------------------------------------------------------
 * O estado é um só; o diálogo mora na página, não no botão
 * ---------------------------------------------------------------------------
 *
 * A importação aparece em dois lugares — botão na barra larga, item de "Mais
 * ações" na estreita —, e os dois são **gatilhos**: o estado vem de
 * `useImportadorDoModelo`, chamado uma vez pela página, e o diálogo é montado
 * uma vez, no nível dela, junto dos outros diálogos do fluxo.
 *
 * Não era assim, e o defeito que isso causava é a razão desta forma. Com o
 * diálogo dentro do gatilho, ele ficava dentro do contêiner que a barra usa
 * para aparecer só numa faixa de largura (`hidden md:flex`). Quem estivesse
 * revisando a prévia e estreitasse a janela — arrastar a borda, girar o
 * aparelho, uma barra lateral abrindo — via a prévia **sumir**: o contêiner
 * virava `display:none`, o componente continuava montado e aberto, e a trava de
 * rolagem que todo modal aplica no `body` continuava aplicada. Sobrava uma
 * tela sem prévia, sem rolagem e sem nada explicando o que houve.
 *
 * Fora do contêiner, a largura da janela não tem mais o que dizer sobre um
 * diálogo aberto — e, de brinde, começar a importação pelo menu e terminá-la na
 * barra larga passa a ser a mesma importação, e não duas.
 */

interface Importacao {
  /** `undefined` enquanto o fluxo carrega — a página chama o hook mesmo assim. */
  completo: FluxoCompleto | undefined;
  catalogo: Catalogo | undefined;
  empresaId: string | null;
  /** Recarrega o fluxo depois de gravar. */
  aoConcluir: () => void;
}

/**
 * O estado da importação, para a página segurar.
 *
 * Chamado **uma vez** por tela. Os dois gatilhos e o diálogo recebem o que ele
 * devolve; nenhum deles guarda estado próprio.
 */
export function useImportadorDoModelo({ completo, catalogo, empresaId, aoConcluir }: Importacao) {
  const entrada = useRef<HTMLInputElement | null>(null);
  const [lendo, setLendo] = useState(false);
  const [plano, setPlano] = useState<PlanoDeImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravadas, setGravadas] = useState(0);

  async function abrirArquivo(arquivo: File) {
    if (!completo) return;
    setLendo(true);
    setErro(null);
    try {
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      const pasta = await lerPasta(bytes);
      setPlano(planoDeImportacao(pasta, completo, catalogo));
    } catch (falha) {
      setErro(fraseDoErro(falha));
    } finally {
      setLendo(false);
    }
  }

  const gravar = useMutation({
    mutationFn: async () => {
      if (!plano || !completo) return;
      setGravadas(0);
      for (const mudanca of plano.mudancas) {
        if (mudanca.campos.length > 0) {
          await escritas.atualizarEtapa(
            empresaId,
            completo.fluxo.id,
            mudanca.etapaId,
            mudanca.corpo,
          );
        }
        for (const lista of mudanca.listas) {
          if (lista.alvo === "itens" && lista.especie) {
            await escritas.salvarItens(
              empresaId,
              completo.fluxo.id,
              mudanca.etapaId,
              lista.especie,
              lista.linhas,
            );
          } else if (lista.alvo === "indicadores") {
            await escritas.salvarIndicadores(
              empresaId,
              completo.fluxo.id,
              mudanca.etapaId,
              lista.linhas,
            );
          } else if (lista.alvo === "acoes") {
            await escritas.salvarAcoes(
              empresaId,
              completo.fluxo.id,
              mudanca.etapaId,
              lista.linhas,
            );
          }
        }
        setGravadas((n) => n + 1);
      }
    },
    onSuccess: () => {
      aoConcluir();
      setPlano(null);
    },
    /* A falha mantém o diálogo aberto: o plano continua na tela, e a frase diz
       em que etapa a gravação parou — o que entrou, entrou. */
  });

  function escolher() {
    entrada.current?.click();
  }

  function fechar() {
    if (gravar.isPending) return;
    setPlano(null);
    gravar.reset();
  }

  const campoDeArquivo = (
    <input
      ref={entrada}
      type="file"
      accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      className="hidden"
      onChange={(evento) => {
        const arquivo = evento.target.files?.[0];
        /*
          O valor é limpo depois de ler: sem isso, escolher **o mesmo** arquivo
          de novo (a pessoa corrigiu a planilha e salvou por cima) não dispara
          `change`, e a tela parece travada.
        */
        evento.target.value = "";
        if (arquivo) void abrirArquivo(arquivo);
      }}
    />
  );

  return {
    escolher,
    fechar,
    limparErro: () => setErro(null),
    campoDeArquivo,
    lendo,
    plano,
    erro,
    gravar,
    gravadas,
  };
}

export type Importador = ReturnType<typeof useImportadorDoModelo>;

/** O gatilho da barra larga. Só o botão: o diálogo é da página. */
export function BotaoDeImportarModelo({
  importador,
  desabilitado,
}: {
  importador: Importador;
  desabilitado?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={desabilitado || importador.lendo}
      onClick={importador.escolher}
    >
      {importador.lendo ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Upload className="mr-1.5 h-3.5 w-3.5" />
      )}
      Importar modelo
    </Button>
  );
}

/** O mesmo gesto dentro de "Mais ações", na tela estreita. */
export function ItemDeImportarModelo({
  importador,
  desabilitado,
}: {
  importador: Importador;
  desabilitado?: boolean;
}) {
  return (
    <DropdownMenuItem disabled={desabilitado} onSelect={() => importador.escolher()}>
      <Upload className="mr-2 h-4 w-4" />
      Importar modelo
    </DropdownMenuItem>
  );
}

/**
 * O campo de arquivo e o plano na tela — montados uma vez, no nível da página.
 *
 * O `<input type="file">` vem junto porque ele é o par do diálogo: os dois são
 * o que a importação mostra, e nenhum dos dois pode depender da largura da
 * janela para existir.
 */
export function DialogoDaImportacao({ importador }: { importador: Importador }) {
  const { plano, fechar, limparErro, erro, gravar, gravadas, campoDeArquivo } = importador;

  return (
    <>
      {campoDeArquivo}
      <ConteudoDoDialogo
        plano={plano}
        fechar={fechar}
        limparErro={limparErro}
        erro={erro}
        gravar={gravar}
        gravadas={gravadas}
      />
    </>
  );
}

type Dialogo = Pick<
  Importador,
  "plano" | "fechar" | "limparErro" | "erro" | "gravar" | "gravadas"
>;

/** O plano na tela: o que muda, o que não foi reconhecido, e nada gravado ainda. */
function ConteudoDoDialogo({ plano, fechar, limparErro, erro, gravar, gravadas }: Dialogo) {
  if (erro && !plano) {
    return (
      <Dialog open onOpenChange={(v) => !v && limparErro()} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Não deu para ler a planilha</DialogTitle>
        </DialogHeader>
        <Alert variant="destructive">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="ghost" onClick={limparErro}>
            Fechar
          </Button>
        </DialogFooter>
      </Dialog>
    );
  }
  if (!plano) return null;

  const tamanho = tamanhoDoPlano(plano);
  const nadaAMudar = plano.mudancas.length === 0;

  return (
    <Dialog open onOpenChange={(v) => !v && fechar()} className="max-h-[85vh] max-w-3xl overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Importar o modelo preenchido</DialogTitle>
        <DialogDescription>
          {nadaAMudar
            ? "A planilha não traz nada diferente do que já está cadastrado."
            : `${tamanho.etapas} ${tamanho.etapas === 1 ? "etapa" : "etapas"} a atualizar · ${
                tamanho.campos
              } ${tamanho.campos === 1 ? "campo" : "campos"} · ${tamanho.listas} ${
                tamanho.listas === 1 ? "lista" : "listas"
              }. Nada é gravado antes de você confirmar.`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {plano.mudancas.map((mudanca) => (
          <MudancaNaTela key={mudanca.etapaId} mudanca={mudanca} />
        ))}

        {plano.semMudanca.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Sem novidade em {plano.semMudanca.length}{" "}
            {plano.semMudanca.length === 1 ? "aba" : "abas"}: {plano.semMudanca.join(", ")}.
          </p>
        )}

        {(plano.naoReconhecidas.length > 0 || plano.avisos.length > 0) && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <ul className="space-y-1 text-xs">
                {plano.naoReconhecidas.length > 0 && (
                  <li>
                    Não reconheci a que etapa {plano.naoReconhecidas.length === 1 ? "a aba" : "as abas"}{" "}
                    {plano.naoReconhecidas.map((a) => `"${a}"`).join(", ")}{" "}
                    {plano.naoReconhecidas.length === 1 ? "corresponde" : "correspondem"} — nada foi
                    lido {plano.naoReconhecidas.length === 1 ? "dela" : "delas"}. Aba nova não cria
                    etapa: use "Nova etapa" e exporte o modelo de novo.
                  </li>
                )}
                {plano.avisos.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {gravar.isError && (
          <Alert variant="destructive">
            <AlertDescription>
              {fraseDoErro(gravar.error)} — {gravadas}{" "}
              {gravadas === 1 ? "etapa foi gravada" : "etapas foram gravadas"} antes da falha.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={fechar} disabled={gravar.isPending}>
          {nadaAMudar ? "Fechar" : "Cancelar"}
        </Button>
        {!nadaAMudar && (
          <Button onClick={() => gravar.mutate()} disabled={gravar.isPending}>
            {gravar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {gravar.isPending
              ? `Gravando ${gravadas + 1} de ${plano.mudancas.length}…`
              : `Gravar ${plano.mudancas.length} ${
                  plano.mudancas.length === 1 ? "etapa" : "etapas"
                }`}
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}

/** Uma etapa do plano: como foi reconhecida, e o que muda dentro dela. */
function MudancaNaTela({ mudanca }: { mudanca: MudancaDaEtapa }) {
  return (
    <section className="rounded-md border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{mudanca.nome}</h3>
        <span className="text-xs text-muted-foreground">aba {mudanca.aba}</span>
        {/*
          O selo só aparece quando o rodapé com o id não estava lá. Reconhecer
          pelo número da aba ou pelo nome é palpite razoável, e quem confirma
          merece saber que foi palpite — é a diferença entre gravar na etapa
          certa e gravar na vizinha.
        */}
        {mudanca.reconhecidaPor !== "id" && (
          <Badge variant="outline" className="font-normal">
            {mudanca.reconhecidaPor === "numero"
              ? "reconhecida pela posição da aba"
              : "reconhecida pelo nome"}
          </Badge>
        )}
      </div>

      <ul className="space-y-1">
        {mudanca.campos.map((campo) => (
          <li key={campo.rotulo} className="flex flex-wrap items-baseline gap-1.5 text-sm">
            <span className="text-muted-foreground">{campo.rotulo}:</span>
            <span className="text-muted-foreground line-through">
              {campo.de.trim() === "" ? "(vazio)" : campo.de}
            </span>
            <ArrowRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="text-foreground">{campo.para}</span>
          </li>
        ))}
        {mudanca.listas.map((lista) => (
          <li key={lista.titulo} className="text-sm text-foreground">
            <span className="text-muted-foreground">{lista.titulo}:</span> {lista.de} →{" "}
            {lista.para} {lista.para === 1 ? "linha" : "linhas"}
          </li>
        ))}
      </ul>

      {mudanca.avisos.length > 0 && (
        <ul className="mt-2 space-y-1">
          {mudanca.avisos.map((aviso) => (
            <li key={aviso} className="text-xs text-destructive">
              {aviso}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
