# Atualização 01/10/2026 — Central completa: ORBI · TORVEN · RUSTEN

Commits locais (já aplicados em D:\Programacao): ORBI 09ba272 · TORVEN 1da8357 · RUSTEN 21da476. **Publicação pendente** (o computador desconectou antes de rodar os .bat; o GitHub desta sessão não tem permissão de push).

## Contrato v1.1 (compatível com v1)
- Manifesto traz `settings: { system: [...], tenant: [...] }` (campos com key, label, type boolean|number|text|textarea|select, group, help, min/max/step/unit, options).
- Sistema expõe `GET|PUT /api/platform/v1/settings` e `GET|PUT /tenants/:id/settings` (assinados, validados, auditados).

## ORBI (MASTER)
- Migração 022_master_sistemas.sql: `platform_products.settings_schema`; `platform_product_settings` (regras por sistema sobrepondo as gerais: teste, carência, aviso de vencimento, cadastros, suporte).
- Página **Parâmetros** com seletor de sistema (regras da central do sistema + parâmetros do sistema) e aba **Parâmetros** na empresa remota.
- Rotas: `GET|PUT /api/master/settings?product=`, `GET|PUT /api/master/products/:code/params`, `GET|PUT /api/master/tenants/:id/params`. Auditoria por sistema.
- Testes: hub-test 63/63, saas 58/58, mp 19/19, smoke OK (teste de agendamento simultâneo deixou de depender da data).

## TORVEN
- Migração 010_parametros.sql (system_settings). params.js: cadastros, demonstração, prazo de limpeza, padrões de OS e aviso geral (sistema); garantia, prazos, inspeção, pagamento para entregar, caixa, impostos, links públicos, comissões (empresa).
- platform-test 6/6 e smoke 172/172. API atualiza sozinha após o push (loader da Edge busca o bundle do GitHub Pages).

## RUSTEN
- Contrato v1 no formato real do ORBI (ts\nMÉTODO\nrota\nsha256), situação no formato do ORBI, portal da assinatura igual ao TORVEN, demonstração com "Experimentar demonstração"/ativação e limpeza automática, parâmetros v1.1.
- API Edge Function `rusten-api` v4 no ar (migração 002 aplicada no primeiro acesso). `rusten.platform_config.platform_hub_url = https://orbi-sigma-five.vercel.app`; falta o segredo.
- smoke 53/53 com central falsa.

## Para concluir
1. Duplo clique: `D:\Programacao\PUBLICAR-ORBI.bat`, `D:\Programacao\TORVEN\PUBLICAR.bat`, `D:\Programacao\PUBLICAR-RUSTEN.bat`.
2. ORBI Master › Sistemas › Adicionar: código `rusten`, API `https://dwfbxrfniarhufltmlhb.supabase.co/functions/v1/rusten-api`, site `https://rusten.vercel.app`, página `/assinatura`. Copiar o segredo.
3. Supabase (projeto TORVEN) › SQL: `insert into rusten.platform_config (key, value) values ('platform_secret', '<segredo>') on conflict (key) do update set value = excluded.value;`
4. Master › Sistemas › RUSTEN › Testar conexão → Sincronizar; criar planos do RUSTEN; ajustar em Master › Parâmetros.
