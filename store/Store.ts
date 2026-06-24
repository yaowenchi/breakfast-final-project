import type {
  MenuItem,
  Order,
  OrderStatus,
  OrderType,
  PackageType,
  User,
  OrderItemStatus,
} from "../shared/contracts.ts";

export type UpdateOrderItemErrorCode =
  | "ORDER_NOT_FOUND"
  | "MENU_ITEM_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_EDITABLE";

export type SubmitOrderErrorCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_EDITABLE"
  | "EMPTY_ORDER";

export type OrderMutationErrorCode =
  | "ORDER_NOT_FOUND"
  | "ORDER_NOT_OWNED"
  | "ORDER_NOT_EDITABLE"
  | "INVALID_STATUS"
  | "PICKUP_CODE_INVALID";

export type LoginErrorCode = "INVALID_CREDENTIALS";
export type RegisterErrorCode = "EMAIL_EXISTS" | "RESERVED_EMAIL";

export interface Store {
  init(): Promise<void>;

  login(input: {
    email: string;
    password: string;
  }):
    | { ok: true; user: Omit<User, "password"> }
    | { ok: false; code: LoginErrorCode };
  register(input: {
    email: string;
    name: string;
    password: string;
    phone?: string;
  }): Promise<
    | { ok: true; user: Omit<User, "password"> }
    | { ok: false; code: RegisterErrorCode }
  >;
  getUserById(userId: string): Omit<User, "password"> | undefined;

  getMenu(): ReadonlyArray<MenuItem>;
  getMenuItem(menuId: number): MenuItem | undefined;
  createMenuItem(input: {
    name: string;
    price: number;
    category: string;
    description: string;
    image_url: string;
    default_time?: number;
    is_available?: boolean;
  }): Promise<MenuItem>;
  updateMenuItem(
    menuId: number,
    patch: {
      name?: string;
      price?: number;
      category?: string;
      description?: string;
      image_url?: string;
      default_time?: number;
      is_available?: boolean;
    },
  ): Promise<MenuItem | null>;
  deleteMenuItem(menuId: number): Promise<MenuItem | null>;

  getOrders(): ReadonlyArray<Order>;
  getCurrentOrderByUserId(userId: string): Order | undefined;
  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order>;
  getOrderById(orderId: number): Order | undefined;
  createOrder(input: {
    userId: string;
    orderType?: OrderType;
    packageType?: PackageType;
    tableId?: number;
  }): Promise<Order>;
  configureOrder(
    orderId: number,
    input: {
      userId: string;
      orderType?: OrderType;
      packageType?: PackageType;
      tableId?: number | null;
    },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: OrderMutationErrorCode }
  >;
  updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      itemId: number;
      qty: number;
      note?: string;
    },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: UpdateOrderItemErrorCode }
  >;
  submitOrder(
    orderId: number,
    input: {
      userId: string;
      orderType?: OrderType;
      packageType?: PackageType;
      tableId?: number;
    },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: SubmitOrderErrorCode }
  >;
  updateOrderStatus(
    orderId: number,
    status: OrderStatus,
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: OrderMutationErrorCode }
  >;
  updateOrderItemStatus(
    orderId: number,
    input: { itemId: number; status: OrderItemStatus },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: OrderMutationErrorCode }
  >;
  cancelOrder(
    orderId: number,
    input: { userId?: string },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: OrderMutationErrorCode }
  >;
  reorder(
    orderId: number,
    input: { userId: string },
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: OrderMutationErrorCode }
  >;
  completePickup(
    pickupCode: string,
  ): Promise<
    { ok: true; order: Order } | { ok: false; code: OrderMutationErrorCode }
  >;
}
