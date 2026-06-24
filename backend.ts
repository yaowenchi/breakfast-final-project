import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import toTaipeiDateTime from "./util.ts";
import { createStore } from "./store/index.ts";
import {
  clearLocalSessionCookie,
  createLocalSessionCookie,
  getAuthConfigStatus,
  getSessionUser,
  handleAuthRequest,
  roleForEmail,
} from "./auth.ts";
import type {
  DiningTable,
  Ingredient,
  Order,
  OrderStatus,
  ProductIngredient,
  SessionUser,
  TableStatus,
  UserRole,
} from "./shared/contracts.ts";
import {
  apiErrorResponseSchema,
  configureOrderBodySchema,
  createIngredientBodySchema,
  createMenuItemBodySchema,
  createOrderBodySchema,
  createTableBodySchema,
  currentOrderResponseSchema,
  deleteMenuItemParamsSchema,
  getOrderByIdParamsSchema,
  getOrderByIdQuerySchema,
  getOrderCurrentQuerySchema,
  healthResponseSchema,
  ingredientListResponseSchema,
  ingredientResponseSchema,
  loginBodySchema,
  loginResponseSchema,
  menuItemResponseSchema,
  menuListResponseSchema,
  menuSearchQuerySchema,
  orderHistoryQuerySchema,
  orderListResponseSchema,
  orderResponseEnvelopeSchema,
  pickupVerificationResponseSchema,
  pickupVerifyBodySchema,
  productIngredientsResponseSchema,
  registerBodySchema,
  reportQuerySchema,
  sessionResponseSchema,
  setProductIngredientsBodySchema,
  submitOrderBodySchema,
  submitOrderParamsSchema,
  tableListResponseSchema,
  tableResponseSchema,
  toOrderResponse,
  updateIngredientBodySchema,
  updateMenuItemBodySchema,
  updateMenuItemParamsSchema,
  updateOrderBodySchema,
  updateOrderItemStatusBodySchema,
  updateOrderParamsSchema,
  updateOrderStatusBodySchema,
  updateTableBodySchema,
} from "./shared/route-schemas.ts";

const port = parseInt(process.env.PORT || "3000", 10);
const host = process.env.HOST || "0.0.0.0";
const allowedOrigin = process.env.API_ALLOWED_ORIGIN || "*";
const store = createStore({ dataFilePath: "./data/store.json" });

const staticContentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
};

function contentTypeFor(pathname: string) {
  const dotIndex = pathname.lastIndexOf(".");
  if (dotIndex === -1) {
    return "application/octet-stream";
  }

  return (
    staticContentTypes[pathname.slice(dotIndex).toLowerCase()] ??
    "application/octet-stream"
  );
}

function normalizePublicPath(pathname: string) {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const normalizedPathname = decodedPathname.replaceAll("\\", "/");
  if (normalizedPathname.includes("..")) {
    return null;
  }

  if (normalizedPathname === "/" || normalizedPathname === "/index.html") {
    return "/index.html";
  }

  return normalizedPathname;
}

async function servePublicFile(pathname: string) {
  const publicPath = normalizePublicPath(pathname);
  if (!publicPath) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }

  const file = Bun.file(`./public${publicPath}`);
  if (await file.exists()) {
    return new Response(file, {
      headers: { "content-type": contentTypeFor(publicPath) },
    });
  }

  const indexFile = Bun.file("./public/index.html");
  return new Response(indexFile, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

const roleRank: Record<UserRole, number> = {
  customer: 0,
  staff: 1,
  manager: 2,
};

let ingredients: Ingredient[] = [
  { id: 1, name: "蛋", stock: 120, unit: "顆", reorderLevel: 30 },
  { id: 2, name: "吐司", stock: 80, unit: "片", reorderLevel: 25 },
  { id: 3, name: "火腿", stock: 60, unit: "片", reorderLevel: 20 },
  { id: 4, name: "起司", stock: 50, unit: "片", reorderLevel: 15 },
  { id: 5, name: "培根", stock: 45, unit: "片", reorderLevel: 15 },
  { id: 6, name: "紅茶", stock: 18, unit: "公升", reorderLevel: 5 },
];

let productIngredients: ProductIngredient[] = [
  { id: 1, productId: 1, ingredientId: 1, quantity: 1 },
  { id: 2, productId: 1, ingredientId: 2, quantity: 2 },
  { id: 3, productId: 1, ingredientId: 3, quantity: 1 },
  { id: 4, productId: 2, ingredientId: 4, quantity: 1 },
  { id: 5, productId: 3, ingredientId: 1, quantity: 1 },
  { id: 6, productId: 4, ingredientId: 1, quantity: 1 },
  { id: 7, productId: 4, ingredientId: 5, quantity: 1 },
  { id: 8, productId: 7, ingredientId: 6, quantity: 0.3 },
];

let tables: DiningTable[] = [
  { id: 1, code: "A1", capacity: 2, status: "available" },
  { id: 2, code: "A2", capacity: 2, status: "available" },
  { id: 3, code: "B1", capacity: 4, status: "available" },
  { id: 4, code: "B2", capacity: 4, status: "available" },
  { id: 5, code: "C1", capacity: 6, status: "available" },
];

let ingredientIdCounter = ingredients.length;
let productIngredientIdCounter = productIngredients.length;
let tableIdCounter = tables.length;

function orderToResponse(order: Order) {
  return toOrderResponse(order);
}

function hasRole(user: SessionUser | null, minimumRole: UserRole): boolean {
  return Boolean(user && roleRank[user.role] >= roleRank[minimumRole]);
}

function denyUnauthorized(set: unknown) {
  (set as { status: number }).status = 401;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function denyForbidden(set: unknown) {
  (set as { status: number }).status = 403;
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

function configuredCredentialLogin(input: {
  email: string;
  password: string;
}): SessionUser | null {
  const candidates: Array<{
    id: string;
    email?: string;
    password?: string;
    name?: string;
    role: UserRole;
  }> = [
    {
      id: "staff-demo",
      email: process.env.STAFF_EMAIL ?? process.env.DEMO_EMAIL,
      password: process.env.STAFF_PASSWORD ?? process.env.DEMO_PASSWORD,
      name: process.env.STAFF_NAME ?? process.env.DEMO_NAME ?? "Kitchen Demo",
      role: "staff",
    },
    {
      id: "boss",
      email: process.env.BOSS_EMAIL,
      password: process.env.BOSS_PASSWORD,
      name: process.env.BOSS_NAME ?? "Boss",
      role: "manager",
    },
  ];

  const matched = candidates.find((candidate) => {
    return (
      candidate.email &&
      candidate.password &&
      candidate.email.trim().toLowerCase() === input.email.trim().toLowerCase() &&
      candidate.password === input.password
    );
  });

  if (!matched?.email) {
    return null;
  }

  return {
    id: matched.id,
    email: matched.email,
    name: matched.name ?? matched.email,
    role: matched.role,
  };
}

async function resolveRequestUser(
  request: Request,
  explicitUserId?: string,
): Promise<SessionUser | null> {
  const sessionUser = await getSessionUser(request);
  if (sessionUser) {
    return sessionUser;
  }

  if (!explicitUserId) {
    return null;
  }

  if (explicitUserId.startsWith("guest-")) {
    return {
      id: explicitUserId,
      email: `${explicitUserId}@guest.local`,
      name: "訪客",
      role: "customer",
    };
  }

  const storeUser = store.getUserById(explicitUserId);
  if (!storeUser) {
    return null;
  }

  return {
    id: storeUser.id,
    email: storeUser.email,
    name: storeUser.name,
    role: roleForEmail(storeUser.email, storeUser.role ?? "customer"),
  };
}

async function requireRole(
  request: Request,
  set: unknown,
  minimumRole: UserRole,
): Promise<SessionUser | Response> {
  const user = await resolveRequestUser(request);
  if (!user) {
    return denyUnauthorized(set);
  }

  if (!hasRole(user, minimumRole)) {
    return denyForbidden(set);
  }

  return user;
}

function isAuthError(value: unknown): value is Response {
  return value instanceof Response;
}

function getActiveKitchenOrders(): Order[] {
  return store
    .getOrders()
    .filter((order) =>
      ["submitted", "preparing", "ready"].includes(order.status),
    )
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function buildBatchSuggestions() {
  const ingredientMap = new Map<
    number,
    {
      ingredient: Ingredient;
      totalQuantity: number;
      orderIds: number[];
      productNames: string[];
    }
  >();

  for (const order of getActiveKitchenOrders()) {
    for (const orderItem of order.items) {
      const relations = productIngredients.filter(
        (relation) => relation.productId === orderItem.item.id,
      );

      for (const relation of relations) {
        const ingredient = ingredients.find(
          (targetIngredient) => targetIngredient.id === relation.ingredientId,
        );
        if (!ingredient) {
          continue;
        }

        const current = ingredientMap.get(ingredient.id) ?? {
          ingredient,
          totalQuantity: 0,
          orderIds: [],
          productNames: [],
        };
        current.totalQuantity += relation.quantity * orderItem.qty;
        current.orderIds.push(order.id);
        current.productNames.push(orderItem.item.name);
        ingredientMap.set(ingredient.id, current);
      }
    }
  }

  return [...ingredientMap.values()]
    .filter((item) => item.orderIds.length >= 2 || item.totalQuantity > 1)
    .map((item) => ({
      ingredientId: item.ingredient.id,
      ingredientName: item.ingredient.name,
      unit: item.ingredient.unit,
      totalQuantity: Number(item.totalQuantity.toFixed(2)),
      orderIds: [...new Set(item.orderIds)],
      productNames: [...new Set(item.productNames)],
      suggestion: `建議一次處理 ${Number(item.totalQuantity.toFixed(2))} ${item.ingredient.unit}${item.ingredient.name}`,
    }));
}

function buildEstimate(order: Order) {
  const queueMinutes = getActiveKitchenOrders().length * 3;
  const cookingMinutes = order.items.reduce((sum, orderItem) => {
    return sum + (orderItem.item.default_time || 5) * orderItem.qty;
  }, 0);
  const packagingMinutes =
    order.packageType === "separate"
      ? Math.max(2, order.items.reduce((sum, item) => sum + item.qty, 0))
      : 2;
  const batchSavingMinutes = Math.min(buildBatchSuggestions().length * 2, 8);
  const totalMinutes = Math.max(
    3,
    queueMinutes + cookingMinutes + packagingMinutes - batchSavingMinutes,
  );

  return {
    queueMinutes,
    cookingMinutes,
    packagingMinutes,
    batchSavingMinutes,
    totalMinutes,
    estimatedReadyAt: new Date(Date.now() + totalMinutes * 60_000).toISOString(),
  };
}

function parseDateRange(query: { from?: string; to?: string }) {
  const from = query.from ? new Date(query.from) : new Date(0);
  const to = query.to ? new Date(query.to) : new Date("9999-12-31T23:59:59Z");
  return { from, to };
}

function getReportOrders(query: { from?: string; to?: string }) {
  const { from, to } = parseDateRange(query);
  return store.getOrders().filter((order) => {
    const createdAt = new Date(order.createdAt);
    return createdAt >= from && createdAt <= to && order.status !== "cancelled";
  });
}

function setTableStatus(
  tableId: number,
  status: TableStatus,
  currentOrderId?: number | null,
) {
  const table = tables.find((targetTable) => targetTable.id === tableId);
  if (!table) {
    return null;
  }

  table.status = status;
  if (status === "seated" || status === "dining") {
    table.seatedAt = table.seatedAt ?? new Date().toISOString();
  }
  if (status === "available") {
    delete table.seatedAt;
    delete table.currentOrderId;
  } else if (currentOrderId === null) {
    delete table.currentOrderId;
  } else if (currentOrderId !== undefined) {
    table.currentOrderId = currentOrderId;
  }

  return table;
}

const app = new Elysia();

app.use(
  openapi({
    path: "/openapi",
    specPath: "/openapi/json",
    documentation: {
      info: {
        title: "Breakfast Shop System API",
        version: "1.0.0",
        description:
          "Breakfast ordering, KDS, ingredient scheduling, pickup, table management, reporting, and Google-ready auth API.",
      },
      tags: [
        { name: "auth", description: "Demo login and Better Auth endpoints" },
        { name: "menu", description: "Menu and product management" },
        { name: "orders", description: "Customer order flow and tracking" },
        { name: "kds", description: "Kitchen display system" },
        { name: "ingredients", description: "Ingredient stock and batching" },
        { name: "pickup", description: "QR code pickup verification" },
        { name: "tables", description: "Dine-in table management" },
        { name: "reports", description: "Revenue and operation reports" },
        { name: "system", description: "System status" },
      ],
    },
    exclude: {
      staticFile: true,
      paths: ["/openapi", "/openapi/json"],
    },
  }),
);

app.onRequest(({ request }) => {
  console.log(
    `[${toTaipeiDateTime(new Date().toISOString())}] ${request.method} ${new URL(request.url).pathname}`,
  );
});

app.options(
  "*",
  ({ set }) => {
    set.status = 204;
    return "";
  },
  { detail: { hide: true } },
);

app.onAfterHandle(({ request, set }) => {
  const requestOrigin = request.headers.get("origin");

  if (allowedOrigin === "*") {
    set.headers["access-control-allow-origin"] = requestOrigin || "*";
  } else if (requestOrigin === allowedOrigin) {
    set.headers["access-control-allow-origin"] = allowedOrigin;
  } else {
    return;
  }

  set.headers.vary = "Origin";
  set.headers["access-control-allow-methods"] =
    "GET,POST,PATCH,DELETE,OPTIONS";
  set.headers["access-control-allow-headers"] = "Content-Type, Authorization";
  set.headers["access-control-allow-credentials"] = "true";
});

app.post(
  "/api/auth/register",
  async ({ body, set }) => {
    if (roleForEmail(body.email) !== "customer") {
      set.status = 409;
      return { error: "RESERVED_EMAIL" };
    }

    const result = await store.register({
      email: body.email,
      name: body.name,
      password: body.password,
      phone: body.phone,
    });

    if (!result.ok) {
      set.status = 409;
      return { error: result.code };
    }

    const sessionUser: SessionUser = {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: "customer",
    };

    set.status = 201;
    set.headers["set-cookie"] = createLocalSessionCookie(sessionUser);
    return { data: sessionUser };
  },
  {
    body: registerBodySchema,
    detail: {
      tags: ["auth"],
      summary: "Register a customer account",
    },
    response: {
      201: loginResponseSchema,
      409: apiErrorResponseSchema,
    },
  },
);

app.post(
  "/api/auth/login",
  ({ body, set }) => {
    const configuredUser = configuredCredentialLogin({
      email: body.email,
      password: body.password,
    });
    if (configuredUser) {
      set.headers["set-cookie"] = createLocalSessionCookie(configuredUser);
      return { data: configuredUser };
    }

    const result = store.login({
      email: body.email,
      password: body.password,
    });

    if (!result.ok) {
      set.status = 401;
      return { error: "Invalid credentials" };
    }

    const sessionUser: SessionUser = {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: roleForEmail(result.user.email, result.user.role ?? "customer"),
    };

    set.headers["set-cookie"] = createLocalSessionCookie(sessionUser);
    return { data: sessionUser };
  },
  {
    body: loginBodySchema,
    detail: {
      tags: ["auth"],
      summary: "Login with demo credentials",
      description:
        "Keep the classroom demo login while Google OAuth is available through Better Auth.",
    },
    response: {
      200: loginResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/auth/session",
  async ({ request }) => {
    return { data: await getSessionUser(request) };
  },
  {
    detail: {
      tags: ["auth"],
      summary: "Get current Better Auth session",
    },
    response: {
      200: sessionResponseSchema,
    },
  },
);

app.post(
  "/api/auth/sign-out",
  ({ set }) => {
    set.headers["set-cookie"] = clearLocalSessionCookie();
    return { data: null };
  },
  {
    detail: {
      tags: ["auth"],
      summary: "Sign out local demo session",
    },
  },
);

app.all(
  "/api/auth/*",
  async ({ request }) => handleAuthRequest(request),
  {
    detail: {
      tags: ["auth"],
      summary: "Better Auth handler",
      description:
        "Handles Google sign-in, OAuth callback, sign-out, and Better Auth session endpoints.",
      hide: true,
    },
  },
);

app.get("/api/menu", ({ query }) => {
  const parsed = menuSearchQuerySchema.parse(query);
  const keyword = parsed.q?.trim().toLowerCase();
  const data = store.getMenu().filter((item) => {
    if (parsed.availableOnly && !item.is_available) {
      return false;
    }
    if (parsed.category && item.category !== parsed.category) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    return (
      item.name.toLowerCase().includes(keyword) ||
      item.description.toLowerCase().includes(keyword)
    );
  });
  return { data };
}, {
  detail: {
    tags: ["menu"],
    summary: "List or search menu items",
  },
  response: {
    200: menuListResponseSchema,
  },
});

app.get("/api/menu/categories", () => {
  return {
    data: [...new Set(store.getMenu().map((item) => item.category))].sort(),
  };
}, {
  detail: {
    tags: ["menu"],
    summary: "List menu categories",
  },
});

app.get("/api/menu/popular", () => {
  const countByItemId = new Map<number, number>();
  for (const order of store.getOrders()) {
    for (const orderItem of order.items) {
      countByItemId.set(
        orderItem.item.id,
        (countByItemId.get(orderItem.item.id) ?? 0) + orderItem.qty,
      );
    }
  }

  const data = store
    .getMenu()
    .map((item) => ({ item, soldQty: countByItemId.get(item.id) ?? 0 }))
    .sort((a, b) => b.soldQty - a.soldQty)
    .slice(0, 10);

  return { data };
}, {
  detail: {
    tags: ["menu"],
    summary: "Get popular menu items",
  },
});

app.get("/api/menu/recommended", () => {
  return {
    data: store
      .getMenu()
      .filter((item) => item.is_available)
      .sort((a, b) => a.default_time - b.default_time || a.price - b.price)
      .slice(0, 6),
  };
}, {
  detail: {
    tags: ["menu"],
    summary: "Get recommended menu items",
  },
});

app.get(
  "/api/menu/:id",
  ({ params, set }) => {
    const item = store.getMenuItem(params.id);
    if (!item) {
      set.status = 404;
      return { error: "Menu item not found" };
    }
    return { data: item };
  },
  {
    params: updateMenuItemParamsSchema,
    detail: {
      tags: ["menu"],
      summary: "Get menu item detail",
    },
    response: {
      200: menuItemResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.post(
  "/api/menu",
  async ({ body, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const newMenuItem = await store.createMenuItem(body);
    set.status = 201;
    return { data: newMenuItem };
  },
  {
    body: createMenuItemBodySchema,
    detail: {
      tags: ["menu"],
      summary: "Create a menu item",
    },
    response: {
      201: menuItemResponseSchema,
    },
  },
);

app.patch(
  "/api/menu/:id",
  async ({ params, body, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const menuItem = await store.updateMenuItem(params.id, body);
    if (!menuItem) {
      set.status = 404;
      return { error: "Menu item not found" };
    }
    return { data: menuItem };
  },
  {
    params: updateMenuItemParamsSchema,
    body: updateMenuItemBodySchema,
    detail: {
      tags: ["menu"],
      summary: "Update a menu item",
    },
    response: {
      200: menuItemResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/menu/:id/availability",
  async ({ params, body, request, set }) => {
    const user = await requireRole(request, set, "staff");
    if (isAuthError(user)) {
      return user as never;
    }

    const parsedBody = updateMenuItemBodySchema
      .pick({ is_available: true })
      .parse(body);
    const menuItem = await store.updateMenuItem(params.id, parsedBody);
    if (!menuItem) {
      set.status = 404;
      return { error: "Menu item not found" };
    }
    return { data: menuItem };
  },
  {
    params: updateMenuItemParamsSchema,
    body: updateMenuItemBodySchema.pick({ is_available: true }),
    detail: {
      tags: ["menu"],
      summary: "Set menu item availability for kitchen sold-out control",
    },
    response: {
      200: menuItemResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.delete(
  "/api/menu/:id",
  async ({ params, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const removedMenuItem = await store.deleteMenuItem(params.id);
    if (!removedMenuItem) {
      set.status = 404;
      return { error: "Menu item not found" };
    }
    return { data: removedMenuItem };
  },
  {
    params: deleteMenuItemParamsSchema,
    detail: {
      tags: ["menu"],
      summary: "Delete a menu item",
    },
    response: {
      200: menuItemResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/orders",
  async ({ request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    return {
      data: store.getOrders().map(orderToResponse),
    };
  },
  {
    detail: {
      tags: ["orders"],
      summary: "List all orders",
    },
    response: {
      200: orderListResponseSchema,
    },
  },
);

app.get(
  "/api/orders/current",
  async ({ query, request, set }) => {
    const user = await resolveRequestUser(request, query.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const currentOrder = store.getCurrentOrderByUserId(user.id);
    return { data: currentOrder ? orderToResponse(currentOrder) : null };
  },
  {
    query: getOrderCurrentQuerySchema,
    detail: {
      tags: ["orders"],
      summary: "Get current order",
    },
    response: {
      200: currentOrderResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/orders/history",
  async ({ query, request, set }) => {
    const user = await resolveRequestUser(request, query.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    return {
      data: store.getOrderHistoryByUserId(user.id).map(orderToResponse),
    };
  },
  {
    query: orderHistoryQuerySchema,
    detail: {
      tags: ["orders"],
      summary: "Get order history",
    },
    response: {
      200: orderListResponseSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.post(
  "/api/orders",
  async ({ body, request, set }) => {
    const orderInput = body ?? {};
    const user = await resolveRequestUser(request, orderInput.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const existingOrder = store.getCurrentOrderByUserId(user.id);
    if (existingOrder) {
      return { data: orderToResponse(existingOrder) };
    }

    if (orderInput.orderType === "dine_in") {
      if (!orderInput.tableId) {
        set.status = 400;
        return { error: "TABLE_REQUIRED" };
      }

      const selectedTable = tables.find(
        (table) => table.id === orderInput.tableId,
      );
      if (!selectedTable || selectedTable.status !== "available") {
        set.status = 409;
        return { error: "TABLE_NOT_AVAILABLE" };
      }
    }

    const newOrder = await store.createOrder({
      userId: user.id,
      orderType: orderInput.orderType,
      packageType: orderInput.packageType,
      tableId: orderInput.tableId,
    });
    set.status = 201;
    return { data: orderToResponse(newOrder) };
  },
  {
    body: createOrderBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Create or reuse current order",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      201: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
    },
  },
);

app.get(
  "/api/orders/:id",
  async ({ params, query, request, set }) => {
    const order = store.getOrderById(params.id);
    if (!order) {
      set.status = 404;
      return { error: "Order not found" };
    }

    const user = await resolveRequestUser(request, query.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    if (order.userId !== user.id && !hasRole(user, "staff")) {
      set.status = 403;
      return { error: "Forbidden" };
    }

    return { data: orderToResponse(order) };
  },
  {
    params: getOrderByIdParamsSchema,
    query: getOrderByIdQuerySchema,
    detail: {
      tags: ["orders"],
      summary: "Get order by id",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/orders/:id",
  async ({ params, body, request, set }) => {
    const user = await resolveRequestUser(request, body.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const result = await store.updateOrderItem(params.id, {
      userId: user.id,
      itemId: body.itemId,
      qty: body.qty,
      note: body.note,
    });

    if (!result.ok) {
      set.status =
        result.code === "ORDER_NOT_OWNED"
          ? 403
          : result.code === "ORDER_NOT_EDITABLE"
            ? 409
            : 404;
      return { error: result.code };
    }

    return { data: orderToResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    body: updateOrderBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Update order item quantity and note",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
    },
  },
);

app.patch(
  "/api/orders/:id/options",
  async ({ params, body, request, set }) => {
    const user = await resolveRequestUser(request, body.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    if (body.orderType === "dine_in" && body.tableId) {
      const selectedTable = tables.find((table) => table.id === body.tableId);
      if (!selectedTable || selectedTable.status !== "available") {
        set.status = 409;
        return { error: "TABLE_NOT_AVAILABLE" };
      }
    }

    const result = await store.configureOrder(params.id, {
      userId: user.id,
      orderType: body.orderType,
      packageType: body.packageType,
      tableId: body.tableId,
    });

    if (!result.ok) {
      set.status =
        result.code === "ORDER_NOT_OWNED"
          ? 403
          : result.code === "ORDER_NOT_EDITABLE"
            ? 409
            : 404;
      return { error: result.code };
    }

    return { data: orderToResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    body: configureOrderBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Configure dine-in/takeout and package type",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
    },
  },
);

app.post(
  "/api/orders/:id/submit",
  async ({ params, body, request, set }) => {
    const submitInput = body ?? {};
    const user = await resolveRequestUser(request, submitInput.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const orderBeforeSubmit = store.getOrderById(params.id);
    if (!orderBeforeSubmit) {
      set.status = 404;
      return { error: "ORDER_NOT_FOUND" };
    }

    const nextOrderType =
      submitInput.orderType ?? orderBeforeSubmit.orderType ?? "takeout";
    const nextTableId = submitInput.tableId ?? orderBeforeSubmit.tableId;
    if (nextOrderType === "dine_in") {
      if (!nextTableId) {
        set.status = 400;
        return { error: "TABLE_REQUIRED" };
      }

      const selectedTable = tables.find((table) => table.id === nextTableId);
      if (!selectedTable || selectedTable.status !== "available") {
        set.status = 409;
        return { error: "TABLE_NOT_AVAILABLE" };
      }
    }

    const result = await store.submitOrder(params.id, {
      userId: user.id,
      orderType: submitInput.orderType,
      packageType: submitInput.packageType,
      tableId: submitInput.tableId,
    });

    if (!result.ok) {
      set.status =
        result.code === "ORDER_NOT_OWNED"
          ? 403
          : result.code === "ORDER_NOT_EDITABLE"
            ? 409
            : result.code === "EMPTY_ORDER"
              ? 400
              : 404;
      return { error: result.code };
    }

    if (result.order.orderType === "dine_in" && result.order.tableId) {
      setTableStatus(result.order.tableId, "reserved", result.order.id);
    }

    return { data: orderToResponse(result.order) };
  },
  {
    params: submitOrderParamsSchema,
    body: submitOrderBodySchema,
    detail: {
      tags: ["orders"],
      summary: "Submit order",
    },
    response: {
      200: orderResponseEnvelopeSchema,
      400: apiErrorResponseSchema,
      401: apiErrorResponseSchema,
      403: apiErrorResponseSchema,
      404: apiErrorResponseSchema,
      409: apiErrorResponseSchema,
    },
  },
);

app.post(
  "/api/orders/:id/cancel",
  async ({ params, query, request, set }) => {
    const user = await resolveRequestUser(request, query.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const result = await store.cancelOrder(params.id, {
      userId: user?.id,
    });

    if (!result.ok) {
      set.status =
        result.code === "ORDER_NOT_OWNED"
          ? 403
          : result.code === "ORDER_NOT_EDITABLE"
            ? 409
            : 404;
      return { error: result.code };
    }

    return { data: orderToResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    query: getOrderByIdQuerySchema,
    detail: {
      tags: ["orders"],
      summary: "Cancel order",
    },
  },
);

app.post(
  "/api/orders/:id/reorder",
  async ({ params, query, request, set }) => {
    const user = await resolveRequestUser(request, query.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const result = await store.reorder(params.id, { userId: user.id });
    if (!result.ok) {
      set.status = 404;
      return { error: result.code };
    }

    set.status = 201;
    return { data: orderToResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    query: getOrderByIdQuerySchema,
    detail: {
      tags: ["orders"],
      summary: "Create a new cart from historical order",
    },
  },
);

app.get(
  "/api/orders/:id/tracking",
  async ({ params, query, request, set }) => {
    const order = store.getOrderById(params.id);
    if (!order) {
      set.status = 404;
      return { error: "Order not found" };
    }

    const user = await resolveRequestUser(request, query.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    if (order.userId !== user.id && !hasRole(user, "staff")) {
      set.status = 403;
      return { error: "Forbidden" };
    }

    return {
      data: {
        orderId: order.id,
        status: order.status,
        itemStatuses: order.items.map((item) => ({
          itemId: item.item.id,
          name: item.item.name,
          status: item.status,
        })),
        estimatedReadyAt:
          order.estimatedReadyAt ?? buildEstimate(order).estimatedReadyAt,
        pickupCode: order.pickupCode,
      },
    };
  },
  {
    params: updateOrderParamsSchema,
    query: getOrderByIdQuerySchema,
    detail: {
      tags: ["orders"],
      summary: "Track order status and estimated ready time",
    },
  },
);

app.get(
  "/api/orders/:id/estimate",
  async ({ params, query, request, set }) => {
    const order = store.getOrderById(params.id);
    if (!order) {
      set.status = 404;
      return { error: "Order not found" };
    }

    const user = await resolveRequestUser(request, query.userId);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    if (order.userId !== user.id && !hasRole(user, "staff")) {
      set.status = 403;
      return { error: "Forbidden" };
    }

    return { data: buildEstimate(order) };
  },
  {
    params: updateOrderParamsSchema,
    query: getOrderByIdQuerySchema,
    detail: {
      tags: ["orders"],
      summary: "Estimate order ready time",
    },
  },
);

app.get("/api/kds/orders", async ({ request, set }) => {
  const user = await requireRole(request, set, "staff");
  if (isAuthError(user)) {
    return user as never;
  }

  return { data: getActiveKitchenOrders().map(orderToResponse) };
}, {
  detail: {
    tags: ["kds"],
    summary: "List active KDS orders",
  },
});

app.patch(
  "/api/kds/orders/:id/status",
  async ({ params, body, request, set }) => {
    const user = await requireRole(request, set, "staff");
    if (isAuthError(user)) {
      return user as never;
    }

    const result = await store.updateOrderStatus(params.id, body.status);
    if (!result.ok) {
      set.status = 404;
      return { error: result.code };
    }
    return { data: orderToResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    body: updateOrderStatusBodySchema,
    detail: {
      tags: ["kds"],
      summary: "Update KDS order status",
    },
  },
);

app.patch(
  "/api/kds/orders/:id/items/status",
  async ({ params, body, request, set }) => {
    const user = await requireRole(request, set, "staff");
    if (isAuthError(user)) {
      return user as never;
    }

    const result = await store.updateOrderItemStatus(params.id, {
      itemId: body.itemId,
      status: body.status,
    });
    if (!result.ok) {
      set.status = 404;
      return { error: result.code };
    }
    return { data: orderToResponse(result.order) };
  },
  {
    params: updateOrderParamsSchema,
    body: updateOrderItemStatusBodySchema,
    detail: {
      tags: ["kds"],
      summary: "Update KDS order item status",
    },
  },
);

app.get("/api/kds/batches", async ({ request, set }) => {
  const user = await requireRole(request, set, "staff");
  if (isAuthError(user)) {
    return user as never;
  }

  return { data: buildBatchSuggestions() };
}, {
  detail: {
    tags: ["kds"],
    summary: "Get shared ingredient batch suggestions",
  },
});

app.get("/api/kds/queue", async ({ request, set }) => {
  const user = await requireRole(request, set, "staff");
  if (isAuthError(user)) {
    return user as never;
  }

  const queue = getActiveKitchenOrders().map((order, index) => ({
    priority: index + 1,
    orderId: order.id,
    status: order.status,
    estimatedReadyAt: order.estimatedReadyAt ?? buildEstimate(order).estimatedReadyAt,
    itemCount: order.items.reduce((sum, item) => sum + item.qty, 0),
  }));
  return { data: queue };
}, {
  detail: {
    tags: ["kds"],
    summary: "Get kitchen production queue",
  },
});

app.get("/api/ingredients", async ({ request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  return { data: ingredients };
}, {
  detail: { tags: ["ingredients"], summary: "List ingredients" },
  response: { 200: ingredientListResponseSchema },
});

app.get("/api/ingredients/low-stock", async ({ request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  return {
    data: ingredients.filter(
      (ingredient) => ingredient.stock <= ingredient.reorderLevel,
    ),
  };
}, {
  detail: { tags: ["ingredients"], summary: "List low stock ingredients" },
});

app.post(
  "/api/ingredients",
  async ({ body, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const ingredient: Ingredient = {
      id: ++ingredientIdCounter,
      name: body.name,
      stock: body.stock,
      unit: body.unit,
      reorderLevel: body.reorderLevel ?? 0,
    };
    ingredients.push(ingredient);
    set.status = 201;
    return { data: ingredient };
  },
  {
    body: createIngredientBodySchema,
    detail: { tags: ["ingredients"], summary: "Create ingredient" },
    response: { 201: ingredientResponseSchema },
  },
);

app.patch(
  "/api/ingredients/:id",
  async ({ params, body, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const id = Number(params.id);
    const ingredient = ingredients.find((item) => item.id === id);
    if (!ingredient) {
      set.status = 404;
      return { error: "Ingredient not found" };
    }

    Object.assign(ingredient, {
      name: body.name ?? ingredient.name,
      stock: body.stock ?? ingredient.stock,
      unit: body.unit ?? ingredient.unit,
      reorderLevel: body.reorderLevel ?? ingredient.reorderLevel,
    });
    return { data: ingredient };
  },
  {
    body: updateIngredientBodySchema,
    detail: { tags: ["ingredients"], summary: "Update ingredient" },
  },
);

app.delete("/api/ingredients/:id", async ({ params, request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  const id = Number(params.id);
  const index = ingredients.findIndex((item) => item.id === id);
  if (index === -1) {
    set.status = 404;
    return { error: "Ingredient not found" };
  }

  const [removed] = ingredients.splice(index, 1);
  productIngredients = productIngredients.filter(
    (relation) => relation.ingredientId !== id,
  );
  return { data: removed };
}, {
  detail: { tags: ["ingredients"], summary: "Delete ingredient" },
});

app.get(
  "/api/menu/:id/ingredients",
  async ({ params, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    return {
      data: productIngredients.filter(
        (relation) => relation.productId === params.id,
      ),
    };
  },
  {
    params: updateMenuItemParamsSchema,
    detail: {
      tags: ["ingredients"],
      summary: "List product ingredient requirements",
    },
    response: {
      200: productIngredientsResponseSchema,
    },
  },
);

app.patch(
  "/api/menu/:id/ingredients",
  async ({ params, body, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    productIngredients = productIngredients.filter(
      (relation) => relation.productId !== params.id,
    );

    for (const item of body.ingredients) {
      productIngredients.push({
        id: ++productIngredientIdCounter,
        productId: params.id,
        ingredientId: item.ingredientId,
        quantity: item.quantity,
      });
    }

    return {
      data: productIngredients.filter(
        (relation) => relation.productId === params.id,
      ),
    };
  },
  {
    params: updateMenuItemParamsSchema,
    body: setProductIngredientsBodySchema,
    detail: {
      tags: ["ingredients"],
      summary: "Replace product ingredient requirements",
    },
  },
);

app.get(
  "/api/pickup/:id/qrcode",
  ({ params, set }) => {
    const order = store.getOrderById(Number(params.id));
    if (!order) {
      set.status = 404;
      return { error: "Order not found" };
    }

    return {
      data: {
        orderId: order.id,
        pickupCode: order.pickupCode,
        qrPayload: JSON.stringify({
          orderId: order.id,
          pickupCode: order.pickupCode,
        }),
      },
    };
  },
  {
    detail: {
      tags: ["pickup"],
      summary: "Get pickup QR payload",
    },
  },
);

app.post(
  "/api/pickup/verify",
  async ({ body, request, set }) => {
    const user = await requireRole(request, set, "staff");
    if (isAuthError(user)) {
      return user as never;
    }

    const result = await store.completePickup(body.pickupCode);
    if (!result.ok) {
      set.status = 404;
      return { error: result.code };
    }

    return {
      data: {
        orderId: result.order.id,
        pickupCode: body.pickupCode,
        verified: true,
        status: result.order.status,
      },
    };
  },
  {
    body: pickupVerifyBodySchema,
    detail: {
      tags: ["pickup"],
      summary: "Verify pickup code and complete order",
    },
    response: {
      200: pickupVerificationResponseSchema,
      404: apiErrorResponseSchema,
    },
  },
);

app.get("/api/tables", async ({ request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  return { data: tables };
}, {
  detail: { tags: ["tables"], summary: "List tables" },
  response: { 200: tableListResponseSchema },
});

app.get("/api/tables/available", () => {
  return { data: tables.filter((table) => table.status === "available") };
}, {
  detail: { tags: ["tables"], summary: "List available tables for ordering" },
});

app.post(
  "/api/tables",
  async ({ body, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const table: DiningTable = {
      id: ++tableIdCounter,
      code: body.code,
      capacity: body.capacity,
      status: "available",
    };
    tables.push(table);
    set.status = 201;
    return { data: table };
  },
  {
    body: createTableBodySchema,
    detail: { tags: ["tables"], summary: "Create table" },
    response: { 201: tableResponseSchema },
  },
);

app.patch(
  "/api/tables/:id",
  async ({ params, body, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const table = tables.find((targetTable) => targetTable.id === Number(params.id));
    if (!table) {
      set.status = 404;
      return { error: "Table not found" };
    }

    table.code = body.code ?? table.code;
    table.capacity = body.capacity ?? table.capacity;
    table.status = body.status ?? table.status;
    if (body.currentOrderId === null) {
      delete table.currentOrderId;
    } else {
      table.currentOrderId = body.currentOrderId ?? table.currentOrderId;
    }
    return { data: table };
  },
  {
    body: updateTableBodySchema,
    detail: { tags: ["tables"], summary: "Update table" },
  },
);

app.post("/api/tables/:id/seat", async ({ params, request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  const table = setTableStatus(Number(params.id), "seated");
  if (!table) {
    set.status = 404;
    return { error: "Table not found" };
  }
  return { data: table };
}, {
  detail: { tags: ["tables"], summary: "Seat customers at table" },
});

app.post("/api/tables/:id/leave", async ({ params, request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  const table = setTableStatus(Number(params.id), "cleaning", null);
  if (!table) {
    set.status = 404;
    return { error: "Table not found" };
  }
  return { data: table };
}, {
  detail: { tags: ["tables"], summary: "Mark table as waiting for cleaning" },
});

app.post("/api/tables/:id/clean", async ({ params, request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  const table = setTableStatus(Number(params.id), "available", null);
  if (!table) {
    set.status = 404;
    return { error: "Table not found" };
  }
  return { data: table };
}, {
  detail: { tags: ["tables"], summary: "Mark table available after cleaning" },
});

app.delete("/api/tables/:id", async ({ params, request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  const id = Number(params.id);
  const index = tables.findIndex((table) => table.id === id);
  if (index === -1) {
    set.status = 404;
    return { error: "Table not found" };
  }

  const [removed] = tables.splice(index, 1);
  return { data: removed };
}, {
  detail: { tags: ["tables"], summary: "Delete table" },
});

app.get(
  "/api/reports/revenue",
  async ({ query, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const orders = getReportOrders(reportQuerySchema.parse(query));
    const revenue = orders.reduce((sum, order) => sum + order.total, 0);
    const byStatus = orders.reduce(
      (acc, order) => {
        acc[order.status] = (acc[order.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<OrderStatus, number>,
    );

    return {
      data: {
        orderCount: orders.length,
        revenue,
        averageOrderValue: orders.length > 0 ? Math.round(revenue / orders.length) : 0,
        byStatus,
      },
    };
  },
  {
    query: reportQuerySchema,
    detail: { tags: ["reports"], summary: "Revenue report" },
  },
);

app.get(
  "/api/reports/popular-items",
  async ({ query, request, set }) => {
    const user = await requireRole(request, set, "manager");
    if (isAuthError(user)) {
      return user as never;
    }

    const orders = getReportOrders(reportQuerySchema.parse(query));
    const stats = new Map<number, { name: string; qty: number; revenue: number }>();
    for (const order of orders) {
      for (const item of order.items) {
        const current = stats.get(item.item.id) ?? {
          name: item.item.name,
          qty: 0,
          revenue: 0,
        };
        current.qty += item.qty;
        current.revenue += item.qty * item.item.price;
        stats.set(item.item.id, current);
      }
    }

    return {
      data: [...stats.entries()]
        .map(([itemId, value]) => ({ itemId, ...value }))
        .sort((a, b) => b.qty - a.qty),
    };
  },
  {
    query: reportQuerySchema,
    detail: { tags: ["reports"], summary: "Popular item report" },
  },
);

app.get("/api/reports/turnover", async ({ request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  const seatedTables = tables.filter((table) => table.seatedAt);
  const completedDineInOrders = store
    .getOrders()
    .filter(
      (order) => order.orderType === "dine_in" && order.status === "completed",
    );

  return {
    data: {
      totalSeats: tables.reduce((sum, table) => sum + table.capacity, 0),
      availableTables: tables.filter((table) => table.status === "available").length,
      activeSeatedTables: seatedTables.length,
      completedDineInOrders: completedDineInOrders.length,
      turnoverRate:
        tables.length > 0
          ? Number((completedDineInOrders.length / tables.length).toFixed(2))
          : 0,
    },
  };
}, {
  detail: { tags: ["reports"], summary: "Table turnover report" },
});

app.get("/api/reports/peak-hours", async ({ request, set }) => {
  const user = await requireRole(request, set, "manager");
  if (isAuthError(user)) {
    return user as never;
  }

  const counts = new Map<number, number>();
  for (const order of store.getOrders()) {
    const hour = new Date(order.createdAt).getHours();
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }

  return {
    data: [...counts.entries()]
      .map(([hour, orderCount]) => ({ hour, orderCount }))
      .sort((a, b) => b.orderCount - a.orderCount),
  };
}, {
  detail: { tags: ["reports"], summary: "Peak hour report" },
});

app.get(
  "/health",
  () => ({ status: "ok", auth: getAuthConfigStatus() }),
  {
    detail: {
      tags: ["system"],
      summary: "Health check",
    },
    response: {
      200: healthResponseSchema,
    },
  },
);

app.get(
  "*",
  async ({ request }) => {
    return servePublicFile(new URL(request.url).pathname);
  },
  { detail: { hide: true } },
);

app.onError(({ code, set }) => {
  if (code === "VALIDATION") {
    set.status = 400;
    return {
      error: "Validation failed",
      message: "Please check your request parameters",
    };
  }

  set.status = 500;
  return { error: "Internal server error" };
});

await store.init();

app.listen({ port, hostname: host }, () => {
  console.log(`Breakfast API: http://${host}:${port}`);
  console.log(`Web App: http://${host}:${port}`);
  console.log(`OpenAPI: http://${host}:${port}/openapi`);
  console.log(`Menu API: http://${host}:${port}/api/menu`);
  console.log(`Orders API: http://${host}:${port}/api/orders`);
  console.log(`KDS API: http://${host}:${port}/api/kds/orders`);
  console.log(`CORS Origin: ${allowedOrigin}`);
});
