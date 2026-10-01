import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { SessionProvider, useSession } from './lib/session.jsx';
import { Loading, ToastProvider } from './components/ui.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Blocked from './pages/Blocked.jsx';

const Home = lazy(() => import('./pages/Home.jsx'));
const Pdv = lazy(() => import('./pdv/Pdv.jsx'));
const Floor = lazy(() => import('./pages/Floor.jsx'));
const Menu = lazy(() => import('./pages/Menu.jsx'));
const Cash = lazy(() => import('./pages/Cash.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Support = lazy(() => import('./pages/Support.jsx'));
const Soon = lazy(() => import('./pages/Soon.jsx'));
const Subscription = lazy(() => import('./pages/Subscription.jsx'));
const Customers = lazy(() => import('./pages/Customers.jsx'));
const Kitchen = lazy(() => import('./pages/Kitchen.jsx'));
const Stock = lazy(() => import('./pages/Stock.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Delivery = lazy(() => import('./pages/Delivery.jsx'));
const Marketing = lazy(() => import('./pages/Marketing.jsx'));
const Agent = lazy(() => import('./pages/Agent.jsx'));
const Reservations = lazy(() => import('./pages/Reservations.jsx'));
const PublicPages = import('./pages/Public.jsx');
const PublicMenu = lazy(() => PublicPages.then((m) => ({ default: m.PublicMenu })));
const PublicOrder = lazy(() => PublicPages.then((m) => ({ default: m.PublicOrder })));
const PublicReview = lazy(() => PublicPages.then((m) => ({ default: m.PublicReview })));
const Unsubscribe = lazy(() => PublicPages.then((m) => ({ default: m.Unsubscribe })));
const L = (el) => <Suspense fallback={<Loading />}>{el}</Suspense>;

function Guard({ children }) {
  const s = useSession();
  if (s.loading) return <Loading />;
  if (!s.me) return <Navigate to="/entrar" replace />;
  if (s.blocked) return <Blocked />;
  return children;
}

function App() {
  const s = useSession();
  return (
    <Routes>
      <Route path="/c/:slug" element={L(<PublicMenu />)} />
      <Route path="/pedido/:token" element={L(<PublicOrder />)} />
      <Route path="/avaliar/:token" element={L(<PublicReview />)} />
      <Route path="/sair/:token" element={L(<Unsubscribe />)} />
      <Route path="/entrar" element={s.me ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/cadastro" element={s.me ? <Navigate to="/" replace /> : <Register />} />
      <Route path="/assinatura" element={s.loading ? <Loading /> : !s.me ? <Navigate to="/entrar" replace />
        : <Suspense fallback={<Loading />}><Subscription standalone /></Suspense>} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Suspense fallback={<Loading />}><Home /></Suspense>} />
        <Route path="pdv" element={<Suspense fallback={<Loading />}><Pdv /></Suspense>} />
        <Route path="salao" element={<Suspense fallback={<Loading />}><Floor /></Suspense>} />
        <Route path="cardapio" element={<Suspense fallback={<Loading />}><Menu /></Suspense>} />
        <Route path="financeiro/caixa" element={<Suspense fallback={<Loading />}><Cash /></Suspense>} />
        <Route path="configuracoes/*" element={<Suspense fallback={<Loading />}><Settings /></Suspense>} />
        <Route path="suporte" element={<Suspense fallback={<Loading />}><Support /></Suspense>} />
        <Route path="clientes" element={L(<Customers />)} />
        <Route path="cozinha" element={L(<Kitchen />)} />
        <Route path="estoque" element={L(<Stock />)} />
        <Route path="relatorios" element={L(<Reports />)} />
        <Route path="delivery" element={L(<Delivery />)} />
        <Route path="marketing" element={L(<Marketing />)} />
        <Route path="agente" element={L(<Agent />)} />
        <Route path="salao/reservas" element={L(<Reservations />)} />
        <Route path="em-breve/:mod" element={<Suspense fallback={<Loading />}><Soon /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider><App /></ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
