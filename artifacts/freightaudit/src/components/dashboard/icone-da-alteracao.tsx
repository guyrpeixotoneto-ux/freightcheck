import {
  DollarSign,
  Fuel,
  ShieldCheck,
  Tag,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ChangeGroup } from "@/components/inicio/types";

/**
 * O ícone decorativo de uma linha de "Principais alterações" — uma pista
 * visual do tipo de mudança, ao lado do nome que já diz isso por extenso.
 *
 * A régua é palavra-chave em `taxonomyName`/`attributeCode` (o texto de
 * negócio que o servidor já curou), nunca um mapa por `costClass` — `costClass`
 * só distingue FIXO/VARIAVEL/SEM_CLASSE, granularidade nenhuma para separar
 * combustível de manutenção.
 *
 * Decorativo por definição: quando nada bate, cai no rótulo neutro (`Tag`) em
 * vez de arriscar um ícone específico errado — um cifrão em cima de uma
 * mudança de pessoal engana mais do que uma etiqueta cinza.
 */
const REGRAS: { icone: LucideIcon; palavras: RegExp }[] = [
  { icone: Fuel, palavras: /combust|diesel|arla|litro/i },
  { icone: Wrench, palavras: /manuten|pneu|revis|oficina/i },
  { icone: Users, palavras: /motorista|pessoal|jornada|di.ria|encargo|equipe/i },
  { icone: Truck, palavras: /disponibilidade|ciclo|km|tempo|frota|equipamento/i },
  { icone: ShieldCheck, palavras: /seguro|rastre|protec/i },
  { icone: DollarSign, palavras: /custo.fixo|financ|juro|deprecia|remunera|frete|lucro/i },
];

export function iconeDaAlteracao(grupo: ChangeGroup): LucideIcon {
  const texto = `${grupo.taxonomyName ?? ""} ${grupo.attributeCode ?? ""} ${grupo.title}`;
  const regra = REGRAS.find((r) => r.palavras.test(texto));
  return regra?.icone ?? Tag;
}
