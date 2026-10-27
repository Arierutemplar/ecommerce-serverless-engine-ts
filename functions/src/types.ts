import type { Timestamp } from "firebase-admin/firestore";

export interface Buyer {
  name: string;
  phone: string;
  email: string;
}

export interface RequestedItem {
  id: string;
  quantity: number;
}

export interface CreateOrderRequest {
  buyer: Buyer;
  items: RequestedItem[];
  requestId: string;
}

export interface Item {
  title: string;
  price: number;
  stock: number;
}

export interface OrderItem {
  id: string;
  title: string;
  price: number;
  quantity: number;
  subtotal: number;
}

export type OrderStatus = "pending" | "expired";

export interface Order {
  buyer: Buyer;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: Timestamp;
  expiredAt?: Timestamp;
}

export interface CreateOrderResponse {
  orderId: string;
  total: number;
}

export interface ExpireOrdersResponse {
  expiredCount: number;
}

export interface PricedOrderItem extends OrderItem {
  subtotalCents: number;
  stock: number;
}
