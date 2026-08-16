import { describe, it } from "vitest";

/**
 * A bateria do assistente precisa de banco — e a ausência dele não pode passar
 * por aprovação.
 *
 * Sete arquivos daqui só existem contra o export real promovido: o que eles
 * conferem é se o número que o assistente cita é o mesmo que o motor devolve.
 * Todos abriam com
 *
 *     const rodar = URL_DO_BANCO ? describe : describe.skip;
 *
 * e o efeito dessa linha é o defeito que este repositório já teve uma vez, com
 * nome e data: sem a variável, `vitest` termina com **código 0** e 119 provas
 * marcadas como puladas. Medido em 16/08/2026, rodando `lib/assistant` sem
 * `ASSISTANT_EVAL_DATABASE_URL`: `Tests 209 passed | 119 skipped`, saída zero.
 * Um CI ligado a isso fica verde sem ter olhado para o que mais importa — que
 * é como 420 testes ficaram pulados por meses sem ninguém saber.
 *
 * As suítes `-real` não têm esse problema: elas chamam o banco de frente e
 * quebram alto quando ele não responde (medido: saída 1, dois arquivos
 * reprovados). Só a bateria do assistente se escondia atrás do `skip`.
 *
 * **Por que não simplesmente trocar por `describe`.** Porque aí quem desenvolve
 * sem banco ao lado passa a ver uma dúzia de erros de conexão em vez de uma
 * suíte que se declara indisponível, e a resposta natural a isso é aprender a
 * ignorar vermelho. O corte é por ambiente: na máquina de quem desenvolve,
 * pula e diz por quê; no CI — onde `CI` está sempre definido —, reprova.
 */
export const URL_DO_BANCO_DE_AVALIACAO =
  process.env.ASSISTANT_EVAL_DATABASE_URL ?? process.env.DATABASE_URL;

const NO_CI = Boolean(process.env.CI);

/**
 * Declara uma suíte que não tem sentido sem o banco de avaliação.
 *
 * Com banco, é `describe`. Sem banco e fora do CI, é `describe.skip`. Sem banco
 * **no CI**, é uma suíte de um teste só, que reprova dizendo o que falta — para
 * que o vermelho aponte para a configuração e não para o código.
 */
export function comBancoDeAvaliacao(titulo: string, corpo: () => void): void {
  if (URL_DO_BANCO_DE_AVALIACAO) {
    describe(titulo, corpo);
    return;
  }

  if (NO_CI) {
    describe(titulo, () => {
      it("exige ASSISTANT_EVAL_DATABASE_URL — sem ela esta bateria não prova nada", () => {
        throw new Error(
          `A suíte "${titulo}" precisa de um banco com o export real promovido. ` +
            "Defina ASSISTANT_EVAL_DATABASE_URL e rode `pnpm run dev:seed` antes. " +
            "Pular isto no CI deixaria o verde querer dizer menos do que diz.",
        );
      });
    });
    return;
  }

  describe.skip(titulo, corpo);
}
