import { z } from "zod";
import {
  diningTableSchema,
  ingredientSchema,
  menuItemSchema,
  orderItemStatusSchema,
  orderResponseSchema,
  orderStatusSchema,
  orderTypeSchema,
  packageTypeSchema,
  pickupVerificationSchema,
  productIngredientSchema,
  sessionUserSchema,
  type Order,
  type OrderResponse,
} from "./contracts.ts";
import toTaipeiDateTime from "../util.ts";

export const apiErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
});
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;

export const healthResponseSchema = z.object({
  status: z.string(),
  auth: z
    .object({
      betterAuthConfigured: z.boolean(),
      googleConfigured: z.boolean(),
    })
    .optional(),
});

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(4),
  phone: z.string().optional(),
});

export const loginResponseSchema = z.object({
  data: sessionUserSchema,
});

export const sessionResponseSchema = z.object({
  data: sessionUserSchema.nullable(),
});

export const menuListResponseSchema = z.object({
  data: z.array(menuItemSchema),
});

export const menuItemResponseSchema = z.object({
  data: menuItemSchema,
});

export const createMenuItemBodySchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
  category: z.string().min(1),
  description: z.string().default(""),
  image_url: z.string().min(1),
  default_time: z.number().int().nonnegative().optional(),
  is_available: z.boolean().optional(),
});

export const updateMenuItemParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateMenuItemBodySchema = createMenuItemBodySchema.partial();
export const deleteMenuItemParamsSchema = updateMenuItemParamsSchema;

export const menuSearchQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  availableOnly: z.coerce.boolean().optional(),
});

export const orderResponseEnvelopeSchema = z.object({
  data: orderResponseSchema,
});

export const orderListResponseSchema = z.object({
  data: z.array(orderResponseSchema),
});

export const currentOrderResponseSchema = z.object({
  data: orderResponseSchema.nullable(),
});

export const getOrderByIdParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const userIdQuerySchema = z.object({
  userId: z.string().min(1).optional(),
});

export const getOrderByIdQuerySchema = userIdQuerySchema;
export const getOrderCurrentQuerySchema = userIdQuerySchema;
export const orderHistoryQuerySchema = userIdQuerySchema;

export const createOrderBodySchema = z
  .object({
    userId: z.string().min(1).optional(),
    orderType: orderTypeSchema.optional(),
    packageType: packageTypeSchema.optional(),
    tableId: z.number().int().positive().optional(),
  })
  .default({});

export const updateOrderParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const updateOrderBodySchema = z.object({
  userId: z.string().min(1).optional(),
  itemId: z.number().int().positive(),
  qty: z.number().int().min(0),
  note: z.string().optional(),
});

export const configureOrderBodySchema = z.object({
  userId: z.string().min(1).optional(),
  orderType: orderTypeSchema.optional(),
  packageType: packageTypeSchema.optional(),
  tableId: z.number().int().positive().nullable().optional(),
});

export const submitOrderParamsSchema = updateOrderParamsSchema;
export const submitOrderBodySchema = z
  .object({
    userId: z.string().min(1).optional(),
    orderType: orderTypeSchema.optional(),
    packageType: packageTypeSchema.optional(),
    tableId: z.number().int().positive().optional(),
  })
  .default({});

export const updateOrderStatusBodySchema = z.object({
  status: orderStatusSchema,
});

export const updateOrderItemStatusBodySchema = z.object({
  itemId: z.number().int().positive(),
  status: orderItemStatusSchema,
});

export const pickupVerifyBodySchema = z.object({
  pickupCode: z.string().min(1),
});

export const pickupVerificationResponseSchema = z.object({
  data: pickupVerificationSchema,
});

export const ingredientListResponseSchema = z.object({
  data: z.array(ingredientSchema),
});

export const ingredientResponseSchema = z.object({
  data: ingredientSchema,
});

export const createIngredientBodySchema = z.object({
  name: z.string().min(1),
  stock: z.number().nonnegative(),
  unit: z.string().min(1),
  reorderLevel: z.number().nonnegative().optional(),
});

export const updateIngredientBodySchema = createIngredientBodySchema.partial();

export const productIngredientsResponseSchema = z.object({
  data: z.array(productIngredientSchema),
});

export const setProductIngredientsBodySchema = z.object({
  ingredients: z.array(
    z.object({
      ingredientId: z.number().int().positive(),
      quantity: z.number().positive(),
    }),
  ),
});

export const tableListResponseSchema = z.object({
  data: z.array(diningTableSchema),
});

export const tableResponseSchema = z.object({
  data: diningTableSchema,
});

export const createTableBodySchema = z.object({
  code: z.string().min(1),
  capacity: z.number().int().positive(),
});

export const updateTableBodySchema = z.object({
  code: z.string().min(1).optional(),
  capacity: z.number().int().positive().optional(),
  status: diningTableSchema.shape.status.optional(),
  currentOrderId: z.number().int().positive().nullable().optional(),
});

export const reportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export function toOrderResponse(order: Order): OrderResponse {
  return {
    ...order,
    items: order.items.map((orderItem) => ({
      ...orderItem,
      status: orderItem.status ?? "queued",
    })),
    status: order.status ?? "pending",
    orderType: order.orderType ?? "takeout",
    packageType: order.packageType ?? "together",
    createdAtTaipei: toTaipeiDateTime(order.createdAt),
  };
}
