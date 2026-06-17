import { mkdir, rename } from "node:fs/promises";
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
import type { Store } from "../Store.ts";

interface DataStore {
  users: User[];
  menu: MenuItem[];
  orders: Order[];
  userIdCounter: number;
  menuIdCounter: number;
  orderIdCounter: number;
}

interface JsonFileStoreOptions {
  dataFilePath: string;
}

const orderStatuses = new Set<OrderStatus>([
  "pending",
  "submitted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
]);

const orderItemStatuses = new Set<OrderItemStatus>([
  "queued",
  "preparing",
  "ready",
  "served",
  "cancelled",
]);

const defaultMenu: MenuItem[] = [
  {
    id: 1,
    name: "火腿蛋吐司",
    price: 40,
    category: "餐點",
    description: "現煎雞蛋搭配火腿與生菜，使用微烤白吐司，口感清爽不油膩。",
    image_url: "/imgs/menu/ham-egg-toast.webp",
    default_time: 6,
    is_available: true,
  },
  {
    id: 2,
    name: "起司豬排堡",
    price: 65,
    category: "餐點",
    description: "厚切豬排搭配起司與生菜，外酥內嫩，適合喜歡有咬勁的你。",
    image_url: "/imgs/menu/cheese-pork-burger.webp",
    default_time: 9,
    is_available: true,
  },
  {
    id: 3,
    name: "鮪魚蛋吐司",
    price: 45,
    category: "餐點",
    description: "自調鮪魚沙拉配上煎蛋與生菜，口味濃郁但不會太鹹。",
    image_url: "/imgs/menu/tuna-egg-toast.webp",
    default_time: 5,
    is_available: true,
  },
  {
    id: 4,
    name: "培根蛋餅",
    price: 45,
    category: "餐點",
    description: "煎到微酥的蛋餅皮包裹煙燻培根與雞蛋，是經典台式早餐選擇。",
    image_url: "/imgs/menu/bacon-egg-roll.webp",
    default_time: 7,
    is_available: true,
  },
  {
    id: 5,
    name: "紅茶",
    price: 25,
    category: "飲料",
    description: "古早味紅茶，微糖微冰為店內推薦比例。",
    image_url: "/imgs/menu/black-tea.webp",
    default_time: 2,
    is_available: true,
  },
];

const defaultUsers: User[] = [
  {
    id: "1",
    email: "demo@example.com",
    name: "示範使用者",
    password: "1234",
    role: "staff",
  },
  {
    id: "2",
    email: "amy@example.com",
    name: "Amy",
    password: "1234",
    role: "customer",
  },
];

function cloneDefaultMenu(): MenuItem[] {
  return defaultMenu.map((item) => ({ ...item }));
}

function cloneDefaultUsers(): User[] {
  return defaultUsers.map((user) => ({ ...user }));
}

function toId(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return fallback;
}

function calculateOrderTotal(items: ReadonlyArray<OrderItem>): number {
  return items.reduce((sum, orderItem) => {
    return sum + orderItem.item.price * orderItem.qty;
  }, 0);
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
  const dineInMinutes = order.orderType === "dine_in" ? 1 : 0;
  const minutes = Math.max(
    3,
    activeAhead * 3 + cookingMinutes + packagingMinutes + dineInMinutes,
  );

  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function generatePickupCode(orderId: number): string {
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BF${String(orderId).padStart(4, "0")}${suffix}`;
}

function normalizeMenuItem(item: Partial<MenuItem>): MenuItem {
  return {
    id: item.id ?? 0,
    name: item.name ?? "",
    price: item.price ?? 0,
    category: item.category ?? "未分類",
    description: item.description ?? "",
    image_url: item.image_url ?? "",
    default_time: item.default_time ?? 5,
    is_available: item.is_available ?? true,
  };
}

function normalizeUser(user: Partial<User> & { id?: string | number }): User {
  return {
    id: toId(user.id, "0"),
    email: user.email ?? "",
    name: user.name ?? "",
    password: user.password,
    phone: user.phone,
    role: user.role ?? "customer",
  };
}

function stripSensitiveUserData(user: User): Omit<User, "password"> {
  const { password: _password, ...safeUser } = user;
  return safeUser;
}

function normalizeOrderItem(item: Partial<OrderItem>): OrderItem {
  const rawStatus = item.status;
  return {
    item: normalizeMenuItem(item.item ?? {}),
    qty: item.qty ?? 0,
    note: item.note,
    status:
      rawStatus && orderItemStatuses.has(rawStatus) ? rawStatus : "queued",
  };
}

function normalizeOrder(
  order: Partial<Order> & { userId?: string | number },
  fallbackUserId: string,
): Order {
  const rawStatus = order.status;
  const normalizedItems = Array.isArray(order.items)
    ? order.items.map((item) => normalizeOrderItem(item))
    : [];

  return {
    id: order.id ?? 0,
    userId: toId(order.userId, fallbackUserId),
    items: normalizedItems,
    total: order.total ?? calculateOrderTotal(normalizedItems),
    status: rawStatus && orderStatuses.has(rawStatus) ? rawStatus : "pending",
    orderType: order.orderType ?? "takeout",
    packageType: order.packageType ?? "together",
    tableId: order.tableId,
    estimatedReadyAt: order.estimatedReadyAt,
    pickupCode: order.pickupCode,
    createdAt: order.createdAt ?? new Date().toISOString(),
    submittedAt: order.submittedAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
  };
}

function isEditable(order: Order): boolean {
  return order.status === "pending";
}

export class JsonFileStore implements Store {
  private readonly dataFilePath: string;

  private users: User[] = [];
  private menu: MenuItem[] = [];
  private orders: Order[] = [];
  private userIdCounter = 0;
  private menuIdCounter = 0;
  private orderIdCounter = 0;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: JsonFileStoreOptions) {
    this.dataFilePath = options.dataFilePath;
  }

  async init(): Promise<void> {
    const file = Bun.file(this.dataFilePath);

    if (!(await file.exists())) {
      const initialStore = this.createInitialStore();
      this.applyStore(initialStore);
      await this.saveStore(initialStore);
      return;
    }

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText) as Partial<DataStore>;

      if (!Array.isArray(parsed.menu) || !Array.isArray(parsed.orders)) {
        throw new Error("Invalid store schema");
      }

      const normalizedUsers = Array.isArray(parsed.users)
        ? parsed.users.map((user) => normalizeUser(user))
        : cloneDefaultUsers();
      const fallbackUserId = normalizedUsers[0]?.id ?? "1";

      this.applyStore({
        users: normalizedUsers,
        menu: parsed.menu.map((item) => normalizeMenuItem(item)),
        orders: parsed.orders.map((order) =>
          normalizeOrder(order, fallbackUserId),
        ),
        userIdCounter: parsed.userIdCounter ?? 0,
        menuIdCounter: parsed.menuIdCounter ?? 0,
        orderIdCounter: parsed.orderIdCounter ?? 0,
      });
    } catch (error) {
      console.warn("[store] load failed, fallback to initial store", error);
      const initialStore = this.createInitialStore();
      this.applyStore(initialStore);
      await this.saveStore(initialStore);
    }
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
      user: stripSensitiveUserData(matchedUser),
    };
  }

  getUserById(userId: string): Omit<User, "password"> | undefined {
    const user = this.users.find((targetUser) => targetUser.id === userId);
    return user ? stripSensitiveUserData(user) : undefined;
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
    const newMenuItem: MenuItem = {
      id: ++this.menuIdCounter,
      name: input.name,
      price: input.price,
      category: input.category,
      description: input.description,
      image_url: input.image_url,
      default_time: input.default_time ?? 5,
      is_available: input.is_available ?? true,
    };

    this.menu.push(newMenuItem);
    await this.persist();

    return newMenuItem;
  }

  async updateMenuItem(
    menuId: number,
    patch: Partial<MenuItem>,
  ): Promise<MenuItem | null> {
    const menuItem = this.menu.find((item) => item.id === menuId);
    if (!menuItem) {
      return null;
    }

    Object.assign(menuItem, {
      name: patch.name ?? menuItem.name,
      price: patch.price ?? menuItem.price,
      category: patch.category ?? menuItem.category,
      description: patch.description ?? menuItem.description,
      image_url: patch.image_url ?? menuItem.image_url,
      default_time: patch.default_time ?? menuItem.default_time,
      is_available: patch.is_available ?? menuItem.is_available,
    });

    await this.persist();
    return menuItem;
  }

  async deleteMenuItem(menuId: number): Promise<MenuItem | null> {
    const targetIndex = this.menu.findIndex((item) => item.id === menuId);
    if (targetIndex === -1) {
      return null;
    }

    const [removedMenuItem] = this.menu.splice(targetIndex, 1);
    await this.persist();

    return removedMenuItem ?? null;
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
      .filter(
        (order) => order.userId === userId && order.status !== "pending",
      )
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
    const newOrder: Order = {
      id: ++this.orderIdCounter,
      userId: input.userId,
      items: [],
      total: 0,
      status: "pending",
      orderType: input.orderType ?? "takeout",
      packageType: input.packageType ?? "together",
      tableId: input.tableId,
      createdAt: new Date().toISOString(),
    };

    this.orders.push(newOrder);
    await this.persist();

    return newOrder;
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

    if (!isEditable(order)) {
      return { ok: false as const, code: "ORDER_NOT_EDITABLE" as const };
    }

    order.orderType = input.orderType ?? order.orderType;
    order.packageType = input.packageType ?? order.packageType;

    if (input.tableId === null) {
      delete order.tableId;
    } else {
      order.tableId = input.tableId ?? order.tableId;
    }

    await this.persist();
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

    if (!isEditable(order)) {
      return { ok: false as const, code: "ORDER_NOT_EDITABLE" as const };
    }

    const menuItem = this.menu.find((item) => item.id === input.itemId);
    if (!menuItem || !menuItem.is_available) {
      return { ok: false as const, code: "MENU_ITEM_NOT_FOUND" as const };
    }

    const existingItemIndex = order.items.findIndex(
      (orderItem) => orderItem.item.id === input.itemId,
    );

    if (existingItemIndex !== -1) {
      const existingOrderItem = order.items[existingItemIndex];

      if (input.qty === 0) {
        order.items.splice(existingItemIndex, 1);
      } else if (existingOrderItem) {
        existingOrderItem.qty = input.qty;
        existingOrderItem.note = input.note ?? existingOrderItem.note;
      }
    } else if (input.qty > 0) {
      order.items.push({
        item: { ...menuItem },
        qty: input.qty,
        note: input.note,
        status: "queued",
      });
    }

    order.total = calculateOrderTotal(order.items);
    await this.persist();

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

    if (!isEditable(order)) {
      return { ok: false as const, code: "ORDER_NOT_EDITABLE" as const };
    }

    if (order.items.length === 0) {
      return { ok: false as const, code: "EMPTY_ORDER" as const };
    }

    order.orderType = input.orderType ?? order.orderType;
    order.packageType = input.packageType ?? order.packageType;
    order.tableId = input.tableId ?? order.tableId;
    order.status = "submitted";
    order.submittedAt = new Date().toISOString();
    order.estimatedReadyAt = estimateReadyAt(order, this.orders);
    order.pickupCode = generatePickupCode(order.id);
    order.items = order.items.map((item) => ({
      ...item,
      status: "queued",
    }));
    await this.persist();

    return { ok: true as const, order };
  }

  async updateOrderStatus(orderId: number, status: OrderStatus) {
    const order = this.orders.find((targetOrder) => targetOrder.id === orderId);
    if (!order) {
      return { ok: false as const, code: "ORDER_NOT_FOUND" as const };
    }

    order.status = status;

    if (status === "ready") {
      order.items = order.items.map((item) => ({ ...item, status: "ready" }));
    }

    if (status === "completed") {
      order.completedAt = new Date().toISOString();
      order.items = order.items.map((item) => ({ ...item, status: "served" }));
    }

    if (status === "cancelled") {
      order.cancelledAt = new Date().toISOString();
      order.items = order.items.map((item) => ({
        ...item,
        status: "cancelled",
      }));
    }

    await this.persist();
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

    orderItem.status = input.status;

    if (
      order.items.length > 0 &&
      order.items.every((item) => item.status === "ready")
    ) {
      order.status = "ready";
    }

    await this.persist();
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

    order.status = "cancelled";
    order.cancelledAt = new Date().toISOString();
    order.items = order.items.map((item) => ({ ...item, status: "cancelled" }));
    await this.persist();

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

    const newOrder: Order = {
      id: ++this.orderIdCounter,
      userId: input.userId,
      items: sourceOrder.items.map((item) => ({
        item: { ...item.item },
        qty: item.qty,
        note: item.note,
        status: "queued",
      })),
      total: sourceOrder.total,
      status: "pending",
      orderType: sourceOrder.orderType,
      packageType: sourceOrder.packageType,
      createdAt: new Date().toISOString(),
    };

    this.orders.push(newOrder);
    await this.persist();

    return { ok: true as const, order: newOrder };
  }

  async completePickup(pickupCode: string) {
    const order = this.orders.find(
      (targetOrder) => targetOrder.pickupCode === pickupCode,
    );

    if (!order) {
      return { ok: false as const, code: "PICKUP_CODE_INVALID" as const };
    }

    order.status = "completed";
    order.completedAt = new Date().toISOString();
    order.items = order.items.map((item) => ({ ...item, status: "served" }));
    await this.persist();

    return { ok: true as const, order };
  }

  private createInitialStore(): DataStore {
    return {
      users: cloneDefaultUsers(),
      menu: cloneDefaultMenu(),
      orders: [],
      userIdCounter: defaultUsers.length,
      menuIdCounter: defaultMenu.length,
      orderIdCounter: 0,
    };
  }

  private applyStore(store: DataStore): void {
    this.users = store.users;
    this.menu = store.menu;
    this.orders = store.orders;

    const maxUserId = this.users.reduce((max, user) => {
      const numericId = Number(user.id);
      return Number.isFinite(numericId) ? Math.max(max, numericId) : max;
    }, 0);

    const maxMenuId = this.menu.reduce(
      (max, item) => Math.max(max, item.id),
      0,
    );
    const maxOrderId = this.orders.reduce(
      (max, order) => Math.max(max, order.id),
      0,
    );

    this.userIdCounter = Math.max(store.userIdCounter || 0, maxUserId);
    this.menuIdCounter = Math.max(store.menuIdCounter || 0, maxMenuId);
    this.orderIdCounter = Math.max(store.orderIdCounter || 0, maxOrderId);
  }

  private buildStoreSnapshot(): DataStore {
    return {
      users: this.users,
      menu: this.menu,
      orders: this.orders,
      userIdCounter: this.userIdCounter,
      menuIdCounter: this.menuIdCounter,
      orderIdCounter: this.orderIdCounter,
    };
  }

  private async saveStore(snapshot: DataStore): Promise<void> {
    await mkdir("./data", { recursive: true });
    const tmpPath = `${this.dataFilePath}.tmp`;
    await Bun.write(tmpPath, JSON.stringify(snapshot, null, 2));
    await rename(tmpPath, this.dataFilePath);
  }

  private async persist(): Promise<void> {
    const snapshot = this.buildStoreSnapshot();

    this.persistQueue = this.persistQueue.then(async () => {
      await this.saveStore(snapshot);
    });

    await this.persistQueue;
  }
}
