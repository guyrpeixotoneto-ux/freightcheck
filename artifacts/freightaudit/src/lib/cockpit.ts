import type {
  ChangeGroup,
  CockpitView,
  GroupedView,
  PriorityItem,
  Severity,
} from "@/components/inicio/types";

/**
 * O que a tela do Acompanhamento faz com o cockpit que a API já entregou.
 *
 * Aqui não há regra de negócio nova: a criticidade, a ordem e o diagnóstico
 * vêm calculados de `lib/comparison/src/cockpit.ts`, onde são testados contra o
 * export real. Este arquivo faz três coisas, e só elas:
 *
 * 1. **Juntar** cada item da fila ao grupo que ele descreve, por chave.
 * 2. **Filtrar** a fila pelo recorte escolhido — sem nunca reordenar, porque a
 *    ordem é resposta do produto e não do filtro.
 * 3. **Contar** quantos itens cada recorte tem, para que nenhum botão de
 *    filtro prometa um resultado vazio.
 *
 * São funções puras de propósito: é o que permite testá-las sem navegador.
 */

export type Foco = "TODOS" | "ATENCAO" | "IMPACTO" | "SEM_PRECO" | "ANOMALIA";

export interface FiltroCockpit {
  foco: Foco;
  /** `CAVALO`, `CARRETA`… ou `null` para todos os equipamentos. */
  equipamento: string | null;
  /** Uma criticidade só, quando alguém clica no panorama. */
  severidade: Severity | null;
  /** Um selo só — `RUPTURA`, `DINHEIRO`… — pelo mesmo caminho. */
  selo: string | null;
  busca: string;
}

export const FILTRO_VAZIO: FiltroCockpit = {
  foco: "TODOS",
  equipamento: null,
  severidade: null,
  selo: null,
  busca: "",
};

/** Se algum recorte está ativo — o que decide mostrar o botão de limpar. */
export function filtroAtivo(filtro: FiltroCockpit): boolean {
  return (
    filtro.foco !== "TODOS" ||
    filtro.equipamento !== null ||
    filtro.severidade !== null ||
    filtro.selo !== null ||
    filtro.busca.trim() !== ""
  );
}

export interface ItemCockpit {
  item: PriorityItem;
  group: ChangeGroup;
}

export const FOCO_LABEL: Record<Foco, string> = {
  TODOS: "Todos",
  ATENCAO: "Exigem atenção",
  IMPACTO: "Com impacto financeiro",
  SEM_PRECO: "Sem preço",
  ANOMALIA: "Com anomalia",
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICO: "Crítico",
  ALTO: "Alto",
  MEDIO: "Médio",
  BAIXO: "Baixo",
};

/**
 * A fila com o grupo de cada item ao lado.
 *
 * Um item sem grupo correspondente é descartado — e isso nunca deveria
 * acontecer, porque as duas listas nascem da mesma resposta. Descartar é
 * preferível a renderizar um cartão sem conteúdo: a fila continua completa do
 * lado do servidor, e o teste garante que os tamanhos batem.
 */
export function juntarPrioridades(
  view: Pick<GroupedView, "groups"> & { cockpit: Pick<CockpitView, "priorities"> },
): ItemCockpit[] {
  const porChave = new Map(view.groups.map((g) => [g.key, g]));
  return view.cockpit.priorities
    .map((item) => {
      const group = porChave.get(item.key);
      return group ? { item, group } : null;
    })
    .filter((entry): entry is ItemCockpit => entry !== null);
}

/** Se um item cabe no recorte. Uma função só, para filtro e contagem usarem a mesma regra. */
export function cabeNoFoco(entry: ItemCockpit, foco: Foco): boolean {
  switch (foco) {
    case "ATENCAO":
      return entry.item.severity === "CRITICO" || entry.item.severity === "ALTO";
    case "IMPACTO":
      return entry.item.hasImpact;
    case "SEM_PRECO":
      // Sem preço é `amount === null`: impacto apurado de R$ 0,00 é uma
      // resposta calculada, e juntá-lo aqui apagaria a diferença entre "vale
      // zero" e "não sabemos quanto vale".
      return entry.group.impact.amount === null;
    case "ANOMALIA":
      return entry.item.hasAnomaly;
    case "TODOS":
      return true;
  }
}

export function filtrarPrioridades(
  entries: ItemCockpit[],
  filtro: FiltroCockpit,
): ItemCockpit[] {
  const termo = filtro.busca.trim().toLowerCase();
  return entries.filter((entry) => {
    if (!cabeNoFoco(entry, filtro.foco)) return false;
    if (filtro.equipamento !== null && entry.group.entityType !== filtro.equipamento) {
      return false;
    }
    if (filtro.severidade !== null && entry.item.severity !== filtro.severidade) return false;
    if (filtro.selo !== null && entry.group.badge !== filtro.selo) return false;
    if (termo) {
      const alvo = `${entry.group.title} ${entry.group.attributeCode ?? ""} ${
        entry.group.equipment
      }`.toLowerCase();
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/**
 * Quantos itens cada recorte tem, já considerando equipamento e busca.
 *
 * Existe para que o botão "Sem preço" nunca leve a uma lista vazia sem avisar
 * antes: a contagem sai escrita no próprio botão.
 */
export function contarFocos(
  entries: ItemCockpit[],
  filtro: FiltroCockpit,
): Record<Foco, number> {
  const base = filtrarPrioridades(entries, { ...filtro, foco: "TODOS" });
  const focos: Foco[] = ["TODOS", "ATENCAO", "IMPACTO", "SEM_PRECO", "ANOMALIA"];
  return Object.fromEntries(
    focos.map((foco) => [foco, base.filter((e) => cabeNoFoco(e, foco)).length]),
  ) as Record<Foco, number>;
}

/** Os equipamentos presentes na vigência, na ordem em que o panorama os traz. */
export function equipamentosDisponiveis(
  view: { cockpit: Pick<CockpitView, "panorama"> },
): { entityType: string; equipment: string }[] {
  return view.cockpit.panorama.byEquipment
    .filter((b): b is typeof b & { entityType: string } => b.entityType !== null)
    .map((b) => ({ entityType: b.entityType, equipment: b.equipment }));
}
