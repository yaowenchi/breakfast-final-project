import { useEffect, useMemo, useState } from "react";
import "./App.css";
import type {
  ApiDataResponse,
  DiningTable,
  Ingredient,
  MenuItem,
  Order,
  OrderItemStatus,
  OrderStatus,
  OrderType,
  PackageType,
  PickupVerification,
  ProductIngredient,
  User,
  UserRole,
} from "../../shared/contracts.ts";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const USER_STORAGE_KEY = "breakfast.user";

type SafeUser = Omit<User, "password">;
type AppView = "customer" | "kds" | "admin";
const customerMenuTabs = ["餐點", "飲料"] as const;
type CustomerMenuTab = (typeof customerMenuTabs)[number];

interface CartDetail {
  itemId: number;
  qty: number;
  item: MenuItem;
  subtotal: number;
}

interface BatchSuggestion {
  ingredientId: number;
  ingredientName: string;
  unit: string;
  totalQuantity: number;
  orderIds: number[];
  productNames: string[];
}

interface KdsQueueItem {
  priority: number;
  orderId: number;
  status: OrderStatus;
  estimatedReadyAt?: string;
  itemCount: number;
}

interface RevenueReport {
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  byStatus: Partial<Record<OrderStatus, number>>;
}

interface PopularReportItem {
  itemId: number;
  name: string;
  qty: number;
  revenue: number;
}

interface TurnoverReport {
  totalSeats: number;
  availableTables: number;
  activeSeatedTables: number;
  completedDineInOrders: number;
  turnoverRate: number;
}

interface PeakHour {
  hour: number;
  orderCount: number;
}

interface HealthStatus {
  status: string;
  auth?: {
    betterAuthConfigured: boolean;
    googleConfigured: boolean;
  };
}

interface PickupQrPayload {
  orderId: number;
  pickupCode?: string;
}

interface OrderTracking {
  orderId: number;
  status: OrderStatus;
  itemStatuses: Array<{
    itemId: number;
    name: string;
    status: OrderItemStatus;
  }>;
  estimatedReadyAt?: string;
  pickupCode?: string;
}

interface OrderEstimate {
  queueMinutes: number;
  cookingMinutes: number;
  packagingMinutes: number;
  batchSavingMinutes: number;
  totalMinutes: number;
  estimatedReadyAt: string;
}

interface MenuFormState {
  name: string;
  price: string;
  category: string;
  description: string;
  image_url: string;
  default_time: string;
  is_available: boolean;
}

interface IngredientFormState {
  name: string;
  stock: string;
  unit: string;
  reorderLevel: string;
}

interface TableFormState {
  code: string;
  capacity: string;
  status: DiningTable["status"];
  currentOrderId: string;
}

interface RecipeRow {
  ingredientId: string;
  quantity: string;
}

const emptyMenuForm: MenuFormState = {
  name: "",
  price: "",
  category: "",
  description: "",
  image_url: "",
  default_time: "5",
  is_available: true,
};

const emptyIngredientForm: IngredientFormState = {
  name: "",
  stock: "",
  unit: "",
  reorderLevel: "",
};

const emptyTableForm: TableFormState = {
  code: "",
  capacity: "",
  status: "available",
  currentOrderId: "",
};

const orderStatusLabel: Record<OrderStatus, string> = {
  pending: "購物車",
  submitted: "已送單",
  preparing: "製作中",
  ready: "可取餐",
  completed: "已完成",
  cancelled: "已取消",
};

const orderItemStatusLabel: Record<OrderItemStatus, string> = {
  queued: "排隊中",
  preparing: "製作中",
  ready: "完成",
  served: "已出餐",
  cancelled: "已取消",
};

const tableStatusLabel: Record<DiningTable["status"], string> = {
  available: "可用",
  reserved: "已預訂",
  seated: "已入座",
  dining: "用餐中",
  cleaning: "待清潔",
};

const orderTypeLabel: Record<OrderType, string> = {
  takeout: "外帶",
  dine_in: "內用",
};

const packageTypeLabel: Record<PackageType, string> = {
  together: "集中包裝",
  separate: "分開包裝",
};

function buildApiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

async function fetchApiData<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(buildApiUrl(path), {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    let message = `${path} failed: HTTP ${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string; message?: string };
      message = payload.error || payload.message || message;
    } catch {
      // Keep the HTTP error when the response is not JSON.
    }
    throw new Error(message);
  }

  const payload = (await response.json()) as ApiDataResponse<T>;
  return payload.data;
}

function formatDateTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function orderStatusClass(status: OrderStatus) {
  if (status === "submitted") return "badge-warning";
  if (status === "preparing") return "badge-info";
  if (status === "ready") return "badge-success";
  if (status === "completed") return "badge-neutral";
  if (status === "cancelled") return "badge-error";
  return "badge-outline";
}

function createGuestUser(): SafeUser {
  const randomId =
    typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const id = `guest-${randomId}`;

  return {
    id,
    email: `${id}@guest.local`,
    name: "訪客",
    role: "customer",
  };
}

function isGuestUser(user: SafeUser | null) {
  return Boolean(
    user && (user.id.startsWith("guest-") || user.email.endsWith("@guest.local")),
  );
}

function canUseKds(user: SafeUser | null) {
  return user?.role === "staff" || user?.role === "manager";
}

function canUseAdmin(user: SafeUser | null) {
  return user?.role === "manager";
}

function defaultViewForRole(role: UserRole): AppView {
  if (role === "manager") return "admin";
  if (role === "staff") return "kds";
  return "customer";
}

function customerMenuTabForItem(item: MenuItem): CustomerMenuTab {
  return item.category.includes("飲") ? "飲料" : "餐點";
}

export default function App() {
  const [view, setView] = useState<AppView>("customer");
  const [user, setUser] = useState<SafeUser | null>(null);
  const [nameInput, setNameInput] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);

  const [items, setItems] = useState<MenuItem[]>([]);
  const [selectedCustomerMenuTab, setSelectedCustomerMenuTab] =
    useState<CustomerMenuTab>("餐點");
  const [selectedMenuDetail, setSelectedMenuDetail] = useState<MenuItem | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [operationId, setOperationId] = useState<string | null>(null);

  const [orderId, setOrderId] = useState<number | null>(null);
  const [cartQtyByItemId, setCartQtyByItemId] = useState<Record<number, number>>({});
  const [cartTotal, setCartTotal] = useState(0);
  const [orderType, setOrderType] = useState<OrderType>("takeout");
  const [packageType, setPackageType] = useState<PackageType>("together");
  const [selectedTableId, setSelectedTableId] = useState<number | null>(null);
  const [availableTables, setAvailableTables] = useState<DiningTable[]>([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isClearingCart, setIsClearingCart] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [customerOrderDetail, setCustomerOrderDetail] = useState<Order | null>(null);
  const [trackingResult, setTrackingResult] = useState<OrderTracking | null>(null);
  const [estimateResult, setEstimateResult] = useState<OrderEstimate | null>(null);
  const [pickupQr, setPickupQr] = useState<PickupQrPayload | null>(null);

  const [kdsOrders, setKdsOrders] = useState<Order[]>([]);
  const [kdsBatches, setKdsBatches] = useState<BatchSuggestion[]>([]);
  const [kdsQueue, setKdsQueue] = useState<KdsQueueItem[]>([]);
  const [kdsLoading, setKdsLoading] = useState(false);
  const [pickupCodeInput, setPickupCodeInput] = useState("");
  const [pickupVerification, setPickupVerification] =
    useState<PickupVerification | null>(null);

  const [adminLoading, setAdminLoading] = useState(false);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [revenueReport, setRevenueReport] = useState<RevenueReport | null>(null);
  const [popularItems, setPopularItems] = useState<PopularReportItem[]>([]);
  const [turnoverReport, setTurnoverReport] = useState<TurnoverReport | null>(null);
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [lowStockIngredients, setLowStockIngredients] = useState<Ingredient[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [adminOrderDetail, setAdminOrderDetail] = useState<Order | null>(null);

  const [menuForm, setMenuForm] = useState<MenuFormState>(emptyMenuForm);
  const [editingMenuId, setEditingMenuId] = useState<number | null>(null);
  const [isSavingMenu, setIsSavingMenu] = useState(false);

  const [ingredientForm, setIngredientForm] =
    useState<IngredientFormState>(emptyIngredientForm);
  const [editingIngredientId, setEditingIngredientId] = useState<number | null>(null);

  const [tableForm, setTableForm] = useState<TableFormState>(emptyTableForm);
  const [editingTableId, setEditingTableId] = useState<number | null>(null);

  const [recipeMenuItem, setRecipeMenuItem] = useState<MenuItem | null>(null);
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([]);
  const [productIngredients, setProductIngredients] = useState<ProductIngredient[]>(
    [],
  );

  const grouped = useMemo(() => {
    const groupedItems = items.reduce(
      (acc, item) => {
        const category = item.category || "未分類";
        acc[category] ??= [];
        acc[category].push(item);
        return acc;
      },
      {} as Record<string, MenuItem[]>,
    );

    return {
      groupedItems,
      categories: Object.keys(groupedItems).sort((a, b) =>
        a.localeCompare(b, "zh-Hant"),
      ),
    };
  }, [items]);

  const customerMenuItems = useMemo(
    () =>
      items.filter(
        (item) => customerMenuTabForItem(item) === selectedCustomerMenuTab,
      ),
    [items, selectedCustomerMenuTab],
  );

  const customerMenuCounts = useMemo(
    () =>
      customerMenuTabs.reduce(
        (counts, tab) => {
          counts[tab] = items.filter(
            (item) => customerMenuTabForItem(item) === tab,
          ).length;
          return counts;
        },
        { 餐點: 0, 飲料: 0 } as Record<CustomerMenuTab, number>,
      ),
    [items],
  );

  const cartItemCount = useMemo(
    () => Object.values(cartQtyByItemId).reduce((sum, qty) => sum + qty, 0),
    [cartQtyByItemId],
  );

  const cartDetails = useMemo(() => {
    const itemById = new Map(items.map((item) => [item.id, item]));

    return Object.entries(cartQtyByItemId)
      .map((entry): CartDetail | null => {
        const itemId = Number(entry[0]);
        const qty = entry[1];
        const item = itemById.get(itemId);
        if (!item || qty <= 0) return null;
        return {
          itemId,
          qty,
          item,
          subtotal: item.price * qty,
        };
      })
      .filter((entry): entry is CartDetail => entry !== null);
  }, [cartQtyByItemId, items]);

  const lastCompletedOrder = useMemo(() => {
    if (!user || isGuestUser(user) || orderHistory.length === 0) return null;
    return orderHistory[0];
  }, [orderHistory, user]);

  function pathWithUserId(path: string, targetUserId = user?.id) {
    if (!targetUserId) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}userId=${encodeURIComponent(targetUserId)}`;
  }

  function syncCartFromOrder(order: Order) {
    setCartQtyByItemId(
      order.items.reduce(
        (acc, orderItem) => {
          acc[orderItem.item.id] = orderItem.qty;
          return acc;
        },
        {} as Record<number, number>,
      ),
    );
    setCartTotal(order.total);
  }

  function resetCartState() {
    setOrderId(null);
    setCartQtyByItemId({});
    setCartTotal(0);
  }

  function buildOrderOptions() {
    return {
      orderType,
      packageType,
      tableId: orderType === "dine_in" ? selectedTableId : null,
    };
  }

  function validateOrderOptions() {
    if (orderType === "dine_in" && !selectedTableId) {
      setActionError("請先選擇內用桌位，再繼續點餐。");
      return false;
    }

    return true;
  }

  async function loadMenu() {
    const fetchedItems = await fetchApiData<MenuItem[]>("/api/menu");
    setItems(Array.isArray(fetchedItems) ? fetchedItems : []);
  }

  async function loadMenuDetail(menuId: number) {
    const item = await fetchApiData<MenuItem>(`/api/menu/${menuId}`);
    setSelectedMenuDetail(item);
  }

  async function loadAvailableTables() {
    setTablesLoading(true);

    try {
      const tableList = await fetchApiData<DiningTable[]>("/api/tables/available");
      const nextTables = Array.isArray(tableList) ? tableList : [];
      setAvailableTables(nextTables);
      setSelectedTableId((currentTableId) =>
        currentTableId && nextTables.some((table) => table.id === currentTableId)
          ? currentTableId
          : null,
      );
    } finally {
      setTablesLoading(false);
    }
  }

  async function loadCurrentOrder(targetUserId: string): Promise<Order | null> {
    const currentOrder = await fetchApiData<Order | null>(
      `/api/orders/current?userId=${encodeURIComponent(targetUserId)}`,
    );

    if (!currentOrder) {
      resetCartState();
      return null;
    }

    setOrderId(currentOrder.id);
    setOrderType(currentOrder.orderType ?? "takeout");
    setPackageType(currentOrder.packageType ?? "together");
    setSelectedTableId(currentOrder.tableId ?? null);
    syncCartFromOrder(currentOrder);
    return currentOrder;
  }

  async function loadOrderHistory(targetUserId: string) {
    setHistoryLoading(true);

    try {
      const history = await fetchApiData<Order[]>(
        `/api/orders/history?userId=${encodeURIComponent(targetUserId)}`,
      );
      setOrderHistory(Array.isArray(history) ? history : []);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function loadKdsData() {
    setKdsLoading(true);
    setActionError("");

    try {
      const [orders, batches, queue] = await Promise.all([
        fetchApiData<Order[]>("/api/kds/orders"),
        fetchApiData<BatchSuggestion[]>("/api/kds/batches"),
        fetchApiData<KdsQueueItem[]>("/api/kds/queue"),
      ]);
      setKdsOrders(Array.isArray(orders) ? orders : []);
      setKdsBatches(Array.isArray(batches) ? batches : []);
      setKdsQueue(Array.isArray(queue) ? queue : []);
    } catch (kdsError) {
      setActionError("廚房資料讀取失敗，請確認帳號權限或後端 API。");
      console.error(kdsError);
    } finally {
      setKdsLoading(false);
    }
  }

  async function loadAdminData() {
    setAdminLoading(true);
    setActionError("");

    try {
      const [
        healthStatus,
        revenue,
        popular,
        turnover,
        peaks,
        tableList,
        ingredientList,
        lowStock,
        orders,
      ] = await Promise.all([
        fetchApiData<HealthStatus>("/health"),
        fetchApiData<RevenueReport>("/api/reports/revenue"),
        fetchApiData<PopularReportItem[]>("/api/reports/popular-items"),
        fetchApiData<TurnoverReport>("/api/reports/turnover"),
        fetchApiData<PeakHour[]>("/api/reports/peak-hours"),
        fetchApiData<DiningTable[]>("/api/tables"),
        fetchApiData<Ingredient[]>("/api/ingredients"),
        fetchApiData<Ingredient[]>("/api/ingredients/low-stock"),
        fetchApiData<Order[]>("/api/orders"),
      ]);

      setHealth(healthStatus);
      setRevenueReport(revenue);
      setPopularItems(Array.isArray(popular) ? popular : []);
      setTurnoverReport(turnover);
      setPeakHours(Array.isArray(peaks) ? peaks : []);
      setTables(Array.isArray(tableList) ? tableList : []);
      setIngredients(Array.isArray(ingredientList) ? ingredientList : []);
      setLowStockIngredients(Array.isArray(lowStock) ? lowStock : []);
      setAllOrders(Array.isArray(orders) ? orders : []);
    } catch (adminError) {
      setActionError("後台資料讀取失敗，請確認 boss 帳號權限或後端 API。");
      console.error(adminError);
    } finally {
      setAdminLoading(false);
    }
  }

  useEffect(() => {
    let mounted = true;

    const savedUser = window.localStorage.getItem(USER_STORAGE_KEY);
    if (savedUser) {
      try {
        const parsedUser = JSON.parse(savedUser) as Partial<SafeUser>;
        if (
          parsedUser.id &&
          parsedUser.email &&
          parsedUser.name &&
          parsedUser.role
        ) {
          if (
            parsedUser.id.startsWith("guest-") ||
            parsedUser.email.endsWith("@guest.local")
          ) {
            window.localStorage.removeItem(USER_STORAGE_KEY);
          } else {
            setUser({
              id: parsedUser.id,
              email: parsedUser.email,
              name: parsedUser.name,
              role: parsedUser.role,
            });
          }
        }
      } catch {
        window.localStorage.removeItem(USER_STORAGE_KEY);
      }
    }

    async function loadInitialData() {
      try {
        await loadMenu();
      } catch (fetchError) {
        if (mounted) {
          setError("菜單讀取失敗，請確認後端是否啟動。");
          console.error(fetchError);
        }
      } finally {
        if (mounted) setLoading(false);
      }

      try {
        const sessionUser = await fetchApiData<SafeUser | null>("/api/auth/session");
        if (mounted && sessionUser) {
          setUser(sessionUser);
          window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(sessionUser));
          setView((currentView) => {
            if (currentView === "admin" && !canUseAdmin(sessionUser)) {
              return defaultViewForRole(sessionUser.role);
            }
            if (currentView === "kds" && !canUseKds(sessionUser)) {
              return defaultViewForRole(sessionUser.role);
            }
            return currentView;
          });
        }
      } catch (sessionError) {
        console.error(sessionError);
      }
    }

    void loadInitialData();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authError) return;

    const timeoutId = window.setTimeout(() => {
      setAuthError("");
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [authError]);

  useEffect(() => {
    if (orderType === "dine_in") {
      void loadAvailableTables().catch((tableError) => {
        setActionError("空桌資料讀取失敗，請稍後再試。");
        console.error(tableError);
      });
      return;
    }

    setSelectedTableId(null);
  }, [orderType]);

  useEffect(() => {
    if (!user || user.role !== "customer") {
      setOrderHistory([]);
      return;
    }

    void loadCurrentOrder(user.id).catch((refreshError) => {
      setActionError("購物車讀取失敗，請重新整理。");
      console.error(refreshError);
    });

    if (isGuestUser(user)) {
      setOrderHistory([]);
      return;
    }

    void loadOrderHistory(user.id).catch((historyError) => {
      setActionError("歷史訂單讀取失敗，請重新整理。");
      console.error(historyError);
    });
  }, [user]);

  useEffect(() => {
    if (view === "kds" && canUseKds(user)) {
      void loadKdsData();
    }
    if (view === "admin" && canUseAdmin(user)) {
      void loadAdminData();
    }
  }, [view, user]);

  async function ensureOrder(): Promise<number> {
    if (!user) throw new Error("Please start a customer session first");
    if (!validateOrderOptions()) throw new Error("Order options are incomplete");
    if (orderId !== null) return orderId;

    const options = buildOrderOptions();
    const createdOrder = await fetchApiData<Order>("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        orderType: options.orderType,
        packageType: options.packageType,
        tableId: options.tableId ?? undefined,
      }),
    });

    setOrderId(createdOrder.id);
    return createdOrder.id;
  }

  async function syncOrderOptions(targetOrderId: number) {
    if (!user) throw new Error("Please start a customer session first");
    if (!validateOrderOptions()) throw new Error("Order options are incomplete");

    const options = buildOrderOptions();
    await fetchApiData<Order>(`/api/orders/${targetOrderId}/options`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: user.id,
        orderType: options.orderType,
        packageType: options.packageType,
        tableId: options.tableId,
      }),
    });
  }

  async function handleLogin() {
    setAuthError("");
    setActionError("");
    setIsLoggingIn(true);

    try {
      const loggedInUser = await fetchApiData<SafeUser>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.trim(),
          password: passwordInput,
        }),
      });

      setUser(loggedInUser);
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(loggedInUser));
      setNameInput("");
      setEmailInput("");
      setPasswordInput("");

      if (view === "admin" && loggedInUser.role !== "manager") {
        setAuthError("這個帳號沒有後台權限。");
        setView(defaultViewForRole(loggedInUser.role));
        return;
      }

      if (view === "kds" && !canUseKds(loggedInUser)) {
        setAuthError("這個帳號沒有 KDS 權限。");
        setView(defaultViewForRole(loggedInUser.role));
        return;
      }

      setView((currentView) =>
        currentView === "customer"
          ? defaultViewForRole(loggedInUser.role)
          : currentView,
      );
    } catch (loginError) {
      setAuthError("登入失敗，請確認帳號密碼。");
      console.error(loginError);
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function handleRegister() {
    const name = nameInput.trim();
    const email = emailInput.trim();

    if (!name || !email || !passwordInput) {
      setAuthError("註冊需要姓名、Email 和密碼。");
      return;
    }

    setAuthError("");
    setActionError("");
    setIsRegistering(true);

    try {
      const registeredUser = await fetchApiData<SafeUser>("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password: passwordInput,
        }),
      });

      setUser(registeredUser);
      window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(registeredUser));
      setNameInput("");
      setEmailInput("");
      setPasswordInput("");
      setView("customer");
    } catch (registerError) {
      setAuthError("註冊失敗，Email 可能已被使用。");
      console.error(registerError);
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleGoogleSignIn() {
    setAuthError("");
    setActionError("");
    setIsGoogleSigningIn(true);

    try {
      const response = await fetch(buildApiUrl("/api/auth/sign-in/social"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          provider: "google",
          callbackURL: "/",
        }),
      });

      if (!response.ok) {
        throw new Error(`Google sign-in failed: HTTP ${response.status}`);
      }

      const payload = (await response.json()) as { url?: string };
      if (!payload.url) {
        throw new Error("Google sign-in failed: missing redirect url");
      }

      window.location.href = payload.url;
    } catch (googleError) {
      setAuthError("Google 登入啟動失敗，請確認後端 Google OAuth 設定。");
      console.error(googleError);
      setIsGoogleSigningIn(false);
    }
  }

  function handleGuestOrder() {
    const guestUser = createGuestUser();
    setUser(guestUser);
    setView("customer");
    setSubmittedOrder(null);
    setOrderHistory([]);
    resetCartState();
    setOrderType("takeout");
    setPackageType("together");
    setSelectedTableId(null);
    setAuthError("");
    setActionError("");
  }

  function handleLogout() {
    const currentUser = user;
    const currentOrderId = orderId;

    if (currentUser && isGuestUser(currentUser) && currentOrderId !== null) {
      void fetch(
        buildApiUrl(
          `/api/orders/${currentOrderId}/cancel?userId=${encodeURIComponent(
            currentUser.id,
          )}`,
        ),
        { method: "POST", credentials: "include" },
      ).catch((cancelError) => {
        console.error(cancelError);
      });
    }

    void fetch(buildApiUrl("/api/auth/sign-out"), {
      method: "POST",
      credentials: "include",
    }).catch((logoutError) => {
      console.error(logoutError);
    });
    window.localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
    setAuthError("");
    setActionError("");
    setSubmittedOrder(null);
    setOrderHistory([]);
    setCustomerOrderDetail(null);
    setTrackingResult(null);
    setEstimateResult(null);
    setPickupQr(null);
    resetCartState();
    setOrderType("takeout");
    setPackageType("together");
    setSelectedTableId(null);
    setView("customer");
  }

  async function addToCart(item: MenuItem) {
    setActionError("");
    setActiveItemId(item.id);

    try {
      if (!user) {
        setActionError("請先登入或使用訪客點餐。");
        return;
      }

      if (!validateOrderOptions()) {
        return;
      }

      const targetOrderId = await ensureOrder();
      const updatedOrder = await fetchApiData<Order>(
        `/api/orders/${targetOrderId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            itemId: item.id,
            qty: (cartQtyByItemId[item.id] ?? 0) + 1,
          }),
        },
      );

      syncCartFromOrder(updatedOrder);
      setSubmittedOrder(null);
    } catch (cartError) {
      setActionError("加入購物車失敗，請稍後再試。");
      console.error(cartError);
    } finally {
      setActiveItemId(null);
    }
  }

  async function clearCart() {
    if (!user || orderId === null || cartDetails.length === 0) return;
    setActionError("");
    setIsClearingCart(true);

    try {
      for (const detail of cartDetails) {
        await fetchApiData<Order>(`/api/orders/${orderId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            itemId: detail.itemId,
            qty: 0,
          }),
        });
      }
      resetCartState();
    } catch (clearError) {
      setActionError("清空購物車失敗，請稍後再試。");
      console.error(clearError);
    } finally {
      setIsClearingCart(false);
    }
  }

  async function submitOrder() {
    if (!user || orderId === null || cartDetails.length === 0) return;
    if (!validateOrderOptions()) return;
    setActionError("");
    setIsSubmittingOrder(true);

    try {
      await syncOrderOptions(orderId);
      const options = buildOrderOptions();
      const order = await fetchApiData<Order>(`/api/orders/${orderId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          orderType: options.orderType,
          packageType: options.packageType,
          tableId: options.tableId ?? undefined,
        }),
      });

      setSubmittedOrder(order);
      setTrackingResult(null);
      setEstimateResult(null);
      setPickupQr(null);
      if (!isGuestUser(user)) {
        await loadOrderHistory(user.id);
      }
      resetCartState();
      setSelectedTableId(null);
      if (orderType === "dine_in") {
        void loadAvailableTables().catch((tableError) => {
          console.error(tableError);
        });
      }
      setIsCartOpen(false);
    } catch (submitError) {
      setActionError("送出訂單失敗，請稍後再試。");
      console.error(submitError);
    } finally {
      setIsSubmittingOrder(false);
    }
  }

  async function reorderFromHistory(sourceOrderId: number) {
    if (!user) return;
    const opId = `reorder-${sourceOrderId}`;
    setOperationId(opId);
    setActionError("");

    try {
      const order = await fetchApiData<Order>(
        `/api/orders/${sourceOrderId}/reorder?userId=${encodeURIComponent(
          user.id,
        )}`,
        { method: "POST" },
      );
      setOrderId(order.id);
      setOrderType(order.orderType ?? "takeout");
      setPackageType(order.packageType ?? "together");
      setSelectedTableId(order.tableId ?? null);
      syncCartFromOrder(order);
      setSubmittedOrder(null);
      setIsCartOpen(true);
    } catch (reorderError) {
      setActionError("再點一次失敗，請確認品項是否仍可販售。");
      console.error(reorderError);
    } finally {
      setOperationId(null);
    }
  }

  async function loadCustomerOrderDetail(targetOrderId: number) {
    if (!user) return;
    setActionError("");
    try {
      const order = await fetchApiData<Order>(
        pathWithUserId(`/api/orders/${targetOrderId}`),
      );
      setCustomerOrderDetail(order);
    } catch (detailError) {
      setActionError("訂單詳情讀取失敗。");
      console.error(detailError);
    }
  }

  async function loadTracking(targetOrderId: number) {
    if (!user) return;
    setActionError("");
    try {
      const tracking = await fetchApiData<OrderTracking>(
        pathWithUserId(`/api/orders/${targetOrderId}/tracking`),
      );
      setTrackingResult(tracking);
    } catch (trackingError) {
      setActionError("訂單追蹤讀取失敗。");
      console.error(trackingError);
    }
  }

  async function loadEstimate(targetOrderId: number) {
    if (!user) return;
    setActionError("");
    try {
      const estimate = await fetchApiData<OrderEstimate>(
        pathWithUserId(`/api/orders/${targetOrderId}/estimate`),
      );
      setEstimateResult(estimate);
    } catch (estimateError) {
      setActionError("預估時間讀取失敗。");
      console.error(estimateError);
    }
  }

  async function loadPickupQr(targetOrderId: number) {
    setActionError("");
    try {
      const qr = await fetchApiData<PickupQrPayload>(
        `/api/pickup/${targetOrderId}/qrcode`,
      );
      setPickupQr(qr);
    } catch (qrError) {
      setActionError("取餐碼讀取失敗。");
      console.error(qrError);
    }
  }

  async function updateKdsStatus(targetOrderId: number, status: OrderStatus) {
    const opId = `order-${targetOrderId}-${status}`;
    setOperationId(opId);
    setActionError("");

    try {
      await fetchApiData<Order>(`/api/kds/orders/${targetOrderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      await loadKdsData();
    } catch (kdsError) {
      setActionError("更新廚房訂單失敗，請稍後再試。");
      console.error(kdsError);
    } finally {
      setOperationId(null);
    }
  }

  async function updateKdsItemStatus(
    targetOrderId: number,
    itemId: number,
    status: OrderItemStatus,
  ) {
    const opId = `item-${targetOrderId}-${itemId}-${status}`;
    setOperationId(opId);
    setActionError("");

    try {
      await fetchApiData<Order>(`/api/kds/orders/${targetOrderId}/items/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status }),
      });
      await loadKdsData();
    } catch (kdsError) {
      setActionError("更新品項狀態失敗，請稍後再試。");
      console.error(kdsError);
    } finally {
      setOperationId(null);
    }
  }

  async function updateKitchenAvailability(item: MenuItem, isAvailable: boolean) {
    const opId = `kds-menu-${item.id}`;
    setOperationId(opId);
    setActionError("");

    try {
      await fetchApiData<MenuItem>(`/api/menu/${item.id}/availability`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_available: isAvailable }),
      });
      await loadMenu();
    } catch (menuError) {
      setActionError("更新售完品項失敗，請確認廚房或 boss 權限。");
      console.error(menuError);
    } finally {
      setOperationId(null);
    }
  }

  async function verifyPickup() {
    const pickupCode = pickupCodeInput.trim();
    if (!pickupCode) {
      setActionError("請輸入取餐碼。");
      return;
    }

    setOperationId("pickup-verify");
    setActionError("");

    try {
      const verified = await fetchApiData<PickupVerification>("/api/pickup/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pickupCode }),
      });
      setPickupVerification(verified);
      setPickupCodeInput("");
      await loadKdsData();
    } catch (pickupError) {
      setActionError("取餐驗證失敗，請確認取餐碼。");
      console.error(pickupError);
    } finally {
      setOperationId(null);
    }
  }

  async function updateTableStatus(
    tableId: number,
    action: "seat" | "leave" | "clean",
  ) {
    const opId = `table-${tableId}-${action}`;
    setOperationId(opId);
    setActionError("");

    try {
      const updatedTable = await fetchApiData<DiningTable>(
        `/api/tables/${tableId}/${action}`,
        { method: "POST" },
      );
      setTables((currentTables) =>
        currentTables.map((table) =>
          table.id === updatedTable.id ? updatedTable : table,
        ),
      );
      if (orderType === "dine_in") await loadAvailableTables();
    } catch (tableError) {
      setActionError("更新桌位狀態失敗，請稍後再試。");
      console.error(tableError);
    } finally {
      setOperationId(null);
    }
  }

  function editMenuItem(item: MenuItem) {
    setEditingMenuId(item.id);
    setMenuForm({
      name: item.name,
      price: String(item.price),
      category: item.category,
      description: item.description,
      image_url: item.image_url,
      default_time: String(item.default_time ?? 5),
      is_available: item.is_available,
    });
  }

  function resetMenuForm() {
    setEditingMenuId(null);
    setMenuForm(emptyMenuForm);
  }

  async function saveMenuItem() {
    setActionError("");
    setIsSavingMenu(true);

    try {
      const payload = {
        name: menuForm.name.trim(),
        price: Number(menuForm.price),
        category: menuForm.category.trim(),
        description: menuForm.description.trim(),
        image_url: menuForm.image_url.trim(),
        default_time: Number(menuForm.default_time || 5),
        is_available: menuForm.is_available,
      };

      if (!payload.name || !payload.category || !payload.image_url) {
        throw new Error("Missing menu form fields");
      }

      if (!Number.isFinite(payload.price) || payload.price < 0) {
        throw new Error("Invalid menu price");
      }

      if (editingMenuId) {
        await fetchApiData<MenuItem>(`/api/menu/${editingMenuId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchApiData<MenuItem>("/api/menu", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      resetMenuForm();
        await loadMenu();
      if (canUseAdmin(user)) await loadAdminData();
    } catch (menuError) {
      setActionError("菜單儲存失敗，請確認欄位與 boss 權限。");
      console.error(menuError);
    } finally {
      setIsSavingMenu(false);
    }
  }

  async function deleteMenuItem(item: MenuItem) {
    if (!window.confirm(`刪除 ${item.name}？`)) return;
    setActionError("");
    setOperationId(`delete-menu-${item.id}`);

    try {
      await fetchApiData<MenuItem>(`/api/menu/${item.id}`, { method: "DELETE" });
      await loadMenu();
      if (editingMenuId === item.id) resetMenuForm();
      if (recipeMenuItem?.id === item.id) {
        setRecipeMenuItem(null);
        setRecipeRows([]);
        setProductIngredients([]);
      }
    } catch (menuError) {
      setActionError("刪除菜單失敗，請確認 boss 權限。");
      console.error(menuError);
    } finally {
      setOperationId(null);
    }
  }

  async function toggleMenuAvailability(item: MenuItem) {
    setOperationId(`toggle-menu-${item.id}`);
    setActionError("");

    try {
      await fetchApiData<MenuItem>(`/api/menu/${item.id}/availability`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_available: !item.is_available }),
      });
      await loadMenu();
    } catch (menuError) {
      setActionError("更新可售狀態失敗，請確認 boss 權限。");
      console.error(menuError);
    } finally {
      setOperationId(null);
    }
  }

  function editIngredient(ingredient: Ingredient) {
    setEditingIngredientId(ingredient.id);
    setIngredientForm({
      name: ingredient.name,
      stock: String(ingredient.stock),
      unit: ingredient.unit,
      reorderLevel: String(ingredient.reorderLevel ?? 0),
    });
  }

  function resetIngredientForm() {
    setEditingIngredientId(null);
    setIngredientForm(emptyIngredientForm);
  }

  async function saveIngredient() {
    const payload = {
      name: ingredientForm.name.trim(),
      stock: Number(ingredientForm.stock),
      unit: ingredientForm.unit.trim(),
      reorderLevel: Number(ingredientForm.reorderLevel || 0),
    };

    if (!payload.name || !payload.unit || !Number.isFinite(payload.stock)) {
      setActionError("請填寫完整食材資料。");
      return;
    }

    setOperationId("save-ingredient");
    setActionError("");

    try {
      if (editingIngredientId) {
        await fetchApiData<Ingredient>(`/api/ingredients/${editingIngredientId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        await fetchApiData<Ingredient>("/api/ingredients", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      resetIngredientForm();
      await loadAdminData();
    } catch (ingredientError) {
      setActionError("食材儲存失敗。");
      console.error(ingredientError);
    } finally {
      setOperationId(null);
    }
  }

  async function deleteIngredient(ingredient: Ingredient) {
    if (!window.confirm(`刪除食材 ${ingredient.name}？`)) return;
    setOperationId(`delete-ingredient-${ingredient.id}`);
    setActionError("");

    try {
      await fetchApiData<Ingredient>(`/api/ingredients/${ingredient.id}`, {
        method: "DELETE",
      });
      if (editingIngredientId === ingredient.id) resetIngredientForm();
      await loadAdminData();
    } catch (ingredientError) {
      setActionError("食材刪除失敗。");
      console.error(ingredientError);
    } finally {
      setOperationId(null);
    }
  }

  function editTable(table: DiningTable) {
    setEditingTableId(table.id);
    setTableForm({
      code: table.code,
      capacity: String(table.capacity),
      status: table.status,
      currentOrderId: table.currentOrderId ? String(table.currentOrderId) : "",
    });
  }

  function resetTableForm() {
    setEditingTableId(null);
    setTableForm(emptyTableForm);
  }

  async function saveTable() {
    const capacity = Number(tableForm.capacity);
    if (!tableForm.code.trim() || !Number.isFinite(capacity) || capacity <= 0) {
      setActionError("請填寫桌號與正確人數。");
      return;
    }

    setOperationId("save-table");
    setActionError("");

    try {
      if (editingTableId) {
        await fetchApiData<DiningTable>(`/api/tables/${editingTableId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: tableForm.code.trim(),
            capacity,
            status: tableForm.status,
            currentOrderId: tableForm.currentOrderId
              ? Number(tableForm.currentOrderId)
              : null,
          }),
        });
      } else {
        await fetchApiData<DiningTable>("/api/tables", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: tableForm.code.trim(),
            capacity,
          }),
        });
      }

      resetTableForm();
      await loadAdminData();
      if (orderType === "dine_in") await loadAvailableTables();
    } catch (tableError) {
      setActionError("桌位儲存失敗。");
      console.error(tableError);
    } finally {
      setOperationId(null);
    }
  }

  async function deleteTable(table: DiningTable) {
    if (!window.confirm(`刪除桌位 ${table.code}？`)) return;
    setOperationId(`delete-table-${table.id}`);
    setActionError("");

    try {
      await fetchApiData<DiningTable>(`/api/tables/${table.id}`, {
        method: "DELETE",
      });
      if (editingTableId === table.id) resetTableForm();
      await loadAdminData();
      if (orderType === "dine_in") await loadAvailableTables();
    } catch (tableError) {
      setActionError("桌位刪除失敗。");
      console.error(tableError);
    } finally {
      setOperationId(null);
    }
  }

  async function loadAdminOrderDetail(targetOrderId: number) {
    setActionError("");
    try {
      const order = await fetchApiData<Order>(`/api/orders/${targetOrderId}`);
      setAdminOrderDetail(order);
    } catch (orderError) {
      setActionError("訂單詳情讀取失敗。");
      console.error(orderError);
    }
  }

  async function openRecipeEditor(item: MenuItem) {
    setRecipeMenuItem(item);
    setActionError("");

    try {
      const relations = await fetchApiData<ProductIngredient[]>(
        `/api/menu/${item.id}/ingredients`,
      );
      setProductIngredients(Array.isArray(relations) ? relations : []);
      setRecipeRows(
        relations.length > 0
          ? relations.map((relation) => ({
              ingredientId: String(relation.ingredientId),
              quantity: String(relation.quantity),
            }))
          : [{ ingredientId: "", quantity: "1" }],
      );
    } catch (recipeError) {
      setActionError("品項食材設定讀取失敗。");
      console.error(recipeError);
    }
  }

  async function saveRecipe() {
    if (!recipeMenuItem) return;

    const ingredientsPayload = recipeRows
      .map((row) => ({
        ingredientId: Number(row.ingredientId),
        quantity: Number(row.quantity),
      }))
      .filter(
        (row) =>
          Number.isInteger(row.ingredientId) &&
          row.ingredientId > 0 &&
          Number.isFinite(row.quantity) &&
          row.quantity > 0,
      );

    setOperationId("save-recipe");
    setActionError("");

    try {
      const updated = await fetchApiData<ProductIngredient[]>(
        `/api/menu/${recipeMenuItem.id}/ingredients`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredients: ingredientsPayload }),
        },
      );
      setProductIngredients(Array.isArray(updated) ? updated : []);
      setRecipeRows(
        updated.length > 0
          ? updated.map((relation) => ({
              ingredientId: String(relation.ingredientId),
              quantity: String(relation.quantity),
            }))
          : [{ ingredientId: "", quantity: "1" }],
      );
    } catch (recipeError) {
      setActionError("品項食材設定儲存失敗。");
      console.error(recipeError);
    } finally {
      setOperationId(null);
    }
  }

  function renderLoginPanel(targetView: AppView) {
    const title = targetView === "admin" ? "老闆登入" : "廚房登入";
    const hint =
      targetView === "admin"
        ? "需要 manager 權限。"
        : "需要 staff 或 manager 權限。";

    return (
      <section className="max-w-md mx-auto card bg-base-100 shadow-md">
        <div className="card-body">
          <h2 className="card-title">{title}</h2>
          <p className="text-sm opacity-70">{hint}</p>
          <label className="form-control w-full">
            <span className="label-text mb-1">Email</span>
            <input
              className="input input-bordered"
              autoComplete="username"
              value={emailInput}
              onChange={(event) => setEmailInput(event.target.value)}
            />
          </label>
          <label className="form-control w-full">
            <span className="label-text mb-1">密碼</span>
            <input
              type="password"
              className="input input-bordered"
              autoComplete="current-password"
              value={passwordInput}
              onChange={(event) => setPasswordInput(event.target.value)}
            />
          </label>
          {authError ? (
            <div className="alert alert-error">
              <span>{authError}</span>
            </div>
          ) : null}
          <button
            className="btn btn-primary"
            onClick={() => void handleLogin()}
            disabled={isLoggingIn || isRegistering || isGoogleSigningIn}
          >
            {isLoggingIn ? "登入中..." : "登入"}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => void handleGoogleSignIn()}
            disabled={isLoggingIn || isRegistering || isGoogleSigningIn}
          >
            {isGoogleSigningIn ? "Google..." : "Google 登入"}
          </button>
        </div>
      </section>
    );
  }

  function renderOrderActions(targetOrderId: number) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          className="btn btn-xs btn-outline"
          onClick={() => void loadCustomerOrderDetail(targetOrderId)}
        >
          詳情
        </button>
        <button
          className="btn btn-xs btn-outline"
          onClick={() => void loadTracking(targetOrderId)}
        >
          追蹤
        </button>
        <button
          className="btn btn-xs btn-outline"
          onClick={() => void loadEstimate(targetOrderId)}
        >
          預估
        </button>
        <button
          className="btn btn-xs btn-outline"
          onClick={() => void loadPickupQr(targetOrderId)}
        >
          取餐碼
        </button>
      </div>
    );
  }

  function renderSubmittedOrder() {
    if (!submittedOrder) return null;

    return (
      <section className="mb-6 card bg-base-100 shadow-md border border-success">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="card-title">訂單已送出</h2>
              <p className="text-sm opacity-70">訂單 #{submittedOrder.id}</p>
            </div>
            <span className={`badge ${orderStatusClass(submittedOrder.status)}`}>
              {orderStatusLabel[submittedOrder.status]}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="stat bg-base-200 rounded-lg">
              <div className="stat-title">總金額</div>
              <div className="stat-value text-primary">${submittedOrder.total}</div>
            </div>
            <div className="stat bg-base-200 rounded-lg">
              <div className="stat-title">預估完成</div>
              <div className="stat-value text-lg">
                {formatDateTime(submittedOrder.estimatedReadyAt)}
              </div>
            </div>
            <div className="stat bg-base-200 rounded-lg">
              <div className="stat-title">取餐碼</div>
              <div className="stat-value text-lg">
                {submittedOrder.pickupCode ?? "-"}
              </div>
            </div>
          </div>
          {renderOrderActions(submittedOrder.id)}
        </div>
      </section>
    );
  }

  function renderCustomerOrderTools() {
    if (!customerOrderDetail && !trackingResult && !estimateResult && !pickupQr) {
      return null;
    }

    return (
      <section className="mb-6 card bg-base-100 shadow-md">
        <div className="card-body">
          <div className="flex items-center justify-between gap-3">
            <h2 className="card-title">訂單查詢結果</h2>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setCustomerOrderDetail(null);
                setTrackingResult(null);
                setEstimateResult(null);
                setPickupQr(null);
              }}
            >
              清除
            </button>
          </div>

          {customerOrderDetail ? (
            <div className="rounded-lg bg-base-200 p-3">
              <p className="font-semibold">訂單 #{customerOrderDetail.id}</p>
              <p className="text-sm opacity-70">
                {orderTypeLabel[customerOrderDetail.orderType]} /{" "}
                {packageTypeLabel[customerOrderDetail.packageType]} / $
                {customerOrderDetail.total}
              </p>
              <ul className="mt-2 text-sm space-y-1">
                {customerOrderDetail.items.map((detail) => (
                  <li
                    key={`${customerOrderDetail.id}-${detail.item.id}`}
                    className="flex justify-between gap-3"
                  >
                    <span>{detail.item.name} x {detail.qty}</span>
                    <span>{orderItemStatusLabel[detail.status]}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trackingResult ? (
            <div className="rounded-lg bg-base-200 p-3">
              <p className="font-semibold">追蹤訂單 #{trackingResult.orderId}</p>
              <p className="text-sm opacity-70">
                {orderStatusLabel[trackingResult.status]} / 預估{" "}
                {formatDateTime(trackingResult.estimatedReadyAt)}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {trackingResult.itemStatuses.map((item) => (
                  <span key={item.itemId} className="badge badge-outline">
                    {item.name}: {orderItemStatusLabel[item.status]}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {estimateResult ? (
            <div className="rounded-lg bg-base-200 p-3">
              <p className="font-semibold">預估完成時間</p>
              <p className="text-sm opacity-70">
                約 {estimateResult.totalMinutes} 分鐘，完成時間{" "}
                {formatDateTime(estimateResult.estimatedReadyAt)}
              </p>
              <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                <span>排隊 {estimateResult.queueMinutes} 分</span>
                <span>製作 {estimateResult.cookingMinutes} 分</span>
                <span>包裝 {estimateResult.packagingMinutes} 分</span>
                <span>批次節省 {estimateResult.batchSavingMinutes} 分</span>
              </div>
            </div>
          ) : null}

          {pickupQr ? (
            <div className="rounded-lg bg-base-200 p-3">
              <p className="font-semibold">取餐碼</p>
              <p className="mt-1 text-2xl font-bold tracking-wide">
                {pickupQr.pickupCode ?? "-"}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderOrderHistory() {
    if (!user || user.role !== "customer") return null;

    if (isGuestUser(user)) {
      return (
        <section className="mb-6 card bg-base-100 shadow-md">
          <div className="card-body">
            <h2 className="card-title">歷史訂單</h2>
            <p className="text-sm opacity-70">
              目前是匿名點餐。使用會員或 Google 登入後，下次回來可查看之前訂過的菜單。
            </p>
          </div>
        </section>
      );
    }

    return (
      <section className="mb-6 card bg-base-100 shadow-md">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="card-title">歷史訂單</h2>
              <p className="text-sm opacity-70">{user.name} 的訂餐紀錄。</p>
            </div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => void loadOrderHistory(user.id)}
              disabled={historyLoading}
            >
              {historyLoading ? "更新中..." : "重新整理"}
            </button>
          </div>

          {historyLoading ? (
            <div className="alert">
              <span>讀取歷史訂單...</span>
            </div>
          ) : orderHistory.length === 0 ? (
            <div className="alert alert-info">
              <span>目前沒有歷史訂單。</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {orderHistory.slice(0, 8).map((order) => (
                <article
                  key={order.id}
                  className="rounded-lg border border-base-300 p-3 bg-base-200"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">訂單 #{order.id}</p>
                      <p className="text-xs opacity-70">
                        {formatDateTime(order.createdAt)}
                      </p>
                    </div>
                    <span className={`badge ${orderStatusClass(order.status)}`}>
                      {orderStatusLabel[order.status]}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-1 text-sm">
                    {order.items.map((detail) => (
                      <li
                        key={`${order.id}-${detail.item.id}`}
                        className="flex justify-between gap-3"
                      >
                        <span>{detail.item.name} x {detail.qty}</span>
                        <span>${detail.item.price * detail.qty}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 space-y-2">
                    <div className="text-sm">
                      <span className="font-semibold">總計 ${order.total}</span>
                      <span className="ml-3 opacity-70">
                        預估 {formatDateTime(order.estimatedReadyAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {renderOrderActions(order.id)}
                      <button
                        className="btn btn-xs btn-primary"
                        onClick={() => void reorderFromHistory(order.id)}
                        disabled={operationId === `reorder-${order.id}`}
                      >
                        {operationId === `reorder-${order.id}`
                          ? "加入中..."
                          : "再點一次"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderOrderOptionsPanel() {
    if (!user) return null;

    const selectedTable = availableTables.find(
      (table) => table.id === selectedTableId,
    );

    return (
      <section className="mb-6 card bg-base-100 shadow-md">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="card-title">點餐設定</h2>
              <p className="text-sm opacity-70">
                先確認外帶或內用，再開始加入餐點。
              </p>
            </div>
            <span className="badge badge-outline">
              {orderTypeLabel[orderType]}
              {orderType === "dine_in" && selectedTable
                ? ` / ${selectedTable.code}`
                : ""}
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-sm font-semibold">用餐方式</p>
              <div className="join w-full">
                <button
                  className={`btn join-item flex-1 ${
                    orderType === "takeout" ? "btn-primary" : "btn-outline"
                  }`}
                  onClick={() => setOrderType("takeout")}
                >
                  外帶
                </button>
                <button
                  className={`btn join-item flex-1 ${
                    orderType === "dine_in" ? "btn-primary" : "btn-outline"
                  }`}
                  onClick={() => setOrderType("dine_in")}
                >
                  內用
                </button>
              </div>
            </div>

            {orderType === "takeout" ? (
              <div className="space-y-2 lg:col-span-2">
                <p className="text-sm font-semibold">包裝方式</p>
                <div className="join w-full">
                  <button
                    className={`btn join-item flex-1 ${
                      packageType === "together" ? "btn-primary" : "btn-outline"
                    }`}
                    onClick={() => setPackageType("together")}
                  >
                    集中包裝
                  </button>
                  <button
                    className={`btn join-item flex-1 ${
                      packageType === "separate" ? "btn-primary" : "btn-outline"
                    }`}
                    onClick={() => setPackageType("separate")}
                  >
                    分開包裝
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 lg:col-span-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">可用桌位</p>
                  <button
                    className="btn btn-xs btn-outline"
                    onClick={() => void loadAvailableTables()}
                    disabled={tablesLoading}
                  >
                    {tablesLoading ? "更新中" : "重新整理"}
                  </button>
                </div>
                <select
                  className="select select-bordered w-full"
                  value={selectedTableId ?? ""}
                  onChange={(event) =>
                    setSelectedTableId(
                      event.target.value ? Number(event.target.value) : null,
                    )
                  }
                >
                  <option value="">請選擇桌位</option>
                  {availableTables.map((table) => (
                    <option key={table.id} value={table.id}>
                      {table.code} / {table.capacity} 人桌
                    </option>
                  ))}
                </select>
                {availableTables.length === 0 && !tablesLoading ? (
                  <p className="text-sm text-warning">目前沒有可用桌位。</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  function renderCustomerView() {
    return (
      <>
        {!user ? (
          <section className="mb-6 card bg-base-100 shadow-md">
            <div className="card-body flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h2 className="card-title">開始點餐</h2>
                <p className="text-sm opacity-70">
                  可註冊會員、登入、使用 Google，或直接用訪客點餐。
                </p>
              </div>
              <div className="w-full md:w-80 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 gap-2">
                  <input
                    className="input input-bordered input-sm"
                    placeholder="姓名（註冊用）"
                    autoComplete="name"
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                  />
                  <input
                    className="input input-bordered input-sm"
                    placeholder="Email"
                    autoComplete="username"
                    value={emailInput}
                    onChange={(event) => setEmailInput(event.target.value)}
                  />
                  <input
                    type="password"
                    className="input input-bordered input-sm"
                    placeholder="密碼"
                    autoComplete="current-password"
                    value={passwordInput}
                    onChange={(event) => setPasswordInput(event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => void handleLogin()}
                    disabled={isLoggingIn || isRegistering || isGoogleSigningIn}
                  >
                    {isLoggingIn ? "登入中" : "登入"}
                  </button>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => void handleRegister()}
                    disabled={isLoggingIn || isRegistering || isGoogleSigningIn}
                  >
                    {isRegistering ? "註冊中" : "註冊"}
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => void handleGoogleSignIn()}
                    disabled={isLoggingIn || isRegistering || isGoogleSigningIn}
                  >
                    {isGoogleSigningIn ? "Google..." : "Google"}
                  </button>
                </div>
                {authError ? (
                  <div className="alert alert-error py-2 text-sm">
                    <span>{authError}</span>
                  </div>
                ) : null}
              </div>
              <button className="btn btn-primary" onClick={handleGuestOrder}>
                訪客點餐
              </button>
            </div>
          </section>
        ) : null}

        {renderOrderOptionsPanel()}
        {renderSubmittedOrder()}
        {renderCustomerOrderTools()}
        {renderOrderHistory()}
        {renderMenuDiscovery()}
        {renderMenuGrid()}
      </>
    );
  }

  function renderMenuDiscovery() {
    return (
      <section className="mb-6 card bg-base-100 shadow-md">
        <div className="card-body">
          {lastCompletedOrder ? (
            <div className="mb-4 rounded-lg border border-base-300 bg-base-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-bold">上次點過</h3>
                  <p className="text-sm opacity-70">
                    訂單 #{lastCompletedOrder.id} /{" "}
                    {formatDateTime(lastCompletedOrder.createdAt)} / $
                    {lastCompletedOrder.total}
                  </p>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void reorderFromHistory(lastCompletedOrder.id)}
                  disabled={operationId === `reorder-${lastCompletedOrder.id}`}
                >
                  {operationId === `reorder-${lastCompletedOrder.id}`
                    ? "加入中"
                    : "再點一次"}
                </button>
              </div>
              <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                {lastCompletedOrder.items.map((detail) => (
                  <li
                    key={`${lastCompletedOrder.id}-${detail.item.id}`}
                    className="flex justify-between gap-3 rounded bg-base-100 px-3 py-2"
                  >
                    <span>{detail.item.name}</span>
                    <span>
                      x {detail.qty} / ${detail.item.price * detail.qty}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="card-title">菜單</h2>
            <div className="join">
              {customerMenuTabs.map((tab) => (
                <button
                  key={tab}
                  className={`btn join-item ${
                    selectedCustomerMenuTab === tab ? "btn-primary" : "btn-outline"
                  }`}
                  onClick={() => setSelectedCustomerMenuTab(tab)}
                >
                  {tab} {customerMenuCounts[tab]}
                </button>
              ))}
            </div>
          </div>

          {selectedMenuDetail ? (
            <div className="mt-4 rounded-lg border border-base-300 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-bold">{selectedMenuDetail.name}</h3>
                  <p className="text-sm opacity-70">
                    {selectedMenuDetail.category} / 約{" "}
                    {selectedMenuDetail.default_time} 分鐘 / $
                    {selectedMenuDetail.price}
                  </p>
                </div>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setSelectedMenuDetail(null)}
                >
                  關閉
                </button>
              </div>
              <p className="mt-2 text-sm">{selectedMenuDetail.description}</p>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderMenuGrid() {
    if (items.length === 0) {
      return (
        <div className="alert alert-info">
          <span>目前沒有菜單品項。</span>
        </div>
      );
    }

    if (customerMenuItems.length === 0) {
      return (
        <div className="alert alert-info">
          <span>目前沒有{selectedCustomerMenuTab}品項。</span>
        </div>
      );
    }

    return (
      <section className="mb-8">
        <h2 className="text-3xl font-bold mb-4 text-primary border-b-2 border-primary pb-2">
          {selectedCustomerMenuTab}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customerMenuItems.map((item) => (
            <article
              key={item.id}
              className="card bg-base-100 shadow-md hover:shadow-lg transition-shadow"
            >
              <figure className="h-44 overflow-hidden bg-base-300">
                <img
                  src={item.image_url}
                  alt={item.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  onError={(event) => {
                    event.currentTarget.src =
                      "https://images.unsplash.com/photo-1526318896980-cf78c088247c?auto=format&fit=crop&w=800&q=80";
                  }}
                />
              </figure>
              <div className="card-body">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="card-title text-lg">{item.name}</h3>
                  {!item.is_available ? (
                    <span className="badge badge-neutral">售完</span>
                  ) : null}
                </div>
                <p className="text-sm opacity-80 line-clamp-2 min-h-[2.75rem]">
                  {item.description}
                </p>
                <div className="card-actions justify-between items-center">
                  <span className="text-xl font-bold text-success">
                    ${item.price}
                  </span>
                  <div className="flex gap-2">
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => void loadMenuDetail(item.id)}
                    >
                      詳情
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => void addToCart(item)}
                      disabled={
                        !user || !item.is_available || activeItemId === item.id
                      }
                    >
                      {activeItemId === item.id
                        ? "加入中..."
                        : `加入${
                            cartQtyByItemId[item.id]
                              ? ` (${cartQtyByItemId[item.id]})`
                              : ""
                          }`}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  function renderKdsAvailabilityControls() {
    return (
      <section className="card bg-base-100 shadow-md border border-base-300">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="card-title">售完控制</h3>
              <p className="text-sm opacity-70">
                廚房可即時標記售完，顧客菜單會立刻停用該品項。
              </p>
            </div>
            <span className="badge badge-neutral">
              {items.filter((item) => !item.is_available).length} 個售完
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {items.map((item) => (
              <div
                key={item.id}
                className="rounded-lg bg-base-200 p-3 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-semibold truncate">{item.name}</p>
                  <p className="text-xs opacity-70">{item.category}</p>
                </div>
                <button
                  className={`btn btn-xs ${
                    item.is_available ? "btn-outline" : "btn-warning"
                  }`}
                  onClick={() =>
                    void updateKitchenAvailability(item, !item.is_available)
                  }
                  disabled={operationId === `kds-menu-${item.id}`}
                >
                  {item.is_available ? "標記售完" : "恢復可售"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  function renderKdsView() {
    if (!canUseKds(user)) return renderLoginPanel("kds");

    return (
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-3xl font-bold">廚房 KDS</h2>
            <p className="text-sm opacity-70">
              目前 active 訂單 {kdsOrders.length} 張。
            </p>
          </div>
          <button
            className="btn btn-outline"
            onClick={() => void loadKdsData()}
            disabled={kdsLoading}
          >
            {kdsLoading ? "更新中..." : "重新整理"}
          </button>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[1fr_22rem] gap-5">
          <div className="space-y-5">
            {renderKdsAvailabilityControls()}
            {renderKdsOrders()}
          </div>
          <aside className="space-y-5">
            {renderKdsQueue()}
            {renderPickupVerifier()}
            {renderKdsBatches()}
          </aside>
        </div>
      </section>
    );
  }

  function renderKdsOrders() {
    if (kdsLoading) {
      return (
        <div className="alert">
          <span>讀取廚房訂單...</span>
        </div>
      );
    }

    if (kdsOrders.length === 0) {
      return (
        <div className="alert alert-info">
          <span>目前沒有廚房訂單。</span>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {kdsOrders.map((order) => (
          <article
            key={order.id}
            className="card bg-base-100 shadow-md border border-base-300"
          >
            <div className="card-body">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xl font-bold">訂單 #{order.id}</h3>
                <span className={`badge ${orderStatusClass(order.status)}`}>
                  {orderStatusLabel[order.status]}
                </span>
              </div>
              <div className="text-sm opacity-70 space-y-1">
                <p>建立：{formatDateTime(order.createdAt)}</p>
                <p>預估：{formatDateTime(order.estimatedReadyAt)}</p>
                <p>取餐碼：{order.pickupCode ?? "-"}</p>
                <p>
                  {orderTypeLabel[order.orderType]} /{" "}
                  {packageTypeLabel[order.packageType]}
                  {order.tableId ? ` / 桌位 #${order.tableId}` : ""}
                </p>
              </div>

              <div className="space-y-3">
                {order.items.map((detail) => (
                  <div
                    key={`${order.id}-${detail.item.id}`}
                    className="rounded-lg bg-base-200 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">
                          {detail.item.name} x {detail.qty}
                        </p>
                        {detail.note ? (
                          <p className="text-sm opacity-70">備註：{detail.note}</p>
                        ) : null}
                      </div>
                      <span className="badge badge-outline">
                        {orderItemStatusLabel[detail.status]}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() =>
                          void updateKdsItemStatus(
                            order.id,
                            detail.item.id,
                            "preparing",
                          )
                        }
                        disabled={
                          operationId ===
                          `item-${order.id}-${detail.item.id}-preparing`
                        }
                      >
                        製作中
                      </button>
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() =>
                          void updateKdsItemStatus(order.id, detail.item.id, "ready")
                        }
                        disabled={
                          operationId ===
                          `item-${order.id}-${detail.item.id}-ready`
                        }
                      >
                        完成品項
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card-actions justify-end">
                <button
                  className="btn btn-sm"
                  onClick={() => void updateKdsStatus(order.id, "preparing")}
                  disabled={operationId === `order-${order.id}-preparing`}
                >
                  開始製作
                </button>
                <button
                  className="btn btn-sm btn-success"
                  onClick={() => void updateKdsStatus(order.id, "ready")}
                  disabled={operationId === `order-${order.id}-ready`}
                >
                  可取餐
                </button>
                <button
                  className="btn btn-sm btn-neutral"
                  onClick={() => void updateKdsStatus(order.id, "completed")}
                  disabled={operationId === `order-${order.id}-completed`}
                >
                  完成
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    );
  }

  function renderKdsQueue() {
    return (
      <section className="card bg-base-100 shadow-md">
        <div className="card-body">
          <h3 className="card-title">生產佇列</h3>
          {kdsQueue.length === 0 ? (
            <p className="text-sm opacity-70">目前沒有佇列資料。</p>
          ) : (
            <div className="space-y-2">
              {kdsQueue.map((queue) => (
                <div
                  key={queue.orderId}
                  className="rounded-lg bg-base-200 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">
                      #{queue.priority} 訂單 {queue.orderId}
                    </span>
                    <span className={`badge ${orderStatusClass(queue.status)}`}>
                      {orderStatusLabel[queue.status]}
                    </span>
                  </div>
                  <p className="opacity-70">
                    {queue.itemCount} 件 / {formatDateTime(queue.estimatedReadyAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderPickupVerifier() {
    return (
      <section className="card bg-base-100 shadow-md">
        <div className="card-body">
          <h3 className="card-title">取餐驗證</h3>
          <div className="join w-full">
            <input
              className="input input-bordered join-item w-full"
              placeholder="輸入取餐碼"
              value={pickupCodeInput}
              onChange={(event) => setPickupCodeInput(event.target.value)}
            />
            <button
              className="btn btn-primary join-item"
              onClick={() => void verifyPickup()}
              disabled={operationId === "pickup-verify"}
            >
              驗證
            </button>
          </div>
          {pickupVerification ? (
            <div className="rounded-lg bg-base-200 p-3 text-sm">
              <p className="font-semibold">
                訂單 #{pickupVerification.orderId} 已驗證
              </p>
              <p className="opacity-70">
                {pickupVerification.pickupCode} /{" "}
                {orderStatusLabel[pickupVerification.status]}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderKdsBatches() {
    return (
      <section className="card bg-base-100 shadow-md">
        <div className="card-body">
          <h3 className="card-title">批次製作建議</h3>
          {kdsBatches.length === 0 ? (
            <p className="text-sm opacity-70">目前沒有可合併批次。</p>
          ) : (
            <div className="space-y-3">
              {kdsBatches.slice(0, 8).map((batch) => (
                <div
                  key={batch.ingredientId}
                  className="rounded-lg bg-base-200 p-3"
                >
                  <p className="font-semibold">{batch.ingredientName}</p>
                  <p className="text-sm opacity-70">
                    {batch.totalQuantity} {batch.unit}
                  </p>
                  <p className="text-xs opacity-60">
                    訂單：{batch.orderIds.join(", ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderMenuManager() {
    return (
      <section className="grid grid-cols-1 xl:grid-cols-[24rem_1fr] gap-5">
        <article className="card bg-base-100 shadow-md h-fit">
          <div className="card-body">
            <h3 className="card-title">
              {editingMenuId ? "修改菜單" : "新增菜單"}
            </h3>
            <label className="form-control">
              <span className="label-text">品項名稱</span>
              <input
                className="input input-bordered"
                value={menuForm.name}
                onChange={(event) =>
                  setMenuForm({ ...menuForm, name: event.target.value })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="form-control">
                <span className="label-text">價格</span>
                <input
                  className="input input-bordered"
                  inputMode="numeric"
                  value={menuForm.price}
                  onChange={(event) =>
                    setMenuForm({ ...menuForm, price: event.target.value })
                  }
                />
              </label>
              <label className="form-control">
                <span className="label-text">製作分鐘</span>
                <input
                  className="input input-bordered"
                  inputMode="numeric"
                  value={menuForm.default_time}
                  onChange={(event) =>
                    setMenuForm({
                      ...menuForm,
                      default_time: event.target.value,
                    })
                  }
                />
              </label>
            </div>
            <label className="form-control">
              <span className="label-text">分類</span>
              <input
                className="input input-bordered"
                value={menuForm.category}
                onChange={(event) =>
                  setMenuForm({ ...menuForm, category: event.target.value })
                }
              />
            </label>
            <label className="form-control">
              <span className="label-text">圖片 URL</span>
              <input
                className="input input-bordered"
                value={menuForm.image_url}
                onChange={(event) =>
                  setMenuForm({ ...menuForm, image_url: event.target.value })
                }
              />
            </label>
            <label className="form-control">
              <span className="label-text">描述</span>
              <textarea
                className="textarea textarea-bordered min-h-24"
                value={menuForm.description}
                onChange={(event) =>
                  setMenuForm({
                    ...menuForm,
                    description: event.target.value,
                  })
                }
              />
            </label>
            <label className="label cursor-pointer justify-start gap-3">
              <input
                type="checkbox"
                className="toggle toggle-primary"
                checked={menuForm.is_available}
                onChange={(event) =>
                  setMenuForm({
                    ...menuForm,
                    is_available: event.target.checked,
                  })
                }
              />
              <span className="label-text">可販售</span>
            </label>
            <div className="card-actions">
              <button
                className="btn btn-primary"
                onClick={() => void saveMenuItem()}
                disabled={isSavingMenu}
              >
                {isSavingMenu ? "儲存中..." : "儲存"}
              </button>
              <button className="btn btn-ghost" onClick={resetMenuForm}>
                清空
              </button>
            </div>
          </div>
        </article>

        <article className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h3 className="card-title">菜單管理</h3>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>品項</th>
                    <th>分類</th>
                    <th>價格</th>
                    <th>狀態</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.category}</td>
                      <td>${item.price}</td>
                      <td>
                        <span
                          className={`badge ${
                            item.is_available ? "badge-success" : "badge-neutral"
                          }`}
                        >
                          {item.is_available ? "可售" : "售完"}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2 justify-end">
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={() => editMenuItem(item)}
                          >
                            編輯
                          </button>
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={() => void openRecipeEditor(item)}
                          >
                            食材
                          </button>
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={() => void loadMenuDetail(item.id)}
                          >
                            詳情
                          </button>
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={() => void toggleMenuAvailability(item)}
                            disabled={operationId === `toggle-menu-${item.id}`}
                          >
                            {item.is_available ? "售完" : "可售"}
                          </button>
                          <button
                            className="btn btn-xs btn-error btn-outline"
                            onClick={() => void deleteMenuItem(item)}
                            disabled={operationId === `delete-menu-${item.id}`}
                          >
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>
    );
  }

  function renderRecipeManager() {
    if (!recipeMenuItem) return null;

    return (
      <section className="card bg-base-100 shadow-md">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="card-title">品項食材設定</h3>
              <p className="text-sm opacity-70">{recipeMenuItem.name}</p>
            </div>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => {
                setRecipeMenuItem(null);
                setRecipeRows([]);
                setProductIngredients([]);
              }}
            >
              關閉
            </button>
          </div>

          <div className="space-y-2">
            {recipeRows.map((row, index) => (
              <div key={index} className="grid grid-cols-[1fr_8rem_auto] gap-2">
                <select
                  className="select select-bordered select-sm"
                  value={row.ingredientId}
                  onChange={(event) =>
                    setRecipeRows((current) =>
                      current.map((target, targetIndex) =>
                        targetIndex === index
                          ? { ...target, ingredientId: event.target.value }
                          : target,
                      ),
                    )
                  }
                >
                  <option value="">選擇食材</option>
                  {ingredients.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.name} ({ingredient.unit})
                    </option>
                  ))}
                </select>
                <input
                  className="input input-bordered input-sm"
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(event) =>
                    setRecipeRows((current) =>
                      current.map((target, targetIndex) =>
                        targetIndex === index
                          ? { ...target, quantity: event.target.value }
                          : target,
                      ),
                    )
                  }
                />
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() =>
                    setRecipeRows((current) =>
                      current.filter((_, targetIndex) => targetIndex !== index),
                    )
                  }
                >
                  移除
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn btn-sm btn-outline"
              onClick={() =>
                setRecipeRows((current) => [
                  ...current,
                  { ingredientId: "", quantity: "1" },
                ])
              }
            >
              新增一列
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => void saveRecipe()}
              disabled={operationId === "save-recipe"}
            >
              儲存食材設定
            </button>
          </div>

          {productIngredients.length > 0 ? (
            <p className="text-sm opacity-70">
              目前已設定 {productIngredients.length} 個食材需求。
            </p>
          ) : null}
        </div>
      </section>
    );
  }

  function renderIngredientManager() {
    return (
      <section className="grid grid-cols-1 xl:grid-cols-[24rem_1fr] gap-5">
        <article className="card bg-base-100 shadow-md h-fit">
          <div className="card-body">
            <h3 className="card-title">
              {editingIngredientId ? "修改食材" : "新增食材"}
            </h3>
            <label className="form-control">
              <span className="label-text">名稱</span>
              <input
                className="input input-bordered"
                value={ingredientForm.name}
                onChange={(event) =>
                  setIngredientForm({ ...ingredientForm, name: event.target.value })
                }
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="form-control">
                <span className="label-text">庫存</span>
                <input
                  className="input input-bordered"
                  inputMode="decimal"
                  value={ingredientForm.stock}
                  onChange={(event) =>
                    setIngredientForm({
                      ...ingredientForm,
                      stock: event.target.value,
                    })
                  }
                />
              </label>
              <label className="form-control">
                <span className="label-text">單位</span>
                <input
                  className="input input-bordered"
                  value={ingredientForm.unit}
                  onChange={(event) =>
                    setIngredientForm({ ...ingredientForm, unit: event.target.value })
                  }
                />
              </label>
            </div>
            <label className="form-control">
              <span className="label-text">補貨門檻</span>
              <input
                className="input input-bordered"
                inputMode="decimal"
                value={ingredientForm.reorderLevel}
                onChange={(event) =>
                  setIngredientForm({
                    ...ingredientForm,
                    reorderLevel: event.target.value,
                  })
                }
              />
            </label>
            <div className="card-actions">
              <button
                className="btn btn-primary"
                onClick={() => void saveIngredient()}
                disabled={operationId === "save-ingredient"}
              >
                儲存
              </button>
              <button className="btn btn-ghost" onClick={resetIngredientForm}>
                清空
              </button>
            </div>
          </div>
        </article>

        <article className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h3 className="card-title">食材庫存</h3>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>名稱</th>
                    <th>庫存</th>
                    <th>補貨門檻</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ingredients.map((ingredient) => (
                    <tr key={ingredient.id}>
                      <td>{ingredient.name}</td>
                      <td>
                        {ingredient.stock} {ingredient.unit}
                      </td>
                      <td>
                        <span
                          className={`badge ${
                            ingredient.stock <= ingredient.reorderLevel
                              ? "badge-warning"
                              : "badge-outline"
                          }`}
                        >
                          {ingredient.reorderLevel}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={() => editIngredient(ingredient)}
                          >
                            編輯
                          </button>
                          <button
                            className="btn btn-xs btn-error btn-outline"
                            onClick={() => void deleteIngredient(ingredient)}
                            disabled={
                              operationId === `delete-ingredient-${ingredient.id}`
                            }
                          >
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>
      </section>
    );
  }

  function renderTableManager() {
    return (
      <section className="grid grid-cols-1 xl:grid-cols-[24rem_1fr] gap-5">
        <article className="card bg-base-100 shadow-md h-fit">
          <div className="card-body">
            <h3 className="card-title">
              {editingTableId ? "修改桌位" : "新增桌位"}
            </h3>
            <label className="form-control">
              <span className="label-text">桌號</span>
              <input
                className="input input-bordered"
                value={tableForm.code}
                onChange={(event) =>
                  setTableForm({ ...tableForm, code: event.target.value })
                }
              />
            </label>
            <label className="form-control">
              <span className="label-text">人數</span>
              <input
                className="input input-bordered"
                inputMode="numeric"
                value={tableForm.capacity}
                onChange={(event) =>
                  setTableForm({ ...tableForm, capacity: event.target.value })
                }
              />
            </label>
            {editingTableId ? (
              <>
                <label className="form-control">
                  <span className="label-text">狀態</span>
                  <select
                    className="select select-bordered"
                    value={tableForm.status}
                    onChange={(event) =>
                      setTableForm({
                        ...tableForm,
                        status: event.target.value as DiningTable["status"],
                      })
                    }
                  >
                    {Object.entries(tableStatusLabel).map(([status, label]) => (
                      <option key={status} value={status}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-control">
                  <span className="label-text">目前訂單 ID</span>
                  <input
                    className="input input-bordered"
                    inputMode="numeric"
                    value={tableForm.currentOrderId}
                    onChange={(event) =>
                      setTableForm({
                        ...tableForm,
                        currentOrderId: event.target.value,
                      })
                    }
                  />
                </label>
              </>
            ) : null}
            <div className="card-actions">
              <button
                className="btn btn-primary"
                onClick={() => void saveTable()}
                disabled={operationId === "save-table"}
              >
                儲存
              </button>
              <button className="btn btn-ghost" onClick={resetTableForm}>
                清空
              </button>
            </div>
          </div>
        </article>

        <article className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h3 className="card-title">桌位管理</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tables.map((table) => (
                <div
                  key={table.id}
                  className="rounded-lg border border-base-300 p-3"
                >
                  <div className="flex items-center justify-between">
                    <p className="font-semibold">{table.code}</p>
                    <span className="badge badge-outline">
                      {tableStatusLabel[table.status]}
                    </span>
                  </div>
                  <p className="text-sm opacity-70">{table.capacity} 人桌</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {table.status === "available" ? (
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => void updateTableStatus(table.id, "seat")}
                        disabled={operationId === `table-${table.id}-seat`}
                      >
                        入座
                      </button>
                    ) : null}
                    {["seated", "dining", "reserved"].includes(table.status) ? (
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => void updateTableStatus(table.id, "leave")}
                        disabled={operationId === `table-${table.id}-leave`}
                      >
                        離席
                      </button>
                    ) : null}
                    {table.status === "cleaning" ? (
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => void updateTableStatus(table.id, "clean")}
                        disabled={operationId === `table-${table.id}-clean`}
                      >
                        清潔完成
                      </button>
                    ) : null}
                    <button
                      className="btn btn-xs btn-outline"
                      onClick={() => editTable(table)}
                    >
                      編輯
                    </button>
                    <button
                      className="btn btn-xs btn-error btn-outline"
                      onClick={() => void deleteTable(table)}
                      disabled={operationId === `delete-table-${table.id}`}
                    >
                      刪除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>
    );
  }

  function renderAdminOrders() {
    return (
      <section className="grid grid-cols-1 xl:grid-cols-[1fr_24rem] gap-5">
        <article className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h3 className="card-title">全部訂單</h3>
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>狀態</th>
                    <th>方式</th>
                    <th>金額</th>
                    <th>建立時間</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {allOrders.slice(0, 20).map((order) => (
                    <tr key={order.id}>
                      <td>#{order.id}</td>
                      <td>
                        <span className={`badge ${orderStatusClass(order.status)}`}>
                          {orderStatusLabel[order.status]}
                        </span>
                      </td>
                      <td>{orderTypeLabel[order.orderType]}</td>
                      <td>${order.total}</td>
                      <td>{formatDateTime(order.createdAt)}</td>
                      <td>
                        <button
                          className="btn btn-xs btn-outline"
                          onClick={() => void loadAdminOrderDetail(order.id)}
                        >
                          詳情
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </article>

        <aside className="card bg-base-100 shadow-md h-fit">
          <div className="card-body">
            <h3 className="card-title">訂單詳情</h3>
            {adminOrderDetail ? (
              <div className="space-y-3 text-sm">
                <p className="font-semibold">訂單 #{adminOrderDetail.id}</p>
                <p>
                  {orderStatusLabel[adminOrderDetail.status]} /{" "}
                  {orderTypeLabel[adminOrderDetail.orderType]} / $
                  {adminOrderDetail.total}
                </p>
                <ul className="space-y-1">
                  {adminOrderDetail.items.map((detail) => (
                    <li
                      key={`${adminOrderDetail.id}-${detail.item.id}`}
                      className="flex justify-between gap-3"
                    >
                      <span>{detail.item.name} x {detail.qty}</span>
                      <span>{orderItemStatusLabel[detail.status]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm opacity-70">選擇一筆訂單查看詳情。</p>
            )}
          </div>
        </aside>
      </section>
    );
  }

  function renderAdminReports() {
    const maxPeak = Math.max(1, ...peakHours.map((item) => item.orderCount));

    return (
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <article className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h3 className="card-title">熱門品項</h3>
            {popularItems.length === 0 ? (
              <p className="text-sm opacity-70">目前沒有銷售資料。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>品項</th>
                      <th>數量</th>
                      <th>營收</th>
                    </tr>
                  </thead>
                  <tbody>
                    {popularItems.slice(0, 8).map((item) => (
                      <tr key={item.itemId}>
                        <td>{item.name}</td>
                        <td>{item.qty}</td>
                        <td>${item.revenue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </article>

        <article className="card bg-base-100 shadow-md">
          <div className="card-body">
            <h3 className="card-title">尖峰時段</h3>
            {peakHours.length === 0 ? (
              <p className="text-sm opacity-70">目前沒有時段資料。</p>
            ) : (
              <div className="space-y-3">
                {peakHours.slice(0, 8).map((peak) => (
                  <div key={peak.hour}>
                    <div className="flex justify-between text-sm">
                      <span>{String(peak.hour).padStart(2, "0")}:00</span>
                      <span>{peak.orderCount} 筆</span>
                    </div>
                    <progress
                      className="progress progress-primary w-full"
                      value={peak.orderCount}
                      max={maxPeak}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </article>
      </div>
    );
  }

  function renderAdminView() {
    if (!canUseAdmin(user)) return renderLoginPanel("admin");

    return (
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-3xl font-bold">老闆後台</h2>
            <p className="text-sm opacity-70">
              boss 權限：報表、訂單、桌位、庫存、菜單。
            </p>
          </div>
          <button
            className="btn btn-outline"
            onClick={() => void loadAdminData()}
            disabled={adminLoading}
          >
            {adminLoading ? "更新中..." : "重新整理"}
          </button>
        </div>

        {adminLoading ? (
          <div className="alert">
            <span>讀取後台資料...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="stats shadow bg-base-100">
                <div className="stat">
                  <div className="stat-title">系統</div>
                  <div className="stat-value text-lg">{health?.status ?? "-"}</div>
                  <div className="stat-desc">
                    Google {health?.auth?.googleConfigured ? "已設定" : "未設定"}
                  </div>
                </div>
              </div>
              <div className="stats shadow bg-base-100">
                <div className="stat">
                  <div className="stat-title">營收</div>
                  <div className="stat-value text-primary">
                    ${revenueReport?.revenue ?? 0}
                  </div>
                  <div className="stat-desc">
                    {revenueReport?.orderCount ?? 0} 筆訂單
                  </div>
                </div>
              </div>
              <div className="stats shadow bg-base-100">
                <div className="stat">
                  <div className="stat-title">平均客單</div>
                  <div className="stat-value">
                    ${revenueReport?.averageOrderValue ?? 0}
                  </div>
                  <div className="stat-desc">排除取消訂單</div>
                </div>
              </div>
              <div className="stats shadow bg-base-100">
                <div className="stat">
                  <div className="stat-title">可用桌位</div>
                  <div className="stat-value text-success">
                    {turnoverReport?.availableTables ?? 0}
                  </div>
                  <div className="stat-desc">
                    總座位 {turnoverReport?.totalSeats ?? 0}
                  </div>
                </div>
              </div>
              <div className="stats shadow bg-base-100">
                <div className="stat">
                  <div className="stat-title">低庫存</div>
                  <div className="stat-value text-warning">
                    {lowStockIngredients.length}
                  </div>
                  <div className="stat-desc">需補貨食材</div>
                </div>
              </div>
            </div>

            {renderAdminReports()}
            {renderAdminOrders()}
            {renderMenuManager()}
            {renderRecipeManager()}
            {renderTableManager()}
            {renderIngredientManager()}
          </>
        )}
      </section>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-error m-4">
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      <div className="navbar bg-base-100 shadow-lg flex-col items-stretch gap-3 lg:flex-row lg:items-center">
        <div className="flex-1 w-full lg:w-auto">
          <button
            className="btn btn-ghost normal-case text-2xl"
            onClick={() => setView("customer")}
          >
            早餐店點餐系統
          </button>
        </div>
        <div className="tabs tabs-boxed bg-base-200 w-full lg:w-auto">
          <button
            className={`tab flex-1 lg:flex-none ${
              view === "customer" ? "tab-active" : ""
            }`}
            onClick={() => setView("customer")}
          >
            顧客點餐
          </button>
          <button
            className={`tab flex-1 lg:flex-none ${
              view === "kds" ? "tab-active" : ""
            }`}
            onClick={() => setView("kds")}
          >
            廚房 KDS
          </button>
          <button
            className={`tab flex-1 lg:flex-none ${
              view === "admin" ? "tab-active" : ""
            }`}
            onClick={() => setView("admin")}
          >
            老闆後台
          </button>
        </div>
        <div className="flex-none w-full lg:w-auto">
          <div className="flex flex-wrap gap-2 items-center lg:justify-end">
            <div className="badge badge-outline">
              {user ? `${user.name} / ${user.role}` : "未登入"}
            </div>
            <div className="badge badge-primary">
              {items.length} 品項 / {grouped.categories.length} 類
            </div>
            <div className="badge badge-secondary">購物車 {cartItemCount} 件</div>
            <div className="badge badge-accent">總計 ${cartTotal}</div>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => setIsCartOpen(true)}
              disabled={!user || view !== "customer"}
            >
              購物車
            </button>
            {user ? (
              <button className="btn btn-sm" onClick={handleLogout}>
                {isGuestUser(user) ? "結束訪客" : "登出"}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <main className="container mx-auto p-6">
        {actionError ? (
          <div className="alert alert-warning mb-4">
            <span>{actionError}</span>
          </div>
        ) : null}

        {view === "customer" ? renderCustomerView() : null}
        {view === "kds" ? renderKdsView() : null}
        {view === "admin" ? renderAdminView() : null}
      </main>

      {isCartOpen ? (
        <>
          <button
            className="fixed inset-0 bg-black/35"
            aria-label="close cart drawer"
            onClick={() => setIsCartOpen(false)}
          />
          <aside className="fixed right-0 top-0 h-full w-full max-w-md bg-base-100 shadow-2xl z-10 flex flex-col">
            <div className="p-4 border-b border-base-300 flex items-center justify-between">
              <h2 className="text-xl font-bold">購物車</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setIsCartOpen(false)}
              >
                關閉
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto">
              <div className="mb-4 rounded-lg bg-base-200 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold">用餐方式</span>
                  <span>{orderTypeLabel[orderType]}</span>
                </div>
                {orderType === "takeout" ? (
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="font-semibold">包裝方式</span>
                    <span>{packageTypeLabel[packageType]}</span>
                  </div>
                ) : (
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <span className="font-semibold">桌位</span>
                    <span>
                      {availableTables.find((table) => table.id === selectedTableId)
                        ?.code ?? "未選擇"}
                    </span>
                  </div>
                )}
              </div>
              {cartDetails.length === 0 ? (
                <div className="alert">
                  <span>購物車目前是空的。</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {cartDetails.map((detail) => (
                    <article
                      key={detail.itemId}
                      className="rounded-lg border border-base-300 bg-base-200 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold">{detail.item.name}</p>
                          <p className="text-xs opacity-70">
                            {detail.item.category}
                          </p>
                        </div>
                        <span className="badge badge-outline">x {detail.qty}</span>
                      </div>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div>
                          <span className="opacity-70">單價</span>
                          <p className="font-semibold">${detail.item.price}</p>
                        </div>
                        <div>
                          <span className="opacity-70">數量</span>
                          <p className="font-semibold">{detail.qty}</p>
                        </div>
                        <div className="text-right">
                          <span className="opacity-70">小計</span>
                          <p className="font-bold">${detail.subtotal}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-base-300 space-y-3">
              <div className="flex items-center justify-between font-semibold">
                <span>數量</span>
                <span>{cartItemCount}</span>
              </div>
              <div className="flex items-center justify-between text-lg font-bold">
                <span>總金額</span>
                <span>${cartTotal}</span>
              </div>
              <button
                className="btn btn-error btn-outline w-full"
                onClick={() => void clearCart()}
                disabled={cartDetails.length === 0 || isClearingCart}
              >
                {isClearingCart ? "清空中..." : "清空購物車"}
              </button>
              <button
                className="btn btn-primary w-full"
                onClick={() => void submitOrder()}
                disabled={cartDetails.length === 0 || isSubmittingOrder}
              >
                {isSubmittingOrder ? "送出中..." : "送出訂單"}
              </button>
            </div>
          </aside>
        </>
      ) : null}
    </div>
  );
}
