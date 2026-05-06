import axios from "axios";
import { type FormEvent, type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { generatePdfFromElement, type PdfFormat } from "./lib/pdf";
import { renderBarcodeToDataURL } from "./lib/barcode";

/* ═══════════════ TYPES ═══════════════ */
type IconProps = { className?: string };
type Page = "home" | "login" | "register" | "gerador" | "historico";

interface User { name: string; email: string; password: string; storeName: string; }

interface ProductItem {
  id: number; name: string; sku: string; qty: number; price: number; weight: string;
}

interface ReceiptData {
  storeName: string; storeSlogan: string; storeInitials: string; storeUrl: string;
  clientName: string; clientEmail: string; clientPhone1: string; clientPhone2: string; clientCity: string; clientAddress: string; clientRef: string;
  products: ProductItem[];
  shippingCost: number;
  trackingCode: string; autoTrack: boolean; autoSku: boolean;
  thankYouMsg: string;
}

interface SavedReceipt {
  id: number; date: string; receipt: ReceiptData; pdfFormat: PdfFormat;
}

/* ═══════════════ AUTO GENERATORS ═══════════════ */
function genTrackingCode(prefix: string): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = prefix.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "WBTRK";
  code += "-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function genSku(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  let sku = words.map((w) => w.slice(0, 3).toUpperCase()).join("-").slice(0, 10);
  if (!sku) sku = "SKU";
  return sku + Math.floor(Math.random() * 100);
}
function fmtMT(v: number): string {
  return v.toLocaleString("pt-MZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ═══════════════ AUTH CONTEXT ═══════════════ */
interface AuthCtx { user: User | null; login: (e: string, p: string) => string | null; register: (u: User) => string | null; logout: () => void; }
const AuthContext = createContext<AuthCtx>({ user: null, login: () => null, register: () => null, logout: () => {} });
function useAuth() { return useContext(AuthContext); }

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => { try { const s = localStorage.getItem("ep-session"); return s ? JSON.parse(s) : null; } catch { return null; } });
  const getUsers = (): User[] => { try { const s = localStorage.getItem("ep-users"); return s ? JSON.parse(s) : []; } catch { return []; } };
 const register = async (u: User): Promise<string | null> => {

  try {

    const res = await axios.post(
      "http://localhost:5000/api/auth/register",
      {
        name: u.name,
        email: u.email,
        password: u.password
      }
    );

    localStorage.setItem(
      "token",
      res.data.token || ""
    );

    localStorage.setItem(
      "ep-session",
      JSON.stringify(res.data.user || u)
    );

    setUser(res.data.user || u);

    return null;

  } catch (error: any) {

    return (
      error.response?.data?.message ||
      "Erro ao criar conta"
    );

  }
};
 const login = async (
  email: string,
  password: string
): Promise<string | null> => {

  try {

    const res = await axios.post(
      "http://localhost:5000/api/auth/login",
      {
        email,
        password
      }
    );

    localStorage.setItem(
      "token",
      res.data.token
    );

    localStorage.setItem(
      "ep-session",
      JSON.stringify(res.data.user)
    );

    setUser(res.data.user);

    return null;

  } catch (error: any) {

    return (
      error.response?.data?.message ||
      "Email ou senha incorretos."
    );

  }
};
  const logout = () => { localStorage.removeItem("ep-session"); setUser(null); };
  return <AuthContext.Provider value={{ user, login, register, logout }}>{children}</AuthContext.Provider>;
}

/* ═══════════════ HISTORY HELPERS ═══════════════ */
function getSavedReceipts(email: string): SavedReceipt[] { try { const s = localStorage.getItem(`ep-receipts-${email}`); return s ? JSON.parse(s) : []; } catch { return []; } }
function saveReceiptToHistory(email: string, receipt: ReceiptData, pdfFormat: PdfFormat) {
  const list = getSavedReceipts(email);
  list.unshift({ id: Date.now(), date: new Date().toLocaleString("pt-MZ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }), receipt, pdfFormat });
  localStorage.setItem(`ep-receipts-${email}`, JSON.stringify(list.slice(0, 200)));
}
function deleteReceiptFromHistory(email: string, id: number) { const list = getSavedReceipts(email).filter((r) => r.id !== id); localStorage.setItem(`ep-receipts-${email}`, JSON.stringify(list)); }

/* ═══════════════ CONSTANTS ═══════════════ */
const defaultReceipt = (): ReceiptData => ({
  storeName: "WebBazar", storeSlogan: "A SUA JORNADA DE COMPRAS SIMPLIFICADA", storeInitials: "WB", storeUrl: "",
  clientName: "", clientEmail: "", clientPhone1: "", clientPhone2: "", clientCity: "", clientAddress: "", clientRef: "",
  products: [{ id: 1, name: "", sku: "", qty: 1, price: 0, weight: "" }],
  shippingCost: 0, trackingCode: "", autoTrack: true, autoSku: true,
  thankYouMsg: ", obrigado por escolher o WebBazar!\nEsperamos que o{s} seu{s} pedido{s} seja tão bom quanto é ter você aqui. Volte sempre!",
});

const statsData = [
  { value: "+10.000", label: "Recibos Gerados", icon: ReceiptStackIcon },
  { value: "Suporte Total", label: "às 11 Províncias", icon: MozambiqueIcon },
  { value: "Compatível com", label: "Lojas físicas, online local e vendas diretas", icon: StorefrontIcon },
];
const featuresData = [
  { title: "Impressão Térmica", description: "Formatação perfeita para papel de 58mm/80mm, sem cortes estranhos e sem desperdício.", icon: PrinterIcon },
  { title: "Gestão de Histórico", description: "Salve suas vendas e gere relatórios diários para organizar logística, entregas e caixa.", icon: HistoryIcon },
  { title: "Personalização", description: "Adicione sua própria logo, dados da loja, contactos e mensagens no topo do recibo.", icon: CustomIcon },
];
const compatData = [
  { title: "Lojas Físicas", desc: "Pontos de venda e balcões de atendimento com impressoras térmicas.", icon: "🏪" },
  { title: "E-commerce Local", desc: "Shopify, WooCommerce, WebBazar e qualquer loja online.", icon: "🛒" },
  { title: "Vendas Diretas", desc: "WhatsApp, Instagram, Facebook — qualquer canal de vendas.", icon: "📱" },
  { title: "Marketplaces", desc: "Mercado Livre, OLX e plataformas de terceiros.", icon: "🌐" },
  { title: "Logística", desc: "Despacho de encomendas, etiquetas e rastreio integrado.", icon: "🚚" },
  { title: "Importação", desc: "Controlo de mercadoria importada com recibos detalhados.", icon: "📦" },
];
const footerLinks = { quick: ["Gerar Recibo", "Histórico", "API para Desenvolvedores"], support: ["FAQ", "WhatsApp de Suporte", "Termos de Uso"] };

/* ═══════════════ APP ═══════════════ */
export default function App() {
  const [isDark, setIsDark] = useState(() => { if (typeof window === "undefined") return false; const s = localStorage.getItem("ecom-printer-theme"); if (s) return s === "dark"; return window.matchMedia("(prefers-color-scheme: dark)").matches; });
  const [page, setPage] = useState<Page>("home");
  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); localStorage.setItem("ecom-printer-theme", isDark ? "dark" : "light"); }, [isDark]);
  return (
    <AuthProvider>
      <div className="min-h-screen bg-white font-sans text-slate-950 antialiased selection:bg-red-200 dark:bg-[#0d0f14] dark:text-white">
        <Navbar page={page} setPage={setPage} isDark={isDark} toggleDark={() => setIsDark((v) => !v)} />
        <PageRouter page={page} setPage={setPage} />
        <Footer setPage={setPage} />
      </div>
    </AuthProvider>
  );
}

function PageRouter({ page, setPage }: { page: Page; setPage: (p: Page) => void }) {
  const { user } = useAuth();
  if ((page === "gerador" || page === "historico") && !user) return <LoginPage setPage={setPage} redirectTo={page} />;
  switch (page) {
    case "home": return <HomePage setPage={setPage} />;
    case "login": return <LoginPage setPage={setPage} />;
    case "register": return <RegisterPage setPage={setPage} />;
    case "gerador": return <GeradorPage />;
    case "historico": return <HistoricoPage setPage={setPage} />;
    default: return <HomePage setPage={setPage} />;
  }
}

/* ═══════════════ NAVBAR ═══════════════ */
function Navbar({ page, setPage, isDark, toggleDark }: { page: Page; setPage: (p: Page) => void; isDark: boolean; toggleDark: () => void }) {
  const { user, logout } = useAuth();
  const [mob, setMob] = useState(false);
  const nav = [{ label: "Início", target: "home" as Page }, { label: "Gerar Recibo", target: "gerador" as Page }, { label: "Histórico", target: "historico" as Page }];
  const go = (p: Page) => { setPage(p); setMob(false); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const lc = (t: Page) => `transition cursor-pointer font-medium ${page === t ? "text-[#c43a3a] dark:text-red-300" : "text-slate-700 hover:text-[#c43a3a] dark:text-slate-200 dark:hover:text-red-300"}`;
  return (
    <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/90 backdrop-blur-xl dark:border-white/5 dark:bg-[#0d0f14]/90">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 sm:px-8 lg:px-10">
        <button type="button" onClick={() => go("home")} className="flex items-center gap-3"><LogoMark /><span className="text-lg font-black tracking-tight text-slate-950 dark:text-white">Ecom-Printer</span></button>
        <nav className="hidden items-center gap-8 text-sm md:flex">{nav.map((n) => <button key={n.label} type="button" onClick={() => go(n.target)} className={lc(n.target)}>{n.label}</button>)}</nav>
        <div className="flex items-center gap-2">
          <button type="button" onClick={toggleDark} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:text-[#c43a3a] dark:border-white/10 dark:bg-white/5 dark:text-white" aria-label="Tema">{isDark ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}</button>
          {user ? (
            <div className="hidden items-center gap-3 sm:flex">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-sm font-black text-[#b93636] dark:bg-red-950 dark:text-red-200">{user.name.charAt(0).toUpperCase()}</div>
              <div className="text-sm leading-tight"><p className="font-bold text-slate-900 dark:text-white">{user.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{user.storeName}</p></div>
              <button type="button" onClick={() => { logout(); go("home"); }} className="ml-2 rounded-full border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 transition hover:border-red-300 hover:text-[#c43a3a] dark:border-white/10 dark:text-slate-300">Sair</button>
            </div>
          ) : (
            <div className="hidden gap-2 sm:flex">
              <button type="button" onClick={() => go("login")} className="rounded-full border border-slate-200 px-5 py-2.5 text-sm font-bold text-slate-700 transition hover:border-[#c43a3a] hover:text-[#c43a3a] dark:border-white/10 dark:text-slate-200">Login</button>
              <button type="button" onClick={() => go("register")} className="rounded-full bg-[#c43a3a] px-5 py-2.5 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[#ab3030]">Criar Conta</button>
            </div>
          )}
          <button type="button" onClick={() => setMob(!mob)} className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 md:hidden dark:border-white/10 dark:bg-white/5 dark:text-white" aria-label="Menu"><svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={mob ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} /></svg></button>
        </div>
      </div>
      {mob && (
        <div className="border-t border-slate-100 bg-white px-5 pb-5 pt-3 md:hidden dark:border-white/5 dark:bg-[#0d0f14]">
          {nav.map((n) => <button key={n.label} type="button" onClick={() => go(n.target)} className="block w-full py-3 text-left text-base font-medium text-slate-700 dark:text-slate-200">{n.label}</button>)}
          <div className="mt-3 flex gap-2 border-t border-slate-100 pt-4 dark:border-white/5">
            {user ? (<><span className="flex-1 text-sm text-slate-600 dark:text-slate-300">Olá, {user.name}</span><button type="button" onClick={() => { logout(); go("home"); }} className="rounded-full bg-red-50 px-4 py-2 text-sm font-bold text-[#c43a3a] dark:bg-red-950 dark:text-red-200">Sair</button></>) : (<><button type="button" onClick={() => go("login")} className="flex-1 rounded-full border border-slate-200 py-3 text-sm font-bold text-slate-700 dark:border-white/10 dark:text-slate-200">Login</button><button type="button" onClick={() => go("register")} className="flex-1 rounded-full bg-[#c43a3a] py-3 text-sm font-bold text-white">Criar Conta</button></>)}
          </div>
        </div>
      )}
    </header>
  );
}

/* ═══════════════ HOME ═══════════════ */
function HomePage({ setPage }: { setPage: (p: Page) => void }) {
  const { user } = useAuth();
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <main>
      <section className="relative isolate overflow-hidden bg-[#fff7f6] dark:bg-[#130c0d]">
        <HeroVisual />
        <div className="relative z-10 mx-auto flex min-h-[70vh] w-full max-w-7xl items-center px-5 py-20 sm:px-8 lg:px-10">
          <div className="max-w-3xl">
            <p className="motion-rise text-5xl font-black tracking-[-0.08em] text-[#b83232] sm:text-7xl lg:text-8xl dark:text-red-300">Ecom-Printer</p>
            <h1 className="motion-rise motion-delay-1 mt-7 max-w-2xl text-3xl font-semibold leading-[1.08] tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-6xl dark:text-white">Emita Recibos Profissionais para sua Loja em Segundos.</h1>
            <p className="motion-rise motion-delay-2 mt-6 max-w-2xl text-lg leading-8 text-slate-700 sm:text-xl dark:text-slate-200">Otimizado para impressoras térmicas 58mm e 80mm. Gere PDF em A6, A7, A8 e formato redondo. Compatível com qualquer marketplace.</p>
            <div className="motion-rise motion-delay-3 mt-9 flex flex-col gap-3 sm:flex-row">
              <button type="button" onClick={() => go("gerador")} className="inline-flex items-center justify-center rounded-full bg-[#c43a3a] px-7 py-4 text-base font-bold text-white shadow-xl shadow-red-900/20 transition hover:-translate-y-0.5 hover:bg-[#ab3030]">Gerar Recibo <ArrowRightIcon className="ml-2 h-5 w-5" /></button>
              {!user && <button type="button" onClick={() => go("register")} className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white/75 px-7 py-4 text-base font-bold text-slate-950 backdrop-blur transition hover:-translate-y-0.5 hover:border-[#c43a3a] hover:text-[#c43a3a] dark:border-white/20 dark:bg-white/10 dark:text-white">Criar Conta Grátis</button>}
            </div>
          </div>
        </div>
      </section>
      <section className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 px-5 py-8 sm:px-8 lg:px-10 dark:from-amber-950/20 dark:via-orange-950/20 dark:to-amber-950/20">
        <div className="mx-auto flex max-w-7xl items-start gap-4"><span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg dark:bg-amber-900/40">💡</span><div><h3 className="text-base font-bold text-amber-900 dark:text-amber-200">Nota informativa</h3><p className="mt-1 text-sm leading-7 text-amber-800 dark:text-amber-300/80">O Ecom-Printer é uma ferramenta gratuita por tempo limitado. Crie a sua conta para ter acesso ao gerador de recibos térmicos profissionais, salvar o histórico de recibos emitidos e personalizar com a marca da sua loja.</p></div></div>
      </section>
      <section className="bg-[#b93636] text-white dark:bg-[#8f2929]"><div className="mx-auto grid max-w-7xl divide-y divide-white/20 px-5 py-8 sm:px-8 md:grid-cols-3 md:divide-x md:divide-y-0 lg:px-10">{statsData.map((s) => { const I = s.icon; return (<div key={s.value} className="flex items-center gap-4 py-5 md:px-7 md:py-4 first:md:pl-0 last:md:pr-0"><span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20"><I className="h-6 w-6" /></span><div><p className="text-xl font-black tracking-tight">{s.value}</p><p className="mt-1 text-sm leading-5 text-white/80">{s.label}</p></div></div>); })}</div></section>
      <section className="bg-white px-5 py-24 sm:px-8 lg:px-10 dark:bg-[#0d0f14]"><div className="mx-auto max-w-7xl"><div className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.24em] text-[#b93636] dark:text-red-300">Funcionalidades</p><h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">O gerador de recibos preferido dos empreendedores digitais.</h2></div><div className="mt-16 grid gap-10 md:grid-cols-3 md:gap-0 md:divide-x md:divide-slate-200 dark:md:divide-white/10">{featuresData.map((f) => { const I = f.icon; return (<article key={f.title} className="md:px-8 first:md:pl-0 last:md:pr-0"><span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-[#b93636] dark:bg-red-950/35 dark:text-red-200"><I className="h-7 w-7" /></span><h3 className="mt-7 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{f.title}</h3><p className="mt-4 text-base leading-7 text-slate-600 dark:text-slate-300">{f.description}</p></article>); })}</div></div></section>
      <section className="bg-slate-50 px-5 py-24 sm:px-8 lg:px-10 dark:bg-[#0a0c10]"><div className="mx-auto max-w-7xl"><div className="max-w-3xl"><p className="text-sm font-bold uppercase tracking-[0.24em] text-[#b93636] dark:text-red-300">Compatibilidade</p><h2 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950 sm:text-5xl dark:text-white">Funciona em qualquer canal de vendas.</h2></div><div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{compatData.map((c) => (<div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-6 transition hover:shadow-lg dark:border-white/5 dark:bg-white/[0.03]"><span className="text-3xl">{c.icon}</span><h3 className="mt-4 text-lg font-bold text-slate-950 dark:text-white">{c.title}</h3><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{c.desc}</p></div>))}</div></div></section>
      <section className="bg-[#b93636] px-5 py-20 text-white sm:px-8 dark:bg-[#8f2929]"><div className="mx-auto grid max-w-5xl items-center gap-12 lg:grid-cols-2"><div className="text-center lg:text-left"><p className="text-sm font-bold uppercase tracking-[0.24em] text-white/60">Grátis por tempo limitado</p><h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Pronto para começar?</h2><ul className="mt-6 space-y-3 text-left">{["Recibos ilimitados", "PDF em A6, A7, A8 e redondo", "QR code + código de barras automáticos", "SKU e rastreio gerados automaticamente"].map((b) => (<li key={b} className="flex items-start gap-3 text-sm leading-6 text-white/85"><CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-white" />{b}</li>))}</ul></div><div className="flex flex-col items-center gap-4"><div className="flex items-end gap-2"><span className="text-7xl font-black tracking-[-0.06em]">0</span><span className="pb-3 text-xl font-bold text-white/70">MZN/mês</span></div><button type="button" onClick={() => go("gerador")} className="w-full max-w-xs rounded-full bg-white px-8 py-4 text-base font-black text-[#9f2d2d] shadow-lg transition hover:-translate-y-0.5 hover:bg-red-50">Gerar Recibo Agora</button>{!user && <button type="button" onClick={() => go("register")} className="w-full max-w-xs rounded-full border-2 border-white/30 px-8 py-4 text-base font-bold text-white transition hover:-translate-y-0.5 hover:border-white/60">Criar Conta Grátis</button>}</div></div></section>
    </main>
  );
}

/* ═══════════════ LOGIN HISTORY ═══════════════ */
function getLoginHistory(): { email: string; name: string }[] {
  try { const s = localStorage.getItem("ep-login-history"); return s ? JSON.parse(s) : []; } catch { return []; }
}
function addLoginHistory(email: string, name: string) {
  const list = getLoginHistory().filter((x) => x.email !== email);
  list.unshift({ email, name });
  localStorage.setItem("ep-login-history", JSON.stringify(list.slice(0, 10)));
}

/* ═══════════════ AUTH PAGES ═══════════════ */
function LoginPage({ setPage, redirectTo }: { setPage: (p: Page) => void; redirectTo?: Page }) {
  const { login, user } = useAuth();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [show, setShow] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history] = useState(() => getLoginHistory());

  useEffect(() => { if (user && redirectTo) setPage(redirectTo); }, [user, redirectTo, setPage]);

  const pickAccount = (h: { email: string }) => {
    setEmail(h.email);
    setShowHistory(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (!email || !pw) { setErr("Preencha todos os campos."); return; }
    const r = login(email, pw);
    if (r) { setErr(r); return; }
    // Save to login history
    try {
      const users: User[] = JSON.parse(localStorage.getItem("ep-users") || "[]");
      const found = users.find((u) => u.email === email);
      if (found) addLoginHistory(found.email, found.name);
    } catch { /* */ }
    setPage(redirectTo || "gerador");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const ic = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#c43a3a] focus:ring-2 focus:ring-red-100 dark:border-white/10 dark:bg-white/5 dark:text-white";

  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-[#fff7f6] px-5 py-16 dark:bg-[#130c0d]">
      <div className="w-full max-w-md">
        <div className="text-center">
          <LogoMark />
          <h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Entrar na sua conta</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Acesse o gerador de recibos e o histórico.</p>
          {redirectTo && !user && (
            <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              🔒 Faça login para aceder ao {redirectTo === "gerador" ? "Gerador" : "Histórico"}.
            </div>
          )}
        </div>

      











        {/* Previous logins */}
        {history.length > 0 && !email && (
          <div className="mt-6">
            <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Logins anteriores</p>
            <div className="space-y-2">
              {history.map((h) => (
                <button key={h.email} type="button" onClick={() => pickAccount(h)} className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-[#c43a3a] hover:shadow-sm dark:border-white/10 dark:bg-white/5 dark:hover:border-red-400">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-black text-[#b93636] dark:bg-red-950 dark:text-red-200">{h.name.charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{h.name}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{h.email}</p>
                  </div>
                  <span className="text-xs text-[#c43a3a] font-bold dark:text-red-300">Entrar →</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setShowHistory(!showHistory)} className="mt-3 w-full text-center text-xs font-bold text-slate-500 hover:text-[#c43a3a] dark:text-slate-400 dark:hover:text-red-300">
              Usar outro email
            </button>
          </div>
        )}

        <form onSubmit={submit} className="mt-6 space-y-5">
          {err && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{err}</div>}
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={ic} placeholder="seu@email.com" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Senha</label>
            <div className="relative">
              <input type={show ? "text" : "password"} value={pw} onChange={(e) => setPw(e.target.value)} className={ic + " pr-14"} placeholder="••••••" />
              <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{show ? "OCULTAR" : "VER"}</button>
            </div>
          </div>
          <button type="submit" className="w-full rounded-xl bg-[#c43a3a] py-4 text-sm font-black text-white shadow-lg transition hover:bg-[#ab3030]">Entrar</button>
        </form>
        <p className="mt-8 text-center text-sm text-slate-600 dark:text-slate-400">
          Não tem conta?{" "}
          <button type="button" onClick={() => { setPage("register"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="font-bold text-[#c43a3a] hover:underline dark:text-red-300">Criar conta grátis</button>
        </p>
      </div>
    </main>
  );
}

function RegisterPage({ setPage }: { setPage: (p: Page) => void }) {
  const { register } = useAuth(); const [name, sN] = useState(""); const [store, sS] = useState(""); const [email, sE] = useState(""); const [pw, sP] = useState(""); const [pw2, sP2] = useState(""); const [err, sErr] = useState(""); const [show, sShow] = useState(false);
  const submit = (e: FormEvent) => { e.preventDefault(); sErr(""); if (!name || !email || !pw || !store) { sErr("Preencha todos os campos."); return; } if (pw.length < 4) { sErr("Senha mínima: 4 caracteres."); return; } if (pw !== pw2) { sErr("Senhas não coincidem."); return; } const r = register({ name, email, password: pw, storeName: store }); if (r) { sErr(r); return; } addLoginHistory(email, name); setPage("gerador"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const ic = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-sm text-slate-900 outline-none transition focus:border-[#c43a3a] focus:ring-2 focus:ring-red-100 dark:border-white/10 dark:bg-white/5 dark:text-white";
  return (
    <main className="flex min-h-[80vh] items-center justify-center bg-[#fff7f6] px-5 py-16 dark:bg-[#130c0d]"><div className="w-full max-w-md"><div className="text-center"><LogoMark /><h1 className="mt-6 text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Criar conta grátis</h1><p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Comece a emitir recibos profissionais.</p></div>
      <form onSubmit={submit} className="mt-8 space-y-4">{err && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 dark:bg-red-950/30 dark:text-red-300">{err}</div>}<div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Nome *</label><input value={name} onChange={(e) => sN(e.target.value)} className={ic} placeholder="João" /></div><div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Loja *</label><input value={store} onChange={(e) => sS(e.target.value)} className={ic} placeholder="WebBazar" /></div></div><div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Email *</label><input type="email" value={email} onChange={(e) => sE(e.target.value)} className={ic} placeholder="seu@email.com" /></div><div className="grid gap-4 sm:grid-cols-2"><div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Senha *</label><div className="relative"><input type={show ? "text" : "password"} value={pw} onChange={(e) => sP(e.target.value)} className={ic + " pr-14"} placeholder="••••" /><button type="button" onClick={() => sShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">{show ? "OCULTAR" : "VER"}</button></div></div><div><label className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Confirmar *</label><input type={show ? "text" : "password"} value={pw2} onChange={(e) => sP2(e.target.value)} className={ic} placeholder="••••" /></div></div><button type="submit" className="w-full rounded-xl bg-[#c43a3a] py-4 text-sm font-black text-white shadow-lg transition hover:bg-[#ab3030]">Criar Conta</button></form>
      <p className="mt-8 text-center text-sm text-slate-600 dark:text-slate-400">Já tem conta? <button type="button" onClick={() => { setPage("login"); window.scrollTo({ top: 0, behavior: "smooth" }); }} className="font-bold text-[#c43a3a] hover:underline dark:text-red-300">Fazer login</button></p></div></main>
  );
}











































/* ═══════════════ GERADOR ═══════════════ */
function GeradorPage() {
  const { user } = useAuth();
  const [r, setR] = useState<ReceiptData>(() => ({ ...defaultReceipt(), storeName: user?.storeName || "WebBazar", storeInitials: (user?.storeName || "WB").slice(0, 2).toUpperCase() }));
  const [fmt, setFmt] = useState<PdfFormat>("A6");
  const [saved, setSaved] = useState(false);
  const [genPdf, setGenPdf] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const fmts: PdfFormat[] = ["A6", "A7", "A8", "round"];

  const subtotal = useMemo(() => r.products.reduce((s, p) => s + p.price * p.qty, 0), [r.products]);
  const total = useMemo(() => subtotal + r.shippingCost, [subtotal, r.shippingCost]);

  const upd = useCallback(<K extends keyof ReceiptData>(k: K, v: ReceiptData[K]) => { setR((p) => ({ ...p, [k]: v })); setSaved(false); }, []);

  const updProd = useCallback((id: number, f: keyof ProductItem, v: string | number) => {
    setR((prev) => {
      const products = prev.products.map((p) => {
        if (p.id !== id) return p;
        const updated = { ...p, [f]: v };
        if (f === "name" && prev.autoSku && typeof v === "string") updated.sku = genSku(v);
        return updated;
      });
      return { ...prev, products };
    });
    setSaved(false);
  }, []);

  const addProd = useCallback(() => setR((p) => ({ ...p, products: [...p.products, { id: Date.now(), name: "", sku: "", qty: 1, price: 0, weight: "" }] })), []);
  const rmProd = useCallback((id: number) => setR((p) => ({ ...p, products: p.products.filter((x) => x.id !== id) })), []);

  // Finalize receipt data for output
  const finalize = useCallback((): ReceiptData => {
    let data = { ...r };
    if (data.autoTrack && !data.trackingCode) {
      data = { ...data, trackingCode: genTrackingCode(data.storeInitials) };
      setR(data);
    }
    return data;
  }, [r]);

  const handleSave = useCallback(() => {
    if (!user) return;
    const data = finalize();
    saveReceiptToHistory(user.email, data, fmt);
    setSaved(true); setTimeout(() => setSaved(false), 3000);
  }, [user, finalize, fmt]);

  const handlePrint = useCallback(() => {
    if (!previewRef.current) return;
    const data = finalize();
    if (user) saveReceiptToHistory(user.email, data, fmt);
    // Clone the receipt HTML including inline styles
    const receiptHtml = previewRef.current.innerHTML;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Recibo - ${data.clientName || "Cliente"}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet"/>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter','Segoe UI',sans-serif;background:#fff;display:flex;justify-content:center;align-items:flex-start;padding:8mm;min-height:100vh}@media print{body{padding:0}@page{margin:3mm;size:auto}}img{max-width:100%}table{border-collapse:collapse}</style>
</head><body>${receiptHtml}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 600);
  }, [finalize, user, fmt]);

  const [pdfName, setPdfName] = useState("");

  const doPdf = useCallback(async (): Promise<Blob | null> => {
    if (!previewRef.current) return null;
    const data = finalize();
    if (user) saveReceiptToHistory(user.email, data, fmt);
    setGenPdf(true);
    const name = pdfName.trim() || `recibo-${data.clientName.split(" ")[0] || "cliente"}-${data.trackingCode || Date.now()}-${fmt}`;
    try {
      const receiptEl = previewRef.current.firstElementChild as HTMLElement;
      if (receiptEl) return await generatePdfFromElement(receiptEl, fmt, name);
      return null;
    } finally { setGenPdf(false); }
  }, [finalize, user, fmt, pdfName]);

  const handlePdf = useCallback(async () => { await doPdf(); }, [doPdf]);

  const ic = "w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-[#c43a3a] focus:ring-2 focus:ring-red-100 dark:border-white/10 dark:bg-white/5 dark:text-white dark:focus:border-red-400";
  const lc = "mb-1.5 block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400";

  return (
    <main className="bg-slate-50 px-5 py-10 sm:px-8 lg:px-10 dark:bg-[#0a0c10]">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Gerar Recibo</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Preencha, visualize e exporte. Subtotal e total são calculados automaticamente.</p></div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-bold uppercase text-slate-400">Formato PDF:</span>
            <div className="inline-flex rounded-full bg-white p-1 shadow-sm ring-1 ring-slate-200 dark:bg-white/5 dark:ring-white/10">
              {fmts.map((f) => <button key={f} type="button" onClick={() => setFmt(f)} className={`rounded-full px-4 py-2 text-xs font-bold transition ${fmt === f ? "bg-[#c43a3a] text-white shadow" : "text-slate-600 hover:text-[#b93636] dark:text-slate-300"}`}>{f === "round" ? "Redondo" : f}</button>)}
            </div>
          </div>
        </div>

        <div className="grid items-start gap-10 xl:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            {/* Store */}
            <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <legend className="px-2 text-sm font-black uppercase tracking-wider text-[#b93636] dark:text-red-300">Loja & Marca</legend>
              <div className="mt-2 grid gap-4 sm:grid-cols-4">
                <div><label className={lc}>Sigla (logo)</label><input maxLength={4} value={r.storeInitials} onChange={(e) => upd("storeInitials", e.target.value.toUpperCase())} className={ic + " text-center text-lg font-black"} placeholder="WB" /></div>
                <div><label className={lc}>Nome da Loja</label><input value={r.storeName} onChange={(e) => upd("storeName", e.target.value)} className={ic} /></div>
                <div><label className={lc}>Slogan</label><input value={r.storeSlogan} onChange={(e) => upd("storeSlogan", e.target.value)} className={ic} /></div>
                <div><label className={lc}>URL da loja (QR)</label><input value={r.storeUrl} onChange={(e) => upd("storeUrl", e.target.value)} className={ic} placeholder="https://webbazar.co.mz" /></div>
              </div>
            </fieldset>

            {/* Client */}
            <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <legend className="px-2 text-sm font-black uppercase tracking-wider text-[#b93636] dark:text-red-300">Destinatário</legend>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div><label className={lc}>Nome</label><input value={r.clientName} onChange={(e) => upd("clientName", e.target.value)} className={ic} placeholder="Cliente" /></div>
                <div><label className={lc}>Email</label><input value={r.clientEmail} onChange={(e) => upd("clientEmail", e.target.value)} className={ic} placeholder="email@exemplo.mz" /></div>
                <div><label className={lc}>Local</label><input value={r.clientCity} onChange={(e) => upd("clientCity", e.target.value)} className={ic} placeholder="Maputo" /></div>
                <div><label className={lc}>Endereço</label><input value={r.clientAddress} onChange={(e) => upd("clientAddress", e.target.value)} className={ic} placeholder="Bairro, Q. 12, Casa 45" /></div>
                <div><label className={lc}>Contacto 1</label><input value={r.clientPhone1} onChange={(e) => upd("clientPhone1", e.target.value)} className={ic} placeholder="84 123 4567" /></div>
                <div><label className={lc}>Contacto 2</label><input value={r.clientPhone2} onChange={(e) => upd("clientPhone2", e.target.value)} className={ic} placeholder="87 123 4567" /></div>
                <div className="sm:col-span-2"><label className={lc}>Ponto de Referência</label><input value={r.clientRef} onChange={(e) => upd("clientRef", e.target.value)} className={ic} placeholder="Próximo ao Restaurante Piri-Piri, frente à Farmácia 24h" /></div>
              </div>
            </fieldset>

            {/* Products */}
            <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <legend className="px-2 text-sm font-black uppercase tracking-wider text-[#b93636] dark:text-red-300">Produtos</legend>
              <div className="mt-1 mb-3 flex items-center gap-4">
                <label className="flex cursor-pointer items-center gap-2 text-xs font-bold text-slate-500 dark:text-slate-400"><input type="checkbox" checked={r.autoSku} onChange={(e) => upd("autoSku", e.target.checked)} className="accent-[#c43a3a]" /> Gerar SKU automaticamente</label>
              </div>
              <div className="space-y-4">
                {r.products.map((p, idx) => (
                  <div key={p.id} className="relative grid gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-[1fr_100px_60px_90px_90px] dark:border-white/5 dark:bg-white/[0.02]">
                    <div><label className={lc}>Produto {idx + 1}</label><input value={p.name} onChange={(e) => updProd(p.id, "name", e.target.value)} className={ic} placeholder="Samsung Galaxy A54" /></div>
                    <div><label className={lc}>SKU</label><input value={p.sku} onChange={(e) => updProd(p.id, "sku", e.target.value)} className={ic} placeholder="SAM-G54" disabled={r.autoSku} /></div>
                    <div><label className={lc}>QTD</label><input type="number" min={1} value={p.qty} onChange={(e) => updProd(p.id, "qty", Math.max(1, parseInt(e.target.value) || 1))} className={ic} /></div>
                    <div><label className={lc}>Preço (MT)</label><input type="number" min={0} step="0.01" value={p.price || ""} onChange={(e) => updProd(p.id, "price", Math.max(0, parseFloat(e.target.value) || 0))} className={ic} placeholder="4500" /></div>
                    <div><label className={lc}>Peso <span className="normal-case font-normal text-slate-400">(opc.)</span></label><input value={p.weight} onChange={(e) => updProd(p.id, "weight", e.target.value)} className={ic} placeholder="0.4kg" /></div>
                    {r.products.length > 1 && <button type="button" onClick={() => rmProd(p.id)} className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-600 shadow hover:bg-red-200 dark:bg-red-900/50 dark:text-red-200">✕</button>}
                  </div>
                ))}
                <button type="button" onClick={addProd} className="inline-flex items-center gap-2 rounded-full border border-dashed border-slate-300 px-5 py-2.5 text-sm font-bold text-slate-600 transition hover:border-[#c43a3a] hover:text-[#c43a3a] dark:border-white/15 dark:text-slate-300"><span className="text-lg">+</span> Adicionar Produto</button>
              </div>
            </fieldset>

            {/* Shipping & tracking */}
            <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <legend className="px-2 text-sm font-black uppercase tracking-wider text-[#b93636] dark:text-red-300">Frete & Rastreio</legend>
              <div className="mt-2 grid gap-4 sm:grid-cols-2">
                <div><label className={lc}>Frete (MT)</label><input type="number" min={0} step="0.01" value={r.shippingCost || ""} onChange={(e) => upd("shippingCost", Math.max(0, parseFloat(e.target.value) || 0))} className={ic} placeholder="0,00" /></div>
                <div>
                  <label className={lc}>Código de Rastreio</label>
                  <div className="flex gap-2">
                    <input value={r.trackingCode} onChange={(e) => { upd("trackingCode", e.target.value); upd("autoTrack", false); }} className={ic} placeholder={r.autoTrack ? "Gerado automaticamente" : "WBTRK-XXXXX"} disabled={r.autoTrack} />
                    <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs font-bold text-slate-500 dark:text-slate-400"><input type="checkbox" checked={r.autoTrack} onChange={(e) => { upd("autoTrack", e.target.checked); if (e.target.checked) upd("trackingCode", ""); }} className="accent-[#c43a3a]" /> Auto</label>
                  </div>
                </div>
              </div>
              {/* Auto-computed display */}
              <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-4 dark:bg-white/[0.02]">
                <div className="text-center"><p className="text-xs font-bold uppercase text-slate-400">Subtotal</p><p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{fmtMT(subtotal)} MT</p></div>
                <div className="text-center"><p className="text-xs font-bold uppercase text-slate-400">Frete</p><p className="mt-1 text-lg font-black text-red-600 dark:text-red-400">{fmtMT(r.shippingCost)} MT</p></div>
                <div className="text-center"><p className="text-xs font-bold uppercase text-slate-400">Total</p><p className="mt-1 text-lg font-black text-slate-900 dark:text-white">{fmtMT(total)} MT</p></div>
              </div>
            </fieldset>

            {/* Message */}
            <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <legend className="px-2 text-sm font-black uppercase tracking-wider text-[#b93636] dark:text-red-300">Mensagem</legend>
              <div className="mt-2"><label className={lc}>Agradecimento</label><textarea value={r.thankYouMsg} onChange={(e) => upd("thankYouMsg", e.target.value)} rows={3} className={ic + " resize-none"} /></div>
            </fieldset>

            {/* PDF filename */}
            <fieldset className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
              <legend className="px-2 text-sm font-black uppercase tracking-wider text-[#b93636] dark:text-red-300">Exportar</legend>
              <div className="mt-2">
                <label className={lc}>Nome do ficheiro PDF (opcional)</label>
                <input value={pdfName} onChange={(e) => setPdfName(e.target.value)} className={ic} placeholder={`recibo-${r.clientName.split(" ")[0] || "cliente"}-${fmt}`} />
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={handlePdf} disabled={genPdf} className="inline-flex items-center gap-2 rounded-full bg-[#c43a3a] px-7 py-3.5 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-[#ab3030] disabled:opacity-60">{genPdf ? "⏳ Gerando..." : `📄 Gerar Recibo & Baixar PDF (${fmt})`}</button>
                <button type="button" onClick={handlePrint} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3 text-sm font-bold text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"><PrinterIcon className="h-4 w-4" /> Imprimir</button>
                <button type="button" onClick={handleSave} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-6 py-3 text-sm font-bold text-slate-700 transition hover:border-[#c43a3a] hover:text-[#c43a3a] dark:border-white/15 dark:text-slate-200">{saved ? "✓ Salvo!" : "💾 Salvar"}</button>
              </div>
            </fieldset>
          </div>

          {/* PREVIEW */}
          <div className="sticky top-24">
            <p className="mb-3 text-center text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">Pré-visualização — {fmt === "round" ? "Redondo" : fmt}</p>
            <div className="flex justify-center overflow-hidden rounded-[1.5rem] bg-[#1a1a1e] p-5 shadow-2xl shadow-slate-950/25 ring-1 ring-slate-800 sm:p-7">
              <div ref={previewRef}>
                <ReceiptPreview receipt={r} subtotal={subtotal} total={total} format={fmt} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

/* ═══════════════ RECEIPT PREVIEW ═══════════════ */

const FMT_W: Record<PdfFormat, number> = { A6: 340, A7: 270, A8: 210, round: 340 };

function ReceiptPreview({ receipt: r, subtotal, total, format = "A6" }: { receipt: ReceiptData; subtotal: number; total: number; format?: PdfFormat }) {
  const [qrUrl, setQrUrl] = useState("");
  const [barcodeUrl, setBarcodeUrl] = useState("");
  const trackCode = r.trackingCode || (r.autoTrack ? genTrackingCode(r.storeInitials) : "");
  const baseW = FMT_W[format];
  const isRound = format === "round";
  const sc = baseW / 340;
  const contentRef = useRef<HTMLDivElement>(null);
  const [roundScale, setRoundScale] = useState(1);

  useEffect(() => {
    if (r.storeUrl) QRCode.toDataURL(r.storeUrl, { width: 400, margin: 1, errorCorrectionLevel: "H", color: { dark: "#000000", light: "#ffffff" } }).then(setQrUrl).catch(() => setQrUrl(""));
    else setQrUrl("");
  }, [r.storeUrl]);

  useEffect(() => {
    if (trackCode) { try { setBarcodeUrl(renderBarcodeToDataURL(trackCode, 500, 80)); } catch { setBarcodeUrl(""); } }
    else setBarcodeUrl("");
  }, [trackCode]);

  // Auto-scale content to fit inside the inscribed square of the circle
  useEffect(() => {
    if (!isRound || !contentRef.current) { setRoundScale(1); return; }
    const el = contentRef.current;
    // Need to measure at scale=1 first
    el.style.transform = "none";
    requestAnimationFrame(() => {
      const contentH = el.scrollHeight;
      const contentW = el.scrollWidth;
      const diameter = baseW;
      // Inscribed square side = diameter / √2 ≈ 0.707
      const maxSide = diameter * 0.7;
      const scaleH = maxSide / contentH;
      const scaleW = maxSide / contentW;
      const s = Math.min(scaleH, scaleW, 1);
      setRoundScale(Math.max(0.28, s));
      el.style.transform = `scale(${Math.max(0.28, s)})`;
    });
  }, [isRound, baseW, r, subtotal, total]);

  const fs = (s: number) => Math.max(5, s * sc);

  const outerStyle: React.CSSProperties = isRound ? {
    width: baseW, height: baseW, borderRadius: "50%", overflow: "hidden",
    fontFamily: "'Inter','Segoe UI',sans-serif", background: "#fff",
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "2px solid #e5e5e5",
  } : {
    width: baseW, fontFamily: "'Inter','Segoe UI',sans-serif", background: "#fff",
  };

  const innerPad = isRound ? `0 ${10 * sc}px` : `${18 * sc}px ${16 * sc}px`;

  // The receipt content — same structure for all formats
  const content = (
    <div ref={contentRef} style={{ padding: innerPad, fontSize: Math.max(7, 11 * sc), lineHeight: 1.55, color: "#000", transform: isRound ? `scale(${roundScale})` : undefined, transformOrigin: "center center", width: isRound ? baseW : undefined }}>
      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 4 * sc }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, flex: 1, minWidth: 0 }}>
          {/* BIG Initials */}
          <div style={{ fontSize: fs(28), fontWeight: 900, color: "#000", letterSpacing: "-0.03em", lineHeight: 1, paddingRight: 8 * sc, flexShrink: 0 }}>{r.storeInitials || "WB"}</div>
          {/* Vertical line */}
          <div style={{ width: 2, alignSelf: "stretch", background: "#c0c0c0", flexShrink: 0, minHeight: 30 * sc, marginRight: 8 * sc }} />
          {/* Name + slogan centered */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: fs(17), fontWeight: 900, lineHeight: 1.1 }}>{r.storeName || "Loja"}</p>
            <p style={{ fontSize: fs(5.5), textTransform: "uppercase", letterSpacing: "0.08em", color: "#888", lineHeight: 1.3, marginTop: 1 }}>{r.storeSlogan}</p>
          </div>
        </div>
        {/* QR */}
        {qrUrl ? (
          <div style={{ flexShrink: 0, textAlign: "center" }}>
            <img src={qrUrl} alt="QR" style={{ width: 44 * sc, height: 44 * sc, display: "block" }} />
            <p style={{ fontSize: fs(4.5), color: "#aaa", marginTop: 1 }}>(Acesse o site)</p>
          </div>
        ) : (
          <div style={{ width: 44 * sc, height: 44 * sc, border: "1px dashed #ccc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: fs(5), color: "#bbb", flexShrink: 0 }}>QR</div>
        )}
      </div>

      <div style={{ borderTop: "1.5px solid #ccc", margin: `${8 * sc}px 0` }} />

      {/* ── DESTINATÁRIO ── */}
      <div style={{ background: "#1e1e1e", padding: `${3 * sc}px ${8 * sc}px`, marginBottom: 5 * sc }}>
        <span style={{ fontSize: fs(7.5), fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.15em", color: "#fff" }}>Destinatário</span>
      </div>
      <div style={{ paddingLeft: 3 * sc, fontSize: fs(9.5), lineHeight: 1.7 }}>
        <p><b>NOME:</b> {r.clientName || "Cliente"}</p>
        <p><b>EMAIL:</b> {r.clientEmail || "-"}</p>
        <p><b>LOCAL:</b> {r.clientCity || "-"}</p>
        <p><b>ENDEREÇO:</b> {r.clientAddress || "-"}</p>
      </div>
      {/* Client phones */}
      {(r.clientPhone1 || r.clientPhone2) && (
        <div style={{ display: "flex", gap: 6 * sc, marginTop: 4 * sc, paddingLeft: 3 * sc }}>
          {r.clientPhone1 && (
            <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: `${2 * sc}px ${6 * sc}px`, flex: 1, fontSize: fs(9), fontWeight: 800 }}>
              📞 {r.clientPhone1}
            </div>
          )}
          {r.clientPhone2 && (
            <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: `${2 * sc}px ${6 * sc}px`, flex: 1, fontSize: fs(9), fontWeight: 800 }}>
              📞 {r.clientPhone2}
            </div>
          )}
        </div>
      )}
      {/* Reference point */}
      {r.clientRef && (
        <div style={{ margin: `${5 * sc}px 0 ${3 * sc}px`, padding: `${3 * sc}px ${6 * sc}px`, border: "1px dashed #bbb", borderRadius: 4, fontSize: fs(8.5), color: "#444" }}>
          <span style={{ marginRight: 3 }}>📍</span><b>REF:</b> {r.clientRef}
        </div>
      )}

      {/* ── PRODUCTS TABLE ── */}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 * sc, fontSize: fs(9) }}>
        <thead>
          <tr style={{ border: "1px solid #999", background: "#f5f5f5" }}>
            <th style={{ borderRight: "1px solid #999", padding: `${3 * sc}px ${4 * sc}px`, textAlign: "left", fontSize: fs(8), fontWeight: 700 }}>PRODUTO (SKU)</th>
            <th style={{ borderRight: "1px solid #999", padding: `${2 * sc}px`, textAlign: "center", fontSize: fs(8), fontWeight: 700, width: "10%" }}>QTD</th>
            <th style={{ borderRight: "1px solid #999", padding: `${2 * sc}px`, textAlign: "right", fontSize: fs(8), fontWeight: 700, width: "22%" }}>P. UN</th>
            <th style={{ padding: `${2 * sc}px ${4 * sc}px`, textAlign: "right", fontSize: fs(8), fontWeight: 700, width: "22%" }}>P. TOT</th>
          </tr>
        </thead>
        <tbody>
          {r.products.map((p) => (
            <tr key={p.id} style={{ borderLeft: "1px solid #999", borderRight: "1px solid #999", borderBottom: "1px solid #999" }}>
              <td style={{ borderRight: "1px solid #999", padding: `${2.5 * sc}px ${4 * sc}px` }}>{p.name || "—"}{p.sku ? ` (${p.sku})` : ""}</td>
              <td style={{ borderRight: "1px solid #999", padding: `${2.5 * sc}px`, textAlign: "center" }}>{String(p.qty).padStart(2, "0")}</td>
              <td style={{ borderRight: "1px solid #999", padding: `${2.5 * sc}px`, textAlign: "right" }}>{fmtMT(p.price)} MT</td>
              <td style={{ padding: `${2.5 * sc}px ${4 * sc}px`, textAlign: "right" }}>{fmtMT(p.price * p.qty)} MT</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ── TOTALS ── */}
      <div style={{ marginTop: 10 * sc, fontSize: fs(10) }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: `${2 * sc}px ${3 * sc}px` }}><span>Subtotal pago:</span><span style={{ fontWeight: 700 }}>{fmtMT(subtotal)} MT</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: `${2 * sc}px ${3 * sc}px` }}><b>(+) Valor a pagar do frete na entrega:</b><span style={{ fontWeight: 700, color: "#dc2626" }}>{fmtMT(r.shippingCost)} MT</span></div>
        <div style={{ display: "flex", justifyContent: "space-between", background: "#1e1e1e", color: "#fff", fontWeight: 900, padding: `${4 * sc}px ${8 * sc}px`, fontSize: fs(11.5), marginTop: 2 * sc }}><span>TOTAL DO PEDIDO:</span><span>{fmtMT(total)} MT</span></div>
      </div>

      {/* ── THANK YOU ── */}
      <div style={{ margin: `${10 * sc}px ${4 * sc}px 0`, border: "1px solid #e5e5e5", background: "#fafafa", borderRadius: 4, padding: `${6 * sc}px`, textAlign: "center", fontSize: fs(8.5), lineHeight: 1.55 }}>
        <p><b style={{ fontStyle: "italic" }}>{(r.clientName || "Cliente").split(" ")[0]}</b>{r.thankYouMsg}</p>
        <p style={{ fontWeight: 900, fontStyle: "italic", marginTop: 2 * sc }}>Equipe {r.storeName}</p>
      </div>

      {/* ── BARCODE ── */}
      {!isRound && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 12 * sc }}>
          {barcodeUrl ? (
            <img src={barcodeUrl} alt="Barcode" style={{ width: Math.min(220 * sc, baseW - 60), height: 36 * sc }} />
          ) : (
            <div style={{ width: 180 * sc, height: 28 * sc, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: fs(7), color: "#aaa" }}>Código de barras</div>
          )}
          <p style={{ fontWeight: 700, letterSpacing: "0.12em", color: "#666", fontSize: fs(7.5), marginTop: 4 * sc }}>RASTREIO: {trackCode || "—"}</p>
        </div>
      )}
    </div>
  );

  return <div style={outerStyle}>{content}</div>;
}

/* ═══════════════ HISTORICO ═══════════════ */
function HistoricoPage({ setPage }: { setPage: (p: Page) => void }) {
  const { user } = useAuth();
  const [list, setList] = useState<SavedReceipt[]>([]);
  const [exp, setExp] = useState<number | null>(null);
  useEffect(() => { if (user) setList(getSavedReceipts(user.email)); }, [user]);
  const del = (id: number) => { if (!user) return; deleteReceiptFromHistory(user.email, id); setList(getSavedReceipts(user.email)); };
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const hiddenRef = useRef<HTMLDivElement>(null);
  const [pdfTarget, setPdfTarget] = useState<SavedReceipt | null>(null);

  // When pdfTarget is set, we wait a tick for the hidden receipt to render, then capture it
  useEffect(() => {
    if (!pdfTarget || !hiddenRef.current) return;
    const el = hiddenRef.current.firstElementChild as HTMLElement;
    if (!el) return;
    const timer = setTimeout(async () => {
      await generatePdfFromElement(el, pdfTarget.pdfFormat, `recibo-${pdfTarget.receipt.clientName.split(" ")[0] || "cliente"}-${pdfTarget.receipt.trackingCode || pdfTarget.id}`);
      setPdfTarget(null);
    }, 500); // allow QR/barcode images to render
    return () => clearTimeout(timer);
  }, [pdfTarget]);

  const rePdf = (sr: SavedReceipt) => { setPdfTarget(sr); };

  const [sharing, setSharing] = useState<number | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const [shareTarget, setShareTarget] = useState<SavedReceipt | null>(null);

  const shareReceipt = (sr: SavedReceipt) => {
    setSharing(sr.id);
    setShareTarget(sr);
  };

  // When shareTarget renders, capture and share
  useEffect(() => {
    if (!shareTarget || !shareRef.current) return;
    const el = shareRef.current.firstElementChild as HTMLElement;
    if (!el) return;
    const timer = setTimeout(async () => {
      try {
        const d = shareTarget.receipt;
        const sub = d.products.reduce((s, p) => s + p.price * p.qty, 0);
        const tot = sub + d.shippingCost;
        const fName = `recibo-${d.clientName.split(" ")[0] || "cliente"}-${d.trackingCode || shareTarget.id}`;
        const blob = await generatePdfFromElement(el, shareTarget.pdfFormat, fName);
        const file = new File([blob], `${fName}.pdf`, { type: "application/pdf" });
        const text = `📄 Recibo ${d.storeName}\n👤 Cliente: ${d.clientName}\n💰 Total: ${fmtMT(tot)} MT\n📦 Rastreio: ${d.trackingCode || "—"}`;

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ title: `Recibo - ${d.clientName}`, text, files: [file] });
        } else if (navigator.share) {
          await navigator.share({ title: `Recibo - ${d.clientName}`, text });
        } else {
          // Fallback: download the PDF + copy text
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `${fName}.pdf`; a.click();
          URL.revokeObjectURL(url);
          try { await navigator.clipboard.writeText(text); } catch { /* */ }
          alert("PDF descarregado e dados copiados!");
        }
      } catch { /* user cancelled share */ }
      setSharing(null);
      setShareTarget(null);
    }, 600);
    return () => clearTimeout(timer);
  }, [shareTarget]);

  return (
    <main className="min-h-[80vh] bg-slate-50 px-5 py-10 sm:px-8 lg:px-10 dark:bg-[#0a0c10]"><div className="mx-auto max-w-5xl">
      <div className="mb-10 flex items-center justify-between"><div><h1 className="text-3xl font-bold tracking-tight text-slate-950 dark:text-white">Histórico</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{list.length} recibo{list.length !== 1 ? "s" : ""}</p></div><button type="button" onClick={() => go("gerador")} className="inline-flex items-center gap-2 rounded-full bg-[#c43a3a] px-6 py-3 text-sm font-bold text-white shadow-md transition hover:-translate-y-0.5 hover:bg-[#ab3030]">+ Novo Recibo</button></div>
      {list.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white py-20 text-center dark:border-white/10 dark:bg-white/[0.02]"><span className="text-5xl">📄</span><p className="mt-4 text-lg font-bold text-slate-700 dark:text-slate-300">Nenhum recibo</p><button type="button" onClick={() => go("gerador")} className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#c43a3a] px-6 py-3 text-sm font-bold text-white">Gerar Recibo <ArrowRightIcon className="h-4 w-4" /></button></div>
      ) : (
        <div className="space-y-3">{list.map((sr) => (
          <div key={sr.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <button type="button" onClick={() => setExp(exp === sr.id ? null : sr.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.02]">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-base dark:bg-red-950/30">🧾</span>
              <div className="min-w-0 flex-1"><p className="truncate font-bold text-slate-900 dark:text-white">{sr.receipt.clientName || "Sem nome"}</p><p className="mt-0.5 text-xs text-slate-500">{fmtMT(sr.receipt.products.reduce((s, p) => s + p.price * p.qty, 0) + sr.receipt.shippingCost)} MT • {sr.receipt.products.length} item(s) • {sr.pdfFormat}</p></div>
              <span className="text-xs font-medium text-slate-400">{sr.date}</span>
              <svg className={`h-5 w-5 shrink-0 text-slate-400 transition ${exp === sr.id ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" /></svg>
            </button>
            {exp === sr.id && (
              <div className="border-t border-slate-100 px-5 pb-5 pt-4 dark:border-white/5">
                <div className="grid gap-2 text-sm sm:grid-cols-3 mb-4"><div><span className="text-xs font-bold uppercase text-slate-400">Loja</span><p className="text-slate-800 dark:text-slate-200">{sr.receipt.storeName}</p></div><div><span className="text-xs font-bold uppercase text-slate-400">Rastreio</span><p className="font-mono text-slate-800 dark:text-slate-200">{sr.receipt.trackingCode || "—"}</p></div><div><span className="text-xs font-bold uppercase text-slate-400">Frete</span><p className="text-red-600 dark:text-red-400">{fmtMT(sr.receipt.shippingCost)} MT</p></div></div>
                {/* Receipt preview */}
                <div className="mb-4 flex justify-center overflow-auto rounded-xl bg-[#1a1a1e] p-4">
                  <ReceiptPreview receipt={sr.receipt} subtotal={sr.receipt.products.reduce((s, p) => s + p.price * p.qty, 0)} total={sr.receipt.products.reduce((s, p) => s + p.price * p.qty, 0) + sr.receipt.shippingCost} format={sr.pdfFormat} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => rePdf(sr)} className="inline-flex items-center gap-2 rounded-full bg-[#c43a3a] px-5 py-2.5 text-xs font-bold text-white transition hover:bg-[#ab3030]">📄 Baixar PDF</button>
                  <button type="button" onClick={() => shareReceipt(sr)} disabled={sharing === sr.id} className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-60">{sharing === sr.id ? "⏳ Preparando..." : "📤 Partilhar"}</button>
                  <button type="button" onClick={() => del(sr.id)} className="inline-flex items-center gap-2 rounded-full border border-red-200 px-5 py-2.5 text-xs font-bold text-red-600 transition hover:bg-red-50 dark:border-red-900/40 dark:text-red-400">Eliminar</button>
                </div>
              </div>
            )}
          </div>
        ))}</div>
      )}
    </div>
    {/* Hidden receipt for PDF generation */}
    {pdfTarget && (
      <div style={{ position: "absolute", left: -9999, top: 0 }} ref={hiddenRef}>
        <ReceiptPreview receipt={pdfTarget.receipt} subtotal={pdfTarget.receipt.products.reduce((s, p) => s + p.price * p.qty, 0)} total={pdfTarget.receipt.products.reduce((s, p) => s + p.price * p.qty, 0) + pdfTarget.receipt.shippingCost} format={pdfTarget.pdfFormat} />
      </div>
    )}
    {/* Hidden receipt for sharing */}
    {shareTarget && (
      <div style={{ position: "absolute", left: -9999, top: 0 }} ref={shareRef}>
        <ReceiptPreview receipt={shareTarget.receipt} subtotal={shareTarget.receipt.products.reduce((s, p) => s + p.price * p.qty, 0)} total={shareTarget.receipt.products.reduce((s, p) => s + p.price * p.qty, 0) + shareTarget.receipt.shippingCost} format={shareTarget.pdfFormat} />
      </div>
    )}
    </main>
  );
}

/* ═══════════════ FOOTER ═══════════════ */
function Footer({ setPage }: { setPage: (p: Page) => void }) {
  const [email, setEmail] = useState(""); const [msg, setMsg] = useState("");
  const submit = (e: FormEvent) => { e.preventDefault(); setMsg(email ? "Email registado!" : "Insira um email válido."); };
  const go = (p: Page) => { setPage(p); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <footer className="bg-[#111318] px-5 pt-20 text-white sm:px-8 lg:px-10">
      <div className="mx-auto grid max-w-7xl gap-10 border-b border-white/10 pb-12 md:grid-cols-2 lg:grid-cols-[1.2fr_0.8fr_0.8fr_1.1fr]">
        <div><div className="flex items-center gap-3"><LogoMark /><span className="text-lg font-black tracking-tight">Ecom-Printer</span></div><p className="mt-5 max-w-sm text-sm leading-7 text-slate-300">Simplificar a emissão de recibos térmicos profissionais para qualquer vendedor digital, loja física ou equipa de logística.</p></div>
        <div><h3 className="text-sm font-black uppercase tracking-[0.22em] text-white/70">Links Rápidos</h3><ul className="mt-5 space-y-3">{footerLinks.quick.map((l) => <li key={l}><button type="button" onClick={() => go(l === "Gerar Recibo" ? "gerador" : l === "Histórico" ? "historico" : "home")} className="text-sm text-slate-300 transition hover:text-white">{l}</button></li>)}</ul></div>
        <div><h3 className="text-sm font-black uppercase tracking-[0.22em] text-white/70">Suporte</h3><ul className="mt-5 space-y-3">{footerLinks.support.map((l) => <li key={l}><span className="cursor-pointer text-sm text-slate-300 transition hover:text-white">{l}</span></li>)}</ul></div>
        <div><h3 className="text-sm font-black uppercase tracking-[0.22em] text-white/70">Newsletter</h3><p className="mt-4 text-sm leading-6 text-slate-300">Receba atualizações de novas funcionalidades.</p><form onSubmit={submit} className="mt-5 flex overflow-hidden rounded-full bg-white p-1"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="seu@email.com" className="min-w-0 flex-1 bg-transparent px-4 text-sm text-slate-950 outline-none placeholder:text-slate-400" /><button type="submit" className="rounded-full bg-[#c43a3a] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#ab3030]">Enviar</button></form>{msg && <p className="mt-3 text-sm text-red-100">{msg}</p>}</div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col gap-3 py-7 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between"><p>Copyright 2026, Grupo Webbazar todos os diretos reservados.</p><p>Moçambique para lojas globais.</p></div>
    </footer>
  );
}

/* ═══════════════ DECORATIVE ═══════════════ */
function HeroVisual() { return (<div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true"><div className="hero-plane absolute inset-0" /><svg className="motion-printer absolute bottom-[-7rem] right-[-13rem] hidden h-[720px] w-[980px] text-[#c43a3a] lg:block" viewBox="0 0 980 720" fill="none"><defs><linearGradient id="printerBody" x1="248" y1="312" x2="888" y2="679" gradientUnits="userSpaceOnUse"><stop stopColor="#d84a4a" /><stop offset="1" stopColor="#9f2d2d" /></linearGradient><linearGradient id="receiptGradient" x1="430" y1="54" x2="603" y2="360" gradientUnits="userSpaceOnUse"><stop stopColor="#ffffff" /><stop offset="1" stopColor="#fff1ef" /></linearGradient><filter id="softShadow" x="0" y="0" width="980" height="720" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB"><feDropShadow dx="0" dy="34" stdDeviation="34" floodColor="#7f1d1d" floodOpacity="0.22" /></filter></defs><g className="motion-paper-feed" filter="url(#softShadow)"><path d="M434 56h194c19 0 34 15 34 34v328H400V90c0-19 15-34 34-34Z" fill="url(#receiptGradient)" /><path d="M428 138h206" stroke="#cbd5e1" strokeWidth="10" strokeLinecap="round" /><path d="M428 191h156" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" /><path d="M428 244h198" stroke="#cbd5e1" strokeWidth="10" strokeLinecap="round" /><path d="M428 297h128" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" /><path d="M428 350h184" stroke="#cbd5e1" strokeWidth="10" strokeLinecap="round" /></g><g filter="url(#softShadow)"><path d="M211 394c0-54 44-98 98-98h451c54 0 98 44 98 98v228H211V394Z" fill="url(#printerBody)" /><path d="M283 358h505c21 0 38 17 38 38v23H245v-23c0-21 17-38 38-38Z" fill="#7f1d1d" opacity="0.86" /><path d="M307 458h444" stroke="#fff" strokeOpacity="0.55" strokeWidth="22" strokeLinecap="round" /><path d="M337 526h162" stroke="#fff" strokeOpacity="0.34" strokeWidth="18" strokeLinecap="round" /><circle className="motion-status" cx="737" cy="526" r="20" fill="#fff" fillOpacity="0.9" /><circle cx="793" cy="526" r="20" fill="#3f1111" opacity="0.55" /></g></svg></div>); }

/* ═══════════════ ICONS ═══════════════ */
function LogoMark() { return (<span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-[#c43a3a] text-white shadow-lg shadow-red-900/20"><svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8V4h12v4" /><path d="M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M7 14h10v6H7z" /><path d="M8 17h8" /></svg></span>); }
function ReceiptStackIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h10v18l-2-1.2L13 21l-2-1.2L9 21l-2-1.2L5 21V5a2 2 0 0 1 2-2Z" /><path d="M9 8h6" /><path d="M9 12h6" /><path d="M9 16h4" /></svg>; }
function MozambiqueIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-4.6 7-11a7 7 0 0 0-14 0c0 6.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>; }
function StorefrontIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10h16l-1-5H5l-1 5Z" /><path d="M5 10v9h14v-9" /><path d="M9 19v-5h6v5" /><path d="M4 10c0 1.4 1.1 2.5 2.5 2.5S9 11.4 9 10" /><path d="M9 10c0 1.4 1.1 2.5 2.5 2.5S14 11.4 14 10" /><path d="M14 10c0 1.4 1.1 2.5 2.5 2.5S19 11.4 19 10" /></svg>; }
function PrinterIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8V3h12v5" /><path d="M6 17H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M7 13h10v8H7z" /><path d="M9 17h6" /></svg>; }
function HistoryIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v6h6" /><path d="M12 7v5l3 2" /></svg>; }
function CustomIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4 9.4-9.4Z" /><path d="M7 8h5" /><path d="M7 18h10" /></svg>; }
function MoonIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.9 14.5A8.5 8.5 0 0 1 9.5 3.1 7 7 0 1 0 20.9 14.5Z" /></svg>; }
function SunIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.3 17.7-1.4 1.4" /><path d="m19.1 4.9-1.4 1.4" /></svg>; }
function ArrowRightIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>; }
function CheckIcon({ className }: IconProps) { return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>; }
