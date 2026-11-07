"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { subtotal, total } = require("../src/cart");

test("subtotal adds item prices", () => {
  assert.equal(subtotal([{ price: 2, quantity: 1 }, { price: 3.5, quantity: 1 }]), 5.5);
});

test("total applies the tax rate and rounds to cents", () => {
  assert.equal(total([{ price: 10, quantity: 1 }], 0.175), 11.75);
});
