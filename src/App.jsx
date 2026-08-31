// src/App.jsx — V2 routing (all domains wired)
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider }      from './hooks/useAuth'
import { LanguageProvider }  from './contexts/LanguageContext'
import Layout                from './components/Layout'
import RequireRole           from './components/RequireRole'
import Login                 from './pages/Login'
import Today                 from './pages/Today'
import MyTasks               from './pages/MyTasks'
import Alerts                from './pages/Alerts'
import AllVIPs               from './pages/AllVIPs'
import VIP360                from './pages/VIP360'
import AtRisk                from './pages/AtRisk'
import FollowUp              from './pages/FollowUp'
import BirthdayReminder      from './pages/BirthdayReminder'
import CampaignsCountryTiered from './pages/CampaignsCountryTiered'
import Upgrades              from './pages/Upgrades'
import TransferTracker       from './pages/TransferTracker'
import BudgetStrategy        from './pages/BudgetStrategy'
import Analytics             from './pages/Analytics'
import KPIProgress           from './pages/KPIProgress'
import PeriodReport          from './pages/PeriodReport'
import TierAnalytics         from './pages/TierAnalytics'
import PlayerProfiling       from './pages/PlayerProfiling'
import AskData               from './pages/AskData'
import ManageUsers           from './pages/ManageUsers'
import CSVImport             from './pages/CSVImport'
import ExportPage            from './pages/ExportPage'
import ExpenseTracker        from './pages/ExpenseTracker'
import BossView              from './pages/BossView'
import ContactLog            from './pages/ContactLog'
import DailyTargets          from './pages/DailyTargets'
import ChurnAlerts           from './pages/ChurnAlerts'

export default function App() {
  return <AuthProvider><LanguageProvider><BrowserRouter><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/" element={<Layout />}>
      <Route index element={<Navigate to="/today" replace />} />
      <Route path="dashboard" element={<Navigate to="/today" replace />} />
      <Route path="today" element={<RequireRole roles={['admin','host','readonly']}><Today /></RequireRole>} />
      <Route path="tasks" element={<RequireRole roles={['admin','host']}><MyTasks /></RequireRole>} />
      <Route path="alerts" element={<RequireRole roles={['admin','host','readonly']}><Alerts /></RequireRole>} />
      <Route path="vips" element={<RequireRole roles={['admin','host']}><AllVIPs /></RequireRole>} />
      <Route path="vips/:id" element={<RequireRole roles={['admin','host','readonly']}><VIP360 /></RequireRole>} />
      <Route path="at-risk" element={<RequireRole roles={['admin','host']}><AtRisk /></RequireRole>} />
      <Route path="follow-up" element={<RequireRole roles={['admin','host']}><FollowUp /></RequireRole>} />
      <Route path="birthdays" element={<RequireRole roles={['admin','host','readonly']}><BirthdayReminder /></RequireRole>} />
      <Route path="campaigns" element={<RequireRole roles={['admin','host']}><CampaignsCountryTiered /></RequireRole>} />
      <Route path="upgrades" element={<RequireRole roles={['admin','host']}><Upgrades /></RequireRole>} />
      <Route path="transfer" element={<RequireRole roles={['admin']}><TransferTracker /></RequireRole>} />
      <Route path="budget" element={<RequireRole roles={['admin']}><BudgetStrategy /></RequireRole>} />
      <Route path="analytics" element={<RequireRole roles={['admin','readonly']}><Analytics /></RequireRole>} />
      <Route path="kpi" element={<RequireRole roles={['admin','host','readonly']}><KPIProgress /></RequireRole>} />
      <Route path="period-report" element={<RequireRole roles={['admin','readonly']}><PeriodReport /></RequireRole>} />
      <Route path="tier-analytics" element={<RequireRole roles={['admin','readonly']}><TierAnalytics /></RequireRole>} />
      <Route path="profiling" element={<RequireRole roles={['admin','readonly']}><PlayerProfiling /></RequireRole>} />
      <Route path="ask" element={<RequireRole roles={['admin','host']}><AskData /></RequireRole>} />
      <Route path="users" element={<RequireRole roles={['admin']}><ManageUsers /></RequireRole>} />
      <Route path="import" element={<RequireRole roles={['admin']}><CSVImport /></RequireRole>} />
      <Route path="export" element={<RequireRole roles={['admin']}><ExportPage /></RequireRole>} />
      <Route path="expenses" element={<RequireRole roles={['admin']}><ExpenseTracker /></RequireRole>} />
      <Route path="boss" element={<RequireRole roles={['admin','readonly']}><BossView /></RequireRole>} />
      <Route path="contacts" element={<RequireRole roles={['admin','host']}><ContactLog /></RequireRole>} />
      <Route path="targets" element={<RequireRole roles={['admin','host']}><DailyTargets /></RequireRole>} />
      <Route path="churn" element={<RequireRole roles={['admin','host']}><ChurnAlerts /></RequireRole>} />
    </Route>
    <Route path="*" element={<Navigate to="/today" replace />} />
  </Routes></BrowserRouter></LanguageProvider></AuthProvider>
}
