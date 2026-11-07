"use strict";

function subtotal(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}

function total(items, taxRate = 0) {
  const amount = subtotal(items) * (1 + taxRate);
  return Math.round(amount * 100) / 100;
}

module.exports = { subtotal, total };
