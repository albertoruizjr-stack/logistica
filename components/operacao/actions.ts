import type { ActionDefinition } from "./types";
import { DeliveryRequestStatus } from "@prisma/client";

const OCCURRENCE_TYPE_OPTIONS = [
  { value: "AVARIA",            label: "Avaria — produto danificado" },
  { value: "RECUSA_ENTREGA",    label: "Recusa de entrega" },
  { value: "ENDERECO_ERRADO",   label: "Endereço errado / inacessível" },
  { value: "AUSENTE",           label: "Cliente ausente" },
  { value: "DIVERGENCIA_ITEMS", label: "Divergência de itens" },
  { value: "ATRASO",            label: "Atraso" },
  { value: "SINISTRO",          label: "Sinistro (perda / roubo)" },
  { value: "OUTRO",             label: "Outro (descrever)" },
];

const OCORRENCIA_ACTION: ActionDefinition = {
  toStatus: DeliveryRequestStatus.OCORRENCIA,
  label:    "Ocorrência",
  variant:  "warning",
  fields: [
    {
      key:      "occurrenceType",
      label:    "Tipo",
      type:     "select",
      required: true,
      options:  OCCURRENCE_TYPE_OPTIONS,
    },
    {
      key:         "occurrenceNotes",
      label:       "Detalhes (mínimo 10 caracteres)",
      type:        "textarea",
      required:    true,
      minLength:   10,
      placeholder: "Descreva o que ocorreu…",
    },
  ],
};

const CANCEL_ACTION: ActionDefinition = {
  toStatus:        DeliveryRequestStatus.CANCELLED,
  label:           "Cancelar",
  variant:         "danger",
  requiresConfirm: true,
  fields: [
    {
      key:         "cancellationReason",
      label:       "Motivo (mínimo 10 caracteres)",
      type:        "textarea",
      required:    true,
      minLength:   10,
      placeholder: "Informe o motivo do cancelamento…",
    },
  ],
};

// Ações disponíveis por status (exibidas no card e detalhadas no modal)
export const ACTIONS_BY_STATUS: Record<string, ActionDefinition[]> = {
  [DeliveryRequestStatus.PENDING]: [
    { toStatus: DeliveryRequestStatus.AWAITING_ITEMS,    label: "Iniciar separação",  variant: "primary" },
    { toStatus: DeliveryRequestStatus.AWAITING_TRANSFER, label: "Pedir transferência",variant: "primary" },
    { toStatus: DeliveryRequestStatus.SEPARADO,          label: "Já separado",        variant: "primary",
      fields: [{
        key: "separatedBy", label: "Estoquista responsável", type: "text", required: true,
        placeholder: "Nome do estoquista",
      }],
    },
    CANCEL_ACTION,
  ],

  [DeliveryRequestStatus.AWAITING_ITEMS]: [
    { toStatus: DeliveryRequestStatus.SEPARADO, label: "Confirmar separação", variant: "primary",
      fields: [{
        key: "separatedBy", label: "Estoquista responsável", type: "text", required: true,
        placeholder: "Nome do estoquista",
      }],
    },
    { toStatus: DeliveryRequestStatus.AWAITING_TRANSFER, label: "Pedir transferência", variant: "primary" },
    { toStatus: DeliveryRequestStatus.PENDING,           label: "Devolver pendente",   variant: "ghost" },
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  [DeliveryRequestStatus.AWAITING_TRANSFER]: [
    { toStatus: DeliveryRequestStatus.SEPARADO, label: "Itens chegaram — separar", variant: "primary",
      fields: [{
        key: "separatedBy", label: "Estoquista responsável", type: "text", required: true,
        placeholder: "Nome do estoquista",
      }],
    },
    { toStatus: DeliveryRequestStatus.AWAITING_ITEMS, label: "Voltar para separação", variant: "ghost" },
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  // A partir de SEPARADO, o cron do Citel vincula a NF automaticamente e promove
  // o status até PRONTO_ROTEIRIZACAO sem intervenção do operador. O fallback
  // manual ("Solicitar NF ao CD") fica disponível na página completa caso o
  // cron falhe — mas não aparece como ação principal aqui.
  [DeliveryRequestStatus.SEPARADO]: [
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  [DeliveryRequestStatus.AGUARDANDO_NF]: [
    // Clique único: marca NF como emitida E já vincula ao PD — não há mais etapa intermediária.
    { toStatus: DeliveryRequestStatus.NF_VINCULADA, label: "NF emitida no Citel", variant: "primary" },
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  // NF_EMITIDA mantida só pra compat com registros antigos — comportamento idêntico ao NF_VINCULADA.
  [DeliveryRequestStatus.NF_EMITIDA]: [
    { toStatus: DeliveryRequestStatus.NF_VINCULADA, label: "Marcar como vinculada", variant: "primary" },
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  [DeliveryRequestStatus.NF_VINCULADA]: [
    { toStatus: DeliveryRequestStatus.PRONTO_ROTEIRIZACAO, label: "Liberar roteirização", variant: "primary" },
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  [DeliveryRequestStatus.PRONTO_ROTEIRIZACAO]: [
    {
      toStatus: DeliveryRequestStatus.ROTEIRIZADO,
      label:    "Roteirizar",
      variant:  "primary",
      fields: [{
        key: "routeId", label: "ID da Rota", type: "text", required: true,
        placeholder: "Ex: ROTA-2025-001",
      }],
    },
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  [DeliveryRequestStatus.ROTEIRIZADO]: [
    { toStatus: DeliveryRequestStatus.PRONTO_ROTEIRIZACAO, label: "Retirar da rota",   variant: "ghost" },
    OCORRENCIA_ACTION,
    CANCEL_ACTION,
  ],

  [DeliveryRequestStatus.DISPATCHED]: [
    OCORRENCIA_ACTION,
  ],

  [DeliveryRequestStatus.IN_TRANSIT]: [
    OCORRENCIA_ACTION,
  ],

  [DeliveryRequestStatus.OCORRENCIA]: [
    { toStatus: DeliveryRequestStatus.PENDING,             label: "Voltar para Pendente",      variant: "primary" },
    { toStatus: DeliveryRequestStatus.AWAITING_ITEMS,      label: "Voltar para Separação",     variant: "primary" },
    { toStatus: DeliveryRequestStatus.SEPARADO,            label: "Confirmar separado",        variant: "primary",
      fields: [{ key: "separatedBy", label: "Estoquista", type: "text", required: true, placeholder: "Nome" }],
    },
    { toStatus: DeliveryRequestStatus.AGUARDANDO_NF,       label: "Aguardar NF",               variant: "ghost" },
    { toStatus: DeliveryRequestStatus.PRONTO_ROTEIRIZACAO, label: "Retomar roteirização",      variant: "ghost" },
    CANCEL_ACTION,
  ],
};
