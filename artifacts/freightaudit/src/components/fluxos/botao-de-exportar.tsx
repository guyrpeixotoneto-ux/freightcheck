import { useState } from "react";
import { Download, FileImage, FileText, Loader2, Shapes } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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

type Formato = "png" | "pdf" | "svg";

type Exportacao = {
  completo: FluxoCompleto;
  catalogo: Catalogo | undefined;
  /** O nome da empresa dona do processo, para o cabeçalho do arquivo. */
  empresa?: string | null;
};

/*
  A exportação em si — o que os dois formatos de botão têm em comum.

  O mesmo fluxo aparece de duas maneiras conforme a largura da tela: como botão
  próprio na barra larga e como submenu dentro de "Mais ações" na estreita. O
  que muda é onde os três formatos são listados; o trabalho de gerar o arquivo,
  o estado de "gerando" e a frase do erro são um só, escritos uma vez aqui.
*/
function useExportacao({ completo, catalogo, empresa }: Exportacao) {
  const [gerando, setGerando] = useState<null | "png" | "pdf" | "svg">(null);
  const [erro, setErro] = useState<string | null>(null);

  async function exportar(formato: Formato) {
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

  return { exportar, gerando, erro, vazio: completo.etapas.length === 0 };
}

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
export function BotaoDeExportar(props: Exportacao) {
  const { exportar, gerando, erro, vazio } = useExportacao(props);

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
          <ItensDeFormato exportar={exportar} />
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

/**
 * EXPORTAR DENTRO DE UM MENU — a mesma exportação, quando não há barra.
 *
 * Na tela estreita as ações do fluxo moram em "Mais ações", e um botão de
 * exportar solto ali dentro seria um botão dentro de um menu. Aqui os três
 * formatos viram um submenu do menu que já está aberto: mesmo gesto, mesma
 * ordem, mesmos rótulos — só um nível mais fundo.
 *
 * O erro aparece como uma linha do próprio submenu porque não existe botão na
 * tela para pendurá-lo, e os itens não fecham o menu ao serem escolhidos: quem
 * pediu um PDF precisa continuar vendo o "gerando" e a frase da falha.
 */
export function SubmenuDeExportar(props: Exportacao) {
  const { exportar, gerando, erro, vazio } = useExportacao(props);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={vazio || gerando !== null}>
        {gerando ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        Exportar
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className="w-64">
          <DropdownMenuLabel className="font-normal text-xs text-muted-foreground">
            O fluxo inteiro, enquadrado — não o que está na tela.
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <ItensDeFormato exportar={exportar} manterAberto />
          {erro && (
            <p role="alert" className="px-2 py-1.5 text-xs text-destructive">
              {erro}
            </p>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

/** Os três formatos, na mesma ordem nos dois lugares em que aparecem. */
function ItensDeFormato({
  exportar,
  manterAberto,
}: {
  exportar: (formato: Formato) => void;
  manterAberto?: boolean;
}) {
  const escolher = (formato: Formato) => (evento: Event) => {
    if (manterAberto) evento.preventDefault();
    void exportar(formato);
  };

  return (
    <>
      <DropdownMenuItem onSelect={escolher("png")}>
        <FileImage className="mr-2 h-4 w-4" />
        <span className="flex-1">Imagem (PNG)</span>
        <span className="text-xs text-muted-foreground">slide</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={escolher("pdf")}>
        <FileText className="mr-2 h-4 w-4" />
        <span className="flex-1">Documento (PDF)</span>
        <span className="text-xs text-muted-foreground">anexo</span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={escolher("svg")}>
        <Shapes className="mr-2 h-4 w-4" />
        <span className="flex-1">Vetor (SVG)</span>
        <span className="text-xs text-muted-foreground">editar</span>
      </DropdownMenuItem>
    </>
  );
}
