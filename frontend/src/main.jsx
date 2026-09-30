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
      <Route path="/entrar" element={s.me ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/cadastro" element={s.me ? <Navigate to="/" replace /> : <Register />} />
      <Route element={<Guard><Layout /></Guard>}>
        <Route index element={<Suspense fallback={<Loading />}><Home /></Suspense>} />
        <Route path="pdv" element={<Suspense fallback={<Loading />}><Pdv /></Suspense>} />
        <Route path="salao" element={<Suspense fallback={<Loading />}><Floor /></Suspense>} />
        <Route path="cardapio" element={<Suspense fallback={<Loading />}><Menu /></Suspense>} />
        <Route path="financeiro/caixa" element={<Suspense fallback={<Loading />}><Cash /></Suspense>} />
        <Route path="configuracoes/*" element={<Suspense fallback={<Loading />}><Settings /></Suspense>} />
        <Route path="suporte" element={<Suspense fallback={<Loading />}><Support /></Suspense>} />
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
