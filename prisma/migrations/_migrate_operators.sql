-- Migra OPERATORs existentes para LOGISTICS_OPERATOR.
-- ADMIN não é tocado.
UPDATE users SET role = 'LOGISTICS_OPERATOR' WHERE role = 'OPERATOR';
