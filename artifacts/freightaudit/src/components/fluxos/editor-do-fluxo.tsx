import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { escritas, fraseDoErro, type Catalogo, type Fluxo } from "@/lib/fluxos";

/**
 * O CABEÇALHO DO FLUXO — criar e editar, no mesmo formulário.
 *
 * Um só diálogo para os dois atos, porque os campos são os mesmos e a diferença
 * é só o verbo do botão. Dois formulários idênticos seriam dois lugares para o
 * campo novo ser esquecido em um deles.
 *
 * **A categoria é livre, e sugerida.** Não há tabela de categorias e não há
 * lista fechada no código: o que a caixa oferece são as categorias que já
 * existem nos fluxos desta empresa, e digitar uma nova cria uma nova. É a mesma
 * decisão do schema — a lista de categorias de processo de uma empresa muda mais
 * rápido do que qualquer migration acompanha.
 *
 * **O endereço (`slug`) não é editável aqui.** Ele é derivado do nome no
 * servidor, uma vez, e mudá-lo quebraria os links guardados para o fluxo. Quem
 * renomeia o fluxo mantém o endereço, que é o comportamento certo.
 */
export function EditorDoFluxo({
  aberto,
  fluxo,
  empresaId,
  catalogo,
  categoriasConhecidas,
  aoFechar,
  aoSalvar,
}: {
  aberto: boolean;
  /** `null` cria; preenchido, edita. */
  fluxo: Fluxo | null;
  empresaId: string | null;
  catalogo: Catalogo | undefined;
  categoriasConhecidas: string[];
  aoFechar: () => void;
  aoSalvar: (fluxo: Fluxo) => void;
}) {
  const [nome, setNome] = useState(fluxo?.nome ?? "");
  const [categoria, setCategoria] = useState(fluxo?.categoria ?? "");
  const [status, setStatus] = useState(fluxo?.status ?? "RASCUNHO");
  const [dono, setDono] = useState(fluxo?.dono ?? "");
  const [descricao, setDescricao] = useState(fluxo?.descricao ?? "");
  const [objetivo, setObjetivo] = useState(fluxo?.objetivo ?? "");

  const salvar = useMutation({
    mutationFn: () => {
      const corpo = { nome, categoria, status, dono, descricao, objetivo };
      return fluxo
        ? escritas.atualizarFluxo(empresaId, fluxo.id, corpo)
        : escritas.criarFluxo(empresaId, corpo);
    },
    onSuccess: (gravado) => {
      aoSalvar(gravado);
      aoFechar();
    },
  });

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{fluxo ? "Editar fluxo" : "Novo fluxo operacional"}</DialogTitle>
          <DialogDescription>
            Um processo ponta a ponta. As etapas e as ligações entre elas são desenhadas depois, no
            fluxograma.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="fluxo-nome">Nome</Label>
            <Input
              id="fluxo-nome"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="NF até pagamento"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="fluxo-categoria">Categoria</Label>
              {/*
                Campo de texto com sugestões nativas, e não um seletor.
                Categoria é livre — a lista abaixo é o que já existe nesta
                empresa, oferecido para evitar "Financeiro" e "financeiro"
                convivendo por erro de digitação; digitar qualquer outra coisa
                cria uma categoria nova, sem cadastro prévio e sem migration.
              */}
              <Input
                id="fluxo-categoria"
                list="fluxo-categorias-conhecidas"
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                placeholder="Financeiro"
              />
              <datalist id="fluxo-categorias-conhecidas">
                {categoriasConhecidas.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            <div>
              <Label htmlFor="fluxo-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as Fluxo["status"])}>
                <SelectTrigger id="fluxo-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(catalogo?.statusDoFluxo ?? []).map((s) => (
                    <SelectItem key={s.valor} value={s.valor}>
                      {s.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="fluxo-dono">Dono do processo</Label>
            <Input
              id="fluxo-dono"
              value={dono}
              onChange={(e) => setDono(e.target.value)}
              placeholder="Faturamento"
            />
          </div>

          <div>
            <Label htmlFor="fluxo-descricao">Descrição</Label>
            <Textarea
              id="fluxo-descricao"
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="fluxo-objetivo">Objetivo</Label>
            <Textarea
              id="fluxo-objetivo"
              rows={2}
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              placeholder="Que pergunta este mapa responde?"
            />
          </div>
        </div>

        {salvar.isError && (
          <Alert variant="destructive">
            <AlertDescription>{fraseDoErro(salvar.error)}</AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={aoFechar} disabled={salvar.isPending}>
            Cancelar
          </Button>
          <Button
            onClick={() => salvar.mutate()}
            disabled={salvar.isPending || nome.trim() === "" || categoria.trim() === ""}
          >
            {salvar.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {fluxo ? "Salvar" : "Criar fluxo"}
          </Button>
        </DialogFooter>
    </Dialog>
  );
}
