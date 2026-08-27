-- O Balanço de Massa passou a se chamar Rastreio de Dados, e o comentário da
-- view `fato_visivel` cita a tela pelo nome. O texto vive no banco, não no
-- arquivo: reescrever a migration que o criou consertaria só o banco criado do
-- zero e deixaria os já migrados com o nome antigo. Por isso o comentário é
-- reemitido aqui, inteiro — `COMMENT ON` substitui, não acumula.
COMMENT ON VIEW "fato_visivel" IS
  'Os fatos que contam. Exclui os que nasceram numa importação oculta, inclusive os herdados por uma revisão posterior visível. Toda leitura de fato passa por aqui; `fact` cru é para escrita, exclusão, Rastreio de Dados e proveniência.';
