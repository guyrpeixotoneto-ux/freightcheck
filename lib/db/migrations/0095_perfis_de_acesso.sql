-- ---------------------------------------------------------------------------
-- PERFIS DE ACESSO — três de fábrica, e um piso por perfil.
-- ---------------------------------------------------------------------------
--
-- A `0082` semeou dois papéis do sistema, `Operador` e `Administrador`, porque
-- era exatamente isso que `app_user.role` guardava: dois valores. O cadastro
-- nasceu descrevendo o que já existia, e não o que a casa precisa dizer.
--
-- O que ela precisa dizer são três coisas, e a do meio nunca teve nome:
--
--   · **Administrador** — usa o produto e gerencia quem entra nele.
--   · **Gestor**        — usa o produto inteiro; não mexe em contas.
--   · **Leitor**        — vê o produto inteiro; não escreve em lugar nenhum.
--
-- `Operador` **vira** `Gestor`: é o mesmo perfil, com o mesmo alcance e as
-- mesmas contas dentro, e um `UPDATE` de nome é o que preserva isso. Criar um
-- `Gestor` novo ao lado deixaria toda conta existente num perfil legado que
-- alguém teria de esvaziar na mão — e, no dia em que esvaziasse, teria movido
-- gente de acesso sem querer.
--
-- ---------------------------------------------------------------------------
-- Por que `nivel_padrao`, e não noventa linhas em `papel_permissao`
-- ---------------------------------------------------------------------------
--
-- `Leitor` não é dizível pelas chaves que existiam. Um perfil sem linha alcança
-- tudo — a ausência concede, nas três camadas —, então descrever "vê tudo, não
-- escreve nada" exigiria uma linha `VISUALIZAR` para cada módulo do menu. Duas
-- consequências, e as duas já aconteceram neste produto um andar acima:
--
--   1. O servidor **não conhece o menu** (ver `lib/acesso`): o menu vive na
--      interface. Uma migration que escrevesse as noventa chaves estaria
--      congelando aqui uma lista que muda na tela.
--   2. O módulo que nascesse depois nasceria **editável** para o Leitor, sem
--      que ninguém tivesse decidido isso. É o defeito que a chave `#<seção>`
--      consertou para os módulos universais, e ele voltaria idêntico.
--
-- `papel.nivel_padrao` é o piso do perfil: o nível que vale para toda chave sem
-- linha própria. `EDITAR` é o default, e é o que todos os papéis existentes
-- recebem — **ninguém muda de acesso com esta migration**. `Leitor` nasce
-- `VISUALIZAR`, e as linhas de `papel_permissao` continuam sendo a exceção
-- dentro do perfil, vencendo o piso.
--
-- O piso viaja até a tela e até o portão dentro do próprio mapa de permissões,
-- na chave `*` (`CHAVE_PADRAO`, em `@workspace/acesso`) — nenhuma assinatura
-- muda, e quem já lia `nivelDoModulo` passa a respeitá-lo sem saber que ele
-- existe.
--
-- ---------------------------------------------------------------------------
-- O que esta migration NÃO faz
-- ---------------------------------------------------------------------------
--
-- Não põe ninguém no `Leitor`. Ele nasce vazio, de propósito: mover contas para
-- um perfil mais fechado é decisão de quem administra a casa, tomada na tela e
-- assinada, e não efeito colateral de um deploy.
-- ---------------------------------------------------------------------------

ALTER TABLE "papel" ADD COLUMN IF NOT EXISTS "nivel_padrao" text DEFAULT 'EDITAR' NOT NULL;--> statement-breakpoint
DO $reentrante$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'papel_nivel_padrao_check'
                   AND conrelid = '"papel"'::regclass) THEN
ALTER TABLE "papel" ADD CONSTRAINT "papel_nivel_padrao_check" CHECK ("nivel_padrao" IN ('EDITAR', 'VISUALIZAR', 'SEM_ACESSO'));
  END IF;
END $reentrante$;--> statement-breakpoint
-- O mesmo perfil, com as mesmas contas dentro: só o nome (e a linha que o
-- descreve) mudam. `sistema` continua sendo o que impede de apagá-lo.
UPDATE "papel"
SET "nome" = 'Gestor',
    "descricao" = 'Usa o produto inteiro: audita, confere e fecha. Não mexe em contas.'
WHERE "sistema" AND lower("nome") = 'operador'
  AND NOT EXISTS (SELECT 1 FROM "papel" p2 WHERE lower(p2."nome") = 'gestor');--> statement-breakpoint
UPDATE "papel"
SET "descricao" = 'Acesso total, incluindo a gestão de quem entra no produto.'
WHERE "sistema" AND lower("nome") = 'administrador';--> statement-breakpoint
INSERT INTO "papel" ("nome", "descricao", "gerencia_contas", "sistema", "nivel_padrao")
VALUES
	('Leitor', 'Vê o produto inteiro e não escreve em lugar nenhum.', false, true, 'VISUALIZAR')
ON CONFLICT DO NOTHING;
