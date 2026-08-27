import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * A LISTA EDITÁVEL — um componente para as sete listas do editor.
 *
 * Sistemas, documentos, responsáveis, falhas, gargalos, indicadores e ações têm
 * a mesma forma na tela: linhas com um nome, campos opcionais, um botão de
 * remover e um "+ Adicionar". Sete componentes idênticos seriam sete lugares
 * para corrigir o mesmo defeito de foco, e — mais importante — o oitavo tipo de
 * lista exigiria um oitavo componente.
 *
 * Aqui a diferença entre elas é **dado**: `colunas` descreve quais campos a
 * linha tem. Acrescentar uma espécie nova ao catálogo do servidor passa a não
 * exigir nada da interface, que é o teste arquitetural deste módulo aplicado à
 * tela.
 *
 * A edição é local: nada é gravado enquanto o diálogo está aberto. Quem grava é
 * o editor da etapa, de uma vez, pelo contrato de substituição da lista inteira
 * (ver `substituirItens` no motor). É o que faz "adicionar três, remover um e
 * desistir" não deixar rastro.
 */

export interface ColunaDaLista<T> {
  campo: keyof T & string;
  rotulo: string;
  /** Quanto espaço a coluna ocupa na linha. `1` é o padrão. */
  peso?: number;
  tipo?: "texto" | "booleano" | "escolha";
  opcoes?: { valor: string; rotulo: string }[];
  placeholder?: string;
}

export function ListaEditavel<T extends Record<string, unknown>>({
  titulo,
  descricao,
  itens,
  colunas,
  aoMudar,
  linhaNova,
  rotuloDeAdicionar,
}: {
  titulo: string;
  descricao?: string;
  itens: T[];
  colunas: ColunaDaLista<T>[];
  aoMudar: (itens: T[]) => void;
  linhaNova: () => T;
  rotuloDeAdicionar?: string;
}) {
  const trocar = (indice: number, campo: string, valor: unknown) => {
    aoMudar(itens.map((item, i) => (i === indice ? { ...item, [campo]: valor } : item)));
  };

  return (
    <div className="space-y-2">
      <div>
        <Label className="text-sm font-medium">{titulo}</Label>
        {descricao && <p className="text-xs text-muted-foreground">{descricao}</p>}
      </div>

      {itens.length > 0 && (
        <div className="space-y-1.5">
          {itens.map((item, indice) => (
            // eslint-disable-next-line react/no-array-index-key -- a linha não
            // tem identidade até ser gravada; o índice É a identidade dela aqui,
            // e a lista só muda por ação de quem edita.
            <div key={indice} className="flex items-center gap-1.5">
              {colunas.map((coluna) => {
                const valor = item[coluna.campo];
                if (coluna.tipo === "booleano") {
                  return (
                    <label
                      key={coluna.campo}
                      className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground"
                    >
                      <Checkbox
                        checked={valor === true}
                        onCheckedChange={(marcado) =>
                          trocar(indice, coluna.campo, marcado === true)
                        }
                      />
                      {coluna.rotulo}
                    </label>
                  );
                }
                if (coluna.tipo === "escolha") {
                  return (
                    <Select
                      key={coluna.campo}
                      value={typeof valor === "string" ? valor : ""}
                      onValueChange={(v) => trocar(indice, coluna.campo, v)}
                    >
                      <SelectTrigger className="h-9 w-[150px] shrink-0">
                        <SelectValue placeholder={coluna.rotulo} />
                      </SelectTrigger>
                      <SelectContent>
                        {(coluna.opcoes ?? []).map((o) => (
                          <SelectItem key={o.valor} value={o.valor}>
                            {o.rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                }
                return (
                  <Input
                    key={coluna.campo}
                    className="h-9"
                    style={{ flex: coluna.peso ?? 1 }}
                    value={typeof valor === "string" ? valor : ""}
                    placeholder={coluna.placeholder ?? coluna.rotulo}
                    aria-label={`${coluna.rotulo} — linha ${indice + 1}`}
                    onChange={(e) => trocar(indice, coluna.campo, e.target.value)}
                  />
                );
              })}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 shrink-0"
                aria-label={`Remover a linha ${indice + 1}`}
                onClick={() => aoMudar(itens.filter((_, i) => i !== indice))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => aoMudar([...itens, linhaNova()])}
      >
        <Plus className="mr-1.5 h-3.5 w-3.5" />
        {rotuloDeAdicionar ?? "Adicionar"}
      </Button>
    </div>
  );
}
