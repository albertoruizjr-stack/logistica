-- Adiciona STORE_LEADER ao enum Role + atualiza os 5 líderes
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'STORE_LEADER';
