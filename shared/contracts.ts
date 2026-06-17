import { z } from "zod";

export const orderStatusSchema = z.enum([
  "pending",
  "submitted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

export const orderItemStatusSchema = z.enum([
  "queued",
  "preparing",
  "ready",
  "served",
  "cancelled",
]);

export const orderTypeSchema = z.enum(["takeout", "dine_in"]);
export const packageTypeSchema = z.enum(["together", "separate"]);
export const tableStatusSchema = z.enum([
  "available",
  "reserved",
  "seated",
  "dining",
  "cleaning",
]);

export const userRoleSchema = z.enum(["customer", "staff", "manager"]);

export const userSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: userRoleSchema.default("customer"),
});

export const sessionUserSchema = userSchema.pick({
  id: true,
  email: true,
  name: true,
  role: true,
});

export const menuItemSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  price: z.number().min(0),
  category: z.string().min(1),
  description: z.string(),
  image_url: z.string().min(1),
  default_time: z.number().int().nonnegative().default(5),
  is_available: z.boolean().default(true),
});

export const orderItemSchema = z.object({
  item: menuItemSchema,
  qty: z.number().int().nonnegative(),
  note: z.string().optional(),
  status: orderItemStatusSchema.default("queued"),
});

export const orderSchema = z.object({
  id: z.number().int().positive(),
  userId: z.string().min(1),
  items: z.array(orderItemSchema),
  total: z.number().min(0),
  status: orderStatusSchema.default("pending"),
  orderType: orderTypeSchema.default("takeout"),
  packageType: packageTypeSchema.default("together"),
  tableId: z.number().int().positive().optional(),
  estimatedReadyAt: z.string().datetime().optional(),
  pickupCode: z.string().optional(),
  createdAt: z.string().datetime(),
  submittedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  cancelledAt: z.string().datetime().optional(),
});

export const orderResponseSchema = orderSchema.extend({
  createdAtTaipei: z.string().min(1),
});

export const ingredientSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  stock: z.number().nonnegative(),
  unit: z.string().min(1),
  reorderLevel: z.number().nonnegative().default(0),
});

export const productIngredientSchema = z.object({
  id: z.number().int().positive(),
  productId: z.number().int().positive(),
  ingredientId: z.number().int().positive(),
  quantity: z.number().positive(),
});

export const diningTableSchema = z.object({
  id: z.number().int().positive(),
  code: z.string().min(1),
  capacity: z.number().int().positive(),
  status: tableStatusSchema.default("available"),
  seatedAt: z.string().datetime().optional(),
  currentOrderId: z.number().int().positive().optional(),
});

export const pickupVerificationSchema = z.object({
  orderId: z.number().int().positive(),
  pickupCode: z.string().min(1),
  verified: z.boolean(),
  status: orderStatusSchema,
});

export type UserRole = z.infer<typeof userRoleSchema>;
export type User = z.infer<typeof userSchema>;
export type SessionUser = z.infer<typeof sessionUserSchema>;
export type MenuItem = z.infer<typeof menuItemSchema>;
export type OrderItemStatus = z.infer<typeof orderItemStatusSchema>;
export type OrderItem = z.infer<typeof orderItemSchema>;
export type OrderStatus = z.infer<typeof orderStatusSchema>;
export type OrderType = z.infer<typeof orderTypeSchema>;
export type PackageType = z.infer<typeof packageTypeSchema>;
export type Order = z.infer<typeof orderSchema>;
export type OrderResponse = z.infer<typeof orderResponseSchema>;
export type Ingredient = z.infer<typeof ingredientSchema>;
export type ProductIngredient = z.infer<typeof productIngredientSchema>;
export type TableStatus = z.infer<typeof tableStatusSchema>;
export type DiningTable = z.infer<typeof diningTableSchema>;
export type PickupVerification = z.infer<typeof pickupVerificationSchema>;

export interface ApiDataResponse<T> {
  data: T;
}

export interface ApiErrorResponse {
  error: string;
  message?: string;
}
