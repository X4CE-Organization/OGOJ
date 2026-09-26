import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import { Loading } from './components/ui';
import { useAuth } from './lib/auth';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Problems from './pages/Problems';
import ProblemDetail from './pages/ProblemDetail';
import Records from './pages/Records';
import RecordDetail from './pages/RecordDetail';
import Contests from './pages/Contests';
import ContestDetail from './pages/ContestDetail';
import Training from './pages/Training';
import ListDetail from './pages/ListDetail';
import Discussions from './pages/Discussions';
import DiscussionDetail from './pages/DiscussionDetail';
import Articles from './pages/Articles';
import ArticleDetail from './pages/ArticleDetail';
import ArticleEditor from './pages/ArticleEditor';
import SolutionDetail from './pages/SolutionDetail';
import Rank from './pages/Rank';
import Users from './pages/Users';
import UserProfile from './pages/UserProfile';
import Shop from './pages/Shop';
import Orders from './pages/Orders';
import TeamList from './pages/teams/TeamList';
import TeamLayout from './pages/teams/TeamLayout';
import TeamOverview from './pages/teams/TeamOverview';
import TeamDiscussions from './pages/teams/TeamDiscussions';
import TeamProblems from './pages/teams/TeamProblems';
import TeamAssignments from './pages/teams/TeamAssignments';
import TeamLists from './pages/teams/TeamLists';
import TeamContests from './pages/teams/TeamContests';
import TeamMembers from './pages/teams/TeamMembers';
import TeamFiles from './pages/teams/TeamFiles';
import TeamSettings from './pages/teams/TeamSettings';
import Messages from './pages/Messages';
import SettingsPage from './pages/Settings';
import SearchPage from './pages/Search';
import About from './pages/About';
import Help from './pages/Help';
import NotFound from './pages/NotFound';
import OAuthCallback from './pages/OAuthCallback';
import Achievements from './pages/Achievements';
import Tickets from './pages/Tickets';
import TicketNew from './pages/TicketNew';
import TicketDetail from './pages/TicketDetail';

import AdminLayout from './pages/admin/AdminLayout';
import AdminDashboard from './pages/admin/Dashboard';
import AdminSettings from './pages/admin/SettingsPanel';
import AdminUsers from './pages/admin/UsersPanel';
import AdminProblems from './pages/admin/ProblemsPanel';
import AdminProblemEditor from './pages/admin/ProblemEditor';
import AdminContests from './pages/admin/ContestsPanel';
import AdminShop from './pages/admin/ShopPanel';
import AdminOrders from './pages/admin/OrdersPanel';
import AdminCarousel from './pages/admin/CarouselPanel';
import AdminAnnouncements from './pages/admin/AnnouncementsPanel';
import AdminDiscussions from './pages/admin/DiscussionsPanel';
import AdminSolutions from './pages/admin/SolutionsPanel';
import AdminJudge from './pages/admin/JudgePanel';
import AdminLogs from './pages/admin/LogsPanel';
import AdminBackups from './pages/admin/MaintenancePanel';
import AdminAchievements from './pages/admin/AchievementsPanel';
import AdminTagGroups from './pages/admin/TagGroupsPanel';
import AdminTickets from './pages/admin/TicketsPanel';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login?redirect=1" replace />;
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'admin' && user.role !== 'superadmin') return <NotFound />;
  return children;
}

export default function App() {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loading label="正在加载 OGOJ…" />
      </div>
    );
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />
        <Route path="/problems" element={<Problems />} />
        <Route path="/problem/:pid" element={<ProblemDetail />} />
        <Route path="/record" element={<Records />} />
        <Route path="/record/:id" element={<RecordDetail />} />
        <Route path="/contests" element={<Contests />} />
        <Route path="/contest/:id" element={<ContestDetail />} />
        <Route path="/training" element={<Training />} />
        <Route path="/list/:id" element={<ListDetail />} />
        <Route path="/discussions" element={<Discussions />} />
        <Route path="/discussion/:id" element={<DiscussionDetail />} />
        <Route path="/articles" element={<Articles />} />
        <Route path="/article/new" element={<RequireAuth><ArticleEditor /></RequireAuth>} />
        <Route path="/article/:id/edit" element={<RequireAuth><ArticleEditor /></RequireAuth>} />
        <Route path="/article/:id" element={<ArticleDetail />} />
        <Route path="/solution/:id" element={<SolutionDetail />} />
        <Route path="/rank" element={<Rank />} />
        <Route path="/achievements" element={<Achievements />} />
        <Route path="/tickets" element={<RequireAuth><Tickets /></RequireAuth>} />
        <Route path="/tickets/new" element={<RequireAuth><TicketNew /></RequireAuth>} />
        <Route path="/tickets/:id" element={<RequireAuth><TicketDetail /></RequireAuth>} />
        <Route path="/users" element={<Users />} />
        <Route path="/user/:username" element={<UserProfile />} />
        <Route path="/shop" element={<Shop />} />
        <Route path="/shop/orders" element={<RequireAuth><Orders /></RequireAuth>} />
        <Route path="/teams" element={<TeamList />} />
        <Route path="/team/:slug" element={<TeamLayout />}>
          <Route index element={<TeamOverview />} />
          <Route path="discussions" element={<TeamDiscussions />} />
          <Route path="discussions/:id" element={<TeamDiscussions />} />
          <Route path="problems" element={<TeamProblems />} />
          <Route path="assignments" element={<TeamAssignments />} />
          <Route path="assignments/:id" element={<TeamAssignments />} />
          <Route path="lists" element={<TeamLists />} />
          <Route path="lists/:id" element={<TeamLists />} />
          <Route path="contests" element={<TeamContests />} />
          <Route path="members" element={<TeamMembers />} />
          <Route path="files" element={<TeamFiles />} />
          <Route path="settings" element={<TeamSettings />} />
        </Route>
        <Route path="/messages" element={<RequireAuth><Messages /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/about" element={<About />} />
        <Route path="/help" element={<Help />} />

        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<AdminDashboard />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="problems" element={<AdminProblems />} />
          <Route path="problems/new" element={<AdminProblemEditor />} />
          <Route path="problems/:id/edit" element={<AdminProblemEditor />} />
          <Route path="contests" element={<AdminContests />} />
          <Route path="shop" element={<AdminShop />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="carousel" element={<AdminCarousel />} />
          <Route path="announcements" element={<AdminAnnouncements />} />
          <Route path="discussions" element={<AdminDiscussions />} />
          <Route path="solutions" element={<AdminSolutions />} />
          <Route path="judge" element={<AdminJudge />} />
          <Route path="achievements" element={<AdminAchievements />} />
          <Route path="tags" element={<AdminTagGroups />} />
          <Route path="tickets" element={<AdminTickets />} />
          <Route path="logs" element={<AdminLogs />} />
          <Route path="maintenance" element={<AdminBackups />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
