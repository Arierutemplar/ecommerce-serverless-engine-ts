import type { Item, PricedOrderItem, RequestedItem } from "./types";

export const calculateSubtotalCents = (price: number, quantity: number): number =>
  Math.round(price * 100) * quantity;

export const calculateOrderTotals = (
  requestedItems: RequestedItem[],
  products: Item[],
): { items: PricedOrderItem[]; totalCents: number } => {
  const items = requestedItems.map((requested, index) => {
    const product = products[index];
    const subtotalCents = calculateSubtotalCents(product.price, requested.quantity);
    return {
      id: requested.id,
      title: product.title,
      price: product.price,
      quantity: requested.quantity,
      subtotal: subtotalCents / 100,
      subtotalCents,
      stock: product.stock,
    };
  });

  return {
    items,
    totalCents: items.reduce((total, item) => total + item.subtotalCents, 0),
  };
};
