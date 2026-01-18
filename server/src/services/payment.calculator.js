/**
 * Payment Calculator
 * Canonical calculation of order payment totals
 * Used by both confirmation and detail message formatters
 */

/**
 * Calculate payment totals for an order
 * Returns numeric values (formatting happens in formatters)
 * 
 * @param {Object} order - Order object
 * @param {Object} calculation - Calculation result from calculateOrderTotal (optional, for fallback)
 * @param {number} packagingFee - Packaging fee (optional, will be calculated if not provided)
 * @param {number} deliveryFee - Delivery fee (optional, fallback to order.delivery_fee)
 * @returns {Object} { subtotal, deliveryFee, packagingFee, totalAmount }
 */
export function calculatePaymentTotals(order, calculation, packagingFee, deliveryFee) {
  // Subtotal = product_total (items only, no packaging, no delivery)
  // Use order value if available (saved orders), otherwise use calculation (new orders)
  const productTotalFromOrder = parseFloat(order.product_total || 0);
  const productTotalFromCalculation = calculation?.subtotal || 0;
  const subtotal = productTotalFromOrder > 0 ? productTotalFromOrder : productTotalFromCalculation;
  
  // Delivery fee: Use provided value, then order value, then default to 0
  const deliveryFeeFromOrder = parseFloat(order.delivery_fee || 0);
  const finalDeliveryFee = deliveryFee !== undefined ? deliveryFee : deliveryFeeFromOrder;
  
  // Packaging fee: Use provided value, then order value, then calculate if needed
  let finalPackagingFee = packagingFee !== undefined ? packagingFee : parseFloat(order.packaging_fee || 0);
  
  // If packaging fee not provided and not in order, calculate it
  if (finalPackagingFee === 0 && order.items && order.notes) {
    const hasPackaging = (order.notes || []).some(note => {
      const noteStr = String(note || '').toLowerCase();
      return noteStr.includes('packaging') && 
             (noteStr.includes('ya') || noteStr.includes('yes'));
    });
    
    if (hasPackaging) {
      const totalCups = (order.items || []).reduce((sum, item) => {
        const name = (item.name || '').toLowerCase();
        if (name.includes('dawet') && 
            (name.includes('small') || name.includes('medium') || name.includes('large')) && 
            !name.includes('botol')) {
          return sum + (item.quantity || 0);
        }
        return sum;
      }, 0);
      
      const packagingBoxes = totalCups > 0 ? Math.ceil(totalCups / 50) : 0;
      finalPackagingFee = packagingBoxes * 40000;
    }
  }
  
  // Calculate expected total from components
  const calculatedTotal = subtotal + finalPackagingFee + finalDeliveryFee;
  
  // Total amount: Use order value if available, otherwise calculate from components
  const totalAmountFromOrder = parseFloat(order.total_amount || order.final_total || 0);
  const totalAmount = totalAmountFromOrder > 0 ? totalAmountFromOrder : calculatedTotal;
  
  // Defensive checks
  if (isNaN(subtotal) || isNaN(finalDeliveryFee) || isNaN(finalPackagingFee) || isNaN(totalAmount)) {
    console.error('❌ [PAYMENT_CALC] NaN detected in calculation:', {
      subtotal,
      finalDeliveryFee,
      finalPackagingFee,
      totalAmount,
      orderId: order.id,
    });
    throw new Error('Payment calculation resulted in NaN. Check order data and calculation inputs.');
  }
  
  // Regression protection: If items exist but subtotal is 0, log error with raw data
  if (calculation?.itemDetails && calculation.itemDetails.length > 0 && subtotal === 0) {
    console.error('⚠️ [PAYMENT_CALC] Regression detected: Items exist but subtotal is 0!');
    console.error('⚠️ [PAYMENT_CALC] Order ID:', order.id);
    console.error('⚠️ [PAYMENT_CALC] Raw order items:', JSON.stringify(order.items, null, 2));
    console.error('⚠️ [PAYMENT_CALC] Item details:', calculation.itemDetails);
    console.error('⚠️ [PAYMENT_CALC] Product total from order:', productTotalFromOrder);
    console.error('⚠️ [PAYMENT_CALC] Product total from calculation:', productTotalFromCalculation);
  }
  
  // Guard: If total_amount mismatches components, log and recompute
  const totalMismatch = Math.abs(totalAmount - calculatedTotal) > 0.01;
  if (totalMismatch && totalAmountFromOrder > 0) {
    console.warn('⚠️ [PAYMENT_CALC] Total mismatch: stored total does not match components');
    console.warn('⚠️ [PAYMENT_CALC] Order ID:', order.id);
    console.warn('⚠️ [PAYMENT_CALC] Stored total:', totalAmountFromOrder);
    console.warn('⚠️ [PAYMENT_CALC] Calculated total:', calculatedTotal);
    console.warn('⚠️ [PAYMENT_CALC] Components:', { subtotal, finalPackagingFee, finalDeliveryFee });
    // Note: We return the stored total but formatter will use calculated for display if mismatch
  }
  
  return {
    subtotal,
    deliveryFee: finalDeliveryFee,
    packagingFee: finalPackagingFee,
    totalAmount,
  };
}
