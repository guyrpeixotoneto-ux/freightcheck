import { alcanca, descrever, type Escopo } from "./escopos";

/**
 * A DECISÃO DO PORTÃO — deixa entrar, e por quê não, quando não deixa.
 *
 * Uma função pura, longe do banco e longe do Express, porque é a regra que não
 * pode estar errada: ela é o que separa "um sistema autorizado escrevendo no
 * acervo" de "qualquer um na internet escrevendo no acervo". Testá-la exige
 * uma tabela de casos, não um servidor de pé — e é por isso que ela não mora
 * dentro do middleware que a chama.
 *
 * **Cada recusa tem nome e frase própria.** A tentação de responder "não
 * autorizado" a tudo existe e é errada aqui: quem está do outro lado é uma
 * máquina configurada por uma pessoa, e essa pessoa precisa saber se errou a
 * chave, se a chave foi revogada, se a integração foi desativada ou se falta
 * escopo — quatro consertos completamente diferentes. Nenhuma dessas frases
 * revela nada que quem apresentou uma chave válida já não saiba, e a única que
 * fala com um desconhecido — `CHAVE_DESCONHECIDA` — não distingue "não existe"
 * de "está errada", que é a distinção que ajudaria quem estivesse tentando
 * adivinhar.
 */

export type MotivoDaRecusa =
  | "CHAVE_AUSENTE"
  | "CHAVE_MALFORMADA"
  | "CHAVE_DESCONHECIDA"
  | "CHAVE_REVOGADA"
  | "INTEGRACAO_DESATIVADA"
  | "ESCOPO_INSUFICIENTE";

/** O que o portão sabe sobre a chave apresentada, depois de achá-la no banco. */
export interface ChaveGuardada {
  id: string;
  integracaoId: string;
  integracaoNome: string;
  prefixo: string;
  escopos: readonly string[];
  revogadaEm: Date | null;
  integracaoDesativadaEm: Date | null;
}

export type Decisao =
  | { ok: true; chave: ChaveGuardada }
  | {
      ok: false;
      motivo: MotivoDaRecusa;
      status: 401 | 403;
      mensagem: string;
      /**
       * A chave que foi reconhecida, quando a recusa veio **depois** de
       * reconhecê-la — revogada, integração desativada, escopo insuficiente.
       *
       * Ela viaja junto porque a recusa também é chamada, e chamada se registra:
       * "esta chave apanhou 403 quatorze vezes hoje" é a linha que explica uma
       * integração parada, e sem a chave aqui o log não teria a quem atribuí-la.
       * `null` nas três recusas anteriores ao reconhecimento — ali não há dono a
       * quem atribuir nada.
       */
      chave: ChaveGuardada | null;
    };

/** O status HTTP de cada recusa — autenticação é 401, autorização é 403. */
export function statusDaRecusaDeChave(motivo: MotivoDaRecusa): 401 | 403 {
  return motivo === "ESCOPO_INSUFICIENTE" ? 403 : 401;
}

/** A frase de cada recusa, escrita para quem configurou a integração. */
export function mensagemDaRecusa(motivo: MotivoDaRecusa, exigido?: Escopo): string {
  switch (motivo) {
    case "CHAVE_AUSENTE":
      return (
        "Esta chamada não trouxe chave. Mande a chave da integração em " +
        "Authorization: Bearer <chave> ou no cabeçalho X-FreightCheck-Key."
      );
    case "CHAVE_MALFORMADA":
      return (
        "A chave apresentada não tem o formato de uma chave do FreightCheck " +
        "(fck_…). Confira se o que foi configurado é a chave inteira, como ela " +
        "foi entregue no momento da emissão."
      );
    case "CHAVE_DESCONHECIDA":
      return (
        "Esta chave não vale. Ela pode ter sido copiada pela metade, ou pode " +
        "ter sido substituída por outra — quem administra o FreightCheck vê as " +
        "chaves ativas em Integrações."
      );
    case "CHAVE_REVOGADA":
      return (
        "Esta chave foi revogada e não volta a valer. Peça uma chave nova em " +
        "Integrações e troque a configuração deste sistema."
      );
    case "INTEGRACAO_DESATIVADA":
      return (
        "A integração dona desta chave foi desativada. Enquanto ela estiver " +
        "assim, nenhuma chave dela entra."
      );
    case "ESCOPO_INSUFICIENTE": {
      if (!exigido) return "Esta chave não tem o escopo que esta chamada exige.";
      const d = descrever(exigido);
      return (
        `Esta chamada exige o escopo "${exigido}" (${d.titulo}), e a chave não ` +
        "o tem. O escopo de uma chave é decidido quando ela é emitida: emita " +
        "outra com o escopo certo e revogue esta."
      );
    }
  }
}

/** Monta a recusa inteira — status e frase juntos, para não divergirem. */
export function recusar(
  motivo: MotivoDaRecusa,
  exigido?: Escopo,
  chave: ChaveGuardada | null = null,
): Decisao {
  return {
    ok: false,
    motivo,
    status: statusDaRecusaDeChave(motivo),
    mensagem: mensagemDaRecusa(motivo, exigido),
    chave,
  };
}

/**
 * A decisão sobre uma chave que **já foi encontrada** no banco.
 *
 * A ordem das recusas é a ordem de quem conserta: primeiro o que vale para a
 * integração inteira (desativada), depois o que vale para esta chave
 * (revogada), e só então o escopo. Inverter faria uma chave revogada de uma
 * integração desativada responder "falta escopo" — mandando trocar a chave
 * quando o que resolve é reativar a integração.
 */
export function decidir(chave: ChaveGuardada, exigido: Escopo | null): Decisao {
  if (chave.integracaoDesativadaEm !== null) {
    return recusar("INTEGRACAO_DESATIVADA", undefined, chave);
  }
  if (chave.revogadaEm !== null) return recusar("CHAVE_REVOGADA", undefined, chave);
  if (exigido !== null && !alcanca(chave.escopos, exigido)) {
    return recusar("ESCOPO_INSUFICIENTE", exigido, chave);
  }
  return { ok: true, chave };
}
