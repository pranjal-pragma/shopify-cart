import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from '../generated/api';

/**
 * @typedef {import('../generated/api').Input} RunInput
 * @typedef {import('../generated/api').CartLinesDiscountsGenerateRunResult} RunResult
 */

function compare(actual, operator, expected) {
  if (operator === 'greater_than') return actual > expected;
  if (operator === 'greater_than_or_equal') return actual >= expected;
  if (operator === 'equal_to') return actual === expected;
  return false;
}

function conditionMatches(lines, condition) {
  const matchingLines = lines.filter((line) => {
    if (condition.applicable_on === 'all') return true;
    return line.merchandise.__typename === 'ProductVariant'
      && condition.product_ids.includes(line.merchandise.product.id);
  });
  let actual;
  if (condition.condition_type === 'cart_quantity') {
    actual = matchingLines.reduce((sum, line) => sum + line.quantity, 0);
  } else if (condition.condition_type === 'cart_subtotal') {
    actual = matchingLines.reduce(
      (sum, line) => sum + Number(line.cost.subtotalAmount.amount),
      0,
    );
  } else {
    return false;
  }
  return compare(actual, condition.operator, condition.value);
}

/**
 * Applies the real checkout discount only to a configured, eligible gift line.
 * @param {RunInput} input
 * @returns {RunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  if (!input.discount.discountClasses.includes(DiscountClass.Product)) {
    return {operations: []};
  }
  const offer = input.discount.configuration?.jsonValue;
  if (!offer || !Array.isArray(offer.conditions)) {
    return {operations: []};
  }

  const regularLines = input.cart.lines.filter((line) => !line.giftOffer);
  if (!offer.conditions.every((condition) => conditionMatches(regularLines, condition))) {
    return {operations: []};
  }

  const targets = input.cart.lines
    .filter((line) => line.giftOffer?.value === offer.id)
    .filter((line) => line.merchandise.__typename === 'ProductVariant')
    .filter((line) => line.merchandise.id === offer.variant_id)
    .map((line) => ({
      cartLine: {
        id: line.id,
        quantity: Math.min(line.quantity, offer.quantity),
      },
    }));
  if (!targets.length) return {operations: []};

  return {
    operations: [
      {
        productDiscountsAdd: {
          candidates: [
            {
              message: 'FREE gift',
              targets,
              value: {percentage: {value: 100}},
            },
          ],
          selectionStrategy: ProductDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}
