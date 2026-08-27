import { useState } from "react";
import { Download, FileImage, FileText, Loader2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { salvarArquivo } from "@/lib/api";
import {
  fluxoComoPdf,
  fluxoComoPng,
  fluxoComoSvg,
  nomeDoArquivo,
  type OpcoesDaExportacao,
} from "@/lib/fluxos-exportar";
import { fraseDoErro, type Catalogo, type FluxoCompleto } from "@/lib/fluxos";

/**
 * EXPORTAR — o fluxograma virando arquivo, em três formatos.
 *
 * PNG para colar num slide ou num chamado; PDF para anexar e imprimir; SVG para
 * quem vai abrir num editor de desenho e mexer. Os três saem do **mesmo** SVG
 * montado em `lib/fluxos-exportar.ts`, então nenhum deles pode divergir dos
 * outros: o que aparece no PNG aparece no PDF.
 *
 * O trabalho acontece no navegador de quem pediu — não há rota, não há fila e
 * não há arquivo guardado no servidor. Exportar é ler o que já está na tela e
 * escrever bytes; mandar isso para o servidor seria inventar uma ida de rede,
 * um formato de resposta e um lugar para o arquivo morar, sem ganho nenhum.
 *
 * O estado de "gerando" existe porque a rasterização de um processo grande leva
 * um instante perceptível, e um botão que não responde é um botão que a pessoa
 * clica três vezes.
 */
export function BotaoDeExportar({
  completo,
  catalogo,
  empresa,
}: {
  completo: FluxoCompleto;
  catalogo: Catalogo | undefined;
  /** O nome da empresa dona do processo, para o cabeçalho do arquivo. */
  empresa?: string | null;
}) {
  const [gerando, setGerando] = useState<null | "png" | "pdf" | "svg">(null);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar(formato: "png" | "pdf" | "svg") {
    setGerando(formato);
    setErro(null);
    try {
      /*
        A data é lida aqui, e passada adiante. As funções de montagem são puras
        e não conhecem o relógio — é o que as torna testáveis e o que faz duas
        exportações do mesmo fluxo no mesmo dia produzirem o mesmo arquivo.
      */
      const opcoes: OpcoesDaExportacao = {
        exportadoEm: new Date().toISOString(),
        empresa: empresa ?? null,
      };
      const blob =
        formato === "png"
          ? await fluxoComoPng(completo, catalogo, opcoes)
          : formato === "pdf"
            ? await fluxoComoPdf(completo, catalogo, opcoes)
            : fluxoComoSvg(completo, catalogo, opcoes);
      salvarArquivo(blob, nomeDoArquivo(completo.fluxo, formato, opcoes.exportadoEm!));
    } catch (falha) {
      setErro(fraseDoErro(falha));
    } finally {
      setGerando(null);
    }
  }

  const vazio = completo.etapas.length === 0;

  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" disabled={vazio || gerando !== null}>
            {gerando ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-3.5 w-3.5" />
            )}
            Exportar
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
            O fluxo inteiro, enquadrado — não o que está na tela.
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => void exportar("png")}>
            <FileImage className="mr-2 h-4 w-4" />
            <span className="flex-1">Imagem (PNG)</span>
            <span className="text-xs text-muted-foreground">slide</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void exportar("pdf")}>
            <FileText className="mr-2 h-4 w-4" />
            <span className="flex-1">Documento (PDF)</span>
            <span className="text-xs text-muted-foreground">anexo</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void exportar("svg")}>
            <Shapes className="mr-2 h-4 w-4" />
            <span className="flex-1">Vetor (SVG)</span>
            <span className="text-xs text-muted-foreground">editar</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        A falha aparece presa ao botão, e não numa faixa no topo da tela: quem
        acabou de clicar em "Exportar" está olhando para cá.
      */}
      {erro && (
        <p
          role="alert"
          className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-destructive/40 bg-card p-2 text-xs text-destructive shadow"
        >
          {erro}
        </p>
      )}
    </div>
  );
}
