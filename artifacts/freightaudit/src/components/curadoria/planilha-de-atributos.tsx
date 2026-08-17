import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getApiUrl } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * A curadoria em planilha, na tela.
 *
 * Dois botões e uma conversa curta: baixe o modelo, preencha no Excel, mande de
 * volta. O que esta tela precisa dizer, e diz em três lugares diferentes porque
 * é a coisa mais fácil de entender errado: **preencher a planilha não confirma
 * atributo nenhum.** Quem preenche "O que este valor representa" está deixando
 * a resposta pronta na tela, não destravando cálculo financeiro.
 *
 * A prévia não é confirmação de cortesia. Um arquivo que passou por três
 * pessoas e um "salvar como" chega com coluna trocada e acento perdido, e a
 * diferença entre "12 campos mudam" e "480 campos mudam" é a diferença entre
 * aplicar e abrir o arquivo de novo. Por isso o botão de gravar só existe
 * depois de a prévia ter sido lida — e o servidor reconfere o arquivo ao
 * aplicar, porque a prévia é uma cortesia da tela e não uma autoridade.
 */

interface MudancaDeCampo {
  campo: string;
  de: string | null;
  para: string;
}

interface LinhaConferida {
  aba: string;
  linha: number;
  code: string;
  desfecho: "MUDA" | "IGUAL" | "SEM_CODIGO" | "SEM_ATRIBUTO";
  mudancas: MudancaDeCampo[];
  problemas: string[];
}

interface Conferencia {
  linhas: LinhaConferida[];
  resumo: {
    mudam: number;
    campos: number;
    iguais: number;
    ignoradas: number;
    naoEntendidas: number;
  };
}

interface Aplicacao {
  gravadas: number;
  campos: number;
  recusadas: { code: string; motivo: string }[];
}

const ROTULO_DO_CAMPO: Record<string, string> = {
  displayName: "Nome gerencial",
  definition: "O que é",
  calculationBasis: "Fórmula de cálculo",
  significado: "O que este valor representa",
  categoria: "Categoria",
};

/** O arquivo em base64 dentro de JSON — o mesmo caminho da tela de importações. */
async function paraBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binario = "";
  const BLOCO = 32768;
  for (let i = 0; i < bytes.length; i += BLOCO) {
    binario += String.fromCharCode(...bytes.subarray(i, i + BLOCO));
  }
  return btoa(binario);
}

export function PlanilhaDeAtributos() {
  const queryClient = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const [aberto, setAberto] = useState(false);
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [aplicacao, setAplicacao] = useState<Aplicacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  /*
    O arquivo fica guardado entre a prévia e a aplicação porque as duas o
    reenviam: o servidor relê e reconfere na hora de gravar, em vez de acreditar
    num diff calculado aqui. Guardado como `File` — e não como base64 — para não
    ter o arquivo inteiro duas vezes na memória da aba.
  */
  const [arquivoLido, setArquivoLido] = useState<File | null>(null);

  const fechar = () => {
    setAberto(false);
    setArquivo(null);
    setConferencia(null);
    setAplicacao(null);
    setErro(null);
  };

  const enviar = async (caminho: "previa" | "aplicar", file: File) => {
    const response = await fetch(getApiUrl(`/curation/atributos/modelo/${caminho}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, contentBase64: await paraBase64(file) }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Falha ao ler a planilha.");
    return body;
  };

  const conferir = useMutation({
    mutationFn: async (file: File) => {
      setArquivoLido(file);
      return (await enviar("previa", file)) as Conferencia;
    },
    onSuccess: (body) => {
      setErro(null);
      setConferencia(body);
      setAplicacao(null);
    },
    onError: (err: Error) => {
      setErro(err.message);
      setConferencia(null);
    },
  });

  const aplicar = useMutation({
    mutationFn: async () => {
      if (!arquivoLido) throw new Error("Escolha a planilha preenchida.");
      return (await enviar("aplicar", arquivoLido)) as Aplicacao;
    },
    onSuccess: (body) => {
      setErro(null);
      setAplicacao(body);
      queryClient.invalidateQueries({ queryKey: ["curation"] });
    },
    onError: (err: Error) => setErro(err.message),
  });

  const mudancas = (conferencia?.linhas ?? []).filter((l) => l.desfecho === "MUDA");
  /*
    Uma linha pode estar nas duas listas, e é assim que tem de ser: quem
    escreveu a descrição certa e errou a categoria vê a descrição em "vai ser
    gravado" e a categoria em "não entendi". Mostrar só uma das duas obrigaria a
    pessoa a descobrir sozinha o que aconteceu com o resto da linha.
  */
  const comProblema = (conferencia?.linhas ?? []).filter((l) => l.problemas.length > 0);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {/* Navegação, e não `fetch`: o servidor responde com
            `Content-Disposition: attachment`, então o navegador baixa o arquivo
            com o nome que ele manda e a página não sai do lugar — sem os bytes
            passarem pela memória da aba.

            E `<Button>` de verdade, não `asChild`: o componente deste projeto
            não implementa a prop, e um `<a>` dentro de um `<button>` é HTML
            inválido. */}
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            window.location.assign(getApiUrl("/curation/atributos/modelo.xlsx"))
          }
        >
          <Download className="h-4 w-4" />
          Baixar modelo (.xlsx)
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setAberto(true)}
        >
          <Upload className="h-4 w-4" />
          Enviar preenchida
        </Button>
        <span className="text-xs text-muted-foreground">
          Descreve em lote. Não confirma nada.
        </span>
      </div>

      <Dialog open={aberto} onOpenChange={(v) => (v ? setAberto(true) : fechar())}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-primary" />
            Planilha de atributos
          </DialogTitle>
          <DialogDescription>
            Grava nome gerencial, descrição, fórmula, significado e categoria. Não
            confirma atributo nenhum e não destrava cálculo financeiro — isso
            continua sendo um ato de tela, com justificativa assinada.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={entrada}
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) conferir.mutate(file);
            e.target.value = "";
          }}
        />

        <div className="space-y-4 max-h-[55vh] overflow-y-auto">
          {!conferencia && !aplicacao && (
            <Button
              variant="outline"
              className="w-full gap-1.5"
              onClick={() => entrada.current?.click()}
              disabled={conferir.isPending}
            >
              <Upload className="h-4 w-4" />
              {conferir.isPending ? "Conferindo…" : "Escolher a planilha preenchida"}
            </Button>
          )}

          {erro && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {erro}
            </p>
          )}

          {conferencia && !aplicacao && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Quadro
                  valor={conferencia.resumo.campos}
                  rotulo={conferencia.resumo.campos === 1 ? "campo muda" : "campos mudam"}
                  tom="bom"
                />
                <Quadro valor={conferencia.resumo.iguais} rotulo="sem mudança" tom="neutro" />
                <Quadro
                  valor={conferencia.resumo.ignoradas + conferencia.resumo.naoEntendidas}
                  rotulo="não entendi"
                  tom={
                    conferencia.resumo.ignoradas + conferencia.resumo.naoEntendidas > 0
                      ? "aviso"
                      : "neutro"
                  }
                />
              </div>

              {mudancas.length > 0 && (
                <div className="rounded-md border">
                  <div className="border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    O que vai ser gravado
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {mudancas.map((linha) => (
                      <div key={`${linha.aba}-${linha.linha}`} className="border-b px-3 py-2 last:border-0">
                        <div className="font-mono text-xs">{linha.code}</div>
                        {linha.mudancas.map((mudanca, i) => (
                          <div key={i} className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {ROTULO_DO_CAMPO[mudanca.campo] ?? mudanca.campo}:
                            </span>{" "}
                            {mudanca.de ? (
                              <>
                                <span className="line-through">{mudanca.de}</span> →{" "}
                              </>
                            ) : null}
                            {mudanca.para}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {comProblema.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50">
                  <div className="border-b border-amber-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-amber-800">
                    O que não entendi — e por isso não entra
                  </div>
                  <div className="max-h-40 overflow-y-auto">
                    {comProblema.map((linha) => (
                      <div
                        key={`${linha.aba}-${linha.linha}`}
                        className="border-b border-amber-200 px-3 py-2 text-xs text-amber-900 last:border-0"
                      >
                        <span className="font-mono">
                          {linha.aba} · linha {linha.linha}
                          {linha.code && ` · ${linha.code}`}
                        </span>
                        {linha.problemas.map((problema, i) => (
                          <div key={i}>{problema}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {mudancas.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Esta planilha não muda nada do que já está gravado.
                </p>
              )}
            </>
          )}

          {aplicacao && (
            <div className="space-y-3">
              <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                {aplicacao.campos === 0
                  ? "Nada foi alterado."
                  : `${aplicacao.campos} ${aplicacao.campos === 1 ? "campo gravado" : "campos gravados"} em ${aplicacao.gravadas} ${aplicacao.gravadas === 1 ? "atributo" : "atributos"}.`}{" "}
                Nenhum status mudou — isto não é uma confirmação.
              </p>
              {aplicacao.recusadas.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
                  {aplicacao.recusadas.map((recusa, i) => (
                    <div key={i}>
                      <span className="font-mono">{recusa.code}</span>: {recusa.motivo}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={fechar}>
            {aplicacao ? "Fechar" : "Cancelar"}
          </Button>
          {conferencia && !aplicacao && (
            <Button
              onClick={() => aplicar.mutate()}
              disabled={aplicar.isPending || mudancas.length === 0}
            >
              {aplicar.isPending
                ? "Gravando…"
                : `Gravar ${conferencia.resumo.campos} ${conferencia.resumo.campos === 1 ? "campo" : "campos"}`}
            </Button>
          )}
        </DialogFooter>
      </Dialog>
    </>
  );
}

function Quadro({
  valor,
  rotulo,
  tom,
}: {
  valor: number;
  rotulo: string;
  tom: "bom" | "aviso" | "neutro";
}) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div
        className={cn(
          "text-xl font-bold tabular-nums",
          tom === "bom" && "text-emerald-700",
          tom === "aviso" && "text-amber-700",
        )}
      >
        {valor}
      </div>
      <div className="text-xs text-muted-foreground">{rotulo}</div>
    </div>
  );
}
