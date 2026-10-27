import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { calculateOrderTotals } from "../src/order-calculations";
import { createOrderSchema } from "../src/schemas";

describe("createOrderSchema", () => {
  it("normaliza el comprador y acepta el payload compatible con el cliente", () => {
    const result = createOrderSchema.parse({
      buyer: { name: "  Ana Pérez ", phone: " 5551234567 ", email: "ANA@EXAMPLE.COM" },
      items: [{ id: "moto-1", quantity: 2 }],
      requestId: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(result.buyer).toEqual({
      name: "Ana Pérez",
      phone: "5551234567",
      email: "ana@example.com",
    });
  });

  it("rechaza productos duplicados y cantidades inválidas", () => {
    expect(() =>
      createOrderSchema.parse({
        buyer: { name: "Ana", phone: "5551234567", email: "ana@example.com" },
        items: [
          { id: "moto-1", quantity: 1 },
          { id: "moto-1", quantity: 2 },
        ],
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toThrow(ZodError);
  });
});

describe("calculateOrderTotals", () => {
  it("calcula subtotales y total en centavos", () => {
    const result = calculateOrderTotals(
      [
        { id: "a", quantity: 2 },
        { id: "b", quantity: 1 },
      ],
      [
        { title: "A", price: 10.1, stock: 5 },
        { title: "B", price: 5.25, stock: 5 },
      ],
    );

    expect(result.items.map((item) => item.subtotalCents)).toEqual([2020, 525]);
    expect(result.totalCents).toBe(2545);
  });
});
