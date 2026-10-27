import { initializeApp } from "firebase-admin/app";
import {
  FieldValue,
  getFirestore,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { HttpsError, onCall, type CallableRequest } from "firebase-functions/v2/https";
import { ZodError } from "zod";
import { calculateOrderTotals } from "./order-calculations";
import { parseCreateOrderRequest } from "./schemas";
import type {
  CreateOrderRequest,
  CreateOrderResponse,
  Item,
  Order,
  RequestedItem,
} from "./types";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

const db = getFirestore();

const invalidArgument = (error: ZodError): HttpsError =>
  new HttpsError("invalid-argument", "El pedido no es válido.", {
    issues: error.issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
      message: issue.message,
    })),
  });

const parseRequest = (data: unknown): CreateOrderRequest => {
  try {
    return parseCreateOrderRequest(data);
  } catch (error) {
    if (error instanceof ZodError) throw invalidArgument(error);
    throw error;
  }
};

const readItem = (
  snapshot: DocumentSnapshot | QueryDocumentSnapshot,
  quantity: number,
): Item => {
  if (!snapshot.exists) {
    throw new HttpsError("not-found", "Uno de los productos ya no existe.");
  }

  const product = snapshot.data() as Partial<Item>;
  const { title, price, stock } = product;
  if (
    typeof title !== "string" ||
    typeof price !== "number" ||
    !Number.isFinite(price) ||
    price < 0 ||
    typeof stock !== "number" ||
    !Number.isSafeInteger(stock) ||
    stock < quantity
  ) {
    throw new HttpsError(
      "failed-precondition",
      `${title ?? "Un producto"} ya no tiene stock suficiente.`,
    );
  }

  return {
    title,
    price,
    stock,
  };
};

export const createOrder = onCall(
  { enforceAppCheck: true },
  async (
    request: CallableRequest<unknown>,
  ): Promise<CreateOrderResponse> => {
    const { buyer, items, requestId } = parseRequest(request.data);
    const orderRef = db.collection("orders").doc(requestId);
    const itemRefs = items.map(({ id }) => db.collection("items").doc(id));

    logger.info("Procesando creación de pedido", {
      requestId,
      itemCount: items.length,
    });

    return db.runTransaction(async (transaction) => {
      const existingOrder = await transaction.get(orderRef);
      if (existingOrder.exists) {
        const existing = existingOrder.data() as Partial<Order>;
        logger.info("Pedido idempotente ya existente", { requestId });
        return { orderId: existingOrder.id, total: existing.total ?? 0 };
      }

      const snapshots = await Promise.all(
        itemRefs.map((itemRef) => transaction.get(itemRef)),
      );
      const products = snapshots.map((snapshot, index) =>
        readItem(snapshot, items[index].quantity),
      );
      const { items: orderItems, totalCents } = calculateOrderTotals(items, products);
      const order: Omit<Order, "createdAt"> & { createdAt: FirebaseFirestore.FieldValue } = {
        buyer,
        items: orderItems.map(({ id, title, price, quantity, subtotal }) => ({
          id,
          title,
          price,
          quantity,
          subtotal,
        })),
        total: totalCents / 100,
        status: "pending",
        createdAt: FieldValue.serverTimestamp(),
      };

      orderItems.forEach((item, index) => {
        transaction.update(snapshots[index].ref, { stock: item.stock - item.quantity });
      });
      transaction.create(orderRef, order);
      logger.info("Pedido creado correctamente", {
        orderId: orderRef.id,
        total: order.total,
        totalCents,
      });
      return { orderId: orderRef.id, total: order.total };
    });
  },
);

const isRequestedItem = (value: unknown): value is RequestedItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as RequestedItem).id === "string" &&
  Number.isSafeInteger((value as RequestedItem).quantity) &&
  (value as RequestedItem).quantity > 0;

export const expirePendingOrders = onSchedule(
  { schedule: "every 60 minutes" },
  async (): Promise<void> => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const pendingOrders = await db
      .collection("orders")
      .where("status", "==", "pending")
      .limit(100)
      .get();
    let expiredCount = 0;

    for (const orderSnapshot of pendingOrders.docs) {
      const expired = await db.runTransaction(async (transaction) => {
        const currentOrder = await transaction.get(orderSnapshot.ref);
        if (!currentOrder.exists) return false;
        const order = currentOrder.data() as Partial<Order>;
        if (
          order.status !== "pending" ||
          !order.createdAt ||
          order.createdAt.toMillis() > cutoff
        ) {
          return false;
        }

        const items = Array.isArray(order.items)
          ? order.items.filter(isRequestedItem)
          : [];
        const productSnapshots = await Promise.all(
          items.map(async (item) => ({
            item,
            snapshot: await transaction.get(db.collection("items").doc(item.id)),
          })),
        );

        productSnapshots.forEach(({ item, snapshot }) => {
          const product = snapshot.data() as Partial<Item> | undefined;
          const stock = product?.stock;
          if (
            snapshot.exists &&
            product &&
            typeof stock === "number" &&
            Number.isSafeInteger(stock) &&
            item.quantity > 0
          ) {
            transaction.update(snapshot.ref, { stock: stock + item.quantity });
          }
        });
        transaction.update(orderSnapshot.ref, {
          status: "expired",
          expiredAt: FieldValue.serverTimestamp(),
        });
        return true;
      });

      if (expired) {
        expiredCount += 1;
        logger.info("Pedido pendiente expirado", { orderId: orderSnapshot.id });
      }
    }

    logger.info("Expiración de pedidos finalizada", { expiredCount });
  },
);
