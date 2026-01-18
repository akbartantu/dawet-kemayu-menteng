/**
 * Commands Index
 * Re-exports all command handlers for easy importing
 */

// Order commands
export {
  handleNewOrder,
  handleParseOrder,
  handleOrderDetail,
  handleStatus,
  handleEditOrder,
  handleCancel,
  handleComplete,
} from './orders.commands.js';

// Payment commands
export {
  handlePayWithEvidence,
  handlePay,
  handlePaymentStatus,
} from './payments.commands.js';

// Reports commands
export {
  handleRecapH1,
  handleOrdersDate,
  handleOrdersUnpaid,
} from './reports.commands.js';
