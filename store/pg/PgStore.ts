import { and, asc, desc, eq, sql } from "drizzle-orm";
import type {
  MenuItem,
  Order,
  OrderItem,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PackageType,
  User,
} from "../../shared/contracts.ts";
import { db } from "../../db/client.ts";
import {
  menuItemsTable,
  orderItemsTable,
  ordersTable,
  usersTable,
} from "../../db/schema.ts";
import type { Store } from "../Store.ts";

interface PgStoreOptions {
  dataFilePath?: string;
}

interface SeedStore {
  users?: Array<Partial<User> & { id?: string | number }>;
  menu?: MenuItem[];
  orders?: Array<
    Partial<Order> & {
      userId?: string | number;
      items?: Array<{ item: MenuItem; qty: number; note?: string }>;
    }
  >;
}

const orderStatuses = new Set<OrderStatus>([
  "pending",
  "submitted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

function toSafeUser(user: User): Omit<User, "password"> {
  const { password: _password, ...safeUser } = user;
  return safeUser;
}

function toUserId(value: unknown, fallback = "1"): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function calculateTotal(items: ReadonlyArray<OrderItem>): number {
  return items.reduce((sum, item) => sum + item.item.price * item.qty, 0);
}

function estimateReadyAt(order: Order, activeOrders: ReadonlyArray<Order>): string {
  const activeAhead = activeOrders.filter((targetOrder) =>
    ["submitted", "preparing"].includes(targetOrder.status),
  ).length;
  const cookingMinutes = order.items.reduce((sum, orderItem) => {
    return sum + (orderItem.item.default_time || 5) * orderItem.qty;
  }, 0);
  const packagingMinutes =
    order.packageType === "separate"
      ? Math.max(2, order.items.reduce((sum, item) => sum + item.qty, 0))
      : 2;
  const minutes = Math.max(3, activeAhead * 3 + cookingMinutes + packagingMinutes);
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function generatePickupCode(orderId: number): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BF${String(orderId).padStart(4, "0")}${suffix}`;
}

function normalizeStatus(status: unknown): OrderStatus {
  return typeof status === "string" && orderStatuses.has(status as OrderStatus)
    ? (status as OrderStatus)
    : "pending";
}

function normalizeSeedData(seed: SeedStore): Required<SeedStore> {
  return {
    users: Array.isArray(seed.users) ? seed.users : [],
    menu: Array.isArray(seed.menu) ? seed.menu : [],
    orders: Array.isArray(seed.orders) ? seed.orders : [],
  };
}

export class PgStore implements Store {
  private readonly dataFilePath: string;

  private users: User[] = [];
  private menu: MenuItem[] = [];
  private orders: Order[] = [];

  constructor(options: PgStoreOptions = {}) {
    this.dataFilePath = options.dataFilePath ?? "./data/store.json";
  }

  async init(): Promise<void> {
    await db.execute(sql`select 1`);
    await this.seedFromJsonIfEmpty();
    await this.reloadFromDatabase();
  }

  login(input: {
    email: string;
    password: string;
  }):
    | { ok: true; user: Omit<User, "password"> }
    | { ok: false; code: "INVALID_CREDENTIALS" } {
    const matchedUser = this.users.find(
      (user) => user.email === input.email && user.password === input.password,
    );

    if (!matchedUser) {
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    return {
      ok: true,
      user: toSafeUser(matchedUser),
    };
  }

  getUserById(userId: string): Omit<User, "password"> | undefined {
    const user = this.users.find((targetUser) => targetUser.id === userId);
    return user ? toSafeUser(user) : undefined;
  }

  getMenu(): ReadonlyArray<MenuItem> {
    return this.menu;
  }

  getMenuItem(menuId: number): MenuItem | undefined {
    return this.menu.find((item) => item.id === menuId);
  }

  async createMenuItem(input: {
    name: string;
    price: number;
    category: string;
    description: string;
    image_url: string;
    default_time?: number;
    is_available?: boolean;
  }): Promise<MenuItem> {
    const [inserted] = await db
      .insert(menuItemsTable)
      .values({
        name: input.name,
        price: input.price,
        category: input.category,
        description: input.description,
        imageUrl: input.image_url,
        defaultTime: input.default_time ?? 5,
        isAvailable: input.is_available ?? true,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert menu item");
    }

    const createdItem: MenuItem = {
      id: inserted.id,
      name: inserted.name,
      price: inserted.price,
      category: inserted.category,
      description: inserted.description,
      image_url: inserted.imageUrl,
      default_time: inserted.defaultTime,
      is_available: inserted.isAvailable,
    };

    this.menu.push(createdItem);
    return createdItem;
  }

  async updateMenuItem(
    menuId: number,
    patch: Partial<MenuItem>,
  ): Promise<MenuItem | null> {
    const [updated] = await db
      .update(menuItemsTable)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.price !== undefined ? { price: patch.price } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.image_url !== undefined ? { imageUrl: patch.image_url } : {}),
        ...(patch.default_time !== undefined
          ? { defaultTime: patch.default_time }
          : {}),
        ...(patch.is_available !== undefined
          ? { isAvailable: patch.is_available }
          : {}),
      })
      .where(eq(menuItemsTable.id, menuId))
      .returning();

    if (!updated) {
      return null;
    }

    const nextItem: MenuItem = {
      id: updated.id,
      name: updated.name,
      price: updated.price,
      category: updated.category,
      description: updated.description,
      image_url: updated.imageUrl,
      default_time: updated.defaultTime,
      is_available: updated.isAvailable,
    };

    const targetIndex = this.menu.findIndex((item) => item.id === menuId);
    if (targetIndex !== -1) {
      this.menu[targetIndex] = nextItem;
    }

    return nextItem;
  }

  async deleteMenuItem(menuId: number): Promise<MenuItem | null> {
    const [removed] = await db
      .delete(menuItemsTable)
      .where(eq(menuItemsTable.id, menuId))
      .returning();

    if (!removed) {
      return null;
    }

    const removedItem: MenuItem = {
      id: removed.id,
      name: removed.name,
      price: removed.price,
      category: removed.category,
      description: removed.description,
      image_url: removed.imageUrl,
      default_time: removed.defaultTime,
      is_available: removed.isAvailable,
    };

    const targetIndex = this.menu.findIndex((item) => item.id === menuId);
    if (targetIndex !== -1) {
      this.menu.splice(targetIndex, 1);
    }

    return removedItem;
  }

  getOrders(): ReadonlyArray<Order> {
    return this.orders;
  }

  getCurrentOrderByUserId(userId: string): Order | undefined {
    return this.orders.find(
      (order) => order.userId === userId && order.status === "pending",
    );
  }

  getOrderHistoryByUserId(userId: string): ReadonlyArray<Order> {
    return this.orders
      .filter((order) => order.userId === userId && order.status !== "pending")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOrderById(orderId: number): Order | undefined {
    return this.orders.find((order) => order.id === orderId);
  }

  async createOrder(input: {
    userId: string;
    orderType?: OrderType;
    packageType?: PackageType;
    tableId?: number;
  }): Promise<Order> {
    const createdAt = new Date();

    const [inserted] = await db
      .insert(ordersTable)
      .values({
        userId: input.userId,
        status: "pending",
        total: 0,
        createdAt,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to create order");
    }

    const order: Order = {
      id: inserted.id,
      userId: inserted.userId,
      items: [],
      total: inserted.total,
      status: "pending",
      orderType: input.orderType ?? "takeout",
      packageType: input.packageType ?? "together",
      tableId: input.tableId,
      createdAt:
        inserted.createdAt instanceof Date
          ? inserted.createdAt.toISOString()
          : new Date(inserted.createdAt).toISOString(),
    };

    this.orders.push(order);
    return order;
  }

  async configureOrder(
    orderId: number,
    input: {
      userId: string;
      orderType?: OrderType;
      packageType?: PackageType;
      tableId?: number | null;
    },
  ) {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }
    if (order.userId !== input.userId) {
      return { ok: false as const, code: "ORDER_NOT_OWNED" as const };
    }
    if (order.status !== "pending") {
      return { ok: false as const, code: "ORDER_NOT_EDITABLE" as const };
    }

    order.orderType = input.orderType ?? order.orderType;
    order.packageType = input.packageType ?? order.packageType;
    if (input.tableId === null) {
      delete order.tableId;
    } else {
      order.tableId = input.tableId ?? order.tableId;
    }

    return { ok: true as const, order };
  }

  async updateOrderItem(
    orderId: number,
    input: {
      userId: string;
      itemId: number;
      qty: number;
      note?: string;
    },
  ) {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }

    if (order.userId !== input.userId) {
      return { ok: false as const, code: "ORDER_NOT_OWNED" as const };
    }

    if (order.status !== "pending") {
      return { ok: false as const, code: "ORDER_NOT_EDITABLE" as const };
    }

    const menuItem = this.menu.find((item) => item.id === input.itemId);
    if (!menuItem || !menuItem.is_available) {
      return { ok: false as const, code: "MENU_ITEM_NOT_FOUND" as const };
    }

    const existingOrderItemIndex = order.items.findIndex(
      (item) => item.item.id === input.itemId,
    );

    if (existingOrderItemIndex !== -1) {
      if (input.qty === 0) {
        await db
          .delete(orderItemsTable)
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              eq(orderItemsTable.itemId, input.itemId),
            ),
          );
        order.items.splice(existingOrderItemIndex, 1);
      } else {
        await db
          .update(orderItemsTable)
          .set({ qty: input.qty, note: input.note })
          .where(
            and(
              eq(orderItemsTable.orderId, orderId),
              eq(orderItemsTable.itemId, input.itemId),
            ),
          );
        const target = order.items[existingOrderItemIndex];
        if (target) {
          target.qty = input.qty;
          target.note = input.note ?? target.note;
        }
      }
    } else if (input.qty > 0) {
      await db.insert(orderItemsTable).values({
        orderId,
        itemId: menuItem.id,
        name: menuItem.name,
        price: menuItem.price,
        category: menuItem.category,
        description: menuItem.description,
        imageUrl: menuItem.image_url,
        qty: input.qty,
        note: input.note,
        status: "queued",
      });

      order.items.push({
        item: { ...menuItem },
        qty: input.qty,
        note: input.note,
        status: "queued",
      });
    }

    order.total = calculateTotal(order.items);

    await db
      .update(ordersTable)
      .set({ total: order.total })
      .where(eq(ordersTable.id, orderId));

    return { ok: true as const, order };
  }

  async submitOrder(
    orderId: number,
    input: {
      userId: string;
      orderType?: OrderType;
      packageType?: PackageType;
      tableId?: number;
    },
  ) {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }

    if (order.userId !== input.userId) {
      return { ok: false as const, code: "ORDER_NOT_OWNED" as const };
    }

    if (order.status !== "pending") {
      return { ok: false as const, code: "ORDER_NOT_EDITABLE" as const };
    }

    if (order.items.length === 0) {
      return { ok: false as const, code: "EMPTY_ORDER" as const };
    }

    const submittedAt = new Date().toISOString();

    await db
      .update(ordersTable)
      .set({
        status: "submitted",
        submittedAt: new Date(submittedAt),
      })
      .where(eq(ordersTable.id, orderId));

    order.status = "submitted";
    order.submittedAt = submittedAt;
    order.orderType = input.orderType ?? order.orderType;
    order.packageType = input.packageType ?? order.packageType;
    order.tableId = input.tableId ?? order.tableId;
    order.estimatedReadyAt = estimateReadyAt(order, this.orders);
    order.pickupCode = generatePickupCode(order.id);

    return { ok: true as const, order };
  }

  async updateOrderStatus(orderId: number, status: OrderStatus) {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }

    await db
      .update(ordersTable)
      .set({ status })
      .where(eq(ordersTable.id, orderId));

    order.status = status;
    if (status === "completed") {
      order.completedAt = new Date().toISOString();
    }
    if (status === "cancelled") {
      order.cancelledAt = new Date().toISOString();
    }

    return { ok: true as const, order };
  }

  async updateOrderItemStatus(
    orderId: number,
    input: { itemId: number; status: OrderItemStatus },
  ) {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }

    const orderItem = order.items.find((item) => item.item.id === input.itemId);
    if (!orderItem) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }

    await db
      .update(orderItemsTable)
      .set({ status: input.status })
      .where(
        and(
          eq(orderItemsTable.orderId, orderId),
          eq(orderItemsTable.itemId, input.itemId),
        ),
      );

    orderItem.status = input.status;

    if (
      order.items.length > 0 &&
      order.items.every((item) => item.status === "ready")
    ) {
      order.status = "ready";
      await db
        .update(ordersTable)
        .set({ status: "ready" })
        .where(eq(ordersTable.id, orderId));
    }

    return { ok: true as const, order };
  }

  async cancelOrder(orderId: number, input: { userId?: string }) {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }
    if (input.userId && order.userId !== input.userId) {
      return { ok: false as const, code: "ORDER_NOT_OWNED" as const };
    }
    if (["completed", "cancelled"].includes(order.status)) {
      return { ok: false as const, code: "ORDER_NOT_EDITABLE" as const };
    }

    await db
      .update(ordersTable)
      .set({ status: "cancelled" })
      .where(eq(ordersTable.id, orderId));

    order.status = "cancelled";
    order.cancelledAt = new Date().toISOString();

    return { ok: true as const, order };
  }

  async reorder(orderId: number, input: { userId: string }) {
    const sourceOrder = this.orders.find(
      (targetOrder) =>
        targetOrder.id === orderId && targetOrder.userId === input.userId,
    );
    if (!sourceOrder) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }

    const newOrder = await this.createOrder({
      userId: input.userId,
      orderType: sourceOrder.orderType,
      packageType: sourceOrder.packageType,
    });

    for (const item of sourceOrder.items) {
      await this.updateOrderItem(newOrder.id, {
        userId: input.userId,
        itemId: item.item.id,
        qty: item.qty,
        note: item.note,
      });
    }

    return { ok: true as const, order: newOrder };
  }

  async completePickup(pickupCode: string) {
    const order = this.orders.find(
      (targetOrder) => targetOrder.pickupCode === pickupCode,
    );
    if (!order) {
      return { ok: false as const, code: "PICKUP_CODE_INVALID" as const };
    }

    await db
      .update(ordersTable)
      .set({ status: "completed" })
      .where(eq(ordersTable.id, order.id));

    order.status = "completed";
    order.completedAt = new Date().toISOString();

    return { ok: true as const, order };
  }

  private async seedFromJsonIfEmpty(): Promise<void> {
    const [usersCountRow] = await db
      .select({ value: sql<number>`count(*)` })
      .from(usersTable);

    const usersCount = Number(usersCountRow?.value ?? 0);
    if (usersCount > 0) {
      return;
    }

    const file = Bun.file(this.dataFilePath);
    if (!(await file.exists())) {
      return;
    }

    const rawText = await file.text();
    const parsed = JSON.parse(rawText) as SeedStore;
    const normalized = normalizeSeedData(parsed);

    if (normalized.users.length > 0) {
      await db.insert(usersTable).values(
        normalized.users.map((user) => ({
          id: Number(user.id),
          email: user.email ?? "",
          name: user.name ?? "",
          password: user.password ?? "",
          role: user.role ?? "customer",
        })),
      );
    }

    if (normalized.menu.length > 0) {
      await db.insert(menuItemsTable).values(
        normalized.menu.map((item) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          category: item.category,
          description: item.description,
          imageUrl: item.image_url,
          defaultTime: item.default_time ?? 5,
          isAvailable: item.is_available ?? true,
        })),
      );
    }

    if (normalized.orders.length > 0) {
      for (const order of normalized.orders) {
        const orderItems = Array.isArray(order.items) ? order.items : [];
        await db.insert(ordersTable).values({
          id: order.id,
          userId: toUserId(order.userId),
          total: order.total ?? 0,
          status: normalizeStatus(order.status),
          createdAt: new Date(order.createdAt ?? new Date().toISOString()),
          submittedAt: order.submittedAt ? new Date(order.submittedAt) : null,
        });

        if (orderItems.length > 0 && order.id) {
          await db.insert(orderItemsTable).values(
            orderItems.map((orderItem) => ({
              orderId: order.id!,
              itemId: orderItem.item.id,
              name: orderItem.item.name,
              price: orderItem.item.price,
              category: orderItem.item.category,
              description: orderItem.item.description,
              imageUrl: orderItem.item.image_url,
              qty: orderItem.qty,
              note: orderItem.note,
              status: "queued",
            })),
          );
        }
      }
    }

    await db.execute(
      sql`select setval('users_id_seq', coalesce((select max(id) from users), 1), true)`,
    );
    await db.execute(
      sql`select setval('menu_items_id_seq', coalesce((select max(id) from menu_items), 1), true)`,
    );
    await db.execute(
      sql`select setval('orders_id_seq', coalesce((select max(id) from orders), 1), true)`,
    );
    await db.execute(
      sql`select setval('order_items_id_seq', coalesce((select max(id) from order_items), 1), true)`,
    );
  }

  private async reloadFromDatabase(): Promise<void> {
    const userRows = await db
      .select()
      .from(usersTable)
      .orderBy(asc(usersTable.id));
    const menuRows = await db
      .select()
      .from(menuItemsTable)
      .orderBy(asc(menuItemsTable.id));
    const orderRows = await db
      .select()
      .from(ordersTable)
      .orderBy(desc(ordersTable.createdAt), desc(ordersTable.id));
    const orderItemRows = await db
      .select()
      .from(orderItemsTable)
      .orderBy(asc(orderItemsTable.id));

    this.users = userRows.map((row) => ({
      id: String(row.id),
      email: row.email,
      name: row.name,
      password: row.password,
      role: (row.role as User["role"]) ?? "customer",
    }));

    this.menu = menuRows.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      category: row.category,
      description: row.description,
      image_url: row.imageUrl,
      default_time: row.defaultTime,
      is_available: row.isAvailable,
    }));

    const itemsByOrderId = new Map<number, OrderItem[]>();
    for (const row of orderItemRows) {
      const orderItems = itemsByOrderId.get(row.orderId) ?? [];
      orderItems.push({
        item: {
          id: row.itemId,
          name: row.name,
          price: row.price,
          category: row.category,
          description: row.description,
          image_url: row.imageUrl,
          default_time: 5,
          is_available: true,
        },
        qty: row.qty,
        note: row.note ?? undefined,
        status: (row.status as OrderItemStatus) || "queued",
      });
      itemsByOrderId.set(row.orderId, orderItems);
    }

    this.orders = orderRows.map((row) => ({
      id: row.id,
      userId: row.userId,
      items: itemsByOrderId.get(row.id) ?? [],
      total: row.total,
      status: normalizeStatus(row.status),
      orderType: "takeout",
      packageType: "together",
      createdAt:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(row.createdAt).toISOString(),
      submittedAt: row.submittedAt
        ? row.submittedAt instanceof Date
          ? row.submittedAt.toISOString()
          : new Date(row.submittedAt).toISOString()
        : undefined,
    }));
  }
}
