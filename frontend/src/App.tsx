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
  User,
  UserRole,
} from "../../shared/contracts.ts";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
const USER_STORAGE_KEY = "breakfast.user";

type SafeUser = Omit<User, "password">;
type AppView = "customer" | "kds" | "admin";

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

interface RevenueReport {
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
  byStatus: Partial<Record<OrderStatus, number>>;
}

interface PopularItem {
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

interface MenuFormState {
  name: string;
  price: string;
  category: string;
  description: string;
  image_url: string;
  default_time: string;
  is_available: boolean;
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

const orderStatusLabel: Record<OrderStatus, string> = {
  pending: "購物中",
  submitted: "已送單",
  preparing: "製作中",
  ready: "待取餐",
  completed: "已完成",
  cancelled: "已取消",
};

const orderItemStatusLabel: Record<OrderItemStatus, string> = {
  queued: "排隊中",
  preparing: "製作中",
  ready: "已完成",
  served: "已出餐",
  cancelled: "已取消",
};

const tableStatusLabel: Record<DiningTable["status"], string> = {
  available: "空桌",
  reserved: "已預約",
  seated: "入座",
  dining: "用餐中",
  cleaning: "待清潔",
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
    throw new Error(`${path} failed: HTTP ${response.status}`);
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

export default function App() {
  const [view, setView] = useState<AppView>("customer");
  const [user, setUser] = useState<SafeUser | null>(null);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authError, setAuthError] = useState("");
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderId, setOrderId] = useState<number | null>(null);
  const [cartQtyByItemId, setCartQtyByItemId] = useState<Record<number, number>>(
    {},
  );
  const [cartTotal, setCartTotal] = useState(0);
  const [activeItemId, setActiveItemId] = useState<number | null>(null);
  const [actionError, setActionError] = useState("");
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isClearingCart, setIsClearingCart] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);
  const [orderHistory, setOrderHistory] = useState<Order[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [kdsOrders, setKdsOrders] = useState<Order[]>([]);
  const [kdsBatches, setKdsBatches] = useState<BatchSuggestion[]>([]);
  const [kdsLoading, setKdsLoading] = useState(false);
  const [adminLoading, setAdminLoading] = useState(false);
  const [revenueReport, setRevenueReport] = useState<RevenueReport | null>(null);
  const [popularItems, setPopularItems] = useState<PopularItem[]>([]);
  const [turnoverReport, setTurnoverReport] = useState<TurnoverReport | null>(
    null,
  );
  const [peakHours, setPeakHours] = useState<PeakHour[]>([]);
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [lowStockIngredients, setLowStockIngredients] = useState<Ingredient[]>(
    [],
  );
  const [operationId, setOperationId] = useState<string | null>(null);
  const [menuForm, setMenuForm] = useState<MenuFormState>(emptyMenuForm);
  const [editingMenuId, setEditingMenuId] = useState<number | null>(null);
  const [isSavingMenu, setIsSavingMenu] = useState(false);

  const grouped = useMemo(() => {
    const groupedItems = items.reduce(
      (acc, item) => {
        const category = item.category || "其他";
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

  async function loadMenu() {
    const fetchedItems = await fetchApiData<MenuItem[]>("/api/menu");
    setItems(Array.isArray(fetchedItems) ? fetchedItems : []);
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
      const [orders, batches] = await Promise.all([
        fetchApiData<Order[]>("/api/kds/orders"),
        fetchApiData<BatchSuggestion[]>("/api/kds/batches"),
      ]);
      setKdsOrders(Array.isArray(orders) ? orders : []);
      setKdsBatches(Array.isArray(batches) ? batches : []);
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
      const [revenue, popular, turnover, peaks, tableList, ingredientList, lowStock] =
        await Promise.all([
          fetchApiData<RevenueReport>("/api/reports/revenue"),
          fetchApiData<PopularItem[]>("/api/reports/popular-items"),
          fetchApiData<TurnoverReport>("/api/reports/turnover"),
          fetchApiData<PeakHour[]>("/api/reports/peak-hours"),
          fetchApiData<DiningTable[]>("/api/tables"),
          fetchApiData<Ingredient[]>("/api/ingredients"),
          fetchApiData<Ingredient[]>("/api/ingredients/low-stock"),
        ]);

      setRevenueReport(revenue);
      setPopularItems(Array.isArray(popular) ? popular : []);
      setTurnoverReport(turnover);
      setPeakHours(Array.isArray(peaks) ? peaks : []);
      setTables(Array.isArray(tableList) ? tableList : []);
      setIngredients(Array.isArray(ingredientList) ? ingredientList : []);
      setLowStockIngredients(Array.isArray(lowStock) ? lowStock : []);
    } catch (adminError) {
      setActionError("後台資料讀取失敗，請確認是否使用 boss 帳號登入。");
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
          setUser({
            id: parsedUser.id,
            email: parsedUser.email,
            name: parsedUser.name,
            role: parsedUser.role,
          });
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
        const sessionUser = await fetchApiData<SafeUser | null>(
          "/api/auth/session",
        );
        if (mounted && sessionUser) {
          setUser(sessionUser);
          window.localStorage.setItem(
            USER_STORAGE_KEY,
            JSON.stringify(sessionUser),
          );
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
    if (!user || user.role !== "customer") {
      setOrderHistory([]);
      return;
    }

    void loadCurrentOrder(user.id).catch((refreshError) => {
      setActionError("購物車讀取失敗，請稍後再試。");
      console.error(refreshError);
    });

    if (isGuestUser(user)) {
      setOrderHistory([]);
      return;
    }

    void loadOrderHistory(user.id).catch((historyError) => {
      setActionError("歷史訂單讀取失敗，請稍後再試。");
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
    if (orderId !== null) return orderId;

    const createdOrder = await fetchApiData<Order>("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: user.id }),
    });

    setOrderId(createdOrder.id);
    return createdOrder.id;
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
      window.localStorage.setItem(
        USER_STORAGE_KEY,
        JSON.stringify(loggedInUser),
      );
      setEmailInput("");
      setPasswordInput("");

      if (view === "admin" && loggedInUser.role !== "manager") {
        setAuthError("此帳號沒有後台權限。");
        setView(defaultViewForRole(loggedInUser.role));
        return;
      }

      if (view === "kds" && !canUseKds(loggedInUser)) {
        setAuthError("此帳號沒有廚房權限。");
        setView(defaultViewForRole(loggedInUser.role));
        return;
      }

      setView((currentView) =>
        currentView === "customer"
          ? defaultViewForRole(loggedInUser.role)
          : currentView,
      );
    } catch (loginError) {
      setAuthError("登入失敗，請確認帳號或密碼。");
      console.error(loginError);
    } finally {
      setIsLoggingIn(false);
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
    setAuthError("");
    setActionError("");
    window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(guestUser));
  }

  function handleLogout() {
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
    resetCartState();
    setView("customer");
  }

  async function addToCart(item: MenuItem) {
    setActionError("");
    setActiveItemId(item.id);

    try {
      if (!user) {
        setActionError("請先按直接點餐，再加入購物車。");
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
    setActionError("");
    setIsSubmittingOrder(true);

    try {
      const order = await fetchApiData<Order>(`/api/orders/${orderId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });

      setSubmittedOrder(order);
      if (!isGuestUser(user)) {
        await loadOrderHistory(user.id);
      }
      resetCartState();
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
    } catch (tableError) {
      setActionError("更新桌位失敗，請稍後再試。");
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
      setActionError("更新販售狀態失敗，請確認 boss 權限。");
      console.error(menuError);
    } finally {
      setOperationId(null);
    }
  }

  function renderLoginPanel(targetView: AppView) {
    const title = targetView === "admin" ? "後台登入" : "廚房登入";
    const hint =
      targetView === "admin"
        ? "此頁需要 boss 權限。"
        : "此頁需要工作人員或 boss 權限。";

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
            disabled={isLoggingIn || isGoogleSigningIn}
          >
            {isLoggingIn ? "登入中..." : "登入"}
          </button>
          <button
            className="btn btn-outline"
            onClick={() => void handleGoogleSignIn()}
            disabled={isLoggingIn || isGoogleSigningIn}
          >
            {isGoogleSigningIn ? "Google..." : "Google 登入"}
          </button>
        </div>
      </section>
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
              <div className="stat-title">付款金額</div>
              <div className="stat-value text-primary">${submittedOrder.total}</div>
            </div>
            <div className="stat bg-base-200 rounded-lg">
              <div className="stat-title">預估取餐</div>
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
              <p className="text-sm opacity-70">
                {user.name} 登入中，可查看之前訂過的菜單。
              </p>
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
              <span>讀取歷史訂單中...</span>
            </div>
          ) : orderHistory.length === 0 ? (
            <div className="alert alert-info">
              <span>目前沒有歷史訂單。</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {orderHistory.slice(0, 6).map((order) => (
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
                        <span>
                          {detail.item.name} x {detail.qty}
                        </span>
                        <span>${detail.item.price * detail.qty}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-semibold">總額 ${order.total}</span>
                      <span className="ml-3 opacity-70">
                        取餐 {formatDateTime(order.estimatedReadyAt)}
                      </span>
                    </div>
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
                </article>
              ))}
            </div>
          )}
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
                <h2 className="card-title">直接點餐</h2>
                <p className="text-sm opacity-70">
                  不需要會員或 Google 登入，也可以先選餐送單。
                </p>
              </div>
              <div className="w-full md:w-80 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-1 gap-2">
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
                <div className="grid grid-cols-2 gap-2">
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => void handleLogin()}
                    disabled={isLoggingIn || isGoogleSigningIn}
                  >
                    {isLoggingIn ? "登入中..." : "會員登入"}
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => void handleGoogleSignIn()}
                    disabled={isLoggingIn || isGoogleSigningIn}
                  >
                    {isGoogleSigningIn ? "Google..." : "Google 登入"}
                  </button>
                </div>
                {authError ? (
                  <div className="alert alert-error py-2 text-sm">
                    <span>{authError}</span>
                  </div>
                ) : null}
              </div>
              <button className="btn btn-primary" onClick={handleGuestOrder}>
                開始點餐
              </button>
            </div>
          </section>
        ) : null}

        {renderSubmittedOrder()}
        {renderOrderHistory()}

        {items.length === 0 ? (
          <div className="alert alert-info">
            <span>目前沒有可販售的品項。</span>
          </div>
        ) : (
          grouped.categories.map((category) => (
            <section key={category} className="mb-8">
              <h2 className="text-3xl font-bold mb-4 text-primary border-b-2 border-primary pb-2">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(grouped.groupedItems[category] || []).map((item) => (
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
                          <span className="badge badge-neutral">停售</span>
                        ) : null}
                      </div>
                      <p className="text-sm opacity-80 line-clamp-2 min-h-[2.75rem]">
                        {item.description}
                      </p>
                      <div className="card-actions justify-between items-center">
                        <span className="text-xl font-bold text-success">
                          ${item.price}
                        </span>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => void addToCart(item)}
                          disabled={
                            !user ||
                            !item.is_available ||
                            activeItemId === item.id
                          }
                        >
                          {activeItemId === item.id
                            ? "加入中..."
                            : `加入購物車${
                                cartQtyByItemId[item.id]
                                  ? ` (${cartQtyByItemId[item.id]})`
                                  : ""
                              }`}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))
        )}
      </>
    );
  }

  function renderKdsAvailabilityControls() {
    return (
      <section className="card bg-base-100 shadow-md border border-base-300">
        <div className="card-body">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="card-title">售完品項</h3>
              <p className="text-sm opacity-70">
                廚房可即時標記售完，顧客菜單會立刻停用該品項。
              </p>
            </div>
            <span className="badge badge-neutral">
              {items.filter((item) => !item.is_available).length} 項售完
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
                  {item.is_available ? "設為售完" : "恢復販售"}
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
              目前待處理 {kdsOrders.length} 筆訂單
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

        {renderKdsAvailabilityControls()}

        {kdsLoading ? (
          <div className="alert">
            <span>讀取廚房訂單中...</span>
          </div>
        ) : kdsOrders.length === 0 ? (
          <div className="alert alert-info">
            <span>目前沒有廚房訂單。</span>
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_20rem] gap-5">
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
                      <p>預計：{formatDateTime(order.estimatedReadyAt)}</p>
                      <p>取餐碼：{order.pickupCode ?? "-"}</p>
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
                                <p className="text-sm opacity-70">
                                  備註：{detail.note}
                                </p>
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
                                void updateKdsItemStatus(
                                  order.id,
                                  detail.item.id,
                                  "ready",
                                )
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
                        待取餐
                      </button>
                      <button
                        className="btn btn-sm btn-neutral"
                        onClick={() =>
                          void updateKdsStatus(order.id, "completed")
                        }
                        disabled={operationId === `order-${order.id}-completed`}
                      >
                        完成
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>

            <aside className="card bg-base-100 shadow-md h-fit">
              <div className="card-body">
                <h3 className="card-title">批次備料</h3>
                {kdsBatches.length === 0 ? (
                  <p className="text-sm opacity-70">目前沒有共用備料。</p>
                ) : (
                  <div className="space-y-3">
                    {kdsBatches.slice(0, 6).map((batch) => (
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
            </aside>
          </div>
        )}
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
              <span className="label-text">圖片網址</span>
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
              <span className="label-text">上架販售</span>
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
                          {item.is_available ? "販售中" : "停售"}
                        </span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2 justify-end">
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={() => editMenuItem(item)}
                          >
                            修改
                          </button>
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={() => void toggleMenuAvailability(item)}
                            disabled={operationId === `toggle-menu-${item.id}`}
                          >
                            {item.is_available ? "停售" : "上架"}
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

  function renderAdminView() {
    if (!canUseAdmin(user)) return renderLoginPanel("admin");

    return (
      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-3xl font-bold">後台管理</h2>
            <p className="text-sm opacity-70">boss 權限：報表、桌位、庫存、菜單</p>
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
            <span>讀取後台資料中...</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
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
                  <div className="stat-title">空桌</div>
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
                  <div className="stat-desc">需要補貨</div>
                </div>
              </div>
            </div>

            {renderMenuManager()}

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
                      {peakHours.slice(0, 6).map((peak) => (
                        <div key={peak.hour}>
                          <div className="flex justify-between text-sm">
                            <span>{String(peak.hour).padStart(2, "0")}:00</span>
                            <span>{peak.orderCount} 筆</span>
                          </div>
                          <progress
                            className="progress progress-primary w-full"
                            value={peak.orderCount}
                            max={Math.max(
                              ...peakHours.map((item) => item.orderCount),
                            )}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <article className="card bg-base-100 shadow-md">
                <div className="card-body">
                  <h3 className="card-title">桌位</h3>
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
                              onClick={() =>
                                void updateTableStatus(table.id, "seat")
                              }
                              disabled={operationId === `table-${table.id}-seat`}
                            >
                              入座
                            </button>
                          ) : null}
                          {["seated", "dining", "reserved"].includes(
                            table.status,
                          ) ? (
                            <button
                              className="btn btn-xs btn-outline"
                              onClick={() =>
                                void updateTableStatus(table.id, "leave")
                              }
                              disabled={operationId === `table-${table.id}-leave`}
                            >
                              離桌
                            </button>
                          ) : null}
                          {table.status === "cleaning" ? (
                            <button
                              className="btn btn-xs btn-outline"
                              onClick={() =>
                                void updateTableStatus(table.id, "clean")
                              }
                              disabled={operationId === `table-${table.id}-clean`}
                            >
                              清潔完成
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

              <article className="card bg-base-100 shadow-md">
                <div className="card-body">
                  <h3 className="card-title">庫存</h3>
                  <div className="overflow-x-auto">
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>原料</th>
                          <th>庫存</th>
                          <th>安全量</th>
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
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </article>
            </div>
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
            後台
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
                登出
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
              <h2 className="text-xl font-bold">購物車明細</h2>
              <button
                className="btn btn-sm btn-ghost"
                onClick={() => setIsCartOpen(false)}
              >
                關閉
              </button>
            </div>

            <div className="p-4 flex-1 overflow-auto">
              {cartDetails.length === 0 ? (
                <div className="alert">
                  <span>購物車目前是空的。</span>
                </div>
              ) : (
                <ul className="space-y-3">
                  {cartDetails.map((detail) => (
                    <li
                      key={detail.itemId}
                      className="p-3 rounded-lg bg-base-200 flex items-center justify-between"
                    >
                      <div>
                        <p className="font-semibold">{detail.item.name}</p>
                        <p className="text-sm opacity-70">
                          單價 ${detail.item.price} x {detail.qty}
                        </p>
                      </div>
                      <p className="font-bold">${detail.subtotal}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="p-4 border-t border-base-300 space-y-3">
              <div className="flex items-center justify-between font-semibold">
                <span>數量</span>
                <span>{cartItemCount}</span>
              </div>
              <div className="flex items-center justify-between text-lg font-bold">
                <span>付款金額</span>
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
