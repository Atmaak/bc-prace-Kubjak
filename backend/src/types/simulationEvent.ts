export type EventSeverity = 'info' | 'warning' | 'error';

export type EventType = 
  // Control events
  | 'SIM_STARTED'
  | 'SIM_PAUSED'
  | 'SIM_STOPPED'
  | 'AGENT_ADDED'
  | 'AGENT_REMOVED'
  | 'TICK_START'
  | 'TICK_END'
  
  // Business events (Company)
  | 'COMPANY_ORDER_PLACED'
  | 'COMPANY_ORDER_FULFILLED'
  | 'COMPANY_ORDER_FAILED'
  | 'COMPANY_BOUGHT_MATERIAL'
  | 'COMPANY_EXPANDED'
  | 'COMPANY_EXPANSION_FAILED'
  | 'COMPANY_PRODUCTION_UPDATE'
  | 'COMPANY_BUY_FAILED'
  | 'COMPANY_BUY_SUCCESS'
  | 'COMPANY_SUPPLIES_BOUGHT'
  | 'COMPANY_PRODUCED'
  | 'COMPANY_PRODUCTION_FAILED'
  | 'COMPANY_SOLD_PRODUCT'
  | 'COMPANY_STRATEGIC_DECISION'
  
  // Business events (Supplier)
  | 'SUPPLIER_ORDER_RECEIVED'
  | 'SUPPLIER_ORDER_SHIPPED'
  | 'SUPPLIER_ORDER_REJECTED'
  | 'SUPPLIER_STOCK_CHANGED'
  
  // State mutation events
  | 'STATE_INVENTORY_CHANGED'
  | 'STATE_CAPACITY_CHANGED'
  | 'STATE_WORKSTATION_CHANGED'
  
  // Strategy events
  | 'STRATEGY_DECISION_MADE'
  | 'STRATEGY_EVALUATION'
  
  // Error events
  | 'AGENT_ERROR'
  | 'TICK_ERROR';

export interface SimulationEvent {
  tick: number; // Simulation tick when event occurred
  eventType: EventType;
  severity: EventSeverity;
  agentId: number;
  companyId?: number | string; // identifies which company/firm
  correlationId?: string;
  strategyId?: string; // identifies strategy variant
  
  // Event-specific payload
  payload: Record<string, any>;
  
  // Optional error info
  error?: {
    message: string;
    stack?: string | void;
  };
}

export interface StrategyDecisionContext {
  candidates: Array<{
    supplierId: number;
    score: number;
    pricePerUnit: number;
    availableStock: number;
    reliabilityScore: number;
  }>;
  chosenSupplierId: number;
  decision: 'ACCEPTED' | 'REJECTED' | 'DEFERRED';
  reason: string;
  quantityRequested: number;
  quantityAllocated?: number;
}
