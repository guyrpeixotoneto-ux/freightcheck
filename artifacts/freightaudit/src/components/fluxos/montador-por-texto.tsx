import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, ListPlus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { escritas, etapasDoRoteiro, fraseDoErro, type Fluxo } from "@/lib/fluxos";

/**
 * MONTAR POR TEXTO — o caminho rápido para desenhar um processo inteiro.
 *
 * O diálogo de etapa é bom para **descrever uma** etapa: identidade, sistemas,
 * documentos, falhas, gargalos, indicadores, ações. Ele é péssimo para
 * **levantar treze** — treze aberturas, treze fechamentos, e depois doze
 * arrastos para ligar um cartão no outro. É a fricção que deixa um fluxo criado
 * e vazio, que foi como este módulo foi encontrado.
 *
 * Aqui a pessoa cola a lista que já saiu da reunião, uma etapa por linha, e o
 * esqueleto inteiro nasce ligado e posicionado. O detalhe de cada etapa entra
 * depois, pelo painel — que é a ordem certa: primeiro o mapa, depois o detalhe.
 *
 * **A gramática não mora aqui.** O texto vai cru para `POST /fluxos/roteiro` (ou
 * `POST /fluxos/:id/roteiro`) e quem o interpreta é `interpretarRoteiro`, no
 * motor, com as mesmas validações do cadastro à mão. A tela conta linhas para
 * mostrar "13 etapas" enquanto se digita, e nada além — uma segunda gramática
 * no front aceitaria hoje o que o servidor recusa amanhã.
 */

const EXEMPLO = `[inicio] Origem da tarifa / trecho | Operação | Freitec/TMS
Validação da tarifa | Ambev / Operação | SAP
Solicitação de emissão | Ambev / Operação | SAP → Unidox
[documento] Emissão do documento | Ambev / Sistema | Unidox
[sistema] Integração com Rodopar | Sistemas / TI | Rodopar
+ [sistema] Integração com Connect | Sistemas / TI | Connect
[validacao] Auditoria fiscal | Fiscal | Rodopar × Unidox × SEFAZ
[fim] Conciliação bancária | Contas a receber / Financeiro`;

export interface MontadorPorTextoProps {
  empresaId: string | null;
  /**
   * `null` cria um fluxo novo com o roteiro; preenchido, acrescenta as etapas
   * ao fluxo que já existe.
   */
  fluxoId: string | null;
  categoriasConhecidas: string[];
  /** A etapa selecionada no canvas — o trecho novo nasce ligado a ela. */
  origem?: { id: string; nome: string } | null;
  aoFechar: () => void;
  /** Recebe o fluxo criado, quando houve criação. */
  aoConcluir: (fluxo: Fluxo | null) => void;
}

export function MontadorPorTexto({
  empresaId,
  fluxoId,
  categoriasConhecidas,
  origem = null,
  aoFechar,
  aoConcluir,
}: MontadorPorTextoProps) {
  const criando = fluxoId === null;

  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("");
  const [roteiro, setRoteiro] = useState("");
  const [ligarNaOrigem, setLigarNaOrigem] = useState(true);

  const quantas = etapasDoRoteiro(roteiro);

  const montar = useMutation({
    mutationFn: async (): Promise<Fluxo | null> => {
      if (criando) {
        return escritas.criarDeRoteiro(empresaId, { nome, categoria, roteiro });
      }
      await escritas.acrescentarRoteiro(empresaId, fluxoId, {
        roteiro,
        origem: origem && ligarNaOrigem ? origem.id : null,
      });
      return null;
    },
    onSuccess: (fluxo) => {
      aoConcluir(fluxo);
      aoFechar();
    },
  });

  const faltaCabecalho = criando && (nome.trim() === "" || categoria.trim() === "");

  return (
    <Dialog open onOpenChange={(v) => !v && aoFechar()} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {criando ? "Novo fluxo a partir de um roteiro" : "Acrescentar etapas por texto"}
        </DialogTitle>
        <DialogDescription>
          Uma etapa por linha, na ordem do processo. As ligações entre elas são criadas em
          sequência, e o desenho já nasce organizado.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {criando && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="roteiro-nome">Nome do fluxo</Label>
              <Input
                id="roteiro-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Operação empurrada — do faturamento ao recebimento"
              />
            </div>
            <div>
              <Label htmlFor="roteiro-categoria">Categoria</Label>
              <Input
                id="roteiro-categoria"
                list="roteiro-categorias-conhecidas"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Faturamento"
              />
              <datalist id="roteiro-categorias-conhecidas">
                {categoriasConhecidas.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
        )}

        <div>
          <div className="flex items-end justify-between">
            <Label htmlFor="roteiro-texto">Etapas</Label>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setRoteiro(EXEMPLO)}
            >
              Preencher com um exemplo
            </Button>
          </div>
          <Textarea
            id="roteiro-texto"
            rows={12}
            className="font-mono text-xs"
            value={roteiro}
            onChange={(e) => setRoteiro(e.target.value)}
            placeholder={EXEMPLO}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {quantas === 0
              ? "Nenhuma etapa ainda."
              : `${quantas} ${quantas === 1 ? "etapa" : "etapas"} neste roteiro.`}
          </p>
        </div>

        {/*
          A ajuda fica ao lado da caixa, e não atrás de um "saiba mais": a
          gramática tem quatro regras e esconder quatro regras num link é o que
          faz ninguém usar o campo que existe para poupar trabalho.
        */}
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Como escrever cada linha</p>
          <ul className="mt-1.5 space-y-1">
            <li>
              <code className="text-foreground">Nome | Área | Sistema</code> — área e sistema são
              opcionais.
            </li>
            <li>
              <code className="text-foreground">[decisao]</code>,{" "}
              <code className="text-foreground">[inicio]</code>,{" "}
              <code className="text-foreground">[fim]</code>,{" "}
              <code className="text-foreground">[documento]</code>,{" "}
              <code className="text-foreground">[sistema]</code>,{" "}
              <code className="text-foreground">[validacao]</code>,{" "}
              <code className="text-foreground">[pendencia]</code> no começo escolhem o tipo. Sem
              marcador, a etapa é um processo.
            </li>
            <li>
              <code className="text-foreground">+</code> no começo põe a etapa{" "}
              <strong className="text-foreground">em paralelo</strong> com a linha de cima — as
              duas nascem da mesma etapa anterior e se juntam de novo na linha seguinte.
            </li>
            <li>
              <code className="text-foreground">#</code> no começo é comentário e não vira etapa.
            </li>
          </ul>
          <p className="mt-2">
            Sistemas, documentos, responsáveis, falhas, gargalos e indicadores entram depois, no
            painel de cada etapa.
          </p>
        </div>

        {!criando && origem && (
          <label className="flex items-start gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={ligarNaOrigem}
              onChange={(e) => setLigarNaOrigem(e.target.checked)}
            />
            <span>
              Ligar a primeira etapa nova depois de{" "}
              <span className="font-medium text-foreground">{origem.nome}</span>. Sem isso, o
              trecho nasce solto e você liga onde quiser depois.
            </span>
          </label>
        )}
      </div>

      {montar.isError && (
        <Alert variant="destructive">
          <AlertDescription>{fraseDoErro(montar.error)}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={aoFechar} disabled={montar.isPending}>
          Cancelar
        </Button>
        <Button
          onClick={() => montar.mutate()}
          disabled={montar.isPending || quantas === 0 || faltaCabecalho}
        >
          {montar.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ListPlus className="mr-2 h-4 w-4" />
          )}
          {criando ? "Criar fluxo com estas etapas" : "Acrescentar etapas"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
