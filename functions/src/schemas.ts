import { z } from "zod";
import type { CreateOrderRequest } from "./types";

export const requestIdSchema = z
  .string()
  .regex(/^[a-f0-9-]{36}$/i, "requestId debe tener formato UUID");

export const buyerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
});

export const requestedItemSchema = z.object({
  id: z.string().min(1).max(150),
  quantity: z.number().int().safe().min(1).max(99),
});

export const createOrderSchema = z
  .object({
    buyer: buyerSchema,
    items: z.array(requestedItemSchema).min(1).max(20),
    requestId: requestIdSchema,
  })
  .superRefine(({ items }, context) => {
    const ids = new Set<string>();
    items.forEach((item, index) => {
      if (ids.has(item.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["items", index, "id"],
          message: "No se permiten productos duplicados.",
        });
      }
      ids.add(item.id);
    });
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const parseCreateOrderRequest = (data: unknown): CreateOrderRequest =>
  createOrderSchema.parse(data);
